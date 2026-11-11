/**
 * Atlas's Random tables window on the 3D board: Atlas's own React components (copied, src/atlasPort/app), mounted over the
 * board inside an `.atlas-vtt-plugin` root so Atlas's live stylesheet styles them, with the providers Atlas's map view gives
 * them (Obsidian's app, a store, its context menus). The store is the board's: it holds the map's random tables choices,
 * read from the map file's `lootRoller` block and saved back there (through Atlas's store when Atlas holds the map), so Atlas
 * and the board agree on them. Where the window floats, its size and whether it is open are the board's own.
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { RandomTables } from '../atlasPort/app/react/components/randomTables/RandomTablesPanel';
import { ContextMenuProvider } from '../atlasPort/app/react/root/ContextMenuContext';
import { readLootRollerState, type LootRollerState } from '../atlasPort/app/stores/lootRollerSlice';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';
import { ViewStoreProvider } from '../atlasPort/shims/viewStore';
import { createBoardStore, type BoardStore } from './boardStore';

/** The choices saved with the map (Atlas's `lootRoller` block); the rest of the window's state is the board's. */
const SAVED_FIELDS = ['disabledViews', 'excludedRarities', 'count', 'pane', 'selected', 'lastRoll'] as const;
type Geometry = Pick<LootRollerState, 'open' | 'position' | 'size'>;

export interface LootWindowDeps {
  app: App;
  /** The map file's text; null when it cannot be read. */
  readMap(path: string): Promise<string | null>;
  /** Saves choices into the map (`TokenWriter.lootRoller`). */
  save(path: string, settings: Record<string, unknown>): Promise<unknown>;
}

export class LootWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private readonly store: BoardStore;
  /** Where the window was on each map this session, and whether it was open. */
  private readonly geometry = new Map<string, Geometry>();
  private path: string | null = null;

  constructor(host: HTMLElement, private readonly deps: LootWindowDeps) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.store = createBoardStore((before, after) => this.changed(before, after));
    this.root = createRoot(this.el);
    this.root.render(
      <AtlasUIContext.Provider value={{ app: deps.app, view: null, pixiApp: null, renderer: null }}>
        <ViewStoreProvider store={this.store}>
          <ContextMenuProvider>
            <RandomTables />
          </ContextMenuProvider>
        </ViewStoreProvider>
      </AtlasUIContext.Provider>,
    );
  }

  /** Shows the random tables of another map (or none). */
  async setMap(path: string | null): Promise<void> {
    this.path = path;
    let saved: unknown = undefined;
    if (path) {
      try { saved = (JSON.parse(await this.deps.readMap(path) ?? '{}') as { state?: { lootRoller?: unknown } }).state?.lootRoller; } catch { saved = undefined; }
    }
    if (this.path !== path) return;
    const state = readLootRollerState(saved);
    const own = path ? this.geometry.get(path) : undefined;
    this.store.load(path, { ...state, open: own?.open ?? false, position: own?.position, size: own?.size });
  }

  isOpen(): boolean {
    return this.store.getState().lootRoller.open;
  }

  open(): void { this.store.getState().setLootRollerOpen(true); }
  close(): void { this.store.getState().setLootRollerOpen(false); }
  toggle(): void { this.store.getState().setLootRollerOpen(!this.isOpen()); }

  dispose(): void {
    this.root.unmount();
    this.el.remove();
  }

  /** Keeps the window's place for this map, and saves what the GM chose into the map. */
  private changed(before: LootRollerState, after: LootRollerState): void {
    const path = this.path;
    if (!path) return;
    this.geometry.set(path, { open: after.open, position: after.position, size: after.size });
    const settings: Record<string, unknown> = {};
    for (const field of SAVED_FIELDS) if (before[field] !== after[field]) settings[field] = after[field];
    if (Object.keys(settings).length > 0) void this.deps.save(path, settings).catch((error: unknown) => console.error('Tabletop: could not save the random tables choices', error));
  }
}
