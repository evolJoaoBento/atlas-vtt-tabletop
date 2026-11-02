/**
 * Tabletop's own words in Obsidian's language (Atlas follows Obsidian's language, so Tabletop's panels do too). English
 * is the base: a string without a translation shows in English. `t(key, { n: 3 })` fills `{n}` in the text. Pure.
 *
 * To add a language (only once Atlas has it): add its table to `TABLES` under its two-letter code, with the keys it translates
 * (the test checks every key exists in English and keeps its `{placeholders}`).
 */

const EN = {
  'lighting.title': 'Lighting: {mode}',
  'lighting.classic': 'Classic',
  'lighting.dusk': 'Painted: dusk',
  'lighting.day': 'Painted: day',
  'lighting.night': 'Painted: night',
  'lighting.ambient': 'Ambient light',
  'lighting.tint': 'Tint',
  'lighting.tintReset': 'Reset',
  'lighting.tintHint': "Colours the board's daylight (a warm gold, a cold blue). Atlas's lights keep their own colours. Reset takes it off.",
  'lighting.ambientHint': "Lower it and the map goes dark: Atlas's lights shine in it. Right-click a light's bulb to set how high it hangs.",
  'lighting.tilt': 'Miniature look',
  'lighting.tiltHint': 'Blurs the board towards its top and bottom edges and keeps a band across the middle sharp, so the table looks like a model (tilt-shift). Costs some frame rate.',
  'lighting.occlusion': 'Contact shadows',
  'lighting.occlusionHint': 'Darkens the creases where walls, minis and props meet the floor (ambient occlusion). Costs some frame rate.',
  'toolbar.more': 'More tools',
  'dice.heading': 'Dice',
  'dice.autoRoll': 'Throw stat sheet rolls automatically',
  'dice.autoRollHint': 'Ticked, a roll from a stat sheet is thrown at once. Unticked, its dice are laid on the table and you throw them by hand.',
  'group.selected': '{n} selected',
  'group.rotateLeft': 'Rotate left {deg}°',
  'group.rotateRight': 'Rotate right {deg}°',
  'group.damage': 'Damage all',
  'group.heal': 'Heal all',
  'group.amount': 'HP amount',
  'group.clear': 'Clear selection',
  'turn.banner': 'Round {round} · {names}',
  'open3d': 'Open in 3D',
} as const;

export type StringKey = keyof typeof EN;

/**
 * The translations by language code; English is the base and needs none. Empty on purpose: Atlas ships no translations,
 * so Tabletop matches it and stays English until Atlas offers a language.
 */
export const TABLES: Record<string, Partial<Record<StringKey, string>>> = {};

export const ENGLISH: Readonly<Record<StringKey, string>> = EN;

/** The table a language code names: `pt-BR` and `pt_PT` are `pt`; a language without one is English. */
export function languageOf(code: string | null | undefined): string {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return base in TABLES ? base : 'en';
}

let current = 'en';

/** Sets the language the next `t` speaks (Obsidian's, read once when the plugin loads). */
export function setLanguage(code: string | null | undefined): void {
  current = languageOf(code);
}

export function language(): string {
  return current;
}

/** The string for `key` in the current language, `{name}` filled from `values`. */
export function t(key: StringKey, values: Readonly<Record<string, string | number>> = {}): string {
  const text = TABLES[current]?.[key] ?? EN[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
