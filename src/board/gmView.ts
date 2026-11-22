/**
 * Atlas's GM view switch (`isGMView` in the store of the map view, `setGMView` to change it), as the board reads and
 * writes it so the board and Atlas's own 2D view agree: GM view on is Atlas's default; off is its session view, the
 * map as players see it. Feature-checked, so an Atlas without the switch leaves the board its own. Pure.
 */

/** The GM view of an Atlas view's state: true or false, or null where the state has no such switch. */
export function readGmView(state: unknown): boolean | null {
  if (typeof state !== 'object' || state === null) return null;
  const { isGMView, setGMView } = state as { isGMView?: unknown; setGMView?: unknown };
  return typeof isGMView === 'boolean' && typeof setGMView === 'function' ? isGMView : null;
}

/** Switches the GM view of an Atlas view's state; false where it has no such switch (nothing is changed). */
export function writeGmView(state: unknown, on: boolean): boolean {
  if (readGmView(state) === null) return false;
  try { (state as { setGMView(on: boolean): void }).setGMView(on); } catch { return false; }
  return true;
}
