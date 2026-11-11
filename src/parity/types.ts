/**
 * Parity with Atlas's scene toolbar: every tool on Atlas's toolbar, every entry of its command palette and every tab of
 * its asset manager has a row here saying what the 3D board does for it. `npm run check:atlas` reads the same ids out of
 * the installed Atlas build and fails when Atlas has one these tables don't list (or the tables list one Atlas dropped).
 *
 * - `native`: the board does it itself, the Atlas way.
 * - `mapped`: the board's own equivalent stands in (Atlas's measure tool is the board's drag ruler).
 * - `atlas`: run in Atlas (its window or command), since it needs nothing from the board.
 * - `not-yet`: not on the board yet; offered as "Open in Atlas" where it shows.
 */
export const PARITY_STATUSES = ['native', 'mapped', 'atlas', 'not-yet'] as const;
export type ParityStatus = typeof PARITY_STATUSES[number];

export interface ParityRow {
  /** Atlas's own id for it. */
  id: string;
  status: ParityStatus;
  /** What the board does, or why not. */
  note: string;
}
