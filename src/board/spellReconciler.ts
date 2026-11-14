/**
 * Keeps Atlas's own records of what a kept spell does in step with the spell's measure. A spell is one of Atlas's
 * measures (`boardMeasures.ts`); what its rules stand on the map are records of Atlas's too, so its 2D view, its sight
 * and its movement rules honour them: walls (`chainId: 'spell:<measure id>'`), difficult ground (a map feature with
 * `tabletop.spell`) and the measure's own `light`. They are worked out from the measure (`derivedRecords`) and are
 * never a second place a spell lives: a pass looks at every level's measures and
 *
 * - takes away the walls and the ground whose spell is gone (undone, removed in Atlas, its rules no longer read);
 * - makes them for a spell that has none, and makes them again where one moved, turned or was resized;
 * - gives a spell's measure its light once, while it has none (one the GM changed in Atlas stays as they left it).
 *
 * Every write is outside Atlas's history (`untracked`): a cast is one undo step, its measure. Only records that say
 * they are a spell's are touched: a wall drawn in Atlas and a feature made there never are. Pure but for the store.
 */
import { measureToSpell, SPELL_CHAIN } from '../../packages/atlas-host/src/spellMeasure';
import type { AtlasView } from '../atlas';
import { placedMeasure } from './boardMeasures';
import { derivedRecords, readSpellRules, type DerivedFeature, type DerivedLight, type DerivedWall, type RuleScale } from './spellRules';
import { readSpell } from './spells';

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a chain of walls a spell stands begins with (`SPELL_CHAIN`). */
const CHAIN = SPELL_CHAIN('');

export interface ReconcilePlan {
  deleteWalls: string[];
  addWalls: DerivedWall[];
  deleteFeatures: string[];
  addFeatures: DerivedFeature[];
  lights: Array<{ id: string; light: DerivedLight }>;
}

const hundredth = (value: unknown): number => (typeof value === 'number' ? Math.round(value * 100) / 100 : NaN);
const place = (value: unknown): [number, number] => (isObj(value) ? [hundredth(value.x), hundredth(value.y)] : [NaN, NaN]);
/** What a wall is, for telling a standing one from the one wanted: its ends, what it stops and its levels. */
const wallKey = (wall: Raw): string => JSON.stringify([wall.type ?? 'solid', place(wall.p1), place(wall.p2), wall.blocks ?? null, wall.levels ?? null]);
const featureKey = (feature: Raw): string => JSON.stringify([Array.isArray(feature.polygon) ? feature.polygon.map(place) : null, feature.name ?? null, feature.terrain ?? null, feature.level ?? null]);

function sameSet(standing: readonly string[], wanted: readonly string[]): boolean {
  if (standing.length !== wanted.length) return false;
  const sorted = [...wanted].sort();
  return [...standing].sort().every((key, index) => key === sorted[index]);
}

/** The records of `record` that say they are a spell's, by that spell's measure id. */
function standingBySpell(record: unknown, spellOf: (entry: Raw) => string | null): Map<string, Raw[]> {
  const bySpell = new Map<string, Raw[]>();
  if (!isObj(record)) return bySpell;
  for (const entry of Object.values(record)) {
    if (!isObj(entry) || typeof entry.id !== 'string') continue;
    const spell = spellOf(entry);
    if (spell === null) continue;
    bySpell.set(spell, [...(bySpell.get(spell) ?? []), entry]);
  }
  return bySpell;
}

/**
 * What a pass would write for a store's records (`objects`, every level's): nothing when all is in order. `scale`
 * turns the rules' feet into the scene's units and pixels (`RuleScale`). With no scale (nothing knows the map's
 * measuring: no board is open on it) nothing is made or made again: only what stands for a spell that is gone, or
 * that no longer reads as a spell with rules, is taken away. A spell that follows a token stands what it stands
 * round that token (`placedMeasure`), and nothing while its token is not on the map.
 */
export function planReconcile(objects: { measures?: unknown; walls?: unknown; mapFeatures?: unknown; tokens?: unknown }, scale: RuleScale | null): ReconcilePlan {
  const plan: ReconcilePlan = { deleteWalls: [], addWalls: [], deleteFeatures: [], addFeatures: [], lights: [] };
  /** Per spell with rules: what it should stand; null when there is nothing to shape it by (it keeps what it has). */
  const wanted = new Map<string, { walls: DerivedWall[]; features: DerivedFeature[] } | null>();
  const tokens = isObj(objects.tokens) ? objects.tokens : {};
  const tokenAt = (id: string): { x: number; y: number } | null => {
    const token = Object.hasOwn(tokens, id) ? tokens[id] : null;
    return isObj(token) && typeof token.x === 'number' && typeof token.y === 'number' && Number.isFinite(token.x) && Number.isFinite(token.y) ? { x: token.x, y: token.y } : null;
  };
  for (const [key, value] of Object.entries(isObj(objects.measures) ? objects.measures : {})) {
    if (!isObj(value)) continue;
    // Known by its place in Atlas's record, as Atlas knows it.
    const id = key;
    const placed = placedMeasure(value as never, tokenAt);
    const read = placed ? measureToSpell(placed) : null;
    const spell = read ? readSpell(read.spell) : null;
    const rules = read ? readSpellRules(read.meta.rules) : null;
    if (!read || !spell || !rules) continue;
    if (scale === null) { wanted.set(id, null); continue; }
    const name = rules.name ?? (typeof read.meta.name === 'string' && read.meta.name.trim() ? read.meta.name.trim() : undefined);
    const derived = derivedRecords(id, spell, { ...rules, ...(name ? { name } : {}) }, scale, typeof value.level === 'string' ? value.level : undefined);
    wanted.set(id, derived);
    if (derived.light && value.light === undefined) plan.lights.push({ id, light: derived.light });
  }
  const walls = standingBySpell(objects.walls, (wall) => (typeof wall.chainId === 'string' && wall.chainId.startsWith(CHAIN) ? wall.chainId.slice(CHAIN.length) : null));
  const features = standingBySpell(objects.mapFeatures, (feature) => (isObj(feature.tabletop) && typeof feature.tabletop.spell === 'string' ? feature.tabletop.spell : null));
  for (const [spell, standing] of walls) {
    if (wanted.get(spell) === null) continue;
    const want = wanted.get(spell)?.walls ?? [];
    if (sameSet(standing.map(wallKey), want.map((wall) => wallKey(wall as unknown as Raw)))) continue;
    plan.deleteWalls.push(...standing.map((wall) => wall.id as string));
    plan.addWalls.push(...want);
  }
  for (const [spell, standing] of features) {
    if (wanted.get(spell) === null) continue;
    const want = wanted.get(spell)?.features ?? [];
    if (sameSet(standing.map(featureKey), want.map((feature) => featureKey(feature as unknown as Raw)))) continue;
    plan.deleteFeatures.push(...standing.map((feature) => feature.id as string));
    plan.addFeatures.push(...want);
  }
  for (const [spell, derived] of wanted) {
    if (derived === null) continue;
    if (!walls.has(spell)) plan.addWalls.push(...derived.walls);
    if (!features.has(spell)) plan.addFeatures.push(...derived.features);
  }
  return plan;
}

/**
 * One pass on the Atlas view holding a map: what `planReconcile` finds is written, outside Atlas's history. The
 * number of records it changed; 0 when all is in order, while Atlas reads a map in or travels its history, and on an
 * Atlas that cannot write outside its history.
 */
export function reconcileSpells(view: AtlasView, scale: RuleScale | null): number {
  const state = view.atlasStore.getState();
  if (state.mapLoaded === false || state.isMapLoading === true) return 0;
  const history = view.atlasStore.temporal?.getState();
  if (!history?.untracked || history.isTravelling?.() === true) return 0;
  const plan = planReconcile(state.objects ?? {}, scale);
  let written = 0;
  history.untracked(() => {
    if (plan.deleteWalls.length > 0 && state.deleteWalls) { state.deleteWalls(plan.deleteWalls); written += plan.deleteWalls.length; }
    if (state.addWall) for (const wall of plan.addWalls) { state.addWall({ ...wall }); written += 1; }
    if (state.deleteMapFeature) for (const id of plan.deleteFeatures) { state.deleteMapFeature(id); written += 1; }
    if (plan.addFeatures.length > 0 && state.addMapFeatures) { state.addMapFeatures(plan.addFeatures.map((feature) => ({ ...feature }))); written += plan.addFeatures.length; }
    if (state.updateMeasure) for (const { id, light } of plan.lights) { state.updateMeasure(id, { light: { ...light } }); written += 1; }
  });
  return written;
}
