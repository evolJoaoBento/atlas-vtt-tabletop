// Stand-in for Atlas's initiative/offMapCombatants.ts @ 0.12.0 (AGPL-3.0) in the copies: the spawn code's "fight" and
// "beside the map" go into the board's initiative tracker (src/assets/boardTarget.ts), through Atlas's store when it holds
// the map, else the file. Combatants beside the map stand in a column left of it, as Atlas lays them out.
import { spawnBoard } from '../../assets/boardTarget';

/* eslint-disable @typescript-eslint/no-explicit-any */
type CombatStore = { getState(): any };

export function joinInitiative(_store: CombatStore, ids: readonly string[]): void {
  void spawnBoard()?.joinInitiative(ids).catch((error: unknown) => console.error('Tabletop: could not add to initiative', error));
}

export function addOffMapCombatants(store: CombatStore, inputs: readonly Record<string, unknown>[]): string[] {
  const { grid, addTokens } = store.getState();
  const cell = grid?.size ?? 70;
  const ids: string[] = addTokens(inputs.map((input, index) => ({ ...input, x: -cell, y: cell / 2 + index * cell, offMap: true })));
  joinInitiative(store, ids);
  return ids;
}
