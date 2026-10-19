import { Notice, Plugin, PluginSettingTab, Setting, TFile, debounce, setIcon, type App } from 'obsidian';
import { mapViews, tokenLabel, type AtlasView } from './src/atlas';
import { Assignments, readAssignments, type AssignmentData, type MiniPlacement } from './src/assignments';
import { watchTokenMenu, type TokenMenuEntry } from './src/contextMenu';
import { GALLERY_VIEW_TYPE, GalleryView, MiniPicker, importWithNotice, pickFiles } from './src/gallery';
import { DEFAULT_MINIS_FOLDER, MiniLibrary, explainLoadError } from './src/library';
import { MiniOverlay } from './src/overlay';
import { playerMiniPainter, type PlayerMiniPainter } from './src/playerMinis';

const VIEW_POLL_MS = 1000;
export const API_READY_EVENT = 'atlas-vtt-tabletop:api-ready';
export const API_UNLOAD_EVENT = 'atlas-vtt-tabletop:api-unload';

interface TabletopSettings {
  folder: string;
}

interface SavedData {
  settings?: Partial<TabletopSettings>;
  assignments?: AssignmentData;
}

/**
 * What other plugins (Atlas VTT Connect) read of Tabletop: `app.plugins.plugins['atlas-vtt-tabletop'].api`, announced
 * with the workspace event `atlas-vtt-tabletop:api-ready` and withdrawn with `atlas-vtt-tabletop:api-unload`.
 */
export interface TabletopApi {
  readonly version: 1;
  /** The minis on a map's tokens, by Atlas token id. */
  placementsFor(mapPath: string): Readonly<Record<string, MiniPlacement>>;
  /** Calls `listener` when placements change: with the map's path, or null when any map may have changed. */
  onChange(listener: (mapPath: string | null) => void): () => void;
  /** The bytes of a mini's GLB, read from the vault. */
  readMini(path: string): Promise<ArrayBuffer>;
  /** Draws the minis in a joined player's view: without Tabletop a player sees none. */
  readonly playerMinis: PlayerMiniPainter;
}

interface Tracked {
  view: AtlasView;
  overlay: MiniOverlay;
  stops: Array<() => void>;
  /** The button on the map that turns the 3D table on and off. */
  button: HTMLElement | null;
}

/**
 * A button on the map itself, under Atlas's scene tabs: Atlas hides Obsidian's view header on its map tabs, so a header
 * action would never be seen.
 */
function addMapButton(view: AtlasView, icon: string, title: string, onClick: () => void): HTMLElement | null {
  const root = view.containerEl;
  if (!root) return null;
  const button = root.ownerDocument.createElement('button');
  button.className = 'atlas-tabletop-table-button clickable-icon';
  button.setAttribute('aria-label', title);
  button.setAttribute('data-tooltip-position', 'right');
  setIcon(button, icon);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  root.appendChild(button);
  return button;
}

export default class TabletopPlugin extends Plugin {
  settings: TabletopSettings = { folder: DEFAULT_MINIS_FOLDER };
  assignments = new Assignments();
  library!: MiniLibrary;
  api: TabletopApi | null = null;
  private readonly tracked = new Map<string, Tracked>();
  private players: ReturnType<typeof playerMiniPainter> | null = null;
  private readonly warned = new Set<string>();
  private readonly save = debounce(() => { void this.saveData({ settings: this.settings, assignments: this.assignments.toJSON() } satisfies SavedData); }, 500, true);

  async onload(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as SavedData;
    this.settings = { folder: DEFAULT_MINIS_FOLDER, ...(saved.settings ?? {}) };
    this.assignments = new Assignments(readAssignments(saved.assignments));
    this.register(this.assignments.onChange(() => this.save()));
    this.library = new MiniLibrary(this.app, () => this.settings.folder);
    this.register(() => this.library.dispose());

    this.registerView(GALLERY_VIEW_TYPE, (leaf) => new GalleryView(leaf, this.library));
    this.addRibbonIcon('box', 'Open minis gallery', () => { void this.openGallery(); });
    this.addCommand({ id: 'open-gallery', name: 'Open minis gallery', callback: () => { void this.openGallery(); } });
    this.addCommand({
      id: 'import-minis',
      name: 'Import GLB minis',
      callback: async () => { await importWithNotice(this.library, await pickFiles(document)); },
    });
    this.addCommand({
      id: 'toggle-3d-table',
      name: 'Toggle 3D table',
      checkCallback: (checking) => {
        const entry = this.activeTracked();
        if (!entry) return false;
        if (!checking) this.toggleTable(entry);
        return true;
      },
    });
    this.addCommand({
      id: 'reset-3d-table',
      name: 'Reset 3D table angle',
      checkCallback: (checking) => {
        const entry = this.activeTracked();
        if (!entry?.overlay.tableShown) return false;
        if (!checking) entry.overlay.resetTable();
        return true;
      },
    });
    this.addSettingTab(new TabletopSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.assignments.rename(oldPath, file.path);
      this.library.fileChanged(file.path, oldPath);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.assignments.deleted(file.path);
      this.library.fileChanged(file.path);
    }));
    this.registerEvent(this.app.vault.on('create', (file) => this.library.fileChanged(file.path)));
    this.registerEvent(this.app.vault.on('modify', (file) => this.library.fileChanged(file.path)));

    this.app.workspace.onLayoutReady(() => {
      this.syncViews();
      this.registerInterval(window.setInterval(() => this.syncViews(), VIEW_POLL_MS));
      this.registerEvent(this.app.workspace.on('layout-change', () => this.syncViews()));
      this.library.emit();
    });

    this.players = playerMiniPainter();
    this.api = Object.freeze({
      version: 1 as const,
      playerMinis: this.players.painter,
      placementsFor: (mapPath: string) => this.assignments.forMap(mapPath),
      onChange: (listener: (mapPath: string | null) => void) => this.assignments.onChange(listener),
      readMini: async (path: string): Promise<ArrayBuffer> => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'glb') throw new Error(`No mini at ${path}.`);
        return this.app.vault.readBinary(file);
      },
    });
    this.app.workspace.trigger(API_READY_EVENT, this.api);
  }

  onunload(): void {
    this.app.workspace.trigger(API_UNLOAD_EVENT);
    this.api = null;
    // Connect lets go of a painter that is gone on its next frame; its views are freed here at once.
    this.players?.dispose();
    this.players = null;
    for (const viewId of [...this.tracked.keys()]) this.untrack(viewId);
    this.save.run();
  }

  async openGallery(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(GALLERY_VIEW_TYPE)[0];
    const leaf = open ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
    if (!open) await leaf.setViewState({ type: GALLERY_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  /** Follows the open map views: an overlay and a token menu on each, removed with the view. */
  private syncViews(): void {
    const open = mapViews(this.app);
    for (const view of open) if (!this.tracked.has(view.viewId)) this.track(view);
    for (const viewId of [...this.tracked.keys()]) if (!open.some((view) => view.viewId === viewId)) this.untrack(viewId);
  }

  private track(view: AtlasView): void {
    const overlay = new MiniOverlay(view, this.assignments, this.library, (mini, error) => {
      if (this.warned.has(mini)) return;
      this.warned.add(mini);
      new Notice(`Tabletop: cannot show ${mini}: ${explainLoadError(error)}`, 8000);
    });
    overlay.onTableFailed = (error) => {
      new Notice(`Tabletop: the 3D table cannot be shown on this map: ${error instanceof Error ? error.message : String(error)}`, 8000);
      this.syncButton(entry);
    };
    const stops: Array<() => void> = [];
    stops.push(watchTokenMenu(view, (tokenId) => this.menuEntries(view, tokenId)));
    const entry: Tracked = { view, overlay, stops, button: null };
    entry.button = addMapButton(view, 'cuboid', '3D table (Alt + drag to tilt, right-drag to pan)', () => this.toggleTable(entry));
    this.tracked.set(view.viewId, entry);
  }

  private untrack(viewId: string): void {
    const entry = this.tracked.get(viewId);
    if (!entry) return;
    this.tracked.delete(viewId);
    for (const stop of entry.stops) stop();
    entry.button?.remove();
    entry.overlay.dispose();
  }

  /** The map view in focus, else the only one open. */
  private activeTracked(): Tracked | null {
    const active = this.app.workspace.getMostRecentLeaf()?.view as unknown as { viewId?: unknown } | undefined;
    if (typeof active?.viewId === 'string') {
      const found = this.tracked.get(active.viewId);
      if (found) return found;
    }
    return this.tracked.size === 1 ? [...this.tracked.values()][0]! : null;
  }

  private toggleTable(entry: Tracked): void {
    entry.overlay.setTable(!entry.overlay.tableShown);
    this.syncButton(entry);
  }

  private syncButton(entry: Tracked): void {
    entry.button?.toggleClass('is-active', entry.overlay.tableShown);
  }

  /** The token, and the other selected tokens when it is one of a selection. */
  private targets(view: AtlasView, tokenId: string): string[] {
    const { selectedIds, objects } = view.atlasStore.getState();
    const selected = (selectedIds ?? []).filter((id) => Object.hasOwn(objects.tokens, id));
    return selected.includes(tokenId) ? selected : [tokenId];
  }

  private menuEntries(view: AtlasView, tokenId: string): TokenMenuEntry[] {
    const state = view.atlasStore.getState();
    const mapPath = state.mapPath;
    const token = state.objects.tokens[tokenId];
    if (!mapPath || !token) return [];
    const current = this.assignments.get(mapPath, tokenId);
    const targets = this.targets(view, tokenId);
    const entries: TokenMenuEntry[] = [{
      label: current ? 'Change mini…' : 'Place mini…',
      icon: 'box',
      onClick: () => {
        const name = targets.length > 1 ? `${targets.length} tokens` : tokenLabel(token);
        new MiniPicker(this.app, this.library, name, current, (result) => {
          for (const id of targets) this.assignments.set(mapPath, id, result);
        }).open();
      },
    }];
    if (current) {
      entries.push({
        label: targets.length > 1 ? 'Remove minis' : 'Remove mini',
        icon: 'x',
        onClick: () => { for (const id of targets) this.assignments.remove(mapPath, id); },
      });
    }
    return entries;
  }

  async setFolder(folder: string): Promise<void> {
    this.settings.folder = folder.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_MINIS_FOLDER;
    this.save();
    this.library.emit();
  }
}

class TabletopSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TabletopPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Minis folder')
      .setDesc('Where imported GLB minis are kept. GLB files put in this folder by hand are listed too.')
      .addText((text) => text.setPlaceholder(DEFAULT_MINIS_FOLDER).setValue(this.plugin.settings.folder).onChange((value) => { void this.plugin.setFolder(value); }));
  }
}
