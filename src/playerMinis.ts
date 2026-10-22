/**
 * The minis in a joined player's view (Atlas VTT Connect's Online scene): Connect hands over, every frame, the tokens
 * with a mini, where they are drawn in the world and the bytes of each mini's GLB (sent by the GM), and lays the picture
 * returned over the scene. Drawn top-down like the GM's overlay, with an orthographic camera over the world area being
 * drawn, so a mini stands where its token is in world units. Offered to Connect as `api.playerMinis` (version 1):
 * a player sees minis only with Tabletop installed.
 */
import * as THREE from 'three';
import { MiniFigure } from './figure';
import { parseMini, type LoadedMini } from './library';

/** The longest frame a figure steps by, so a view that was hidden does not fling a mini. */
const LONGEST_STEP_S = 1 / 15;
/** The largest side of the drawing buffer, in device pixels. */
const MAX_BUFFER_PX = 4096;
const CAMERA_HEIGHT = 100_000;

/** One mini to draw this frame, as Connect hands it over. */
export interface PlayerMiniEntry {
  /** The token's id. */
  id: string;
  /** The asset id of the mini's GLB. */
  asset: string;
  /** Where the token is drawn this frame, in world units. */
  x: number;
  y: number;
  /** The token's diameter in world units. */
  size: number;
  /** The token's rotation and the mini's own turn, in degrees. */
  rotation: number;
  turn: number;
  scale: number;
}

export interface PlayerMiniArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What Connect draws a player's minis through. */
export interface PlayerMiniView {
  frame(entries: readonly PlayerMiniEntry[], models: (asset: string) => ArrayBuffer | null, area: PlayerMiniArea, pixel: number, zoom: number, elapsedMs: number): HTMLCanvasElement | null;
  shake(id: string): void;
  animating(): boolean;
  dispose(): void;
}

export interface PlayerMiniPainter {
  readonly version: 1;
  create(canvas: HTMLCanvasElement, loaded: () => void): PlayerMiniView;
}

interface Instance {
  readonly asset: string;
  readonly figure: MiniFigure;
}

class PlayerMinis implements PlayerMiniView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, CAMERA_HEIGHT * 2);
  /** Models by asset id: read once per view, null when the GLB cannot be drawn. */
  private readonly models = new Map<string, LoadedMini | null>();
  private readonly reading = new Set<string>();
  private readonly instances = new Map<string, Instance>();
  private time = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly loaded: () => void, private readonly closed: (view: PlayerMinis) => void) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    // World x is screen right and world y is screen down (+z here): the camera looks down with -z as its up.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-0.6, 1, -0.8);
    this.scene.add(sun);
  }

  shake(id: string): void {
    this.instances.get(id)?.figure.shake(this.time);
  }

  animating(): boolean {
    if (this.reading.size > 0) return true;
    for (const { figure } of this.instances.values()) if (figure.animating) return true;
    return false;
  }

  frame(entries: readonly PlayerMiniEntry[], models: (asset: string) => ArrayBuffer | null, area: PlayerMiniArea, pixel: number, zoom: number, elapsedMs: number): HTMLCanvasElement | null {
    if (this.disposed) return null;
    const dt = Math.min(LONGEST_STEP_S, Math.max(0, elapsedMs / 1000));
    this.time += dt;
    const wanted = new Set<string>();
    let shown = 0;
    for (const entry of entries) {
      wanted.add(entry.id);
      const figure = this.figureFor(entry, models);
      if (!figure) continue;
      figure.pose({
        x: entry.x, y: entry.y, worldX: entry.x, worldY: entry.y, zoom,
        size: entry.size, scale: entry.scale, turn: entry.rotation + entry.turn, dt, now: this.time,
      });
      shown++;
    }
    for (const id of [...this.instances.keys()]) if (!wanted.has(id)) this.drop(id);
    if (shown === 0 || !(area.width > 0) || !(area.height > 0)) return null;
    const scale = Math.min(1 / pixel, MAX_BUFFER_PX / area.width, MAX_BUFFER_PX / area.height);
    const width = Math.max(1, Math.round(area.width * scale));
    const height = Math.max(1, Math.round(area.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) this.renderer.setSize(width, height, false);
    this.camera.left = area.x;
    this.camera.right = area.x + area.width;
    this.camera.top = -area.y;
    this.camera.bottom = -(area.y + area.height);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    return this.canvas;
  }

  /** The token's figure, once its model is read; starts reading it when its bytes are here. */
  private figureFor(entry: PlayerMiniEntry, models: (asset: string) => ArrayBuffer | null): MiniFigure | null {
    const existing = this.instances.get(entry.id);
    if (existing?.asset === entry.asset) return existing.figure;
    if (existing) this.drop(entry.id);
    const model = this.model(entry.asset, models);
    if (!model) return null;
    const figure = new MiniFigure();
    figure.attach(model);
    this.scene.add(figure.anchor);
    this.instances.set(entry.id, { asset: entry.asset, figure });
    return figure;
  }

  private model(asset: string, models: (asset: string) => ArrayBuffer | null): LoadedMini | null {
    if (this.models.has(asset)) return this.models.get(asset) ?? null;
    if (this.reading.has(asset)) return null;
    const bytes = models(asset);
    if (!bytes) return null;
    this.reading.add(asset);
    // A copy: the bytes stay Connect's, and the loader may detach what it reads.
    void parseMini(bytes.slice(0)).then((model) => model, (error: unknown) => {
      console.warn('[Tabletop] A mini sent by the GM could not be drawn:', error);
      return null;
    }).then((model) => {
      this.reading.delete(asset);
      if (this.disposed) return;
      this.models.set(asset, model);
      this.loaded();
    });
    return null;
  }

  private drop(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;
    this.instances.delete(id);
    instance.figure.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const id of [...this.instances.keys()]) this.drop(id);
    this.models.clear();
    this.reading.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.closed(this);
  }
}

/** The painter Tabletop offers Connect, and what frees every view it made (Tabletop unloading). */
export function playerMiniPainter(): { painter: PlayerMiniPainter; dispose(): void } {
  const views = new Set<PlayerMinis>();
  const painter: PlayerMiniPainter = Object.freeze({
    version: 1 as const,
    create: (canvas: HTMLCanvasElement, loaded: () => void): PlayerMiniView => {
      const view = new PlayerMinis(canvas, loaded, (closed) => { views.delete(closed); });
      views.add(view);
      return view;
    },
  });
  return { painter, dispose: () => { for (const view of [...views]) view.dispose(); } };
}
