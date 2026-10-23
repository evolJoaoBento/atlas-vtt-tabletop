import { Notice, Plugin, PluginSettingTab, Setting, TFile, debounce, type App, type ButtonComponent, type SettingDefinitionItem, type SettingDefinitionRender, type WorkspaceLeaf } from 'obsidian';
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
import type { BoardLook, BoardSession, GmCameraSource } from './src/connectContract';
import { DEFAULT_PACK, defaultPackFiles, releaseDefaultPackSheets } from './src/dice/defaultPack';
import { choosePack, vendoredPack, type ChosenPack } from './src/dice/dicePack';
import { colorsText, DEFAULT_DICE_SETTINGS, DIE_SQUARES, MOTION_THRESHOLD, readColorsText, readDiceSettings, TOLERANCE, type TabletopDiceSettings } from './src/dice/diceSettings';
import { ensureDefaultPack, listPacks, packsFolder, type PackFs } from './src/dice/kit/packs';

export const API_READY_EVENT = 'tabletop-for-atlas:api-ready';
export const API_UNLOAD_EVENT = 'tabletop-for-atlas:api-unload';
/** The names they had before "Tabletop for Atlas VTT" took a new id: still announced, for a Connect that knows only those. */
const OLD_API_READY_EVENT = 'atlas-vtt-tabletop:api-ready';
const OLD_API_UNLOAD_EVENT = 'atlas-vtt-tabletop:api-unload';

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
  /** The GM's dice on the board. */
  dice: TabletopDiceSettings;
}

const DEFAULT_SETTINGS: TabletopSettings = { folder: DEFAULT_MINIS_FOLDER, propsFolder: DEFAULT_PROPS_FOLDER, materialsFolder: DEFAULT_MATERIALS_FOLDER, quality: DEFAULT_QUALITY, dice: DEFAULT_DICE_SETTINGS };

interface SavedData {
  settings?: Partial<TabletopSettings>;
  assignments?: AssignmentData;
  board?: BoardDataJSON;
}

const isMapPath = (path: string): boolean => path.toLowerCase().endsWith('.atlasmap');

/**
 * What other plugins (Connect for Atlas VTT) read of Tabletop: `app.plugins.plugins['tabletop-for-atlas'].api`, announced
 * with the workspace event `tabletop-for-atlas:api-ready` and withdrawn with `tabletop-for-atlas:api-unload`.
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
  /** The 3D boards open now: their map and their root, whose toolbar has Atlas's end slot for Connect's buttons. */
  boardViews(): Array<{ key: string; mapPath: string; root: HTMLElement }>;
  /** Connect hands over its hosted session: the boards show its templates, marks and handout. Returns the release. */
  attachSession(session: BoardSession): () => void;
}

/** A key for each board tab, kept as long as the tab is. */
const boardKeys = new WeakMap<object, number>();
let nextBoardKey = 1;
function boardKey(board: object): number {
  let key = boardKeys.get(board);
  if (key === undefined) {
    key = nextBoardKey++;
    boardKeys.set(board, key);
  }
  return key;
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
  /** Connect's hosted session, while it hands one over. */
  private session: BoardSession | null = null;
  library!: MiniLibrary;
  props!: MiniLibrary;
  materials!: MaterialLibrary;
  api: TabletopApi | null = null;
  private players: ReturnType<typeof playerMiniPainter> | null = null;
  /** The 3D board used last: props from the gallery go to it. */
  private lastBoard: BoardView | null = null;
  /** The pack the dice are made from: the default pack Tabletop carries until the chosen one is read. */
  private dicePack: ChosenPack | null = null;
  private readonly save = debounce(() => {
    void this.saveData({ settings: this.settings, assignments: this.assignments.toJSON(), board: this.boardData.toJSON() } satisfies SavedData);
  }, 500, true);

  async onload(): Promise<void> {
    const saved = ((await this.loadData()) ?? {}) as SavedData;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved.settings ?? {}) };
    this.settings.quality = readQuality(this.settings.quality);
    this.settings.dice = readDiceSettings(saved.settings?.dice);
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
      session: () => this.session,
      diceSettings: () => this.settings.dice,
      dicePack: () => (this.dicePack ??= vendoredPack()),
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

    this.app.workspace.onLayoutReady(() => { this.library.emit(); this.props.emit(); void this.loadDicePack(); });

    this.materialIndex = new MaterialIndex(this.app.vault, () => this.boardChanged(null));
    this.register(this.boardData.onChange((mapPath) => this.boardChanged(mapPath)));
    this.register(this.materials.onChange(() => { this.materialIndex?.forgetAll(); this.boardChanged(null); }));
    this.players = playerMiniPainter();
    this.api = Object.freeze({
      version: 1 as const,
      playerMinis: this.players.painter,
      playerBoard: playerBoardFactory(() => this.settings.quality, { settings: () => this.settings.dice, pack: () => (this.dicePack ??= vendoredPack()) }),
      attachSession: (session: BoardSession) => this.attachSession(session),
      boardViews: () => this.boards().flatMap((board) => (board.mapPath ? [{ key: `tabletop:${boardKey(board)}`, mapPath: board.mapPath, root: board.contentEl }] : [])),
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
    this.app.workspace.trigger(OLD_API_READY_EVENT, this.api);
  }

  onunload(): void {
    this.app.workspace.trigger(API_UNLOAD_EVENT);
    this.app.workspace.trigger(OLD_API_UNLOAD_EVENT);
    this.api = null;
    // Connect lets go of a painter that is gone on its next frame; its views are freed here at once.
    this.players?.dispose();
    this.players = null;
    // The boards closed with the plugin; the default sheets' URLs go with them.
    releaseDefaultPackSheets();
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

  /** The shared packs folder, beside the vault's config: both dice plugins read their packs there. */
  get packsFolder(): string {
    return packsFolder(this.app.vault.configDir);
  }

  get packFs(): PackFs {
    return this.app.vault.adapter;
  }

  /**
   * Writes the default pack into the shared folder when it is missing, then reads the chosen pack (the default pack
   * Tabletop carries when it cannot be read). The boards make their next dice from it.
   */
  async loadDicePack(): Promise<void> {
    const folder = this.packsFolder;
    try {
      await ensureDefaultPack(this.packFs, folder, defaultPackFiles());
    } catch (error) {
      console.warn('[Tabletop] Cannot write the default dice pack into the shared packs folder:', error);
    }
    const name = this.settings.dice.pack;
    const pack = await choosePack(this.packFs, folder, name);
    if (name !== this.settings.dice.pack) return;
    this.dicePack = pack;
    for (const view of this.boards()) view.diceChanged();
  }

  /** A dice setting changed: saved, and the boards' next dice follow it (a new pack is read first). */
  setDice(changes: Partial<TabletopDiceSettings>): void {
    const packChanged = changes.pack !== undefined && changes.pack !== this.settings.dice.pack;
    this.settings.dice = { ...this.settings.dice, ...changes };
    this.save();
    if (packChanged) void this.loadDicePack();
    // The colours are only the picker's: the dice on the table stay.
    else if (Object.keys(changes).some((key) => key !== 'colors')) for (const view of this.boards()) view.diceChanged();
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

  /** Connect's session reaches every board: its templates, handout and banner now, its pings and lasers as they come. */
  private attachSession(session: BoardSession): () => void {
    const stops = [
      session.onChange(() => { for (const board of this.boards()) board.sessionChanged(); }),
      session.onMark((mark) => { for (const board of this.boards()) board.mark(mark); }),
    ];
    this.session = session;
    for (const board of this.boards()) board.sessionChanged();
    return () => {
      for (const stop of stops) stop();
      if (this.session !== session) return;
      this.session = null;
      for (const board of this.boards()) board.sessionChanged();
    };
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

/** A settings row both drawn by display() and handed to Obsidian 1.13's settings search. */
interface SettingRow extends SettingDefinitionRender {
  draw(setting: Setting): void;
}

class TabletopSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TabletopPlugin) {
    super(app, plugin);
  }

  /** Obsidian 1.13 and later read the settings from here (and search them); earlier versions draw display(). */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [...this.generalRows(), { type: 'group', heading: 'Dice', items: this.diceRows() }];
    if (GpuSettings.here()) items.push({ type: 'group', heading: 'Graphics card', items: [this.graphicsRow()] });
    return items;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const draw = (rows: SettingRow[]): void => { for (const row of rows) row.draw(new Setting(containerEl)); };
    draw(this.generalRows());
    new Setting(containerEl).setName('Dice').setHeading();
    draw(this.diceRows());
    if (GpuSettings.here()) {
      new Setting(containerEl).setName('Graphics card').setHeading();
      draw([this.graphicsRow()]);
    }
  }

  /** A settings row drawn imperatively: named and described here, so a search finds it before it is drawn. */
  private row(name: string, desc: string, build: (setting: Setting) => void, aliases: string[] = []): SettingRow {
    const draw = (setting: Setting): void => { setting.setName(name).setDesc(desc); build(setting); };
    return { name, desc, aliases, draw, render: draw };
  }

  private generalRows(): SettingRow[] {
    const { plugin } = this;
    const folder = (name: string, desc: string, key: 'folder' | 'propsFolder' | 'materialsFolder', fallback: string): SettingRow => this.row(name, desc, (setting) => {
      setting.addText((text) => text.setPlaceholder(fallback).setValue(plugin.settings[key]).onChange((value) => { void plugin.setFolder(key, value); }));
    });
    return [
      folder('Minis folder', 'Where imported GLB minis are kept. GLB files put in this folder by hand are listed too.', 'folder', DEFAULT_MINIS_FOLDER),
      folder('Props folder', 'Where imported GLB props (furniture, scenery) are kept. GLB files put in this folder by hand are listed too.', 'propsFolder', DEFAULT_PROPS_FOLDER),
      folder('Materials folder', 'Where imported materials (Poly Haven texture sets) are kept, one folder each. Drag one from the gallery onto a wall or door on a 3D board to paint it.', 'materialsFolder', DEFAULT_MATERIALS_FOLDER),
      this.row('3D board quality', 'Low draws fastest (no antialiasing, soft blob shadows). Medium is sharper. High gives minis their real shadows and draws at full resolution. On all of them the resolution drops a little while the board cannot keep up.', (setting) => {
        setting.addDropdown((dropdown) => dropdown
          .addOptions({ low: 'Low', medium: 'Medium', high: 'High' })
          .setValue(plugin.settings.quality)
          .onChange((value) => { void plugin.setQuality(readQuality(value)); }));
      }),
    ];
  }

  /** The GM's dice: their size, pack, shadows, the highlight of a die caught on an edge, how they are read, their colours. */
  private diceRows(): SettingRow[] {
    const { plugin } = this;
    const number = (name: string, desc: string, key: 'dieSquares' | 'tolerance' | 'motionThreshold', bounds: { min: number; max: number }): SettingRow => this.row(name, `${desc} (${bounds.min} to ${bounds.max}; default ${DEFAULT_DICE_SETTINGS[key]}).`, (setting) => {
      setting.addText((text) => {
        text.setPlaceholder(String(DEFAULT_DICE_SETTINGS[key])).setValue(String(plugin.settings.dice[key]));
        // Taken when the field is left (or Enter), not at each keystroke: a change clears the dice on the boards.
        text.inputEl.addEventListener('change', () => {
          const value = text.getValue();
          const read = Number(value.trim().replace(',', '.'));
          const ok = value.trim() !== '' && Number.isFinite(read) && read >= bounds.min && read <= bounds.max;
          text.inputEl.toggleClass('atlas-tabletop-invalid', !ok);
          if (ok && read !== plugin.settings.dice[key]) plugin.setDice({ [key]: read });
        });
      });
    });
    const pack = this.row('Dice pack', `The texture pack the dice wear, from the shared packs folder (${plugin.packsFolder}), which Interactive Dice for Atlas VTT reads too.`, (setting) => { void this.packChoice(setting); });
    return [
      number('Die size', 'How big a die is on the 3D board, in grid squares', 'dieSquares', DIE_SQUARES),
      pack,
      this.row('Shadows', 'Dice cast shadows on the board.', (setting) => {
        setting.addToggle((toggle) => toggle.setValue(plugin.settings.dice.shadows).onChange((value) => plugin.setDice({ shadows: value })));
      }),
      this.row('Highlight caught dice', 'A die that lands caught on an edge, with no face up, is lit in this colour until it is thrown again.', (setting) => {
        const dice = plugin.settings.dice;
        setting
          .addToggle((toggle) => toggle.setValue(dice.highlight).onChange((value) => plugin.setDice({ highlight: value })))
          .addColorPicker((picker) => picker.setValue(dice.highlightColor).onChange((value) => plugin.setDice({ highlightColor: value })));
      }),
      number('Face detection tolerance', 'How far from flat a die may rest and still be read; a die tilted more is caught', 'tolerance', TOLERANCE),
      number('Motion threshold', 'Higher waits for stiller dice before reading them', 'motionThreshold', MOTION_THRESHOLD),
      this.row('Dice colours', "The colours a die can be thrown in (right-click a die in the board's dice picker), one a line: a name, then the colour as #rrggbb. The name shows in Atlas's roll log.", (setting) => {
        setting.addTextArea((area) => {
          area.setValue(colorsText(plugin.settings.dice.colors)).onChange((value) => plugin.setDice({ colors: readColorsText(value) }));
          area.inputEl.rows = 6;
        });
      }),
    ];
  }

  /** The dice pack dropdown: the packs are listed from disk, so it is added once they are known. */
  private async packChoice(pack: Setting): Promise<void> {
    const { plugin } = this;
    let packs: string[] = [];
    try {
      packs = await listPacks(plugin.packFs, plugin.packsFolder);
    } catch (error) {
      console.warn('[Tabletop] Cannot list the dice packs:', error);
    }
    if (!pack.settingEl.isConnected) return;
    // The pack chosen, and the default pack, are offered even when the folder cannot be listed.
    const names = [...new Set([plugin.settings.dice.pack, DEFAULT_PACK, ...packs])].sort();
    pack.addDropdown((dropdown) => dropdown
      .addOptions(Object.fromEntries(names.map((name) => [name, name])))
      .setValue(plugin.settings.dice.pack)
      .onChange((value) => plugin.setDice({ pack: value })));
  }

  /**
   * Windows only: which graphics card Obsidian draws on. Saving writes Windows' own per-app setting for Obsidian; it
   * takes effect when the GM restarts Obsidian, which Tabletop leaves to them.
   */
  private graphicsRow(): SettingRow {
    return this.row('Card Obsidian draws on', 'The 3D board runs much faster on a dedicated graphics card. This is the same setting as Windows Settings → System → Display → Graphics, for Obsidian; it takes effect after you restart Obsidian.', (status) => { void this.graphicsCard(status); }, ['graphics card', 'gpu']);
  }

  private async graphicsCard(status: Setting): Promise<void> {
    const gpu = GpuSettings.here();
    if (!gpu) return;
    const containerEl = status.settingEl;
    status.setName('Checking the graphics cards…').setDesc('');
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
