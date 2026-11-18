/**
 * Where the props of a painted background stand. The props layer says which brush covers each cell; this turns the
 * painted spots into a list of placements: one prop for a small dot, a jittered grid of props for a big patch. Pure
 * and deterministic (the same input always gives the same list), so it is tested without a board and cheap to redraw.
 */

import { terrainOf, type BackgroundLayers, type BackgroundSettings } from './backgroundData';
import { pixelAt, type BackgroundFrame } from './terrainHeight';

/** Most props that may stand near the map, drawn as full 3D models. */
export const MAX_MODELS = 6000;
/** Most props that may stand far from the map, drawn as flat impostors. */
export const MAX_IMPOSTORS = 60000;

/** A square area of the map, in squares: its top-left and bottom-right corners. */
type Rect = { x0: number; y0: number; x1: number; y1: number };

/** One prop to draw. */
export interface ScatteredProp {
  /** Which brush placed it (0 is the first brush). */
  brush: number;
  /** The raw pick among the brush's props (an index into `brush.props`); the caller skips models that did not load. */
  prop: number;
  /** Where it stands, in squares in the map's frame. */
  x: number;
  y: number;
  /** How far it is turned, in radians (0 to 2π). */
  turn: number;
  /** How big it is compared to its natural size. */
  scale: number;
  /** Whether it stands far from the map's middle (drawn as an impostor). */
  far: boolean;
}

const SALT_JITTER_X = 1, SALT_JITTER_Y = 2, SALT_PROP = 3, SALT_TURN = 4, SALT_SCALE = 5, SALT_CAP = 6;

/** A fixed hash of four whole numbers to [0, 1). */
function hash(a: number, b: number, c: number, d: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ Math.imul(d | 0, 3266489917);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A candidate prop and the hash that decides whether it survives a cap. */
interface Candidate { prop: ScatteredProp; keep: number }

/** Whether a stored terrain number is a liquid, for all 256 values. */
const LIQUID = (() => {
  const table = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const id = terrainOf(v);
    table[v] = id === 'water' || id === 'lava' || id === 'acid' ? 1 : 0;
  }
  return table;
})();

/** Keeps the candidates of one kind within `cap`: over it, those whose hash is under `cap / count`, trimmed to the cap. */
function capped(list: Candidate[], cap: number): ScatteredProp[] {
  if (list.length <= cap) return list.map((c) => c.prop);
  const limit = cap / list.length;
  const kept = list.filter((c) => c.keep < limit).map((c) => c.prop);
  return kept.length > cap ? kept.slice(0, cap) : kept;
}

/**
 * The props standing on a painted props layer. `footprint(brush)` is the width of the brush's largest prop at scale 1,
 * in squares (0 or NaN when no prop is known: then the brush places nothing). A spot too small for its footprint gets one
 * prop at its middle; a bigger one gets props on a jittered grid, spaced by the brush's density. Nothing stands on the
 * map or on a liquid. Over the caps, a deterministic, evenly spread share is kept.
 */
export function scatterProps(
  layers: BackgroundLayers,
  settings: BackgroundSettings,
  frame: BackgroundFrame,
  map: Rect,
  footprint: (brush: number) => number,
): ScatteredProp[] {
  const { size } = layers, n = size * size;
  const brushes = settings.props;
  const cellSize = frame.extent / size;
  const left = frame.cx - frame.extent / 2, top = frame.cy - frame.extent / 2;
  const onMap = (x: number, y: number): boolean => x >= map.x0 && x <= map.x1 && y >= map.y0 && y <= map.y1;
  const allowed = (k: number, x: number, y: number): boolean => !LIQUID[layers.terrain[k]] && !onMap(x, y);
  const farFrom = frame.extent / 4;

  // Which brushes can place anything at all.
  const usable: boolean[] = brushes.map((b, i) => {
    const f = footprint(i);
    return b.props.length > 0 && Number.isFinite(f) && f > 0;
  });
  const value = (k: number): number => {
    const v = layers.props[k];
    return v >= 1 && v <= brushes.length && usable[v - 1] ? v : 0;
  };

  const near: Candidate[] = [], far: Candidate[] = [];
  const add = (brush: number, ix: number, iy: number, x: number, y: number, scale: number): void => {
    const b = brushes[brush];
    const prop: ScatteredProp = {
      brush,
      prop: Math.min(b.props.length - 1, Math.floor(hash(ix, iy, brush, SALT_PROP) * b.props.length)),
      x,
      y,
      turn: hash(ix, iy, brush, SALT_TURN) * Math.PI * 2,
      scale: scale * (0.85 + 0.3 * hash(ix, iy, brush, SALT_SCALE)),
      far: Math.hypot(x - frame.cx, y - frame.cy) > farFrom,
    };
    (prop.far ? far : near).push({ prop, keep: hash(ix, iy, brush, SALT_CAP) });
  };

  // Label the spots: 4-connected cells of one brush. `grid` keeps the brush of each cell that belongs to a big spot.
  const grid = new Uint8Array(n);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const box = brushes.map(() => ({ i0: size, j0: size, i1: -1, j1: -1 }));
  for (let start = 0; start < n; start++) {
    const v = value(start);
    if (v === 0 || seen[start]) continue;
    // Flood out from `start`; the stack ends up holding every cell of the spot.
    let count = 0, top2 = 0, sumI = 0, sumJ = 0;
    stack[top2++] = start;
    seen[start] = 1;
    while (count < top2) {
      const k = stack[count++];
      const i = k % size, j = (k - i) / size;
      sumI += i;
      sumJ += j;
      if (i > 0 && !seen[k - 1] && layers.props[k - 1] === v) { seen[k - 1] = 1; stack[top2++] = k - 1; }
      if (i < size - 1 && !seen[k + 1] && layers.props[k + 1] === v) { seen[k + 1] = 1; stack[top2++] = k + 1; }
      if (j > 0 && !seen[k - size] && layers.props[k - size] === v) { seen[k - size] = 1; stack[top2++] = k - size; }
      if (j < size - 1 && !seen[k + size] && layers.props[k + size] === v) { seen[k + size] = 1; stack[top2++] = k + size; }
    }
    const brush = v - 1, b = brushes[brush];
    const reach = footprint(brush) * b.scale;
    if (count * cellSize * cellSize < reach * reach) {
      // A small spot: one prop at its middle, or at the cell nearest the middle that may hold one.
      const mx = left + (sumI / count + 0.5) * cellSize, my = top + (sumJ / count + 0.5) * cellSize;
      const middle = pixelAt(frame, mx, my);
      const si = start % size, sj = (start - si) / size;
      if (allowed(middle, mx, my)) add(brush, si, sj, mx, my, b.scale);
      else {
        let best = -1, bestD = Infinity, bx = 0, by = 0;
        for (let s = 0; s < count; s++) {
          const k = stack[s], i = k % size, j = (k - i) / size;
          const x = left + (i + 0.5) * cellSize, y = top + (j + 0.5) * cellSize;
          if (!allowed(k, x, y)) continue;
          const d = (x - mx) ** 2 + (y - my) ** 2;
          if (d < bestD) { bestD = d; best = k; bx = x; by = y; }
        }
        if (best >= 0) add(brush, si, sj, bx, by, b.scale);
      }
    } else {
      const bb = box[brush];
      for (let s = 0; s < count; s++) {
        const k = stack[s], i = k % size, j = (k - i) / size;
        grid[k] = v;
        if (i < bb.i0) bb.i0 = i;
        if (i > bb.i1) bb.i1 = i;
        if (j < bb.j0) bb.j0 = j;
        if (j > bb.j1) bb.j1 = j;
      }
    }
  }

  // Big spots: one jittered grid per brush over its whole painted box, so neighbouring spots share it.
  brushes.forEach((b, brush) => {
    const bb = box[brush];
    if (bb.i1 < 0 || !(b.density > 0)) return;
    const spacing = 10 / Math.sqrt(b.density);
    const gx0 = Math.floor((left + bb.i0 * cellSize) / spacing), gx1 = Math.floor((left + (bb.i1 + 1) * cellSize) / spacing);
    const gy0 = Math.floor((top + bb.j0 * cellSize) / spacing), gy1 = Math.floor((top + (bb.j1 + 1) * cellSize) / spacing);
    for (let iy = gy0; iy <= gy1; iy++) for (let ix = gx0; ix <= gx1; ix++) {
      const x = (ix + hash(ix, iy, brush, SALT_JITTER_X)) * spacing, y = (iy + hash(ix, iy, brush, SALT_JITTER_Y)) * spacing;
      if (x < left || y < top || x >= left + frame.extent || y >= top + frame.extent) continue;
      const k = pixelAt(frame, x, y);
      if (grid[k] !== brush + 1 || !allowed(k, x, y)) continue;
      add(brush, ix, iy, x, y, b.scale);
    }
  });

  return [...capped(near, MAX_MODELS), ...capped(far, MAX_IMPOSTORS)];
}
