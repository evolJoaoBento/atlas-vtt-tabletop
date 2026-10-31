/**
 * Atlas 0.10's levels (floors): a scene lists its levels bottom first, and every object stands on one (`level`) or
 * several (`levels`, or `'all'`). A view shows the objects of one level. Pure and tolerant of any shape, so a 0.9 map
 * (no levels) reads exactly as before. The rules are Atlas's own (`levels/sceneLevels.ts`).
 */
export interface BoardLevel {
  id: string;
  name: string | null;
  background: string | null;
}

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** A map file's `levels`; none for a scene of one level or fewer. */
export function readLevels(raw: unknown): BoardLevel[] {
  if (!Array.isArray(raw)) return [];
  const levels: BoardLevel[] = [];
  for (const entry of raw) {
    const id = isObj(entry) ? text(entry.id) : null;
    if (id && isObj(entry)) levels.push({ id, name: text(entry.name), background: text(entry.background) });
  }
  return levels.length > 1 ? levels : [];
}

/** The level `id` names, else the first: what an unset or unknown level reads as. Null for a scene without levels. */
export function resolveLevel(levels: readonly BoardLevel[], id: unknown): string | null {
  if (levels.length === 0) return null;
  return typeof id === 'string' && levels.some((level) => level.id === id) ? id : levels[0].id;
}

/** Whether `object` stands on level `levelId`: Atlas's rule, where unset or unknown is the first level. */
export function onLevel(object: unknown, levelId: string | null, levels: readonly BoardLevel[]): boolean {
  if (levelId === null || levels.length === 0) return true;
  const first = levels[0].id;
  if (!isObj(object)) return levelId === first;
  const known = (id: unknown): id is string => typeof id === 'string' && levels.some((level) => level.id === id);
  const { levels: set, level } = object;
  if (set === 'all') return true;
  if (Array.isArray(set)) {
    const ids = set.filter(known);
    if (ids.length > 0) return ids.includes(levelId);
  } else if (known(level)) {
    return level === levelId;
  }
  return levelId === first;
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
