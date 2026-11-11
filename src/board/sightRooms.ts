/**
 * Rooms for cinematic line of sight, by the walls themselves rather than the grid's squares: every wall (doors, glass and
 * one-way walls too) is a line, and the lines cut the map into rooms, the faces of the plane they make. A viewer sees
 * the whole room it stands in and every room it can get to through a wall that does not stop sight from its side (an
 * open door, glass, the open side of a one-way wall), and nothing else, so a room drawn at any angle or off the grid is
 * shown or hidden exactly along its walls.
 *
 * Walls are rarely drawn perfectly, so the lines are tidied first, to a tolerance near an eighth of a square: ends close
 * together are joined, an end near another wall is joined onto it, crossing walls are split where they cross, a wall
 * drawn over another counts once, and walls that bound nothing (a stub, a wall hanging in a room) are left out. The rooms
 * hang on where the walls are, never on a door being open or shut: opening a door only floods the rooms again. Pure.
 */
import { difference, FillRule, union, type Path64, type Paths64 } from 'clipper2-ts';
import { effectOn } from './lineOfSight';
import type { BoardWall, Point } from './walls';

/** A room: its outline, the outlines of the buildings standing inside it (its holes), and its area and bounds. */
export interface Room {
  readonly outer: readonly Point[];
  readonly holes: readonly (readonly Point[])[];
  readonly area: number;
  readonly box: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

/** A wall between two rooms: the walls drawn there, and a point just inside each room, to ask the walls from. */
interface Crossing {
  readonly a: number;
  readonly b: number;
  readonly walls: readonly string[];
  readonly inA: Point;
  readonly inB: Point;
}

export interface Rooms {
  readonly rooms: readonly Room[];
  readonly crossings: readonly Crossing[];
}

/** The tolerance the walls are tidied to, for a grid of squares `size` across. */
export function roomTolerance(gridSize: number): number {
  return Math.max(1, gridSize / 8);
}

const shoelace = (polygon: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
};

/** Whether a point is inside a polygon (even-odd). */
export function insidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const p = polygon[i]!;
    const q = polygon[j]!;
    if ((p.y > point.y) !== (q.y > point.y) && point.x < ((q.x - p.x) * (point.y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
}

/** The polygon without repeated points or points on a straight run (they only trouble the veil's triangles). */
function tidy(polygon: readonly Point[]): Point[] {
  let points = polygon.filter((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!;
    return Math.hypot(next.x - point.x, next.y - point.y) > 1e-6;
  });
  let changed = true;
  while (changed && points.length > 3) {
    changed = false;
    const kept: Point[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length]!;
      const point = points[i]!;
      const next = points[(i + 1) % points.length]!;
      const cross = (point.x - prev.x) * (next.y - point.y) - (point.y - prev.y) * (next.x - point.x);
      const span = Math.hypot(next.x - prev.x, next.y - prev.y) || 1;
      if (Math.abs(cross) / span < 1e-6) { changed = true; continue; }
      kept.push(point);
    }
    points = kept;
  }
  return points;
}

/**
 * Cuts the map of `width` x `height` into rooms by its walls, tidied to `tolerance`. Null when no room comes of it
 * (the caller then falls back to the grid's squares).
 */
export function buildRooms(walls: readonly BoardWall[], width: number, height: number, tolerance: number): Rooms | null {
  // ── Points, joined when close together (a hash of cells `tolerance` across finds the near ones).
  const points: Point[] = [];
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, y: number): string => `${Math.floor(x / tolerance)},${Math.floor(y / tolerance)}`;
  const weld = (point: Point): number => {
    const cx = Math.floor(point.x / tolerance);
    const cy = Math.floor(point.y / tolerance);
    let best = -1;
    let bestDistance = tolerance;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const index of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const other = points[index]!;
          const distance = Math.hypot(other.x - point.x, other.y - point.y);
          if (distance <= bestDistance) { bestDistance = distance; best = index; }
        }
      }
    }
    if (best >= 0) return best;
    points.push({ x: point.x, y: point.y });
    const key = cellKey(point.x, point.y);
    const list = cells.get(key);
    if (list) list.push(points.length - 1);
    else cells.set(key, [points.length - 1]);
    return points.length - 1;
  };

  // ── The lines: every wall, and the map's edge (which no one crosses).
  interface Line { a: number; b: number; wall: string | null }
  const lines: Line[] = [];
  for (const wall of walls) {
    const a = weld(wall.p1);
    const b = weld(wall.p2);
    if (a !== b) lines.push({ a, b, wall: wall.id });
  }
  const corners = [weld({ x: 0, y: 0 }), weld({ x: width, y: 0 }), weld({ x: width, y: height }), weld({ x: 0, y: height })];
  for (let i = 0; i < 4; i++) if (corners[i] !== corners[(i + 1) % 4]) lines.push({ a: corners[i]!, b: corners[(i + 1) % 4]!, wall: null });
  if (lines.length === 0) return null;

  // ── Where each line is cut: ends lying on it, and the lines crossing it.
  const cuts: Array<Set<number>> = lines.map(() => new Set<number>());
  const boxOf = (line: Line): { x0: number; y0: number; x1: number; y1: number } => {
    const p = points[line.a]!;
    const q = points[line.b]!;
    return { x0: Math.min(p.x, q.x) - tolerance, y0: Math.min(p.y, q.y) - tolerance, x1: Math.max(p.x, q.x) + tolerance, y1: Math.max(p.y, q.y) + tolerance };
  };
  const boxes = lines.map(boxOf);
  const ends = [...new Set(lines.flatMap((line) => [line.a, line.b]))];
  lines.forEach((line, index) => {
    const p = points[line.a]!;
    const q = points[line.b]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length2 = dx * dx + dy * dy;
    const box = boxes[index]!;
    for (const end of ends) {
      if (end === line.a || end === line.b) continue;
      const point = points[end]!;
      if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) continue;
      const t = ((point.x - p.x) * dx + (point.y - p.y) * dy) / length2;
      if (t <= 0 || t >= 1) continue;
      if (Math.hypot(p.x + t * dx - point.x, p.y + t * dy - point.y) <= tolerance) cuts[index]!.add(end);
    }
  });
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const one = lines[i]!;
      const two = lines[j]!;
      if (one.a === two.a || one.a === two.b || one.b === two.a || one.b === two.b) continue;
      const bi = boxes[i]!;
      const bj = boxes[j]!;
      if (bi.x1 < bj.x0 || bj.x1 < bi.x0 || bi.y1 < bj.y0 || bj.y1 < bi.y0) continue;
      const p = points[one.a]!;
      const r = { x: points[one.b]!.x - p.x, y: points[one.b]!.y - p.y };
      const q = points[two.a]!;
      const s = { x: points[two.b]!.x - q.x, y: points[two.b]!.y - q.y };
      const denominator = r.x * s.y - r.y * s.x;
      if (Math.abs(denominator) < 1e-12) continue;
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / denominator;
      const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / denominator;
      if (t <= 0 || t >= 1 || u <= 0 || u >= 1) continue;
      const at = weld({ x: p.x + t * r.x, y: p.y + t * r.y });
      if (at !== one.a && at !== one.b) cuts[i]!.add(at);
      if (at !== two.a && at !== two.b) cuts[j]!.add(at);
    }
  }

  // ── The edges between cuts; one drawn twice is one edge with both walls on it.
  interface Edge { u: number; v: number; walls: Set<string>; edge: boolean }
  const edgeOf = new Map<string, Edge>();
  lines.forEach((line, index) => {
    const p = points[line.a]!;
    const q = points[line.b]!;
    const along = (vertex: number): number => (points[vertex]!.x - p.x) * (q.x - p.x) + (points[vertex]!.y - p.y) * (q.y - p.y);
    const run = [line.a, ...[...cuts[index]!].sort((m, n) => along(m) - along(n)), line.b];
    for (let k = 0; k + 1 < run.length; k++) {
      const u = run[k]!;
      const v = run[k + 1]!;
      if (u === v) continue;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      let edge = edgeOf.get(key);
      if (!edge) { edge = { u: Math.min(u, v), v: Math.max(u, v), walls: new Set(), edge: false }; edgeOf.set(key, edge); }
      if (line.wall === null) edge.edge = true;
      else edge.walls.add(line.wall);
    }
  });
  let edges = [...edgeOf.values()];

  // ── Faces: walls that bound nothing go (stubs, then any wall with the same room on both sides), until none is left.
  type Traced = { faceOf: Int32Array; faces: number[][]; edges: Edge[] };
  const trace = (list: Edge[]): Traced => {
    const out: number[][] = points.map(() => []);
    // Half-edge h: 2i runs u -> v, 2i + 1 runs v -> u.
    const from = (h: number): number => (h % 2 === 0 ? list[h >> 1]!.u : list[h >> 1]!.v);
    const to = (h: number): number => (h % 2 === 0 ? list[h >> 1]!.v : list[h >> 1]!.u);
    for (let h = 0; h < list.length * 2; h++) out[from(h)]!.push(h);
    const angle = (h: number): number => Math.atan2(points[to(h)]!.y - points[from(h)]!.y, points[to(h)]!.x - points[from(h)]!.x);
    const position = new Int32Array(list.length * 2);
    for (const outgoing of out) {
      outgoing.sort((m, n) => angle(m) - angle(n));
      outgoing.forEach((h, index) => { position[h] = index; });
    }
    const next = (h: number): number => {
      const twin = h ^ 1;
      const around = out[to(h)]!;
      return around[(position[twin]! - 1 + around.length) % around.length]!;
    };
    const faceOf = new Int32Array(list.length * 2).fill(-1);
    const faces: number[][] = [];
    for (let start = 0; start < list.length * 2; start++) {
      if (faceOf[start] !== -1) continue;
      const face: number[] = [];
      let h = start;
      for (let guard = 0; guard <= list.length * 2 && faceOf[h] === -1; guard++) {
        faceOf[h] = faces.length;
        face.push(h);
        h = next(h);
      }
      faces.push(face);
    }
    return { faceOf, faces, edges: list };
  };
  let traced: Traced | null = null;
  for (let round = 0; round < 64; round++) {
    // Stubs: an end that meets nothing else, again and again.
    let degree = new Int32Array(points.length);
    for (const edge of edges) { degree[edge.u]! += 1; degree[edge.v]! += 1; }
    let pruned = true;
    while (pruned) {
      pruned = false;
      const kept = edges.filter((edge) => degree[edge.u]! > 1 && degree[edge.v]! > 1);
      if (kept.length !== edges.length) {
        pruned = true;
        edges = kept;
        degree = new Int32Array(points.length);
        for (const edge of edges) { degree[edge.u]! += 1; degree[edge.v]! += 1; }
      }
    }
    if (edges.length === 0) return null;
    traced = trace(edges);
    const { faceOf } = traced;
    const lone = edges.filter((_, index) => faceOf[index * 2] === faceOf[index * 2 + 1]);
    if (lone.length === 0) break;
    const gone = new Set(lone);
    edges = edges.filter((edge) => !gone.has(edge));
    traced = null;
  }
  if (!traced) return null;
  const { faceOf, faces } = traced;
  const from = (h: number): number => (h % 2 === 0 ? edges[h >> 1]!.u : edges[h >> 1]!.v);
  const polygons = faces.map((face) => face.map((h) => points[from(h)]!));
  const areas = polygons.map(shoelace);

  // ── The pieces of the drawing that touch (a building is one; the map's edge and what joins it another).
  const parent = points.map((_, index) => index);
  const root = (index: number): number => { while (parent[index] !== index) { parent[index] = parent[parent[index]!]!; index = parent[index]!; } return index; };
  for (const edge of edges) parent[root(edge.u)] = root(edge.v);
  const pieceOfFace = faces.map((face) => root(from(face[0]!)));
  // Each piece's outline is its face of the most negative area; its other faces (positive) are its rooms.
  const outline = new Map<number, number>();
  faces.forEach((_, face) => {
    if (areas[face]! >= 0) return;
    const piece = pieceOfFace[face]!;
    const kept = outline.get(piece);
    if (kept === undefined || areas[face]! < areas[kept]!) outline.set(piece, face);
  });
  const roomFaces = faces.map((_, face) => face).filter((face) => areas[face]! > 1e-6);
  if (roomFaces.length === 0) return null;
  const boxOfPolygon = (polygon: readonly Point[]): Room['box'] => ({
    x0: Math.min(...polygon.map((point) => point.x)), y0: Math.min(...polygon.map((point) => point.y)),
    x1: Math.max(...polygon.map((point) => point.x)), y1: Math.max(...polygon.map((point) => point.y)),
  });
  const faceBoxes = new Map(roomFaces.map((face) => [face, boxOfPolygon(polygons[face]!)]));
  // The smallest room of another piece holding a point: where a piece stands.
  const holder = (point: Point, notPiece: number | null): number => {
    let best = -1;
    for (const face of roomFaces) {
      if (notPiece !== null && pieceOfFace[face] === notPiece) continue;
      const box = faceBoxes.get(face)!;
      if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) continue;
      if (!insidePolygon(point, polygons[face]!)) continue;
      if (best === -1 || areas[face]! < areas[best]!) best = face;
    }
    return best;
  };
  const container = new Map<number, number>();
  for (const [piece, face] of outline) {
    const corner = polygons[face]![0]!;
    container.set(piece, holder(corner, piece));
  }
  // Rooms, and the face each half-edge's side belongs to.
  const roomOfFace = new Int32Array(faces.length).fill(-1);
  roomFaces.forEach((face, index) => { roomOfFace[face] = index; });
  faces.forEach((_, face) => {
    if (roomOfFace[face] !== -1) return;
    const held = container.get(pieceOfFace[face]!) ?? -1;
    roomOfFace[face] = held === -1 ? -1 : roomOfFace[held]!;
  });
  const holes: Point[][][] = roomFaces.map(() => []);
  for (const [piece, face] of outline) {
    const held = container.get(piece) ?? -1;
    if (held !== -1) holes[roomOfFace[held]!]!.push(tidy(polygons[face]!));
  }
  const rooms: Room[] = roomFaces.map((face, index) => ({ outer: tidy(polygons[face]!), holes: holes[index]!, area: areas[face]!, box: faceBoxes.get(face)! }));

  // ── Crossings: each edge between two rooms, with a point just inside each side.
  const crossings: Crossing[] = [];
  edges.forEach((edge, index) => {
    if (edge.edge || edge.walls.size === 0) return;
    const a = roomOfFace[faceOf[index * 2]!]!;
    const b = roomOfFace[faceOf[index * 2 + 1]!]!;
    if (a === -1 || b === -1 || a === b) return;
    const p = points[edge.u]!;
    const q = points[edge.v]!;
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    // The half-edge u -> v has its room on its left (normal (-dy, dx)).
    const nudge = Math.min(tolerance / 4, length / 4);
    const left = { x: (-(q.y - p.y) / length) * nudge, y: ((q.x - p.x) / length) * nudge };
    crossings.push({ a, b, walls: [...edge.walls], inA: { x: mid.x + left.x, y: mid.y + left.y }, inB: { x: mid.x - left.x, y: mid.y - left.y } });
  });
  return { rooms, crossings };
}

/** The room a point stands in (the smallest holding it), or -1 off every room. */
export function roomAt(rooms: Rooms, point: Point): number {
  let best = -1;
  rooms.rooms.forEach((room, index) => {
    const { box } = room;
    if (point.x < box.x0 || point.x > box.x1 || point.y < box.y0 || point.y > box.y1) return;
    if (!insidePolygon(point, room.outer)) return;
    if (best === -1 || room.area < rooms.rooms[best]!.area) best = index;
  });
  return best;
}

/**
 * The rooms the viewers see (1) by the walls as they stand now: their own, and every room joined to one of those by a
 * wall that does not stop sight from the side it is crossed from. Null when a viewer stands in no room.
 */
export function seenRooms(rooms: Rooms, viewers: readonly Point[], walls: readonly BoardWall[]): Uint8Array | null {
  const seen = new Uint8Array(rooms.rooms.length);
  const byId = new Map(walls.map((wall) => [wall.id, wall]));
  const ways: Array<Array<{ to: number; from: Point; walls: readonly string[] }>> = rooms.rooms.map(() => []);
  for (const crossing of rooms.crossings) {
    ways[crossing.a]!.push({ to: crossing.b, from: crossing.inA, walls: crossing.walls });
    ways[crossing.b]!.push({ to: crossing.a, from: crossing.inB, walls: crossing.walls });
  }
  const queue: number[] = [];
  for (const viewer of viewers) {
    const room = roomAt(rooms, viewer);
    if (room === -1) return null;
    if (!seen[room]) { seen[room] = 1; queue.push(room); }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const way of ways[queue[head]!]!) {
      if (seen[way.to]) continue;
      const stopped = way.walls.some((id) => {
        const wall = byId.get(id);
        return wall !== undefined && effectOn(wall, way.from) === 'stops';
      });
      if (stopped) continue;
      seen[way.to] = 1;
      queue.push(way.to);
    }
  }
  return seen;
}

/** An area of the map: its outline and the holes in it. */
export interface SightArea {
  readonly outer: readonly Point[];
  readonly holes: readonly (readonly Point[])[];
}

const AREA_SCALE = 8;

/**
 * What no viewer sees by rays: the map of `width` x `height` less every viewer's sight polygon, as areas with their
 * holes (a pillar's shadow inside the seen ground is an area of its own), in map pixels.
 */
export function unseenAreas(polygons: readonly (readonly Point[])[], width: number, height: number): SightArea[] {
  const scale = (polygon: readonly Point[]): Path64 => polygon.map((point) => ({ x: Math.round(point.x * AREA_SCALE), y: Math.round(point.y * AREA_SCALE) }));
  const map: Paths64 = [scale([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }])];
  const seen = union(polygons.filter((polygon) => polygon.length >= 3).map(scale), FillRule.NonZero);
  const rest = seen.length > 0 ? difference(map, seen, FillRule.NonZero) : map;
  const rings = rest.map((path) => path.map((point) => ({ x: point.x / AREA_SCALE, y: point.y / AREA_SCALE }))).filter((ring) => ring.length >= 3);
  const outers = rings.filter((ring) => shoelace(ring) > 0).map((outer) => ({ outer: tidy(outer), holes: [] as Point[][], area: shoelace(outer) }));
  for (const hole of rings.filter((ring) => shoelace(ring) < 0)) {
    const around = outers.filter((area) => insidePolygon(hole[0]!, area.outer)).sort((a, b) => a.area - b.area)[0];
    around?.holes.push(tidy(hole));
  }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}
