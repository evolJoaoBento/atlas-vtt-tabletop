import { Notice, Plugin, PluginSettingTab, Setting, TFile, debounce, type App, type ButtonComponent, type WorkspaceLeaf } from 'obsidian';
import { Assignments, readAssignments, type AssignmentData, type MiniPlacement } from './src/assignments';
import { mapViews } from './src/atlas';
import { BOARD_VIEW_TYPE, BoardView, HOVER_SOURCE } from './src/board/BoardView';
import { PLAYER_VIEW_TYPE, PlayerView } from './src/board/PlayerWindow';
import { BoardData, readBoardData, type BoardDataJSON } from './src/board/boardData';
import { DEFAULT_QUALITY, readQuality, type Quality } from './src/board/quality';
import { resolveLaser, type LaserSettings } from './src/board/laser';
import { TokenWriter } from './src/board/tokenWriter';
import { GALLERY_VIEW_TYPE, GalleryView, importWithNotice, pickFiles } from './src/gallery';
import { DEFAULT_MINIS_FOLDER, DEFAULT_PROPS_FOLDER, MiniLibrary, PROPS } from './src/library';
import { DEFAULT_MATERIALS_FOLDER, MaterialLibrary } from './src/materials';
import { GpuSettings, currentChip, gpuChoices, type GpuPreference } from './src/gpu';
import { playerMiniPainter, type PlayerMiniPainter } from './src/playerMinis';
import { boardLookFor, MaterialIndex } from './src/boardLook';
import { playerBoardFactory, type PlayerBoardFactory } from './src/playerBoard';
import type { BoardLook, GmCameraSource } from './src/connectContract';

export const API_READY_EVENT = 'atlas-vtt-tabletop:api-ready';
export const API_UNLOAD_EVENT = 'atlas-vtt-tabletop:api-unload';

interface TabletopSettings {
  /** The minis folder (the key keeps its old name so saved settings still read). */
  folder: string;
  propsFolder: string;
  /** Where the materials walls and doors are painted with are kept. */
  materialsFolder: string;
  /** How hard the 3D board works to look good. */
  quality: Quality;
  /** The laser pointer's colour and size (Atlas's options), for every map. */
  laser?: Partial<LaserSettings>;
}

const DEFAULT_SETTINGS: TabletopSettings = { folder: DEFAULT_MINIS_FOLDER, propsFolder: DEFAULT_PROPS_FOLDER, materialsFolder: DEFAULT_MATERIALS_FOLDER, quality: DEFAULT_QUALITY };

interface SavedData {
  settings?: Partial<TabletopSettings>;
  assignments?: AssignmentData;
  board?: BoardDataJSON;
}

const isMapPath = (path: string): boolean => path.toLowerCase().endsWith('.atlasmap');

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
  /** What the GM gave a map on the board (heights, materials, door props, props, fog height, ambient). */
  boardLook(mapPath: string): BoardLook;
  /** Calls `listener` when a map's look may have changed: with its path, or null for any map. */
  onBoardChange(listener: (mapPath: string | null) => void): () => void;
  /** The bytes of a material's texture or a prop's GLB, for Connect to send its players. */
  readAsset(path: string): Promise<ArrayBuffer>;
  /** The GM's 3D view of a map, for Connect's players' "GM view". */
  readonly gmCamera: GmCameraSource;
  /** The 3D board in a Connect player's tab, drawn from what Connect receives. */
  readonly playerBoard: PlayerBoardFactory;
}

/** The files `readAsset` hands out: textures and GLBs, nothing else of the vault. */
const ASSET_EXTENSIONS = new Set(['glb', 'png', 'jpg', 'jpeg', 'webp']);

export default class TabletopPlugin extends Plugin {
  settings: TabletopSettings = { ...DEFAULT_SETTINGS };
  assignments = new Assignments();
  boardData = new BoardData();
  private readonly boardListeners = new Set<(mapPath: string | null) => void>();
  private readonly cameraListeners = new Set<() => void>();
  private materialIndex: MaterialIndex | null = null;
  library!: MiniLibrary;
  props!: MiniLibrary;
  materials!: MaterialLibrary;
  api: TabletopApi | null = null;
  private players: ReturnType<typeof playerMiniPainter> | null = null;
  /** The 3D board used last: props from the gallery go to it. */
  private lastBoard: BoardView | null = null;
  private readonly save = debounce(() => {
    void this.saveData({ settings: this.settings, assignments: this.assignments.toJSON(), board: this.boardData.toJSON() } satisfies SavedData);
  }, 500, true);

  async onload(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as SavedData;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) };
    this.settings.quality = readQuality(this.settings.quality);
    this.assignments = new Assignments(readAssignments(saved.assignments));
    this.boardData = new BoardData(readBoardData(saved.board));
    this.register(this.assignments.onChange(() => { this.save(); this.refreshBoards(); }));
    this.register(this.boardData.onChange(() => { this.save(); this.refreshBoards(); }));
    this.library = new MiniLibrary(this.app, () => this.settings.folder);
    this.props = new MiniLibrary(this.app, () => this.settings.propsFolder, PROPS);
    this.materials = new MaterialLibrary(this.app, () => this.settings.materialsFolder);
    this.register(() => { this.library.dispose(); this.props.dispose(); this.materials.dispose(); });
    this.register(this.materials.onChange(() => { for (const view of this.boards()) view.refreshMaterials(); }));
    const writer = new TokenWriter({ views: () => mapViews(this.app), process: (path, edit) => this.processFile(path, edit) });

    this.registerView(GALLERY_VIEW_TYPE, (leaf) => new GalleryView(leaf, this.library, this.props, this.materials, (glb) => this.placeProp(glb), (material) => this.paintWith(material)));
    this.registerView(BOARD_VIEW_TYPE, (leaf) => new BoardView(leaf, {
      assignments: this.assignments,
      boardData: this.boardData,
      minis: this.library,
      props: this.props,
      materials: this.materials,
      writer,
      quality: () => this.settings.quality,
      laser: () => resolveLaser(this.settings.laser),
      setLaser: (changes) => {
        this.settings.laser = resolveLaser({ ...resolveLaser(this.settings.laser), ...changes });
        this.save();
      },
      focused: (view) => { this.lastBoard = view; },
      togglePlayerView: (view) => { void this.togglePlayerView(view); },
      playerViewOpen: (path) => this.playerLeaves().some((leaf) => fileOf(leaf) === path),
      cameraMoved: () => { for (const listener of [...this.cameraListeners]) listener(); },
      boardReady: (view) => {
        for (const player of this.playerViews()) if (player.mapPath === view.mapPath) view.showPlayer(player);
        this.refreshPlayerButtons();
      },
    }));
    this.registerView(PLAYER_VIEW_TYPE, (leaf) => new PlayerView(leaf, {
      attach: (view) => this.attachPlayer(view),
      detach: (view) => {
        for (const board of this.boards()) board.hidePlayer(view);
        this.refreshPlayerButtons();
      },
    }));
    this.registerHoverLinkSource(HOVER_SOURCE, { display: 'Tabletop 3D board', defaultMod: true });
    this.addRibbonIcon('box', 'Open minis gallery', () => { void this.openGallery(); });
    this.addCommand({ id: 'open-gallery', name: 'Open minis gallery', callback: () => { void this.openGallery(); } });
    this.addCommand({
      id: 'import-minis',
      name: 'Import GLB minis',
      callback: async () => { await importWithNotice(this.library, await pickFiles(document)); },
    });
    this.addCommand({
      id: 'open-board',
      name: 'Open map in 3D',
      checkCallback: (checking) => {
        const path = this.currentMap();
        if (!path) return false;
        if (!checking) void this.openBoard(path);
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || !isMapPath(file.path)) return;
      menu.addItem((item) => item.setTitle('Open in 3D').setIcon('cuboid').onClick(() => { void this.openBoard(file.path); }));
    }));
    this.addSettingTab(new TabletopSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.assignments.rename(oldPath, file.path);
      this.boardData.rename(oldPath, file.path);
      this.library.fileChanged(file.path, oldPath);
      this.props.fileChanged(file.path, oldPath);
      this.materials.fileChanged(file.path, oldPath);
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      this.assignments.deleted(file.path);
      this.boardData.deleted(file.path);
      this.library.fileChanged(file.path);
      this.props.fileChanged(file.path);
      this.materials.fileChanged(file.path);
    }));
    const changed = (file: { path: string }): void => { this.library.fileChanged(file.path); this.props.fileChanged(file.path); this.materials.fileChanged(file.path); };
    this.registerEvent(this.app.vault.on('create', changed));
    this.registerEvent(this.app.vault.on('modify', changed));

    this.app.workspace.onLayoutReady(() => { this.library.emit(); this.props.emit(); });

    this.materialIndex = new MaterialIndex(this.app.vault, () => this.boardChanged(null));
    this.register(this.boardData.onChange((mapPath) => this.boardChanged(mapPath)));
    this.register(this.materials.onChange(() => { this.materialIndex?.forgetAll(); this.boardChanged(null); }));
    this.players = playerMiniPainter();
    this.api = Object.freeze({
      version: 1 as const,
      playerMinis: this.players.painter,
      playerBoard: playerBoardFactory(() => this.settings.quality),
      placementsFor: (mapPath: string) => this.assignments.forMap(mapPath),
      onChange: (listener: (mapPath: string | null) => void) => this.assignments.onChange(listener),
      readMini: async (path: string): Promise<ArrayBuffer> => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'glb') throw new Error(`No mini at ${path}.`);
        return this.app.vault.readBinary(file);
      },
      boardLook: (mapPath: string) => boardLookFor(this.boardData, this.materialIndex!, mapPath),
      onBoardChange: (listener: (mapPath: string | null) => void) => {
        this.boardListeners.add(listener);
        return () => { this.boardListeners.delete(listener); };
      },
      readAsset: async (path: string): Promise<ArrayBuffer> => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile) || !ASSET_EXTENSIONS.has(file.extension.toLowerCase())) throw new Error(`No texture or model at ${path}.`);
        return this.app.vault.readBinary(file);
      },
      gmCamera: Object.freeze({
        camera: (mapPath: string) => this.gmCamera(mapPath),
        onChange: (listener: () => void) => {
          this.cameraListeners.add(listener);
          return () => { this.cameraListeners.delete(listener); };
        },
      }),
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

  async setFolder(key: 'folder' | 'propsFolder' | 'materialsFolder', folder: string): Promise<void> {
    this.settings[key] = folder.trim().replace(/^\/+|\/+$/g, '') || DEFAULT_SETTINGS[key];
    this.save();
    if (key === 'materialsFolder') this.materials.fileChanged(this.materials.folderPath);
    else (key === 'folder' ? this.library : this.props).emit();
  }

  async setQuality(quality: Quality): Promise<void> {
    this.settings.quality = quality;
    this.save();
    for (const view of this.boards()) await view.applyQuality();
  }

  /** The map to open in 3D: the open `.atlasmap` file, else the map of the Atlas view used last. */
  private currentMap(): string | null {
    const file = this.app.workspace.getActiveFile();
    if (file && isMapPath(file.path)) return file.path;
    const recent = this.app.workspace.getMostRecentLeaf()?.view as unknown as { viewId?: unknown } | undefined;
    const views = mapViews(this.app);
    const view = views.find((candidate) => candidate.viewId === recent?.viewId) ?? views[0];
    return view?.atlasStore.getState().mapPath ?? null;
  }

  /** Opens a map in 3D in a new tab (or shows the tab it is already open in). */
  async openBoard(path: string): Promise<void> {
    // By the tab's saved state: a tab Obsidian restored but has not shown yet holds no loaded view to ask.
    const open = this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).find((leaf) => fileOf(leaf) === path);
    const leaf = open ?? this.app.workspace.getLeaf('tab');
    if (!open) await leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: path }, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof BoardView) this.lastBoard = leaf.view;
  }

  private playerLeaves(): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType(PLAYER_VIEW_TYPE);
  }

  private playerViews(): PlayerView[] {
    return this.playerLeaves().map((leaf) => leaf.view).filter((view): view is PlayerView => view instanceof PlayerView);
  }

  /**
   * The board's player view button: closes the player view when it shows this map, else shows this map in it,
   * opening it in its own window (one player view at a time, as Atlas has one player window).
   */
  private async togglePlayerView(board: BoardView): Promise<void> {
    const path = board.mapPath;
    if (!path) return;
    const leaves = this.playerLeaves();
    const showing = leaves.find((leaf) => fileOf(leaf) === path);
    if (showing) {
      showing.detach();
    } else {
      const leaf = leaves[0] ?? this.app.workspace.openPopoutLeaf({ size: { width: 1280, height: 720 } });
      await leaf.setViewState({ type: PLAYER_VIEW_TYPE, state: { file: path }, active: false });
    }
    this.refreshPlayerButtons();
  }

  /** A player view shows a map: the board of that map draws into it, or it waits for one. */
  private attachPlayer(view: PlayerView): void {
    for (const board of this.boards()) if (board.mapPath !== view.mapPath) board.hidePlayer(view);
    const board = this.boards().find((candidate) => candidate.mapPath === view.mapPath && candidate.ready);
    if (board) {
      board.showPlayer(view);
    } else {
      view.waiting(true);
      // A board tab Obsidian restored but has not shown yet holds no board: load it, and it reports when ready.
      const deferred = this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).find((leaf) => fileOf(leaf) === view.mapPath);
      if (deferred) void deferred.loadIfDeferred();
    }
    this.refreshPlayerButtons();
  }

  /** A map's look changed for Connect: its listeners hear it, and a changed material is read again. */
  private boardChanged(mapPath: string | null): void {
    for (const listener of [...this.boardListeners]) {
      try {
        listener(mapPath);
      } catch (error) {
        console.error('[Tabletop] A board listener failed:', error);
      }
    }
  }

  /** The players' window's camera on `mapPath` when one shows it, else the GM's board camera of that map. */
  private gmCamera(mapPath: string): ReturnType<GmCameraSource['camera']> {
    const boards = this.boards().filter((board) => board.mapPath === mapPath);
    for (const board of boards) {
      const players = board.playerPose();
      if (players) return players;
    }
    for (const board of boards) {
      const pose = board.cameraPose();
      if (pose) return pose;
    }
    return null;
  }

  private refreshPlayerButtons(): void {
    for (const board of this.boards()) board.refreshToolbar();
  }

  private boards(): BoardView[] {
    return this.app.workspace.getLeavesOfType(BOARD_VIEW_TYPE).map((leaf) => leaf.view).filter((view): view is BoardView => view instanceof BoardView);
  }

  private refreshBoards(): void {
    for (const view of this.boards()) view.refresh();
  }

  /** A prop picked in the gallery goes to the 3D board used last: the next click on it puts the prop there. */
  private placeProp(glb: string): void {
    const open = this.boards();
    const view = this.lastBoard && open.includes(this.lastBoard) ? this.lastBoard : open[0];
    if (!view) {
      new Notice('Tabletop: open a map in 3D first, then click a prop to put it on the board.');
      return;
    }
    void this.app.workspace.revealLeaf(view.leaf);
    view.placeProp(glb);
    new Notice('Tabletop: click the board where the prop goes (Esc to cancel).');
  }

  /** A material clicked in the gallery: the 3D board used last paints walls with it on click. */
  private paintWith(material: string): void {
    const open = this.boards();
    const view = this.lastBoard && open.includes(this.lastBoard) ? this.lastBoard : open[0];
    if (!view) {
      new Notice('Tabletop: open a map in 3D first, then click a material to paint its walls.');
      return;
    }
    void this.app.workspace.revealLeaf(view.leaf);
    view.paintWith(material);
    new Notice(`Tabletop: click walls or doors to paint them with ${material.split('/').pop()}. Shift-click paints the whole wall. Esc stops.`, 6000);
  }

  private async processFile(path: string, edit: (text: string) => string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`the map ${path} is missing`);
    await this.app.vault.process(file, edit);
  }
}

/** The map a board or player tab shows, from its saved state: a tab Obsidian restored but has not shown holds no view to ask. */
function fileOf(leaf: WorkspaceLeaf): string | null {
  const file = (leaf.getViewState().state as { file?: unknown } | undefined)?.file;
  return typeof file === 'string' ? file : null;
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
      .addText((text) => text.setPlaceholder(DEFAULT_MINIS_FOLDER).setValue(this.plugin.settings.folder).onChange((value) => { void this.plugin.setFolder('folder', value); }));
    new Setting(containerEl)
      .setName('Props folder')
      .setDesc('Where imported GLB props (furniture, scenery) are kept. GLB files put in this folder by hand are listed too.')
      .addText((text) => text.setPlaceholder(DEFAULT_PROPS_FOLDER).setValue(this.plugin.settings.propsFolder).onChange((value) => { void this.plugin.setFolder('propsFolder', value); }));
    new Setting(containerEl)
      .setName('Materials folder')
      .setDesc('Where imported materials (Poly Haven texture sets) are kept, one folder each. Drag one from the gallery onto a wall or door on a 3D board to paint it.')
      .addText((text) => text.setPlaceholder(DEFAULT_MATERIALS_FOLDER).setValue(this.plugin.settings.materialsFolder).onChange((value) => { void this.plugin.setFolder('materialsFolder', value); }));
    new Setting(containerEl)
      .setName('3D board quality')
      .setDesc('Low draws fastest (no antialiasing, soft blob shadows). Medium is sharper. High gives minis their real shadows and draws at full resolution. On all of them the resolution drops a little while the board cannot keep up.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ low: 'Low', medium: 'Medium', high: 'High' })
        .setValue(this.plugin.settings.quality)
        .onChange((value) => { void this.plugin.setQuality(readQuality(value)); }));
    void this.graphicsCard(containerEl);
  }

  /**
   * Windows only: which graphics card Obsidian draws on. Saving writes Windows' own per-app setting for Obsidian; it
   * takes effect when the GM restarts Obsidian, which Tabletop leaves to them.
   */
  private async graphicsCard(containerEl: HTMLElement): Promise<void> {
    const gpu = GpuSettings.here();
    if (!gpu) return;
    new Setting(containerEl).setName('Graphics card').setHeading();
    const status = new Setting(containerEl).setName('Checking the graphics cards…');
    let adapters;
    let saved: GpuPreference;
    try {
      [adapters, saved] = await Promise.all([gpu.adapters(), gpu.preference()]);
    } catch (error) {
      status.setName('Cannot read the graphics cards').setDesc(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!containerEl.isConnected) return;
    const now = currentChip(containerEl.ownerDocument);
    const choices = gpuChoices(adapters);
    if (!choices) {
      status.setName('Only one graphics card').setDesc(`Obsidian draws on ${now ?? adapters[0]?.name ?? 'the only card'}: there is no other to choose.`);
      return;
    }
    const cardFor = { 2: choices.performance, 1: choices.power, 0: null } as const;
    // Word keys keep this order: an object lists number keys smallest first.
    const keys: Record<GpuPreference, string> = { 2: 'performance', 1: 'power', 0: 'windows' };
    const options: Record<string, string> = {
      performance: `High performance: ${choices.performance} (recommended)`,
      power: `Power saving: ${choices.power}`,
      windows: 'Let Windows decide',
    };
    const preferenceOf = (key: string): GpuPreference => (key === 'performance' ? 2 : key === 'power' ? 1 : 0);
    const same = (a: string, b: string): boolean => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
    /** Which card is in use, and, in red, what the GM has to do: restart for a saved change, or pick the fast card. */
    const describe = (): { using: string; warning: string } => {
      const using = now ? `Obsidian is drawing on ${now} now.` : '';
      const wanted = cardFor[saved];
      if (wanted && now && !same(now, wanted)) return { using, warning: `Restart Obsidian to switch to ${wanted}.` };
      if (now && same(now, choices.power) && saved !== 2) return { using, warning: `This is the slower built-in chip: choose ${choices.performance} and save for a faster 3D board.` };
      return { using, warning: '' };
    };
    const show = (): void => {
      const { using, warning } = describe();
      note.setText(using);
      alert.setText(warning);
      alert.toggle(warning !== '');
    };
    // The card names are long: the choice gets its own row under the text.
    status.settingEl.addClass('atlas-tabletop-gpu-setting');
    status.setName('Card Obsidian draws on')
      .setDesc('The 3D board runs much faster on a dedicated graphics card. This is the same setting as Windows Settings → System → Display → Graphics, for Obsidian; it takes effect after you restart Obsidian.');
    const note = status.descEl.createDiv({ cls: 'atlas-tabletop-gpu-status' });
    const alert = status.descEl.createDiv({ cls: 'atlas-tabletop-gpu-alert' });
    show();
    let chosen: GpuPreference = saved;
    status.addDropdown((dropdown) => dropdown.addOptions(options).setValue(keys[saved]).onChange((value) => {
      chosen = preferenceOf(value);
      save.setDisabled(chosen === saved);
    }));
    let save!: ButtonComponent;
    status.addButton((button) => {
      save = button.setButtonText('Save').setCta().setDisabled(true).onClick(async () => {
        save.setDisabled(true);
        try {
          await gpu.save(chosen);
          saved = chosen;
          show();
          const card = cardFor[chosen];
          new Notice(card ? `Tabletop: saved. Restart Obsidian to draw on ${card}.` : 'Tabletop: saved. Restart Obsidian to let Windows choose the card.', 10000);
        } catch (error) {
          new Notice(`Tabletop: the graphics card setting was not saved: ${error instanceof Error ? error.message : String(error)}`, 10000);
          save.setDisabled(chosen === saved);
        }
      });
    });
  }
}
