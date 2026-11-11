/**
 * Tabletop's undo history: one list of steps for every board, each tagged with the maps it changed. A board undoes the
 * latest step that touched its map (or a scene stacked with it) and redoes the latest it undid, so boards of different
 * maps keep apart while a change made from one board of a map can be undone from another.
 *
 * A step knows how to take itself back and bring itself back again (a snapshot of Tabletop's data, a map file's text,
 * Atlas's own history); one that can no longer do so (the map changed in between) says why and is dropped.
 */

export interface UndoStep {
  /** The maps the step changed. */
  paths: readonly string[];
  /** What the step did, for a notice ("Undo: moved token"). */
  label: string;
  /** Takes the step back; resolves false (or throws) when it no longer can. */
  undo(): boolean | Promise<boolean>;
  /** Brings the step back; resolves false (or throws) when it no longer can. */
  redo(): boolean | Promise<boolean>;
  /** Steps of one gesture (a slider dragged) fold into one: the later's `merge` takes the earlier's place. */
  mergeKey?: string;
  merge?(earlier: UndoStep): UndoStep;
}

/** The most steps kept. */
export const UNDO_LIMIT = 200;
/** Steps with the same merge key this close together are one gesture. */
const MERGE_MS = 800;

interface Kept {
  step: UndoStep;
  at: number;
}

export class UndoHistory {
  private past: Kept[] = [];
  private future: Kept[] = [];
  private busy = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try { listener(); } catch (error) { console.error('[Tabletop] An undo listener failed:', error); }
    }
  }

  /** Whether an undo or redo is being carried out: what it writes is no new step. */
  get travelling(): boolean {
    return this.busy;
  }

  /** Records a step just done. It clears what could be redone on its maps. */
  push(step: UndoStep): void {
    if (this.busy) return;
    const at = this.now();
    const last = this.past[this.past.length - 1];
    if (step.mergeKey && step.merge && last && last.step.mergeKey === step.mergeKey && at - last.at < MERGE_MS) {
      this.past[this.past.length - 1] = { step: step.merge(last.step), at };
    } else {
      this.past.push({ step, at });
      if (this.past.length > UNDO_LIMIT) this.past.splice(0, this.past.length - UNDO_LIMIT);
    }
    this.future = this.future.filter((kept) => !kept.step.paths.some((path) => step.paths.includes(path)));
    this.changed();
  }

  canUndo(paths: readonly string[]): boolean {
    return UndoHistory.latest(this.past, paths) >= 0;
  }

  canRedo(paths: readonly string[]): boolean {
    return UndoHistory.latest(this.future, paths) >= 0;
  }

  /** Takes back the latest step on these maps; resolves its label, or null when there was none or it failed. */
  undo(paths: readonly string[]): Promise<{ label: string; done: boolean } | null> {
    return this.travel(this.past, this.future, paths, 'undo');
  }

  redo(paths: readonly string[]): Promise<{ label: string; done: boolean } | null> {
    return this.travel(this.future, this.past, paths, 'redo');
  }

  /** Forgets every step on a map (it was deleted). */
  forget(path: string): void {
    const keep = (kept: Kept): boolean => !kept.step.paths.includes(path);
    this.past = this.past.filter(keep);
    this.future = this.future.filter(keep);
    this.changed();
  }

  private static latest(list: readonly Kept[], paths: readonly string[]): number {
    for (let i = list.length - 1; i >= 0; i -= 1) if (list[i]!.step.paths.some((path) => paths.includes(path))) return i;
    return -1;
  }

  private async travel(from: Kept[], to: Kept[], paths: readonly string[], way: 'undo' | 'redo'): Promise<{ label: string; done: boolean } | null> {
    if (this.busy) return null;
    const index = UndoHistory.latest(from, paths);
    if (index < 0) return null;
    const [kept] = from.splice(index, 1);
    const step = kept!.step;
    this.busy = true;
    let done = false;
    try {
      done = await step[way]();
    } catch (error) {
      console.error(`[Tabletop] ${way} failed:`, error);
      done = false;
    } finally {
      this.busy = false;
    }
    if (done) to.push({ step, at: 0 });
    this.changed();
    return { label: step.label, done };
  }
}
