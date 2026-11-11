/**
 * Tabletop's own words in Obsidian's language (Atlas follows Obsidian's language, so Tabletop's panels do too). English
 * is the base: a string without a translation shows in English. `t(key, { n: 3 })` fills `{n}` in the text. Pure.
 *
 * To add a language (only once Atlas has it): add its table to `TABLES` under its two-letter code, with the keys it translates
 * (the test checks every key exists in English and keeps its `{placeholders}`).
 */
import { setAtlasLanguage } from './atlasPort/atlasText';

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
  'atlasTools.needsAtlas': 'needs Atlas',
  'parity.newerAtlas': "Atlas {installed} is newer than the version these tools were checked against ({checked}): some of Atlas's newest tools may be missing on the board.",
} as const;

export type StringKey = keyof typeof EN;

/**
 * The translations of Tabletop's own words by language code; English is the base and needs none. Empty for now. Atlas
 * 0.12.0 speaks Russian and Chinese too: the copies of Atlas's panels take Atlas's own texts in those languages (`at`, in
 * src/atlasPort/atlasText.ts), and a table here for `ru` or `zh` would translate the rest of the board.
 */
export const TABLES: Record<string, Partial<Record<StringKey, string>>> = {};

export const ENGLISH: Readonly<Record<StringKey, string>> = EN;

/** The table a language code names: `pt-BR` and `pt_PT` are `pt`; a language without one is English. */
export function languageOf(code: string | null | undefined): string {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0] ?? '';
  return base in TABLES ? base : 'en';
}

let current = 'en';

/**
 * Sets the language the next `t` speaks (Obsidian's, read once when the plugin loads), and the language of Atlas's own texts
 * in the board's copies of Atlas's panels (`at`), which Atlas has in more languages than Tabletop's table.
 */
export function setLanguage(code: string | null | undefined): void {
  current = languageOf(code);
  setAtlasLanguage(code);
}

export function language(): string {
  return current;
}

/** The string for `key` in the current language, `{name}` filled from `values`. */
export function t(key: StringKey, values: Readonly<Record<string, string | number>> = {}): string {
  const text = TABLES[current]?.[key] ?? EN[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
