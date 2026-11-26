/**
 * Atlas 0.10's levels (floors): a scene lists its levels bottom first, and every object stands on one (`level`) or
 * several (`levels`, or `'all'`). A view shows the objects of one level. Pure and tolerant of any shape, so a 0.9 map
 * (no levels) reads exactly as before. Which level an id names, and what stands on a level, are decided by Atlas's own
 * code (`packages/atlas-shared`, `levels/sceneLevels.ts`); what is here reads a file's levels and adds the board's own
 * (heights in squares, props, badge numbers).
 */
import { onLevel as atlasOnLevel, resolveLevel as atlasResolveLevel, type SceneLevels } from '../../packages/atlas-shared/src/index';

export interface BoardLevel {
  id: string;
  name: string | null;
  background: string | null;
  /** What it stands on, in game units (Atlas's `elevation.bottom`). */
  bottom: number;
}

/** How tall Atlas makes a level it adds, in game units (`levelEdits.ts`'s `LEVEL_HEIGHT`). */
export const LEVEL_HEIGHT = 10;

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A map file's `levels`; none for a scene of one level or fewer. */
export function readLevels(raw: unknown): BoardLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: BoardLevel[] = [];
  for (const entry of raw) {
    const id = isObj(entry) ? text(entry.id) : null;
    if (!id || !isObj(entry)) continue;
    const bottom = isObj(entry.elevation) && typeof entry.elevation.bottom === 'number' && Number.isFinite(entry.elevation.bottom) ? entry.elevation.bottom : Number.NaN;
    levels.push({ id, name: text(entry.name), background: text(entry.background), bottom });
  }
  if (levels.length < 2) return [];
  // Heights that do not tell the floors apart (missing, or all the same): one level's height apart, bottom first.
  const known = levels.every((level) => Number.isFinite(level.bottom));
  const apart = known && new Set(levels.map((level) => level.bottom)).size === levels.length;
  return apart ? levels : levels.map((level, index) => ({ ...level, bottom: index * LEVEL_HEIGHT }));
}

/** The name a level goes by: its own, else its place ("Level 2"), as Atlas names it. */
export function levelName(levels: readonly BoardLevel[], id: string): string {
  const index = levels.findIndex((level) => level.id === id);
  return levels[index]?.name ?? `Level ${index + 1}`;
}

/** How far level `id` stands above level `from`, in grid squares (game units over the units a square spans). */
export function levelRise(levels: readonly BoardLevel[], from: string | null, id: string, unitDistance: number): number {
  const bottom = (key: string | null): number => levels.find((level) => level.id === key)?.bottom ?? 0;
  const units = unitDistance > 0 ? unitDistance : 5;
  return Math.round(((bottom(id) - bottom(from)) / units) * 100) / 100;
}

/** A millimetre, as a share of a grid square (a 5-foot square is 1,524 mm). */
export const MILLIMETRE_SQUARES = 1 / 1524;

/**
 * How tall a wall with no height of its own stands on level `id` when walls reach the level above: the rise to the next
 * level up less a millimetre, so the walls meet that level's floor without poking through it. Null on the top level, on
 * a scene without levels, or where the next level stands less than a millimetre up.
 */
export function reachToNext(levels: readonly BoardLevel[], id: string | null, unitDistance: number): number | null {
  if (levels.length === 0) return null;
  const here = levels.find((level) => level.id === id) ?? levels[0];
  const above = levels.filter((level) => level.bottom > here.bottom).sort((a, b) => a.bottom - b.bottom)[0];
  if (!above) return null;
  const units = unitDistance > 0 ? unitDistance : 5;
  const squares = (above.bottom - here.bottom) / units - MILLIMETRE_SQUARES;
  return squares > 0 ? squares : null;
}

/** Game units a square of the scene spans (its own override, else its grid's distance); five where it says none. */
export function sceneUnits(rawGrid: unknown): number {
  const grid = (typeof rawGrid === 'object' && rawGrid !== null ? rawGrid : {}) as { unitDistanceOverride?: unknown; unitDistance?: unknown };
  for (const value of [grid.unitDistanceOverride, grid.unitDistance]) if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return 5;
}

/** The props on level `levelId` (a prop without a level stands on the first, as Atlas's objects do). */
export function propsOnLevel<T extends { level?: string }>(props: readonly T[], levelId: string | null, levels: readonly BoardLevel[]): T[] {
  if (levelId === null || levels.length === 0) return [...props];
  return props.filter((prop) => onLevel(prop, levelId, levels));
}

/** Whether the level shown is the scene's first (its ground: the one painted water lies on). */
export function onFirstLevel(levels: readonly BoardLevel[], levelId: string | null): boolean {
  return levelId === null || levels.length === 0 || levels[0].id === levelId;
}

/** The level `id` names, else the first: what an unset or unknown level reads as. Null for a scene without levels. */
export function resolveLevel(levels: readonly BoardLevel[], id: unknown): string | null {
  if (levels.length === 0) return null;
  return atlasResolveLevel(levels as unknown as SceneLevels, id);
}

/** Whether `object` stands on level `levelId`: Atlas's rule, where unset or unknown is the first level. */
export function onLevel(object: unknown, levelId: string | null, levels: readonly BoardLevel[]): boolean {
  if (levelId === null || levels.length === 0) return true;
  // An entry that is no object stands where unset objects do: on the first level.
  if (!isObj(object)) return levelId === levels[0].id;
  return atlasOnLevel(object, levelId, levels as unknown as SceneLevels);
}

/** The entries of an object record that stand on the level; the record as it was where there are no levels. */
export function onLevelRecord(record: unknown, levelId: string | null, levels: readonly BoardLevel[]): unknown {
  if (levelId === null || !isObj(record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([, entry]) => onLevel(entry, levelId, levels)));
}

/** The map image of the level: the first level's is the scene's own `background`. */
export function levelBackground(background: string | null, levels: readonly BoardLevel[], levelId: string | null): string | null {
  if (levelId === null || levelId === levels[0]?.id) return background;
  return levels.find((level) => level.id === levelId)?.background ?? null;
}

interface Numbered {
  imagePath: string | null;
  instanceNumber: number | null;
  /** The level it stands on, null for a scene without levels. */
  levelId: string | null;
}

/**
 * The number each token's badge shows, by token id, as Atlas 0.10 works it out (`instanceBadgeNumbers`): the token's
 * instance number (1 where it has none) while badges are on and two or more tokens on its level share its art. Hidden
 * and unseen tokens count too, and every screen shows these numbers, the players' included.
 */
export function instanceBadgeNumbers(tokens: ReadonlyMap<string, Numbered>, badgesOn: boolean): Map<string, number> {
  const numbers = new Map<string, number>();
  if (!badgesOn) return numbers;
  const counts = new Map<string, number>();
  const key = (token: Numbered): string => `${token.levelId ?? ''}\n${token.imagePath ?? ''}`;
  for (const token of tokens.values()) counts.set(key(token), (counts.get(key(token)) ?? 0) + 1);
  for (const [id, token] of tokens) if ((counts.get(key(token)) ?? 0) >= 2) numbers.set(id, token.instanceNumber ?? 1);
  return numbers;
}
