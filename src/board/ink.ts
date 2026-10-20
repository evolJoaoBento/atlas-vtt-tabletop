/**
 * Atlas's pen strokes (and its line, rectangle and circle drawings, which it stores and draws the same way: a line
 * through points, round at its ends and corners) as flat triangles for the board: a band along each segment and a
 * disc at every point, so the ends and corners come out round. Pure, so it is tested without a browser.
 */

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
    const a = points[i - 1]!;
    const b = points[i]!;
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
