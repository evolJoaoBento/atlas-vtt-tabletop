/**
 * An Atlas map file, as the 3D board reads it: the background, the grid, the token settings, and the tokens and pins.
 * Atlas writes `{ version, state }` with the map's elements under `state.objects`, keyed by id. Everything is
 * defaulted the way Atlas defaults it, so a field Atlas left out (an older map, a token never edited) reads as Atlas
 * would draw it. Pure, so it is tested without Obsidian.
 */
import { readFog, type FogOperation } from './fog';
import { hiddenResourcesOf, isDefeated, tokenFromFile, type ResourceDefinition, type ResourceValue } from './resources';

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

export type Meter = ResourceValue;

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
  conditions: string[];
  conditionValues: Record<string, number>;
  /** Its resources (HP, stress, AC, slots…) by key, as Atlas 0.8 holds them in memory; see `resources.ts`. */
  resources: Record<string, Meter>;
  /** Keys whose maximum was set by hand. */
  overriddenMax: string[];
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

/** An icon stamp from Atlas's draw tool: a Lucide glyph lying on the map. */
export interface BoardIcon {
  id: string;
  /** Atlas's icon id (door-open, lock, trap…). */
  icon: string;
  /** Its centre, in map pixels, and its width. */
  x: number;
  y: number;
  color: string;
  size: number;
  opacity: number;
}

/** A pen stroke (or line, rectangle, circle) of Atlas's draw tool: a line through its points, round at ends and corners. */
export interface BoardInk {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  opacity: number;
}

/** A text label on the map, as Atlas draws it: centred on its place, turned and scaled; read-only on the board. */
export interface BoardText {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  /** The box behind it, or null for none. */
  backgroundColor: string | null;
  padding: number;
  borderRadius: number;
  /** How strongly the box shows (Atlas applies it to the box, not the letters). */
  opacity: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
  /** Degrees, clockwise on screen. */
  rotation: number;
  scale: number;
}

export interface TokenSettings {
  showNameplates: boolean;
  showInstanceBadges: boolean;
  /** Resource keys the map hides from its tokens, the two old bar switches read in (Atlas's `hiddenResources`). */
  hiddenResources: string[];
}

export interface BoardMap {
  path: string;
  background: string | null;
  grid: BoardGrid;
  tokenSettings: TokenSettings;
  tokens: BoardToken[];
  pins: BoardPin[];
  icons: BoardIcon[];
  texts: BoardText[];
  /** The tokens in Atlas's initiative tracker. */
  initiativeTokens: string[];
  /** The drawings that are ink (not icon stamps), in the map's order: later ones lie over earlier ones. */
  inks: BoardInk[];
  /** The fog of war's strokes, as Atlas stores them (`fog.ts` replays them). */
  fog: FogOperation[];
  /** Atlas's grid object as stored, for the measuring fields read when the map has no collection rules. */
  rawGrid: unknown;
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
    // Older Atlas numbered hex grids only (`hexNumbers`); newer Atlas numbers any grid (`cellNumbers`).
    numbers: readNumbering(grid.cellNumbers ?? (type === 'square' ? undefined : grid.hexNumbers)),
    numberOpacity: num(grid.cellNumberOpacity ?? grid.hexNumberOpacity, 0.8),
  };
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
  const held = tokenFromFile(token);
  const resources: Record<string, Meter> = {};
  if (isObj(held.resources)) {
    for (const [key, value] of Object.entries(held.resources)) {
      if (isObj(value) && typeof value.current === 'number' && typeof value.max === 'number') resources[key] = { current: value.current, max: value.max };
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
    conditions,
    conditionValues,
    resources,
    overriddenMax: Array.isArray(held.overriddenMax) ? held.overriddenMax.filter((key): key is string => typeof key === 'string') : [],
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

/** Atlas's icon stamps are one cell (70 px) across unless the drawing says otherwise. */
const ICON_SIZE = 70;

function readIcon(drawing: Raw): BoardIcon | null {
  const id = str(drawing.id);
  const icon = str(drawing.icon);
  const point = Array.isArray(drawing.points) && isObj(drawing.points[0]) ? drawing.points[0] : null;
  if (drawing.type !== 'icon' || !id || !icon || !point) return null;
  return {
    id, icon, x: num(point.x, 0), y: num(point.y, 0),
    color: str(drawing.color) ?? '#ffffff', size: num(drawing.width, ICON_SIZE), opacity: num(drawing.opacity, 1),
  };
}

function readInk(drawing: Raw): BoardInk | null {
  const id = str(drawing.id);
  if (!id || drawing.type === 'icon' || !Array.isArray(drawing.points)) return null;
  const points = drawing.points.filter(isObj).map((point) => ({ x: num(point.x, NaN), y: num(point.y, NaN) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (points.length === 0) return null;
  return { id, points, color: str(drawing.color) ?? '#ffffff', width: num(drawing.width, 4) > 0 ? num(drawing.width, 4) : 4, opacity: num(drawing.opacity, 1) };
}

/** Atlas's defaults for a text: 24 px, centred, a box padded by 8 when it has one. */
function readText(raw: Raw): BoardText | null {
  const id = str(raw.id);
  const text = str(raw.text);
  if (!id || !text) return null;
  return {
    id, x: num(raw.x, 0), y: num(raw.y, 0), text,
    fontSize: num(raw.fontSize, 24) > 0 ? num(raw.fontSize, 24) : 24,
    fontFamily: str(raw.fontFamily) ?? 'Arial',
    color: str(raw.color) ?? '#ffffff',
    backgroundColor: str(raw.backgroundColor),
    // Atlas reads 0 as unset for these two (`padding || 8`, `opacity || 1`).
    padding: num(raw.padding, 0) || 8,
    borderRadius: num(raw.borderRadius, 0),
    opacity: num(raw.opacity, 0) || 1,
    align: raw.align === 'left' || raw.align === 'right' ? raw.align : 'center',
    bold: raw.bold === true,
    italic: raw.italic === true,
    rotation: num(raw.rotation, 0),
    scale: num(raw.scale, 0) || 1,
  };
}

function readTokenSettings(raw: unknown): TokenSettings {
  const settings = isObj(raw) ? raw : {};
  return {
    showNameplates: settings.showNameplates === true,
    showInstanceBadges: settings.showInstanceBadges !== false,
    hiddenResources: hiddenResourcesOf(settings),
  };
}

/**
 * A creature with a resource that defeats it spent (HP at 0, in most games), as Atlas reads it: greyed out with a
 * skull. 0/0 is a stat block without hit points, not a dead creature.
 */
export function isDowned(token: BoardToken, definitions: readonly ResourceDefinition[]): boolean {
  return token.kind === 'character' && isDefeated(token, definitions);
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
    icons: items(objects.drawings).map(readIcon).filter((icon): icon is BoardIcon => icon !== null),
    texts: items(objects.texts).map(readText).filter((text): text is BoardText => text !== null),
    initiativeTokens: isObj(state.initiative) && Array.isArray(state.initiative.entries)
      ? state.initiative.entries.filter(isObj).map((entry) => str(entry.tokenId)).filter((id): id is string => id !== null)
      : [],
    inks: items(objects.drawings).map(readInk).filter((ink): ink is BoardInk => ink !== null),
    fog: readFog(objects.fog),
    rawGrid: state.grid ?? null,
  };
}
