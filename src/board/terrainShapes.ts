/**
 * Raised shapes on a level (roofs, hills, irregular ground): an outline of corners drawn on the level's plane, and
 * corners inside it, each at its own height. The surface is spread between them as triangles: the outline cut into
 * triangles as drawn (a concave outline keeps its notches), the inner corners set in, then edges turned until the
 * triangles are as even as the outline allows (Delaunay). Atlas has no heights for its level surfaces, so these are
 * Tabletop's own board data, kept per map with the level they stand on. Pure (but for building the mesh), so it is
 * tested without a board.
 */
import * as THREE from 'three';

/** A corner, in the map image's pixels, and its height above the level's floor in grid squares. */
export interface ShapePoint {
  readonly x: number;
  readonly y: number;
  readonly h: number;
}

export interface TerrainShape {
  readonly id: string;
  /** The scene level it stands on (Atlas levels); unset is the first, as for Atlas's own objects. */
  readonly level?: string;
  /** The corners round it, in the order drawn. */
  readonly outline: readonly ShapePoint[];
  /** Corners inside it (a roof's ridge, a hill's top). */
  readonly inner: readonly ShapePoint[];
  /** Vault folder of a material (Tabletop's Materials) it is painted with; unset wears the level's map image from above. */
  readonly material?: string;
}

type Tri = [number, number, number];

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Corners as saved: { x, y, h }, or [x, y, h] triples (short to write by hand); a missing height is the floor. */
function readPoints(raw: unknown): ShapePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ShapePoint[] = [];
  for (const entry of raw) {
    const [x, y, h] = Array.isArray(entry) ? entry : isObj(entry) ? [entry.x, entry.y, entry.h] : [];
    if (num(x) && num(y) && (h === undefined || num(h))) out.push({ x, y, h: h ?? 0 });
  }
  return out;
}

/** Saved shapes, tolerantly: corners that are not numbers go, and a shape with fewer than three outline corners. */
export function readShapes(raw: unknown): TerrainShape[] {
  if (!Array.isArray(raw)) return [];
  const out: TerrainShape[] = [];
  for (const entry of raw) {
    if (!isObj(entry) || typeof entry.id !== 'string' || entry.id === '') continue;
    const outline = readPoints(entry.outline);
    if (outline.length < 3) continue;
    out.push({
      id: entry.id,
      ...(typeof entry.level === 'string' && entry.level !== '' && { level: entry.level }),
      outline,
      inner: readPoints(entry.inner),
      ...(typeof entry.material === 'string' && entry.material !== '' && { material: entry.material }),
    });
  }
  return out;
}

/** Whether (x, y) is inside the outline (even-odd). */
export function pointInOutline(outline: readonly { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i], b = outline[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

const cross = (a: ShapePoint, b: ShapePoint, c: ShapePoint): number => (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);

/** Barycentric weights of (x, y) in the triangle; null for a flat one. */
function weights(a: ShapePoint, b: ShapePoint, c: ShapePoint, x: number, y: number): [number, number, number] | null {
  const d = cross(a, b, c);
  if (Math.abs(d) < 1e-9) return null;
  const p = { x, y, h: 0 };
  return [cross(p, b, c) / d, cross(a, p, c) / d, cross(a, b, p) / d];
}

/** Whether d lies inside the circle through a, b, c (any winding). */
function inCircle(a: ShapePoint, b: ShapePoint, c: ShapePoint, d: ShapePoint): boolean {
  const ax = a.x - d.x, ay = a.y - d.y, bx = b.x - d.x, by = b.y - d.y, cx = c.x - d.x, cy = c.y - d.y;
  const det = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return cross(a, b, c) > 0 ? det > 1e-9 : det < -1e-9;
}

const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * The shape's triangles, as indices into its outline followed by its inner corners. The outline is cut exactly as
 * drawn; inner corners outside it (or on top of another corner) are left out.
 */
export function shapeTriangles(shape: TerrainShape): Tri[] {
  const outline = shape.outline;
  if (outline.length < 3) return [];
  const points: ShapePoint[] = [...outline, ...shape.inner];
  const contour = outline.map((p) => new THREE.Vector2(p.x, p.y));
  const tris: Tri[] = THREE.ShapeUtils.triangulateShape(contour, []).map(([a, b, c]) => [a, b, c] as Tri);
  // Every triangle the same way round (counter-clockwise in the map's x/y), so the flips below can compare.
  for (const t of tris) if (cross(points[t[0]], points[t[1]], points[t[2]]) < 0) [t[1], t[2]] = [t[2], t[1]];
  const fixed = new Set(outline.map((_, i) => edgeKey(i, (i + 1) % outline.length)));

  for (let k = 0; k < shape.inner.length; k++) {
    const index = outline.length + k, p = points[index];
    if (points.some((q, i) => i !== index && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6 && i < index)) continue;
    const at = tris.findIndex(([a, b, c]) => { const w = weights(points[a], points[b], points[c], p.x, p.y); return w !== null && w.every((v) => v >= -1e-9); });
    if (at < 0) continue;
    const [a, b, c] = tris[at];
    const w = weights(points[a], points[b], points[c], p.x, p.y)!;
    const onEdge = w.findIndex((v) => Math.abs(v) < 1e-9);
    if (onEdge < 0) {
      tris.splice(at, 1, [a, b, index], [b, c, index], [c, a, index]);
      continue;
    }
    // On an edge: the edge facing the zero weight is split, with the triangle across it if there is one.
    const [u, v, o] = onEdge === 0 ? [b, c, a] : onEdge === 1 ? [c, a, b] : [a, b, c];
    tris.splice(at, 1, [o, u, index], [v, o, index]);
    const across = tris.findIndex((t) => t.includes(u) && t.includes(v));
    if (across >= 0) {
      const t = tris[across], far = t.find((i) => i !== u && i !== v)!;
      tris.splice(across, 1, [u, far, index], [far, v, index]);
    }
    if (fixed.has(edgeKey(u, v))) { fixed.delete(edgeKey(u, v)); fixed.add(edgeKey(u, index)); fixed.add(edgeKey(index, v)); }
  }
  for (const t of tris) if (cross(points[t[0]], points[t[1]], points[t[2]]) < 0) [t[1], t[2]] = [t[2], t[1]];

  // Lawson's flips: an inner edge whose far corner lies inside the other triangle's circle is turned.
  for (let round = 0, flipped = true; flipped && round < 64; round++) {
    flipped = false;
    for (let i = 0; i < tris.length; i++) {
      for (let e = 0; e < 3; e++) {
        const a = tris[i][e], b = tris[i][(e + 1) % 3], c = tris[i][(e + 2) % 3];
        if (fixed.has(edgeKey(a, b))) continue;
        const j = tris.findIndex((t, n) => n !== i && t.includes(a) && t.includes(b));
        if (j < 0) continue;
        const d = tris[j].find((v) => v !== a && v !== b)!;
        if (!inCircle(points[a], points[b], points[c], points[d])) continue;
        // Only a convex pair can be turned: both new triangles must keep their winding.
        if (cross(points[c], points[a], points[d]) <= 1e-9 || cross(points[c], points[d], points[b]) <= 1e-9) continue;
        tris[i] = [c, a, d];
        tris[j] = [c, d, b];
        flipped = true;
      }
    }
  }
  return tris;
}

/** The surface's height at (x, y), in grid squares; null outside the shape. */
export function shapeHeightAt(shape: TerrainShape, x: number, y: number): number | null {
  const points = [...shape.outline, ...shape.inner];
  for (const [a, b, c] of shapeTriangles(shape)) {
    const w = weights(points[a], points[b], points[c], x, y);
    if (w && w.every((v) => v >= -1e-9)) return w[0] * points[a].h + w[1] * points[b].h + w[2] * points[c].h;
  }
  return null;
}

/**
 * The shape's mesh geometry, in the board's world (x and z the map's pixels, y up): `cell` world units to a grid
 * square. Its UVs lay the map image (`width` by `height` pixels) on it from straight above, so a roof painted on the
 * map rises as that roof; a material's texture repeats once a square (`tiled`).
 */
export function shapeGeometry(shape: TerrainShape, cell: number, width: number, height: number, tiled = false): THREE.BufferGeometry {
  const points = [...shape.outline, ...shape.inner];
  const tris = shapeTriangles(shape);
  const position = new Float32Array(tris.length * 9);
  const uv = new Float32Array(tris.length * 6);
  let n = 0;
  for (const tri of tris) {
    // Wound to face up (map y runs along +z: counter-clockwise in x/y is clockwise seen from above).
    for (const i of [tri[0], tri[2], tri[1]]) {
      const p = points[i];
      position.set([p.x, p.h * cell, p.y], n * 3);
      uv.set(tiled ? [p.x / cell, -p.y / cell] : [p.x / width, 1 - p.y / height], n * 2);
      n++;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

/** One corner of a shape: of its outline, or of its inner corners. */
export interface PointRef {
  readonly list: 'outline' | 'inner';
  readonly index: number;
}

export function pointOf(shape: TerrainShape, ref: PointRef): ShapePoint | null {
  return shape[ref.list][ref.index] ?? null;
}

/** The shape with one corner changed (moved, raised). */
export function withPoint(shape: TerrainShape, ref: PointRef, change: Partial<ShapePoint>): TerrainShape {
  const list = shape[ref.list];
  if (!list[ref.index]) return shape;
  return { ...shape, [ref.list]: list.map((p, i) => (i === ref.index ? { ...p, ...change } : p)) };
}

/** The shape without one corner. */
export function withoutPoint(shape: TerrainShape, ref: PointRef): TerrainShape {
  return { ...shape, [ref.list]: shape[ref.list].filter((_, i) => i !== ref.index) };
}

/** The shape with a corner added: to its outline (after the last one drawn), or inside it. */
export function withAdded(shape: TerrainShape, list: PointRef['list'], point: ShapePoint): TerrainShape {
  return { ...shape, [list]: [...shape[list], point] };
}
