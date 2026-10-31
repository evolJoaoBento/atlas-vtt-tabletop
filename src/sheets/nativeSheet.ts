/**
 * A stat sheet for a note written with Atlas's own statblock templates (0.8+): the note's frontmatter holds the template
 * id (`atlas-template`) and one value per template field. The 5E templates use Fantasy Statblocks' keys, which
 * `buildSheet` already reads; every other template (Cairn, Draw Steel, Fate, B/X, percentile, generic, a custom one)
 * keeps the fields below, which this adds to the sheet as lines and sections. Pure; field keys and labels are the ones
 * Atlas's built-in templates carry (0.10.2, `atlas-vtt/main.js`).
 */
import { buildSheet, SHEET_LIMITS, text, type PlayerSheet, type SheetItem, type SheetLine, type SheetSection } from './sheet';

/** The note key holding the template's id. */
export const NATIVE_TEMPLATE_KEY = 'atlas-template';

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a template adds beyond the 5E keys, in the template's order. `scores`: a table of named slots. */
interface NativeLayout {
  lines?: ReadonlyArray<readonly [key: string, label: string]>;
  scores?: ReadonlyArray<readonly [key: string, label: string, slots: readonly string[]]>;
  pairs?: ReadonlyArray<readonly [key: string, label: string]>;
  sections?: ReadonlyArray<readonly [key: string, title: string]>;
}

const LAYOUTS: Readonly<Record<string, NativeLayout>> = {
  'builtin:5e-2014-monster': {},
  'builtin:5e-2024-monster': { lines: [['initiative', 'Initiative'], ['gear', 'Gear']] },
  'builtin:d20-creature': { lines: [['level', 'Level'], ['initiative', 'Initiative'], ['bonus', 'Bonus'], ['damage', 'Damage']], sections: [['attacks', 'Attacks']] },
  'builtin:bx-creature': {
    lines: [['ac', 'Armor class'], ['hit_dice', 'Hit dice'], ['movement', 'Movement'], ['attacks', 'Attacks'], ['saves', 'Saves'], ['morale', 'Morale'],
      ['xp', 'XP'], ['number_appearing', 'Number appearing'], ['treasure', 'Treasure']],
    sections: [['traits', 'Special abilities']],
  },
  'builtin:cairn-creature': {
    lines: [['armor', 'Armor'], ['attacks', 'Attacks'], ['critical_damage', 'Critical damage']],
    scores: [['stats', 'Attributes', ['STR', 'DEX', 'WIL']]],
    sections: [['abilities', 'Abilities']],
  },
  'builtin:draw-steel-monster': {
    lines: [['level', 'Level'], ['organization', 'Organization'], ['role', 'Role'], ['keywords', 'Keywords'], ['ev', 'EV'], ['stamina', 'Stamina'],
      ['stability', 'Stability'], ['free_strike', 'Free strike'], ['immunities', 'Immunity'], ['weaknesses', 'Weakness'], ['with_captain', 'With captain']],
    scores: [['characteristics', 'Characteristics', ['Might', 'Agility', 'Reason', 'Intuition', 'Presence']]],
    sections: [['traits', 'Traits'], ['abilities', 'Abilities'], ['villain_actions', 'Villain actions']],
  },
  'builtin:fate-npc': {
    lines: [['aspects', 'Aspects']],
    scores: [['stress', 'Stress', ['Physical', 'Mental']]],
    sections: [['consequences', 'Consequences'], ['skills', 'Skills'], ['stunts', 'Stunts'], ['items', 'Items'], ['extras', 'Extras']],
  },
  'builtin:percentile-creature': {
    lines: [['mp', 'MP'], ['move', 'Move'], ['build', 'Build'], ['damage_bonus', 'Damage bonus'], ['armor', 'Armor'], ['chance', 'Chance'], ['damage', 'Damage'], ['sanity_loss', 'Sanity loss']],
    scores: [['stats', 'Characteristics', ['STR', 'CON', 'SIZ', 'DEX', 'APP', 'INT', 'POW', 'EDU']]],
    pairs: [['skills', 'Skills']],
    sections: [['attacks', 'Attacks'], ['traits', 'Traits']],
  },
  'builtin:generic-creature': { lines: [['level', 'Level']], sections: [['traits', 'Traits'], ['actions', 'Actions']] },
  'builtin:generic-npc': {
    lines: [['appearance', 'Appearance'], ['personality', 'Personality'], ['wants', 'Wants'], ['level', 'Level']],
    sections: [['traits', 'Traits'], ['actions', 'Actions']],
  },
  'builtin:generic-hazard': { lines: [['level', 'Level'], ['difficulty', 'Difficulty'], ['trigger', 'Trigger'], ['countermeasures', 'Countermeasures']], sections: [['effects', 'Effects']] },
  'builtin:narrative-npc': { lines: [['concept', 'Concept'], ['drive', 'Drive'], ['trouble', 'Trouble'], ['appearance', 'Appearance'], ['notes', 'Notes']], sections: [['relationships', 'Relationships']] },
};

/** Keys `buildSheet` reads, or that are no content: never repeated by the generic reading of a custom template. */
const HANDLED = new Set([
  'name', 'image', 'token', 'statblock', NATIVE_TEMPLATE_KEY, 'size', 'type', 'subtype', 'alignment', 'hp', 'hit_dice', 'ac', 'ac_class', 'speed',
  'stats', 'saves', 'skillsaves', 'skills', 'damage_vulnerabilities', 'damage_resistances', 'damage_immunities', 'condition_immunities', 'senses',
  'languages', 'cr', 'traits', 'spells', 'actions', 'bonus_actions', 'reactions', 'legendary_actions', 'mythic_actions', 'lair_actions',
  'legendary_description', 'mythic_description', 'lair_description', 'description', 'layout', 'tags', 'aliases', 'cssclasses', 'position',
]);

/** "damage_bonus" as "Damage bonus". */
function labelOf(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** A value as one line: text, a number, or a list of those. Null for anything else (nothing is guessed). */
function lineText(value: unknown): string | null {
  if (Array.isArray(value)) {
    const words = value.map((item): unknown => (isObject(item) ? item.name : item))
      .filter((item): item is string | number => typeof item === 'string' || typeof item === 'number');
    return words.length > 0 ? text(words.join(', '), SHEET_LIMITS.line) : null;
  }
  return text(value, SHEET_LIMITS.line);
}

/** The items of a list field: `{ name, desc }`, `[name, desc]` or plain text. */
function entryItems(value: unknown): SheetItem[] {
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

/** A table of named slots as one line: `STR 10, DEX 12`; slot values as a list, or an object by slot name. */
function scoresText(value: unknown, slots: readonly string[]): string | null {
  const parts: string[] = [];
  if (Array.isArray(value)) {
    value.slice(0, slots.length).forEach((score: unknown, index) => {
      const shown = text(score, 20);
      if (shown !== null) parts.push(`${slots[index] ?? index + 1} ${shown}`);
    });
  } else if (isObject(value)) {
    for (const [slot, score] of Object.entries(value).slice(0, slots.length)) {
      const shown = text(score, 20);
      if (shown !== null) parts.push(`${labelOf(slot)} ${shown}`);
    }
  }
  return parts.length > 0 ? text(parts.join(', '), SHEET_LIMITS.line) : null;
}

/** A pairs field (`[{ Stealth: 5 }]`, `{ Stealth: 5 }`, `[{ name, value }]`) as one line: `Stealth 5, Notice 2`. */
function pairsText(value: unknown): string | null {
  const entries: Array<[unknown, unknown]> = [];
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) {
      if (!isObject(item)) continue;
      if ('name' in item || 'key' in item) entries.push([item.name ?? item.key, item.value ?? item.desc ?? item.bonus]);
      else entries.push(...Object.entries(item));
    }
  } else if (isObject(value)) entries.push(...Object.entries(value));
  const parts = entries.slice(0, SHEET_LIMITS.bonuses).flatMap(([label, raw]) => {
    const name = text(label, 40);
    const shown = text(raw, 40);
    return name && shown ? [`${name.charAt(0).toUpperCase()}${name.slice(1)} ${shown}`] : [];
  });
  return parts.length > 0 ? text(parts.join(', '), SHEET_LIMITS.line) : null;
}

/** A custom template's fields (one this file has no layout for) read by what their values are. */
function genericLayout(creature: Rec): NativeLayout {
  const lines: Array<[string, string]> = [];
  const sections: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(creature)) {
    if (HANDLED.has(key)) continue;
    const isEntries = Array.isArray(value) && (value as unknown[]).some((item) => Array.isArray(item) || (isObject(item) && ('name' in item || 'desc' in item)));
    if (isEntries) sections.push([key, labelOf(key)]);
    else if (lineText(value) !== null) lines.push([key, labelOf(key)]);
  }
  return { lines, sections };
}

/**
 * `sheet` with the fields of the creature's Atlas template added. A creature without a template id is returned as is;
 * a template whose `stats` are not the six 5E abilities takes them off the sheet's ability row (they would roll as
 * Strength to Charisma) and shows them as a line instead.
 */
export function withNativeFields(sheet: PlayerSheet, creature: unknown): PlayerSheet {
  if (!isObject(creature)) return sheet;
  const id = text(creature[NATIVE_TEMPLATE_KEY], 120);
  if (id === null) return sheet;
  const layout = LAYOUTS[id] ?? genericLayout(creature);
  const ownStats = (layout.scores ?? []).some(([key]) => key === 'stats');
  const lines: SheetLine[] = [...sheet.lines];
  const sections: SheetSection[] = [...sheet.sections];
  const room = (): boolean => lines.length < SHEET_LIMITS.lines;
  for (const [key, label] of layout.lines ?? []) {
    const shown = lineText(creature[key]);
    if (shown !== null && room() && !(key === 'ac' && sheet.ac !== null)) lines.push({ label, text: shown });
  }
  for (const [key, label, slots] of layout.scores ?? []) {
    const shown = scoresText(creature[key], slots);
    if (shown !== null && room()) lines.push({ label, text: shown });
  }
  for (const [key, label] of layout.pairs ?? []) {
    const shown = pairsText(creature[key]);
    if (shown !== null && room()) lines.push({ label, text: shown });
  }
  for (const [key, title] of layout.sections ?? []) {
    const found = entryItems(creature[key]);
    if (found.length > 0 && sections.length < SHEET_LIMITS.sections) sections.push({ title, items: found });
  }
  return { ...sheet, stats: ownStats ? null : sheet.stats, saves: ownStats ? [] : sheet.saves, skills: ownStats ? [] : sheet.skills, lines, sections };
}

/** `buildSheet` for a creature that may come from an Atlas template. */
export function buildAtlasSheet(creature: unknown, fallbackName: string | null = null): PlayerSheet | null {
  const sheet = buildSheet(creature, fallbackName);
  return sheet && withNativeFields(sheet, creature);
}
