/**
 * Where the tray's saved rolls live and how the board reaches them: the collection of the board's map in Atlas (its
 * `dicePresets` and `diceRow` settings, Atlas 0.18's), read and written through Atlas's own asset service so the board and
 * Atlas show the same rolls. Offered only from 0.18 and for a map in a collection; otherwise the tray has none.
 */
import { readDiceShelf, type DiceShelf, type ShelfChange } from '../atlasPort/app/react/components/dice/diceShelf';
import type { AtlasBridge } from '../atlasBridge';
import { savedRollsOffered } from './savedRolls';
import type { SavedRollsHost } from './savedRollsPanel';

/** The key under which Atlas remembers, per device, that the saved rolls stand open beside its tray. */
export const SAVED_ROLLS_OPEN_KEY = 'atlas-vtt-dice-tray-presets-open';

export type SavedRollsAccess = Omit<SavedRollsHost, 'roll' | 'rules' | 'picture'>;

export interface SavedRollsAccessDeps {
  bridge: Pick<AtlasBridge, 'version' | 'collectionFor' | 'collectionSettings' | 'updateCollectionSettings'>;
  /** The board's map. */
  mapPath(): string;
  /** Hears Atlas saving any collection's settings (the id comes with it); returns how to stop. */
  changed(listener: (collectionId: string) => void): () => void;
  /** What this device remembers (Atlas's `loadLocalStorage` / `saveLocalStorage`). */
  storage: { load(key: string): unknown; save(key: string, value: unknown): void };
  /** The board's own write to a collection begins or ends: its reload of the map's rules need not run for it. */
  writing?(collectionId: string, on: boolean): void;
  menu: SavedRollsHost['menu'];
  icon: SavedRollsHost['icon'];
  warn(message: string): void;
}

export function savedRollsAccess(deps: SavedRollsAccessDeps): SavedRollsAccess {
  const { bridge } = deps;
  /** The map's collection where Atlas keeps saved rolls; null otherwise. */
  const collection = (): string | null => (savedRollsOffered(bridge.version()) ? bridge.collectionFor(deps.mapPath()) : null);
  return {
    shelf(): DiceShelf | null {
      const id = collection();
      const settings = id === null ? null : bridge.collectionSettings(id);
      return settings ? readDiceShelf(settings as never) : null;
    },
    async write(change: ShelfChange): Promise<void> {
      const id = collection();
      if (id === null) throw new Error('This map is in no collection.');
      deps.writing?.(id, true);
      try {
        if (!(await bridge.updateCollectionSettings(id, change as Record<string, unknown>))) throw new Error('Atlas cannot be reached.');
      } finally {
        deps.writing?.(id, false);
      }
    },
    onChange(listener): () => void {
      return deps.changed((changed) => { if (changed === collection()) listener(); });
    },
    isOpen: () => deps.storage.load(SAVED_ROLLS_OPEN_KEY) === true,
    setOpen: (open) => deps.storage.save(SAVED_ROLLS_OPEN_KEY, open),
    menu: deps.menu,
    icon: deps.icon,
    warn: deps.warn,
  };
}
