// Atlas source: src/app/react/hooks/useDiceDisplay.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect, useState } from 'react';
import type { App } from 'obsidian';
import type { DiceDisplay } from '../../dice3d/diceDisplay';
import { SettingsService } from '../../../shims/settingsService';

/** How rolls are shown, kept current as the setting changes. */
export function useDiceDisplay(app: App | undefined): DiceDisplay {
  const settings = SettingsService.forApp(app);
  const [display, setDisplay] = useState<DiceDisplay>(() => settings?.getDiceDisplay() ?? 'full');

  useEffect(() => {
    if (!settings) return;
    setDisplay(settings.getDiceDisplay());
    return settings.onChange(() => setDisplay(settings.getDiceDisplay()));
  }, [settings]);

  return display;
}

/** How loud dice sound, 0 (silent) to 1, kept current as the setting changes. */
export function useDiceVolume(app: App | undefined): number {
  const settings = SettingsService.forApp(app);
  const [volume, setVolume] = useState(() => settings?.getDiceVolume() ?? 1);

  useEffect(() => {
    if (!settings) return;
    setVolume(settings.getDiceVolume());
    return settings.onChange(() => setVolume(settings.getDiceVolume()));
  }, [settings]);

  return volume;
}
