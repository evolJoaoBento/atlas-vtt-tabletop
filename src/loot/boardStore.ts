/**
 * The board's stand-in for the part of an Atlas map view's store the copied random tables window reads: the map's path and
 * its loot roller slice, with Atlas's own actions (`createLootRollerActions`, copied). Changes are made the way Atlas's
 * immer store makes them (a recipe on a draft) and every subscriber is told. `onChange` lets the board save what the GM
 * chose into the map file's `lootRoller` block.
 */
import { createInitialLootRollerState, createLootRollerActions, type LootRollerSlice, type LootRollerState } from '../atlasPort/app/stores/lootRollerSlice';

export interface BoardState extends LootRollerSlice {
  mapPath: string | null;
  /** Atlas's token ring colour, set from its token menu; the random tables never call it. */
  setTokenRing(tokenId: string, color: string | null): void;
}

export interface BoardStore {
  getState(): BoardState;
  subscribe(listener: () => void): () => void;
  /** Shows another map's loot roller state (read from its file). */
  load(mapPath: string | null, lootRoller: LootRollerState): void;
}

export function createBoardStore(onChange: (before: LootRollerState, after: LootRollerState) => void = () => {}): BoardStore {
  const listeners = new Set<() => void>();
  let state: BoardState;
  const publish = (next: BoardState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  // Atlas's actions take an immer `set`: a recipe that changes a draft. The draft here is a copy of the slice.
  const set = (recipe: (draft: { lootRoller: LootRollerState }) => void): void => {
    const before = state.lootRoller;
    const draft = { lootRoller: structuredClone(before) };
    recipe(draft);
    publish({ ...state, lootRoller: draft.lootRoller });
    onChange(before, draft.lootRoller);
  };
  state = {
    mapPath: null,
    lootRoller: createInitialLootRollerState(),
    ...createLootRollerActions(set as never),
    setTokenRing: () => {},
  };
  return {
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    load: (mapPath, lootRoller) => publish({ ...state, mapPath, lootRoller }),
  };
}
