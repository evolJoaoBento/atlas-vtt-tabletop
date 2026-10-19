/**
 * The 3D table: Atlas's own picture of the map, laid flat on a board that the camera can tilt and turn around, with the
 * minis standing on it in 3D. Atlas keeps drawing as it always does, on its canvas, which is hidden under the table;
 * every time it draws, the picture is copied onto the board at once (Atlas's canvas keeps no picture once shown, and it
 * draws only when something changes). So the map, grid, fog, lighting and 2D tokens all come along as they are.
 *
 * Pointer input on the table is traced to the spot of the board under the pointer and handed to Atlas as if it had
 * happened there on its own canvas: tokens are moved, measured and selected as usual, and panning and zooming stay
 * Atlas's. The real events never reach Atlas (its PIXI listens on the whole document), so they are caught first, on the
 * window. Alt + drag tilts the table (up and down) and turns it (left and right).
 *
 * What it cannot do: Atlas shows only what is on its screen, so the board ends where Atlas's view ends; and Atlas's
 * own pop-ups (bars, notes) stay where they would be on the flat map, except the right-click menu, which is moved to
 * the pointer.
 */
import * as THREE from 'three';
import { pixiApp, type AtlasView, type PixiAppLike } from './atlas';

const FOV = 35;
const DEFAULT_TILT = THREE.MathUtils.degToRad(45);
const MAX_TILT = THREE.MathUtils.degToRad(72);
/** Radians per CSS pixel of an Alt-drag. */
const ORBIT_SPEED = 0.006;
const TABLE_COLOR = 0x1b1510;
const FRAME_COLOR = 0x3b2a1c;
/** The frame around the board, as a share of its larger side. */
const FRAME = 0.02;
const MENU = '.atlas-ctx-menu';
const MENU_WAIT_MS = 1500;
/** Real events on the table that Atlas must never get as they are; each is handed on as a traced one, or used here. */
const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave'] as const;
const MOUSE_EVENTS = ['contextmenu', 'dblclick'] as const;

interface Orbit { id: number; x: number; y: number; tilt: number; yaw: number }
interface Hook { app: PixiAppLike; hooked: (...args: unknown[]) => unknown; original: (...args: unknown[]) => unknown; own: boolean }

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Whether a PIXI 7 `render` call draws to the screen (not into a render texture, as Atlas's scene captures do). */
function toScreen(args: readonly unknown[]): boolean {
  const target = args[1];
  if (!isObj(target)) return true;
  if ('baseTexture' in target) return false;
  return !target.renderTexture;
}

export class Table {
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10_000);
  private readonly group = new THREE.Group();
  private readonly board: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly catcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private readonly frame: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private texture: THREE.CanvasTexture | null = null;
  private source: HTMLCanvasElement | null = null;
  private hook: Hook | null = null;
  private stops: Array<() => void> = [];
  private width = 0;
  private height = 0;
  private tilt = DEFAULT_TILT;
  private yaw = 0;
  private orbit: Orbit | null = null;
  /** Pointers pressed on the board: their moves go on to Atlas even off the board's edge. */
  private readonly pressed = new Set<number>();
  private hovering = false;

  constructor(
    private readonly view: AtlasView,
    private readonly overlay: HTMLCanvasElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly sun: THREE.DirectionalLight,
  ) {
    this.board = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.38 }));
    this.catcher.receiveShadow = true;
    this.frame = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.7 }));
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: TABLE_COLOR, roughness: 0.95 }));
    this.floor.receiveShadow = true;
    for (const mesh of [this.board, this.catcher, this.frame, this.floor]) {
      mesh.rotation.x = -Math.PI / 2;
      this.group.add(mesh);
    }
  }

  get active(): boolean {
    return this.source !== null;
  }

  /** Lays the table over Atlas's `canvas`, which it hides, and starts copying and handing on. */
  activate(canvas: HTMLCanvasElement): void {
    if (this.source === canvas) return;
    this.deactivate();
    const app = pixiApp(this.view);
    if (!app) throw new Error('Atlas\'s map renderer is not one Tabletop knows.');
    this.source = canvas;
    this.scene.add(this.group);
    this.scene.add(this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(TABLE_COLOR, 1);

    const previousOpacity = canvas.style.opacity;
    canvas.style.opacity = '0';
    this.overlay.style.pointerEvents = 'auto';
    // Atlas must not take the pointer from the table: what it captures, the table keeps.
    for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) Object.defineProperty(canvas, name, { value: () => undefined, configurable: true });
    Object.defineProperty(canvas, 'hasPointerCapture', { value: () => false, configurable: true });
    this.stops.push(() => {
      canvas.style.opacity = previousOpacity;
      this.overlay.style.pointerEvents = '';
      for (const name of ['setPointerCapture', 'releasePointerCapture', 'hasPointerCapture'] as const) delete (canvas as unknown as Record<string, unknown>)[name];
    });

    this.listen();
    this.hookRender(app);
  }

  deactivate(): void {
    if (!this.source) return;
    for (const stop of this.stops.splice(0).reverse()) {
      try {
        stop();
      } catch (error) {
        console.error('[Tabletop] Putting the flat map back failed:', error);
      }
    }
    this.unhookRender();
    this.texture?.dispose();
    this.texture = null;
    this.board.material.map = null;
    this.board.material.needsUpdate = true;
    this.scene.remove(this.group);
    this.scene.remove(this.sun.target);
    this.sun.castShadow = false;
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x000000, 0);
    this.source = null;
    this.orbit = null;
    this.pressed.clear();
    this.hovering = false;
  }

  /** Back to the starting angle. */
  reset(): void {
    this.tilt = DEFAULT_TILT;
    this.yaw = 0;
    this.place();
  }

  /** The board takes Atlas's canvas size (CSS pixels): one board unit is one pixel of Atlas's flat view. */
  layout(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const side = Math.max(width, height);
    const border = side * FRAME;
    this.board.scale.set(width, height, 1);
    this.board.position.set(width / 2, 0, height / 2);
    this.catcher.scale.set(width, height, 1);
    this.catcher.position.set(width / 2, 0.5, height / 2);
    this.frame.scale.set(width + border * 2, height + border * 2, 1);
    this.frame.position.set(width / 2, -1, height / 2);
    this.floor.scale.set(side * 30, side * 30, 1);
    this.floor.position.set(width / 2, -3, height / 2);
    const shadow = this.sun.shadow.camera;
    shadow.left = -side;
    shadow.right = side;
    shadow.top = side;
    shadow.bottom = -side;
    shadow.near = 1;
    shadow.far = side * 6;
    shadow.updateProjectionMatrix();
    this.sun.target.position.set(width / 2, 0, height / 2);
    this.sun.position.set(width / 2 - side * 0.9, side * 2.2, height / 2 - side * 1.1);
    this.place();
  }

  /**
   * Puts the camera above the board's centre: straight above it at no tilt, where the board fills the view exactly as
   * Atlas's flat map did, and leaning back towards the board's near edge as it tilts, turned about the centre by the yaw.
   */
  private place(): void {
    const { width, height } = this;
    if (width <= 0 || height <= 0) return;
    const distance = (height / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const target = new THREE.Vector3(width / 2, 0, height / 2);
    const s = Math.sin(this.tilt);
    this.camera.position.set(
      target.x + distance * s * Math.sin(this.yaw),
      distance * Math.cos(this.tilt),
      target.z + distance * s * Math.cos(this.yaw),
    );
    // Screen up is the far side of the board: at no tilt and no yaw, Atlas's own up (-z).
    this.camera.up.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.camera.aspect = width / height;
    this.camera.near = distance / 50;
    this.camera.far = distance * 40;
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  /** The spot of the board under a point of the window, in Atlas's canvas pixels; null off the board (or `clamp` to it). */
  private boardPoint(clientX: number, clientY: number, clamp: boolean): { x: number; y: number } | null {
    const rect = this.overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!hit) return null;
    const inside = hit.x >= 0 && hit.x <= this.width && hit.z >= 0 && hit.z <= this.height;
    if (!inside && !clamp) return null;
    return { x: THREE.MathUtils.clamp(hit.x, 0, this.width), y: THREE.MathUtils.clamp(hit.z, 0, this.height) };
  }

  /** Catches the real events on the table, on the window before anything else, and hands Atlas traced ones. */
  private listen(): void {
    const win = this.overlay.ownerDocument.defaultView;
    if (!win) return;
    const onPointer = (event: PointerEvent): void => {
      if (!event.isTrusted || event.target !== this.overlay) return;
      event.stopImmediatePropagation();
      this.pointer(event);
    };
    const onMouse = (event: MouseEvent): void => {
      if (!event.isTrusted || event.target !== this.overlay) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const at = this.boardPoint(event.clientX, event.clientY, false);
      if (!at) return;
      const traced = this.dispatch(event, at, (type, init) => new MouseEvent(type, init));
      if (event.type === 'contextmenu') this.followMenu(event.clientX - traced.x, event.clientY - traced.y);
    };
    const onWheel = (event: WheelEvent): void => {
      if (!event.isTrusted || event.target !== this.overlay) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      const at = this.boardPoint(event.clientX, event.clientY, false);
      if (!at) return;
      this.dispatch(event, at, (type, init) => new WheelEvent(type, { ...init, deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ, deltaMode: event.deltaMode }));
    };
    for (const type of POINTER_EVENTS) win.addEventListener(type, onPointer as EventListener, true);
    for (const type of MOUSE_EVENTS) win.addEventListener(type, onMouse as EventListener, true);
    win.addEventListener('wheel', onWheel, { capture: true, passive: false });
    this.stops.push(() => {
      for (const type of POINTER_EVENTS) win.removeEventListener(type, onPointer as EventListener, true);
      for (const type of MOUSE_EVENTS) win.removeEventListener(type, onMouse as EventListener, true);
      win.removeEventListener('wheel', onWheel, { capture: true });
    });
  }

  private pointer(event: PointerEvent): void {
    const { type } = event;
    if (type === 'pointerdown') {
      this.overlay.setPointerCapture?.(event.pointerId);
      if (event.altKey && event.button === 0) {
        this.orbit = { id: event.pointerId, x: event.clientX, y: event.clientY, tilt: this.tilt, yaw: this.yaw };
        event.preventDefault();
        return;
      }
      const at = this.boardPoint(event.clientX, event.clientY, false);
      if (!at) return;
      this.pressed.add(event.pointerId);
      this.hovering = true;
      const traced = this.dispatch(event, at, (name, init) => new PointerEvent(name, init));
      if (event.button === 2) this.followMenu(event.clientX - traced.x, event.clientY - traced.y);
      return;
    }
    if (this.orbit && this.orbit.id === event.pointerId) {
      if (type === 'pointermove') {
        this.tilt = THREE.MathUtils.clamp(this.orbit.tilt + (event.clientY - this.orbit.y) * ORBIT_SPEED, 0, MAX_TILT);
        this.yaw = this.orbit.yaw - (event.clientX - this.orbit.x) * ORBIT_SPEED;
        this.place();
      } else if (type !== 'pointerleave') {
        this.orbit = null;
      }
      return;
    }
    const held = this.pressed.has(event.pointerId);
    if (type === 'pointerleave') {
      if (!held && this.hovering) this.leave(event);
      return;
    }
    const at = this.boardPoint(event.clientX, event.clientY, held);
    if (type === 'pointerup' || type === 'pointercancel') this.pressed.delete(event.pointerId);
    if (!at) {
      if (this.hovering && !held) this.leave(event);
      return;
    }
    this.hovering = true;
    this.dispatch(event, at, (name, init) => new PointerEvent(name, init));
  }

  /** The pointer left the board: Atlas hears it left its canvas, so nothing stays hovered. */
  private leave(event: PointerEvent): void {
    this.hovering = false;
    const source = this.source;
    if (!source) return;
    source.dispatchEvent(new PointerEvent('pointerleave', { pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary, clientX: -1, clientY: -1 }));
  }

  /** Hands Atlas `event` as if it had happened at `at` on its canvas; returns where that is in the window. */
  private dispatch<E extends MouseEvent>(event: E, at: { x: number; y: number }, make: (type: string, init: PointerEventInit) => Event): { x: number; y: number } {
    const source = this.source;
    if (!source) return { x: event.clientX, y: event.clientY };
    const rect = source.getBoundingClientRect();
    const x = rect.left + at.x;
    const y = rect.top + at.y;
    const pointer = event as unknown as Partial<PointerEvent>;
    const init: PointerEventInit = {
      bubbles: event.bubbles, cancelable: event.cancelable, composed: true, view: event.view, detail: event.detail,
      clientX: x, clientY: y, screenX: event.screenX + (x - event.clientX), screenY: event.screenY + (y - event.clientY),
      button: event.button, buttons: event.buttons, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      ...(pointer.pointerId !== undefined ? {
        pointerId: pointer.pointerId, pointerType: pointer.pointerType ?? 'mouse', isPrimary: pointer.isPrimary ?? true,
        pressure: pointer.pressure ?? 0, width: pointer.width ?? 1, height: pointer.height ?? 1,
      } : {}),
    };
    const traced = make(event.type, init);
    if (!source.dispatchEvent(traced)) event.preventDefault();
    return { x, y };
  }

  /** Atlas puts its right-click menu where the traced click was: it is moved under the pointer when it appears. */
  private followMenu(dx: number, dy: number): void {
    const doc = this.overlay.ownerDocument;
    const win = doc.defaultView;
    if (!win) return;
    const move = (): boolean => {
      const menu = doc.querySelector<HTMLElement>(MENU);
      if (!menu) return false;
      const holder = menu.closest<HTMLElement>('[data-radix-popper-content-wrapper]') ?? menu;
      // `translate` adds to the `transform` the menu's own placement sets, so neither undoes the other.
      holder.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
      return true;
    };
    if (move()) return;
    const watcher = new win.MutationObserver(() => { if (move()) stop(); });
    const timer = win.setTimeout(() => stop(), MENU_WAIT_MS);
    const stop = (): void => { watcher.disconnect(); win.clearTimeout(timer); };
    watcher.observe(doc.body, { childList: true, subtree: true });
  }

  /**
   * Copies Atlas's picture onto the board each time it draws to the screen, while the picture is still there. PIXI's
   * listeners are also put back after the table's own, so the table hears the real events first.
   */
  private hookRender(app: PixiAppLike): void {
    const pixi = app.renderer as unknown as Record<string, unknown> & PixiAppLike['renderer'];
    const original = pixi.render as (...args: unknown[]) => unknown;
    const own = Object.hasOwn(pixi, 'render');
    const hooked = (...args: unknown[]): unknown => {
      const out = original.apply(pixi, args);
      if (toScreen(args)) {
        try {
          this.copy();
        } catch (error) {
          console.error('[Tabletop] Copying the map onto the table failed:', error);
        }
      }
      return out;
    };
    pixi.render = hooked;
    this.hook = { app, hooked, original, own };
    try {
      const events = pixi.events;
      if (events?.setTargetElement && events.domElement) events.setTargetElement(events.domElement);
    } catch (error) {
      console.warn('[Tabletop] Could not put Atlas\'s pointer listeners after the table\'s:', error);
    }
    // The first picture now, not at Atlas's next change.
    try {
      app.render?.();
    } catch (error) {
      console.warn('[Tabletop] Atlas could not draw the map for the table:', error);
    }
  }

  private unhookRender(): void {
    const hook = this.hook;
    this.hook = null;
    if (!hook) return;
    const pixi = hook.app.renderer as unknown as Record<string, unknown>;
    if (pixi.render !== hook.hooked) return; // someone hooked it after us: leave theirs, ours is inert without a source
    if (hook.own) pixi.render = hook.original;
    else delete pixi.render;
  }

  private copy(): void {
    const source = this.source;
    if (!source || source.width === 0 || source.height === 0) return;
    let texture = this.texture;
    if (texture && (texture.image as HTMLCanvasElement | undefined) === source && (texture.userData.size as string) !== `${source.width}x${source.height}`) {
      texture.dispose();
      texture = null;
    }
    if (!texture) {
      texture = new THREE.CanvasTexture(source);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      texture.userData.size = `${source.width}x${source.height}`;
      this.texture = texture;
      this.board.material.map = texture;
      this.board.material.needsUpdate = true;
    }
    texture.needsUpdate = true;
    // Now, while Atlas's picture is still in its canvas.
    this.renderer.initTexture(texture);
  }

  dispose(): void {
    this.deactivate();
    for (const mesh of [this.board, this.catcher, this.frame, this.floor]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
