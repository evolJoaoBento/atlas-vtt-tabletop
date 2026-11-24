// Stand-in for what Atlas 0.19's settings pages (command-palette/*Panel.tsx, copied) take from files that build Atlas's own
// map: `storeFactory.ts` (the map view's store, which the pages reach through the running Atlas's map view instead) and
// `dice3d/diceLookRuntime.ts` (Atlas's dice renderer, which draws the colour strip's d20s; the board's dice are its own, so the
// strip shows Atlas's empty wells).
import type { DiceColour, DiceFont } from '../app/dice3d/diceLook';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Atlas's `ViewAtlasState` / `ViewAtlasStore`: only named as types by the copies (the copies are not type-checked). */
export type ViewAtlasState = any;
export type ViewAtlasStore = any;

/** Atlas's `DEFAULT_TOKEN_SETTINGS` (storeFactory.ts @ 0.19.0): what the token settings page shows for a map that sets none. */
export const DEFAULT_TOKEN_SETTINGS: Readonly<Record<string, unknown>> = {
  showNameplates: false,
  hiddenResources: [],
  showInstanceBadges: true,
  tokenRingSize: 1,
};

export async function renderDicePreviews(_font: DiceFont): Promise<Partial<Record<DiceColour, string>>> {
  return {};
}
