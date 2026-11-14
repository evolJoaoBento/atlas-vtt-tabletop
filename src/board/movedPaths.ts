/**
 * Material folders and prop models that were renamed or moved in the vault, remembered so a path kept on one of
 * Atlas's records still finds them. What the GM paints on a wall, and the prop standing in for a door, are kept on
 * Atlas's own wall records (`recordExtras.ts`), in every map; a map Atlas does not hold cannot be rewritten when a
 * folder is renamed, so the rename is remembered here instead (in Tabletop's saved data) and followed whenever such a
 * path is read. Only folders and `.glb` files are noted: nothing else is ever a material or a prop.
 */

/** How many renames in a row are followed (a folder moved again and again). */
const MAX_HOPS = 8;

export class MovedPaths {
  private readonly moved = new Map<string, string>();

  constructor(saved?: unknown) {
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return;
    for (const [from, to] of Object.entries(saved)) if (typeof to === 'string' && from !== '' && to !== '' && from !== to) this.moved.set(from, to);
  }

  /** A file or folder was renamed. Returns whether it was noted (a folder, or a prop model). */
  note(oldPath: string, newPath: string, isFolder: boolean): boolean {
    if (oldPath === newPath || oldPath === '' || newPath === '' || (!isFolder && !oldPath.toLowerCase().endsWith('.glb'))) return false;
    // What stands at the new place is real again: nothing leads away from it any more.
    for (const from of [...this.moved.keys()]) if (from === newPath || from.startsWith(`${newPath}/`)) this.moved.delete(from);
    this.moved.set(oldPath, newPath);
    return true;
  }

  /** Where a path kept on a record is now: itself when nothing it lies under was renamed. */
  resolve(path: string): string {
    let at = path;
    for (let hop = 0; hop < MAX_HOPS; hop += 1) {
      const next = this.step(at);
      if (next === null) return at;
      at = next;
    }
    return at;
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.moved);
  }

  /** One rename's worth: the path itself, or the longest folder it lies under. */
  private step(path: string): string | null {
    const exact = this.moved.get(path);
    if (exact !== undefined) return exact;
    let best: string | null = null;
    for (const from of this.moved.keys()) if (path.startsWith(`${from}/`) && (best === null || from.length > best.length)) best = from;
    return best === null ? null : this.moved.get(best)! + path.slice(best.length);
  }
}
