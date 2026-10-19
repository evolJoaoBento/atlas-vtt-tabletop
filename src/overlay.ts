/**
 * The minis over one Atlas map view: a transparent WebGL canvas laid over the view's map canvas, which takes no pointer
 * input, drawn top-down with an orthographic camera in the canvas's own CSS pixels. Each frame every mini is put where
 * its token's sprite is (so it follows drags and glides), sized to the token's footprint and turned with it. A mini
 * leans away from the way it is moved and springs back upright, plays its GLB's animations (an idle clip, and a walk
 * or run clip while it moves) and wobbles when its token is clicked.
 */
import * as THREE from 'three';
import {
  gridSize, isLoaded, mapCanvas, tokenAt, tokenPixelSize, tokenSprites, viewport, type AtlasView,
} from './atlas';
import type { Assignments, MiniPlacement } from './assignments';
import { MiniFigure } from './figure';
import { Table } from './table';
import type { MiniLibrary } from './library';

/** A press that travels further than this (CSS px) or lasts longer than this is a drag, not a click. */
const CLICK_SLOP_PX = 6;
const CLICK_MS = 450;
const CAMERA_HEIGHT = 100_000;

interface Instance {
  readonly mini: string;
  readonly figure: MiniFigure;
}

export class MiniOverlay {
  private readonly win: Window;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, CAMERA_HEIGHT * 2);
  private readonly instances = new Map<string, Instance>();
  private readonly clock = new THREE.Clock();
  private frame: number | null = null;
  private disposed = false;
  private press: { id: string; x: number; y: number; at: number } | null = null;
  private readonly stops: Array<() => void> = [];
  private readonly sun: THREE.DirectionalLight;
  /** The 3D table (`table.ts`), made when first asked for. */
  private table: Table | null = null;
  private tableOn = false;

  constructor(
    private readonly view: AtlasView,
    private readonly assignments: Assignments,
    private readonly library: MiniLibrary,
    private readonly onFailed: (mini: string, error: unknown) => void,
  ) {
    const doc = view.containerEl?.ownerDocument ?? document;
    this.win = doc.defaultView ?? window;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'atlas-tabletop-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    // Screen right is +x and screen down is +z: the camera looks down with -z as its up.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun = sun;
    // From the top left of the screen, high up.
    sun.position.set(-0.6, 1, -0.8);
    this.scene.add(sun);

    const root = view.containerEl;
    if (root) {
      const down = (event: PointerEvent): void => this.pointerDown(event);
      const up = (event: PointerEvent): void => this.pointerUp(event);
      root.addEventListener('pointerdown', down, true);
      root.addEventListener('pointerup', up, true);
      this.stops.push(() => { root.removeEventListener('pointerdown', down, true); root.removeEventListener('pointerup', up, true); });
    }
    this.schedule();
  }

  get viewId(): string {
    return this.view.viewId;
  }

  /** Wobbles the mini on `tokenId`, if it has one. */
  shake(tokenId: string): void {
    this.instances.get(tokenId)?.figure.shake(this.clock.elapsedTime);
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const id = tokenAt(this.view, event.clientX, event.clientY);
    this.press = id && this.instances.has(id) ? { id, x: event.clientX, y: event.clientY, at: performance.now() } : null;
  }

  private pointerUp(event: PointerEvent): void {
    const press = this.press;
    this.press = null;
    if (!press || event.button !== 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX || performance.now() - press.at > CLICK_MS) return;
    this.shake(press.id);
  }

  private schedule(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      try {
        this.draw();
      } catch (error) {
        console.error('[Tabletop] Drawing the minis failed:', error);
      }
      this.schedule();
    });
  }

  private sync(mapPath: string, tokens: Readonly<Record<string, unknown>>): void {
    const wanted = this.assignments.forMap(mapPath);
    for (const [id, instance] of [...this.instances]) {
      const placement = wanted[id];
      if (!placement || placement.mini !== instance.mini || !Object.hasOwn(tokens, id)) this.drop(id);
    }
    for (const [id, placement] of Object.entries(wanted)) {
      if (!this.instances.has(id) && Object.hasOwn(tokens, id)) this.add(id, placement);
    }
  }

  private add(tokenId: string, placement: MiniPlacement): void {
    const figure = new MiniFigure();
    figure.hide();
    this.scene.add(figure.anchor);
    const instance: Instance = { mini: placement.mini, figure };
    this.instances.set(tokenId, instance);
    this.library.load(placement.mini).then((model) => {
      if (this.instances.get(tokenId) !== instance || this.disposed) return;
      figure.attach(model);
    }, (error: unknown) => {
      if (this.instances.get(tokenId) !== instance) return;
      this.onFailed(placement.mini, error);
    });
  }

  private drop(tokenId: string): void {
    const instance = this.instances.get(tokenId);
    if (!instance) return;
    this.instances.delete(tokenId);
    instance.figure.dispose();
  }

  /** Whether the map is shown as a 3D table. */
  get tableShown(): boolean {
    return this.tableOn;
  }

  /** Shows the map as a 3D table, or flat again. */
  setTable(on: boolean): void {
    this.tableOn = on;
    if (!on) this.table?.deactivate();
  }

  /** The table back at its starting angle. */
  resetTable(): void {
    this.table?.reset();
  }

  private hide(): void {
    // Atlas's map is never left hidden under a table that is not drawn.
    this.table?.deactivate();
    if (this.canvas.style.display !== 'none') this.canvas.style.display = 'none';
  }

  /** The table over `target`, or null when it cannot be (the notice is the caller's). */
  private tableOver(target: HTMLCanvasElement, rect: DOMRect): Table | null {
    if (!this.tableOn) {
      this.table?.deactivate();
      return null;
    }
    try {
      this.table ??= new Table(this.view, this.canvas, this.renderer, this.scene, this.sun);
      this.table.activate(target);
      this.table.layout(rect.width, rect.height);
      return this.table;
    } catch (error) {
      console.error('[Tabletop] The 3D table could not be shown:', error);
      this.tableOn = false;
      this.table?.deactivate();
      this.onTableFailed?.(error);
      return null;
    }
  }

  /** Told when the table could not be shown, and the map was put back flat. */
  onTableFailed: ((error: unknown) => void) | null = null;

  private draw(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    const now = this.clock.elapsedTime;
    const state = this.view.atlasStore.getState();
    if (!isLoaded(state) || !this.view.containerEl?.isConnected) {
      for (const id of [...this.instances.keys()]) this.drop(id);
      this.hide();
      return;
    }
    const mapPath = state.mapPath as string;
    const tokens = state.objects.tokens;
    this.sync(mapPath, tokens);
    const target = mapCanvas(this.view);
    const port = viewport(this.view);
    if ((this.instances.size === 0 && !this.tableOn) || !target || !port?.toScreen) {
      this.hide();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.hide();
      return;
    }
    this.place(target, rect);
    const table = this.tableOver(target, rect);
    const zoom = port.scale?.x && port.scale.x > 0 ? port.scale.x : 1;
    const sprites = tokenSprites(this.view);
    const grid = gridSize(this.view);
    const placements = this.assignments.forMap(mapPath);

    for (const [id, { figure }] of this.instances) {
      const token = tokens[id];
      const sprite = sprites[id];
      const placement = placements[id];
      if (!figure.ready || !token || !placement || !sprite || sprite.destroyed === true || !sprite.visible || sprite.worldVisible === false || sprite.alpha <= 0.01) {
        figure.hide();
        continue;
      }
      const at = port.toScreen(sprite.x, sprite.y);
      figure.pose({
        x: at.x, y: at.y, worldX: sprite.x, worldY: sprite.y, zoom,
        size: tokenPixelSize(grid, token.size) * zoom, scale: placement.scale, turn: (token.rotation ?? 0) + placement.turn,
        dt, now,
      });
      // A token only the GM sees is drawn faded, and so is its mini.
      figure.fade(Math.min(1, sprite.alpha));
    }
    this.renderer.render(this.scene, table?.camera ?? this.camera);
  }

  /** Lays the overlay exactly over the map canvas, at the window's pixel ratio. */
  private place(target: HTMLCanvasElement, rect: DOMRect): void {
    if (this.canvas.previousElementSibling !== target) target.after(this.canvas);
    const style = this.canvas.style;
    style.display = 'block';
    style.position = 'absolute';
    style.left = `${target.offsetLeft}px`;
    style.top = `${target.offsetTop}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    const ratio = this.win.devicePixelRatio || 1;
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== rect.width || size.y !== rect.height) this.renderer.setSize(rect.width, rect.height, false);
    if (this.camera.right !== rect.width || this.camera.bottom !== -rect.height) {
      this.camera.left = 0;
      this.camera.right = rect.width;
      this.camera.top = 0;
      this.camera.bottom = -rect.height;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.table?.dispose();
    this.table = null;
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    for (const stop of this.stops.splice(0)) stop();
    for (const id of [...this.instances.keys()]) this.drop(id);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
