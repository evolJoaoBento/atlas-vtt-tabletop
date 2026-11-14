/**
 * What a board says about Atlas's hold on its map. Atlas keeps one map loaded at a time and every edit of Atlas's
 * records goes through it, so a board whose map Atlas does not hold only shows the map: the bar says why, and offers
 * the one thing that changes it. Pure.
 */
import type { HostStatus } from '../../packages/atlas-host/src/index';
import { NO_ATLAS_TEXT } from '../atlasFloorGate';

export interface HostBarInput {
  /** The board's map. */
  mapPath: string;
  status: HostStatus;
  /** The user closed Atlas's tab while this board needed it. */
  closedByUser: boolean;
  /** How the last try to make Atlas hold this map ended, when it failed. */
  failed: 'timeout' | 'no-atlas' | null;
  /** A map's name as the bar writes it. */
  nameOf(path: string): string;
}

export type HostBarAction = 'edit-here' | 'reopen' | 'retry';
export type HostBar = { text: string; action: HostBarAction | null } | null;

export const HOST_BAR_LABELS: Record<HostBarAction, string> = { 'edit-here': 'Edit here', reopen: 'Reopen', retry: 'Try again' };
export const CLOSED_TEXT = 'Atlas closed this map. Editing is paused.';
export const TIMEOUT_TEXT = 'Atlas did not open this map. View only.';
/** What a refused edit says, in the bar's own words. */
export const viewOnlyText = (held: string): string => `View only. Atlas holds ${held}.`;

/** What a player is told when their move was refused because the GM's Atlas holds another map just now (Connect's reason `not-held`). */
export const PLAYER_NOT_HELD_TEXT = "The GM's Atlas is on another map; try again in a moment.";
/** A spell or a template refused because the player, or the scene, has as many as it may (Connect's words on its 2D page). */
export const PLAYER_LIMIT_TEXT = 'No more spells or templates here: remove one first.';
/** A spell or a template refused because the map's level holds as many areas as Atlas keeps. */
export const PLAYER_FULL_TEXT = 'This map holds no more areas: ask your GM to clear some.';

/** Why Connect says the GM turned something down (`map-refused`, `token-move-refused`). */
export type PlayerRefusal = 'not-held' | 'limit' | 'full';

/** What a player's board says of a refusal; null for one with no reason given (the board only puts things back). */
export function playerRefusalText(reason: PlayerRefusal | undefined): string | null {
  return reason === 'not-held' ? PLAYER_NOT_HELD_TEXT : reason === 'limit' ? PLAYER_LIMIT_TEXT : reason === 'full' ? PLAYER_FULL_TEXT : null;
}
/** How long that stays on a player's board. */
export const PLAYER_REFUSAL_MS = 4000;

/** The name of a map file as people know it: without its folder and extension. */
export function mapName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.atlasmap$/i, '');
}

/** The bar for a board: null while Atlas holds its map, or is on its way to (edits made meanwhile wait for it). */
export function hostBar(input: HostBarInput): HostBar {
  const { status, mapPath } = input;
  if (status.kind === 'held' && status.mapPath === mapPath) return null;
  if (input.failed === 'no-atlas') return { text: NO_ATLAS_TEXT, action: null };
  if (status.kind === 'held') return { text: viewOnlyText(input.nameOf(status.mapPath)), action: 'edit-here' };
  if (status.kind === 'loading' && status.mapPath === mapPath) return null;
  if (input.closedByUser) return { text: CLOSED_TEXT, action: 'reopen' };
  if (input.failed === 'timeout') return { text: TIMEOUT_TEXT, action: 'retry' };
  if (status.kind === 'loading' && status.mapPath !== null) return { text: viewOnlyText(input.nameOf(status.mapPath)), action: 'edit-here' };
  // No Atlas tab yet, and nothing has failed: the board is about to open one.
  return null;
}
