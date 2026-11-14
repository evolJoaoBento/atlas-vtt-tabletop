/**
 * What stops sight on the 3D board, by Atlas's rules (its dynamic lighting's `computeVisibility`): a shut door, a secret
 * door or a solid wall stops it, an open door does not, glass (a wall that stops only light) does not, a curtain does, a
 * one-way wall stops it only for a viewer on its marked side, and a limited wall (a hedge, a low wall) lets sight through
 * the first one it meets and stops it at the second. What players see is Atlas's own answer (`atlasSight.ts`); these
 * are for a spell's hits and drawing (`spells.ts`, `spellView.ts`). Pure.
 */
import type { BoardWall, Point } from './walls';

/** How a wall treats sight coming from a viewer: stops it, lets it through, or (a limited wall) lets one through. */
type Effect = 'stops' | 'passes' | 'limited';

export function effectOn(wall: BoardWall, viewer: Point): Effect {
  if (wall.type !== 'solid' && !wall.closed) return 'passes';
  if (wall.blocks === 'light' || wall.blocks === 'movement') return 'passes';
  if (wall.direction !== null) {
    // The side of p1 -> p2 the viewer is on, by the normal (-dy, dx) of the wall: positive is its left.
    const side = -(wall.p2.y - wall.p1.y) * (viewer.x - wall.p1.x) + (wall.p2.x - wall.p1.x) * (viewer.y - wall.p1.y);
    const viewerOnLeft = side > 0;
    if ((wall.direction === 'left') !== viewerOnLeft) return 'passes';
  }
  return wall.limited ? 'limited' : 'stops';
}

const EPSILON = 1e-9;

/** Whether the segments a-b and c-d meet, touching included (a ray grazing the corner where two walls join must not slip through). */
function meets(a: Point, b: Point, c: Point, d: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (((o1 > EPSILON && o2 < -EPSILON) || (o1 < -EPSILON && o2 > EPSILON)) && ((o3 > EPSILON && o4 < -EPSILON) || (o3 < -EPSILON && o4 > EPSILON))) return true;
  const within = (p: Point, q: Point, r: Point): boolean => Math.min(p.x, q.x) - EPSILON <= r.x && r.x <= Math.max(p.x, q.x) + EPSILON && Math.min(p.y, q.y) - EPSILON <= r.y && r.y <= Math.max(p.y, q.y) + EPSILON;
  return (Math.abs(o1) <= EPSILON && within(a, b, c)) || (Math.abs(o2) <= EPSILON && within(a, b, d)) || (Math.abs(o3) <= EPSILON && within(c, d, a)) || (Math.abs(o4) <= EPSILON && within(c, d, b));
}

/** Whether sight from `from` reaches `to` past `walls`. */
export function canSee(from: Point, to: Point, walls: readonly BoardWall[]): boolean {
  let limited = 0;
  for (const wall of walls) {
    const effect = effectOn(wall, from);
    if (effect === 'passes' || !meets(from, to, wall.p1, wall.p2)) continue;
    if (effect === 'stops') return false;
    limited += 1;
    if (limited >= 2) return false;
  }
  return true;
}

const RAY_NUDGE = 1e-5;

/**
 * Everything in sight from `origin` as one polygon (an angular sweep: a ray to each end of every wall that stops sight,
 * and a hair either side of it, each cut off at the first wall it meets), inside `bounds`. Only what stops sight outright
 * counts: a limited wall (which lets one through) is treated as open here, and a one-way wall stops sight only from its
 * marked side. Points come in order round the origin.
 */
export function visibilityPolygon(origin: Point, walls: readonly BoardWall[], bounds: { x0: number; y0: number; x1: number; y1: number }): Point[] {
  const edges: Array<[Point, Point]> = [];
  for (const wall of walls) if (effectOn(wall, origin) === 'stops') edges.push([wall.p1, wall.p2]);
  const { x0, y0, x1, y1 } = bounds;
  edges.push([{ x: x0, y: y0 }, { x: x1, y: y0 }], [{ x: x1, y: y0 }, { x: x1, y: y1 }], [{ x: x1, y: y1 }, { x: x0, y: y1 }], [{ x: x0, y: y1 }, { x: x0, y: y0 }]);
  const angles: number[] = [];
  for (const [a, b] of edges) {
    for (const end of [a, b]) {
      const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
      angles.push(angle - RAY_NUDGE, angle, angle + RAY_NUDGE);
    }
  }
  angles.sort((p, q) => p - q);
  const points: Point[] = [];
  for (const angle of angles) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let nearest = Infinity;
    for (const [a, b] of edges) {
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-12) continue;
      const ox = a.x - origin.x;
      const oy = a.y - origin.y;
      const along = (ox * ey - oy * ex) / denominator;
      const across = (ox * dy - oy * dx) / denominator;
      if (along >= 0 && across >= -1e-9 && across <= 1 + 1e-9 && along < nearest) nearest = along;
    }
    if (Number.isFinite(nearest)) points.push({ x: origin.x + dx * nearest, y: origin.y + dy * nearest });
  }
  return points;
}
