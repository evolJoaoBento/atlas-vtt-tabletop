// Stand-in for Atlas's services/SettingsService.ts @ 0.12.0 (AGPL-3.0) in the copies: `forApp` hands over Atlas's own running
// settings (its hotkeys and stored settings, followed as they change). Atlas's guided tours are not shown on the board.
import type { App } from 'obsidian';
import { AtlasBridge } from '../../atlasBridge';
import { DEFAULT_MAP_HOTKEYS } from '../app/keyboard/mapHotkeys';

export type TutorialId = string;

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface SettingsService {
  getHotkeys(): Record<string, string>;
  getSetting(key: string): any;
  onChange(listener: () => void): () => void;
  shouldShowTutorial(id: TutorialId): boolean;
  completeTutorial(id: TutorialId): void;
}

export const SettingsService = {
  forApp(app: App | undefined): SettingsService | undefined {
    if (!app) return undefined;
    const atlas = new AtlasBridge(app).settings() as Record<string, any> | null;
    const call = (name: string, ...args: unknown[]): any => (typeof atlas?.[name] === 'function' ? atlas[name](...args) : undefined);
    return {
      // Atlas's keys as the GM set them; Atlas's defaults without Atlas.
      getHotkeys: () => call('getHotkeys') ?? { ...DEFAULT_MAP_HOTKEYS },
      // An Atlas setting as Atlas stores it; an empty record without Atlas, so the copies read every field as unset.
      getSetting: (key) => call('getSetting', key) ?? {},
      onChange: (listener) => call('onChange', listener) ?? (() => {}),
      shouldShowTutorial: () => false,
      completeTutorial: () => {},
    };
  },
};
