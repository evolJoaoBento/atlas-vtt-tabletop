/**
 * Atlas's fog of war, as the 3D board reads it. Atlas stores each stroke of its fog tools (a brush stroke, a lasso, a
 * rectangle; painting or erasing) under `state.objects.fog`, and the fog is those strokes replayed in time order:
 * paint adds, erase cuts away. Atlas does that with polygon operations in clipper2 on eighth-pixel integers
 * (`src/app/fog/`); this does the same, with the same library and settings, and hands back the areas of fog with
 * their holes, in map pixels, for the board to raise into 3D. Pure, so it is tested without Obsidian.
 */
import { difference, EndType, FillRule, inflatePaths, JoinType, union, type Path64, type Paths64 } from 'clipper2-ts';

interface Point {
  x: number;
  y: number;
}

interface FogBase {
  id: string;
  timestamp: number;
  /** Erasing cuts fog away; painting adds it. */
  isErasing: boolean;
  /** Where the stroke was dragged to, from where it was drawn. */
  offsetX: number;
  offsetY: number;
}

export type FogOperation =
  | (FogBase & { type: 'brush'; points: Point[]; brushRadius: number })
  | (FogBase & { type: 'lasso'; points: Point[] })
  | (FogBase & { type: 'rectangle'; x: number; y: number; width: number; height: number });

/** One area of fog: its outline and the holes erased out of it, in map pixels. */
export interface FogArea {
  outer: Point[];
  holes: Point[][];
}

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Atlas's integer grid: eighths of a pixel. */
const Q_SCALE = 8;
const MAX_Q = 2 ** 24;

function readPoints(raw: unknown): Point[] | null {
  if (!Array.isArray(raw)) return null;
  const points: Point[] = [];
  for (const point of raw) {
    if (!isObj(point) || !finite(point.x) || !finite(point.y)) return null;
    points.push({ x: point.x, y: point.y });
  }
  return points;
}

/** The fog strokes of a map (`state.objects.fog`); one Atlas could not draw is left out. */
export function readFog(raw: unknown): FogOperation[] {
  const operations: FogOperation[] = [];
  for (const entry of isObj(raw) ? Object.values(raw) : []) {
    if (!isObj(entry) || typeof entry.id !== 'string' || !finite(entry.timestamp)) continue;
    const base: FogBase = {
      id: entry.id, timestamp: entry.timestamp, isErasing: entry.isErasing === true,
      offsetX: finite(entry.offsetX) ? entry.offsetX : 0, offsetY: finite(entry.offsetY) ? entry.offsetY : 0,
    };
    if (entry.type === 'rectangle') {
      if (!finite(entry.x) || !finite(entry.y) || !finite(entry.width) || !finite(entry.height)) continue;
      operations.push({ ...base, type: 'rectangle', x: entry.x, y: entry.y, width: entry.width, height: entry.height });
    } else if (entry.type === 'brush' || entry.type === 'lasso') {
      const points = readPoints(entry.points);
      if (!points) continue;
      if (entry.type === 'lasso') {
        operations.push({ ...base, type: 'lasso', points });
      } else {
        if (!finite(entry.brushRadius) || entry.brushRadius < 0) continue;
        operations.push({ ...base, type: 'brush', points, brushRadius: entry.brushRadius });
      }
    }
  }
  return operations;
}

function quantize(value: number): number {
  const q = Math.round(value * Q_SCALE);
  if (Math.abs(q) > MAX_Q) throw new RangeError('fog outside the map');
  return q === 0 ? 0 : q;
}

/** One stroke's filled shape, before it adds or erases (Atlas's `fogOperationShape`). */
function shapeOf(operation: FogOperation): Paths64 {
  const { offsetX: ox, offsetY: oy } = operation;
  if (operation.type === 'rectangle') {
    const x1 = quantize(operation.x + ox);
    const y1 = quantize(operation.y + oy);
    const x2 = quantize(operation.x + operation.width + ox);
    const y2 = quantize(operation.y + operation.height + oy);
    return union([[{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }]], FillRule.NonZero);
  }
  const path: Path64 = operation.points.map((point) => ({ x: quantize(point.x + ox), y: quantize(point.y + oy) }));
  if (operation.type === 'lasso') return union([path], FillRule.NonZero);
  const radius = quantize(operation.brushRadius);
  const stroke = path.filter((point, index) => index === 0 || point.x !== path[index - 1]!.x || point.y !== path[index - 1]!.y);
  if (radius === 0 || stroke.length === 0) return [];
  // Round caps and joins, as Atlas inflates its brush; integer offsetting can cross itself, so it is unioned.
  return union(inflatePaths([stroke], radius, JoinType.Round, EndType.Round, 2, 1), FillRule.NonZero);
}

/** Twice a ring's signed area; positive for an outline, negative for a hole, as clipper2 orients them. */
export function ringArea(ring: readonly Point[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += a.x * b.y - a.y * b.x;
  }
  return area / 2;
}

function inside(point: Point, ring: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/** The map's fog: its strokes replayed in time order (ties in the map's order), as areas with their holes. */
export function fogAreas(operations: readonly FogOperation[]): FogArea[] {
  const ordered = operations.map((operation, index) => ({ operation, index }))
    .sort((a, b) => a.operation.timestamp - b.operation.timestamp || a.index - b.index);
  let shape: Paths64 = [];
  for (const { operation } of ordered) {
    let changed: Paths64;
    try {
      changed = shapeOf(operation);
    } catch {
      // Atlas refuses a stroke it cannot place on its integer grid; so does the board.
      continue;
    }
    shape = operation.isErasing ? difference(shape, changed, FillRule.NonZero) : union(shape, changed, FillRule.NonZero);
  }
  const rings = shape.map((path) => path.map((point) => ({ x: point.x / Q_SCALE, y: point.y / Q_SCALE }))).filter((ring) => ring.length >= 3);
  const outers = rings.filter((ring) => ringArea(ring) > 0).map((outer) => ({ outer, holes: [] as Point[][] }));
  for (const hole of rings.filter((ring) => ringArea(ring) < 0)) {
    // A hole belongs to the smallest outline around it (an island inside a hole has its own outline).
    const around = outers.filter((area) => inside(hole[0]!, area.outer)).sort((a, b) => ringArea(a.outer) - ringArea(b.outer))[0];
    around?.holes.push(hole);
  }
  return outers;
}
