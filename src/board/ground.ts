/**
 * The ground round a map (Board settings → Ground, kept per map): the map on its table as before, or a plane running
 * to the horizon with the map lying on it, tiled with a material of the gallery and shaped by a noise pattern; how
 * thick the distance fog is (off, or 80 to 100); and extra board round the map where minis can stand. Water, lava or
 * acid may run to the horizon instead of ground, each moving and looking as its own settings say. The usable board (the map and its
 * extra board) stays level; past its edge the ground eases into the pattern. Pure, so it is tested without a board.
 */

import { LIQUID_DEFAULTS, readWaterMotion, type LiquidKind, type WaterMotion } from './water';

export type GroundMode = 'board' | 'horizon' | LiquidKind | 'painted';
export const GROUND_MODES: readonly GroundMode[] = ['board', 'horizon', 'water', 'lava', 'acid', 'painted'];
export type GroundNoise = 'flat' | 'gentle' | 'rolling' | 'rough' | 'dunes';

export interface GroundSettings {
  /** The map on its table (frame and floor round it), a plane to the horizon, water, lava or acid to the horizon, or a painted background. */
  mode: GroundMode;
  /** Vault folder of the material the plane is tiled with; unset: plain ground. */
  material?: string;
  /** Vault folder of the saved background the painted ground shows (its mode); unset: none chosen yet. */
  background?: string;
  noise: GroundNoise;
  /** How strongly the pattern shapes the ground, 0 to 1. */
  strength: number;
  /** Distance fog: 0 is none, else `FOG_MIN` (thin) to 100 (thick). */
  fog: number;
  /** Extra board round the map where minis can stand, in grid squares (0 to 100). */
  margin: number;
  /** How many squares one tile of the ground's material spans (1 to 8). */
  tile: number;
  /** The water, lava and acid to the horizon (their modes): how each moves and looks, as painted liquids do. */
  water: WaterMotion;
  lava: WaterMotion;
  acid: WaterMotion;
}

/** The thinnest fog there is: below it the plane's far edge would show. */
export const FOG_MIN = 80;
export const DEFAULT_GROUND: GroundSettings = {
  mode: 'board', noise: 'rolling', strength: 0.5, fog: FOG_MIN, margin: 0, tile: 2,
  water: { ...LIQUID_DEFAULTS.water }, lava: { ...LIQUID_DEFAULTS.lava }, acid: { ...LIQUID_DEFAULTS.acid },
};
export const MAX_TILE = 8;
export const GROUND_NOISES: readonly { value: GroundNoise; label: string }[] = [
  { value: 'flat', label: 'Flat' }, { value: 'gentle', label: 'Gentle hills' }, { value: 'rolling', label: 'Rolling hills' },
  { value: 'rough', label: 'Rough ground' }, { value: 'dunes', label: 'Dunes' },
];
export const MAX_MARGIN = 100;
/** Over how many squares past the usable board's edge the ground eases from level into its pattern. */
export const EASE_SQUARES = 12;

const NOISES = new Set<GroundNoise>(GROUND_NOISES.map((n) => n.value));
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function readGround(raw: unknown): GroundSettings {
  if (!isObj(raw)) return { ...DEFAULT_GROUND, water: { ...DEFAULT_GROUND.water }, lava: { ...DEFAULT_GROUND.lava }, acid: { ...DEFAULT_GROUND.acid } };
  return {
    mode: GROUND_MODES.includes(raw.mode as GroundMode) ? raw.mode as GroundMode : 'board',
    ...(typeof raw.material === 'string' && raw.material !== '' && { material: raw.material }),
    ...(typeof raw.background === 'string' && raw.background !== '' && { background: raw.background }),
    noise: NOISES.has(raw.noise as GroundNoise) ? raw.noise as GroundNoise : DEFAULT_GROUND.noise,
    strength: num(raw.strength) ? clamp(raw.strength, 0, 1) : DEFAULT_GROUND.strength,
    fog: num(raw.fog) ? readFog(raw.fog) : DEFAULT_GROUND.fog,
    margin: num(raw.margin) ? clamp(Math.round(raw.margin), 0, MAX_MARGIN) : DEFAULT_GROUND.margin,
    tile: num(raw.tile) ? clamp(Math.round(raw.tile), 1, MAX_TILE) : DEFAULT_GROUND.tile,
    water: readWaterMotion(raw.water, LIQUID_DEFAULTS.water),
    lava: readWaterMotion(raw.lava, LIQUID_DEFAULTS.lava),
    acid: readWaterMotion(raw.acid, LIQUID_DEFAULTS.acid),
  };
}

/** Fog as kept: off (0 or less), else held to `FOG_MIN`-100 (a thinner fog saved before reads as the thinnest). */
function readFog(fog: number): number {
  const whole = Math.round(fog);
  return whole <= 0 ? 0 : clamp(whole, FOG_MIN, 100);
}

/** Whether the settings are the defaults (nothing to keep). */
export function isDefaultGround(settings: GroundSettings): boolean {
  return JSON.stringify(readGround(settings)) === JSON.stringify(DEFAULT_GROUND);
}

// ── Noise ───────────────────────────────────────────────────────────────────

/** A fixed hash of a lattice point to [0, 1): the same ground every time. */
function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Smooth value noise, -1 to 1. */
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fade(fx), v = fade(fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Octaves of noise, each half as tall and twice as fine; -1 to 1. */
export function fbm(x: number, y: number, octaves: number): number {
  let sum = 0, amp = 1, total = 0, f = 1;
  for (let o = 0; o < octaves; o++) { sum += valueNoise(x * f + o * 17.3, y * f - o * 9.1) * amp; total += amp; amp *= 0.5; f *= 2; }
  return sum / total;
}

/** The pattern's height at (x, y) squares, at full strength (0.5 strength is its usual swing), in squares. */
export function pattern(noise: GroundNoise, x: number, y: number): number {
  switch (noise) {
    case 'gentle': return fbm(x / 42, y / 42, 2) * 4;
    case 'rolling': return fbm(x / 24, y / 24, 3) * 8;
    case 'rough': return fbm(x / 9, y / 9, 5) * 5;
    case 'dunes': {
      // Long crests across the wind, bent by a slow wander.
      const bend = fbm(x / 60, y / 60, 2) * 6;
      const crest = 1 - Math.abs(Math.sin((x * 0.8 + y * 0.6 + bend) / 5));
      return (crest * crest * 2 - 1) * 3 + fbm(x / 30, y / 30, 2) * 2;
    }
    default: return 0;
  }
}

/** How far (x, y) lies outside the rectangle, in its units (0 inside). */
function outside(x: number, y: number, r: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = Math.max(r.x0 - x, 0, x - r.x1), dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(dx, dy);
}

/**
 * The ground's height at (x, y), in grid squares, the usable board (`flat`, in squares) level at 0: past its edge the
 * pattern eases in over `EASE_SQUARES`. Level everywhere on the map's table (the map-board mode).
 */
export function groundHeight(x: number, y: number, settings: GroundSettings, flat: { x0: number; y0: number; x1: number; y1: number }): number {
  if (settings.mode !== 'horizon' || settings.noise === 'flat' || settings.strength <= 0) return 0;
  const d = outside(x, y, flat);
  if (d <= 0) return 0;
  const t = Math.min(1, d / EASE_SQUARES), ease = t * t * (3 - 2 * t);
  return pattern(settings.noise, x, y) * settings.strength * 2 * ease;
}

/** The distance fog's start and end, in world units, for a board whose map is `span` units across; null for none. */
export function fogRange(fog: number, span: number): { near: number; far: number } | null {
  if (fog <= 0) return null;
  const far = span * (2 + (100 - fog) * 0.28);
  return { near: far * 0.25, far };
}

/** How far the plane to the horizon runs from the map's middle without fog, in spans of the map. */
export const REACH_SPANS = 14;
/** How far past where the fog hides everything the plane still runs: a little, so its edge never shows. */
const PAST_FOG = 1.15;

/**
 * How far the plane to the horizon runs from the map's middle, in world units, for a map `span` units across: a little
 * past where the fog hides everything, seen from anywhere over the map, and no further (less to draw); without fog,
 * `REACH_SPANS`.
 */
export function planeReach(fog: number, span: number): number {
  const range = fogRange(fog, span);
  const most = span * REACH_SPANS;
  return range ? Math.min(most, range.far * PAST_FOG + span / 2) : most;
}
