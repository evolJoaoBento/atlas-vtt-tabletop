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
import { dropShotMaps, readCutscenes, renameShotMaps, type Cutscene } from '../cutscene/cutsceneData';

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
  /** Water painted over the map (src/board/water.ts), and how all of it moves. */
  water?: { mask: SavedWaterMask; motion?: WaterMotion };
  /** Where the players' printed AR marker sheets lie on this map (`arTable.ts`). */
  arTable?: SavedArTable;
  /** Cinematic cutscenes made in this map (their shots may look at other maps). */
  cutscenes?: Cutscene[];
  /** The settings of this map's 0.14 room walls were looked for and moved to Atlas 0.15's room walls: done once. */
  roomWallsMoved?: true;
  /** What the GM set in 3D on walls, doors and lights (the seven records above) was moved onto Atlas's own records: done once. */
  extrasMoved?: true;
}

/** The records of a map's data that held 3D settings by Atlas's ids, before they moved onto Atlas's records. */
export const LEGACY_EXTRAS = ['wallMaterials', 'doorProps', 'wallHeights', 'wallWidths', 'lightHeights', 'windows', 'doorFlips'] as const;

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
  if (map.arTable) out.arTable = map.arTable;
  if (map.cutscenes && map.cutscenes.length > 0) out.cutscenes = map.cutscenes;
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
      styles, props, ...(layer && { layer }), ...(value.hidden === true && { hidden: true as const }), ...(readWater(value.water) && { water: readWater(value.water)! }), ...(fogHeight !== undefined && { fogHeight }),
      wallMaterials: strings(value.wallMaterials), doorProps: strings(value.doorProps), lightHeights: heights(value.lightHeights),
      wallHeights: heights(value.wallHeights), wallWidths: widths(value.wallWidths), windows: windows(value.windows), doorFlips: flips(value.doorFlips),
      ...(wallThickness !== undefined && { wallThickness }),
      ...(value.roomWallsMoved === true && { roomWallsMoved: true as const }),
      ...(value.extrasMoved === true && { extrasMoved: true as const }),
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
   * Stacks a map on another, `elevation` grid squares above it. A map stacked on a layer joins that layer's stack, and
   * a map that has layers of its own cannot become one (nor a map be its own base). Returns whether it was done.
   */
  setLayer(mapPath: string, base: string, elevation: number): boolean {
    if (!Number.isFinite(elevation)) return false;
    const root = this.data[base]?.layer ?? null;
    // On a layer, the elevation is given from that layer: the stack is measured from its base.
    const target = root ? root.base : base;
    const height = Math.round((root ? root.elevation + elevation : elevation) * 100) / 100;
    if (target === mapPath || this.layersOf(mapPath).length > 0) return false;
    const current = this.data[mapPath]?.layer;
    if (current && current.base === target && current.elevation === height) return true;
    // Changing its height keeps where it stands.
    const { x, y, turn } = current ?? {};
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), layer: { base: target, elevation: height, ...(x !== undefined && { x }), ...(y !== undefined && { y }), ...(turn !== undefined && { turn }) } });
    return true;
  }

  /** Where a scene of a stack stands on the plane; no placement for the base scene and for one that was never moved. */
  placementOf(mapPath: string): Placement {
    const layer = this.data[mapPath]?.layer;
    return layer ? readPlacement(layer) ?? NO_PLACEMENT : NO_PLACEMENT;
  }

  /** Places a layer on the plane (no placement puts it back where its grid puts it); false for a scene that is no layer. */
  setPlacement(mapPath: string, placement: Placement): boolean {
    const layer = this.data[mapPath]?.layer;
    if (!layer) return false;
    const next = readPlacement(placement);
    this.put(mapPath, { ...this.data[mapPath], layer: { base: layer.base, elevation: layer.elevation, ...(next && { x: next.x, y: next.y, turn: next.turn }) } });
    return true;
  }

  /** The map's painted water and its motion; null while it has none. */
  water(mapPath: string): { mask: SavedWaterMask; motion?: WaterMotion } | null {
    return this.data[mapPath]?.water ?? null;
  }

  /** Keeps the map's painted water (null: none left); its motion is kept. */
  setWater(mapPath: string, mask: SavedWaterMask | null): void {
    const map = this.data[mapPath] ?? {};
    const motion = map.water?.motion;
    const { water: _water, ...rest } = map;
    this.put(mapPath, mask ? { ...rest, water: { mask, ...(motion && { motion }) } } : rest);
    if (!mask && motion) this.waterMotions.set(mapPath, motion);
  }

  /** How all of the map's water moves (kept with its water; remembered until water is painted). */
  waterMotion(mapPath: string): WaterMotion | null {
    return this.data[mapPath]?.water?.motion ?? this.waterMotions.get(mapPath) ?? null;
  }

  setWaterMotion(mapPath: string, motion: WaterMotion): void {
    this.waterMotions.set(mapPath, motion);
    const map = this.data[mapPath];
    if (map?.water) this.put(mapPath, { ...map, water: { ...map.water, motion } });
  }

  /** Motions chosen for maps without water yet. */
  private readonly waterMotions = new Map<string, WaterMotion>();

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

  /**
   * The stack a map belongs to, lowest first, with heights measured from the base map; empty for a map on its own.
   * Opening any of them shows them all.
   */
  stackOf(mapPath: string): StackMember[] {
    const base = this.data[mapPath]?.layer?.base ?? mapPath;
    const layers = this.layersOf(base);
    if (layers.length === 0) return [];
    return [{ path: base, elevation: 0, placement: NO_PLACEMENT }, ...layers].sort((a, b) => a.elevation - b.elevation || a.path.localeCompare(b.path));
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
      next[to] = { ...map, ...(cutscenes ? { cutscenes } : {}), ...(props ? { props } : {}), ...(wallMaterials ? { wallMaterials } : {}), ...(doorProps ? { doorProps } : {}), ...(map.layer && base ? { layer: { ...map.layer, base } } : {}) };
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
