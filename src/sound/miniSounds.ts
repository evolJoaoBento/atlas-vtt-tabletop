/** A position on the board plane. */
interface Spot { x: number; y: number }

/** A token has to move by more than this many cells between two syncs to be heard moving. */
const MOVED_CELLS = 0.25;

/**
 * The ids of tokens that moved on their own between two syncs of the same scene: still there, more than a quarter of a
 * cell from where they were, and not in `ignore` (what this board dropped itself a moment ago, echoed back). A token
 * that is new or gone is not listed: a spawn is no move.
 */
export function remoteMoves(before: ReadonlyMap<string, Spot>, after: ReadonlyMap<string, Spot>, cell: number, ignore: ReadonlySet<string>): string[] {
  const moved: string[] = [];
  for (const [id, was] of before) {
    const now = after.get(id);
    if (!now || ignore.has(id)) continue;
    if (Math.hypot(now.x - was.x, now.y - was.y) > MOVED_CELLS * cell) moved.push(id);
  }
  return moved;
}

/** The doors whose state differs between two syncs of the same scene: those in both, now shut or now open. */
export function doorChanges(before: ReadonlyMap<string, boolean>, after: ReadonlyMap<string, boolean>): Array<{ id: string; closed: boolean }> {
  const changes: Array<{ id: string; closed: boolean }> = [];
  for (const [id, closed] of after) {
    const was = before.get(id);
    if (was !== undefined && was !== closed) changes.push({ id, closed });
  }
  return changes;
}

/** How long a token this board dropped is remembered, so the file echoing the drop back is not heard as someone else's move. */
export const DROP_MEMORY_MS = 2000;

/** The tokens this board dropped in the last two seconds (`now` is the clock, in ms). */
export class RecentDrops {
  private readonly dropped = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  mark(ids: Iterable<string>): void {
    const at = this.now();
    for (const id of ids) this.dropped.set(id, at);
  }

  /** The ids still remembered. */
  active(): Set<string> {
    const limit = this.now() - DROP_MEMORY_MS;
    for (const [id, at] of this.dropped) if (at <= limit) this.dropped.delete(id);
    return new Set(this.dropped.keys());
  }
}

/** Names the scene a map shows, so a sync can tell news of the scene played from another scene (or level) being shown. */
export function sceneKey(map: { path: string; level: string | null }): string {
  return `${map.path}|${map.level ?? ''}`;
}
