/**
 * A scene stack of older Tabletop (maps stacked on a base map, each at a height and a place on the plane, kept in
 * Tabletop's data) as the Atlas levels of its base scene: the plan of the one write that makes it so.
 *
 * - `frameOf`: where a member's pixels lie in the base's (a scale and an offset: Atlas turns no level and keeps none
 *   left of or above the scene's origin), as the alignment Atlas keeps for the level and the move of its records.
 * - `planStackMove`: the scene as it is handed to Atlas's `applyLevelScene`: the levels by height, the base's records
 *   and every member's on their level (as they lie on the member: Atlas's `alignLevel` then moves a fitted member's
 *   with its image), ids given anew where the base has them already, and what is not kept, in words.
 * - `stackSkip`: why a stack cannot become levels at all.
 *
 * Pure. The level tag of each kind of record is Atlas's (`objectsAfterLevelEdit`).
 */
import { planExtrasMove } from './extrasMigration';
import { turnPoint, type Placement } from './layerPlacement';
import { legacyWaterLiquids } from './liquids';
import { mergeExtra, type LegacyExtras } from './recordExtras';

type Point = { x: number; y: number };
type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface StretchLike { x: number; y: number; rotation?: number }
export interface GridLike { size?: number; offsetX?: number; offsetY?: number; unitDistance?: number; mapStretch?: unknown }
/** A level's alignment as Atlas keeps it (`LevelAlignment`). */
export interface LevelAlignmentLike { offset: Point; scale: number; stretch: StretchLike }
/** A member's pixels in the base's: `p' = k·p + (x, y)`. */
export interface Frame { k: number; x: number; y: number }

/** The fields of Atlas's state a scene's levels and records are (`LevelScene`, with its lighting to compare). */
export interface SceneFields {
  levels?: unknown;
  background: string | null;
  objects: Record<string, Record<string, unknown> | undefined>;
  exploredMask?: string | null;
  exploredMasks?: Record<string, string> | undefined;
  levelAlignments?: Record<string, LevelAlignmentLike> | undefined;
  grid: GridLike | null;
  lighting?: unknown;
}

export interface BaseSource { path: string; name: string; scene: SceneFields; fogHeight: number; wallThickness: number }

export interface MemberSource {
  path: string;
  name: string;
  /** Grid squares above the base (negative: below). */
  elevation: number;
  placement: Placement;
  /** The member as Atlas held it. */
  scene: SceneFields;
  /** The member's world size in its own pixels (its image as its grid alignment draws it); null when it could not be had. */
  size: { width: number; height: number } | null;
  /** Its 3D settings still in Tabletop's data (never moved onto its records). */
  legacyExtras: LegacyExtras | null;
  /** Its old painted water still in Tabletop's data. */
  legacyWater: { mask: unknown; motion?: unknown } | null;
  fogHeight: number;
  wallThickness: number;
  hasInitiative: boolean;
}

/** What Tabletop's own data needs of a member that moved: its level, the ids given anew (by kind, old to new) and its frame. */
export interface MemberMove { path: string; level: string; ids: Record<string, Record<string, string>>; frame: Frame }

export interface StackPlan {
  scene: SceneFields;
  /** The levels Atlas aligns once the scene is in (`alignLevel`), each with the frame its records move by. */
  aligns: Array<{ level: string; alignment: LevelAlignmentLike; frame: Frame }>;
  baseLevel: string;
  members: MemberMove[];
  lost: string[];
}

/** Records that stand on one level (`level`) and on several (`levels`), as Atlas tags them. */
const ON_ONE = ['tokens', 'fog', 'pins', 'texts', 'drawings', 'mapFeatures', 'liquids', 'measures'] as const;
const ON_MANY = ['walls', 'lights', 'audios', 'lightZones'] as const;
const KINDS: readonly string[] = [...ON_ONE, ...ON_MANY];
/** The scales Atlas reads a level's alignment with (`readLevelAlignment`). */
const SCALES = { least: 0.05, most: 20 };
/** Game units a level spans when nothing says otherwise (Atlas's `LEVEL_HEIGHT`). */
const LEVEL_HEIGHT = 10;

const round = (value: number): number => Math.round(value * 1e4) / 1e4 + 0;
const cellOf = (grid: GridLike | null): number => (grid && typeof grid.size === 'number' && grid.size > 0 ? grid.size : 100);
const offsetOf = (grid: GridLike | null): Point => ({ x: typeof grid?.offsetX === 'number' ? grid.offsetX : 0, y: typeof grid?.offsetY === 'number' ? grid.offsetY : 0 });
function stretchOf(grid: GridLike | null): StretchLike {
  const raw = grid?.mapStretch;
  if (!isObj(raw) || typeof raw.x !== 'number' || typeof raw.y !== 'number') return { x: 1, y: 1 };
  return { x: raw.x, y: raw.y, ...(typeof raw.rotation === 'number' && raw.rotation !== 0 ? { rotation: raw.rotation } : {}) };
}
const sameStretch = (a: StretchLike, b: StretchLike): boolean => a.x === b.x && a.y === b.y && (a.rotation ?? 0) === (b.rotation ?? 0);
const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** The move of a frame: a member's point in the base's pixels. */
export function moveOf(frame: Frame): (point: Point) => Point {
  return (point) => ({ x: point.x * frame.k + frame.x, y: point.y * frame.k + frame.y });
}

/**
 * Where a member lies on its base: `k` makes its squares the base's, and the offset lays its grid on the base's, then
 * shifts it as its placement says (`elevationLayer.ts` drew it so). Atlas turns no level: a turned member lies
 * unturned about its middle (about its corner where its size is not known), on the grid. Atlas keeps no level left of
 * or above the scene's origin: such a member is raised by whole squares. Both are said in `lost`. No alignment at all
 * for a member that lies in the scene's own frame (same squares, same place, its image stretched as the base's).
 */
export function frameOf(base: GridLike | null, member: GridLike | null, placement: Placement, size: { width: number; height: number } | null): { alignment: LevelAlignmentLike | null; frame: Frame; lost: string[] } {
  const cell = cellOf(base);
  const k = cellOf(base) / cellOf(member);
  const from = offsetOf(base);
  const own = offsetOf(member);
  const aligned = { x: from.x - own.x * k, y: from.y - own.y * k };
  const lost: string[] = [];
  let at = { x: aligned.x + placement.x, y: aligned.y + placement.y };
  if (Math.abs(placement.turn) > 1e-6) {
    // world = turn(k p + aligned) + shift: its middle stays where it was, and its grid goes back on the base's.
    const middle = size ? { x: (size.width * k) / 2, y: (size.height * k) / 2 } : { x: 0, y: 0 };
    const turned = turnPoint({ x: middle.x + aligned.x, y: middle.y + aligned.y }, placement.turn);
    const corner = { x: turned.x + placement.x - middle.x, y: turned.y + placement.y - middle.y };
    at = { x: aligned.x + Math.round((corner.x - aligned.x) / cell) * cell, y: aligned.y + Math.round((corner.y - aligned.y) / cell) * cell };
    lost.push(`its turn of ${round(placement.turn)} degrees is not kept (Atlas turns no level): it lies unturned about its ${size ? 'middle' : 'corner'}`);
  }
  const raise = { x: at.x < 0 ? Math.ceil(-at.x / cell) : 0, y: at.y < 0 ? Math.ceil(-at.y / cell) : 0 };
  if (raise.x > 0 || raise.y > 0) {
    at = { x: at.x + raise.x * cell, y: at.y + raise.y * cell };
    const ways = [raise.x > 0 ? `${plural(raise.x, 'square', 'squares')} to the right` : '', raise.y > 0 ? `${plural(raise.y, 'square', 'squares')} down` : ''].filter((way) => way !== '');
    lost.push(`it lay left of or above the base's corner, where Atlas keeps no level: it stands ${ways.join(' and ')} of where it stood`);
  }
  const frame = { k: round(k), x: round(at.x), y: round(at.y) };
  const stretch = stretchOf(member);
  const inFrame = frame.k === 1 && frame.x === 0 && frame.y === 0 && sameStretch(stretch, stretchOf(base));
  return { alignment: inFrame ? null : { offset: { x: frame.x, y: frame.y }, scale: frame.k, stretch }, frame, lost };
}

const levelCount = (scene: SceneFields): number => (Array.isArray(scene.levels) ? scene.levels.filter(isObj).length : 0);

/** Why a stack cannot become the levels of its base, in words that follow "its stack was not moved: "; null when it can. */
export function stackSkip(base: SceneFields | null, members: ReadonlyArray<{ name: string; scene: SceneFields | null }>): string | null {
  if (members.length === 0) return 'it has no scenes stacked on it';
  if (!base) return 'the base scene could not be read (Atlas did not come to hold it)';
  if (levelCount(base) > 1) return 'the base scene already has Atlas levels';
  for (const { name, scene } of members) {
    if (!scene) return `${name} could not be read (Atlas did not come to hold it)`;
    if (levelCount(scene) > 1) return `${name} has Atlas levels of its own`;
    const k = cellOf(base.grid) / cellOf(scene.grid);
    if (k < SCALES.least || k > SCALES.most) return `the grid of ${name} is too far from the base's in size for Atlas to fit it`;
  }
  return null;
}

/** Whether a record is one a spell stands in Atlas (`spellReconciler.ts`): derived again for the copied measure, never copied. */
function derived(kind: string, record: Raw): boolean {
  if (kind !== 'walls' && kind !== 'mapFeatures' && kind !== 'lights') return false;
  if (isObj(record.tabletop) && typeof record.tabletop.spell === 'string') return true;
  return kind === 'walls' && typeof record.chainId === 'string' && record.chainId.startsWith('spell:');
}

/** A member's records with what Tabletop's data still says of its walls, doors and lights on them (`extrasMigration.ts`). */
function withExtras(objects: SceneFields['objects'], legacy: LegacyExtras | null): SceneFields['objects'] {
  if (!legacy) return objects;
  const plan = planExtrasMove(legacy, objects);
  const fold = (record: Record<string, unknown> | undefined, changes: ReadonlyArray<{ id: string; change: Readonly<Record<string, unknown>> }>): Record<string, unknown> | undefined => {
    if (!record || changes.length === 0) return record;
    const next = { ...record };
    for (const { id, change } of changes) {
      const entry = next[id];
      if (!isObj(entry)) continue;
      const tabletop = mergeExtra(entry.tabletop, change);
      next[id] = tabletop ? { ...entry, tabletop } : entry;
    }
    return next;
  };
  return {
    ...objects,
    walls: fold(objects.walls, plan.walls),
    lights: fold(objects.lights, plan.lights.map(({ id, height }) => ({ id, change: { height } }))),
    tokens: fold(objects.tokens, plan.tokens.map(({ id, height }) => ({ id, change: { lightHeight: height } }))),
  };
}

/**
 * The stack as one scene with levels. `base.scene` is the base as Atlas holds it now (no levels, or the one Atlas
 * gave it), `members` each as Atlas held it. The base is at height 0 and the members by their heights, in the base's
 * game units; a member under the base comes first, and is then the scene's first level (its image the scene's
 * background, the base's records naming the base's level, as Atlas's own reordering leaves them).
 */
export function planStackMove(base: BaseSource, members: readonly MemberSource[], newLevelId: () => string): StackPlan {
  const unit = typeof base.scene.grid?.unitDistance === 'number' && base.scene.grid.unitDistance > 0 ? base.scene.grid.unitDistance : 5;
  const own = Array.isArray(base.scene.levels) ? base.scene.levels.filter(isObj).find((level) => typeof level.id === 'string') : undefined;
  const baseLevel = own ? (own.id as string) : newLevelId();
  const levelOf = members.map(() => newLevelId());
  const floors = [
    { id: baseLevel, name: own && typeof own.name === 'string' && own.name !== '' ? own.name : base.name, bottom: 0, background: base.scene.background, path: base.path, base: true },
    ...members.map((member, at) => ({ id: levelOf[at]!, name: member.name, bottom: round(member.elevation * unit), background: member.scene.background, path: member.path, base: false })),
  ].sort((a, b) => a.bottom - b.bottom || Number(b.base) - Number(a.base) || a.path.localeCompare(b.path));
  const levels = floors.map((floor, at) => {
    const next = floors[at + 1];
    return { id: floor.id, name: floor.name, elevation: { bottom: floor.bottom, top: next ? Math.min(next.bottom, floor.bottom + LEVEL_HEIGHT) : floor.bottom + LEVEL_HEIGHT }, background: floor.background };
  });
  const first = floors[0]!;

  // The base's records: as they are while it is the first level; naming their level once another is.
  const objects: SceneFields['objects'] = {};
  for (const [kind, record] of Object.entries(base.scene.objects)) {
    if (!isObj(record) || first.base || !KINDS.includes(kind)) { objects[kind] = record; continue; }
    const many = (ON_MANY as readonly string[]).includes(kind);
    objects[kind] = Object.fromEntries(Object.entries(record).map(([id, entry]) => {
      if (!isObj(entry)) return [id, entry];
      return [id, many ? (entry.levels === 'all' ? entry : { ...entry, levels: [baseLevel] }) : { ...entry, level: baseLevel }];
    }));
  }
  const chains = new Set<string>();
  const noteChains = (): void => { for (const wall of Object.values(objects.walls ?? {})) if (isObj(wall) && typeof wall.chainId === 'string') chains.add(wall.chainId); };
  noteChains();

  const lost: string[] = [];
  const aligns: StackPlan['aligns'] = [];
  const moves: MemberMove[] = [];
  members.forEach((member, at) => {
    const level = levelOf[at]!;
    const say = (line: string): void => { lost.push(`${member.name}: ${line}`); };
    const { alignment, frame, lost: framed } = frameOf(base.scene.grid, member.scene.grid, member.placement, member.size);
    framed.forEach(say);
    if (alignment) aligns.push({ level, alignment, frame });
    const suffix = `_s${at + 2}`;
    const ids: MemberMove['ids'] = {};
    const fresh = (kind: string, id: string): string => {
      const taken = objects[kind] ?? {};
      if (!Object.hasOwn(taken, id)) return id;
      let next = `${id}${suffix}`;
      while (Object.hasOwn(taken, next)) next += 'x';
      (ids[kind] ??= {})[id] = next;
      return next;
    };
    const source = withExtras(member.scene.objects, member.legacyExtras);
    // Tokens first: measures name them.
    const order = [...KINDS].sort((a, b) => Number(b === 'tokens') - Number(a === 'tokens'));
    const chainOf = new Map<string, string>();
    for (const kind of order) {
      const record = source[kind];
      if (!isObj(record)) continue;
      const many = (ON_MANY as readonly string[]).includes(kind);
      for (const [id, entry] of Object.entries(record)) {
        if (!isObj(entry) || derived(kind, entry)) continue;
        const newId = fresh(kind, id);
        const copy: Raw = { ...entry, id: newId, ...(many ? { levels: [level] } : { level }) };
        if (kind === 'walls' && typeof entry.chainId === 'string') {
          let chain = chainOf.get(entry.chainId);
          if (chain === undefined) {
            chain = entry.chainId;
            if (chains.has(chain)) { chain = `${entry.chainId}${suffix}`; while (chains.has(chain)) chain += 'x'; }
            chainOf.set(entry.chainId, chain);
          }
          copy.chainId = chain;
        }
        if (kind === 'measures') {
          const tokens = ids.tokens ?? {};
          if (typeof entry.follows === 'string') copy.follows = tokens[entry.follows] ?? entry.follows;
          if (isObj(entry.origin) && Array.isArray(entry.origin.tokenIds)) copy.origin = { ...entry.origin, tokenIds: entry.origin.tokenIds.map((token) => (typeof token === 'string' ? tokens[token] ?? token : token)) };
        }
        (objects[kind] ??= {})[newId] = copy;
      }
    }
    noteChains();
    // Its old water, never moved to its own liquids: as the brush's water of the level, in its own pixels like the rest.
    if (member.legacyWater) {
      const water = member.size ? legacyWaterLiquids(member.legacyWater, member.size.width, member.size.height, cellOf(member.scene.grid), level) : null;
      if (!water) say('its painted water could not be read (the size of its image could not be had, or it was painted on another image) and stays in Tabletop\'s data for that scene');
      else water.forEach((liquid, n) => { const id = fresh('liquids', `${level}_water_${n + 1}`); (objects.liquids ??= {})[id] = { id, kind: 'liquid', ...liquid }; });
    }
    if (member.scene.exploredMask) say('what players had explored on it is not kept');
    if (member.hasInitiative) say('its initiative order stays with the scene of its own');
    if (member.fogHeight !== base.fogHeight) say(`its fog height (${member.fogHeight}) is the base's from now on (${base.fogHeight})`);
    if (member.wallThickness !== base.wallThickness) say(`its wall thickness (${member.wallThickness}) is the base's from now on (${base.wallThickness})`);
    if (JSON.stringify(member.scene.lighting ?? null) !== JSON.stringify(base.scene.lighting ?? null)) say('its Atlas lighting (light level, global light) is the base\'s from now on');
    if (frame.k !== 1) say(`its squares are ${cellOf(member.scene.grid)} pixels and the base's ${cellOf(base.scene.grid)}: text sizes and brush widths keep their size in pixels`);
    moves.push({ path: member.path, level, ids, frame });
  });

  const exploredMasks = !first.base && base.scene.exploredMask ? { [baseLevel]: base.scene.exploredMask } : undefined;
  return {
    scene: {
      levels,
      background: first.background,
      objects,
      exploredMask: first.base ? base.scene.exploredMask ?? null : null,
      exploredMasks,
      levelAlignments: undefined,
      grid: base.scene.grid,
    },
    aligns,
    baseLevel,
    members: moves,
    lost,
  };
}
