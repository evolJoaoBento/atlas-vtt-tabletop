import { LIQUID_DEFAULTS, LIQUID_KINDS, readWaterMotion, type LiquidKind, type WaterMotion } from '../board/water';

/** How many cells a painted background is across and down. */
export const BACKGROUND_SIZE = 2048;
/** How many custom patterns a background can hold. */
export const MAX_PATTERNS = 4;
/** How many ground materials a background can hold. */
export const MAX_MATERIALS = 4;

/** The kinds of ground (and liquid) a cell of the background can be painted as. */
export type TerrainId =
  | 'plains' | 'gentle' | 'rolling' | 'rough' | 'dunes'
  | 'custom1' | 'custom2' | 'custom3' | 'custom4'
  | 'topography' | 'water' | 'lava' | 'acid';

/** Every terrain in the order its number is stored in the terrain layer, with its name and the colour it is shown in. */
export const TERRAINS: readonly { id: TerrainId; index: number; label: string; color: string }[] = [
  { id: 'plains', index: 0, label: 'Plains', color: '#9bb06a' },
  { id: 'gentle', index: 1, label: 'Gentle hills', color: '#7fae5a' },
  { id: 'rolling', index: 2, label: 'Rolling hills', color: '#4f9a4a' },
  { id: 'rough', index: 3, label: 'Rough ground', color: '#8a7a5c' },
  { id: 'dunes', index: 4, label: 'Dunes', color: '#e0c27a' },
  { id: 'custom1', index: 5, label: 'Custom 1', color: '#c9654f' },
  { id: 'custom2', index: 6, label: 'Custom 2', color: '#b05fc4' },
  { id: 'custom3', index: 7, label: 'Custom 3', color: '#4fb0c4' },
  { id: 'custom4', index: 8, label: 'Custom 4', color: '#d4a02f' },
  { id: 'topography', index: 9, label: 'Painted topography', color: '#8c8c8c' },
  { id: 'water', index: 10, label: 'Water', color: LIQUID_DEFAULTS.water.tint },
  { id: 'lava', index: 11, label: 'Lava', color: LIQUID_DEFAULTS.lava.tint },
  { id: 'acid', index: 12, label: 'Acid', color: LIQUID_DEFAULTS.acid.tint },
];

/** The terrain a stored number stands for; a number nobody knows is plains. */
export function terrainOf(index: number): TerrainId {
  return TERRAINS.find((t) => t.index === index)?.id ?? 'plains';
}

/** The shape a custom pattern gives its hills. */
export type PatternShape = 'smooth' | 'ridged' | 'terraced' | 'craters';
const PATTERN_SHAPES: readonly PatternShape[] = ['smooth', 'ridged', 'terraced', 'craters'];

/** A ground pattern the user designs: how big its features are, how tall, how rough, and what shape. */
export interface CustomPattern {
  name: string;
  /** How wide one feature is, in squares (4 to 200). */
  scale: number;
  /** How tall the pattern rises, in squares (0 to 40). */
  height: number;
  /** How much fine detail it has, a whole number from 1 to 6. */
  roughness: number;
  shape: PatternShape;
}

/** How many prop brushes a background can hold. */
export const MAX_BRUSHES = 6;
/** How many different props one brush can scatter. */
export const MAX_BRUSH_PROPS = 4;

/** A prop brush: the 3D models it scatters where it is painted, how thick they stand and how big they are. */
export interface PropBrush {
  name: string;
  /** Vault paths of the `.glb` models the brush picks from (up to 4). */
  props: string[];
  /** How many props stand in each square (0.1 to 200). */
  density: number;
  /** How big the props are compared to their natural size (0.1 to 20). */
  scale: number;
}

/** The settings of a painted background, saved with the map. */
export interface BackgroundSettings {
  v: 1;
  name: string;
  patterns: CustomPattern[];
  /** Vault folder paths of the ground materials the painted material layer chooses from. */
  materials: string[];
  /** The lowest and highest the painted topography reaches, in squares. */
  height: { low: number; high: number };
  liquids: Record<LiquidKind, WaterMotion>;
  /** The prop brushes the painted props layer chooses from. */
  props: PropBrush[];
}

/** A background with nothing painted or chosen yet. */
export const DEFAULT_BACKGROUND: BackgroundSettings = {
  v: 1,
  name: 'Background',
  patterns: [],
  materials: [],
  height: { low: -2, high: 6 },
  liquids: { water: LIQUID_DEFAULTS.water, lava: LIQUID_DEFAULTS.lava, acid: LIQUID_DEFAULTS.acid },
  props: [],
};

function number(raw: unknown, fallback: number, min: number, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(max, Math.max(min, raw)) : fallback;
}

function readName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().slice(0, 60) : '';
  return name || DEFAULT_BACKGROUND.name;
}

function readPattern(raw: unknown): CustomPattern {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  return {
    name: readName(value.name),
    scale: number(value.scale, 40, 4, 200),
    height: number(value.height, 6, 0, 40),
    roughness: Math.round(number(value.roughness, 3, 1, 6)),
    shape: PATTERN_SHAPES.includes(value.shape as PatternShape) ? value.shape as PatternShape : 'smooth',
  };
}

/** What a vault brush may name: a `.glb` path. */
function isVaultModel(path: string): boolean {
  return path !== '' && path.toLowerCase().endsWith('.glb');
}

/** What a brush on the wire may name: a model's asset id (any non-empty text of up to 200 letters). */
export function isWireModel(id: string): boolean {
  return id !== '' && id.length <= 200;
}

function readBrush(raw: unknown, index: number, model: (path: string) => boolean): PropBrush {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 60) : '';
  const paths = Array.isArray(value.props)
    ? value.props.filter((p): p is string => typeof p === 'string' && model(p))
    : [];
  return {
    name: name || `Props ${index + 1}`,
    props: [...new Set(paths)].slice(0, MAX_BRUSH_PROPS),
    density: number(value.density, 10, 0.1, 200),
    scale: number(value.scale, 1, 0.1, 20),
  };
}

/**
 * Reads saved background settings, forgiving anything missing or wrong: values are clamped, extras dropped, a reversed height range swapped.
 * `model` says which texts a brush may name as a model: a vault `.glb` path (the default), or, on a player's board, an asset id (`isWireModel`).
 */
export function readBackgroundSettings(raw: unknown, model: (path: string) => boolean = isVaultModel): BackgroundSettings {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const patterns = Array.isArray(value.patterns) ? value.patterns.slice(0, MAX_PATTERNS).map(readPattern) : [];
  const materials = Array.isArray(value.materials)
    ? value.materials.filter((m): m is string => typeof m === 'string' && m !== '').slice(0, MAX_MATERIALS)
    : [];
  const range = typeof value.height === 'object' && value.height !== null ? value.height as Record<string, unknown> : {};
  const a = number(range.low, DEFAULT_BACKGROUND.height.low, -100, 100);
  const b = number(range.high, DEFAULT_BACKGROUND.height.high, -100, 100);
  const liquids = typeof value.liquids === 'object' && value.liquids !== null ? value.liquids as Record<string, unknown> : {};
  const read = {} as Record<LiquidKind, WaterMotion>;
  for (const kind of LIQUID_KINDS) read[kind] = readWaterMotion(liquids[kind], LIQUID_DEFAULTS[kind]);
  const props = Array.isArray(value.props) ? value.props.slice(0, MAX_BRUSHES).map((brush, index) => readBrush(brush, index, model)) : [];
  return { v: 1, name: readName(value.name), patterns, materials, height: { low: Math.min(a, b), high: Math.max(a, b) }, liquids: read, props };
}

/** The painted layers of a background, one byte per cell. */
export interface BackgroundLayers {
  size: number;
  /** Which terrain each cell is (`TERRAINS` index). */
  terrain: Uint8Array;
  /** Which of the background's materials each cell shows. */
  material: Uint8Array;
  /** The painted topography, 0 (the lowest) to 255 (the highest); 128 is mid. */
  height: Uint8Array;
  /** Which prop brush each cell is painted with: 0 for none, 1 for the first brush, and so on. */
  props: Uint8Array;
}

/** A background read for the board: what was painted, and the materials its slots name, as `readMaterial` takes them (null where the folder is gone). */
export interface LoadedBackground {
  settings: BackgroundSettings;
  layers: BackgroundLayers;
  materials: (string | null)[];
}

/** Fresh layers: all plains, the first material, mid height. */
export function emptyLayers(size: number = BACKGROUND_SIZE): BackgroundLayers {
  return { size, terrain: new Uint8Array(size * size), material: new Uint8Array(size * size), height: new Uint8Array(size * size).fill(128), props: new Uint8Array(size * size) };
}
