/**
 * Atlas's kept measures (`objects.measures`) as the board draws them. They are the one place a spell, a template or an
 * area of the map lives: nothing here is kept, both lists are worked out again whenever the map's measures change.
 *
 * - `castsOfMeasures`: the measures that hold a spell (their `tabletop` field, `packages/atlas-host` `spellMeasure`),
 *   each read back as the cast the board draws in 3D, where its measure lies now.
 * - `marksOfMeasures`: every other measure flat on the map: an area made in Atlas, a kept ruler as its legs, a
 *   template with its owner, and a spell that no longer reads as one (as the area its points say).
 * - `spellWrite`: what a change asked on the GM's board writes to Atlas's measures.
 *
 * Two things of Atlas's are read with every measure (`MeasureLook`): one that follows a token (an aura, or a spell the
 * GM made follow its caster) lies around that token, not where its points were last written; and what Atlas keeps from
 * its players (a hidden measure, one that started on a token they did not or do not see) is marked the GM's alone.
 */
import { measureKind, measureToSpell, readExtra, spellToMeasure, type MeasureRecord } from '../../packages/atlas-host/src/spellMeasure';
import { readMeasureEffect, type MeasureEffect } from '../atlasPort/app/measure/measureEffects';
import type { MeasureShapeKind } from '../atlasPort/app/measure/measureTypes';
import type { SpellChange, TemplateMark } from './playerTools';
import { readSpellRules } from './spellRules';
import { isInstantaneous, readSpell, readSpellAbout, type CastSpell } from './spells';

/** A measure of the map's shown level: its id in Atlas (its place in Atlas's record) and the record as Atlas keeps it. */
export interface BoardMeasure { id: string; record: MeasureRecord }

/** Whose a measure is that names no owner: the GM's, as everything made in Atlas is. */
export const GM_MEASURE_OWNER = 'gm';
/** The colour of a spell that names none: white, as the board always cast the GM's. */
const PLAIN_SPELL = '#ffffff';

type Place = { x: number; y: number };

/** What of the map's tokens places and shows a measure. */
export interface MeasureLook {
  /** Where the token stands (its centre, map pixels); null when the map has no such token. Without it, no measure that follows a token is drawn. */
  tokenAt?(tokenId: string): Place | null;
  /** Whether players do not see the token (hidden, or not on the map). Without it, every token is taken as seen. */
  unseen?(tokenId: string): boolean;
}

const SHAPES: readonly string[] = ['ruler', 'circle', 'cone', 'square', 'line'];
const isPlace = (value: unknown): value is Place => typeof value === 'object' && value !== null
  && Number.isFinite((value as { x?: unknown }).x) && Number.isFinite((value as { y?: unknown }).y);

/** The measures of a record of Atlas's (`objects.measures`, those of the level shown): what reads as one, in the order they were made. */
export function readMeasures(raw: unknown): BoardMeasure[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const measures: BoardMeasure[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Partial<MeasureRecord>;
    if (typeof record.shape !== 'string' || !SHAPES.includes(record.shape)) continue;
    if (!Array.isArray(record.points) || record.points.length < 2 || !record.points.every(isPlace)) continue;
    measures.push({ id, record: record as MeasureRecord });
  }
  return measures;
}

/** The token a measure follows (Atlas's `isAura`: a circle with both fields); null for one that follows none. */
export function followedToken(record: MeasureRecord): string | null {
  const { follows, aura } = record as { follows?: unknown; aura?: unknown };
  return record.shape === 'circle' && typeof follows === 'string' && follows !== '' && typeof aura === 'number' && aura > 0 ? follows : null;
}

/**
 * A measure where it lies now: one that follows a token is moved to lie around it, as large as it was last made (its
 * points are where it lay when it was last edited; Atlas places it from the token). Null when its token is not on the map.
 */
export function placedMeasure(record: MeasureRecord, tokenAt: MeasureLook['tokenAt']): MeasureRecord | null {
  const token = followedToken(record);
  if (token === null) return record;
  const at = tokenAt?.(token) ?? null;
  if (!at) return null;
  const dx = at.x - record.points[0].x;
  const dy = at.y - record.points[0].y;
  return dx === 0 && dy === 0 ? record : { ...record, points: record.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
}

/**
 * Whether Atlas keeps a measure from its players (its `measureShownToPlayers`, read closed): a hidden one, one that
 * started on a token they did not see then or do not see now (an origin that cannot be read counts as unseen), and one
 * that follows a token they do not see.
 */
function gmOnly(record: MeasureRecord, unseen: MeasureLook['unseen']): boolean {
  if ((record as { hidden?: unknown }).hidden === true) return true;
  const token = followedToken(record);
  if (token !== null && unseen?.(token) === true) return true;
  const origin = (record as { origin?: unknown }).origin;
  if (origin === undefined) return false;
  if (typeof origin !== 'object' || origin === null) return true;
  const { tokenIds, unseenAtStart } = origin as { tokenIds?: unknown; unseenAtStart?: unknown };
  if (unseenAtStart !== false || !Array.isArray(tokenIds)) return true;
  return tokenIds.some((id) => typeof id !== 'string' || unseen?.(id) === true);
}

/** The map's kept spells as casts, in the order they were made: each read back from its measure where it lies now. */
export function castsOfMeasures(measures: readonly BoardMeasure[], look: MeasureLook = {}): CastSpell[] {
  const casts: CastSpell[] = [];
  for (const { id, record } of measures) {
    if (measureKind(record) !== 'spell') continue;
    const placed = placedMeasure(record, look.tokenAt);
    const read = placed ? measureToSpell(placed) : null;
    const spell = read ? readSpell(read.spell) : null;
    if (!read || !spell) continue;
    // Atlas 0.19's `walls: false` lets the measure pass walls; any other value, and none (older Atlas), stops it.
    if ((record as { walls?: unknown }).walls === false) spell.uncut = true;
    const rules = readSpellRules(read.meta.rules);
    const about = readSpellAbout(read.meta.about);
    const name = typeof read.meta.name === 'string' ? read.meta.name.trim().slice(0, 60) : '';
    casts.push({
      id, owner: read.meta.owner ?? GM_MEASURE_OWNER, color: read.meta.color ?? PLAIN_SPELL, spell,
      ...(rules ? { rules } : {}), ...(name ? { name } : {}), ...(about ? { about } : {}),
      ...(gmOnly(record, look.unseen) ? { gmOnly: true as const } : {}),
    });
  }
  return casts;
}

/**
 * The map's other measures as flat marks, in the order they were made. `cell` is the map's cell size (a line that
 * names no width is one cell wide, as Atlas draws it); `accent` colours a measure that names no colour.
 */
export function marksOfMeasures(measures: readonly BoardMeasure[], look: MeasureLook & { cell: number; accent: string }): TemplateMark[] {
  const marks: TemplateMark[] = [];
  for (const { id, record: kept } of measures) {
    const kind = measureKind(kept);
    // A spell is drawn in 3D (`castsOfMeasures`).
    if (kind === 'spell') continue;
    const record = placedMeasure(kept, look.tokenAt);
    if (!record) continue;
    const effect = record.shape === 'ruler' ? undefined : readMeasureEffect(record.effect);
    const shared = {
      owner: readExtra(record)?.owner ?? GM_MEASURE_OWNER, color: typeof record.color === 'string' ? record.color : look.accent, kind,
      ...(effect ? { effect } : {}),
      ...((record as { walls?: unknown }).walls === false ? { uncut: true as const } : {}),
      ...(gmOnly(kept, look.unseen) ? { gmOnly: true as const } : {}),
    };
    if (record.shape === 'ruler') {
      for (let leg = 0; leg + 1 < record.points.length; leg++) {
        marks.push({ id: `${id}:${leg}`, shape: 'line', start: { x: record.points[leg].x, y: record.points[leg].y }, end: { x: record.points[leg + 1].x, y: record.points[leg + 1].y }, ruler: true, ...shared });
      }
      continue;
    }
    const [start, end] = record.points;
    marks.push({ id, shape: record.shape, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, ...(record.shape === 'line' ? { width: typeof record.width === 'number' && record.width > 0 ? record.width : look.cell } : {}), ...shared });
  }
  return marks;
}

/** The measures of `measures` that are the GM's of `kind`: those that name no owner, or the GM. */
function gmOwned(measures: readonly BoardMeasure[], kind: 'spell'): string[] {
  return measures.filter(({ record }) => {
    const extra = readExtra(record);
    return extra?.kind === kind && (extra.owner ?? GM_MEASURE_OWNER) === GM_MEASURE_OWNER;
  }).map(({ id }) => id);
}

/** A measure made on the board is kept on the level the board shows (Atlas's own shown level where the map has none). */
const onLevel = (level: string | null): { level?: string } => (level ? { level } : {});

/** What a write to Atlas's measures is: a record to keep, or the ids to take off (in one step of Atlas's history). */
export type MeasureWrite = { add: Record<string, unknown> } | { remove: string[] };

/**
 * What a spell change on the GM's board comes to. A cast that lasts is one measure to keep, on the level shown; an
 * instantaneous one goes off (`flash`) and is written nowhere, unless it summons (Find Familiar: its going is what
 * offers to take its summons off). One erased is that measure taken off; a clear takes the GM's own spells of the
 * shown level, never a player's, a template or an area made in Atlas. Null for what is no write (an ask turned down).
 */
export function spellWrite(change: SpellChange, measures: readonly BoardMeasure[], level: string | null): MeasureWrite | { flash: Omit<CastSpell, 'id'> } | null {
  if ('add' in change) {
    const words = change.name ? { name: change.name, ...(change.about ? { about: change.about } : {}) } : {};
    const rules = change.rules ? { rules: change.rules } : {};
    if (isInstantaneous({ about: change.about }) && !change.rules?.summon) {
      return { flash: { owner: GM_MEASURE_OWNER, color: PLAIN_SPELL, spell: change.add, ...rules, ...words } };
    }
    return { add: { ...spellToMeasure(change.add, { ...rules, ...words }), ...onLevel(level) } };
  }
  if ('remove' in change) return { remove: [change.remove] };
  if ('clear' in change) return { remove: gmOwned(measures, 'spell') };
  return null;
}

/** A change from the GM's Measure tool: keep one measurement on the map, or clear all kept measurements on the shown level. */
export type MeasureChange =
  | {
      add: {
        shape: MeasureShapeKind;
        points: ReadonlyArray<Place>;
        width?: number;
        color?: string;
        hidden?: true;
        effect?: MeasureEffect;
      };
    }
  | { clear: true };

/**
 * What the GM's Measure tool writes to Atlas's kept measures: an Atlas measure record (colour, hidden, effect for
 * areas, width for lines, level when levelled), or removing every kept measure of the shown level in one undo step.
 */
export function measureWrite(change: MeasureChange, measures: readonly BoardMeasure[], level: string | null): MeasureWrite {
  if ('add' in change) {
    const { shape, points, width, color, hidden, effect } = change.add;
    return {
      add: {
        shape,
        points: points.map((point) => ({ x: point.x, y: point.y })),
        ...(shape === 'line' && typeof width === 'number' && width > 0 ? { width } : {}),
        ...(color ? { color } : {}),
        ...(hidden === true ? { hidden: true } : {}),
        ...(shape !== 'ruler' && effect ? { effect } : {}),
        ...onLevel(level),
      },
    };
  }
  return { remove: measures.map(({ id }) => id) };
}
