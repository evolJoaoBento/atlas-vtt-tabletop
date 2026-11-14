/**
 * The upkeep of every map Atlas holds, whether or not a board is open on it: what Atlas holds for a kept spell (walls,
 * difficult ground: `spellReconciler.ts`) goes when its spell goes. A spell can be removed with no board open (by a
 * player, through Connect; by the GM, in Atlas), and its walls must not stay behind stopping sight and tokens until a
 * board is opened again. It only ever takes away: making what a spell stands needs the map's measuring, which the
 * board's own pass has (`BoardView`).
 */
import type { AtlasView } from '../atlas';
import { reconcileSpells } from './spellReconciler';

/** How long a store must stay as it is before its orphans are looked for. */
export const UPKEEP_MS = 400;

type Timers = Pick<Window, 'setTimeout' | 'clearTimeout'>;

export class SpellUpkeep {
  private readonly followed = new Map<AtlasView, { stop: () => void; timer: number | null }>();

  /** `views` are the Atlas map views open now. */
  constructor(private readonly views: () => AtlasView[], private readonly timers: Timers = window) {}

  /** Follows the Atlas views open now and lets go of those that closed: call when the layout changes. */
  sync(): void {
    const open = new Set(this.views());
    for (const [view, entry] of [...this.followed]) {
      if (open.has(view)) continue;
      entry.stop();
      if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
      this.followed.delete(view);
    }
    for (const view of open) {
      if (this.followed.has(view)) continue;
      let seen = view.atlasStore.getState().objects;
      const entry: { stop: () => void; timer: number | null } = { stop: () => {}, timer: null };
      entry.stop = view.atlasStore.subscribe(() => {
        const objects = view.atlasStore.getState().objects;
        if (objects?.measures === seen?.measures && objects?.walls === seen?.walls && objects?.mapFeatures === seen?.mapFeatures) return;
        seen = objects;
        this.soon(view);
      });
      this.followed.set(view, entry);
      // The map as it is now: what a spell removed while Obsidian was closed left behind.
      this.soon(view);
    }
  }

  dispose(): void {
    for (const entry of this.followed.values()) {
      entry.stop();
      if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
    }
    this.followed.clear();
  }

  private soon(view: AtlasView): void {
    const entry = this.followed.get(view);
    if (!entry) return;
    if (entry.timer !== null) this.timers.clearTimeout(entry.timer);
    entry.timer = this.timers.setTimeout(() => {
      entry.timer = null;
      if (!this.followed.has(view)) return;
      try {
        reconcileSpells(view, null);
      } catch (error) {
        console.warn('Tabletop: what a removed spell left in Atlas could not be taken away:', error);
      }
    }, UPKEEP_MS);
  }
}
