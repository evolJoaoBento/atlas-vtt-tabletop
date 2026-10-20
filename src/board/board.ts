/**
 * The 3D board: an Atlas map drawn as a table, with its tokens, pins and props, a camera that moves like
 * TacticalEngine's, and the pointer and keys that drive them.
 *
 * - Left-drag on a token carries it (its mini leans and walks the way Tabletop's minis always have); on release it
 *   snaps to the grid like Atlas, glides there, and the move is saved once.
 * - Ctrl + left-drag on a prop carries the prop.
 * - A click on a pin opens its note; a right-click on a token or a prop opens its menu; a click on a token selects it
 *   (and wobbles its mini), a click on the empty board or Escape lets it go. The selected token gets Atlas's resource
 *   controls: − / + beside each bar and wheel, and a click on one opens Atlas's editor for it.
 * - Atlas's fog of war stands on the map as a see-through block, as tall as the toolbar's settings say.
 * - The local player view (a second window, for a screen the players look at) draws the same scene as players see it:
 *   no hidden tokens, nothing under the fog (which is solid), no pins, only the resources shown to players. It follows
 *   the GM's camera, live, unless the GM froze it.
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
import { formatDistance, pathLengthInCells, type Measurement } from './measure';
import { hexCenter, ringDiameter, snapPoint } from './geometry';
import { TokenLabels, type HoverTarget } from './labels';
import type { BoardMap, BoardToken } from './mapModel';
import { ResourceControls, openValueEditor, type ControlSpec, type EditorAnchor, type ScreenRect, type ValueEditor } from './resourceControls';
import { resourceUpdate, withCurrent, type ResourceValue } from './resources';
import { IconPiece, InkPiece, PinPiece, PropPiece, TextPiece, TokenPiece, type PoseContext } from './pieces';
import { numberCells, type CellNumbers } from './cellNumbers';
import { stripGeometry } from './surface';
import { ResolutionGovernor, type QualityPreset } from './quality';
import { BoardSurface } from './surface';
import { FogVolume } from './fogVolume';
import { BoardToolbar } from './toolbar';
import { pinTitle } from './pinIcons';
import { NO_INSTANCE_NUMBERS, badgeNumberInView, insideFog, numberTokensInView, playerSees } from './playerView';
import { positionOf } from './camera';
import { loadImageTexture, plateTexture, screenScale } from './textures';

/** Obsidian's accent colour, for highlights; Atlas's purple outside Obsidian. */
function accent(element: HTMLElement): string {
  const value = element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue('--interactive-accent').trim();
  return value || ACCENT;
}

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
  /** Saves a copy of a token (Alt + drag) under `newId` at (x, y). */
  copyToken(id: string, newId: string, x: number, y: number): void;
  /**
   * Saves a resource edited from the token's controls: `edit` turns the value held now (by Atlas, or in the file) into
   * the new one, so quick steps add up; `maxEdited` says the maximum was set by hand.
   */
  editResource(id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): void;
  /** How distances are measured and labelled on this map. */
  measurement(): Measurement;
  /** How tall the map's fog stands, in grid squares; and saving a new height. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** Shown once per message. */
  warn(message: string): void;
  /** Opens or closes the local player view of this map; whether it is open. */
  togglePlayerView(): void;
  playerViewOpen(): boolean;
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
/** The hovered cell's label height on screen, in pixels. */
const CELL_LABEL_PX = 20;
const ACCENT = '#7c5cff';
/** How often a playing clip redraws the shadows, in seconds. */
const CLIP_SHADOW_STEP = 1 / 15;
/** Room left around the map when it is framed, for the tilt's perspective. */
const FRAME_MARGIN = 1.1;

interface TokenEntry {
  token: BoardToken;
  piece: TokenPiece;
  labels: TokenLabels;
  /** What the players' picture shows over the token, drawn only in that picture's pass. */
  playerLabels: TokenLabels;
  /** Where it is drawn, and where it is heading. */
  at: { x: number; y: number };
  goal: { x: number; y: number };
  mini: string | null;
}

/** The local player view's own drawing of the scene, in its window. */
interface PlayerScreen {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  view: THREE.PerspectiveCamera;
  resize: ResizeObserver;
  /** Where the GM froze the players' camera; null while it follows the GM's. */
  frozen: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; yaw: number; distance: number } | null;
  /** Its shadows are drawn on its next frame (it just opened, or it was resized). */
  shadowsDirty: boolean;
}

/** The cell under the pointer: where it is and what it is called. */
interface HoveredCell {
  key: string;
  label: string;
  center: { x: number; y: number };
}

type Press =
  | {
    kind: 'camera'; button: number; x: number; y: number; lastX: number; lastY: number; moved: boolean;
    token: string | null; prop: string | null; pin: string | null;
    /** The spot of the board a pan holds under the pointer. */
    grab: { x: number; y: number } | null;
  }
  | {
    kind: 'token'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number };
    /** Alt was held: the drop makes a copy and the token goes back. */
    copy: boolean;
    /** The ruler: where the drag began (snapped), and the waypoints Space dropped. */
    start: { x: number; y: number };
    waypoints: Array<{ x: number; y: number }>;
  }
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
  private icons: IconPiece[] = [];
  private texts: TextPiece[] = [];
  private inks: InkPiece[] = [];
  /** The grid's numbered cells, and the cell under the pointer with its highlight and label. */
  private cells: CellNumbers = { at: () => null };
  hoveredCell: string | null = null;
  private cellOutline: THREE.Mesh | null = null;
  private cellLabel: THREE.Sprite | null = null;
  private cellLabelAspect = 1;
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
  private ruler: THREE.Group | null = null;
  /** The ruler being shown: its points (start, waypoints, landing) and its label. */
  rulerState: { points: Array<{ x: number; y: number }>; label: string } | null = null;
  /** The token whose resource controls show. */
  private selectedId: string | null = null;
  private readonly controls: ResourceControls;
  private readonly fog = new FogVolume();
  private readonly toolbar: BoardToolbar;
  private player: PlayerScreen | null = null;
  /** Copy numbers as players see them, kept from sync to sync so a token keeps its number. */
  private playerNumbers = NO_INSTANCE_NUMBERS;
  /** The window whose animation frame is asked for: the GM's, or the players' while the GM's is hidden. */
  private frameWin: Window | null = null;
  /** The open resource editor: whose, which resource, the value it opened on. */
  private editor: { tokenId: string; key: string; value: ResourceValue; view: ValueEditor } | null = null;
  /** How the last frame sized things on screen, to size what a reload rebuilds before the next frame. */
  private lastPose: PoseContext | null = null;
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
    this.scene.add(this.fog.object3d);
    this.toolbar = new BoardToolbar(container, {
      fogHeight: () => this.host.fogHeight(),
      setFogHeight: (height) => this.host.setFogHeight(height),
      playerViewOpen: () => this.host.playerViewOpen(),
      togglePlayerView: () => this.host.togglePlayerView(),
      playerFrozen: () => this.player?.frozen != null,
      togglePlayerFreeze: () => this.setPlayerFrozen(this.player?.frozen == null),
    });
    this.controls = new ResourceControls(container, {
      step: (key, delta) => this.stepResource(key, delta),
      edit: (key) => this.openEditor(key),
    });

    // The fast card where the browser lets a page ask (a Mac with two); on Windows, Tabletop's graphics card setting.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
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
    this.showCell(null);
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
    this.cells = numberCells(map.grid, width, height);
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
    try {
      this.fog.update(map.fog, this.host.fogHeight(), map.grid.size);
    } catch (error) {
      this.host.warn(`Tabletop: cannot show this map's fog of war: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Players count copies among the tokens they see, ordered by the GM's numbers (Atlas's player window).
    this.playerNumbers = numberTokensInView(this.playerNumbers, map.tokens
      .filter((token) => playerSees(token, this.tokens.get(token.id)?.goal ?? token, this.fog.areas))
      .map((token) => ({ id: token.id, art: token.imagePath ?? '', rank: token.instanceNumber ?? Infinity })));
    const artUse = new Map<string, number>();
    for (const token of map.tokens) if (token.imagePath) artUse.set(token.imagePath, (artUse.get(token.imagePath) ?? 0) + 1);
    const seen = new Set<string>();
    for (const token of map.tokens) {
      seen.add(token.id);
      const shared = (artUse.get(token.imagePath ?? '') ?? 0) >= 2;
      const gmLook = { viewer: 'gm' as const, badge: map.tokenSettings.showInstanceBadges && shared ? token.instanceNumber : null };
      const playerLook = { viewer: 'player' as const, badge: badgeNumberInView(this.playerNumbers, token.id, map.tokenSettings.showInstanceBadges) };
      let entry = this.tokens.get(token.id);
      if (!entry) {
        const piece = new TokenPiece(token, map.grid, rules.definitions);
        piece.setMiniShadows(this.quality.miniShadows);
        const labels = new TokenLabels(token, map.tokenSettings, rules, gmLook);
        const playerLabels = new TokenLabels(token, map.tokenSettings, rules, playerLook);
        playerLabels.object3d.visible = false;
        piece.object3d.add(labels.object3d, playerLabels.object3d);
        this.scene.add(piece.object3d);
        entry = { token, piece, labels, playerLabels, at: { x: token.x, y: token.y }, goal: { x: token.x, y: token.y }, mini: null };
        this.tokens.set(token.id, entry);
      } else {
        entry.piece.update(token, rules.definitions);
        entry.labels.update(token, map.tokenSettings, rules, gmLook);
        entry.playerLabels.update(token, map.tokenSettings, rules, playerLook);
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
      entry.playerLabels.dispose();
      entry.piece.dispose();
      this.tokens.delete(id);
    }
    if (this.selectedId !== null && !this.tokens.has(this.selectedId)) this.select(null);
    // An editor whose value changed under it (Atlas, another tab) would apply its change to a stale value.
    const editing = this.editor;
    if (editing) {
      const now = this.tokens.get(editing.tokenId)?.token.resources[editing.key];
      if (!now || now.current !== editing.value.current || now.max !== editing.value.max) editing.view.close();
    }

    // Icons are kept across reloads when nothing about them changed: each one loads its glyph, so a rebuilt one
    // would blink out.
    const iconKey = (icon: BoardMap['icons'][number]): string => JSON.stringify(icon);
    const kept = new Map(this.icons.map((piece) => [iconKey(piece.icon), piece]));
    this.icons = map.icons.map((icon) => {
      const old = kept.get(iconKey(icon));
      if (old) {
        kept.delete(iconKey(icon));
        return old;
      }
      const piece = new IconPiece(icon, () => this.wake(true));
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of kept.values()) piece.dispose();

    // Pen strokes, kept when they and their place in the order are unchanged.
    const inkKey = (ink: BoardMap['inks'][number], order: number): string => `${order}|${JSON.stringify(ink)}`;
    const keptInks = new Map(this.inks.map((piece, order) => [inkKey(piece.ink, order), piece]));
    this.inks = map.inks.map((ink, order) => {
      const old = keptInks.get(inkKey(ink, order));
      if (old) {
        keptInks.delete(inkKey(ink, order));
        return old;
      }
      const piece = new InkPiece(ink, order);
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of keptInks.values()) piece.dispose();

    // Text labels, kept like the icons when nothing about them changed: each one paints its letters.
    const textKey = (text: BoardMap['texts'][number]): string => JSON.stringify(text);
    const keptTexts = new Map(this.texts.map((piece) => [textKey(piece.label), piece]));
    this.texts = map.texts.map((text) => {
      const old = keptTexts.get(textKey(text));
      if (old) {
        keptTexts.delete(textKey(text));
        return old;
      }
      const piece = new TextPiece(text);
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of keptTexts.values()) piece.dispose();

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
    // What was rebuilt is sized on screen now: an unsized sprite fills the view for a press made before the next frame.
    const pose = this.lastPose;
    if (pose) {
      for (const pin of this.pins) pin.pose(pose);
      for (const entry of this.tokens.values()) {
        entry.labels.place(entry.piece.figureHeight(), ringDiameter(map.grid, entry.token.size) / 2, entry.piece.top);
        entry.labels.pose(pose);
        entry.playerLabels.place(entry.piece.figureHeight(), ringDiameter(map.grid, entry.token.size) / 2, entry.piece.top);
      }
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
    // A hidden window gets no animation frames: while the GM's is hidden, the players' window drives the drawing.
    const gm = this.container.ownerDocument;
    const players = this.player?.container.ownerDocument;
    const win = (gm.hidden && players && !players.hidden ? players.defaultView : gm.defaultView) ?? window;
    this.frameWin = win;
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
    this.lastPose = context;
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
      entry.playerLabels.place(entry.piece.figureHeight(), ringDiameter(this.map!.grid, entry.token.size) / 2, entry.piece.top);
      if (entry.piece.animating) {
        busy = true;
        changed = true;
      }
    }
    for (const pin of this.pins) pin.pose(context);
    this.ruler?.traverse((node) => {
      if (!(node as THREE.Sprite).isSprite) return;
      const aspect = (node.userData.aspect as number | undefined) ?? 1;
      node.scale.set(context.pixel * 22 * aspect, context.pixel * 22, 1);
    });
    if (this.cellLabel) this.cellLabel.scale.set(context.pixel * CELL_LABEL_PX * this.cellLabelAspect, context.pixel * CELL_LABEL_PX, 1);
    // A mini's clip alone redraws the shadows a few times a second, not every frame.
    const clipsOnly = changed && !this.shadowsDirty && this.press === null && !moving;
    const shadows = changed && (!clipsOnly || this.clock - this.shadowedAt >= CLIP_SHADOW_STEP);
    if (shadows) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowedAt = this.clock;
    }
    this.shadowsDirty = false;
    this.renderer.render(this.scene, this.view);
    this.layoutControls();
    this.drawPlayers(shadows, context);
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
    // Rays use the world matrices of the last frame drawn: what a reload rebuilt since would still sit at the origin.
    for (const object of objects) object.updateWorldMatrix(true, false);
    const hits = this.raycaster.intersectObjects(objects, false);
    return (hits[0]?.object as T | undefined) ?? null;
  }

  /** The token under the pointer: its figure, or anything drawn over it (name, bars, wheels). */
  private tokenAt(clientX: number, clientY: number): string | null {
    const owners = new Map<THREE.Object3D, string>();
    for (const entry of this.tokens.values()) {
      owners.set(entry.piece.hitTarget, entry.token.id);
      for (const sprite of entry.labels.sprites) owners.set(sprite, entry.token.id);
    }
    const hit = this.hit(clientX, clientY, [...owners.keys()]);
    return hit ? owners.get(hit) ?? null : null;
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
    on('pointerleave', () => { this.tooltip.hidden = true; this.showCell(null); });
    on('wheel', (event) => {
      event.preventDefault();
      this.camera.zoom(Math.exp(event.deltaY * WHEEL));
      this.wake();
    }, { passive: false });
    on('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (key === 'escape' && this.placing) { this.stopPlacing(); return; }
      if (key === 'escape' && this.selectedId !== null) { this.select(null); return; }
      if (key === 'escape' && this.toolbar.isOpen) { this.toolbar.close(); return; }
      if (key === 'home') { this.frameMap(); event.preventDefault(); return; }
      // Space while carrying a token drops a waypoint on its ruler.
      if (key === ' ' && this.press?.kind === 'token') {
        event.preventDefault();
        if (!event.repeat) this.addWaypoint();
        return;
      }
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
        this.press = {
          kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y },
          copy: event.altKey, start: snapPoint(this.map!.grid, entry.token.x, entry.token.y), waypoints: [],
        };
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
      this.drawRuler();
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
      this.clearRuler();
      const entry = this.tokens.get(press.id);
      if (!entry) return;
      entry.piece.carried = false;
      if (press.moved && press.copy) {
        this.copyToken(entry, snapPoint(this.map!.grid, entry.at.x, entry.at.y));
        return;
      }
      if (!press.moved) {
        this.select(press.id);
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
    if (press.button === 0 && !press.pin) this.select(null);
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
      this.clearRuler();
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

  /** The cell under a point: its number (when the map numbers its cells) and the note a hex-linked pin gives it. */
  private cellAt(x: number, y: number): HoveredCell | null {
    const map = this.map;
    if (!map || !map.grid.enabled) return null;
    const cell = this.cells.at(x, y);
    const hex = map.grid.type !== 'square';
    const center = cell?.center ?? (hex ? hexCenter(map.grid, x, y) : null);
    if (!center) return null;
    const linked = hex ? map.pins.find((pin) => {
      if (!pin.hex || !pin.notePath) return false;
      const at = hexCenter(map.grid, pin.x, pin.y);
      return Math.hypot(at.x - center.x, at.y - center.y) < 1;
    }) : undefined;
    const label = [cell?.label ?? '', linked ? pinTitle(linked) : ''].filter(Boolean).join(' · ');
    if (!label) return null;
    return { key: `${center.x.toFixed(1)},${center.y.toFixed(1)}|${label}`, label, center };
  }

  /** Outlines the hovered cell and floats its number (and linked note) over it; null clears it. */
  private showCell(cell: HoveredCell | null): void {
    if (cell && this.cellOutline?.userData.key === cell.key) return;
    if (!cell && !this.cellOutline) return;
    if (this.cellOutline) {
      this.cellOutline.removeFromParent();
      this.cellOutline.geometry.dispose();
      (this.cellOutline.material as THREE.Material).dispose();
      this.cellOutline = null;
    }
    if (this.cellLabel) {
      this.cellLabel.removeFromParent();
      this.cellLabel.material.map?.dispose();
      this.cellLabel.material.dispose();
      this.cellLabel = null;
    }
    this.hoveredCell = cell?.label ?? null;
    const map = this.map;
    if (!cell || !map) { this.wake(); return; }
    const grid = map.grid;
    const corners: Array<{ x: number; y: number }> = [];
    if (grid.type === 'square') {
      const h = grid.size / 2;
      corners.push({ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h });
    } else {
      const radius = grid.size / Math.sqrt(3);
      const start = grid.type === 'hex-vertical' ? -Math.PI / 2 : 0;
      for (let i = 0; i < 6; i++) corners.push({ x: radius * Math.cos(start + (Math.PI / 3) * i), y: radius * Math.sin(start + (Math.PI / 3) * i) });
    }
    const segments: number[] = [];
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % corners.length]!;
      segments.push(cell.center.x + corner.x, cell.center.y + corner.y, cell.center.x + next.x, cell.center.y + next.y);
    });
    this.cellOutline = new THREE.Mesh(stripGeometry(segments, grid.size * 0.04), new THREE.MeshBasicMaterial({ color: accent(this.container), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.cellOutline.userData.key = cell.key;
    this.cellOutline.position.y = 0.3;
    this.scene.add(this.cellOutline);
    const plate = plateTexture(cell.label, 22);
    this.cellLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false, opacity: grid.numberOpacity }));
    this.cellLabel.renderOrder = 30;
    this.cellLabelAspect = plate.width / plate.height;
    this.cellLabel.center.set(0.5, 0);
    this.cellLabel.position.set(cell.center.x, grid.size * 0.1, cell.center.y - grid.size * 0.37);
    this.scene.add(this.cellLabel);
    this.wake();
  }

  /** The carried token's ruler path: start, waypoints, and where it would land now. */
  private rulerPoints(): Array<{ x: number; y: number }> | null {
    const press = this.press;
    if (press?.kind !== 'token' || !this.map) return null;
    const entry = this.tokens.get(press.id);
    if (!entry) return null;
    const landing = snapPoint(this.map.grid, entry.at.x, entry.at.y);
    const points = [press.start, ...press.waypoints];
    const last = points[points.length - 1]!;
    if (Math.hypot(landing.x - last.x, landing.y - last.y) > 0.5) points.push(landing);
    return points.length > 1 ? points : null;
  }

  private addWaypoint(): void {
    const press = this.press;
    if (press?.kind !== 'token' || !this.map) return;
    const entry = this.tokens.get(press.id);
    if (!entry) return;
    const landing = snapPoint(this.map.grid, entry.at.x, entry.at.y);
    const last = press.waypoints[press.waypoints.length - 1] ?? press.start;
    if (Math.hypot(landing.x - last.x, landing.y - last.y) <= 0.5) return;
    press.waypoints.push(landing);
    this.drawRuler();
  }

  private clearRuler(): void {
    if (this.ruler) {
      this.ruler.traverse((node) => {
        const object = node as THREE.Mesh | THREE.Sprite;
        if (!('material' in object) || !object.material) return;
        (object as THREE.Mesh).geometry?.dispose();
        const material = object.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      });
      this.ruler.removeFromParent();
      this.ruler = null;
    }
    this.rulerState = null;
  }

  /** Atlas's drag ruler: the path in the accent colour over a dark edge, dots at the start and waypoints, the distance at its middle. */
  private drawRuler(): void {
    const points = this.rulerPoints();
    const map = this.map;
    // Pointer moves inside one cell change nothing: the path runs between cell centres.
    if (points && this.ruler && JSON.stringify(points) === JSON.stringify(this.rulerState?.points)) return;
    this.clearRuler();
    if (!points || !map) { this.wake(); return; }
    const measurement = this.host.measurement();
    const label = formatDistance(pathLengthInCells(points, map.grid, measurement.diagonalRule), measurement);
    this.rulerState = { points, label };
    const group = new THREE.Group();
    group.position.y = 1.2;
    const segments: number[] = [];
    for (let i = 1; i < points.length; i++) segments.push(points[i - 1]!.x, points[i - 1]!.y, points[i]!.x, points[i]!.y);
    const color = accent(this.container);
    const edge = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.09), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    const line = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    line.position.y = 0.2;
    group.add(edge, line);
    for (const point of points.slice(0, -1)) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(map.grid.size * 0.11, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      dot.position.set(point.x, 0.4, point.y);
      group.add(dot);
    }
    // The label sits halfway along the path.
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    let rest = total / 2;
    let middle = points[0]!;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (rest <= length) {
        const t = length === 0 ? 0 : rest / length;
        middle = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        break;
      }
      rest -= length;
    }
    const plate = plateTexture(label, 24);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false }));
    tag.renderOrder = 40;
    tag.center.set(0.5, -0.3);
    tag.position.set(middle.x, map.grid.size * 0.2, middle.y);
    tag.userData.aspect = plate.width / plate.height;
    group.add(tag);
    this.ruler = group;
    this.scene.add(group);
    this.wake();
  }

  /** Alt + drag let go: the token goes back, and a copy (shown at once) is saved where it was dropped. */
  private copyToken(entry: TokenEntry, at: { x: number; y: number }): void {
    const map = this.map!;
    entry.goal = { x: entry.token.x, y: entry.token.y };
    entry.at = { ...entry.goal };
    const newId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const taken = new Set(map.tokens.filter((token) => token.imagePath === entry.token.imagePath).map((token) => token.instanceNumber));
    let instance = 1;
    while (taken.has(instance)) instance++;
    map.tokens = [...map.tokens, { ...entry.token, id: newId, x: at.x, y: at.y, instanceNumber: instance }];
    this.sync();
    this.host.copyToken(entry.token.id, newId, at.x, at.y);
  }

  // ── The local player view ─────────────────────────────────────────────────

  /** Draws the scene in the local player view's window too, from now on; `container` is that window's board area. */
  attachPlayer(container: HTMLElement): void {
    this.detachPlayer();
    const doc = container.ownerDocument;
    const win = doc.defaultView ?? window;
    const canvas = doc.createElement('canvas');
    canvas.className = 'atlas-tabletop-player-board';
    container.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // Its own screen: that window may sit on another monitor.
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, this.quality.maxPixelRatio));
    const view = new THREE.PerspectiveCamera(FOV, 1, this.view.near, this.view.far);
    const resize = new win.ResizeObserver(() => {
      const player = this.player;
      if (!player) return;
      player.renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
      player.shadowsDirty = true;
      this.wake();
    });
    resize.observe(container);
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
    this.player = { container, canvas, renderer, view, resize, frozen: null, shadowsDirty: true };
    this.toolbar.refresh();
    this.wake(true);
  }

  /** Stops drawing in the local player view's window (it closed, or shows another board). */
  detachPlayer(): void {
    const player = this.player;
    if (!player) return;
    this.player = null;
    player.resize.disconnect();
    player.renderer.dispose();
    player.renderer.forceContextLoss();
    player.canvas.remove();
    this.toolbar.refresh();
  }

  /** The player view opened or closed somewhere: the toolbar's buttons follow. */
  refreshToolbar(): void {
    this.toolbar.refresh();
  }

  /** Whether the players' camera is frozen where the GM froze it. */
  get playerFrozen(): boolean {
    return this.player?.frozen != null;
  }

  /** Freezes the players' camera where the GM's is now, or lets it follow the GM's again. */
  setPlayerFrozen(frozen: boolean): void {
    const player = this.player;
    if (!player) return;
    const pose = this.camera.pose;
    player.frozen = frozen ? { eye: positionOf(pose), target: { ...pose.target }, yaw: pose.yaw, distance: pose.distance } : null;
    this.toolbar.refresh();
    this.wake();
  }

  /**
   * Shows the scene as `viewer` sees it, for the next drawing: the GM everything; players no hidden token, nothing
   * whose centre is under the fog (tokens, Tabletop's props), no pins or cell highlight, the solid fog and their own
   * labels.
   */
  private showFor(viewer: 'gm' | 'player'): void {
    const gm = viewer === 'gm';
    const fog = this.fog.areas;
    for (const entry of this.tokens.values()) {
      entry.piece.object3d.visible = gm || playerSees(entry.token, entry.at, fog);
      entry.labels.object3d.visible = gm;
      entry.playerLabels.object3d.visible = !gm;
    }
    for (const pin of this.pins) pin.object3d.visible = gm;
    for (const piece of this.props.values()) piece.object3d.visible = gm || !insideFog(fog, { x: piece.object3d.position.x, y: piece.object3d.position.z });
    if (this.cellOutline) this.cellOutline.visible = gm;
    if (this.cellLabel) this.cellLabel.visible = gm;
    this.fog.show(viewer);
  }

  /** The players' picture, after the GM's: the same scene through the players' camera, then back to the GM's look. */
  private drawPlayers(shadows: boolean, gm: PoseContext): void {
    const player = this.player;
    if (!player) return;
    const height = player.container.clientHeight;
    const width = player.container.clientWidth;
    if (width === 0 || height === 0) return;
    const pose = this.camera.pose;
    const frozen = player.frozen;
    const eye = frozen?.eye ?? this.camera.position();
    const target = frozen?.target ?? pose.target;
    player.view.position.set(eye.x, eye.y, eye.z);
    player.view.lookAt(target.x, target.y, target.z);
    player.view.aspect = width / height;
    player.view.near = this.view.near;
    player.view.far = this.view.far;
    player.view.updateProjectionMatrix();
    player.view.updateMatrixWorld();
    const distance = frozen?.distance ?? pose.distance;
    const context: PoseContext = {
      ...gm,
      yaw: frozen?.yaw ?? pose.yaw,
      zoom: height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)),
      pixel: screenScale(1, height, FOV),
    };
    this.showFor('player');
    try {
      for (const entry of this.tokens.values()) entry.playerLabels.pose(context);
      player.renderer.shadowMap.needsUpdate = shadows || player.shadowsDirty;
      player.shadowsDirty = false;
      player.renderer.render(this.scene, player.view);
    } catch (error) {
      console.error('[Tabletop] The player view could not be drawn:', error);
    } finally {
      // Whatever happened, the GM's board goes back to the GM's look.
      this.showFor('gm');
    }
  }

  /** The token whose resource controls show, or null. */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Selects a token (null lets it go): it gets the resource controls; an editor open on another closes. */
  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    if (this.editor && this.editor.tokenId !== id) this.editor.view.close();
    this.wake();
  }

  /**
   * Shows a token's change at once, before the map file catches up: `token` replaces it, null takes it away. Used for
   * the token menu's Kill and Delete.
   */
  changeToken(id: string, token: BoardToken | null): void {
    const map = this.map;
    if (!map) return;
    map.tokens = token ? map.tokens.map((other) => (other.id === id ? token : other)) : map.tokens.filter((other) => other.id !== id);
    this.sync();
  }

  /** The screen rectangle of a resource drawn on a token, in pixels from the board's top left. */
  private screenRect(sprite: THREE.Sprite, width: number, height: number): ScreenRect | null {
    const at = sprite.getWorldPosition(new THREE.Vector3()).project(this.view);
    if (at.z > 1 || at.z < -1) return null;
    const x = ((at.x + 1) / 2) * this.canvas.clientWidth;
    const y = ((1 - at.y) / 2) * this.canvas.clientHeight;
    // A sprite's centre is its anchor, as a share of its size from its bottom left.
    const left = x - sprite.center.x * width;
    const bottom = y + sprite.center.y * height;
    return { left, top: bottom - height, width, height };
  }

  /** Lays the selected token's controls on its resources, and keeps an open editor under its resource. */
  private layoutControls(): void {
    const entry = this.selectedId !== null ? this.tokens.get(this.selectedId) : undefined;
    const carried = this.press?.kind === 'token' && this.press.id === this.selectedId && this.press.moved;
    if (!entry || carried) {
      this.controls.hide();
      return;
    }
    const specs: ControlSpec[] = [];
    for (const target of entry.labels.resourceTargets) {
      // A static value does not change in play: its number is set in Atlas's Edit Token.
      if (target.definition.direction === 'static') continue;
      const rect = this.screenRect(target.object, target.width, target.height);
      if (!rect) continue;
      specs.push({ key: target.definition.key, kind: target.kind, side: target.side, rect, color: target.definition.color });
    }
    this.controls.layout(specs);
    const editing = this.editor;
    if (editing) {
      const spec = specs.find((candidate) => candidate.key === editing.key);
      if (spec) editing.view.reposition(this.anchorOf(spec.rect));
    }
  }

  private anchorOf(rect: ScreenRect): EditorAnchor {
    const canvas = this.canvas.getBoundingClientRect();
    return { x: canvas.left + rect.left + rect.width / 2, top: canvas.top + rect.top, bottom: canvas.top + rect.top + rect.height };
  }

  /** Shows a resource's new value on the selected token at once; the map file (or Atlas) catches up. */
  private showResource(id: string, key: string, next: ResourceValue, maxEdited: boolean): void {
    const entry = this.tokens.get(id);
    if (!entry) return;
    this.changeToken(id, { ...entry.token, ...resourceUpdate(entry.token, key, next, maxEdited) } as BoardToken);
  }

  /** − / +: one point down or up, as Atlas steps it. */
  private stepResource(key: string, delta: number): void {
    const id = this.selectedId;
    const value = id !== null ? this.tokens.get(id)?.token.resources[key] : undefined;
    if (id === null || !value) return;
    const next = withCurrent(value, value.current + delta);
    if (next.current === value.current) return;
    this.showResource(id, key, next, false);
    this.host.editResource(id, key, (stored) => withCurrent(stored, stored.current + delta), false);
  }

  /** Opens Atlas's editor under one of the selected token's resources. */
  private openEditor(key: string): void {
    const id = this.selectedId;
    const entry = id !== null ? this.tokens.get(id) : undefined;
    const target = entry?.labels.resourceTargets.find((candidate) => candidate.definition.key === key);
    const value = entry?.token.resources[key];
    if (id === null || !target || !value) return;
    this.editor?.view.close();
    const rect = this.screenRect(target.object, target.width, target.height);
    if (!rect) return;
    this.controls.setActive(key);
    const view = openValueEditor({
      doc: this.container.ownerDocument,
      anchor: this.anchorOf(rect),
      value,
      label: target.definition.name,
      onCommit: (next) => {
        if (next.current === value.current && next.max === value.max) return;
        const maxEdited = next.max !== value.max;
        this.showResource(id, key, next, maxEdited);
        this.host.editResource(id, key, () => next, maxEdited);
      },
      onClose: () => {
        if (this.editor?.view === view) this.editor = null;
        this.controls.setActive(null);
        this.wake();
      },
    });
    this.editor = { tokenId: id, key, value, view };
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
    const point = this.boardPoint(event.clientX, event.clientY);
    const inside = point !== null && point.x >= 0 && point.y >= 0 && point.x <= this.size.width && point.y <= this.size.height;
    this.showCell(inside ? this.cellAt(point.x, point.y) : null);
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
    if (this.frameId !== 0) (this.frameWin ?? this.container.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frameId);
    this.detachPlayer();
    for (const stop of this.stops) stop();
    this.resize.disconnect();
    for (const entry of this.tokens.values()) { entry.labels.dispose(); entry.playerLabels.dispose(); entry.piece.dispose(); }
    this.tokens.clear();
    for (const pin of this.pins) pin.dispose();
    for (const icon of this.icons) icon.dispose();
    for (const text of this.texts) text.dispose();
    for (const ink of this.inks) ink.dispose();
    this.showCell(null);
    this.clearRuler();
    this.editor?.view.close();
    this.controls.dispose();
    this.toolbar.dispose();
    this.fog.dispose();
    for (const piece of this.props.values()) piece.dispose();
    this.surface?.dispose();
    for (const art of this.arts.values()) void art.then((texture) => texture?.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.tooltip.remove();
  }
}
