/**
 * The random tables' roll history on the board: Atlas's own history store (copied), writing this device's Tabletop file
 * (`loot-history/<Atlas device id>-tabletop.json`) and reading every device's, Atlas's included. Atlas reads every file
 * in that folder too, so a roll made on the board shows in Atlas's history and the other way round, and neither ever
 * writes the other's file.
 */
import type { App } from 'obsidian';
import { LootHistoryStore } from '../atlasPort/app/loot/LootHistoryStore';

export type BoardLootHistory = LootHistoryStore;

/** The board's history store for this vault (one per app, as Atlas's). */
export function boardLootHistory(app: App): BoardLootHistory {
  return LootHistoryStore.forApp(app);
}

/** Writes pending changes and stops following the vault (when Tabletop unloads). */
export function releaseBoardLootHistory(app: App): void {
  LootHistoryStore.release(app);
}
