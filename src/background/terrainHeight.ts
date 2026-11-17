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
  COUNT.fill(0);
  PAINTED.fill(0);
  for (const [ox, oy] of RINGS) {
    const at = pixelAt(frame, x + ox, y + oy), kind = terrainIndex(layers.terrain[at]);
    COUNT[kind]++;
    PAINTED[kind] += layers.height[at] / 255;
  }
  let sum = 0;
  for (let k = 0; k < COUNT.length; k++) {
    if (COUNT[k] > 0) sum += typeHeight(TERRAINS[k].id, x, y, settings, PAINTED[k] / COUNT[k]) * COUNT[k];
  }
  return sum / RINGS.length * ease;
}
