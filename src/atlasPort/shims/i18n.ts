// Stand-in for Atlas's i18n (src/app/i18n/index.ts and types.ts) in the copies under src/atlasPort/app: `t` speaks through
// Tabletop's copy of Atlas's texts (`at`), which `npm run sync:atlas` fills with exactly the keys the copies use.
import { at, atlasLocale, type AtlasMessage, type MessageValues as AtlasMessageValues } from '../atlasText';
import type { AtlasTextKey } from '../atlasTextKeys';

export type Message = AtlasMessage;
export type MessageKey = string;
export type MessageValues = AtlasMessageValues;
export type Translation = Partial<Record<MessageKey, Message>>;

export function t(key: MessageKey, values?: MessageValues): string {
  return at(key as AtlasTextKey, values);
}

/** The active language code, for `Intl` formatters that should match Atlas' texts. */
export function getLocale(): string {
  return atlasLocale();
}

/** Joins `items` as the active language does: "a, b and c". */
export function formatList(items: readonly string[]): string {
  return new Intl.ListFormat(atlasLocale(), { type: 'conjunction' }).format(items);
}

/** Atlas's text for the pointer in use (`<key>.touch` for a finger): the board is played with a mouse. */
export function tPointer(key: MessageKey, values?: MessageValues): string {
  return t(key, values);
}

/** Atlas's text for the app it runs in (`<key>.mobile` in Obsidian mobile): the board is desktop's. */
export function tPlatform(key: MessageKey, values?: MessageValues): string {
  return t(key, values);
}
