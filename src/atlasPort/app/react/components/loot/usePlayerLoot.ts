// Atlas source: src/app/react/components/loot/usePlayerLoot.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect, useState } from 'react';
import { PlayerLootDisplay } from '../../../../shims/playerWindow';

/** Ids of the loot the players see in their loot window, kept up to date. */
export function usePlayerLootIds(): ReadonlySet<string> {
  const [shown, setShown] = useState(() => PlayerLootDisplay.get().shownIds());
  useEffect(() => PlayerLootDisplay.get().subscribe(setShown), []);
  return shown;
}
