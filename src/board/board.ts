/**
 * The 3D board: an Atlas map drawn as a table, with its tokens, pins and props, a camera that moves like
 * TacticalEngine's, and the pointer and keys that drive them.
 *
 * - Left-drag on a token carries it (its mini leans and walks the way Tabletop's minis always have); on release it
 *   snaps to the grid like Atlas, glides there, and the move is saved once.
 * - Ctrl + left-drag on a prop carries the prop.
 * - A click on a pin opens its note; a right-click on a token or a prop opens its menu; a click on a token wobbles
 *   its mini.
 * - Any other drag moves the camera: left or middle orbits, right pans. The wheel zooms. WASD or the arrow keys pan,
 *   Q and E turn, Home frames the map.
 *
 * It talks to Obsidian only through its `BoardHost`, so the harness can drive it, and draws only when something
 * moves: the camera easing, a token gliding, a mini's clip playing.
 */
import * as THREE from 'three';
import type { MiniPlacement } from '../assignments';
import type { LoadedMini } from '../library';
import type { PropPlacement, TokenStyle } from './boardData';
import { OrbitCamera, limitsFor } from './camera';
import type { CollectionRules } from './conditions';
import { ringDiameter, snapPoint } from './geometry';
import { TokenLabels, type HoverTarget } from './labels';
import type { BoardMap, BoardToken } from './mapModel';
import { PinPiece, PropPiece, TokenPiece, type PoseContext } from './pieces';
import { ResolutionGovernor, type QualityPreset } from './quality';
import { BoardSurface } from './surface';
import { loadImageTexture, screenScale } from './textures';

export interface BoardHost {
  /** A URL for a vault image, or null when it is missing. */
  readImage(path: string): Promise<string | null>;
  /** A GLB read into a model; rejects with the reason it cannot be drawn. */
  readMini(path: string): Promise<LoadedMini>;
  placement(tokenId: string): MiniPlacement | null;
  style(tokenId: string): TokenStyle;
  props(): readonly PropPlacement[];
  rules(): CollectionRules;
  moveToken(id: string, x: number, y: number): void;
  moveProp(id: string, x: number, y: number): void;
  addProp(glb: string, x: number, y: number): void;
  openNote(path: string): void;
  tokenMenu(id: string, event: MouseEvent): void;
  propMenu(id: string, event: MouseEvent): void;
  /** Shows a token's stat block (Ctrl/Cmd + hover). */
  statblockPreview(id: string, event: MouseEvent): void;
  /** Shown once per message. */
  warn(message: string): void;
}

const FOV = 35;
/** A press that moves less than this is a click (TacticalEngine). */
const DRAG_PX = 6;
const ORBIT_X = 0.006;
const ORBIT_Y = 0.004;
const PAN_PER_PX = 0.0016;
const WHEEL = 0.0012;
const KEY_PAN = 0.9;
const KEY_TURN = 1.6;
/** How fast a released token closes on its cell, per second. */
const GLIDE = 14;
/** The longest frame anything steps by, so a hidden tab does not fling a mini. */
const LONGEST_STEP = 1 / 15;
const FALLBACK_SIZE = 2000;
/** How often a playing clip redraws the shadows, in seconds. */
const CLIP_SHADOW_STEP = 1 / 15;
/** Room left around the map when it is framed, for the tilt's perspective. */
const FRAME_MARGIN = 1.1;

interface TokenEntry {
  token: BoardToken;
  piece: TokenPiece;
  labels: TokenLabels;
  /** Where it is drawn, and where it is heading. */
  at: { x: number; y: number };
  goal: { x: number; y: number };
  mini: string | null;
}

type Press =
  | {
    kind: 'camera'; button: number; x: number; y: number; lastX: number; lastY: number; moved: boolean;
    token: string | null; prop: string | null; pin: string | null;
    /** The spot of the board a pan holds under the pointer. */
    grab: { x: number; y: number } | null;
  }
  | { kind: 'token'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number } }
  | { kind: 'prop'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number } };

export class Board {
  readonly canvas: HTMLCanvasElement;
  camera: OrbitCamera = new OrbitCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly view = new THREE.PerspectiveCamera(FOV, 1, 1, 10_000);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tooltip: HTMLElement;
  private readonly resize: ResizeObserver;
  private readonly stops: Array<() => void> = [];
  private surface: BoardSurface | null = null;
  private map: BoardMap | null = null;
  private size = { width: 0, height: 0 };
  private hasImage = false;
  private readonly tokens = new Map<string, TokenEntry>();
  private pins: PinPiece[] = [];
  private readonly props = new Map<string, PropPiece>();
  private readonly arts = new Map<string, Promise<THREE.Texture | null>>();
  private readonly models = new Map<string, Promise<LoadedMini | null>>();
  private press: Press | null = null;
  private placing: string | null = null;
  private readonly held = new Set<string>();
  private frameId = 0;
  private last = 0;
  private clock = 0;
  private disposed = false;
  private governor: ResolutionGovernor;
  /** The last frame asked for the next one: the time between them is a real frame time, not a rest. */
  private continuing = false;
  /** Something on the board changed since the shadows were last drawn. */
  private shadowsDirty = true;
  private shadowedAt = 0;
  /** The token whose stat block was last shown, so a hover shows it once. */
  private previewed: string | null = null;

  constructor(private readonly container: HTMLElement, private readonly host: BoardHost, private quality: QualityPreset) {
    const doc = container.ownerDocument;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'atlas-tabletop-board';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.tooltip = doc.createElement('div');
    this.tooltip.className = 'atlas-tabletop-tooltip';
    this.tooltip.hidden = true;
    container.appendChild(this.tooltip);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality.antialias });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The resolution follows the quality setting, and drops while the board cannot keep up (adaptive resolution).
    this.governor = new ResolutionGovernor(quality, doc.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(this.governor.ratio);
    // Shadows are redrawn only when something on the board moves, not when only the camera does.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(0x0f0c0a);
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x2a2430, 1.5));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.listen();
    this.fit();
  }

  /** Shows a map: the first load frames it, later loads (the file changed) keep the camera where it is. */
  async load(map: BoardMap): Promise<void> {
    const first = this.map === null;
    const sameImage = this.map?.background === map.background;
    this.map = map;
    if (first || !sameImage || this.gridChanged(map)) await this.buildSurface(map);
    if (this.disposed) return;
    if (first) {
      this.camera = new OrbitCamera({ target: { x: this.size.width / 2, y: 0, z: this.size.height / 2 }, pitch: 0.95 }, limitsFor(this.size.width, this.size.height));
      this.frameMap();
      this.camera.snap();
    }
    this.sync();
  }

  /** The drawing resolution now, as a share of the screen's pixels. */
  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /**
   * Applies a quality preset. Antialiasing is fixed when the board is made, so a preset that changes it returns false:
   * the board must be made again.
   */
  setQuality(preset: QualityPreset): boolean {
    if (preset.antialias !== this.quality.antialias) return false;
    this.quality = preset;
    this.governor = new ResolutionGovernor(preset, this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(this.governor.ratio);
    this.fit();
    if (this.sun.shadow.mapSize.x !== preset.shadowMapSize) {
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    for (const entry of this.tokens.values()) entry.piece.setMiniShadows(preset.miniShadows);
    this.wake(true);
    return true;
  }

  /** Re-reads the minis, styles, props and rules from the host (they changed outside the map file). */
  refresh(): void {
    if (this.map) this.sync();
  }

  /** The next left click on the board drops a prop of `glb` there. */
  placeProp(glb: string): void {
    this.placing = glb;
    this.canvas.style.cursor = 'crosshair';
    this.canvas.focus();
  }

  /**
   * Looks at the whole map from the current angle: far enough out that the circle around it fits the narrower of the
   * view's two fields of view, so it fits however the camera has turned, with a margin for the tilt.
   */
  frameMap(): void {
    const half = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * Math.min(1, this.view.aspect);
    const fit = (Math.hypot(this.size.width, this.size.height) / 2 / half) * FRAME_MARGIN;
    // `frame` stands back 1.8 × the radius it is given (TacticalEngine's framing).
    this.camera.frame({ x: this.size.width / 2, y: 0, z: this.size.height / 2 }, fit / 1.8);
    this.wake();
  }

  private gridChanged(map: BoardMap): boolean {
    return this.lastGrid !== JSON.stringify(map.grid);
  }

  private lastGrid = '';

  private async buildSurface(map: BoardMap): Promise<void> {
    let texture: THREE.Texture | null = null;
    if (map.background) {
      const url = await this.host.readImage(map.background);
      if (url) {
        try {
          texture = await loadImageTexture(url);
        } catch {
          this.host.warn(`Tabletop: cannot read the map image ${map.background}.`);
        }
      } else {
        this.host.warn(`Tabletop: the map image ${map.background} is missing.`);
      }
    }
    if (this.disposed) { texture?.dispose(); return; }
    const image = texture?.image as { width?: number; height?: number } | undefined;
    const width = image?.width || FALLBACK_SIZE;
    const height = image?.height || FALLBACK_SIZE;
    this.surface?.object3d.removeFromParent();
    this.surface?.dispose();
    this.surface = new BoardSurface(width, height, map.grid);
    this.surface.setImage(texture);
    this.scene.add(this.surface.object3d);
    this.size = { width, height };
    this.hasImage = texture !== null;
    this.lastGrid = JSON.stringify(map.grid);
    const span = Math.max(width, height);
    this.sun.position.set(width / 2 - span * 0.5, span * 1.2, height / 2 - span * 0.7);
    this.sun.target.position.set(width / 2, 0, height / 2);
    const shadow = this.sun.shadow.camera;
    shadow.left = -span * 0.8;
    shadow.right = span * 0.8;
    shadow.top = span * 0.8;
    shadow.bottom = -span * 0.8;
    shadow.near = span * 0.1;
    shadow.far = span * 4;
    shadow.updateProjectionMatrix();
    this.view.near = span * 0.005;
    this.view.far = span * 40;
    this.view.updateProjectionMatrix();
  }

  /** Brings tokens, pins and props in line with the map and the host. */
  private sync(): void {
    const map = this.map!;
    const rules = this.host.rules();
    const artUse = new Map<string, number>();
    for (const token of map.tokens) if (token.imagePath) artUse.set(token.imagePath, (artUse.get(token.imagePath) ?? 0) + 1);
    const seen = new Set<string>();
    for (const token of map.tokens) {
      seen.add(token.id);
      const shared = (artUse.get(token.imagePath ?? '') ?? 0) >= 2;
      let entry = this.tokens.get(token.id);
      if (!entry) {
        const piece = new TokenPiece(token, map.grid);
        piece.setMiniShadows(this.quality.miniShadows);
        const labels = new TokenLabels(token, map.tokenSettings, rules, shared);
        piece.object3d.add(labels.object3d);
        this.scene.add(piece.object3d);
        entry = { token, piece, labels, at: { x: token.x, y: token.y }, goal: { x: token.x, y: token.y }, mini: null };
        this.tokens.set(token.id, entry);
      } else {
        entry.piece.update(token);
        entry.labels.update(token, map.tokenSettings, rules, shared);
        entry.token = token;
        // A token being carried stays under the pointer; the file catches up on release.
        if (this.press?.kind !== 'token' || this.press.id !== token.id) entry.goal = { x: token.x, y: token.y };
      }
      entry.piece.setStyle(this.host.style(token.id));
      this.applyArt(entry);
      this.applyMini(entry);
    }
    for (const [id, entry] of [...this.tokens]) {
      if (seen.has(id)) continue;
      entry.labels.dispose();
      entry.piece.dispose();
      this.tokens.delete(id);
    }

    for (const pin of this.pins) pin.dispose();
    this.pins = map.pins.map((pin) => {
      const piece = new PinPiece(pin, map.grid);
      this.scene.add(piece.object3d);
      return piece;
    });

    const wanted = new Map(this.host.props().map((prop) => [prop.id, prop]));
    for (const [id, piece] of [...this.props]) {
      const next = wanted.get(id);
      if (next && next.glb === piece.placement.glb && next.scale === piece.placement.scale && next.rotation === piece.placement.rotation) {
        piece.placement = next;
        if (this.press?.kind !== 'prop' || this.press.id !== id) piece.place(next.x, next.y);
        continue;
      }
      piece.dispose();
      this.props.delete(id);
    }
    for (const prop of wanted.values()) {
      if (this.props.has(prop.id)) continue;
      const piece = new PropPiece(prop, map.grid);
      this.props.set(prop.id, piece);
      this.scene.add(piece.object3d);
      void this.model(prop.glb).then((model) => {
        if (this.props.get(prop.id) !== piece || !model) return;
        piece.setModel(model);
        this.wake(true);
      });
    }
    this.wake(true);
  }

  private applyArt(entry: TokenEntry): void {
    const path = entry.token.imagePath;
    if (!path) { entry.piece.setArt(null); return; }
    let art = this.arts.get(path);
    if (!art) {
      art = this.host.readImage(path).then((url) => (url ? loadImageTexture(url) : null)).catch(() => null);
      this.arts.set(path, art);
    }
    void art.then((texture) => {
      if (this.tokens.get(entry.token.id) !== entry || entry.token.imagePath !== path) return;
      if (!texture) this.host.warn(`Tabletop: cannot show the token art ${path}.`);
      entry.piece.setArt(texture);
      this.wake(true);
    });
  }

  private applyMini(entry: TokenEntry): void {
    const placement = this.host.placement(entry.token.id);
    if (!placement) {
      entry.mini = null;
      entry.piece.setMini(null, null);
      return;
    }
    entry.mini = placement.mini;
    void this.model(placement.mini).then((model) => {
      if (this.tokens.get(entry.token.id) !== entry || entry.mini !== placement.mini) return;
      entry.piece.setMini(model, model ? placement : null);
      this.wake(true);
    });
  }

  private model(path: string): Promise<LoadedMini | null> {
    let found = this.models.get(path);
    if (!found) {
      found = this.host.readMini(path).catch((error: unknown) => {
        this.host.warn(`Tabletop: cannot show ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      this.models.set(path, found);
    }
    return found;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  private fit(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.view.aspect = width / height;
    this.view.updateProjectionMatrix();
    this.wake();
  }

  /** Asks for a frame; frames keep coming while anything moves. `changed` says the board itself changed (shadows). */
  wake(changed = false): void {
    if (changed) this.shadowsDirty = true;
    if (this.disposed || this.frameId !== 0) return;
    const win = this.container.ownerDocument.defaultView ?? window;
    this.frameId = win.requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    this.frameId = 0;
    if (this.disposed) return;
    const interval = this.last === 0 ? 0 : (time - this.last) / 1000;
    const dt = Math.min(LONGEST_STEP, interval);
    this.last = time;
    if (this.continuing) {
      const ratio = this.governor.sample(interval);
      if (ratio !== null) {
        this.renderer.setPixelRatio(ratio);
        this.fit();
      }
    }
    this.clock += dt;
    this.steer(dt);
    let busy = this.camera.update(dt);
    this.applyView();
    const viewHeight = this.renderer.domElement.clientHeight || 1;
    const context: PoseContext = {
      dt,
      now: this.clock,
      zoom: viewHeight / (2 * this.camera.pose.distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)),
      yaw: this.camera.pose.yaw,
      pixel: screenScale(1, viewHeight, FOV),
    };
    const glide = 1 - Math.exp(-GLIDE * dt);
    let changed = this.shadowsDirty || this.press?.kind === 'token' || this.press?.kind === 'prop';
    let moving = false;
    for (const entry of this.tokens.values()) {
      const dx = entry.goal.x - entry.at.x;
      const dy = entry.goal.y - entry.at.y;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        entry.at.x += dx * glide;
        entry.at.y += dy * glide;
        busy = true;
        changed = true;
        moving = true;
      } else {
        entry.at.x = entry.goal.x;
        entry.at.y = entry.goal.y;
      }
      entry.piece.pose(entry.at.x, entry.at.y, context);
      entry.labels.place(entry.piece.figureHeight(), ringDiameter(this.map!.grid, entry.token.size) / 2, entry.piece.top);
      entry.labels.pose(context);
      if (entry.piece.animating) {
        busy = true;
        changed = true;
      }
    }
    for (const pin of this.pins) pin.pose(context);
    // A mini's clip alone redraws the shadows a few times a second, not every frame.
    const clipsOnly = changed && !this.shadowsDirty && this.press === null && !moving;
    if (changed && (!clipsOnly || this.clock - this.shadowedAt >= CLIP_SHADOW_STEP)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowedAt = this.clock;
    }
    this.shadowsDirty = false;
    this.renderer.render(this.scene, this.view);
    this.continuing = busy || this.held.size > 0 || this.press !== null;
    if (this.continuing) this.wake();
  }

  private steer(dt: number): void {
    if (this.held.size === 0) return;
    const speed = this.camera.goal.distance * KEY_PAN * dt;
    let right = 0;
    let forward = 0;
    if (this.held.has('a') || this.held.has('arrowleft')) right -= 1;
    if (this.held.has('d') || this.held.has('arrowright')) right += 1;
    if (this.held.has('w') || this.held.has('arrowup')) forward += 1;
    if (this.held.has('s') || this.held.has('arrowdown')) forward -= 1;
    if (right !== 0 || forward !== 0) this.camera.pan(right * speed, forward * speed);
    if (this.held.has('q')) this.camera.orbit(KEY_TURN * dt, 0);
    if (this.held.has('e')) this.camera.orbit(-KEY_TURN * dt, 0);
  }

  // ── Pointer and keys ──────────────────────────────────────────────────────

  /** Puts the drawn camera where the orbit camera's pose says, so rays cast before the next frame see it too. */
  private applyView(): void {
    const eye = this.camera.position();
    const target = this.camera.pose.target;
    this.view.position.set(eye.x, eye.y, eye.z);
    this.view.lookAt(target.x, target.y, target.z);
    this.view.updateMatrixWorld();
  }

  private ray(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.applyView();
    this.raycaster.setFromCamera(ndc, this.view);
  }

  /**
   * Pans so the spot `grab` is under the pointer at (x, y): the board moves exactly with the hand. Without a spot (the
   * pan began off the board) it falls back to TacticalEngine's rate.
   */
  private panTo(grab: { x: number; y: number } | null, x: number, y: number): void {
    const now = grab ? this.boardPoint(x, y) : null;
    if (grab && now) {
      this.camera.goal.target.x += grab.x - now.x;
      this.camera.goal.target.z += grab.y - now.y;
      return;
    }
    const press = this.press;
    if (press?.kind !== 'camera') return;
    const scale = this.camera.goal.distance * PAN_PER_PX;
    this.camera.pan(-(x - press.lastX) * scale, (y - press.lastY) * scale);
  }

  /** The point of the board under the pointer, in map pixels. */
  boardPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    this.ray(clientX, clientY);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  private hit<T extends THREE.Object3D>(clientX: number, clientY: number, objects: T[]): T | null {
    this.ray(clientX, clientY);
    const hits = this.raycaster.intersectObjects(objects, false);
    return (hits[0]?.object as T | undefined) ?? null;
  }

  private tokenAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, [...this.tokens.values()].map((entry) => entry.piece.hitTarget));
    return (hit?.userData.tokenId as string | undefined) ?? null;
  }

  private pinAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, this.pins.map((pin) => pin.hitTarget));
    return (hit?.userData.pinId as string | undefined) ?? null;
  }

  private propAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, [...this.props.values()].map((piece) => piece.hitTarget));
    return (hit?.userData.propId as string | undefined) ?? null;
  }

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      this.canvas.addEventListener(type, handler, options);
      this.stops.push(() => this.canvas.removeEventListener(type, handler, options));
    };
    on('contextmenu', (event) => event.preventDefault());
    on('pointerdown', (event) => this.down(event));
    on('pointermove', (event) => this.move(event));
    on('pointerup', (event) => this.up(event));
    on('pointercancel', () => this.cancel());
    // The pointer was taken away mid-drag (Alt-Tab, a dialog): no pointerup will come, so the drag ends here. After a
    // normal release `press` is already cleared.
    on('lostpointercapture', () => { if (this.press) this.cancel(); });
    on('pointerleave', () => { this.tooltip.hidden = true; });
    on('wheel', (event) => {
      event.preventDefault();
      this.camera.zoom(Math.exp(event.deltaY * WHEEL));
      this.wake();
    }, { passive: false });
    on('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (key === 'escape' && this.placing) { this.stopPlacing(); return; }
      if (key === 'home') { this.frameMap(); event.preventDefault(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        this.held.add(key);
        event.preventDefault();
        this.wake();
      }
    });
    on('keyup', (event) => { this.held.delete(event.key.toLowerCase()); });
    on('blur', () => this.held.clear());
  }

  private down(event: PointerEvent): void {
    this.canvas.focus();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.tooltip.hidden = true;
    const { clientX: x, clientY: y } = event;
    if (event.button === 0 && this.placing) return;
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
      const id = this.propAt(x, y);
      const piece = id ? this.props.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && piece && at) {
        this.press = { kind: 'prop', id, x, y, moved: false, grab: { dx: piece.object3d.position.x - at.x, dy: piece.object3d.position.z - at.y } };
        return;
      }
    }
    if (event.button === 0) {
      const id = this.tokenAt(x, y);
      const entry = id ? this.tokens.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && entry && at) {
        this.press = { kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y } };
        entry.piece.carried = true;
        return;
      }
    }
    const token = event.button === 2 ? this.tokenAt(x, y) : null;
    const prop = event.button === 2 && !token ? this.propAt(x, y) : null;
    const pin = event.button === 0 ? this.pinAt(x, y) : null;
    const grab = event.button === 2 ? this.boardPoint(x, y) : null;
    this.press = { kind: 'camera', button: event.button, x, y, lastX: x, lastY: y, moved: false, token, prop, pin, grab };
  }

  private move(event: PointerEvent): void {
    const press = this.press;
    if (!press) { this.hover(event); return; }
    // Moving with no button held: the release was missed.
    if (event.buttons === 0) { this.cancel(); return; }
    const { clientX: x, clientY: y } = event;
    if (!press.moved && Math.hypot(x - press.x, y - press.y) >= DRAG_PX) press.moved = true;
    if (!press.moved) return;
    if (press.kind === 'camera') {
      const dx = x - press.lastX;
      const dy = y - press.lastY;
      press.lastX = x;
      press.lastY = y;
      if (press.button === 0 || press.button === 1) this.camera.orbit(-dx * ORBIT_X, -dy * ORBIT_Y);
      else this.panTo(press.grab, x, y);
      // A drag moves the view at once: easing it would leave the board trailing the pointer.
      this.camera.snap();
      this.wake();
      return;
    }
    const at = this.boardPoint(x, y);
    if (!at) return;
    const point = this.clampToBoard(at.x + press.grab.dx, at.y + press.grab.dy);
    if (press.kind === 'token') {
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = point;
        entry.at = { ...point };
      }
    } else {
      this.props.get(press.id)?.place(point.x, point.y);
    }
    this.wake();
  }

  private up(event: PointerEvent): void {
    const press = this.press;
    this.press = null;
    const { clientX: x, clientY: y } = event;
    if (event.button === 0 && this.placing) {
      const at = this.boardPoint(x, y);
      const glb = this.placing;
      this.stopPlacing();
      if (at) this.host.addProp(glb, at.x, at.y);
      return;
    }
    if (!press) return;
    if (press.kind === 'token') {
      const entry = this.tokens.get(press.id);
      if (!entry) return;
      entry.piece.carried = false;
      if (!press.moved) {
        entry.piece.shake(this.clock);
        this.wake(true);
        return;
      }
      const snapped = snapPoint(this.map!.grid, entry.at.x, entry.at.y);
      entry.goal = snapped;
      this.host.moveToken(press.id, snapped.x, snapped.y);
      this.wake(true);
      return;
    }
    if (press.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece && press.moved) this.host.moveProp(press.id, piece.object3d.position.x, piece.object3d.position.z);
      this.wake(true);
      return;
    }
    if (press.moved) return;
    if (press.button === 2 && press.token) this.host.tokenMenu(press.token, event);
    else if (press.button === 2 && press.prop) this.host.propMenu(press.prop, event);
    else if (press.button === 0 && press.pin) {
      const pin = this.pins.find((piece) => piece.pin.id === press.pin);
      if (pin?.pin.notePath) this.host.openNote(pin.pin.notePath);
    }
  }

  private cancel(): void {
    const press = this.press;
    this.press = null;
    if (press?.kind === 'token') {
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = { x: entry.token.x, y: entry.token.y };
        entry.piece.carried = false;
      }
    } else if (press?.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece) piece.place(piece.placement.x, piece.placement.y);
    }
    this.wake(true);
  }

  private stopPlacing(): void {
    this.placing = null;
    this.canvas.style.cursor = '';
  }

  /** Keeps a carried piece on the map image; a map without one has no edge to keep to. */
  private clampToBoard(x: number, y: number): { x: number; y: number } {
    if (!this.hasImage) return { x, y };
    return { x: THREE.MathUtils.clamp(x, 0, this.size.width), y: THREE.MathUtils.clamp(y, 0, this.size.height) };
  }

  /** Names a condition ring or stat badge under the pointer; with Ctrl/Cmd held, shows a token's stat block. */
  private hover(event: PointerEvent): void {
    if (event.ctrlKey || event.metaKey) {
      const id = this.tokenAt(event.clientX, event.clientY);
      if (id !== this.previewed && id && this.tokens.get(id)?.token.statblockPath) this.host.statblockPreview(id, event);
      this.previewed = id;
    } else {
      this.previewed = null;
    }
    const targets: HoverTarget[] = [];
    for (const entry of this.tokens.values()) targets.push(...entry.labels.hoverTargets);
    const hit = this.hit(event.clientX, event.clientY, targets.map((target) => target.object));
    const found = hit ? targets.find((target) => target.object === hit) : undefined;
    if (!found) { this.tooltip.hidden = true; return; }
    const rect = this.container.getBoundingClientRect();
    this.tooltip.textContent = found.label;
    this.tooltip.style.left = `${event.clientX - rect.left + 12}px`;
    this.tooltip.style.top = `${event.clientY - rect.top + 12}px`;
    this.tooltip.hidden = false;
  }

  dispose(): void {
    this.disposed = true;
    if (this.frameId !== 0) (this.container.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frameId);
    for (const stop of this.stops) stop();
    this.resize.disconnect();
    for (const entry of this.tokens.values()) { entry.labels.dispose(); entry.piece.dispose(); }
    this.tokens.clear();
    for (const pin of this.pins) pin.dispose();
    for (const piece of this.props.values()) piece.dispose();
    this.surface?.dispose();
    for (const art of this.arts.values()) void art.then((texture) => texture?.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.tooltip.remove();
  }
}
