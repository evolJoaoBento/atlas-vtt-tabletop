/**
 * An Atlas map file, as the 3D board reads it: the background, the grid, the token settings, and the tokens and pins.
 * Atlas writes `{ version, state }` with the map's elements under `state.objects`, keyed by id. Everything is
 * defaulted the way Atlas defaults it, so a field Atlas left out (an older map, a token never edited) reads as Atlas
 * would draw it. Pure, so it is tested without Obsidian.
 */

export type GridType = 'square' | 'hex-vertical' | 'hex-horizontal';

export interface BoardGrid {
  enabled: boolean;
  visible: boolean;
  snap: boolean;
  type: GridType;
  /** A cell's width in world pixels (flat to flat on a hex grid). */
  size: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  lineWidth: number;
  /** Null when Atlas picks black or white from the map's brightness. */
  color: string | null;
  /** Atlas's lines: solid, dashed (two dashes per cell edge) or dotted (a mark at each corner). */
  lineType: 'solid' | 'dashed' | 'dotted';
  /** How cells are numbered (`cellNumbers`, or `hexNumbers` in older Atlas), and how strongly; null when not. */
  numbers: CellNumbering | null;
  numberOpacity: number;
}

export type CellNumbering = 'column-row' | 'sequential' | 'letter-number';

export interface Meter {
  current: number;
  max: number;
}

export interface BoardToken {
  id: string;
  /** The token's centre, in the background image's pixels. */
  x: number;
  y: number;
  /** Atlas's size: a token covers `2 * size - 1` cells across. */
  size: number;
  /** Degrees, clockwise on screen. */
  rotation: number;
  imagePath: string | null;
  /** Only characters carry a nameplate, bars and conditions. */
  kind: 'character' | 'token';
  name: string | null;
  hidden: boolean;
  showRing: boolean;
  ringColor: string;
  showNameplate: boolean;
  hp: Meter | null;
  stress: Meter | null;
  conditions: string[];
  conditionValues: Record<string, number>;
  /** The stat block's tracked values (AC, slots, …), those with a maximum, in the file's order. */
  resources: Array<{ key: string } & Meter>;
  instanceNumber: number | null;
  /** The note holding the token's stat block, when it is linked to one. */
  statblockPath: string | null;
}

export interface BoardPin {
  id: string;
  x: number;
  y: number;
  /** A vault path, with an optional `#heading`. */
  notePath: string | null;
  icon: string;
  /** What a `number` or `letter` pin shows. */
  label: string | null;
  /** Drawn at the centre of its hex on a hex grid. */
  hex: boolean;
}

export interface TokenSettings {
  showNameplates: boolean;
  showHPBars: boolean;
  showStressBars: boolean;
  showInstanceBadges: boolean;
  /** Resource keys the GM hid from the tokens (Atlas's `hiddenResources`). */
  hiddenResources: string[];
}

export interface BoardMap {
  path: string;
  background: string | null;
  grid: BoardGrid;
  tokenSettings: TokenSettings;
  tokens: BoardToken[];
  pins: BoardPin[];
}

type Raw = Record<string, unknown>;

const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
const items = (value: unknown): Raw[] => (isObj(value) ? Object.values(value).filter(isObj) : []);

/** Atlas's old default grid colour, which it reads as "not set". */
const LEGACY_GRID_COLOR = '#00ffff';
const DEFAULT_GRID_SIZE = 70;
/** A bare number for HP is out of 100, as Atlas reads it. */
const BARE_HP_MAX = 100;
const DEFAULT_MAX_STRESS = 10;

function readNumbering(value: unknown): CellNumbering | null {
  return value === 'column-row' || value === 'sequential' || value === 'letter-number' ? value : null;
}

function readGrid(raw: unknown): BoardGrid {
  const grid = isObj(raw) ? raw : {};
  const type: GridType = grid.type === 'hex-vertical' || grid.type === 'hex-horizontal' ? grid.type : 'square';
  const color = str(grid.color);
  return {
    enabled: bool(grid.enabled, true),
    visible: bool(grid.visible, true),
    snap: bool(grid.snapToGrid, true),
    type,
    size: num(grid.size, DEFAULT_GRID_SIZE) > 0 ? num(grid.size, DEFAULT_GRID_SIZE) : DEFAULT_GRID_SIZE,
    offsetX: num(grid.offsetX, 0),
    offsetY: num(grid.offsetY, 0),
    opacity: num(grid.opacity, 0.7),
    lineWidth: num(grid.lineWidth, 1),
    color: color && color.toLowerCase() !== LEGACY_GRID_COLOR ? color : null,
    lineType: grid.lineType === 'dashed' || grid.lineType === 'dotted' ? grid.lineType : 'solid',
    numbers: readNumbering(grid.cellNumbers ?? grid.hexNumbers),
    numberOpacity: num(grid.cellNumberOpacity ?? grid.hexNumberOpacity, 0.8),
  };
}

function readMeter(raw: unknown, bareMax: number, maxFallback?: unknown): Meter | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return { current: raw, max: num(maxFallback, bareMax) };
  if (!isObj(raw)) return null;
  return { current: num(raw.current, 0), max: num(raw.max, bareMax) };
}

function readName(token: Raw): string | null {
  const name = str(token.name);
  if (name) return name;
  if (!str(token.statblockPath)) return null;
  return str(token.statblockName) ?? 'Unknown Creature';
}

function readToken(token: Raw): BoardToken | null {
  const id = str(token.id);
  if (!id) return null;
  const conditions = Array.isArray(token.conditions) ? token.conditions.filter((value): value is string => typeof value === 'string') : [];
  const conditionValues: Record<string, number> = {};
  if (isObj(token.conditionValues)) for (const [key, value] of Object.entries(token.conditionValues)) if (typeof value === 'number') conditionValues[key] = value;
  const resources: BoardToken['resources'] = [];
  if (isObj(token.statblockResources)) {
    for (const [key, value] of Object.entries(token.statblockResources)) {
      const meter = readMeter(value, 0);
      if (meter && meter.max > 0) resources.push({ key, ...meter });
    }
  }
  return {
    id,
    x: num(token.x, 0),
    y: num(token.y, 0),
    size: num(token.size, 1) > 0 ? num(token.size, 1) : 1,
    rotation: num(token.rotation, 0),
    imagePath: str(token.imagePath),
    kind: token.kind === 'character' ? 'character' : 'token',
    name: readName(token),
    hidden: token.isHidden === true,
    showRing: token.showRing !== false,
    ringColor: str(token.ringColor) ?? '#ffffff',
    showNameplate: token.showNameplate === true,
    hp: readMeter(token.hp, BARE_HP_MAX),
    stress: readMeter(token.stress, DEFAULT_MAX_STRESS, token.maxStress),
    conditions,
    conditionValues,
    resources,
    instanceNumber: typeof token.instanceNumber === 'number' ? token.instanceNumber : null,
    statblockPath: str(token.statblockPath),
  };
}

function readPin(pin: Raw): BoardPin | null {
  const id = str(pin.id);
  if (!id) return null;
  return {
    id,
    x: num(pin.x, 0),
    y: num(pin.y, 0),
    notePath: str(pin.notePath),
    icon: str(pin.icon) ?? 'pin',
    label: typeof pin.label === 'string' ? pin.label : null,
    hex: pin.hex === true,
  };
}

function readTokenSettings(raw: unknown): TokenSettings {
  const settings = isObj(raw) ? raw : {};
  return {
    showNameplates: settings.showNameplates === true,
    showHPBars: settings.showHPBars !== false,
    showStressBars: settings.showStressBars === true,
    showInstanceBadges: settings.showInstanceBadges !== false,
    hiddenResources: Array.isArray(settings.hiddenResources) ? settings.hiddenResources.filter((value): value is string => typeof value === 'string') : [],
  };
}

/** Reads an `.atlasmap` file's text. Throws when it is not an Atlas map. */
export function readMap(path: string, text: string): BoardMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not an Atlas map');
  }
  const state = isObj(parsed) && isObj(parsed.state) ? parsed.state : null;
  if (!state || !isObj(state.objects)) throw new Error('not an Atlas map');
  const objects = state.objects;
  return {
    path,
    background: str(state.background),
    grid: readGrid(state.grid),
    tokenSettings: readTokenSettings(state.tokenSettings),
    tokens: items(objects.tokens).map(readToken).filter((token): token is BoardToken => token !== null),
    pins: items(objects.pins).map(readPin).filter((pin): pin is BoardPin => pin !== null),
  };
}
