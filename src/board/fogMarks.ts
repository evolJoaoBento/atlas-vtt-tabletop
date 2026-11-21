/**
 * The lines the fog tool marks the ground with while a shape is under way (Atlas 0.18's `fogMarkLines.ts`, `FogPolygon`'s
 * outline, `fogOutlines.ts` and `FogSnapGuide.ts`): a light line (red where it reveals) over a dark one, both as wide on
 * screen at any camera distance, drawn as flat triangles on the ground like the brush's ring; the polygon's corners; and
 * the guide that shows what a point snapped to. Flat meshes with depth test off, render order 20 to 22.
 */
import * as THREE from 'three';
import type { FogMarks, FogPoint } from './fogGesture';
import type { FogGuideMark } from './fogSnapping';

/** Screen pixels, as Atlas's `FOG_MARK`, `CORNER`, `FogSnapGuide`. */
export const MARK_LINE = { width: 2, casing: 4, alpha: 0.6, casingAlpha: 0.4, faintAlpha: 0.3 } as const;
export const MARK_CORNER = { radius: 3, first: 5.5 } as const;
export const GUIDE = { ring: 5, ringWidth: 2, ringHalo: 4.5, lineWidth: 1.5, lineHalo: 3.5, haloAlpha: 0.45 } as const;
const PAINT = 0xffffff;
const ERASE = 0xff4444;
const HEIGHT = 0.45;
/** Past this many points a path gets no round joins (a long lasso). */
const JOINS_UNTIL = 300;

export interface StrokedPath {
  points: readonly FogPoint[];
  closed: boolean;
  width: number;
}

/** Triangles (x, z pairs on the ground, three corners each, flat array) of `paths` stroked `width` map units wide, with round joins on short paths. */
export function strokeTriangles(paths: readonly StrokedPath[]): number[] {
  const out: number[] = [];
  const quad = (ax: number, ay: number, bx: number, by: number, half: number): void => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return;
    const nx = (-dy / length) * half;
    const ny = (dx / length) * half;
    out.push(ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, bx + nx, by + ny, ax - nx, ay - ny, bx - nx, by - ny);
  };
  for (const { points, closed, width } of paths) {
    const half = width / 2;
    const n = points.length;
    for (let i = 0; i + 1 < n; i += 1) quad(points[i]!.x, points[i]!.y, points[i + 1]!.x, points[i + 1]!.y, half);
    if (closed && n > 2) quad(points[n - 1]!.x, points[n - 1]!.y, points[0]!.x, points[0]!.y, half);
    if (n <= JOINS_UNTIL) for (const point of points) disc(out, point, half, 8);
  }
  return out;
}

/** Triangles of a disc of `radius` at `at`. */
export function disc(out: number[], at: FogPoint, radius: number, sides = 16): void {
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2;
    const b = ((i + 1) / sides) * Math.PI * 2;
    out.push(at.x, at.y, at.x + Math.cos(a) * radius, at.y + Math.sin(a) * radius, at.x + Math.cos(b) * radius, at.y + Math.sin(b) * radius);
  }
}

/** A circle as a closed path of `sides` corners. */
export function circlePath(at: FogPoint, radius: number, sides = 24): FogPoint[] {
  return Array.from({ length: sides }, (_, i) => ({ x: at.x + Math.cos((i / sides) * Math.PI * 2) * radius, y: at.y + Math.sin((i / sides) * Math.PI * 2) * radius }));
}

/** One flat layer: a mesh of triangles in one colour and opacity. */
class Layer {
  readonly mesh: THREE.Mesh;

  constructor(parent: THREE.Object3D, name: string, order: number) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.renderOrder = order;
    this.mesh.raycast = () => {};
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  /** Shows `triangles` (x, y of the map; the ground's z) in `color` at `alpha`; none hides the layer. */
  set(triangles: number[], color: THREE.ColorRepresentation, alpha: number): void {
    if (triangles.length === 0) { this.mesh.visible = false; return; }
    const positions = new Float32Array((triangles.length / 2) * 3);
    for (let i = 0, j = 0; i < triangles.length; i += 2, j += 3) { positions[j] = triangles[i]!; positions[j + 1] = HEIGHT; positions[j + 2] = triangles[i + 1]!; }
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.BufferGeometry();
    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.color.set(color);
    material.opacity = alpha;
    this.mesh.visible = true;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class FogMarksView {
  private readonly casing: Layer;
  private readonly line: Layer;
  private readonly faint: Layer;
  private readonly dotCasing: Layer;
  private readonly dots: Layer;
  private readonly guideHalo: Layer;
  private readonly guideLine: Layer;
  private marks: FogMarks | null = null;
  private guideMark: FogGuideMark | null = null;
  private color: number = PAINT;
  /** Map units per screen pixel the layers were last built for. */
  private built = 0;

  constructor(private readonly parent: THREE.Object3D, private readonly accent: () => THREE.ColorRepresentation) {
    this.casing = new Layer(parent, 'fog-mark-casing', 20);
    this.line = new Layer(parent, 'fog-mark-line', 21);
    this.faint = new Layer(parent, 'fog-mark-faint', 21);
    this.dotCasing = new Layer(parent, 'fog-mark-dot-casing', 21);
    this.dots = new Layer(parent, 'fog-mark-dots', 22);
    this.guideHalo = new Layer(parent, 'fog-guide-halo', 22);
    this.guideLine = new Layer(parent, 'fog-guide', 23);
  }

  /** Which layers show, for tests: names of the visible ones. */
  get shown(): string[] {
    return [this.casing, this.line, this.faint, this.dotCasing, this.dots, this.guideHalo, this.guideLine].filter((layer) => layer.mesh.visible).map((layer) => layer.mesh.name);
  }

  get guide(): FogGuideMark | null { return this.guideMark; }
  get current(): FogMarks | null { return this.marks; }
  get lineColor(): number { return (this.line.mesh.material as THREE.MeshBasicMaterial).color.getHex(); }

  /** Sets what the marks show (null: nothing) and the colour of the tool's lines. */
  setMarks(marks: FogMarks | null, erasing: boolean, px: number): void {
    this.marks = marks;
    this.color = erasing ? ERASE : PAINT;
    this.rebuild(px);
  }

  setGuide(mark: FogGuideMark | null, px: number): void {
    this.guideMark = mark;
    this.rebuild(px);
  }

  /** The camera moved: the lines keep their width on screen. */
  frame(px: number): void {
    if (!(px > 0) || (this.marks === null && this.guideMark === null)) return;
    if (Math.abs(px - this.built) / Math.max(px, this.built || px) > 0.005) this.rebuild(px);
  }

  clear(): void {
    this.marks = null;
    this.guideMark = null;
    for (const layer of [this.casing, this.line, this.faint, this.dotCasing, this.dots, this.guideHalo, this.guideLine]) layer.mesh.visible = false;
  }

  dispose(): void {
    for (const layer of [this.casing, this.line, this.faint, this.dotCasing, this.dots, this.guideHalo, this.guideLine]) layer.dispose(this.parent);
  }

  private rebuild(px: number): void {
    if (!(px > 0) || !Number.isFinite(px)) return;
    this.built = px;
    this.buildMarks(px);
    this.buildGuide(px);
  }

  private buildMarks(px: number): void {
    const marks = this.marks;
    if (!marks) { for (const layer of [this.casing, this.line, this.faint, this.dotCasing, this.dots]) layer.set([], 0, 0); return; }
    const color: THREE.ColorRepresentation = marks.accent ? this.accent() : this.color;
    const paths = marks.paths.map((path) => ({ ...path }));
    // The first corner of a polygon is ringed (the corner a click closes it on).
    const ring = marks.ring ? [circlePath(marks.ring, MARK_CORNER.first * px)] : [];
    const stroked = (width: number): StrokedPath[] => [...paths.map((path) => ({ points: path.points, closed: path.closed, width })), ...ring.map((points) => ({ points, closed: true, width }))];
    this.casing.set(strokeTriangles(stroked(MARK_LINE.casing * px)), 0x000000, MARK_LINE.casingAlpha);
    const alpha = marks.paths.find((path) => path.alpha !== undefined)?.alpha ?? MARK_LINE.alpha;
    this.line.set(strokeTriangles(stroked(MARK_LINE.width * px)), color, alpha);
    this.faint.set(marks.faint ? strokeTriangles(marks.faint.map((pair) => ({ points: pair, closed: false, width: MARK_LINE.width * px }))) : [], color, MARK_LINE.faintAlpha);
    const dotCasing: number[] = [];
    const dots: number[] = [];
    for (const point of marks.dots ?? []) { disc(dotCasing, point, (MARK_CORNER.radius + 1) * px); disc(dots, point, MARK_CORNER.radius * px); }
    this.dotCasing.set(dotCasing, 0x000000, MARK_LINE.casingAlpha);
    this.dots.set(dots, color, 1);
  }

  private buildGuide(px: number): void {
    const mark = this.guideMark;
    if (!mark) { this.guideHalo.set([], 0, 0); this.guideLine.set([], 0, 0); return; }
    const ring = circlePath(mark.point, GUIDE.ring * px);
    const line = mark.from && mark.to ? [mark.from, mark.to] : null;
    const paths = (ringWidth: number, lineWidth: number): StrokedPath[] => [{ points: ring, closed: true, width: ringWidth * px }, ...(line ? [{ points: line, closed: false, width: lineWidth * px }] : [])];
    this.guideHalo.set(strokeTriangles(paths(GUIDE.ringHalo, GUIDE.lineHalo)), 0x000000, GUIDE.haloAlpha);
    this.guideLine.set(strokeTriangles(paths(GUIDE.ringWidth, GUIDE.lineWidth)), this.accent(), 1);
  }
}
