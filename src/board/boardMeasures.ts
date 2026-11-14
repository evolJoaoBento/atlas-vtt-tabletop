/**
 * Atlas's kept measures (`objects.measures`) as the board draws them. They are the one place a spell, a template or an
 * area of the map lives: nothing here is kept, both lists are worked out again whenever the map's measures change.
 *
 * - `castsOfMeasures`: the measures that hold a spell (their `tabletop` field, `packages/atlas-host` `spellMeasure`),
 *   each read back as the cast the board draws in 3D, where its measure lies now.
 * - `marksOfMeasures`: every other measure flat on the map: an area made in Atlas, a kept ruler as its legs, a
 *   template with its owner. A spell is left out: its 3D shape is its mark; so is a token's aura.
 * - `spellWrite`, `templateWrite`: what a change asked on the GM's board writes to Atlas's measures.
 */
import { measureToSpell, readExtra, spellToMeasure, type MeasureRecord } from '../../packages/atlas-host/src/spellMeasure';
import type { SpellChange, TemplateChange, TemplateMark } from './playerTools';
import { readSpellRules } from './spellRules';
import { isInstantaneous, readSpell, readSpellAbout, type CastSpell } from './spells';

/** A measure of the map's shown level: its id in Atlas and the record as Atlas keeps it. */
export interface BoardMeasure { id: string; record: MeasureRecord }

/** Whose a measure is that names no owner: the GM's, as everything made in Atlas is. */
export const GM_MEASURE_OWNER = 'gm';
/** The colour of a spell that names none: white, as the board always cast the GM's. */
const PLAIN_SPELL = '#ffffff';

const SHAPES: readonly string[] = ['ruler', 'circle', 'cone', 'square', 'line'];
const isPlace = (value: unknown): value is { x: number; y: number } => typeof value === 'object' && value !== null
  && Number.isFinite((value as { x?: unknown }).x) && Number.isFinite((value as { y?: unknown }).y);

/** The measures of a record of Atlas's (`objects.measures`, those of the level shown): what reads as one, in the order they were made. */
export function readMeasures(raw: unknown): BoardMeasure[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return [];
  const measures: BoardMeasure[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Partial<MeasureRecord>;
    if (typeof record.shape !== 'string' || !SHAPES.includes(record.shape)) continue;
    if (!Array.isArray(record.points) || record.points.length < 2 || !record.points.every(isPlace)) continue;
    measures.push({ id: typeof record.id === 'string' && record.id ? record.id : key, record: record as MeasureRecord });
  }
  return measures;
}

/** The map's kept spells as casts, in the order they were made: each read back from its measure where it lies now. */
export function castsOfMeasures(measures: readonly BoardMeasure[]): CastSpell[] {
  const casts: CastSpell[] = [];
  for (const { id, record } of measures) {
    const read = measureToSpell(record);
    const spell = read ? readSpell(read.spell) : null;
    if (!read || !spell) continue;
    const rules = readSpellRules(read.meta.rules);
    const about = readSpellAbout(read.meta.about);
    const name = typeof read.meta.name === 'string' ? read.meta.name.trim().slice(0, 60) : '';
    casts.push({
      id, owner: read.meta.owner ?? GM_MEASURE_OWNER, color: read.meta.color ?? PLAIN_SPELL, spell,
      ...(rules ? { rules } : {}), ...(name ? { name } : {}), ...(about ? { about } : {}),
    });
  }
  return casts;
}

/**
 * The map's other measures as flat marks, in the order they were made. `cell` is the map's cell size (a line that
 * names no width is one cell wide, as Atlas draws it); `accent` colours a measure that names no colour.
 */
export function marksOfMeasures(measures: readonly BoardMeasure[], look: { cell: number; accent: string }): TemplateMark[] {
  const marks: TemplateMark[] = [];
  for (const { id, record } of measures) {
    const extra = readExtra(record);
    if (extra?.kind === 'spell') continue;
    // An aura (Atlas's `isAura`: a circle with both fields) lies around its token wherever that stands, not where its
    // points were last written: not drawn here yet.
    const { follows, aura } = record as { follows?: unknown; aura?: unknown };
    if (record.shape === 'circle' && typeof follows === 'string' && follows !== '' && typeof aura === 'number' && aura > 0) continue;
    const shared = { owner: extra?.owner ?? GM_MEASURE_OWNER, color: typeof record.color === 'string' ? record.color : look.accent, kind: extra?.kind === 'template' ? 'template' as const : 'area' as const };
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
function gmOwned(measures: readonly BoardMeasure[], kind: 'spell' | 'template'): string[] {
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

/**
 * What the GM's Template tool comes to: a template placed is one measure to keep (the GM's, lasting until taken off),
 * shaped by Atlas from its two points; a tap takes anyone's template off, and nothing that is not one; the clear takes
 * the GM's own.
 */
export function templateWrite(change: TemplateChange, measures: readonly BoardMeasure[], level: string | null): MeasureWrite {
  if ('add' in change) {
    const { shape, start, end } = change.add;
    return { add: { shape, points: [{ x: start.x, y: start.y }, { x: end.x, y: end.y }], tabletop: { v: 1, kind: 'template', owner: GM_MEASURE_OWNER }, ...onLevel(level) } };
  }
  if ('remove' in change) return { remove: measures.filter(({ id, record }) => id === change.remove && readExtra(record)?.kind === 'template').map(({ id }) => id) };
  return { remove: gmOwned(measures, 'template') };
}
