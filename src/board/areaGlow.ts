/**
 * A light that glows from a whole surface (Atlas's `LightSource.area`: lava, acid) as a few point lamps: spots spread
 * over the area, as few as cover it, each reaching as far as the light does past the part of the area it stands for.
 * Pure: `lightRig.ts` hangs the lamps.
 */

type Point = { x: number; y: number };

/** Even-odd: whether a point lies inside a ring. */
export function insideRing(ring: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** How many candidate places across the area's longer side the spots are chosen from. */
const STEPS = 24;

/**
 * Up to `most` spots spread over `area` (farthest first from those chosen: the first near its middle), and `spread`:
 * the farthest any part of the area lies from its nearest spot, in the area's units. Spots are added only while the
 * spread is more than `enough` (a lamp's own reach covers that much). Empty for an area with no inside.
 */
export function areaSpots(area: readonly Point[], most: number, enough: number): { spots: Point[]; spread: number } {
  if (area.length < 3 || most < 1) return { spots: [], spread: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of area) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const step = Math.max(x1 - x0, y1 - y0) / STEPS;
  if (!(step > 0)) return { spots: [], spread: 0 };
  const inside: Point[] = [];
  for (let y = y0 + step / 2; y < y1; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (insideRing(area, x, y)) inside.push({ x, y });
  if (inside.length === 0) return { spots: [], spread: 0 };
  // The first spot: the inside place nearest the middle of all of them.
  const mx = inside.reduce((sum, p) => sum + p.x, 0) / inside.length, my = inside.reduce((sum, p) => sum + p.y, 0) / inside.length;
  let first = inside[0]!;
  for (const p of inside) if (Math.hypot(p.x - mx, p.y - my) < Math.hypot(first.x - mx, first.y - my)) first = p;
  const spots = [first];
  const near = inside.map((p) => Math.hypot(p.x - first.x, p.y - first.y));
  const farthest = (): number => near.reduce((best, d, k) => (d > near[best]! ? k : best), 0);
  while (spots.length < most) {
    const k = farthest();
    if (near[k]! <= enough) break;
    const spot = inside[k]!;
    spots.push(spot);
    inside.forEach((p, i) => { near[i] = Math.min(near[i]!, Math.hypot(p.x - spot.x, p.y - spot.y)); });
  }
  // The area reaches half a step past the places it was sampled at.
  return { spots, spread: near[farthest()]! + step * 0.71 };
}
