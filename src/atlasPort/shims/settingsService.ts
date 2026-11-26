// Stand-in for Atlas's services/SettingsService.ts @ 0.15.0 (AGPL-3.0) in the copies: `forApp` hands over Atlas's own running
// settings (its hotkeys and stored settings, followed as they change). Atlas's guided tours are not shown on the board.
import type { App } from 'obsidian';
import { AtlasBridge } from '../../atlasBridge';
import { DEFAULT_MAP_HOTKEYS } from '../app/keyboard/mapHotkeys';

export type TutorialId = string;

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Atlas's `AtlasSettings` (services/SettingsService.ts): only named as a type by the copies (not type-checked). */
export type AtlasSettings = any;

export interface SettingsService {
  getHotkeys(): Record<string, string>;
  getSetting(key: string): any;
  onChange(listener: () => void): () => void;
  isExperimentalOn(feature: string): boolean;
  shouldShowTutorial(id: TutorialId): boolean;
  completeTutorial(id: TutorialId): void;
  /** Whatever else Atlas's running service has: the settings pages (grid, player view, dice, graphics...) call it as it is. */
  [member: string]: any;
}

export const SettingsService = {
  /** Atlas's own running settings service (its pages read and write it, so the map and the board agree). */
  forApp(app: App | undefined): SettingsService | undefined {
    if (!app) return undefined;
    const atlas = new AtlasBridge(app).settings() as Record<string, any> | null;
    const call = (name: string, ...args: unknown[]): any => (typeof atlas?.[name] === 'function' ? atlas[name](...args) : undefined);
    // What the board answers itself: Atlas's keys as the GM set them (Atlas's defaults without Atlas); an empty record for a
    // setting without Atlas, so the copies read every field as unset; no guided tours.
    const own: Record<string, any> = {
      getHotkeys: () => call('getHotkeys') ?? { ...DEFAULT_MAP_HOTKEYS },
      getSetting: (key: string) => call('getSetting', key) ?? {},
      onChange: (listener: () => void) => call('onChange', listener) ?? (() => {}),
      isExperimentalOn: (feature: string) => call('isExperimentalOn', feature) === true,
      shouldShowTutorial: () => false,
      completeTutorial: () => {},
    };
    return new Proxy(own, {
      get(target, key) {
        if (typeof key !== 'string' || key in target) return Reflect.get(target, key);
        const member = atlas?.[key];
        // A member Atlas lacks (no Atlas, an older one) does nothing and answers nothing.
        return typeof member === 'function' ? member.bind(atlas) : atlas ? member : () => undefined;
      },
    }) as SettingsService;
  },
};

/**
 * How the board's player window lays out Atlas's players' initiative list: a row across the top edge, whatever the GM's
 * Horizontal and Mirrored initiative switches say (Atlas follows them in its own player window), read the right way up. The
 * widgets read it too: with a row across the top they stand as a column down the right edge (`PlayerWidgetBar`).
 */
const TOP_ROW_LAYOUT = { fromTurn: true, dock: 'top', edges: ['top'], facesPlayers: false } as const;

export function playerWindowSettings(app: App | undefined): SettingsService | undefined {
  const settings = SettingsService.forApp(app);
  if (!settings) return settings;
  return new Proxy(settings, {
    get(target, key) {
      if (key === 'initiativeLayout') return () => TOP_ROW_LAYOUT;
      return Reflect.get(target, key);
    },
  });
}
