// Atlas source: src/app/react/hooks/useShareRolls.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useAtlasStore } from '../../../shims/viewStore';
import { useAtlasUI } from '../../../shims/atlasUI';
import { SettingsService } from '../../../shims/settingsService';
import { useShowDiceRolls } from './useShowDiceRolls';
import type { ShareRolls } from '../../../shims/atlasTypes';

export type { ShareRolls };

/**
 * The GM's "Show my rolls to players" switch: the player view setting `showDiceRolls`, read
 * and written in place, so every control showing it follows the others. Null in a player
 * view, where nobody else watches the rolls.
 */
export function useShareRolls(): ShareRolls | null {
  const { app, view } = useAtlasUI();
  const isPlayerView = useAtlasStore((state) => state.isPlayerView) || view?.getViewType?.() === 'atlas-vtt-player';
  const shown = useShowDiceRolls(app ?? undefined);
  const settings = SettingsService.forApp(app ?? undefined);
  if (isPlayerView || !settings) return null;
  return { shown, onToggle: () => settings.setLocalPlayerViewSettings({ showDiceRolls: !shown }) };
}
