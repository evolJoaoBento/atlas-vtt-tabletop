/**
 * A scene stack of older Tabletop (maps stacked on a base map, each at a height and a place on the plane, kept in
 * Tabletop's data) as the Atlas levels of its base scene: the plan of the one write that makes it so.
 *
 * - `frameOf`: where a member's pixels lie in the base's (a scale and an offset: Atlas turns no level).
 * - `planStackMove`: the scene as it is handed to Atlas's `applyLevelScene`: the levels by height, the base's records
 *   and every member's on their level (as they lie on the member: Atlas's `alignLevel` then moves a fitted level's
 *   with its image), ids given anew where the base has them already, and what is not kept, in words. Atlas keeps no
 *   level left of or above the scene's origin: where a floor would lie there the whole scene, the base included, is
 *   set to the right or down by whole squares, so every floor keeps its place against the others.
 * - `stackSkip`: why a stack cannot become levels at all.
 *
 * Pure. The level tag of each kind of record is Atlas's (`objectsAfterLevelEdit`).
 */
import { planExtrasMove } from './extrasMigration';
import { NO_PLACEMENT, turnPoint, type Placement } from './layerPlacement';
import { legacyWaterLiquids } from './liquids';
import { mergeExtra, type LegacyExtras } from './recordExtras';

type Point = { x: number; y: number };
type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

export interface StretchLike { x: number; y: number; rotation?: number }
export interface GridLike { size?: number; offsetX?: number; offsetY?: number; unitDistance?: number; mapStretch?: unknown; type?: string }
/** A level's alignment as Atlas keeps it (`LevelAlignment`). */
export interface LevelAlignmentLike { offset: Point; scale: number; stretch: StretchLike }
/** A scene's pixels in the moved scene's: `p' = k·p + (x, y)`. */
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

export interface BaseSource {
  path: string;
  name: string;
  scene: SceneFields;
  fogHeight: number;
  wallThickness: number;
  /** Game units a square of the base spans, as the board reads them (the scene's override, else its collection's); unset: the grid's own. */
  unitDistance?: number;
}

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
  /** Where the base's own pixels lie now: as they were, or set to the right or down by whole squares with the whole scene. */
  baseFrame: Frame;
  members: MemberMove[];
  lost: string[];
}

/** Records that stand on one level (`level`) and on several (`levels`), as Atlas tags them. */
const ON_ONE = ['tokens', 'fog', 'pins', 'texts', 'drawings', 'mapFeatures', 'liquids', 'measures', 'levelSurfaces'] as const;
const ON_MANY = ['walls', 'lights', 'audios', 'lightZones'] as const;
/** What a member gives its level. Stairs (`levelLinks`) join levels a member alone never had: they are only the base's to tag. */
const KINDS: readonly string[] = [...ON_ONE, ...ON_MANY];
const TAGGED_MANY: readonly string[] = [...ON_MANY, 'levelLinks'];
/** A record's sizes that are kept in pixels, by kind: Atlas moves a level's points with its image, never its sizes. */
const PIXEL_SIZES: Record<string, readonly string[]> = {
  fog: ['brushRadius'], drawings: ['width'], texts: ['fontSize', 'width', 'height', 'padding', 'borderRadius'], audios: ['innerRadius', 'outerRadius'], measures: ['width'],
};
/** The scales Atlas reads a level's alignment with (`readLevelAlignment`). */
const SCALES = { least: 0.05, most: 20 };
/** Game units a level spans when nothing says otherwise (Atlas's `LEVEL_HEIGHT`). */
const LEVEL_HEIGHT = 10;
const NO_FRAME: Frame = { k: 1, x: 0, y: 0 };

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
const levelsOf = (scene: SceneFields): Raw[] => (Array.isArray(scene.levels) ? scene.levels.filter(isObj) : []);
/** The one level Atlas gave a scene that has no floors to speak of (a roof, a replaced image), and the fit of its image where it has one. */
function ownLevel(scene: SceneFields): { level: Raw; id: string; alignment: LevelAlignmentLike | null } | null {
  const level = levelsOf(scene).find((candidate) => typeof candidate.id === 'string');
  if (!level) return null;
  const id = level.id as string;
  return { level, id, alignment: scene.levelAlignments?.[id] ?? null };
}

/** The move of a frame: a point of the scene in the moved scene's pixels. */
export function moveOf(frame: Frame): (point: Point) => Point {
  return (point) => ({ x: point.x * frame.k + frame.x, y: point.y * frame.k + frame.y });
}

/**
 * Where a member lies on its base: `k` makes its squares the base's, and the offset lays its grid on the base's, then
 * shifts it as its placement says (`elevationLayer.ts` drew it so). Atlas turns no level: a turned member lies
 * unturned about its middle (about its corner where its size is not known), on the grid, and that is said in `lost`.
 * The frame may lie left of or above the base's corner (a negative offset): `planStackMove` then sets the whole scene
 * to the right or down.
 */
export function frameOf(base: GridLike | null, member: GridLike | null, placement: Placement, size: { width: number; height: number } | null): { frame: Frame; stretch: StretchLike; lost: string[] } {
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
  return { frame: { k: round(k), x: round(at.x), y: round(at.y) }, stretch: stretchOf(member), lost };
}

/** The alignment Atlas keeps for a level that lies by `frame`; none for one that lies in the scene's own frame (same squares, same place, its image stretched as the base's). */
export function alignmentOf(frame: Frame, stretch: StretchLike, baseStretch: StretchLike): LevelAlignmentLike | null {
  if (frame.k === 1 && frame.x === 0 && frame.y === 0 && sameStretch(stretch, baseStretch)) return null;
  return { offset: { x: frame.x, y: frame.y }, scale: frame.k, stretch };
}

/** How many whole squares the whole scene goes right and down so that no floor lies left of or above its corner. */
function raiseFor(frames: readonly Frame[], cell: number): Point {
  const squares = (least: number): number => (least < 0 ? Math.ceil(-least / cell) : 0);
  return { x: squares(Math.min(0, ...frames.map((frame) => frame.x))), y: squares(Math.min(0, ...frames.map((frame) => frame.y))) };
}

/**
 * Why a stack cannot become the levels of its base, in words that follow "its stack was not moved: "; null when it
 * can. `own.legacyWater`: the base's old painted water is still a mask in Tabletop's data (it is read over the scene's
 * first level, at its image's corner).
 */
export function stackSkip(
  base: SceneFields | null,
  members: ReadonlyArray<{ name: string; scene: SceneFields | null; elevation?: number; placement?: Placement; size?: { width: number; height: number } | null }>,
  own: { legacyWater?: boolean } = {},
): string | null {
  if (members.length === 0) return 'it has no scenes stacked on it';
  if (!base) return 'the base scene could not be read (Atlas did not come to hold it)';
  if (levelsOf(base).length > 1) return 'the base scene already has Atlas levels';
  const frames: Frame[] = [];
  for (const { name, scene, placement, size } of members) {
    if (!scene) return `${name} could not be read (Atlas did not come to hold it)`;
    if (levelsOf(scene).length > 1) return `${name} has Atlas levels of its own`;
    const k = cellOf(base.grid) / cellOf(scene.grid);
    if (k < SCALES.least || k > SCALES.most) return `the grid of ${name} is too far from the base's in size for Atlas to fit it`;
    if (ownLevel(scene)?.alignment) return `the image of ${name} is fitted to its grid by Atlas already (it was replaced by one of another size): Atlas keeps one fit a level`;
    frames.push(frameOf(base.grid, scene.grid, placement ?? NO_PLACEMENT, size ?? null).frame);
  }
  const water = 'the base\'s painted water has not moved to Atlas yet: open its 3D board once, then move the stack';
  const raise = raiseFor(frames, cellOf(base.grid));
  if (raise.x > 0 || raise.y > 0) {
    // The whole scene goes right or down by whole squares.
    if (typeof base.grid?.type === 'string' && base.grid.type !== 'square') return 'a floor of it lies left of or above the base\'s corner, and on a hex grid the scene cannot be set aside by whole squares';
    if (ownLevel(base)?.alignment) return 'a floor of it lies left of or above the base\'s corner, and the base\'s image is fitted to its grid by Atlas already';
    if (own.legacyWater) return water;
  }
  if (own.legacyWater && members.some((member) => (member.elevation ?? 0) < 0)) return water;
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

const lightingOn = (lighting: unknown): boolean => isObj(lighting) && lighting.enabled === true;

/**
 * The stack as one scene with levels. `base.scene` is the base as Atlas holds it now (no levels, or the one Atlas
 * gave it), `members` each as Atlas held it (`stackSkip` let them through). The base is at height 0 and the members
 * by their heights, in the units a square of the base spans; a member under the base comes first, and is then the
 * scene's first level (its image the scene's background, the base's records naming the base's level, as Atlas's own
 * reordering leaves them).
 */
export function planStackMove(base: BaseSource, members: readonly MemberSource[], newLevelId: () => string): StackPlan {
  const gridUnit = base.scene.grid?.unitDistance;
  const unit = base.unitDistance !== undefined && base.unitDistance > 0 ? base.unitDistance : typeof gridUnit === 'number' && gridUnit > 0 ? gridUnit : 5;
  const own = ownLevel(base.scene);
  const baseLevel = own ? own.id : newLevelId();
  const levelOf = members.map(() => newLevelId());
  const floors = [
    { id: baseLevel, name: own && typeof own.level.name === 'string' && own.level.name !== '' ? own.level.name : base.name, bottom: 0, background: base.scene.background, path: base.path, base: true, more: own ? own.level : {} },
    ...members.map((member, at) => {
      const theirs = ownLevel(member.scene)?.level ?? {};
      // Its one level's roof and whether its image's holes are openings; what names other levels is not its to keep.
      const more = { ...(typeof theirs.foreground === 'string' ? { foreground: theirs.foreground } : {}), ...(theirs.openArt === false ? { openArt: false } : {}) };
      return { id: levelOf[at]!, name: member.name, bottom: round(member.elevation * unit), background: member.scene.background, path: member.path, base: false, more };
    }),
  ].sort((a, b) => a.bottom - b.bottom || Number(b.base) - Number(a.base) || a.path.localeCompare(b.path));
  const levels = floors.map((floor, at) => {
    const next = floors[at + 1];
    // A floor spans to the one above, a storey at most; two at one height are each a storey.
    const top = next && next.bottom > floor.bottom ? Math.min(next.bottom, floor.bottom + LEVEL_HEIGHT) : floor.bottom + LEVEL_HEIGHT;
    return { ...floor.more, id: floor.id, name: floor.name, elevation: { bottom: floor.bottom, top }, background: floor.background };
  });
  const first = floors[0]!;

  // Where each member lies, and how far the whole scene goes right and down for none to lie left of or above its corner.
  const cell = cellOf(base.scene.grid);
  const framed = members.map((member) => frameOf(base.scene.grid, member.scene.grid, member.placement, member.size));
  const raise = raiseFor(framed.map((each) => each.frame), cell);
  const raised = raise.x > 0 || raise.y > 0;
  const baseFrame: Frame = raised ? { k: 1, x: raise.x * cell, y: raise.y * cell } : NO_FRAME;
  const baseStretch = stretchOf(base.scene.grid);

  // The base's records: as they are while it is the first level; naming their level once another is.
  const objects: SceneFields['objects'] = {};
  for (const [kind, record] of Object.entries(base.scene.objects)) {
    const one = (ON_ONE as readonly string[]).includes(kind);
    const many = TAGGED_MANY.includes(kind);
    if (!isObj(record) || first.base || (!one && !many)) { objects[kind] = record; continue; }
    objects[kind] = Object.fromEntries(Object.entries(record).map(([id, entry]) => {
      if (!isObj(entry)) return [id, entry];
      return [id, many ? (entry.levels === 'all' ? entry : { ...entry, levels: [baseLevel] }) : { ...entry, level: baseLevel }];
    }));
  }
  const chains = new Set<string>();
  const noteChains = (): void => { for (const wall of Object.values(objects.walls ?? {})) if (isObj(wall) && typeof wall.chainId === 'string') chains.add(wall.chainId); };
  noteChains();

  const urgent: string[] = [];
  const lost: string[] = [];
  const aligns: StackPlan['aligns'] = [];
  const moves: MemberMove[] = [];
  if (raised) {
    const ways = [raise.x > 0 ? `${plural(raise.x, 'square', 'squares')} to the right` : '', raise.y > 0 ? `${plural(raise.y, 'square', 'squares')} down` : ''].filter((way) => way !== '');
    lost.push(`${base.name}: the whole scene stands ${ways.join(' and ')} of where it stood (a floor of it lay left of or above the base's corner, where Atlas keeps no level); every floor keeps its place against the others`);
    if (base.scene.exploredMask) lost.push(`${base.name}: what players had explored on it is not kept (its image moved)`);
    aligns.push({ level: baseLevel, alignment: { offset: { x: baseFrame.x, y: baseFrame.y }, scale: 1, stretch: baseStretch }, frame: baseFrame });
  }
  members.forEach((member, at) => {
    const level = levelOf[at]!;
    const say = (line: string): void => { lost.push(`${member.name}: ${line}`); };
    const { frame: lies, stretch, lost: framedLost } = framed[at]!;
    const frame: Frame = { k: lies.k, x: round(lies.x + baseFrame.x), y: round(lies.y + baseFrame.y) };
    // Players lose their sight limits on a level whose own lighting was on under a base's that is off: said first.
    if (lightingOn(member.scene.lighting) && !lightingOn(base.scene.lighting)) urgent.push(`${member.name}: players will see everything on it that fog does not cover (its Atlas lighting was on; the base's, which is the scene's from now on, is off)`);
    else if (JSON.stringify(member.scene.lighting ?? null) !== JSON.stringify(base.scene.lighting ?? null)) say('its Atlas lighting (light level, global light) is the base\'s from now on');
    framedLost.forEach(say);
    const alignment = alignmentOf(frame, stretch, baseStretch);
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
        if (frame.k !== 1) for (const size of PIXEL_SIZES[kind] ?? []) if (typeof entry[size] === 'number') copy[size] = round(entry[size] * frame.k);
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
          // A spell's caster is a token of the scene too.
          if (isObj(entry.tabletop) && typeof entry.tabletop.caster === 'string') copy.tabletop = { ...entry.tabletop, caster: tokens[entry.tabletop.caster] ?? entry.tabletop.caster };
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
    moves.push({ path: member.path, level, ids, frame });
  });

  // What players explored: the base's goes with its level, unless its image moved under it.
  const explored = raised ? null : base.scene.exploredMask ?? null;
  return {
    scene: {
      levels,
      background: first.background,
      objects,
      exploredMask: first.base ? explored : null,
      exploredMasks: !first.base && explored ? { [baseLevel]: explored } : undefined,
      // The fit Atlas already kept for the base's own level stays (a raised base is aligned anew, and has none: `stackSkip`).
      levelAlignments: own?.alignment && !raised ? { [baseLevel]: own.alignment } : undefined,
      grid: base.scene.grid,
    },
    aligns,
    baseLevel,
    baseFrame,
    members: moves,
    lost: [...urgent, ...lost],
  };
}
