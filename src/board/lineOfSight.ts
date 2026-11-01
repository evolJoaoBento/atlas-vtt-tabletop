/**
 * Line of sight on the 3D board, by Atlas's rules for what stops sight (its dynamic lighting's `computeVisibility`): a
 * shut door, a secret door or a solid wall stops it, an open door does not, glass (a wall that stops only light) does not,
 * a curtain does, a one-way wall stops it only for a viewer on its marked side, and a limited wall (a hedge, a low wall)
 * lets sight through the first one it meets and stops it at the second. The tokens that see (vision on) are the viewers;
 * a piece stands in sight when any viewer has an unstopped line to its centre. Pieces are tested one by one against
 * the walls, so the cost is viewers x pieces x walls, redone only when something that decides it moved. Pure.
 */
import type { BoardWall, Point } from './walls';

/** Where the setting applies: nowhere, the players' view only, or the GM's board as well. */
export type SightMode = 'off' | 'players' | 'everyone';
export const DEFAULT_SIGHT_MODE: SightMode = 'off';

export function readSightMode(value: unknown): SightMode {
  return value === 'off' || value === 'players' || value === 'everyone' ? value : DEFAULT_SIGHT_MODE;
}

/** How a wall treats sight coming from a viewer: stops it, lets it through, or (a limited wall) lets one through. */
type Effect = 'stops' | 'passes' | 'limited';

function effectOn(wall: BoardWall, viewer: Point): Effect {
  if (wall.type !== 'solid' && !wall.closed) return 'passes';
  if (wall.blocks === 'light') return 'passes';
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

export interface SightPiece {
  /** A key of the caller's, returned in the set when the piece is in sight. */
  key: string;
  at: Point;
}

/**
 * The keys of the pieces some viewer sees. Without a viewer, sight cannot be judged and every piece counts as seen
 * (the setting does nothing in a scene where no token sees).
 */
export function inSight(viewers: readonly Point[], pieces: readonly SightPiece[], walls: readonly BoardWall[]): Set<string> {
  if (viewers.length === 0) return new Set(pieces.map((piece) => piece.key));
  // Only walls that could stop anything matter: an open door and glass never do.
  const stopping = walls.filter((wall) => !(wall.type !== 'solid' && !wall.closed) && wall.blocks !== 'light');
  const seen = new Set<string>();
  for (const piece of pieces) {
    if (viewers.some((viewer) => canSee(viewer, piece.at, stopping))) seen.add(piece.key);
  }
  return seen;
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

/** The grid squares the board is tiled by: `cols` by `rows`, `size` across, the first starting at (startX, startY) (at or before the map's corner). */
export interface SightTiles {
  cols: number;
  rows: number;
  size: number;
  startX: number;
  startY: number;
}

/** Tiles a map of `width` x `height` by a grid of squares `size` across whose lines start at `offsetX`, `offsetY`. */
export function tilesFor(width: number, height: number, size: number, offsetX: number, offsetY: number): SightTiles {
  const step = size > 0 ? size : 70;
  const start = (offset: number): number => ((offset % step) - step) % step;
  const startX = start(offsetX);
  const startY = start(offsetY);
  return { cols: Math.max(1, Math.ceil((width - startX) / step)), rows: Math.max(1, Math.ceil((height - startY) / step)), size: step, startX, startY };
}

/** Which squares have their centre inside any of the polygons (1 seen, 0 not), row by row; a square a viewer stands on counts as seen. */
export function seenTiles(polygons: readonly Point[][], viewers: readonly Point[], tiles: SightTiles): Uint8Array {
  const seen = new Uint8Array(tiles.cols * tiles.rows);
  const { cols, rows, size, startX, startY } = tiles;
  for (const polygon of polygons) {
    const n = polygon.length;
    if (n < 3) continue;
    for (let row = 0; row < rows; row++) {
      const y = startY + (row + 0.5) * size;
      const crossings: number[] = [];
      for (let i = 0; i < n; i++) {
        const p = polygon[i]!;
        const q = polygon[(i + 1) % n]!;
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y)) crossings.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil((crossings[k]! - startX) / size - 0.5));
        const to = Math.min(cols - 1, Math.floor((crossings[k + 1]! - startX) / size - 0.5));
        for (let col = from; col <= to; col++) seen[row * cols + col] = 1;
      }
    }
  }
  for (const viewer of viewers) {
    const col = Math.floor((viewer.x - startX) / size);
    const row = Math.floor((viewer.y - startY) / size);
    if (col >= 0 && col < cols && row >= 0 && row < rows) seen[row * cols + col] = 1;
  }
  return seen;
}

/** How sight is judged: by rays from each viewer (a cone through a doorway), or the cinematic way, by whole rooms. */
export type SightStyle = 'rays' | 'cinematic';
export const DEFAULT_SIGHT_STYLE: SightStyle = 'rays';

export function readSightStyle(value: unknown): SightStyle {
  return value === 'cinematic' ? 'cinematic' : DEFAULT_SIGHT_STYLE;
}

/**
 * The cinematic way: a viewer sees the whole space it is connected to, and nothing else. The board's squares are
 * connected to their neighbours unless a wall that stops sight lies between their centres, so a viewer in a sealed
 * room sees that room alone (not what is behind its walls, but all of it, wherever it stands in it); once a door of the
 * room is open the room is joined to the outside and the viewer sees all of that, except every other sealed building,
 * which stays black as one piece until a door of its own is opened. Marks 1 for seen squares, row by row.
 */
export function connectedTiles(viewers: readonly Point[], walls: readonly BoardWall[], tiles: SightTiles): Uint8Array {
  const { cols, rows, size, startX, startY } = tiles;
  const seen = new Uint8Array(cols * rows);
  const centre = (col: number, row: number): Point => ({ x: startX + (col + 0.5) * size, y: startY + (row + 0.5) * size });
  const cellOf = (point: Point): number => {
    const col = Math.floor((point.x - startX) / size);
    const row = Math.floor((point.y - startY) / size);
    return col >= 0 && col < cols && row >= 0 && row < rows ? row * cols + col : -1;
  };
  // The walls that could stop anything, by the squares they pass through.
  const buckets = new Map<number, BoardWall[]>();
  for (const wall of walls) {
    if ((wall.type !== 'solid' && !wall.closed) || wall.blocks === 'light') continue;
    const length = Math.hypot(wall.p2.x - wall.p1.x, wall.p2.y - wall.p1.y);
    const steps = Math.max(1, Math.ceil(length / (size / 4)));
    const touched = new Set<number>();
    for (let i = 0; i <= steps; i++) {
      const cell = cellOf({ x: wall.p1.x + ((wall.p2.x - wall.p1.x) * i) / steps, y: wall.p1.y + ((wall.p2.y - wall.p1.y) * i) / steps });
      if (cell >= 0) touched.add(cell);
    }
    for (const cell of touched) {
      const list = buckets.get(cell);
      if (list) list.push(wall);
      else buckets.set(cell, [wall]);
    }
  }
  // Squares are joined when any of three lines across their shared edge (its middle and a quarter either side) is clear, so a
  // door that does not sit on the squares' own lines, or ends at a square's middle, still opens the way.
  const blocked = (from: number, to: number): boolean => {
    const a = centre(from % cols, Math.floor(from / cols));
    const b = centre(to % cols, Math.floor(to / cols));
    const sideways = { x: -(b.y - a.y) / size, y: (b.x - a.x) / size };
    const candidates = [buckets.get(from), buckets.get(to)];
    for (const shift of [0, -size / 4, size / 4]) {
      const start = { x: a.x + sideways.x * shift, y: a.y + sideways.y * shift };
      const end = { x: b.x + sideways.x * shift, y: b.y + sideways.y * shift };
      let clear = true;
      for (const list of candidates) {
        if (!list || !clear) continue;
        for (const wall of list) {
          if (effectOn(wall, start) === 'stops' && meets(start, end, wall.p1, wall.p2)) { clear = false; break; }
        }
      }
      if (clear) return false;
    }
    return true;
  };
  const queue: number[] = [];
  for (const viewer of viewers) {
    const cell = cellOf(viewer);
    if (cell >= 0 && !seen[cell]) { seen[cell] = 1; queue.push(cell); }
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const next = nr * cols + nc;
      if (seen[next] || blocked(cell, next)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}
