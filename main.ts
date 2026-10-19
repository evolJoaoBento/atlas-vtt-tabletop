import { Plugin, PluginSettingTab, Setting, TFile, debounce, type App } from 'obsidian';
import { Assignments, readAssignments, type AssignmentData, type MiniPlacement } from './src/assignments';
import { GALLERY_VIEW_TYPE, GalleryView, importWithNotice, pickFiles } from './src/gallery';
import { DEFAULT_MINIS_FOLDER, MiniLibrary } from './src/library';
import { playerMiniPainter, type PlayerMiniPainter } from './src/playerMinis';

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

export default class TabletopPlugin extends Plugin {
  settings: TabletopSettings = { folder: DEFAULT_MINIS_FOLDER };
  assignments = new Assignments();
  library!: MiniLibrary;
  api: TabletopApi | null = null;
  private players: ReturnType<typeof playerMiniPainter> | null = null;
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

    this.app.workspace.onLayoutReady(() => this.library.emit());

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
    this.save.run();
  }

  async openGallery(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(GALLERY_VIEW_TYPE)[0];
    const leaf = open ?? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
    if (!open) await leaf.setViewState({ type: GALLERY_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
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
