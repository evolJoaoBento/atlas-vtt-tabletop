/**
 * The options menu of the board's initiative tracker: Atlas 0.18's `initiativeTrackerOptions` rows for its two layout and
 * banner switches, the Compact view and the Turn banner, with Atlas's texts and icons. Both are Atlas's own settings
 * (`SettingsService`, kept in its data.json), so the board and Atlas's map agree on them; a row is left out where the Atlas
 * in use lacks its setting (0.15 floor), and with no row the tracker has no options button.
 */
import { at } from '../atlasPort/atlasText';
import type { MenuEntry } from './atlasMenu';
import { turnBannerEnabled } from './turnBanner';

/** The members of Atlas's settings service the options use; each may be missing from an older Atlas. */
export interface TrackerSettings {
  showsCompactInitiative?(): boolean;
  setCompactInitiative?(on: boolean): void;
  initiativeTurnOptions?(): { banner?: boolean; movesOnTurn?: boolean };
  setInitiativeTurnOptions?(changes: { banner?: boolean }): void;
}

/** Whether Atlas's switch makes the GM's tracker the compact list: off unless Atlas says so. */
export function trackerCompact(settings: TrackerSettings | null): boolean {
  try {
    return settings?.showsCompactInitiative?.() === true;
  } catch {
    return false;
  }
}

/** The rows of the options menu the Atlas in use can carry out; none when it has neither switch. */
export function trackerOptionEntries(settings: TrackerSettings | null): MenuEntry[] {
  if (!settings) return [];
  const entries: MenuEntry[] = [];
  if (typeof settings.showsCompactInitiative === 'function' && typeof settings.setCompactInitiative === 'function') {
    entries.push({
      type: 'item', label: at('initiative.compact'), icon: 'list', checked: trackerCompact(settings), description: at('initiative.compactHint'),
      onClick: () => settings.setCompactInitiative!(!trackerCompact(settings)),
    });
  }
  if (typeof settings.initiativeTurnOptions === 'function' && typeof settings.setInitiativeTurnOptions === 'function') {
    entries.push({
      type: 'item', label: at('initiative.turnBanner'), icon: 'flag', checked: turnBannerEnabled(settings), description: at('initiative.turnBannerHint'),
      onClick: () => settings.setInitiativeTurnOptions!({ banner: !turnBannerEnabled(settings) }),
    });
  }
  return entries;
}
