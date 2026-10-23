/**
 * A token's stat sheet as the GM's board shows it: a whitelist of a creature's fields (`buildSheet`), every text
 * capped, never a path, an image or a field this file does not name; and the rolls on it, found by where they are
 * (`SheetRollRef`): an ability check, a save, a skill or a roll in a trait's text. Pure. Ported from Atlas VTT Connect
 * (MIT, `tools/sheets.ts`).
 */

export const SHEET_LIMITS = {
  name: 120,
  /** A short field: AC, HP, speed, a size and type line. */
  short: 200,
  /** One line of the sheet: senses, languages, immunities. */
  line: 500,
  lines: 16,
  /** One trait's or action's description. */
  desc: 2000,
  sections: 8,
  items: 40,
  bonuses: 24,
} as const;

export const ABILITY_NAMES = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

/** A named bonus a d20 is rolled with: a save or a skill. */
export interface SheetBonus {
  label: string;
  bonus: number;
}

export interface SheetItem {
  name: string;
  desc: string;
}

export interface SheetSection {
  title: string;
  items: SheetItem[];
}

export interface SheetLine {
  label: string;
  text: string;
}

export interface PlayerSheet {
  name: string;
  /** "Medium humanoid (elf), neutral good". */
  subtitle: string | null;
  ac: string | null;
  hp: string | null;
  speed: string | null;
  /** The six ability scores, STR to CHA; null when the stat block has none. */
  stats: number[] | null;
  saves: SheetBonus[];
  skills: SheetBonus[];
  lines: SheetLine[];
  sections: SheetSection[];
}

/** A roll with advantage or disadvantage. */
export type AdvantageSide = 'advantage' | 'disadvantage';

/**
 * Where on a sheet a roll is: an ability check, a save, a skill, or the n-th roll in a trait's or action's text, whose
 * `text` is what was clicked (rolled only while the sheet still has that text there).
 */
export type SheetRollRef =
  | { kind: 'check'; index: number }
  | { kind: 'save'; index: number }
  | { kind: 'skill'; index: number }
  | { kind: 'text'; section: number; item: number; index: number; text?: string };

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Plain text of at most `max` characters, or null: numbers become text, markup-looking brackets stay text. */
export function text(value: unknown, max: number): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).slice(0, max);
  if (typeof value !== 'string') return null;
  // Control characters out (tabs and line breaks become spaces with the rest of the whitespace), runs to one space.
  const kept = [...value].filter((char) => {
    const code = char.charCodeAt(0);
    return (code >= 32 && code !== 127) || char === '\n' || char === '\t' || char === '\r';
  }).join('');
  const cleaned = kept.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

export const modifierOf = (score: number): number => Math.floor((score - 10) / 2);

export const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value));

/** A save or skill list as Fantasy Statblocks keeps it: `[{ dexterity: 5 }]`, `[{ name, desc }]` or `{ perception: 4 }`. */
function bonuses(value: unknown): SheetBonus[] {
  const entries: Array<[unknown, unknown]> = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item)) continue;
      if ('name' in item) entries.push([item.name, item.desc ?? item.value ?? item.bonus]);
      else entries.push(...Object.entries(item));
    }
  } else if (isObject(value)) entries.push(...Object.entries(value));
  const found: SheetBonus[] = [];
  for (const [label, raw] of entries) {
    const name = text(label, 40);
    const bonus = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw.replace(/\s/g, ''), 10) : NaN;
    if (!name || !Number.isInteger(bonus) || Math.abs(bonus) > 99) continue;
    found.push({ label: name.charAt(0).toUpperCase() + name.slice(1), bonus });
    if (found.length >= SHEET_LIMITS.bonuses) break;
  }
  return found;
}

function items(value: unknown): SheetItem[] {
  if (!Array.isArray(value)) return [];
  const found: SheetItem[] = [];
  for (const entry of value) {
    let name: string | null = null;
    let desc: string | null = null;
    if (Array.isArray(entry)) {
      name = text(entry[0], SHEET_LIMITS.name);
      desc = text(entry[1], SHEET_LIMITS.desc);
    } else if (isObject(entry)) {
      name = text(entry.name, SHEET_LIMITS.name);
      desc = text(entry.desc ?? entry.description ?? entry.text, SHEET_LIMITS.desc);
    } else {
      desc = text(entry, SHEET_LIMITS.desc);
    }
    if (!name && !desc) continue;
    found.push({ name: name ?? '', desc: desc ?? '' });
    if (found.length >= SHEET_LIMITS.items) break;
  }
  return found;
}

/** A list field written out: an array of words or a string. */
function listText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const words = (value as unknown[]).map((item): unknown => (isObject(item) ? item.name : item))
      .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    return text(words.join(', '), SHEET_LIMITS.line);
  }
  return text(value, SHEET_LIMITS.line);
}

const SECTIONS: ReadonlyArray<[string, string]> = [
  ['traits', 'Traits'], ['spells', 'Spellcasting'], ['actions', 'Actions'], ['bonus_actions', 'Bonus actions'],
  ['reactions', 'Reactions'], ['legendary_actions', 'Legendary actions'], ['mythic_actions', 'Mythic actions'], ['lair_actions', 'Lair actions'],
];
const LINES: ReadonlyArray<[string, string]> = [
  ['damage_vulnerabilities', 'Vulnerabilities'], ['damage_resistances', 'Resistances'], ['damage_immunities', 'Immunities'],
  ['condition_immunities', 'Condition immunities'], ['senses', 'Senses'], ['languages', 'Languages'], ['cr', 'Challenge'],
];

/** The sheet of a creature as Fantasy Statblocks gives it (5e keys); null when it has no name. */
export function buildSheet(creature: unknown, fallbackName: string | null = null): PlayerSheet | null {
  if (!isObject(creature)) return null;
  const name = text(creature.name, SHEET_LIMITS.name) ?? fallbackName;
  if (!name) return null;
  const type = [text(creature.size, 40), text(creature.type, 60), creature.subtype ? `(${text(creature.subtype, 60) ?? ''})` : null].filter(Boolean).join(' ');
  const subtitle = text([type, text(creature.alignment, 60)].filter(Boolean).join(', '), SHEET_LIMITS.short);
  const stats = Array.isArray(creature.stats) && creature.stats.length >= 6
    && creature.stats.slice(0, 6).every((score) => typeof score === 'number' && Number.isFinite(score) && Math.abs(score) < 1000)
    ? (creature.stats.slice(0, 6) as number[]).map((score) => Math.round(score))
    : null;
  const hp = text([text(creature.hp, 40), creature.hit_dice ? `(${text(creature.hit_dice, 60) ?? ''})` : null].filter(Boolean).join(' '), SHEET_LIMITS.short);
  const lines: SheetLine[] = [];
  for (const [key, label] of LINES) {
    const value = listText(creature[key]);
    if (value) lines.push({ label, text: value });
  }
  const sections: SheetSection[] = [];
  for (const [key, title] of SECTIONS) {
    const found = items(creature[key]);
    // Fantasy Statblocks keeps the intro to these lists in its own field.
    const intro = text(creature[key.replace(/_actions$/, '_description')], SHEET_LIMITS.desc);
    if (intro && found.length > 0) found.unshift({ name: title, desc: intro });
    if (found.length > 0) sections.push({ title, items: found });
    if (sections.length >= SHEET_LIMITS.sections) break;
  }
  return {
    name,
    subtitle,
    ac: text([text(creature.ac, SHEET_LIMITS.short), creature.ac_class ? `(${text(creature.ac_class, SHEET_LIMITS.short) ?? ''})` : null].filter(Boolean).join(' '), SHEET_LIMITS.short),
    hp,
    speed: text(creature.speed, SHEET_LIMITS.short),
    stats,
    saves: bonuses(creature.saves),
    skills: bonuses(creature.skillsaves ?? creature.skills),
    lines: lines.slice(0, SHEET_LIMITS.lines),
    sections,
  };
}

/** One piece of a trait's text: plain, or a roll that can be clicked (its index among the item's rolls). */
export type TextPart = { text: string } | { text: string; roll: number; formula: string };

/**
 * One dice term of a stat block's text: `2d8`, `d20`, exploding (`1d6!i`, `1d6!3`, `1d6!!`) and keep marks (`4d6kh3`);
 * a single `!` ends a sentence far more often than it explodes a die.
 */
const DIE = String.raw`\d*d\d+(?:!!?(?:\d+|i(?![a-z]))|!!)?(?:k[hl]\d*(?![a-z]))?`;
/** A further signed term: a die or a constant after `+`, `-`, a minus sign or an en dash, or after "+ -" ("3d6 + -1"). */
const NEXT_TERM = String.raw`\s*(?:\+\s*-|[+\-−–])\s*(?:${DIE}|\d+)`;
/**
 * Dice expressions (`2d8+3`, `2d6 - 1d4`) and bare bonuses (`+4`, `−1`, `ATK: +4`). Neither starts inside a word or a
 * number; a bare sign must sit on its digits and not open a dice term, so the dash in "Very Close - 1d12+2" is no roll.
 */
const DICE_PATTERN = new RegExp(String.raw`((?<!\w)${DIE}(?:${NEXT_TERM})*|(?:ATK|Attack)\s*:\s*[+-]\d+|(?<!\w)[+\-−]\d+(?!\s*d\d))`, 'gi');

/** The formula matched text stands for. A bare bonus stays bare: it is added to the collection's default roll. */
export function toRollFormula(text: string): string {
  return text.replace(/\s+/g, '').replace(/^(?:ATK|Attack):/i, '').replace(/[−–]/g, '-').replace(/\+-/g, '-');
}

/** A trait's text cut into plain pieces and the rolls in it, in order. */
export function textParts(desc: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  let index = 0;
  for (const match of desc.matchAll(DICE_PATTERN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: desc.slice(last, at) });
    parts.push({ text: match[0], roll: index, formula: toRollFormula(match[0]) });
    index += 1;
    last = at + match[0].length;
  }
  if (last < desc.length) parts.push({ text: desc.slice(last) });
  return parts;
}

/** The formula a roll on `sheet` stands for; null when the sheet has no such roll. */
export function sheetRollFormula(sheet: PlayerSheet, ref: SheetRollRef): string | null {
  switch (ref.kind) {
    // A bonus alone ("(+3)", "Dex +5"): it is added to the collection's default roll.
    case 'check': {
      const score = sheet.stats?.[ref.index];
      return score === undefined ? null : signed(modifierOf(score));
    }
    case 'save': {
      const bonus = sheet.saves[ref.index];
      return bonus ? signed(bonus.bonus) : null;
    }
    case 'skill': {
      const bonus = sheet.skills[ref.index];
      return bonus ? signed(bonus.bonus) : null;
    }
    case 'text': {
      const item = sheet.sections[ref.section]?.items[ref.item];
      if (!item) return null;
      const part = textParts(item.desc).find((candidate) => 'roll' in candidate && candidate.roll === ref.index);
      // Never a roll other than the one clicked: a sheet that changed finds other text there, and nothing is rolled.
      return part && 'formula' in part && part.text === ref.text ? part.formula : null;
    }
  }
}

/** What a roll is called in the log: "Dagger", "Dexterity save". */
export function sheetRollLabel(sheet: PlayerSheet, ref: SheetRollRef): string {
  switch (ref.kind) {
    case 'check': return `${ABILITY_NAMES[ref.index] ?? 'Check'} check`;
    case 'save': return `${sheet.saves[ref.index]?.label ?? 'Save'} save`;
    case 'skill': return sheet.skills[ref.index]?.label ?? 'Skill';
    case 'text': return sheet.sections[ref.section]?.items[ref.item]?.name || 'Roll';
  }
}

/** The side Shift (advantage) and Alt (disadvantage) ask for; both at once cancel. */
export function advantageSide(shift: boolean, alt: boolean): AdvantageSide | null {
  if (shift === alt) return null;
  return shift ? 'advantage' : 'disadvantage';
}

/** Whether advantage can change a roll: a bare bonus (added to the default roll) or a roll with a d20. */
export function mayHaveAdvantage(formula: string): boolean {
  return /^[+-]\d+$/.test(formula) || /(^|[^\d])\d*d20(?!\d)/i.test(formula);
}
