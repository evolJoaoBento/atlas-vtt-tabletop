// Atlas source: i18n/index.ts @ 0.12.0 (AGPL-3.0, ported for Tabletop).
// Atlas's texts for the board's copies of Atlas's panels, in Atlas's languages, chosen and filled the way Atlas does. The
// texts themselves are copied by `npm run sync:atlas` (atlasTextData.ts); the language follows Tabletop's (`setLanguage`).
import { ATLAS_TEXT_DATA } from './atlasTextData';
import type { AtlasTextKey } from './atlasTextKeys';

/** A text whose wording depends on `count`, one form per plural category of the language (`Intl.PluralRules`). */
export type PluralMessage = { readonly other: string } & Partial<Record<Exclude<Intl.LDMLPluralRule, 'other'>, string>>;
/** A UI text; `{name}` marks a value filled in by `at`. */
export type AtlasMessage = string | PluralMessage;
export type MessageValues = Readonly<Record<string, string | number>>;

export const ATLAS_TEXT = ATLAS_TEXT_DATA as Readonly<Record<string, Readonly<Partial<Record<AtlasTextKey, AtlasMessage>>>>>;
export const ATLAS_LANGUAGES = Object.keys(ATLAS_TEXT);

const DEFAULT_LOCALE = 'en';
const DEFAULT_PLURAL_RULES = new Intl.PluralRules(DEFAULT_LOCALE);

let locale = DEFAULT_LOCALE;
let pluralRules = DEFAULT_PLURAL_RULES;

/** Picks Atlas's language for `language`: the exact code, else its base language (`pt` for `pt-BR`), else English. */
export function resolveLocale(language: string): string {
  const code = Object.keys(ATLAS_TEXT).find((key) => key.toLowerCase() === language.toLowerCase());
  if (code) return code;
  const base = language.split(/[-_]/)[0]?.toLowerCase() ?? '';
  return base in ATLAS_TEXT ? base : DEFAULT_LOCALE;
}

/** The active language code of Atlas's texts. */
export function atlasLocale(): string {
  return locale;
}

/** Sets the language of every later `at` call (called by Tabletop's `setLanguage`). */
export function setAtlasLanguage(language: string | null | undefined): void {
  locale = resolveLocale(language ?? DEFAULT_LOCALE);
  pluralRules = new Intl.PluralRules(locale);
}

/**
 * Renders `message` in the language of `rules`: a `count` value picks the plural form,
 * and `{name}` placeholders take `values.name` (numbers formatted for that language).
 */
export function formatMessage(message: AtlasMessage, rules: Intl.PluralRules, values?: MessageValues): string {
  const count = values?.count;
  let text: string;
  if (typeof message === 'string') text = message;
  else text = (typeof count === 'number' ? message[rules.select(count)] : undefined) ?? message.other;
  if (!values) return text;
  const numberLocale = rules.resolvedOptions().locale;
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' ? value.toLocaleString(numberLocale) : value;
  });
}

/** Atlas's text for `key` in the active language, falling back to English (and to the key, for one never synced). */
export function at(key: AtlasTextKey, values?: MessageValues): string {
  const own = ATLAS_TEXT[locale]?.[key];
  if (own !== undefined) return formatMessage(own, pluralRules, values);
  const english = ATLAS_TEXT[DEFAULT_LOCALE]?.[key];
  return english === undefined ? key : formatMessage(english, DEFAULT_PLURAL_RULES, values);
}
