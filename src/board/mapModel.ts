/**
 * An Atlas map file, as the 3D board reads it: the background, the grid, the token settings, and the tokens and pins.
 * Atlas writes `{ version, state }` with the map's elements under `state.objects`, keyed by id. Everything is
 * defaulted the way Atlas defaults it, so a field Atlas left out (an older map, a token never edited) reads as Atlas
 * would draw it. Pure, so it is tested without Obsidian.
 */
import { readLevelAlignment, readMapStretch, type MapStretch } from './mapStretch';
import { readFog, type FogOperation } from './fog';
import { readInitiative, type InitiativeState, type SideId } from './initiative';
import { hasConvertedRoomWalls, readRooms, roomWalls } from './atlasRooms/rooms';
import { readLights, readSceneLighting, readWalls, type BoardLight, type BoardWall, type SceneLighting } from './walls';
import { hiddenResourcesOf, isDefeated, tokenFromFile, type ResourceDefinition, type ResourceValue } from './resources';
import { readMeasures, type BoardMeasure } from './boardMeasures';
import { readLiquids, type BoardLiquid } from './liquids';
import { levelBackground, onLevel, onLevelRecord, readLevels, resolveLevel, type BoardLevel } from './levels';
import { annotationList, tokenHeight, type AnnotationRecords } from '../../packages/atlas-shared/src/index';
import { ownSpeed } from './tokenHeight';

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
  /** How Atlas's grid alignment laid the map image on the world (turned, stretched); unset when it lies as it is. */
  mapStretch?: MapStretch;
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
  /** The side the GM put it on for a fight by sides (a named one in Atlas 0.9), and whether it sees (Atlas takes those for the party). */
  side: SideId | null;
  sees: boolean;
  /**
   * Kept beside the map (Atlas 0.9's `offMap`): a combatant of the scene, in its initiative and with its resources,
   * that is no part of the map. The board neither draws nor shows it; the tracker lists it.
   */
  offMap: boolean;
  /** The level it stands on (Atlas 0.10); null for a scene of one level. */
  levelId: string | null;
  /** How high it stands over its level's floor, in game units (Atlas 0.15's `elevation`, read with `tokenHeight`): 0 on the floor. */
  elevation: number;
  /** Its own speed in game units, set by hand in Atlas 0.15; null where it has none (it then moves by its statblock's, or the rules'). */
  speed: number | null;
  /** On another level than the one shown: it stays in the map for the tracker, but is not drawn. */
  offLevel: boolean;
  /** On a Connect player's board: each bar's colour as Connect worked it out (yellow, then red as it runs low), by key. */
  resourceColors?: Record<string, string>;
  /**
   * On a Connect player's board: a bar the GM shows players without its numbers ('bar', Bar only) or as its number alone
   * ('numbers', Number only), by key; absent for one shown whole.
   */
  resourceShows?: Record<string, 'bar' | 'numbers'>;
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
  /** The name the GM gave it (Atlas 0.14), trimmed and cut to Atlas's 60; null where it has none (named by its note). */
  name?: string | null;
  /** Atlas 0.14's "show name": only then is the name floated over the pin on the map. */
  showName?: boolean;
  /** Players may read its note online (Atlas's "Readable by players"); the GM's board marks it. Never set on a player's board. */
  readable?: boolean;
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
  /** Degrees, clockwise on screen (Atlas 0.16). */
  rotation: number;
  /** Only the GM sees it (Atlas 0.16). */
  hidden: boolean;
  /** Its place in the one order of drawings, texts and stamps (Atlas 0.16): a later one lies over an earlier one. */
  rank: number;
}

/**
 * A drawing of Atlas's draw tool that is no stamp, as Atlas's own reader reads it (`annotationList`): a line through
 * its points, round at its ends and corners, `width` 0 for none; a closed one may be filled (Atlas 0.16), with holes.
 */
export interface BoardInk {
  id: string;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  opacity: number;
  /** It ends where it began: it has an inside. */
  closed: boolean;
  /** Its inside, in its colour: solid, soft (a quarter of it), or none. */
  fill: 'solid' | 'soft' | null;
  holes: Array<Array<{ x: number; y: number }>>;
  /** Only the GM sees it (Atlas 0.16). */
  hidden: boolean;
  /** Its place in the one order of drawings, texts and stamps (Atlas 0.16). */
  rank: number;
  /** On the map's own layer, under the tokens; else above them (Atlas 0.16). */
  layer: 'above' | 'map';
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
  /** Only the GM sees it (Atlas 0.16). */
  hidden: boolean;
  /** Its place in the one order of drawings, texts and stamps (Atlas 0.16). */
  rank: number;
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
  /**
   * Set for a player's map (Connect sends the world, not the file): the world's size and where the image lies in it, as the
   * matrix taking the image's unit square (u right, v down) to the world: x = a·u + c·v + e, y = b·u + d·v + f. Without a
   * matrix the image fills the world.
   */
  world?: { width: number; height: number; matrix?: readonly [number, number, number, number, number, number] };
  /** The scene's levels, bottom first (none for a scene of one level), and the one this map shows. */
  levels: BoardLevel[];
  level: string | null;
  grid: BoardGrid;
  tokenSettings: TokenSettings;
  tokens: BoardToken[];
  pins: BoardPin[];
  icons: BoardIcon[];
  texts: BoardText[];
  /** Atlas's initiative tracker as the file holds it. */
  initiative: InitiativeState;
  /** The drawings that are ink (not icon stamps), in the map's order: later ones lie over earlier ones. */
  inks: BoardInk[];
  /** The fog of war's strokes, as Atlas stores them (`fog.ts` replays them). */
  fog: FogOperation[];
  /** Atlas's walls and doors, its lights (placed, and carried by tokens) and the scene's own light (`walls.ts`). */
  walls: BoardWall[];
  lights: BoardLight[];
  lighting: SceneLighting;
  /** Atlas's grid object as stored, for the measuring fields read when the map has no collection rules. */
  rawGrid: unknown;
  /**
   * Atlas's kept measures on the level shown, as it stores them (`boardMeasures.ts`): its areas and rulers, and the
   * templates and spells this board and Connect keep there.
   */
  measures: BoardMeasure[];
  /** The ids of the measures on the scene's other levels: they stand, though this map does not show them. */
  measuresElsewhere: string[];
  /** Atlas's liquids on the level shown (`liquids.ts`): the water the board's brush painted, and what Atlas made itself. */
  liquids: BoardLiquid[];
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
  const mapStretch = readMapStretch(grid.mapStretch);
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
    ...(mapStretch ? { mapStretch } : {}),
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
    side: typeof token.side === 'string' && token.side !== '' ? token.side : null,
    offMap: token.offMap === true,
    levelId: null,
    elevation: tokenHeight(token),
    speed: ownSpeed(token.speed),
    offLevel: false,
    sees: isObj(token.vision) && token.vision.enabled === true,
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
    name: typeof pin.name === 'string' && pin.name.trim() !== '' ? pin.name.trim().slice(0, 60) : null,
    ...(pin.showName === true ? { showName: true } : {}),
    ...(pin.readable === true ? { readable: true } : {}),
  };
}

/** Atlas's icon stamps are one cell (70 px) across unless the drawing says otherwise. */
const ICON_SIZE = 70;

/**
 * The drawings and texts of a level as Atlas's own reader reads them (`annotationList`, Atlas 0.16's, which reads 0.15's
 * records too): in the order Atlas draws them; an old eraser stroke, a drawing of a type it does not know, an empty text
 * passed over; stamps apart from the other drawings.
 */
function readAnnotations(drawings: unknown, texts: unknown): { icons: BoardIcon[]; inks: BoardInk[]; texts: BoardText[] } {
  const out = { icons: [] as BoardIcon[], inks: [] as BoardInk[], texts: [] as BoardText[] };
  const records = { drawings: isObj(drawings) ? drawings : undefined, texts: isObj(texts) ? texts : undefined } as AnnotationRecords;
  for (const [rank, annotation] of annotationList(records).entries()) {
    if (annotation.kind === 'text') {
      if (annotation.text === '') continue;
      out.texts.push({
        id: annotation.id, x: annotation.x, y: annotation.y, text: annotation.text, fontSize: annotation.fontSize, fontFamily: annotation.fontFamily,
        color: annotation.color, backgroundColor: annotation.backgroundColor, padding: annotation.padding, borderRadius: annotation.borderRadius,
        opacity: annotation.opacity, align: annotation.align, bold: annotation.bold, italic: annotation.italic, rotation: annotation.rotation,
        scale: annotation.scale, hidden: annotation.hidden, rank,
      });
    } else if (annotation.shape === 'stamp') {
      const at = annotation.points[0];
      if (!at || !annotation.icon) continue;
      out.icons.push({ id: annotation.id, icon: annotation.icon, x: at.x, y: at.y, color: annotation.color, size: annotation.width, opacity: annotation.opacity, rotation: annotation.rotation, hidden: annotation.hidden, rank });
    } else {
      out.inks.push({
        id: annotation.id, points: annotation.points.map(({ x, y }) => ({ x, y })), color: annotation.color, width: annotation.width, opacity: annotation.opacity,
        closed: annotation.closed, fill: annotation.fill, holes: annotation.holes.map((ring) => ring.map(({ x, y }) => ({ x, y }))), hidden: annotation.hidden,
        rank, layer: annotation.layer,
      });
    }
  }
  return out;
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

/** The grid with the shown level's own alignment laid over the scene's stretch, as Atlas does (null level: the scene's own). */
export function alignedGrid(grid: BoardGrid, alignments: unknown, level: string | null): BoardGrid {
  const own = level !== null && typeof alignments === 'object' && alignments !== null ? readLevelAlignment((alignments as Record<string, unknown>)[level]) : undefined;
  if (own === undefined) return grid;
  const { mapStretch: _scene, ...rest } = grid;
  return own === null ? rest : { ...rest, mapStretch: own };
}

/** Reads an `.atlasmap` file's text. Throws when it is not an Atlas map. */
/**
 * Each level's own alignment, by level id: a scene file keeps it on the level (`levels[i].alignment`), Atlas's memory
 * (and an older file) in `levelAlignments`, which wins where both have one.
 */
export function levelAlignmentsOf(alignments: unknown, levels: unknown): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (Array.isArray(levels)) {
    for (const level of levels) {
      if (typeof level === 'object' && level !== null && typeof (level as { id?: unknown }).id === 'string' && (level as { alignment?: unknown }).alignment !== undefined) {
        out[(level as { id: string }).id] = (level as { alignment: unknown }).alignment;
      }
    }
  }
  if (typeof alignments === 'object' && alignments !== null && !Array.isArray(alignments)) Object.assign(out, alignments);
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A map as its file has it: the text is parsed, then read as Atlas's state is (`readMapState`). */
export function readMap(path: string, text: string, viewedLevel?: string | null): BoardMap {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not an Atlas map');
  }
  return readMapState(path, isObj(parsed) ? parsed.state : null, viewedLevel);
}

/** What of Atlas's state the board draws; a change of anything else (the camera, the selection, a tool, a tray) changes nothing here. */
export const MAP_STATE_KEYS = ['mapPath', 'background', 'grid', 'objects', 'levels', 'levelAlignments', 'viewedLevel', 'lighting', 'initiative', 'tokenSettings'] as const;

/** Whether the board's picture of the map may have changed between two states of Atlas's store (which replaces what it changes). */
export function mapStateChanged(prev: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>): boolean {
  return MAP_STATE_KEYS.some((key) => prev[key] !== next[key]);
}

/**
 * Atlas's kept measures (`objects.measures`) as a map of the level `level` has them: those on it, and the ids of those
 * on the scene's other levels.
 */
export function readMapMeasures(raw: unknown, level: string | null, levels: readonly BoardLevel[]): Pick<BoardMap, 'measures' | 'measuresElsewhere'> {
  const measures = readMeasures(onLevelRecord(raw, level, levels));
  const shown = new Set(measures.map((measure) => measure.id));
  return { measures, measuresElsewhere: level === null ? [] : readMeasures(raw).map((measure) => measure.id).filter((id) => !shown.has(id)) };
}

/**
 * A map as Atlas holds it: the `state` of a map file, or the state of the store of the Atlas view that has the map
 * loaded (the same shape, with tokens' resources in their in-memory form and the levels' alignments apart).
 */
export function readMapState(path: string, given: unknown, viewedLevel?: string | null): BoardMap {
  const state = isObj(given) ? given : null;
  if (!state || !isObj(state.objects)) throw new Error('not an Atlas map');
  const levels = readLevels(state.levels);
  const level = resolveLevel(levels, viewedLevel);
  const here = (record: unknown): unknown => onLevelRecord(record, level, levels);
  const objects = state.objects;
  const tokens = items(objects.tokens).map((raw) => {
    const token = readToken(raw);
    if (!token) return null;
    if (level === null) return token;
    const on = onLevel(raw, level, levels);
    return { ...token, levelId: resolveLevel(levels, raw.level), offLevel: !on };
  }).filter((token): token is BoardToken => token !== null);
  const annotations = readAnnotations(here(objects.drawings), here(objects.texts));
  return {
    path,
    background: levelBackground(str(state.background), levels, level),
    levels,
    level,
    grid: alignedGrid(readGrid(state.grid), levelAlignmentsOf(state.levelAlignments, state.levels), level),
    tokenSettings: readTokenSettings(state.tokenSettings),
    tokens,
    pins: items(here(objects.pins)).map(readPin).filter((pin): pin is BoardPin => pin !== null),
    icons: annotations.icons,
    texts: annotations.texts,
    initiative: readInitiative(state.initiative),
    inks: annotations.inks,
    fog: readFog(here(objects.fog)),
    // A 0.14 file Atlas 0.15 has not saved yet: the outline of the shown rooms on this level stands as solid walls (all
    // outside is rock). Once the walls hold 0.15's room walls the rooms are those walls, and no outline is added.
    walls: [...readWalls(here(objects.walls)), ...(hasConvertedRoomWalls(objects.walls) ? [] : readWalls(Object.fromEntries(roomWalls(readRooms(here(objects.rooms))).map((wall) => [wall.id, wall]))))],
    lights: readLights(here(objects.lights), here(objects.tokens)),
    lighting: readSceneLighting(state.lighting),
    rawGrid: state.grid ?? null,
    ...readMapMeasures(objects.measures, level, levels),
    liquids: readLiquids(here(objects.liquids)),
  };
}
