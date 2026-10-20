/**
 * The grid's lines as Atlas draws them, in map pixels: each cell edge once (square sides or hex edges), clipped to the
 * map; then styled as solid lines, two centred dashes per edge, or a mark at each corner (arms along the edges that
 * meet there, `max(3, size × 0.08)` long). Pure; the board turns the result into strips `lineWidth` wide.
 */
import { axialCenter } from './geometry';
import type { BoardGrid } from './mapModel';

const SQRT3 = Math.sqrt(3);
/** Atlas's dashes: the gap it aims for, how much each dash is shortened, and the shortest dash it draws. */
const DASH_GAP = 4;
const DASH_SHORTENING = 0.8;
const MIN_DASH = 1;

/** A segment clipped to the rectangle 0..width × 0..height (Liang–Barsky); null when it lies outside. */
function clip(x1: number, y1: number, x2: number, y2: number, width: number, height: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const edges: Array<[number, number]> = [[-dx, x1], [dx, width - x1], [-dy, y1], [dy, height - y1]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  if (t1 - t0 < 1e-9) return null;
  return [x1 + dx * t0, y1 + dy * t0, x1 + dx * t1, y1 + dy * t1];
}

/** Every cell edge of the grid, once, clipped to the map: x1, y1, x2, y2 per edge. */
export function gridEdges(grid: BoardGrid, width: number, height: number): number[] {
  const out: number[] = [];
  const push = (x1: number, y1: number, x2: number, y2: number): void => {
    const part = clip(x1, y1, x2, y2, width, height);
    if (part) out.push(...part);
  };
  const { size } = grid;
  if (grid.type === 'square') {
    const offX = ((grid.offsetX % size) + size) % size;
    const offY = ((grid.offsetY % size) + size) % size;
    for (let x = offX - size; x <= width + size; x += size) {
      for (let y = offY - size; y <= height; y += size) push(x, y, x, y + size);
    }
    for (let y = offY - size; y <= height + size; y += size) {
      for (let x = offX - size; x <= width; x += size) push(x, y, x + size, y);
    }
    return out;
  }
  const radius = size / SQRT3;
  const pointy = grid.type === 'hex-vertical';
  const seen = new Set<string>();
  const key = (x: number, y: number): string => `${Math.round(x * 10)},${Math.round(y * 10)}`;
  const span = Math.ceil(Math.max(width, height) / (radius * 1.5)) + 3;
  const startAngle = pointy ? -Math.PI / 2 : 0;
  for (let r = -span; r <= span; r++) {
    for (let q = -2 * span; q <= 2 * span; q++) {
      const centre = axialCenter(grid, q, r);
      if (centre.x < -size || centre.x > width + size || centre.y < -size || centre.y > height + size) continue;
      for (let i = 0; i < 6; i++) {
        const a = startAngle + (Math.PI / 3) * i;
        const b = a + Math.PI / 3;
        const ax = centre.x + radius * Math.cos(a);
        const ay = centre.y + radius * Math.sin(a);
        const bx = centre.x + radius * Math.cos(b);
        const by = centre.y + radius * Math.sin(b);
        const edge = [key(ax, ay), key(bx, by)].sort().join('|');
        if (seen.has(edge)) continue;
        seen.add(edge);
        push(ax, ay, bx, by);
      }
    }
  }
  return out;
}

/** Atlas's dashes along one edge: two centred dashes, else one, else none when the edge is too short. */
export function dashes(x1: number, y1: number, x2: number, y2: number): number[] {
  const length = Math.hypot(x2 - x1, y2 - y1);
  for (const count of [2, 1]) {
    const dash = ((length - (count + 1) * DASH_GAP) / count) * DASH_SHORTENING;
    if (dash < MIN_DASH) continue;
    const gap = (length - count * dash) / (count + 1);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      const from = (gap + i * (dash + gap)) / length;
      const to = (gap + i * (dash + gap) + dash) / length;
      out.push(x1 + (x2 - x1) * from, y1 + (y2 - y1) * from, x1 + (x2 - x1) * to, y1 + (y2 - y1) * to);
    }
    return out;
  }
  return [];
}

/** The grid as segments to draw (x1, y1, x2, y2 each), in its line type. */
export function styledGrid(grid: BoardGrid, width: number, height: number): { segments: number[] } {
  const edges = gridEdges(grid, width, height);
  if (grid.lineType === 'solid') return { segments: edges };
  const segments: number[] = [];
  const arm = Math.max(3, grid.size * 0.08);
  for (let i = 0; i < edges.length; i += 4) {
    const [x1, y1, x2, y2] = edges.slice(i, i + 4) as [number, number, number, number];
    if (grid.lineType === 'dashed') {
      segments.push(...dashes(x1, y1, x2, y2));
      continue;
    }
    // Dotted: from each end of the edge, an arm along it.
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (length === 0) continue;
    const ux = ((x2 - x1) / length) * Math.min(arm, length / 2);
    const uy = ((y2 - y1) / length) * Math.min(arm, length / 2);
    segments.push(x1, y1, x1 + ux, y1 + uy, x2, y2, x2 - ux, y2 - uy);
  }
  return { segments };
}
