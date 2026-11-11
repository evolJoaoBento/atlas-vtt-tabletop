// Stand-in for Atlas's react/ViewStoreContext.tsx @ 0.12.0 (AGPL-3.0) in the copies: the same hooks, over the board's own
// small store (src/loot/boardStore.ts) instead of an Atlas map view's.
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { BoardStore, BoardState } from '../../loot/boardStore';

const ViewStoreContext = createContext<BoardStore | null>(null);

export function ViewStoreProvider({ store, children }: { store: BoardStore; children: ReactNode }) {
  return createElement(ViewStoreContext.Provider, { value: store }, children);
}

/** The board's store instance, for imperative `getState()` / `subscribe()` access. */
export const useViewStoreHook = (): BoardStore => {
  const store = useContext(ViewStoreContext);
  if (!store) throw new Error('useViewStoreHook must be used within a ViewStoreProvider');
  return store;
};

/** Subscribes the component to a slice of the board's store. */
export const useAtlasStore = <T,>(selector: (state: BoardState) => T): T => {
  const store = useContext(ViewStoreContext);
  if (!store) throw new Error('useAtlasStore must be used within a ViewStoreProvider');
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
};

export const useViewStore = useAtlasStore;

const subscribeToNothing = (): (() => void) => () => {};

export const useOptionalAtlasStore = <T,>(selector: (state: BoardState) => T, fallback: T): T => {
  const store = useContext(ViewStoreContext);
  return useSyncExternalStore(store ? store.subscribe : subscribeToNothing, () => (store ? selector(store.getState()) : fallback));
};
