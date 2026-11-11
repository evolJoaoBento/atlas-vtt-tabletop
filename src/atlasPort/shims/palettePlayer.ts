// Stand-in for Atlas's services/PlayerWindowService.ts, services/PlayerWindowPresenter.ts and stores/playerWindowStore.ts
// @ 0.12.0 (AGPL-3.0) in the copied command palette: the players' window on the board is the board's own player view
// (src/palette/paletteHost.ts); presenting a scene to players goes through Atlas.
import { onPaletteChange, paletteHost } from '../../palette/paletteHost';

export const PlayerWindowService = {
  getInstance: () => ({
    isWindowOpen: (): boolean => paletteHost()?.playerViewOpen() ?? false,
    toggleCameraFreeze: (): void => paletteHost()?.togglePlayerFreeze(),
  }),
};

export async function openPlayerWindow(_app: unknown): Promise<void> {
  const host = paletteHost();
  if (host && !host.playerViewOpen()) host.togglePlayerView();
}

export async function presentActiveTab(_app: unknown, _options?: unknown): Promise<void> {
  paletteHost()?.presentInAtlas();
}

/** The players' window state as the palette reads it (zustand's `useStore` takes any such store). */
const state = () => ({ isFrozen: paletteHost()?.playerFrozen() ?? false, shownTabId: null });
let snapshot = state();
export const playerWindowStore = {
  getState: () => snapshot,
  getInitialState: () => snapshot,
  subscribe: (listener: () => void): (() => void) => onPaletteChange(() => {
    const next = state();
    if (next.isFrozen === snapshot.isFrozen) return;
    snapshot = next;
    listener();
  }),
};
