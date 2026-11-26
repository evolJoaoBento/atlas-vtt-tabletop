/**
 * What the board remembers per map besides the minis: how each token without a mini is shown (a disc, the default, or
 * a standee), the props standing on the map, how tall its fog of war stands, the material painted on each wall and
 * door, the prop a door is replaced with, how high each light hangs, and how bright the board's ambient light is.
 * It also records which maps are elevation layers of another (a balcony, an upper floor), and how high. Kept in
 * Tabletop's own data, never in the map file. Follows vault renames and deletions the way the mini assignments
 * do. Pure, so it is tested without Obsidian.
 */

import { readSavedTable, type SavedArTable } from '../arTable';
import { readWaterMotion, type SavedWaterMask, type WaterMotion } from './water';
import { NO_PLACEMENT, readPlacement, type Placement } from './layerPlacement';
import type { LegacyExtras } from './recordExtras';
import type { Frame, MemberMove } from './stackMove';

/** A member's point in its base's pixels (`stackMove.ts` `moveOf`, here without its module's weight). */
const moveOf = (frame: Frame) => (point: { x: number; y: number }): { x: number; y: number } => ({ x: point.x * frame.k + frame.x, y: point.y * frame.k + frame.y });
import { dropShotMaps, readCutscenes, renameShotMaps, type Cutscene } from '../cutscene/cutsceneData';
import { readShapes, type TerrainShape } from './terrainShapes';
import { isDefaultGround, readGround, type GroundSettings } from './ground';
import { reachToNext, type BoardLevel } from './levels';

export type TokenStyle = 'disc' | 'standee';

export interface PropPlacement {
  readonly id: string;
  /** Vault path of the prop's GLB. */
  readonly glb: string;
  /** Where it stands, in the map image's pixels. */
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise seen from above. */
  readonly rotation: number;
  readonly scale: number;
  /** Tokens set on it stand on its top (its shape under them), not on the floor. */
  readonly solid?: boolean;
  /** How high it stands over what is under it, in grid squares (a prop that is not solid, raised by Alt + drag). */
  readonly lift?: number;
  /** The scene level it stands on (Atlas levels); unset is the first, as for Atlas's own objects. */
  readonly level?: string;
}

export interface MapData {
  styles?: Record<string, TokenStyle>;
  props?: PropPlacement[];
  /** How tall the fog stands, in grid squares; kept only when it is not the default. */
  fogHeight?: number;
  /** Walls with no height of their own reach the level above (less a millimetre) instead of the fog height, where there is one. */
  wallsReachNext?: true;
  /** Wall (or door) id to the vault folder of the material painted on it. */
  wallMaterials?: Record<string, string>;
  /** Door id to the vault path of the prop GLB that stands in for its leaf. */
  doorProps?: Record<string, string>;
  /** Wall (or door) id to its own height, in grid squares; unset stands it as tall as the fog. */
  wallHeights?: Record<string, number>;
  /** Wall or door id to its own width (thickness), in grid squares; absent: the map's wall thickness. */
  wallWidths?: Record<string, number>;
  /** Light id (or the id of the token carrying it) to its height above the map, in grid squares. */
  lightHeights?: Record<string, number>;
  /** Window (a wall Atlas lets only sight and light through) id to its opening, in grid squares from the floor. */
  windows?: Record<string, { bottom: number; top: number }>;
  /** Door id to how it was turned from the way Atlas draws it: its hinge at the other end, and/or opening to the other side. */
  doorFlips?: Record<string, { hinge?: true; side?: true }>;
  /** How thick its walls stand, as a share of a grid square; kept only when it is not the default. */
  wallThickness?: number;
  /** This map is a layer of another, standing above it (or below, if negative). */
  layer?: ElevationLayer;
  /** This layer is not drawn on the boards of its stack (the GM hid it); it stays in the stack. */
  hidden?: true;
  /**
   * Water painted over the map before it was kept as Atlas's liquids (`liquids.ts`): its mask and how it moved. Read
   * only, until the map's water is moved (`legacyWater`).
   */
  water?: { mask: SavedWaterMask; motion?: WaterMotion };
  /** The map's painted water was moved to Atlas's liquids: done once. */
  waterMoved?: true;
  /** On a base scene: its stack is being written as Atlas levels (`stackMove.ts`); what Tabletop's side needs to finish the move. Gone once it is done. */
  stackJournal?: StackJournal;
  /** Where the players' printed AR marker sheets lie on this map (`arTable.ts`). */
  arTable?: SavedArTable;
  /** Cinematic cutscenes made in this map (their shots may look at other maps). */
  cutscenes?: Cutscene[];
  /** Raised shapes drawn on its levels (roofs, hills: `terrainShapes.ts`). */
  shapes?: TerrainShape[];
  /** The ground round it (`ground.ts`): kept only when it is not the default. */
  ground?: GroundSettings;
  /** The settings of this map's 0.14 room walls were looked for and moved to Atlas 0.15's room walls: done once. */
  roomWallsMoved?: true;
  /** What the GM set in 3D on walls, doors and lights (the seven records above) was moved onto Atlas's own records: done once. */
  extrasMoved?: true;
}

/** The records of a map's data that held 3D settings by Atlas's ids, before they moved onto Atlas's records. */
export const LEGACY_EXTRAS = ['wallMaterials', 'doorProps', 'wallHeights', 'wallWidths', 'lightHeights', 'windows', 'doorFlips'] as const;

/** A stack's move to Atlas levels, as far as Tabletop's own data needs it: the base's level and each member's (its level, the ids given anew, its frame). */
export interface StackJournal {
  baseLevel: string;
  /** Where the base's own pixels lie now, when the whole scene was set aside by whole squares; unset: where they were. */
  baseFrame?: Frame;
  members: MemberMove[];
}

function readFrame(raw: unknown): Frame | undefined {
  if (!isObj(raw)) return undefined;
  const { k, x, y } = raw;
  return typeof k === 'number' && typeof x === 'number' && typeof y === 'number' && Number.isFinite(k + x + y) && k > 0 ? { k, x, y } : undefined;
}

function readJournal(raw: unknown): StackJournal | undefined {
  if (!isObj(raw) || typeof raw.baseLevel !== 'string' || raw.baseLevel === '' || !Array.isArray(raw.members)) return undefined;
  const members: MemberMove[] = [];
  for (const entry of raw.members) {
    if (!isObj(entry) || typeof entry.path !== 'string' || typeof entry.level !== 'string') return undefined;
    const frame = readFrame(entry.frame);
    if (!frame) return undefined;
    const ids: MemberMove['ids'] = {};
    for (const [kind, table] of Object.entries(isObj(entry.ids) ? entry.ids : {})) {
      if (!isObj(table)) continue;
      ids[kind] = Object.fromEntries(Object.entries(table).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
    }
    members.push({ path: entry.path, level: entry.level, ids, frame });
  }
  const baseFrame = readFrame(raw.baseFrame);
  return { baseLevel: raw.baseLevel, ...(baseFrame ? { baseFrame } : {}), members };
}

/** A map stacked on another: the base map's path, and how many grid squares above it this one stands. */
export interface ElevationLayer {
  readonly base: string;
  readonly elevation: number;
  /** Where it stands on the plane beyond its height (a shift and a turn, in the base scene's frame); absent when it is where its grid puts it. */
  readonly x?: number;
  readonly y?: number;
  readonly turn?: number;
}

/** One map of a stack, with its height above the base map in grid squares. */
export interface StackMember {
  readonly path: string;
  readonly elevation: number;
  /** Where it stands on the plane (the base scene's is none). */
  readonly placement: Placement;
}

/** Fog stands one square tall unless the GM says otherwise. */
export const DEFAULT_FOG_HEIGHT = 1;

/** Walls stand an eighth of a square thick or so unless the GM says otherwise. */
export const DEFAULT_WALL_THICKNESS = 0.12;

export type BoardDataJSON = Record<string, MapData>;

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** How a prop is set up, apart from where it stands: its size, whether tokens stand on it, how high it stands. */
export interface PropLook {
  readonly scale: number;
  readonly solid?: boolean;
  readonly lift?: number;
}

/** A prop saved as a variant: a model with its look, placed from the gallery as it was saved. */
export interface PropVariant extends PropLook {
  readonly id: string;
  readonly name: string;
  readonly glb: string;
}

/** The variants kept in the settings, the broken ones left out. */
export function readVariants(raw: unknown): PropVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: PropVariant[] = [];
  for (const item of raw) {
    if (!isObj(item) || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.glb !== 'string' || item.glb === '') continue;
    const lift = finite(item.lift, 0);
    out.push({ id: item.id, name: item.name, glb: item.glb, scale: finite(item.scale, 1), ...(item.solid === true ? { solid: true } : {}), ...(lift > 0 ? { lift } : {}) });
  }
  return out;
}

/** The look a prop placed with `look` gets: its scale, and solid and height only when set. */
export function lookOf(look: PropLook | undefined): Pick<PropPlacement, 'scale' | 'solid' | 'lift'> {
  if (!look) return { scale: 1 };
  return { scale: look.scale, ...(look.solid ? { solid: true } : {}), ...(look.lift && look.lift > 0 ? { lift: look.lift } : {}) };
}

function readProp(raw: unknown): PropPlacement | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.glb !== 'string' || raw.glb === '') return null;
  const lift = finite(raw.lift, 0);
  return { id: raw.id, glb: raw.glb, x: finite(raw.x, 0), y: finite(raw.y, 0), rotation: finite(raw.rotation, 0), scale: finite(raw.scale, 1), ...(raw.solid === true ? { solid: true } : {}), ...(lift > 0 ? { lift } : {}), ...(typeof raw.level === 'string' && raw.level !== '' ? { level: raw.level } : {}) };
}

/** Drops empty parts, so a map with nothing left is not kept. */
function tidy(map: MapData): MapData | null {
  const out: MapData = {};
  if (map.styles && Object.keys(map.styles).length > 0) out.styles = map.styles;
  if (map.props && map.props.length > 0) out.props = map.props;
  if (map.fogHeight !== undefined && map.fogHeight !== DEFAULT_FOG_HEIGHT) out.fogHeight = map.fogHeight;
  if (map.wallsReachNext === true) out.wallsReachNext = true;
  if (map.wallMaterials && Object.keys(map.wallMaterials).length > 0) out.wallMaterials = map.wallMaterials;
  if (map.doorProps && Object.keys(map.doorProps).length > 0) out.doorProps = map.doorProps;
  if (map.lightHeights && Object.keys(map.lightHeights).length > 0) out.lightHeights = map.lightHeights;
  if (map.wallHeights && Object.keys(map.wallHeights).length > 0) out.wallHeights = map.wallHeights;
  if (map.wallWidths && Object.keys(map.wallWidths).length > 0) out.wallWidths = map.wallWidths;
  if (map.windows && Object.keys(map.windows).length > 0) out.windows = map.windows;
  if (map.doorFlips && Object.keys(map.doorFlips).length > 0) out.doorFlips = map.doorFlips;
  if (map.wallThickness !== undefined && map.wallThickness !== DEFAULT_WALL_THICKNESS) out.wallThickness = map.wallThickness;
  if (map.layer) out.layer = map.layer;
  if (map.hidden === true) out.hidden = true;
  if (map.water) out.water = map.water;
  if (map.waterMoved === true) out.waterMoved = true;
  if (map.stackJournal) out.stackJournal = map.stackJournal;
  if (map.arTable) out.arTable = map.arTable;
  if (map.cutscenes && map.cutscenes.length > 0) out.cutscenes = map.cutscenes;
  if (map.shapes && map.shapes.length > 0) out.shapes = map.shapes;
  if (map.ground && !isDefaultGround(map.ground)) out.ground = map.ground;
  if (map.roomWallsMoved === true) out.roomWallsMoved = true;
  if (map.extrasMoved === true) out.extrasMoved = true;
  return Object.keys(out).length > 0 ? out : null;
}

/** The string values of a record, the others dropped. */
function strings(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'string' && value !== '') out[key] = value;
  return out;
}

/** The light heights: numbers from 0 up. */
function widths(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  return out;
}

function heights(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  return out;
}

/** Painted water as saved: a mask's size and run lengths, and its motion (read again, with defaults, by the board). */
function readWater(raw: unknown): { mask: SavedWaterMask; motion?: WaterMotion } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { mask, motion } = raw as { mask?: Partial<SavedWaterMask>; motion?: unknown };
  if (!mask || typeof mask.width !== 'number' || typeof mask.height !== 'number' || typeof mask.data !== 'string') return undefined;
  return { mask: { width: mask.width, height: mask.height, data: mask.data }, ...(motion !== undefined && { motion: readWaterMotion(motion) }) };
}

function readLayer(raw: unknown): ElevationLayer | undefined {
  if (!(isObj(raw) && typeof raw.base === 'string' && raw.base !== '' && typeof raw.elevation === 'number' && Number.isFinite(raw.elevation))) return undefined;
  const placement = readPlacement(raw);
  return { base: raw.base, elevation: raw.elevation, ...(placement && { x: placement.x, y: placement.y, turn: placement.turn }) };
}

/** The door turns kept: only the ones that turn something. */
function windows(raw: unknown): Record<string, { bottom: number; top: number }> {
  const out: Record<string, { bottom: number; top: number }> = {};
  if (!isObj(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const { bottom, top } = value;
    if (typeof bottom === 'number' && typeof top === 'number' && Number.isFinite(bottom) && Number.isFinite(top) && bottom >= 0 && top > bottom) out[id] = { bottom, top };
  }
  return out;
}

function flips(raw: unknown): Record<string, { hinge?: true; side?: true }> {
  const out: Record<string, { hinge?: true; side?: true }> = {};
  if (!isObj(raw)) return out;
  for (const [id, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const kept = { ...(value.hinge === true && { hinge: true as const }), ...(value.side === true && { side: true as const }) };
    if (Object.keys(kept).length > 0) out[id] = kept;
  }
  return out;
}

/** What `readBoardData` found of the boards' own light levels and tints (no longer kept), by the data it returned. */
const legacyLighting = new WeakMap<BoardDataJSON, Record<string, { ambient?: number; tint?: string }>>();

/** Reads saved data, dropping anything malformed. Only standees are stored: a disc is the default. */
export function readBoardData(raw: unknown): BoardDataJSON {
  const out: BoardDataJSON = {};
  if (!isObj(raw)) return out;
  for (const [path, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const styles: Record<string, TokenStyle> = {};
    if (isObj(value.styles)) for (const [id, style] of Object.entries(value.styles)) if (style === 'standee') styles[id] = style;
    const props = Array.isArray(value.props) ? value.props.map(readProp).filter((prop): prop is PropPlacement => prop !== null) : [];
    const fogHeight = typeof value.fogHeight === 'number' && Number.isFinite(value.fogHeight) && value.fogHeight >= 0 ? value.fogHeight : undefined;
    // A light level and a tint of the board's own (before Atlas 0.15's lighting was the board's): kept apart, to be backed up once.
    const ambient = typeof value.ambient === 'number' && value.ambient >= 0 && value.ambient <= 1 ? value.ambient : undefined;
    const tint = typeof value.tint === 'string' && /^#[0-9a-f]{6}$/i.test(value.tint) ? value.tint.toLowerCase() : undefined;
    if (ambient !== undefined || tint !== undefined) legacyLighting.set(out, { ...(legacyLighting.get(out) ?? {}), [path]: { ...(ambient !== undefined && { ambient }), ...(tint !== undefined && { tint }) } });
    const wallThickness = typeof value.wallThickness === 'number' && Number.isFinite(value.wallThickness) && value.wallThickness > 0 ? value.wallThickness : undefined;
    const layer = readLayer(value.layer);
    const arTable = readSavedTable(value.arTable);
    const cutscenes = readCutscenes(value.cutscenes);
    const kept = tidy({
      ...(arTable && { arTable }),
      cutscenes,
      shapes: readShapes(value.shapes),
      ...(isObj(value.ground) && { ground: readGround(value.ground) }),
      styles, props, ...(layer && { layer }), ...(value.hidden === true && { hidden: true as const }), ...(readWater(value.water) && { water: readWater(value.water)! }), ...(fogHeight !== undefined && { fogHeight }), ...(value.wallsReachNext === true && { wallsReachNext: true as const }),
      wallMaterials: strings(value.wallMaterials), doorProps: strings(value.doorProps), lightHeights: heights(value.lightHeights),
      wallHeights: heights(value.wallHeights), wallWidths: widths(value.wallWidths), windows: windows(value.windows), doorFlips: flips(value.doorFlips),
      ...(wallThickness !== undefined && { wallThickness }),
      ...(value.roomWallsMoved === true && { roomWallsMoved: true as const }),
      ...(value.extrasMoved === true && { extrasMoved: true as const }),
      ...(value.waterMoved === true && { waterMoved: true as const }),
      ...(readJournal(value.stackJournal) && { stackJournal: readJournal(value.stackJournal)! }),
    });
    if (kept) out[path] = kept;
  }
  return out;
}

export class BoardData {
  private data: BoardDataJSON;
  private readonly listeners = new Set<(mapPath: string | null) => void>();

  private legacy: Record<string, { ambient?: number; tint?: string }>;

  constructor(initial: BoardDataJSON = {}) {
    this.data = initial;
    this.legacy = legacyLighting.get(initial) ?? {};
  }

  toJSON(): BoardDataJSON {
    if (Object.keys(this.legacy).length === 0) return this.data;
    // The old light levels and tints, not yet backed up, are saved as they were.
    const out: Record<string, MapData> = { ...this.data };
    for (const [path, lighting] of Object.entries(this.legacy)) out[path] = { ...(out[path] ?? {}), ...lighting } as MapData;
    return out;
  }

  onChange(listener: (mapPath: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(mapPath: string | null): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(mapPath);
      } catch (error) {
        console.error('[Tabletop] A board data listener failed:', error);
      }
    }
  }

  private put(mapPath: string, map: MapData): void {
    const kept = tidy(map);
    const next = { ...this.data };
    if (kept) next[mapPath] = kept;
    else delete next[mapPath];
    this.data = next;
    this.changed(mapPath);
  }

  /** The map's board data as it stands (records are never changed in place, so it serves as an undo snapshot). */
  snapshot(mapPath: string): MapData | undefined {
    return this.data[mapPath];
  }

  /** Puts back the map's board data as a snapshot held it (an undo or redo). */
  restore(mapPath: string, map: MapData | undefined): void {
    if (this.data[mapPath] === map) return;
    const next = { ...this.data };
    // What a migration did is never taken back with an older step: the settings it moved onto Atlas's records do not
    // come back into this data (they would be moved again, over what was changed since), and its marks stay.
    const now = this.data[mapPath];
    if (now?.extrasMoved === true || now?.roomWallsMoved === true || now?.waterMoved === true) {
      const kept: MapData = { ...(map ?? {}) };
      if (now.extrasMoved === true) { for (const key of LEGACY_EXTRAS) delete kept[key]; kept.extrasMoved = true; }
      if (now.waterMoved === true) { delete kept.water; kept.waterMoved = true; }
      if (now.roomWallsMoved === true) {
        kept.roomWallsMoved = true;
        // The re-keyed records are the ones that count; an older step knows them under the old names.
        if (now.extrasMoved !== true) for (const key of ['wallHeights', 'wallWidths', 'wallMaterials', 'windows'] as const) { if (now[key] !== undefined) (kept as Record<string, unknown>)[key] = now[key]; else delete kept[key]; }
      }
      map = kept;
    }
    if (map) next[mapPath] = map;
    else delete next[mapPath];
    this.data = next;
    this.changed(mapPath);
  }

  style(mapPath: string, tokenId: string): TokenStyle {
    return this.data[mapPath]?.styles?.[tokenId] ?? 'disc';
  }

  setStyle(mapPath: string, tokenId: string, style: TokenStyle): void {
    if (this.style(mapPath, tokenId) === style) return;
    const map = this.data[mapPath] ?? {};
    const styles = { ...(map.styles ?? {}) };
    if (style === 'disc') delete styles[tokenId];
    else styles[tokenId] = style;
    this.put(mapPath, { ...map, styles });
  }

  /** How tall the map's fog stands, in grid squares. */
  fogHeight(mapPath: string): number {
    return this.data[mapPath]?.fogHeight ?? DEFAULT_FOG_HEIGHT;
  }

  setFogHeight(mapPath: string, height: number): void {
    if (!Number.isFinite(height) || height < 0 || this.fogHeight(mapPath) === height) return;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), fogHeight: height });
  }

  /** Whether the map's walls with no height of their own reach the level above. */
  wallsReachNext(mapPath: string): boolean {
    return this.data[mapPath]?.wallsReachNext === true;
  }

  setWallsReachNext(mapPath: string, on: boolean): void {
    if (this.wallsReachNext(mapPath) === on) return;
    const { wallsReachNext: _was, ...rest } = this.data[mapPath] ?? {};
    this.put(mapPath, on ? { ...rest, wallsReachNext: true } : rest);
  }

  /**
   * How tall a wall with no height of its own stands on a level (and the fog with it), in grid squares: up to the level
   * above less a millimetre when the map's walls reach it and there is one, else the map's fog height.
   */
  defaultWallHeight(mapPath: string, levels: readonly BoardLevel[], levelId: string | null, unitDistance: number): number {
    return this.wallReach(mapPath, levels, levelId, unitDistance) ?? this.fogHeight(mapPath);
  }

  /** How high walls on a level may stand, in grid squares, when the map's walls reach the level above; null when they do not (or it is the top). */
  wallReach(mapPath: string, levels: readonly BoardLevel[], levelId: string | null, unitDistance: number): number | null {
    return this.wallsReachNext(mapPath) ? reachToNext(levels, levelId, unitDistance) : null;
  }

  /** How thick the map's walls stand, as a share of a grid square. */
  wallThickness(mapPath: string): number {
    return this.data[mapPath]?.wallThickness ?? DEFAULT_WALL_THICKNESS;
  }

  /** None or less is no wall at all: refused, as is anything not a number. */
  setWallThickness(mapPath: string, thickness: number): void {
    if (!Number.isFinite(thickness) || thickness <= 0 || this.wallThickness(mapPath) === thickness) return;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), wallThickness: thickness });
  }

  /** Every wall id this map keeps a height, a width, a material or a window opening under. */
  wallKeys(mapPath: string): Set<string> {
    const map = this.data[mapPath];
    return new Set([map?.wallHeights, map?.wallWidths, map?.wallMaterials, map?.windows].flatMap((record) => Object.keys(record ?? {})));
  }

  /** Whether this map's 0.14 room-wall settings were already looked for (`moveWallKeys`). */
  roomWallsMoved(mapPath: string): boolean {
    return this.data[mapPath]?.roomWallsMoved === true;
  }

  /**
   * Moves what is kept under each `from` wall id (height, width, material, window opening) to its `to`: every `to`
   * of a `from` gets a copy, then the `from` keys go. Marks the map as done, so it is done once. Returns the number of
   * settings moved (one per record and `from` that had one).
   */
  moveWallKeys(mapPath: string, moves: ReadonlyArray<{ from: string; to: string }>): number {
    const map = this.data[mapPath] ?? {};
    let moved = 0;
    const carry = <V>(record: Record<string, V> | undefined): Record<string, V> | undefined => {
      if (!record) return record;
      const next = { ...record };
      const gone = new Set<string>();
      for (const { from, to } of moves) {
        if (!Object.hasOwn(record, from)) continue;
        next[to] = record[from] as V;
        gone.add(from);
      }
      for (const from of gone) delete next[from];
      moved += gone.size;
      return next;
    };
    const next: MapData = { ...map, roomWallsMoved: true };
    for (const key of ['wallHeights', 'wallWidths', 'wallMaterials', 'windows'] as const) {
      const carried = carry(map[key] as Record<string, never> | undefined);
      if (carried) (next as Record<string, unknown>)[key] = carried;
    }
    this.put(mapPath, next);
    return moved;
  }

  /**
   * What this map still keeps of the GM's 3D settings of walls, doors and lights from before they moved onto Atlas's
   * own records (`recordExtras.ts`): read only, as a fallback while the map was not moved yet; null once it was.
   * The same object until the map's data changes.
   */
  legacyExtras(mapPath: string): LegacyExtras | null {
    const map = this.data[mapPath];
    return map && map.extrasMoved !== true && LEGACY_EXTRAS.some((key) => map[key] !== undefined) ? map : null;
  }

  /** The map's 3D settings were moved onto Atlas's records (or it had none Atlas still knows): its seven records go, once. */
  clearLegacyExtras(mapPath: string): void {
    const map = this.data[mapPath];
    if (!map || (map.extrasMoved === true && LEGACY_EXTRAS.every((key) => map[key] === undefined))) return;
    const next: MapData = { ...map, extrasMoved: true };
    for (const key of LEGACY_EXTRAS) delete next[key];
    this.put(mapPath, next);
  }

  /**
   * The light levels and tints the boards once kept of their own, by map. The board's light is Atlas's scene lighting
   * now, so nothing reads them; they stay in what is saved until a backup of them is written (`dropLegacyLighting`),
   * so that nothing is lost should the backup fail.
   */
  legacyLighting(): Record<string, { ambient?: number; tint?: string }> {
    return this.legacy;
  }

  /** Stops keeping the old light levels and tints: called once their backup is written. */
  dropLegacyLighting(): void {
    if (Object.keys(this.legacy).length === 0) return;
    this.legacy = {};
    this.changed(null);
  }

  /** Where the players' AR marker sheets lie on the map; null for none. */
  arTable(mapPath: string): SavedArTable | null {
    return this.data[mapPath]?.arTable ?? null;
  }

  /** Keeps (or with null forgets) where the players' AR marker sheets lie on the map. */
  setArTable(mapPath: string, table: SavedArTable | null): void {
    const map = { ...(this.data[mapPath] ?? {}) };
    if (table) map.arTable = table;
    else delete map.arTable;
    this.put(mapPath, map);
  }

  /** The ground round this map (its defaults until set). */
  ground(mapPath: string): GroundSettings {
    return this.data[mapPath]?.ground ?? readGround(undefined);
  }

  setGround(mapPath: string, settings: GroundSettings): void {
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), ground: readGround(settings) });
  }

  /** The raised shapes drawn on this map's levels. */
  shapes(mapPath: string): readonly TerrainShape[] {
    return this.data[mapPath]?.shapes ?? [];
  }

  /** Keeps a shape: a new one, or the one of its id replaced. */
  saveShape(mapPath: string, shape: TerrainShape): void {
    const map = this.data[mapPath] ?? {};
    const all = map.shapes ?? [];
    const shapes = all.some((s) => s.id === shape.id) ? all.map((s) => (s.id === shape.id ? shape : s)) : [...all, shape];
    this.put(mapPath, { ...map, shapes });
  }

  removeShape(mapPath: string, id: string): void {
    const map = this.data[mapPath];
    if (!map?.shapes?.some((s) => s.id === id)) return;
    this.put(mapPath, { ...map, shapes: map.shapes.filter((s) => s.id !== id) });
  }

  /** The cutscenes made in this map. */
  cutscenesOf(mapPath: string): readonly Cutscene[] {
    return this.data[mapPath]?.cutscenes ?? [];
  }

  /** Keeps a cutscene in this map: replaces the one with its id, or adds it at the end. */
  putCutscene(mapPath: string, cutscene: Cutscene): void {
    const map = this.data[mapPath] ?? {};
    const all = map.cutscenes ?? [];
    const cutscenes = all.some((c) => c.id === cutscene.id) ? all.map((c) => (c.id === cutscene.id ? cutscene : c)) : [...all, cutscene];
    this.put(mapPath, { ...map, cutscenes });
  }

  removeCutscene(mapPath: string, id: string): void {
    const map = this.data[mapPath];
    if (!map?.cutscenes?.some((c) => c.id === id)) return;
    this.put(mapPath, { ...map, cutscenes: map.cutscenes.filter((c) => c.id !== id) });
  }


  props(mapPath: string): readonly PropPlacement[] {
    return this.data[mapPath]?.props ?? [];
  }

  addProp(mapPath: string, prop: Omit<PropPlacement, 'id'>): PropPlacement {
    const placed: PropPlacement = { ...prop, id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    const map = this.data[mapPath] ?? {};
    this.put(mapPath, { ...map, props: [...(map.props ?? []), placed] });
    return placed;
  }

  moveProp(mapPath: string, id: string, x: number, y: number): void {
    const map = this.data[mapPath];
    if (!map?.props?.some((prop) => prop.id === id)) return;
    // The prop moved goes last: dropped on a solid one, it stands on top of it.
    const moved = map.props.find((prop) => prop.id === id)!;
    this.put(mapPath, { ...map, props: [...map.props.filter((prop) => prop.id !== id), { ...moved, x, y }] });
  }

  /** The map this one is a layer of, and how high it stands above it; null for a map that is not a layer. */
  layerOf(mapPath: string): ElevationLayer | null {
    return this.data[mapPath]?.layer ?? null;
  }

  /**
   * The water painted on this map before it was kept as Atlas's liquids: its mask and motion, read only, as a fallback
   * while the map's water was not moved yet; null once it was, or without any.
   */
  legacyWater(mapPath: string): { mask: SavedWaterMask; motion?: WaterMotion } | null {
    const map = this.data[mapPath];
    return map && map.waterMoved !== true ? map.water ?? null : null;
  }

  /** The map's painted water was moved to Atlas's liquids (or could not be read): it leaves this data, once. */
  clearLegacyWater(mapPath: string): void {
    const map = this.data[mapPath];
    if (!map || (map.waterMoved === true && map.water === undefined)) return;
    const { water: _water, ...rest } = map;
    this.put(mapPath, { ...rest, waterMoved: true });
  }

  /** Whether this layer is hidden on the boards of its stack. */
  layerHidden(mapPath: string): boolean {
    return this.data[mapPath]?.hidden === true;
  }

  /** Hides a layer on the boards of its stack, or shows it again; it keeps its place in the stack either way. */
  setLayerHidden(mapPath: string, hidden: boolean): void {
    const map = this.data[mapPath] ?? {};
    if ((map.hidden === true) === hidden) return;
    const { hidden: _hidden, ...rest } = map;
    this.put(mapPath, hidden ? { ...rest, hidden: true } : rest);
  }

  clearLayer(mapPath: string): void {
    const map = this.data[mapPath];
    if (!map?.layer) return;
    const { layer: _layer, ...rest } = map;
    this.put(mapPath, rest);
  }

  /** The maps stacked directly on this base. */
  layersOf(base: string): StackMember[] {
    return Object.entries(this.data)
      .filter(([, map]) => map.layer?.base === base)
      .map(([path, map]) => ({ path, elevation: map.layer!.elevation, placement: readPlacement(map.layer) ?? NO_PLACEMENT }));
  }

  /** The stacks kept in this data: each base scene with the scenes stacked on it, lowest first. */
  stacks(): Array<{ base: string; members: StackMember[] }> {
    const bases = [...new Set(Object.values(this.data).flatMap((map) => (map.layer ? [map.layer.base] : [])))].sort((a, b) => a.localeCompare(b));
    return bases.map((base) => ({ base, members: this.layersOf(base).sort((a, b) => a.elevation - b.elevation || a.path.localeCompare(b.path)) }));
  }

  /** The journal of a stack's move to Atlas levels that is under way on this base; null without one. */
  stackJournal(base: string): StackJournal | null {
    return this.data[base]?.stackJournal ?? null;
  }

  /** Keeps (or, with null, drops) the journal of a base's move. A migration's bookkeeping: no step of the GM's undo. */
  setStackJournal(base: string, journal: StackJournal | null): void {
    const { stackJournal: _was, ...rest } = this.data[base] ?? {};
    const kept = tidy(journal ? { ...rest, stackJournal: journal } : rest);
    const next = { ...this.data };
    if (kept) next[base] = kept;
    else delete next[base];
    this.data = next;
    this.changed(null);
  }

  /**
   * Tabletop's side of a stack's move to Atlas levels, once Atlas has the levels: what this data kept for each member
   * scene is the base's too, by level. Token styles go under the ids the tokens have on the base; props stand on the
   * member's level, where its image now lies; a hidden layer is a hidden level; every shot of every map's cutscenes
   * that looked at a member looks at the base and that level, from where the camera now is. The members are stacked no
   * more (they keep their own data: each is still a scene), and the journal goes. The base's own props and shots name
   * the base's level (whichever level is the scene's first, they stay on the base's floor) and, where the whole scene
   * was set aside, go with it. Done twice, it changes nothing the second time. No step of the GM's undo; the maps
   * whose data it changed are returned (an older step of theirs would put the stack back).
   */
  adoptStack(base: string, journal: StackJournal): string[] {
    const next: Record<string, MapData> = { ...this.data };
    const { stackJournal: _journal, ...own } = next[base] ?? {};
    const styles = { ...(own.styles ?? {}) };
    const moved = new Map(journal.members.map((member) => [member.path, member]));
    const cent = (value: number): number => Math.round(value * 100) / 100;
    const touched = new Set<string>([base]);
    const baseAt = moveOf(journal.baseFrame ?? { k: 1, x: 0, y: 0 });
    // A prop of the base's that names no level stood on the scene's one floor: the base's.
    const props = (own.props ?? []).map((prop) => {
      if (prop.level) return prop;
      const place = baseAt(prop);
      return { ...prop, x: cent(place.x), y: cent(place.y), level: journal.baseLevel };
    });
    for (const move of journal.members) {
      const member = next[move.path];
      if (!member) continue;
      touched.add(move.path);
      const at = moveOf(move.frame);
      for (const [id, style] of Object.entries(member.styles ?? {})) styles[move.ids.tokens?.[id] ?? id] = style;
      for (const prop of member.props ?? []) {
        const id = `${prop.id}@${move.level}`;
        if (props.some((placed) => placed.id === id)) continue;
        const place = at(prop);
        props.push({ ...prop, id, x: cent(place.x), y: cent(place.y), level: move.level });
      }
      if (member.hidden === true) { const key = `${base}#atlas-level:${move.level}`; next[key] = { ...(next[key] ?? {}), hidden: true }; }
      const { layer: _layer, hidden: _hidden, ...rest } = member;
      const kept = tidy(rest);
      if (kept) next[move.path] = kept;
      else delete next[move.path];
    }
    const kept = tidy({ ...own, styles, props });
    if (kept) next[base] = kept;
    else delete next[base];
    for (const [path, map] of Object.entries(next)) {
      const ours = (shot: { mapPath: string; level?: string }): boolean => moved.has(shot.mapPath) || (shot.mapPath === base && !shot.level);
      if (!map.cutscenes?.some((cutscene) => cutscene.shots.some(ours))) continue;
      touched.add(path);
      next[path] = { ...map, cutscenes: map.cutscenes.map((cutscene) => ({ ...cutscene, shots: cutscene.shots.map((shot) => {
        if (!ours(shot)) return shot;
        // A member's shot looks at its level; a shot of the base's that named no level looked at its one floor.
        const move = moved.get(shot.mapPath);
        const frame = move ? move.frame : journal.baseFrame ?? { k: 1, x: 0, y: 0 };
        const at = moveOf(frame);
        // The board's x and z are the map's pixels; heights are in pixels of its squares.
        const through = (point: { x: number; y: number; z: number }): { x: number; y: number; z: number } => { const flat = at({ x: point.x, y: point.z }); return { x: cent(flat.x), y: cent(point.y * frame.k), z: cent(flat.y) }; };
        return { ...shot, mapPath: base, level: move ? move.level : journal.baseLevel, eye: through(shot.eye), target: through(shot.target) };
      }) })) };
    }
    this.data = next;
    this.changed(null);
    return [...touched];
  }

  /** Sets a prop's size, in cells across (a tenth to ten). */
  setPropScale(mapPath: string, id: string, scale: number): void {
    const map = this.data[mapPath];
    const value = Math.min(10, Math.max(0.1, scale));
    if (!map?.props?.some((prop) => prop.id === id && prop.scale !== value)) return;
    this.put(mapPath, { ...map, props: map.props.map((prop) => (prop.id === id ? { ...prop, scale: value } : prop)) });
  }

  /** Sets how high a prop stands, in grid squares (0: on what is under it). */
  setPropLift(mapPath: string, id: string, lift: number): void {
    const map = this.data[mapPath];
    const value = Math.max(0, Math.round(lift * 20) / 20);
    if (!map?.props?.some((prop) => prop.id === id && (prop.lift ?? 0) !== value)) return;
    this.put(mapPath, { ...map, props: map.props.map((prop) => {
      if (prop.id !== id) return prop;
      const { lift: _was, ...rest } = prop;
      return value > 0 ? { ...rest, lift: value } : rest;
    }) });
  }

  /** Makes a prop solid (tokens stand on it) or not. */
  setPropSolid(mapPath: string, id: string, solid: boolean): void {
    const map = this.data[mapPath];
    if (!map?.props?.some((prop) => prop.id === id && (prop.solid === true) !== solid)) return;
    this.put(mapPath, { ...map, props: map.props.map((prop) => {
      if (prop.id !== id) return prop;
      const { solid: _was, ...rest } = prop;
      return solid ? { ...rest, solid: true } : rest;
    }) });
  }

  removeProp(mapPath: string, id: string): void {
    const map = this.data[mapPath];
    if (!map?.props?.some((prop) => prop.id === id)) return;
    this.put(mapPath, { ...map, props: map.props.filter((prop) => prop.id !== id) });
  }

  /** Follows a vault rename: of a map or a folder of maps, and of a prop's GLB or a folder of GLBs. */
  rename(oldPath: string, newPath: string): void {
    const moved = (path: string): string | null => {
      if (path === oldPath) return newPath;
      if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
      return null;
    };
    let touched = false;
    const next: BoardDataJSON = {};
    for (const [path, map] of Object.entries(this.data)) {
      const to = moved(path) ?? path;
      if (to !== path) touched = true;
      const props = map.props?.map((prop) => {
        const glb = moved(prop.glb);
        if (!glb) return prop;
        touched = true;
        return { ...prop, glb };
      });
      const follow = (paths: Record<string, string> | undefined): Record<string, string> | undefined => {
        if (!paths) return undefined;
        return Object.fromEntries(Object.entries(paths).map(([id, path]) => {
          const to = moved(path);
          if (to) touched = true;
          return [id, to ?? path];
        }));
      };
      const wallMaterials = follow(map.wallMaterials);
      const doorProps = follow(map.doorProps);
      const base = map.layer ? moved(map.layer.base) : null;
      if (base) touched = true;
      const cutscenes = map.cutscenes?.map((c) => renameShotMaps(c, moved));
      if (cutscenes?.some((c, i) => c !== map.cutscenes![i])) touched = true;
      // The painted background the ground shows (a vault folder) follows its folder's rename.
      const background = map.ground?.background ? moved(map.ground.background) : null;
      if (background) touched = true;
      next[to] = { ...map, ...(map.ground && background ? { ground: { ...map.ground, background } } : {}),...(cutscenes ? { cutscenes } : {}), ...(props ? { props } : {}), ...(wallMaterials ? { wallMaterials } : {}), ...(doorProps ? { doorProps } : {}), ...(map.layer && base ? { layer: { ...map.layer, base } } : {}) };
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }

  /** Follows a deletion: a deleted map takes its data, a deleted GLB its props. */
  deleted(path: string): void {
    const under = (candidate: string): boolean => candidate === path || candidate.startsWith(`${path}/`);
    let touched = false;
    const next: BoardDataJSON = {};
    for (const [mapPath, map] of Object.entries(this.data)) {
      if (under(mapPath)) { touched = true; continue; }
      const props = map.props?.filter((prop) => !under(prop.glb));
      if (props && props.length !== map.props?.length) touched = true;
      const keep = (paths: Record<string, string> | undefined): Record<string, string> | undefined => {
        if (!paths) return undefined;
        const left = Object.fromEntries(Object.entries(paths).filter(([, path]) => !under(path)));
        if (Object.keys(left).length !== Object.keys(paths).length) touched = true;
        return left;
      };
      // A layer whose base is gone is a map on its own again.
      const orphan = map.layer !== undefined && under(map.layer.base);
      if (orphan) touched = true;
      const { layer: _layer, ...bare } = map;
      const cutscenes = map.cutscenes?.map((c) => dropShotMaps(c, under));
      if (cutscenes?.some((c, i) => c !== map.cutscenes![i])) touched = true;
      const kept = tidy({ ...(orphan ? bare : map), props, wallMaterials: keep(map.wallMaterials), doorProps: keep(map.doorProps), cutscenes });
      if (kept) next[mapPath] = kept;
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }
}
