// Atlas source: src/app/react/hooks/useShowDiceRolls.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect, useState } from 'react';
import type { App } from 'obsidian';
import { SettingsService } from '../../../shims/settingsService';

/** Whether players see the DM's dice rolls ("Show dice rolls"), kept current as the setting changes. */
export function useShowDiceRolls(app: App | undefined): boolean {
  const settings = SettingsService.forApp(app);
  const [show, setShow] = useState(() => settings?.getLocalPlayerViewSettings().showDiceRolls ?? false);

  useEffect(() => {
    if (!settings) return;
    setShow(settings.getLocalPlayerViewSettings().showDiceRolls);
    return settings.onChange(() => setShow(settings.getLocalPlayerViewSettings().showDiceRolls));
  }, [settings]);

  return show;
}
