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

const SALT_JITTER_X = 1, SALT_JITTER_Y = 2, SALT_PROP = 3, SALT_TURN = 4, SALT_SCALE = 5, SALT_CAP = 6, SALT_KEEP = 7, SALT_NOISE = 8;

/** The grid is finer than the brush's even spacing by this much (0.8, so 1.56 times the points before thinning). */
const GRID_STEP = 0.8;
/** How far, in grid cells, a point may stray from its cell's middle (a total range of 1.6 cells). */
const JITTER = 1.6;
/** How big a clump or clearing is, in times the brush's even spacing. */
const CLUMP_FEATURE = 6, FINE_FEATURE = 2;
/** How much the big and the small swell count in the noise. */
const CLUMP_WEIGHT = 0.65, FINE_WEIGHT = 0.35;
/**
 * A point is kept with chance `KEEP_SCALE * (KEEP_BASE + KEEP_GAIN * clumpiness)`. The scale undoes the finer grid (and was
 * tuned by measuring the big test forest); the base and gain leave real clearings (near 0) and thick patches (capped at 1).
 */
const KEEP_SCALE = GRID_STEP * GRID_STEP * 1.045, KEEP_BASE = 0.1, KEEP_GAIN = 1.8;
const SALT_ANGLE = 9, SALT_FINE = 10;
/** Over the caps, about this many times the cap are made before the even thinning trims them. */
const CAP_MARGIN = 1.5;

/** Two octaves of noise, made contrasty with a smoothstep, from 0 (a clearing) to 1 (a thick patch); x and y are in even spacings. */
function clumpiness(x: number, y: number, brush: number): number {
  const n = CLUMP_WEIGHT * valueNoise(x / CLUMP_FEATURE, y / CLUMP_FEATURE, brush) + FINE_WEIGHT * valueNoise(x / FINE_FEATURE, y / FINE_FEATURE, brush + SALT_FINE * 8);
  const t = Math.min(1, Math.max(0, (n - 0.25) / 0.5));
  return t * t * (3 - 2 * t);
}

/** Smooth noise from 0 to 1 that changes slowly over one unit of (x, y); the same for the same brush. */
function valueNoise(x: number, y: number, brush: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number): number => hash(i, j, brush, SALT_NOISE);
  const top = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx, bottom = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

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

/** Keeps the candidates of one kind within `cap`: over it, the `cap` with the lowest hash, so the thinning is even everywhere. */
function capped(list: Candidate[], cap: number): ScatteredProp[] {
  if (list.length <= cap) return list.map((c) => c.prop);
  const keeps = Float64Array.from(list, (c) => c.keep).sort();
  const limit = keeps[cap - 1];
  const kept = list.filter((c) => c.keep <= limit).map((c) => c.prop);
  // Equal hashes at the limit could leave a few over.
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
  if (!usable.includes(true)) return [];
  const value = (k: number): number => {
    const v = layers.props[k];
    return v >= 1 && v <= brushes.length && usable[v - 1] ? v : 0;
  };

  /** Every placement, near the middle and far from it: the single props, then the grids' (`grid`, kept apart until the end). */
  const near: Candidate[] = [], far: Candidate[] = [];
  /** The grids' placements, apart from the single props, so one class can be made again on its own. */
  const grid = { near: [] as Candidate[], far: [] as Candidate[] };
  /** A grid point whose cap hash is not under its class's limit is never made: with a huge forest, millions would be. */
  const limit = { near: 1, far: 1 };
  const isFar = (x: number, y: number): boolean => Math.hypot(x - frame.cx, y - frame.cy) > farFrom;
  const candidate = (brush: number, ix: number, iy: number, x: number, y: number, scale: number, keep: number): Candidate => {
    const b = brushes[brush];
    const prop: ScatteredProp = {
      brush,
      prop: Math.min(b.props.length - 1, Math.floor(hash(ix, iy, brush, SALT_PROP) * b.props.length)),
      x,
      y,
      turn: hash(ix, iy, brush, SALT_TURN) * Math.PI * 2,
      scale: scale * (0.85 + 0.3 * hash(ix, iy, brush, SALT_SCALE)),
      far: isFar(x, y),
    };
    return { prop, keep };
  };
  /** A single prop (a small spot's, or a missed spot's): always made. */
  const add = (brush: number, ix: number, iy: number, x: number, y: number, scale: number): void => {
    const c = candidate(brush, ix, iy, x, y, scale, hash(ix, iy, brush, SALT_CAP));
    (c.prop.far ? far : near).push(c);
  };
  /** A grid point, made only when its cap hash is under its class's limit; `only` makes one class alone. */
  const addGrid = (brush: number, ix: number, iy: number, x: number, y: number, scale: number, only: 'near' | 'far' | null): void => {
    const cls = isFar(x, y) ? 'far' : 'near';
    if (only !== null && cls !== only) return;
    const keep = hash(ix, iy, brush, SALT_CAP);
    if (keep >= limit[cls]) return;
    grid[cls].push(candidate(brush, ix, iy, x, y, scale, keep));
  };

  /** One prop for the spot whose `count` cells are in the stack: at its middle, or at the allowed cell nearest the middle. */
  const placeAtMiddle = (brush: number, start: number, count: number, sumI: number, sumJ: number): void => {
    const mx = left + (sumI / count + 0.5) * cellSize, my = top + (sumJ / count + 0.5) * cellSize;
    const si = start % size, sj = (start - si) / size;
    if (allowed(pixelAt(frame, mx, my), mx, my)) { add(brush, si, sj, mx, my, brushes[brush].scale); return; }
    let best = -1, bestD = Infinity, bx = 0, by = 0;
    for (let s = 0; s < count; s++) {
      const k = stack[s], i = k % size, j = (k - i) / size;
      const x = left + (i + 0.5) * cellSize, y = top + (j + 0.5) * cellSize;
      if (!allowed(k, x, y)) continue;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bestD) { bestD = d; best = k; bx = x; by = y; }
    }
    if (best >= 0) add(brush, si, sj, bx, by, brushes[brush].scale);
  };

  // Label the spots: 4-connected cells of one brush. `spotOf` holds, for each cell of a big spot, that spot's number (from 1).
  const spotOf = new Int32Array(n);
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  const box = brushes.map(() => ({ i0: size, j0: size, i1: -1, j1: -1 }));
  const bigSpots: { brush: number; start: number; hit: boolean }[] = [];
  /** How many cells each brush's big spots cover, near the middle and far from it (to guess how many props the grids will give). */
  const bigNear = brushes.map(() => 0), bigFar = brushes.map(() => 0);
  for (let start = 0; start < n; start++) {
    const v = value(start);
    if (v === 0 || seen[start]) continue;
    // Flood out from `start`; the stack ends up holding every cell of the spot.
    let visited = 0, queued = 0, sumI = 0, sumJ = 0;
    stack[queued++] = start;
    seen[start] = 1;
    while (visited < queued) {
      const k = stack[visited++];
      const i = k % size, j = (k - i) / size;
      sumI += i;
      sumJ += j;
      if (i > 0 && !seen[k - 1] && layers.props[k - 1] === v) { seen[k - 1] = 1; stack[queued++] = k - 1; }
      if (i < size - 1 && !seen[k + 1] && layers.props[k + 1] === v) { seen[k + 1] = 1; stack[queued++] = k + 1; }
      if (j > 0 && !seen[k - size] && layers.props[k - size] === v) { seen[k - size] = 1; stack[queued++] = k - size; }
      if (j < size - 1 && !seen[k + size] && layers.props[k + size] === v) { seen[k + size] = 1; stack[queued++] = k + size; }
    }
    const count = visited, brush = v - 1, b = brushes[brush];
    const reach = footprint(brush) * b.scale;
    if (count * cellSize * cellSize < reach * reach) {
      placeAtMiddle(brush, start, count, sumI, sumJ);
    } else {
      bigSpots.push({ brush, start, hit: false });
      const id = bigSpots.length, bb = box[brush];
      for (let s = 0; s < count; s++) {
        const k = stack[s], i = k % size, j = (k - i) / size;
        spotOf[k] = id;
        if (isFar(left + (i + 0.5) * cellSize, top + (j + 0.5) * cellSize)) bigFar[brush]++; else bigNear[brush]++;
        if (i < bb.i0) bb.i0 = i;
        if (i > bb.i1) bb.i1 = i;
        if (j < bb.j0) bb.j0 = j;
        if (j > bb.j1) bb.j1 = j;
      }
    }
  }

  // Big spots: one jittered grid per brush over its whole painted box, so neighbouring spots share it. `walk` visits every
  // grid point that stands (and marks its spot as hit), handing it to `visit`.
  const walk = (visit: (brush: number, ix: number, iy: number, x: number, y: number, scale: number) => void): void => brushes.forEach((b, brush) => {
    const bb = box[brush];
    if (bb.i1 < 0 || !(b.density > 0)) return;
    // The brush's even spacing; the grid is finer (OVERSAMPLE) and thinned by the clump noise, so the mean density holds.
    const even = 10 / Math.sqrt(b.density), spacing = even * GRID_STEP;
    // The grid is turned by an angle of its own (0 to 90 degrees) so no brush shows rows.
    const angle = hash(brush, 0, 0, SALT_ANGLE) * Math.PI / 2, cos = Math.cos(angle), sin = Math.sin(angle);
    // The painted box seen from the turned grid: the bounds of its four corners. A point may stray up to 0.8 cells, so a ring more is visited.
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const x of [left + bb.i0 * cellSize, left + (bb.i1 + 1) * cellSize]) for (const y of [top + bb.j0 * cellSize, top + (bb.j1 + 1) * cellSize]) {
      const u = x * cos + y * sin, v = -x * sin + y * cos;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const gx0 = Math.floor(u0 / spacing) - 1, gx1 = Math.floor(u1 / spacing) + 1;
    const gy0 = Math.floor(v0 / spacing) - 1, gy1 = Math.floor(v1 / spacing) + 1;
    for (let iy = gy0; iy <= gy1; iy++) for (let ix = gx0; ix <= gx1; ix++) {
      const u = (ix + 0.5 + (hash(ix, iy, brush, SALT_JITTER_X) - 0.5) * JITTER) * spacing;
      const v = (iy + 0.5 + (hash(ix, iy, brush, SALT_JITTER_Y) - 0.5) * JITTER) * spacing;
      const x = u * cos - v * sin, y = u * sin + v * cos;
      // Where it would stand is looked at first (cheap): the noise is only worked out for points on painted ground.
      if (x < left || y < top || x >= left + frame.extent || y >= top + frame.extent) continue;
      const k = pixelAt(frame, x, y);
      const spot = spotOf[k];
      if (spot === 0 || bigSpots[spot - 1].brush !== brush || !allowed(k, x, y)) continue;
      // Clumps and clearings: keep the point with a chance that follows the slow noise at its place.
      const chance = KEEP_SCALE * (KEEP_BASE + KEEP_GAIN * clumpiness(x / even, y / even, brush));
      if (hash(ix, iy, brush, SALT_KEEP) >= chance) continue;
      bigSpots[spot - 1].hit = true;
      visit(brush, ix, iy, x, y, b.scale);
    }
  });
  // A rough count of what the grids will give (painted area x density, the thinning averaging out). Over the caps, only
  // the points whose cap hash can survive are made, so allocations stay near the caps whatever the forest's size.
  let nearExpected = 0, farExpected = 0;
  brushes.forEach((b, brush) => {
    const perCell = cellSize * cellSize * b.density / 100;
    nearExpected += bigNear[brush] * perCell;
    farExpected += bigFar[brush] * perCell;
  });
  // A margin, so the share kept is over the cap and the even thinning below trims it exactly.
  limit.near = Math.min(1, CAP_MARGIN * MAX_MODELS / Math.max(1, nearExpected));
  limit.far = Math.min(1, CAP_MARGIN * MAX_IMPOSTORS / Math.max(1, farExpected));
  walk((brush, ix, iy, x, y, scale) => addGrid(brush, ix, iy, x, y, scale, null));
  // A class whose estimate was too high (water, the map or clearings left fewer than guessed) did not reach its cap: that
  // class alone is made again with its limit raised by how short it fell, until it reaches the cap or nothing is left out.
  // The other class, and the single props, are kept as they are, so allocations stay near the caps.
  const caps = { near: MAX_MODELS, far: MAX_IMPOSTORS };
  for (const cls of ['near', 'far'] as const) {
    while (limit[cls] < 1 && grid[cls].length < caps[cls]) {
      limit[cls] = Math.min(1, limit[cls] * CAP_MARGIN * caps[cls] / Math.max(1, grid[cls].length));
      grid[cls].length = 0;
      walk((brush, ix, iy, x, y, scale) => addGrid(brush, ix, iy, x, y, scale, cls));
    }
  }
  for (const c of grid.near) near.push(c);
  for (const c of grid.far) far.push(c);

  // Every spot gets at least one prop: a big spot the grid missed gets one at its middle.
  if (bigSpots.some((s) => !s.hit)) {
    seen.fill(0);
    bigSpots.forEach((spot, index) => {
      if (spot.hit) return;
      const id = index + 1;
      let visited = 0, queued = 0, sumI = 0, sumJ = 0;
      stack[queued++] = spot.start;
      seen[spot.start] = 1;
      while (visited < queued) {
        const k = stack[visited++];
        const i = k % size, j = (k - i) / size;
        sumI += i;
        sumJ += j;
        if (i > 0 && !seen[k - 1] && spotOf[k - 1] === id) { seen[k - 1] = 1; stack[queued++] = k - 1; }
        if (i < size - 1 && !seen[k + 1] && spotOf[k + 1] === id) { seen[k + 1] = 1; stack[queued++] = k + 1; }
        if (j > 0 && !seen[k - size] && spotOf[k - size] === id) { seen[k - size] = 1; stack[queued++] = k - size; }
        if (j < size - 1 && !seen[k + size] && spotOf[k + size] === id) { seen[k + size] = 1; stack[queued++] = k + size; }
      }
      placeAtMiddle(spot.brush, spot.start, visited, sumI, sumJ);
    });
  }

  return [...capped(near, MAX_MODELS), ...capped(far, MAX_IMPOSTORS)];
}
