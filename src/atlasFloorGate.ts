/**
 * What Tabletop does at each state of the Atlas it finds (`atlasFloor`, read at load and whenever Atlas reloads), and
 * which Connect it works with. Pure, so it is tested without Obsidian.
 */
import { floorNotice, type AtlasFloor } from '../packages/atlas-host/src/index';
import { FUSION_PROTOCOL } from './connectWire';

/** What a board says while Atlas is not enabled: it draws, and edits nothing. */
export const NO_ATLAS_TEXT = 'Atlas VTT is not enabled. View only.';

export interface FloorState {
  /** Whether Tabletop offers its API (to Connect) and its boards draw. */
  publish: boolean;
  /** What a board tab says: in place of the board when nothing is published, over it otherwise; null for nothing. */
  boardText: string | null;
  /** The notice to show, once per Atlas version found; null for none. */
  notice: string | null;
  /** Whether a board may bring Atlas to its map (claim and follow Atlas's tab): only an Atlas of the floor or later. */
  follow: boolean;
}

/**
 * An Atlas older than the floor switches Tabletop off: one notice, no API (so no connection) and board tabs that say
 * why. Without Atlas at all the boards still open, to look at; everything they edit lives in Atlas.
 */
export function floorState(floor: AtlasFloor): FloorState {
  if (floor.state === 'ok') return { publish: true, boardText: null, notice: null, follow: true };
  if (floor.state === 'missing') return { publish: true, boardText: NO_ATLAS_TEXT, notice: null, follow: true };
  const text = floorNotice('Tabletop', floor.version);
  // An older Atlas is never asked to switch map: its view would load a map whose fields it may not keep.
  return { publish: false, boardText: text, notice: text, follow: false };
}

/** Whether a session handed over by Connect is of this Tabletop's fusion step: one of another step (or of none) is not taken. */
export function sessionPairs(session: unknown): boolean {
  return typeof session === 'object' && session !== null && (session as { fusion?: unknown }).fusion === FUSION_PROTOCOL;
}
