/**
 * What the GM sets on a wall, a door or a light in 3D, kept on Atlas's own record, in its `tabletop` field:
 *
 * - a wall or door (`objects.walls[id].tabletop`): its own `height` and `width` in grid squares, the `material`
 *   painted on it (a vault folder), a window's opening (`window`), the `prop` standing in for a door's leaf, and how a
 *   door was turned from the way Atlas draws it (`hinge`, `side`);
 * - a placed light (`objects.lights[id].tabletop`): its `height` above the map, in grid squares;
 * - a token that carries a light (`objects.tokens[id].tabletop`): that light's `lightHeight`.
 *
 * Nothing else keeps them: a wall deleted in Atlas takes its extras with it, a copy carries them, Atlas's undo takes
 * them back. They are read key by key, within the bounds the board always held; anything else in the field is ignored
 * and left as it is. `extrasOf` is the one place the board asks: it answers from the map as read, and, for a map
 * whose settings were not moved off Tabletop's data.json yet, from what that still holds.
 */
import { NO_FLIP, type BoardLight, type BoardWall, type DoorFlip } from './walls';

export interface WallExtra {
  /** Its own height, grid squares; unset, it stands as tall as the fog. */
  height?: number;
  /** Its own width (thickness), grid squares; unset, the map's wall thickness. */
  width?: number;
  /** The vault folder of the material painted on it. */
  material?: string;
  /** A window's opening, grid squares from the floor. */
  window?: { bottom: number; top: number };
  /** The vault path of the prop standing in for a door's leaf. */
  prop?: string;
  /** A door turned from the way Atlas draws it: its hinge at the other end, and/or opening to the other side. */
  hinge?: true;
  side?: true;
}

/** A change to a wall's extras: a key given as null is removed. */
export type WallExtraChange = { [Key in keyof WallExtra]?: WallExtra[Key] | null };

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const size = (value: unknown, least: number, inclusive: boolean): value is number => typeof value === 'number' && Number.isFinite(value) && (inclusive ? value >= least : value > least);
const text = (value: unknown): value is string => typeof value === 'string' && value !== '';

/** A wall's extras as its record's `tabletop` field has them; null when it has none that read. */
export function readWallExtra(raw: unknown): WallExtra | null {
  if (!isObj(raw)) return null;
  const extra: WallExtra = {};
  if (size(raw.height, 0, true)) extra.height = raw.height;
  if (size(raw.width, 0, false)) extra.width = raw.width;
  if (text(raw.material)) extra.material = raw.material;
  const window = raw.window;
  if (isObj(window) && size(window.bottom, 0, true) && size(window.top, 0, false) && window.top > window.bottom) extra.window = { bottom: window.bottom, top: window.top };
  if (text(raw.prop)) extra.prop = raw.prop;
  if (raw.hinge === true) extra.hinge = true;
  if (raw.side === true) extra.side = true;
  return Object.keys(extra).length > 0 ? extra : null;
}

/** A light's height off a record's `tabletop` field: a placed light's `height`, a token's `lightHeight`; null when unset. */
export function readLightHeight(raw: unknown, key: 'height' | 'lightHeight'): number | null {
  if (!isObj(raw)) return null;
  const value = raw[key];
  return size(value, 0, true) ? value : null;
}

/**
 * A record's `tabletop` field with `change` laid over it: the keys the change does not name stay as they are
 * (whoever's they are), one given as null goes; undefined when nothing but the version is left (the field goes whole).
 */
export function mergeExtra(current: unknown, change: Readonly<Record<string, unknown>>): Raw | undefined {
  const next: Raw = { v: 1, ...(isObj(current) ? current : {}) };
  for (const [key, value] of Object.entries(change)) {
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return Object.keys(next).some((key) => key !== 'v') ? next : undefined;
}

/** What Tabletop's data.json held per map before the extras moved to Atlas's records (`MapData`'s seven records). */
export interface LegacyExtras {
  wallMaterials?: Readonly<Record<string, string>>;
  doorProps?: Readonly<Record<string, string>>;
  wallHeights?: Readonly<Record<string, number>>;
  wallWidths?: Readonly<Record<string, number>>;
  lightHeights?: Readonly<Record<string, number>>;
  windows?: Readonly<Record<string, { bottom: number; top: number }>>;
  doorFlips?: Readonly<Record<string, { hinge?: true; side?: true }>>;
}

/** The extras of a map's walls, doors and lights, by Atlas's ids. */
export interface RecordExtras {
  wallHeight(id: string): number | null;
  wallWidth(id: string): number | null;
  wallMaterial(id: string): string | null;
  windowOf(id: string): { bottom: number; top: number } | null;
  doorProp(id: string): string | null;
  doorFlip(id: string): DoorFlip;
  /** A light's height (by the light's id, a carried light's by its token's); null when it was never set. */
  lightHeight(id: string): number | null;
  /** The materials painted on the map's walls, each once, the records' first. */
  usedMaterials(): string[];
}

/**
 * The extras of `map` as read (`BoardWall.extra`, `BoardLight.ownHeight`), and, where a record has none, what
 * `legacy` still holds for that id (a map not moved yet; nothing after the move).
 */
export function extrasOf(map: { walls: readonly BoardWall[]; lights: readonly BoardLight[] } | null, legacy?: LegacyExtras | null): RecordExtras {
  const walls = new Map((map?.walls ?? []).map((wall) => [wall.id, wall.extra ?? null]));
  const lights = new Map((map?.lights ?? []).map((light) => [light.id, light.ownHeight ?? null]));
  const old = <Value>(record: Readonly<Record<string, Value>> | undefined, id: string): Value | null => (record && Object.hasOwn(record, id) ? record[id] as Value : null);
  const wallMaterial = (id: string): string | null => walls.get(id)?.material ?? old(legacy?.wallMaterials, id);
  return {
    wallHeight: (id) => walls.get(id)?.height ?? old(legacy?.wallHeights, id),
    wallWidth: (id) => walls.get(id)?.width ?? old(legacy?.wallWidths, id),
    wallMaterial,
    windowOf: (id) => walls.get(id)?.window ?? old(legacy?.windows, id),
    doorProp: (id) => walls.get(id)?.prop ?? old(legacy?.doorProps, id),
    doorFlip: (id) => {
      const extra = walls.get(id);
      if (extra?.hinge || extra?.side) return { hinge: extra.hinge === true, side: extra.side === true };
      const kept = old(legacy?.doorFlips, id);
      return kept ? { hinge: kept.hinge === true, side: kept.side === true } : NO_FLIP;
    },
    lightHeight: (id) => lights.get(id) ?? old(legacy?.lightHeights, id),
    usedMaterials: () => [...new Set([...walls.keys()].map(wallMaterial).filter((material): material is string => material !== null))].sort((a, b) => Number(!isOnRecord(walls, a)) - Number(!isOnRecord(walls, b))),
  };
}

/** Whether a material is painted on some wall's own record (and not only kept in data.json). */
function isOnRecord(walls: ReadonlyMap<string, WallExtra | null>, material: string): boolean {
  for (const extra of walls.values()) if (extra?.material === material) return true;
  return false;
}
