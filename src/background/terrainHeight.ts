/**
 * How high the ground of a painted background is. Each cell of the picture says what kind of ground it is; this works
 * out the height of that ground at any point, softens the borders between kinds, and keeps the usable board level.
 * Pure, so it is tested without a board.
 */

import { EASE_SQUARES, fbm, pattern, planeReach } from '../board/ground';
import { BACKGROUND_SIZE, TERRAINS, terrainOf, type BackgroundLayers, type BackgroundSettings, type CustomPattern, type TerrainId } from './backgroundData';

/** Where the picture lies: the map's middle and how many squares wide it is, and how many cells across. */
export interface BackgroundFrame {
  /** The map's middle, in squares from its top-left corner. */
  cx: number;
  cy: number;
  /** How wide (and tall) the picture is, in squares. */
  extent: number;
  /** How many cells the picture is across. */
  size: number;
}

/** How far below the board the bed of water, lava or acid lies, in squares. */
export const LIQUID_BED = 2.5;
/** How far, in squares, the farthest points mixed in to soften a border lie from the point asked about. */
const BLEND = 6;
/**
 * Shores. The liquid's sheet runs `BANK_REACH` squares past the painted shore, over a shelf of land lying just under its
 * surface (`SHELF`), so what shows is the sheet's own soft edge: never a ledge floating over lower ground, never the
 * ground's coarse grid cutting the surface. A little past the sheet's edge (`SHELF_REACH`) the land eases to its own
 * height over `SHORE_EASE` squares, up to higher ground or down to lower, smoothly either way. Under the liquid the bed
 * starts at the shelf and deepens to `LIQUID_BED` over `SHORE_EASE` squares.
 */
export const BANK_REACH = 1;
const SHELF_REACH = 1.5;
const SHELF = -0.05;
const SHORE_EASE = 6;

type Rect = { x0: number; y0: number; x1: number; y1: number };

/** The picture for a map `mapWidth` by `mapHeight` pixels with cells `cell` pixels wide: as wide as the plane to the horizon. */
export function backgroundFrame(mapWidth: number, mapHeight: number, cell: number, size: number = BACKGROUND_SIZE): BackgroundFrame {
  return {
    cx: mapWidth / cell / 2,
    cy: mapHeight / cell / 2,
    extent: 2 * planeReach(80, Math.max(mapWidth, mapHeight)) / cell,
    size,
  };
}

/** The index in a layer of the cell that square (x, y) lies in; past the picture's edge the edge cell continues. */
export function pixelAt(frame: BackgroundFrame, x: number, y: number): number {
  const last = frame.size - 1;
  const at = (v: number, centre: number): number => {
    const cell = Math.floor((v - (centre - frame.extent / 2)) / frame.extent * frame.size);
    return Math.min(last, Math.max(0, Number.isFinite(cell) ? cell : 0));
  };
  return at(y, frame.cy) * frame.size + at(x, frame.cx);
}

/** A fixed hash of a lattice point to [0, 1). */
function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How far (0 to about 1.4) the nearest of the points scattered one to each lattice cell lies from (x, y), in cells. */
function cellDistance(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let best = Infinity;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = ix + dx, cy = iy + dy;
    best = Math.min(best, Math.hypot(cx + hash(cx, cy) - x, cy + hash(cy + 91, cx - 37) - y));
  }
  return best;
}

/** The height of a custom pattern at (x, y), in squares. */
function customHeight(p: CustomPattern, x: number, y: number): number {
  const u = x / p.scale, v = y / p.scale;
  switch (p.shape) {
    case 'ridged': return (1 - Math.abs(fbm(u, v, p.roughness))) * p.height;
    case 'terraced': {
      // Zero to the full height, in four whole steps.
      const level = Math.round((fbm(u, v, p.roughness) * 0.5 + 0.5) * 4) / 4;
      return level * p.height;
    }
    case 'craters': {
      // A bowl round each scattered point, with the ground between left at 0, and a little roughness.
      const d = cellDistance(u, v);
      const bowl = d < 0.45 ? 1 - (d / 0.45) ** 2 : 0;
      return -bowl * p.height + fbm(u * 4, v * 4, p.roughness) * p.height * 0.05;
    }
    default: return fbm(u, v, p.roughness) * p.height;
  }
}

/**
 * The height, in squares, of one kind of ground at (x, y): the same hills the Ground settings offer, a custom pattern,
 * the painted topography (`height01` is the painted value, 0 to 1), or the bed of a liquid.
 */
export function typeHeight(id: TerrainId, x: number, y: number, settings: BackgroundSettings, height01: number): number {
  switch (id) {
    case 'gentle': case 'rolling': case 'rough': case 'dunes': return pattern(id, x, y);
    case 'custom1': case 'custom2': case 'custom3': case 'custom4': {
      const p = settings.patterns[Number(id.slice(6)) - 1];
      return p ? customHeight(p, x, y) : 0;
    }
    case 'topography': return settings.height.low + height01 * (settings.height.high - settings.height.low);
    case 'water': case 'lava': case 'acid': return -LIQUID_BED;
    default: return 0;
  }
}

/** Where a stored terrain number sits in `TERRAINS`; a number nobody knows is plains. */
const terrainIndex = (stored: number): number => Math.max(0, TERRAINS.findIndex((t) => t.id === terrainOf(stored)));

/** The points mixed in round the point asked about: its own, then rings of eight at a sixth, a half and the whole of `BLEND` squares. */
const RINGS: readonly (readonly [number, number])[] = (() => {
  const points: [number, number][] = [[0, 0]];
  // Each ring is turned a little, so the points do not line up and cross a border one by one, not together.
  [BLEND / 6, BLEND / 2, BLEND].forEach((radius, ring) => {
    for (let k = 0; k < 8; k++) {
      const angle = k * Math.PI / 4 + 0.3 + ring * 0.37;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
  });
  return points;
})();
const COUNT = new Float64Array(TERRAINS.length), PAINTED = new Float64Array(TERRAINS.length);

/** Whether a kind of ground (its place in `TERRAINS`) is a liquid. */
const LIQUID_KINDS = new Set(['water', 'lava', 'acid']);
const IS_LIQUID = TERRAINS.map((t) => LIQUID_KINDS.has(t.id));
const isLiquidCell = (stored: number): boolean => IS_LIQUID[terrainIndex(stored)] === true;

/** Each picture's shore field, made once per terrain layer. */
const SHORES = new WeakMap<Uint8Array, Float32Array>();

/**
 * How far each cell of the picture lies from the shore, in cells: positive on land (the way to the nearest liquid),
 * negative in a liquid (the way to the nearest land); `Infinity` on land in a picture with no liquid (and minus that
 * in one with no land). Two passes of a chamfer distance, so it costs a few times the picture's size, once.
 */
export function shoreField(layers: BackgroundLayers): Float32Array {
  const known = SHORES.get(layers.terrain);
  if (known && known.length === layers.size * layers.size) return known;
  const { size, terrain } = layers;
  const n = size * size;
  const liquid = new Uint8Array(n);
  for (let k = 0; k < n; k++) liquid[k] = isLiquidCell(terrain[k]) ? 1 : 0;
  // Distance to the nearest cell of the other side, worked out for land and for liquid at once.
  const dist = new Float32Array(n).fill(Infinity);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = j * size + i, me = liquid[k];
    if ((i > 0 && liquid[k - 1] !== me) || (i < size - 1 && liquid[k + 1] !== me) || (j > 0 && liquid[k - size] !== me) || (j < size - 1 && liquid[k + size] !== me)) dist[k] = 0.5;
  }
  const D = Math.SQRT2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const k = j * size + i;
    let d = dist[k];
    if (i > 0) d = Math.min(d, dist[k - 1] + 1);
    if (j > 0) {
      d = Math.min(d, dist[k - size] + 1);
      if (i > 0) d = Math.min(d, dist[k - size - 1] + D);
      if (i < size - 1) d = Math.min(d, dist[k - size + 1] + D);
    }
    dist[k] = d;
  }
  for (let j = size - 1; j >= 0; j--) for (let i = size - 1; i >= 0; i--) {
    const k = j * size + i;
    let d = dist[k];
    if (i < size - 1) d = Math.min(d, dist[k + 1] + 1);
    if (j < size - 1) {
      d = Math.min(d, dist[k + size] + 1);
      if (i < size - 1) d = Math.min(d, dist[k + size + 1] + D);
      if (i > 0) d = Math.min(d, dist[k + size - 1] + D);
    }
    dist[k] = d;
  }
  for (let k = 0; k < n; k++) if (liquid[k]) dist[k] = -dist[k];
  SHORES.set(layers.terrain, dist);
  return dist;
}

/** The shore field at square (x, y), in squares, read smoothly between cells (past the picture's edge its edge continues). */
function shoreAt(field: Float32Array, frame: BackgroundFrame, x: number, y: number): number {
  const { size, extent } = frame;
  const fx = (x - (frame.cx - extent / 2)) / extent * size - 0.5, fy = (y - (frame.cy - extent / 2)) / extent * size - 0.5;
  const clamp = (v: number): number => Math.min(size - 1, Math.max(0, v));
  const x0 = Math.floor(clamp(fx)), y0 = Math.floor(clamp(fy));
  const x1 = Math.min(size - 1, x0 + 1), y1 = Math.min(size - 1, y0 + 1);
  const tx = clamp(fx) - x0, ty = clamp(fy) - y0;
  const a = field[y0 * size + x0], b = field[y0 * size + x1], c = field[y1 * size + x0], d = field[y1 * size + x1];
  // A cell far from any shore (infinite) is read as it is: no mixing with finite neighbours.
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) return field[(tx < 0.5 ? y0 : y1) * size + (tx < 0.5 ? x0 : x1)] * extent / size;
  const v = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  return v * extent / size;
}

const smooth = (from: number, to: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/**
 * The ground's height at (x, y), in squares from the map's top-left corner. Borders between kinds are softened: the
 * kinds of ground found at the point and round it (within `BLEND` squares) are mixed in as many parts as they are
 * found, so no border is a cliff. The usable board (`flat`) is level at 0, and past its edge the ground eases in over
 * `EASE_SQUARES`, as the plain Ground settings do.
 */
export function backgroundHeight(x: number, y: number, settings: BackgroundSettings, layers: BackgroundLayers, frame: BackgroundFrame, flat: Rect): number {
  const dx = Math.max(flat.x0 - x, 0, x - flat.x1), dy = Math.max(flat.y0 - y, 0, y - flat.y1);
  const d = Math.hypot(dx, dy);
  if (d <= 0) return 0;
  const t = Math.min(1, d / EASE_SQUARES), ease = t * t * (3 - 2 * t);
  // How far the shore is: under a liquid its bed deepens away from the shore; on land, near a liquid, a low bank.
  const shore = shoreAt(shoreField(layers), frame, x, y);
  if (shore < 0) return (SHELF - (LIQUID_BED + SHELF) * smooth(0, SHORE_EASE, -shore)) * Math.max(ease, shelfEase(shore));
  // The land: the kinds of land at the point and round it, mixed in as many parts as they are found (liquids left out).
  COUNT.fill(0);
  PAINTED.fill(0);
  let found = 0;
  for (const [ox, oy] of RINGS) {
    const at = pixelAt(frame, x + ox, y + oy), kind = terrainIndex(layers.terrain[at]);
    if (IS_LIQUID[kind]) continue;
    COUNT[kind]++;
    PAINTED[kind] += layers.height[at] / 255;
    found++;
  }
  let land = 0;
  for (let k = 0; k < COUNT.length; k++) {
    if (COUNT[k] > 0) land += typeHeight(TERRAINS[k].id, x, y, settings, PAINTED[k] / COUNT[k]) * COUNT[k];
  }
  land = found > 0 ? land / found : SHELF;
  // Near the shore the land comes to the shelf, up from lower ground or down from higher, smoothly either way. The board's
  // own ease (level ground at its edge) does not lift the shelf: the shelf stays under the sheet.
  const toShelf = 1 - smooth(SHELF_REACH, SHELF_REACH + SHORE_EASE, shore);
  const own = land * ease;
  return own + (SHELF - own) * toShelf;
}

/** Near the shore the bed keeps its shelf even by the board, so the sheet there lies over it as everywhere else. */
const shelfEase = (shore: number): number => 1 - smooth(0, 1, -shore);
