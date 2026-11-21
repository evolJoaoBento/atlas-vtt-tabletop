/**
 * What the fog tool shows on the ground while a shape is under way and until the fog volume holds it: the shape as a
 * translucent flat sheet over the map (white where it adds fog, red where it erases), drawn into a canvas the size of the map
 * (scaled down for a large one) so that overlapping strokes never darken each other. A brush stroke is drawn a segment at a
 * time; the other shapes (stage 2: rectangle, polygon, lasso, cells, room) draw their polygons whole with `polygons`.
 */
import * as THREE from 'three';

interface Point {
  x: number;
  y: number;
}

/** The longest side of the canvas, in pixels: a larger map is drawn smaller. */
const MAX_SIDE = 2048;
/** Just over the map, under the brush ring. */
const HEIGHT = 0.4;
const PAINT = '#ffffff';
const ERASE = '#ff4444';
/** How strong the sheet lies on the map: as fog, and as Atlas's wash over what a shape will reveal (`FogRevealWash`). */
const SHEET_ALPHA = 0.45;
const WASH_ALPHA = 0.28;

export class FogPreview {
  private mesh: THREE.Mesh | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private scale = 1;
  private size = { width: 0, height: 0 };
  private washed = false;

  constructor(private readonly parent: THREE.Object3D, private readonly makeCanvas: () => HTMLCanvasElement) {}

  /** The sheet is on the map. */
  get shown(): boolean {
    return this.mesh?.visible === true;
  }

  /** Starts a new, empty sheet over a map of `width` by `height` pixels. */
  begin(width: number, height: number, erasing: boolean): void {
    if (!(width > 0) || !(height > 0)) return;
    if (!this.mesh || this.size.width !== width || this.size.height !== height) this.make(width, height);
    this.context?.clearRect(0, 0, this.canvas!.width, this.canvas!.height);
    this.setErasing(erasing);
    if (this.mesh) this.mesh.visible = true;
    this.touch();
  }

  /** The sheet turns red (an erasing shape) or white (one that adds fog). */
  setErasing(erasing: boolean): void {
    (this.mesh?.material as THREE.MeshBasicMaterial | undefined)?.color.set(erasing ? ERASE : PAINT);
  }

  /** An erasing shape that is no brush shows as Atlas's wash: a light red over the ground it takes the fog from. */
  setWash(wash: boolean): void {
    const material = this.mesh?.material as THREE.MeshBasicMaterial | undefined;
    if (material) material.opacity = wash ? WASH_ALPHA : SHEET_ALPHA;
    this.washed = wash;
  }

  get wash(): boolean { return this.washed; }

  /** Draws the part of a brush stroke from `from` to `to` (the same point for a tap) with a round brush of `radius`. */
  brush(from: Point, to: Point, radius: number): void {
    const context = this.context;
    if (!context || !this.mesh?.visible) return;
    const s = this.scale;
    context.strokeStyle = '#ffffff';
    context.fillStyle = '#ffffff';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1, radius * 2 * s);
    context.beginPath();
    context.moveTo(from.x * s, from.y * s);
    context.lineTo(to.x * s, to.y * s);
    context.stroke();
    if (from.x === to.x && from.y === to.y) {
      context.beginPath();
      context.arc(to.x * s, to.y * s, Math.max(0.5, radius * s), 0, Math.PI * 2);
      context.fill();
    }
    this.touch();
  }

  /** Draws the sheet again as `polygons` (each filled, holes by the even-odd rule): for the shapes that are not a brush. */
  polygons(polygons: ReadonlyArray<ReadonlyArray<Point>>): void {
    const context = this.context;
    if (!context || !this.canvas || !this.mesh?.visible) return;
    const s = this.scale;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.fillStyle = '#ffffff';
    context.beginPath();
    for (const polygon of polygons) {
      polygon.forEach((point, index) => (index === 0 ? context.moveTo(point.x * s, point.y * s) : context.lineTo(point.x * s, point.y * s)));
      context.closePath();
    }
    context.fill('evenodd');
    this.touch();
  }

  /** Takes the sheet off the map. */
  clear(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  dispose(): void {
    if (this.mesh) {
      this.parent.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
    }
    this.texture?.dispose();
    this.mesh = null;
    this.texture = null;
    this.canvas = null;
    this.context = null;
  }

  private make(width: number, height: number): void {
    this.dispose();
    this.size = { width, height };
    this.scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = this.makeCanvas();
    canvas.width = Math.max(1, Math.round(width * this.scale));
    canvas.height = Math.max(1, Math.round(height * this.scale));
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: this.washed ? WASH_ALPHA : SHEET_ALPHA, depthTest: false, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(width / 2, HEIGHT, height / 2);
    this.mesh.renderOrder = 19;
    this.mesh.raycast = () => {};
    this.mesh.name = 'fog-preview';
    this.parent.add(this.mesh);
  }

  private touch(): void {
    if (this.texture) this.texture.needsUpdate = true;
  }
}
