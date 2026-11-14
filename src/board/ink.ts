/**
 * Atlas's pen strokes (and its line, rectangle and circle drawings, which it stores and draws the same way: a line
 * through points, round at its ends and corners) as flat triangles for the board: a band along each segment and a
 * disc at every point, so the ends and corners come out round. Pure, so it is tested without a browser.
 */

import * as THREE from 'three';

interface Point {
  x: number;
  y: number;
}

/** Sides of each round end and corner. */
const ROUND_SIDES = 12;

/** The triangles covering a stroke `width` wide through `points`, as x, y pairs, three per triangle. */
export function inkTriangles(points: readonly Point[], width: number): Float32Array {
  if (points.length === 0 || !(width > 0)) return new Float32Array(0);
  const half = width / 2;
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const nx = (-(b.y - a.y) / length) * half;
    const ny = ((b.x - a.x) / length) * half;
    out.push(a.x + nx, a.y + ny, b.x + nx, b.y + ny, b.x - nx, b.y - ny);
    out.push(a.x + nx, a.y + ny, b.x - nx, b.y - ny, a.x - nx, a.y - ny);
  }
  // A disc at every point rounds the ends and fills the outside of every corner.
  for (const point of points) {
    for (let side = 0; side < ROUND_SIDES; side++) {
      const from = (side / ROUND_SIDES) * Math.PI * 2;
      const to = ((side + 1) / ROUND_SIDES) * Math.PI * 2;
      out.push(point.x, point.y, point.x + Math.cos(from) * half, point.y + Math.sin(from) * half, point.x + Math.cos(to) * half, point.y + Math.sin(to) * half);
    }
  }
  return Float32Array.from(out);
}

/** A ring without its closing point (the first again). */
function openRing(points: readonly Point[]): Point[] {
  return points.length > 1 && points[0]!.x === points[points.length - 1]!.x && points[0]!.y === points[points.length - 1]!.y ? points.slice(0, -1) : [...points];
}

/** How many times `ring` winds round `point` (nonzero: inside). */
function windingNumber(ring: readonly Point[], point: Point): number {
  let wn = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const side = (b.x - a.x) * (point.y - a.y) - (point.x - a.x) * (b.y - a.y);
    if (a.y <= point.y) { if (b.y > point.y && side > 0) wn++; }
    else if (b.y <= point.y && side < 0) wn--;
  }
  return wn;
}

/**
 * Whether a closed drawing's fill covers `point` as Atlas fills it: inside its outline by the nonzero rule, and in none
 * of its holes (a hole cuts only what the outline covers).
 */
export function insideFill(point: Point, outline: readonly Point[], holes: ReadonlyArray<readonly Point[]>): boolean {
  if (windingNumber(openRing(outline), point) === 0) return false;
  return holes.every((hole) => windingNumber(openRing(hole), point) === 0);
}

/** Whether segments a-b and c-d cross (sharing an end is no crossing). */
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orient(a, b, c), d2 = orient(a, b, d), d3 = orient(c, d, a), d4 = orient(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Most corners a fill is checked for crossings at (the check is quadratic); a larger one is laid on a grid. */
const MOST_CHECKED = 2000;
/** Cells across the larger side of a fill laid on a grid. */
const GRID_CELLS = 256;

/** Whether the outline and holes are simple: no edge crosses another, and every hole lies inside the outline. */
function simpleFill(outline: readonly Point[], holes: ReadonlyArray<readonly Point[]>): boolean {
  const rings = [outline, ...holes];
  const edges: Array<[Point, Point]> = [];
  for (const ring of rings) for (let i = 0; i < ring.length; i++) edges.push([ring[i]!, ring[(i + 1) % ring.length]!]);
  if (edges.length > MOST_CHECKED) return false;
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) if (crosses(edges[i]![0], edges[i]![1], edges[j]![0], edges[j]![1])) return false;
  return holes.every((hole) => hole.every((point) => windingNumber(outline, point) !== 0));
}

/**
 * The triangles covering a closed drawing's inside as Atlas fills it (Atlas 0.16), as x, y pairs, three per triangle:
 * its outline by the nonzero rule, less its holes. A simple one is triangulated exactly; one whose edges cross (a
 * scribbled outline, a hole reaching out of it) is laid on a fine grid, a run of covered cells a row. The outline may
 * end on its first point again. Nothing for fewer than three corners.
 */
export function fillTriangles(outline: readonly Point[], holes: ReadonlyArray<readonly Point[]>): Float32Array {
  const ring = openRing(outline);
  if (ring.length < 3) return new Float32Array(0);
  const cut = holes.map(openRing).filter((hole) => hole.length >= 3);
  if (simpleFill(ring, cut)) {
    const contour = ring.map((point) => new THREE.Vector2(point.x, point.y));
    const inner = cut.map((hole) => hole.map((point) => new THREE.Vector2(point.x, point.y)));
    // The outline counter-clockwise and every hole clockwise, as the triangulation takes them.
    if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
    for (const hole of inner) if (!THREE.ShapeUtils.isClockWise(hole)) hole.reverse();
    const corners = [...contour, ...inner.flat()];
    const faces = THREE.ShapeUtils.triangulateShape(contour, inner);
    const out = new Float32Array(faces.length * 6);
    faces.forEach((face, i) => face.forEach((corner, k) => { out[i * 6 + k * 2] = corners[corner]!.x; out[i * 6 + k * 2 + 1] = corners[corner]!.y; }));
    return out;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of ring) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
  const cell = Math.max(0.5, Math.max(maxX - minX, maxY - minY) / GRID_CELLS);
  const out: number[] = [];
  for (let y = minY; y < maxY; y += cell) {
    let start: number | null = null;
    for (let x = minX; x <= maxX; x += cell) {
      const inside = x < maxX && insideFill({ x: x + cell / 2, y: y + cell / 2 }, ring, cut);
      if (inside && start === null) start = x;
      if (!inside && start !== null) {
        out.push(start, y, x, y, x, y + cell, start, y, x, y + cell, start, y + cell);
        start = null;
      }
    }
  }
  return new Float32Array(out);
}

/** The drawings `underBox` takes: a closed one with a fill. */
interface FillLike { points: readonly Point[]; holes: ReadonlyArray<readonly Point[]>; closed: boolean; fill: 'solid' | 'soft' | null; opacity: number; hidden: boolean; layer: 'above' | 'map' }

/**
 * Whether `point` lies under a box the GM covers the map with, above the tokens: a solid, opaque fill players see (not
 * one the GM hid, not one on the map's own layer, which lies under the tokens). Players see nothing of what stands there.
 */
export function underBox(inks: readonly FillLike[], point: Point): boolean {
  return inks.some((ink) => ink.closed && ink.fill === 'solid' && ink.opacity >= 0.99 && !ink.hidden && ink.layer !== 'map' && insideFill(point, ink.points, ink.holes));
}
