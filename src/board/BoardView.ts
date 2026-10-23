/**
 * The 3D board's tab: an Atlas map (`.atlasmap`) opened in 3D. It reads the map, follows the file as it changes (Atlas
 * saving it, a sync tool), follows a rename and closes when the map is deleted. What the board asks of Obsidian (images,
 * GLBs, the minis and props kept by Tabletop, saving a token's move or resources, opening a note, the token menu with
 * Atlas's Kill and Delete) goes through the plugin's `BoardServices`. Atlas's initiative tracker stands at the board's
 * right edge (`initiativePanel.ts`): it shows the tracker Atlas holds while Atlas has the map open, following its
 * store as it changes, else the one in the file.
 */
import type { BoardMark, BoardSession } from '../connectContract';
import { ItemView, Menu, Notice, TFile, debounce, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { presentedSceneOf, tabViewOf, type AtlasView } from '../atlas';
import { SceneTabBar } from './sceneTabBar';
import type { Assignments } from '../assignments';
import { MiniPicker } from '../gallery';
import type { LoadedMini, MiniLibrary } from '../library';
import type { MaterialLibrary } from '../materials';
import { Board, type BoardHost } from './board';
import type { BoardData } from './boardData';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './conditions';
import { readMap, type BoardMap, type BoardToken } from './mapModel';
import { readMeasurement } from './measure';
import { defeatedResources, isDefeated, tokenFromFile } from './resources';
import { AtlasMenu, type MenuEntry } from './atlasMenu';
import { tokenMenuEntries } from './tokenMenu';
import { addToInitiative, conditionChange, conditionStep, initiativeEntryFor, initiativeId, removeFromInitiative, resetChange, type ConditionFields } from './tokenEdits';
import { applyInitiative, emptyInitiative, fileCannotRun, ownModifier, readInitiative, statblockModifier, type InitiativeAction, type InitiativeState } from './initiative';
import { InitiativePanel, type InitiativePanelHost } from './initiativePanel';
import { wholeWall } from './walls';
import type { TokenChange } from './tokenWriter';
import type { LaserSettings } from './laser';
import type { PlayerView } from './PlayerWindow';
import { QUALITY, type Quality, type QualityPreset } from './quality';
import type { TokenWriter } from './tokenWriter';
import { BoardDice } from '../dice/boardDice';
import { buildSheet, type PlayerSheet } from '../sheets/sheet';
import { statblockFields, statblockOf } from '../sheets/statblock';
import { rollViewFor, type MapViewLike } from '../dice/atlasDice';
import type { ChosenPack } from '../dice/dicePack';
import type { TabletopDiceSettings } from '../dice/diceSettings';

export const BOARD_VIEW_TYPE = 'atlas-tabletop-board';
/** The hover source Tabletop registers, so Obsidian's page preview shows stat blocks from the board. */
export const HOVER_SOURCE = 'tabletop-for-atlas';
const RELOAD_MS = 300;
/** A light hangs a square above the map until the GM sets its height; the menu steps it a quarter square. */
const DEFAULT_LIGHT_SQUARES = 1;
const HEIGHT_STEP = 0.25;

/** What the board's tab uses of the plugin. */
export interface BoardServices {
  assignments: Assignments;
  boardData: BoardData;
  minis: MiniLibrary;
  props: MiniLibrary;
  materials: MaterialLibrary;
  writer: TokenWriter;
  /** The quality setting the board draws with. */
  quality(): Quality;
  /** The laser's colour and size, kept for every map; and saving a change. */
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** This tab was used last: props from the gallery go to it. */
  focused(view: BoardView): void;
  /** The local player view: open, switch to or close it for this board's map; whether one shows its map. */
  togglePlayerView(view: BoardView): void;
  playerViewOpen(path: string): boolean;
  /** This board has drawn its map: a player view of that map can be drawn into. */
  boardReady(view: BoardView): void;
  /** The GM's camera or the players' moved on this board. */
  cameraMoved?(view: BoardView): void;
  /** Connect's hosted session, while Connect hands one over. */
  session?(): BoardSession | null;
  /** The dice settings, and the pack the dice are made from (the default pack Tabletop carries until it is read). */
  diceSettings(): TabletopDiceSettings;
  dicePack(): ChosenPack;
}

const tokenName = (token: BoardToken): string => token.name ?? token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Token';

export class BoardView extends ItemView {
  private path: string | null = null;
  private board: Board | null = null;
  /** The GM's dice on the board: its picker, table and roll. */
  private dice: BoardDice | null = null;
  private map: BoardMap | null = null;
  private rules: CollectionRules = emptyRules();
  private readonly warned = new Set<string>();
  /** Closed: a read still on its way must not build a board on a tab that is gone. */
  private closed = false;
  private readonly reload = debounce(() => { void this.read(); }, RELOAD_MS, true);
  /** The local player view this board draws into. */
  private playerWindow: PlayerView | null = null;
  /** The token menu while it is open: it follows the map as it changes. */
  private menu: AtlasMenu | null = null;
  /** Atlas's initiative tracker on the board. */
  private initiative: InitiativePanel | null = null;
  /** The Atlas view holding this map, whose store is followed so its tracker shows each change at once. */
  private watched: { view: AtlasView; stop: () => void } | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly services: BoardServices) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string { return BOARD_VIEW_TYPE; }
  getIcon(): string { return 'cuboid'; }
  getDisplayText(): string {
    return this.path ? `3D: ${this.path.split('/').pop()!.replace(/\.atlasmap$/, '')}` : '3D board';
  }

  get mapPath(): string | null {
    return this.path;
  }

  getState(): Record<string, unknown> {
    return { file: this.path };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const file = (state as { file?: unknown } | null)?.file;
    if (typeof file === 'string' && file !== this.path) {
      this.path = file;
      this.map = null;
      this.dropBoard();
      // The player view shows the map this tab showed: it waits for that map's board again.
      this.playerWindow?.waiting(true);
      this.playerWindow = null;
      this.retitle();
      await this.read();
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('atlas-tabletop-board-view');
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file.path === this.path) this.reload();
      else if (file.path === ASSETS_METADATA_PATH) this.reload();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (oldPath !== this.path) return;
      this.path = file.path;
      this.retitle();
      this.reload();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file.path === this.path) this.leaf.detach(); }));
    this.registerDomEvent(this.contentEl, 'pointerdown', () => this.services.focused(this), true);
    this.initiative = new InitiativePanel(this.contentEl, this.initiativeHost());
    // Atlas's scene tabs over the board: switch scenes here, and present one with its eye, as in Atlas.
    this.sceneTabs = new SceneTabBar(this.contentEl, {
      tabs: () => this.sceneTabEntries(),
      switchTab: (id) => { void this.switchScene(id); },
      presentTab: (id) => { void this.presentScene(id); },
      closeTab: (id) => {
        const found = this.path ? tabViewOf(this.app, this.path) : null;
        if (found?.view.closeTab) void found.view.closeTab(id);
      },
      addTab: () => {
        const found = this.path ? tabViewOf(this.app, this.path) : null;
        if (found?.view.openSceneBrowser) found.view.openSceneBrowser();
        else new Notice('Tabletop: open another scene in Atlas.');
      },
    });
    const presented = presentedSceneOf(this.app);
    if (presented) this.register(presented.onChange(() => this.sceneTabs?.refresh()));
    // Atlas's keys for its tracker, taken before the board's (whose arrows move the camera).
    this.registerDomEvent(this.contentEl, 'keydown', (event) => this.initiativeKey(event), { capture: true });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.watchAtlas()));
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.stopTabs?.();
    this.stopTabs = null;
    this.sceneTabs?.dispose();
    this.sceneTabs = null;
    this.menu?.close();
    this.watched?.stop();
    this.watched = null;
    this.initiative?.dispose();
    this.initiative = null;
    this.reload.cancel();
    this.dropBoard();
    this.playerWindow?.waiting(true);
    this.playerWindow = null;
  }

  /** Whether this board has drawn its map, and so can draw a player view of it. */
  get ready(): boolean {
    return this.board !== null && this.map !== null;
  }

  /** The GM's camera on this board, and its players' window's (null without one); null while no board is drawn. */
  cameraPose(): ReturnType<Board['cameraPose']> | null {
    return this.board?.cameraPose() ?? null;
  }

  playerPose(): ReturnType<Board['playerPose']> {
    return this.board?.playerPose() ?? null;
  }

  /** Draws this board into the local player view too. */
  showPlayer(view: PlayerView): void {
    if (this.playerWindow === view) return;
    this.playerWindow = view;
    view.waiting(false);
    this.board?.attachPlayer(view.stage);
  }

  /** Stops drawing into the local player view (it closed, or shows another map). */
  hidePlayer(view: PlayerView): void {
    if (this.playerWindow !== view) return;
    this.playerWindow = null;
    this.board?.detachPlayer();
  }

  /** The player view opened or closed: the toolbar's buttons follow. */
  refreshToolbar(): void {
    this.board?.refreshToolbar();
  }

  /** Shows the map's name on the tab and in the view's header (Obsidian refreshes only the tab by itself). */
  private retitle(): void {
    (this.leaf as unknown as { updateHeader?(): void }).updateHeader?.();
    (this as unknown as { titleEl?: HTMLElement }).titleEl?.setText(this.getDisplayText());
  }

  /** The quality setting changed. A change of antialiasing needs a new board; the camera stays where it was. */
  async applyQuality(): Promise<void> {
    const board = this.board;
    if (!board || !this.map) return;
    const preset = QUALITY[this.services.quality()];
    if (board.setQuality(preset)) return;
    const camera = board.camera;
    this.dropBoard();
    const fresh = this.makeBoard(preset);
    await fresh.load(this.map);
    fresh.camera = camera;
    if (this.playerWindow) fresh.attachPlayer(this.playerWindow.stage);
    fresh.wake(true);
  }

  /** A board, and the GM's dice on it. */
  private makeBoard(preset: QualityPreset): Board {
    const board = new Board(this.contentEl, this.host(), preset);
    this.board = board;
    this.dice = new BoardDice({
      board,
      container: this.contentEl,
      mapPath: () => this.path ?? '',
      atlasView: () => this.rollView(),
      settings: () => this.services.diceSettings(),
      pack: () => this.services.dicePack(),
      warn: (message) => this.warn(message),
      sheetOf: (tokenId) => this.sheetOf(tokenId),
    });
    return board;
  }

  /** The sheet of a token's stat block, named as the token when the stat block has no name. */
  private async sheetOf(tokenId: string): Promise<PlayerSheet | null> {
    const token = this.map?.tokens.find((candidate) => candidate.id === tokenId);
    if (!token?.statblockPath) return null;
    return buildSheet(await statblockOf(this.app, token), token.name);
  }

  /** The board goes (another map, new quality, the tab closing): its dice first, the roll in play never logged. */
  private dropBoard(): void {
    this.dice?.sceneChanged();
    this.dice?.dispose();
    this.dice = null;
    this.board?.dispose();
    this.board = null;
  }

  /** The Atlas map view a roll on this board's map is logged on: the one showing it, else the one used last. */
  private rollView(): MapViewLike | null {
    const views = this.app.workspace.getLeavesOfType('atlas-vtt').map((leaf) => leaf.view as unknown as MapViewLike);
    const recent = (this.app.workspace.getMostRecentLeaf()?.view ?? null) as unknown as MapViewLike | null;
    return this.path ? rollViewFor(views, recent, this.path) : null;
  }

  /** The dice settings or pack changed: the next roll uses them. */
  diceChanged(): void {
    this.dice?.reset();
  }

  /** The minis, styles or props changed: the board draws them again. */
  refresh(): void {
    this.board?.refresh();
  }

  /** The next click on the board puts a prop of `glb` there. */
  /** A material's files changed: walls painted with it are drawn again. */
  refreshMaterials(): void {
    this.board?.refreshMaterials();
  }

  /** Paints walls with a material on click, until Esc. */
  paintWith(material: string): void {
    this.board?.paintWith(material);
  }

  placeProp(glb: string): void {
    this.board?.placeProp(glb);
  }

  private async read(): Promise<void> {
    const path = this.path;
    if (!path) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.warn(`Tabletop: the map ${path} is missing.`);
      return;
    }
    let map: BoardMap;
    try {
      const text = await this.app.vault.read(file);
      if (this.closed) return;
      map = readMap(path, text);
    } catch (error) {
      this.warn(`Tabletop: cannot open ${path} in 3D: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }
    const rules = await this.readRules(path);
    if (this.closed || path !== this.path) return;
    this.rules = rules;
    this.map = map;
    const fresh = !this.board;
    const board = this.board ?? this.makeBoard(QUALITY[this.services.quality()]);
    await board.load(map);
    this.menu?.refresh();
    this.watchAtlas();
    // The tracker shows when the map has combatants; the I key or the board settings show or hide it.
    if (fresh) this.initiative?.setOpen(this.liveInitiative().entries.length > 0);
    this.initiative?.render();
    this.sessionChanged();
    if (fresh && !this.closed) this.services.boardReady(this);
  }

  /**
   * Connect's session as this board shows it: the map's templates, the handout shown to players, and, while Atlas does
   * not hold the map (so nothing done here reaches players), a banner that opens it in Atlas.
   */
  sessionChanged(): void {
    const board = this.board;
    const path = this.path;
    if (!board || !path) return;
    const session = this.services.session?.() ?? null;
    if (!session?.hosting()) {
      board.receiveTemplates([]);
      board.setHandout(null);
      board.setBanner(null);
      board.refreshToolbar();
      return;
    }
    const overlay = session.overlay(path);
    board.tools.coneAngle = overlay.coneAngle;
    board.receiveTemplates(overlay.templates);
    const handout = overlay.handout;
    const file = handout ? this.app.vault.getAbstractFileByPath(handout.path) : null;
    board.setHandout(handout ? { title: handout.title, url: file instanceof TFile ? this.app.vault.getResourcePath(file) : null } : null);
    const held = this.services.writer.holder(path) !== null;
    board.setBanner(held ? null : {
      text: "Players don't see changes made here: open this map in Atlas.",
      action: { label: 'Open in Atlas', run: () => { void this.openInAtlas(); } },
    });
    board.refreshToolbar();
  }

  /** Someone's ping or laser on this board's map. */
  mark(mark: BoardMark): void {
    if (!this.board || mark.mapPath !== this.path) return;
    if (mark.kind === 'ping') this.board.receivePing(mark.x, mark.y, mark.color);
    else this.board.receiveLaser(mark.from, mark.points, mark.lifted, mark.color);
  }

  /** Opens this board's map in an Atlas tab beside it, leaving the board in front. */
  private async openInAtlas(): Promise<void> {
    const file = this.path ? this.app.vault.getAbstractFileByPath(this.path) : null;
    if (!(file instanceof TFile)) return;
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: false });
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    this.watchAtlas();
    this.sessionChanged();
  }

  /** The map's conditions and resource names, from Atlas's asset index (in a hidden folder, read off the disk). */
  private async readRules(path: string): Promise<CollectionRules> {
    const collection = collectionOf(path);
    if (!collection) return emptyRules();
    try {
      return readCollectionRules(JSON.parse(await this.app.vault.adapter.read(ASSETS_METADATA_PATH)), collection);
    } catch {
      return emptyRules(true);
    }
  }

  /** A change the board showed could not be saved: say so, and show the map as it is. */
  private unsaved(what: string, error: unknown): void {
    new Notice(`Tabletop: the ${what} was not saved: ${error instanceof Error ? error.message : String(error)}`, 8000);
    this.reload();
  }

  private warn(message: string): void {
    if (this.warned.has(message)) return;
    this.warned.add(message);
    new Notice(message, 8000);
  }

  private library(path: string): MiniLibrary {
    const { props } = this.services;
    return path.startsWith(`${props.folderPath}/`) ? props : this.services.minis;
  }

  private host(): BoardHost {
    const { assignments, boardData, writer } = this.services;
    const mapPath = (): string => this.path ?? '';
    return {
      readImage: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
      },
      readMini: (path): Promise<LoadedMini> => this.library(path).load(path),
      placement: (id) => assignments.get(mapPath(), id),
      style: (id) => boardData.style(mapPath(), id),
      props: () => boardData.props(mapPath()),
      rules: () => this.rules,
      moveToken: (id, x, y) => {
        writer.move(mapPath(), id, x, y).catch((error: unknown) => this.unsaved('move', error));
      },
      moveProp: (id, x, y) => boardData.moveProp(mapPath(), id, x, y),
      addProp: (glb, x, y) => { boardData.addProp(mapPath(), { glb, x, y, rotation: 0, scale: 1 }); },
      openNote: (path) => { void this.app.workspace.openLinkText(path, mapPath(), 'tab'); },
      tokenMenu: (id, event) => this.tokenMenu(id, event),
      propMenu: (id, event) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle('Remove prop').setIcon('trash').onClick(() => boardData.removeProp(mapPath(), id)));
        menu.showAtMouseEvent(event);
      },
      copyToken: (id, newId, x, y) => {
        writer.copy(mapPath(), id, newId, x, y).catch((error: unknown) => this.unsaved('copy', error));
      },
      editResource: (id, key, edit, maxEdited) => {
        const name = this.rules.definitions.find((definition) => definition.key === key)?.name ?? key;
        writer.resource(mapPath(), id, key, edit, maxEdited).catch((error: unknown) => this.unsaved(`${name} change`, error));
      },
      measurement: () => readMeasurement(this.rules.gridDefaults, this.map?.rawGrid),
      fogHeight: () => boardData.fogHeight(mapPath()),
      // Saved with Tabletop's data; the board follows through `refresh`, as for a style change.
      setFogHeight: (height) => boardData.setFogHeight(mapPath(), height),
      wallThickness: () => boardData.wallThickness(mapPath()),
      setWallThickness: (thickness) => boardData.setWallThickness(mapPath(), thickness),
      statblockPreview: (id, event) => {
        const path = this.map?.tokens.find((token) => token.id === id)?.statblockPath;
        if (!path || !this.board) return;
        // Obsidian's page preview shows the note as it reads, the stat block drawn (Fantasy Statblocks) and its dice.
        this.app.workspace.trigger('hover-link', {
          event, source: HOVER_SOURCE, hoverParent: this, targetEl: this.board.canvas, linktext: path, sourcePath: mapPath(),
        });
      },
      warn: (message) => this.warn(message),
      togglePlayerView: () => this.services.togglePlayerView(this),
      laser: () => this.services.laser(),
      setLaser: (changes) => this.services.setLaser(changes),
      playerViewOpen: () => this.services.playerViewOpen(mapPath()),
      initiativeOpen: () => this.initiative?.isOpen ?? false,
      toggleInitiative: () => this.initiative?.setOpen(!this.initiative.isOpen),
      wallMaterial: (id) => boardData.wallMaterial(mapPath(), id),
      wallHeight: (id) => boardData.wallHeight(mapPath(), id),
      setWallHeight: (id, squares, whole) => boardData.setWallHeight(mapPath(), whole ? wholeWall(this.map?.walls ?? [], id) : [id], squares),
      setLightHeight: (id, squares) => boardData.setLightHeight(mapPath(), id, squares),
      doorProp: (id) => boardData.doorProp(mapPath(), id),
      readMaterial: (path) => this.services.materials.load(path).catch((error: unknown) => {
        this.warn(`Tabletop: cannot read the material ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }),
      toggleDoor: (id) => {
        const wall = this.map?.walls.find((candidate) => candidate.id === id);
        if (!wall) return;
        if (wall.locked) { new Notice('Tabletop: this door is locked. Right-click it to unlock it.'); return; }
        writer.toggleDoor(mapPath(), id).catch((error: unknown) => this.unsaved('door', error));
      },
      wallMenu: (id, event) => this.wallMenu(id, event),
      // Until the GM moves the slider, the board is as light as Atlas's scene (daylight when Atlas's lighting is off).
      ambient: () => boardData.ambient(mapPath()) ?? (this.map?.lighting.enabled ? this.map.lighting.ambient : 1),
      setAmbient: (level) => boardData.setAmbient(mapPath(), level),
      lightHeight: (light) => boardData.lightHeight(mapPath(), light.id) ?? DEFAULT_LIGHT_SQUARES,
      lightMenu: (id, event) => this.lightMenu(id, event),
      miniTurn: (tokenId) => assignments.get(mapPath(), tokenId)?.turn ?? null,
      setMiniTurn: (tokenId, turn) => {
        const have = assignments.get(mapPath(), tokenId);
        if (have) assignments.set(mapPath(), tokenId, { ...have, turn });
      },
      assignMini: (tokenId, glb) => {
        const have = assignments.get(mapPath(), tokenId);
        assignments.set(mapPath(), tokenId, { mini: glb, scale: have?.scale ?? 1, turn: have?.turn ?? 0 });
      },
      paintWall: (id, material, whole) => {
        const walls = this.map?.walls ?? [];
        const wall = walls.find((candidate) => candidate.id === id);
        if (!wall) return;
        // Shift paints the whole wall (`wholeWall`); a door is always painted alone.
        const ids = whole ? wholeWall(walls, id) : [id];
        boardData.setWallMaterial(mapPath(), ids, material);
      },
      cameraMoved: () => this.services.cameraMoved?.(this),
      hosting: () => this.services.session?.()?.hosting() === true,
      // The GM's Template tool while Connect hosts: what it asks goes to every player of the map's scene.
      playerAction: (action) => {
        const session = this.services.session?.();
        const path = this.path;
        if (!session || !path || action.type !== 'template') return;
        const change = action.change;
        if ('add' in change) session.addTemplate(path, change.add);
        else if ('remove' in change) session.eraseTemplate(path, change.remove);
        else session.clearTemplates(path);
      },
    };
  }

  /** A light's menu: how high it hangs, in quarter squares, and back to the default. */
  private lightMenu(id: string, event: MouseEvent): void {
    const path = this.path;
    if (!path) return;
    const { boardData } = this.services;
    const entries = (): MenuEntry[] => {
      const stored = boardData.lightHeight(path, id);
      const height = stored ?? DEFAULT_LIGHT_SQUARES;
      const set = (next: number): void => boardData.setLightHeight(path, id, Math.max(0, Math.round(next * 4) / 4));
      return [
        {
          type: 'item', label: 'Height', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${height} sq`, label: 'Height', canDecrement: height > 0, onDecrement: () => set(height - HEIGHT_STEP), onIncrement: () => set(height + HEIGHT_STEP) },
        },
        { type: 'item', label: 'Reset height', disabled: stored === null, onClick: () => boardData.setLightHeight(path, id, null) },
      ];
    };
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /** A wall's or door's menu: a door opens, shuts, locks; any wall can lose its paint; a door can be a prop instead. */
  private wallMenu(id: string, event: MouseEvent): void {
    const path = this.path;
    if (!path || !this.map?.walls.some((candidate) => candidate.id === id)) return;
    const { boardData, props, writer } = this.services;
    const entries = (): MenuEntry[] => {
      const wall = this.map?.walls.find((candidate) => candidate.id === id);
      if (!wall) return [];
      const door = wall.type !== 'solid';
      const prop = door ? boardData.doorProp(path, id) : null;
      const paint = boardData.wallMaterial(path, id);
      const painted = door ? [] : wholeWall(this.map?.walls ?? [], id).filter((other) => boardData.wallMaterial(path, other) !== null);
      const list: MenuEntry[] = [];
      // Its own height, by quarter squares; until set, as tall as the fog (a low wall half that).
      const own = boardData.wallHeight(path, id);
      const fog = boardData.fogHeight(path);
      const height = own ?? (wall.limited ? fog / 2 : fog);
      const setHeight = (next: number): void => boardData.setWallHeight(path, [id], Math.max(0, Math.round(next * 4) / 4));
      list.push({
        type: 'item', label: own === null ? 'Height (fog)' : 'Height', keepOpen: true, onClick: () => undefined,
        stepper: { value: `${height} sq`, label: 'Height', canDecrement: height > 0, onDecrement: () => setHeight(height - HEIGHT_STEP), onIncrement: () => setHeight(height + HEIGHT_STEP) },
      });
      const whole = door ? [id] : wholeWall(this.map?.walls ?? [], id);
      if (whole.length > 1) list.push({ type: 'item', label: 'Give the whole wall this height', onClick: () => boardData.setWallHeight(path, whole, height) });
      if (own !== null || whole.some((other) => boardData.wallHeight(path, other) !== null)) {
        list.push({ type: 'item', label: 'Back to the fog\'s height', onClick: () => boardData.setWallHeight(path, whole, null) });
      }
      list.push({ type: 'separator' });
      if (door) {
        list.push({ type: 'item', label: wall.closed ? 'Open' : 'Close', disabled: wall.locked, onClick: () => this.board?.toggleDoor(id) });
        list.push({
          type: 'item', label: wall.locked ? 'Unlock' : 'Lock',
          onClick: () => {
            wall.locked = !wall.locked;
            if (wall.locked) wall.closed = true;
            this.board?.refresh();
            writer.lockDoor(path, id, wall.locked).catch((error: unknown) => this.unsaved('door lock', error));
          },
        });
        list.push({ type: 'separator' });
        list.push({
          type: 'item', label: prop ? 'Change door prop…' : 'Replace with prop…',
          onClick: () => new MiniPicker(this.app, props, 'door', prop ? { mini: prop, scale: 1, turn: 0 } : null, (result) => boardData.setDoorProp(path, id, result.mini), {
            title: wall.type === 'secret-door' ? 'Prop for this secret door' : 'Prop for this door', action: 'Use prop', fitted: true,
          }).open(),
        });
        if (prop) list.push({ type: 'item', label: 'Use plain door', onClick: () => boardData.setDoorProp(path, id, null) });
      }
      if (paint) list.push({ type: 'item', label: door ? 'Remove material' : 'Remove material from segment', onClick: () => boardData.setWallMaterial(path, [id], null) });
      if (!door && painted.length > 1) list.push({ type: 'item', label: 'Remove material from whole wall', onClick: () => boardData.setWallMaterial(path, painted, null) });
      if (list.length === 0) list.push({ type: 'item', label: 'Drag a material from the gallery onto this wall', disabled: true, onClick: () => undefined });
      return list;
    };
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  // ── Initiative ────────────────────────────────────────────────────────────

  /** Follows the store of the Atlas view holding this map, if one does; the tracker shows what it holds. */
  private watchAtlas(): void {
    const view = this.path && !this.closed ? this.services.writer.holder(this.path) : null;
    if (this.watched?.view === view) return;
    this.watched?.stop();
    this.watched = null;
    if (view) {
      let held = view.atlasStore.getState().initiative;
      const stop = view.atlasStore.subscribe(() => {
        const state = view.atlasStore.getState();
        // Atlas moved to another map in that view: the file is this map's tracker again.
        if (state.mapPath !== this.path) { this.watchAtlas(); return; }
        if (state.initiative === held) return;
        held = state.initiative;
        this.initiative?.render();
        this.menu?.refresh();
      });
      this.watched = { view, stop };
    }
    this.initiative?.render();
    // The dice log listens on the Atlas view holding the map.
    this.dice?.listen();
    // Atlas opened or closed the map: whether players see the board's changes may have changed with it.
    this.sessionChanged();
    this.followTabs();
  }

  /** Atlas's scene tabs over the board, followed in the view that holds this map. */
  private sceneTabs: SceneTabBar | null = null;
  private stopTabs: (() => void) | null = null;
  private tabsOf: AtlasView | null = null;

  private followTabs(): void {
    const found = this.path && !this.closed ? tabViewOf(this.app, this.path) : null;
    if (found?.view !== this.tabsOf) {
      this.stopTabs?.();
      this.stopTabs = found ? found.view.tabMetaStore.subscribe(() => this.sceneTabs?.refresh()) : null;
      this.tabsOf = found?.view ?? null;
    }
    this.sceneTabs?.refresh();
  }

  /** The scene tabs of the Atlas view holding this map: this board's scene marked, and the one players are shown. */
  private sceneTabEntries(): Array<{ id: string; name: string; filePath: string; active: boolean; presented: boolean; loaded: boolean; dirty: boolean }> {
    const found = this.path ? tabViewOf(this.app, this.path) : null;
    if (!found) return [];
    const presented = presentedSceneOf(this.app)?.get()?.tabId ?? null;
    return found.view.tabMetaStore.getState().tabs.map((tab) => ({
      id: tab.id, name: tab.displayName, filePath: tab.filePath, active: tab.filePath === this.path, presented: tab.id === presented,
      loaded: tab.isLoaded === true, dirty: tab.isDirty === true,
    }));
  }

  /** A tab chosen over the board: Atlas switches to it, and the board shows its scene. */
  private async switchScene(tabId: string): Promise<void> {
    const found = this.path ? tabViewOf(this.app, this.path) : null;
    const tab = found?.view.tabMetaStore.getState().tabs.find((entry) => entry.id === tabId);
    if (!found || !tab) return;
    await found.view.switchToTab(tabId);
    if (tab.filePath !== this.path) await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: tab.filePath }, active: true });
  }

  /**
   * A tab's eye over the board: the scene is shown to players as Atlas's own eye shows it (its present command, run on
   * its view), and the board goes to that scene. The board keeps the focus.
   */
  private async presentScene(tabId: string): Promise<void> {
    const found = this.path ? tabViewOf(this.app, this.path) : null;
    const tab = found?.view.tabMetaStore.getState().tabs.find((entry) => entry.id === tabId);
    if (!found || !tab) return;
    await found.view.switchToTab(tabId);
    this.app.workspace.setActiveLeaf(found.leaf, { focus: false });
    const commands = (this.app as unknown as { commands?: { executeCommandById?(id: string): boolean } }).commands;
    const ran = commands?.executeCommandById?.('atlas-vtt:send-map-to-player-view') === true;
    this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
    if (!ran) new Notice('Tabletop: Atlas could not show this scene to players.');
    if (tab.filePath !== this.path) await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: tab.filePath }, active: true });
    this.sceneTabs?.refresh();
  }

  /** The tracker as Atlas holds it while it has the map open, else as the file has it. */
  private liveInitiative(): InitiativeState {
    const state = this.watched?.view.atlasStore.getState();
    if (state && state.mapPath === this.path && state.initiative) return readInitiative(state.initiative);
    return this.map?.initiative ?? emptyInitiative();
  }

  /**
   * A change of the tracker. Through Atlas, its store changes and the tracker follows it; in the file, the board shows
   * the change at once, with the same dice the file is written with.
   */
  private initiativeAct(given: InitiativeAction): void {
    const map = this.map;
    if (!map) return;
    this.watchAtlas();
    const action = this.withDefeated(given);
    const draws: number[] = [];
    let next = 0;
    if (!this.watched) {
      // A fight only Atlas 0.9 runs (by cards, by rolled or named sides) is not played in the file.
      const refused = fileCannotRun(map.initiative, action);
      if (refused) {
        new Notice(`Tabletop: ${refused} runs only in Atlas. Open this map in Atlas to play it.`, 8000);
        return;
      }
      map.initiative = applyInitiative(map.initiative, action, () => { const draw = Math.random(); draws.push(draw); return draw; });
      this.initiative?.render();
    }
    this.services.writer.initiativeAction(map.path, action, () => draws[next++] ?? Math.random())
      .catch((error: unknown) => this.unsaved('initiative change', error));
  }

  /**
   * Atlas 0.9 passes defeated combatants by when the turn moves: the entries whose token holds a spent resource that
   * defeats it, read from Atlas's live tokens while it holds the map.
   */
  private withDefeated(action: InitiativeAction): InitiativeAction {
    if (action.type !== 'next' && action.type !== 'previous' && action.type !== 'start' && action.type !== 'remove') return action;
    const definitions = this.rules.definitions;
    const live = this.watched?.view.atlasStore.getState();
    const held = live && live.mapPath === this.path ? live.objects.tokens as unknown as Record<string, Record<string, unknown>> : null;
    const defeated = this.liveInitiative().entries.filter((entry) => {
      const raw = held?.[entry.tokenId];
      const token = raw ? tokenFromFile(raw) : this.map?.tokens.find((candidate) => candidate.id === entry.tokenId);
      return token !== undefined && isDefeated(token, definitions);
    }).map((entry) => entry.id);
    return { ...action, defeated };
  }

  /** Atlas's Roll: everyone, or one combatant, each adding its own modifier, else the one its statblock holds. */
  private async rollInitiative(entryId?: string): Promise<void> {
    const rules = this.rules.initiative;
    const statblockModifiers: Record<string, number> = {};
    for (const entry of this.liveInitiative().entries) {
      if ((entryId !== undefined && entry.id !== entryId) || ownModifier(entry) !== undefined) continue;
      const path = this.map?.tokens.find((token) => token.id === entry.tokenId)?.statblockPath ?? entry.statblockPath;
      const fields = path ? await statblockFields(this.app, path) : null;
      const modifier = fields ? statblockModifier(fields, rules) : null;
      if (modifier !== null) statblockModifiers[entry.id] = modifier;
    }
    if (this.closed) return;
    this.initiativeAct({ type: 'roll', roll: rules.roll, statblockModifiers, ...(entryId !== undefined && { entryId }) });
  }

  /** Atlas's tracker keys: I shows or hides it; the up and down arrows step the turns while it shows a running fight. */
  private initiativeKey(event: KeyboardEvent): void {
    const panel = this.initiative;
    const target = event.target as HTMLElement | null;
    if (!panel || this.menu?.isOpen || event.ctrlKey || event.metaKey || event.altKey) return;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    let handled = false;
    if (event.key.toLowerCase() === 'i') {
      if (!event.repeat) panel.setOpen(!panel.isOpen);
      handled = true;
    } else if (panel.isOpen && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && this.liveInitiative().isActive) {
      const previous = event.key === 'ArrowUp';
      this.initiativeAct({ type: previous ? 'previous' : 'next' });
      panel.press(previous ? 'prev' : 'next');
      handled = true;
    }
    if (!handled) return;
    event.preventDefault();
    event.stopPropagation();
  }

  private initiativeHost(): InitiativePanelHost {
    const mapPath = (): string => this.path ?? '';
    return {
      state: () => this.liveInitiative(),
      rules: () => this.rules.initiative,
      tokens: () => this.map?.tokens ?? [],
      // While Atlas holds the map its tokens are the live ones: one it just added is not in the file yet.
      hasToken: (id) => {
        const state = this.watched?.view.atlasStore.getState();
        if (state && state.mapPath === this.path) return Object.hasOwn(state.objects?.tokens ?? {}, id);
        return this.map?.tokens.some((token) => token.id === id) ?? false;
      },
      tokenSettings: () => this.map?.tokenSettings ?? { showNameplates: false, showInstanceBadges: true, hiddenResources: [] },
      definitions: () => this.rules.definitions,
      imageUrl: (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? this.app.vault.getResourcePath(file) : '';
      },
      icon: (element, name) => setIcon(element, name),
      roll: (entryId) => { void this.rollInitiative(entryId); },
      act: (action) => this.initiativeAct(action),
      offers: (action) => this.services.writer.offers(mapPath(), action),
      setHidden: (id, hidden) => this.changeToken(id, { hidden }, () => ({ isHidden: hidden }), hidden ? 'hiding' : 'showing'),
      // A token moved to the players' side sees, as Atlas switches its vision on then (and never off).
      setSide: (id, side) => this.changeToken(id, { side, ...(side === 'players' && { sees: true }) }, (held) => {
        const vision = held.vision as Record<string, unknown> | undefined;
        return side === 'players' && vision?.enabled !== true ? { side, vision: { ...vision, enabled: true } } : { side };
      }, 'side change'),
      showToken: (id) => this.board?.showToken(id),
      menu: (entries, at) => {
        this.menu?.close();
        this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, at, (element, name) => setIcon(element, name), () => { this.menu = null; });
      },
    };
  }

  /** Atlas's token menu (`tokenMenu.ts`), drawn as Atlas draws its menus. */
  private tokenMenu(id: string, event: MouseEvent): void {
    const map = this.map;
    if (!map || !map.tokens.some((candidate) => candidate.id === id)) return;
    const { assignments, boardData, minis } = this.services;
    const token = (): BoardToken | null => this.map?.tokens.find((candidate) => candidate.id === id) ?? null;
    this.menu?.close();
    const entries = (): ReturnType<typeof tokenMenuEntries> => tokenMenuEntries({
      token,
      rules: this.rules,
      settings: () => this.map!.tokenSettings,
      inInitiative: () => this.liveInitiative().entries.some((entry) => entry.tokenId === id),
      hasMini: () => assignments.get(map.path, id) !== null,
      standee: () => boardData.style(map.path, id) === 'standee',
      lightHeight: () => (this.map?.lights.some((light) => light.tokenId === id) ? boardData.lightHeight(map.path, id) ?? DEFAULT_LIGHT_SQUARES : null),
      icon: (element, name) => setIcon(element, name),
      actions: {
        setCondition: (condition, active) => this.changeConditions(id, (now) => conditionChange(now, condition, active), 'condition'),
        stepCondition: (condition, delta) => this.changeConditions(id, (now) => conditionStep(now, condition, delta), 'condition'),
        setHidden: (hidden) => this.changeToken(id, { hidden }, () => ({ isHidden: hidden }), hidden ? 'hiding' : 'showing'),
        setInitiative: (join) => this.setInitiative(id, join),
        assignMini: () => {
          const now = token();
          if (now) new MiniPicker(this.app, minis, tokenName(now), assignments.get(map.path, id), (result) => assignments.set(map.path, id, result)).open();
        },
        removeMini: () => assignments.remove(map.path, id),
        setStandee: (standee) => boardData.setStyle(map.path, id, standee ? 'standee' : 'disc'),
        setLightHeight: (height) => boardData.setLightHeight(map.path, id, Math.max(0, Math.round(height * 4) / 4)),
        reset: () => this.resetToken(id),
        kill: () => this.killToken(id),
        remove: () => this.deleteToken(id),
      },
    });
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /**
   * Shows a change of a token at once (`shown`, the board's fields) and saves it (`change`, the token's fields as
   * Atlas holds them); `what` names it if the save fails.
   */
  private changeToken(id: string, shown: Partial<BoardToken>, change: TokenChange, what: string): void {
    const token = this.map?.tokens.find((candidate) => candidate.id === id);
    if (!token) return;
    this.board?.changeToken(id, { ...token, ...shown });
    this.initiative?.render();
    this.services.writer.update(this.path ?? '', id, change).catch((error: unknown) => this.unsaved(what, error));
  }

  /** A condition set, taken off or stepped: computed on the token as it is, the same way for the board and the save. */
  private changeConditions(id: string, change: (token: { conditions: string[]; conditionValues: Record<string, number> }) => ConditionFields | null, what: string): void {
    const token = this.map?.tokens.find((candidate) => candidate.id === id);
    const fields = token ? change(token) : null;
    if (!token || !fields) return;
    const shown = { conditions: fields.conditions ?? [], conditionValues: fields.conditionValues ?? {} };
    // Saved from what Atlas (or the file) holds, so a change made there meanwhile is kept.
    this.changeToken(id, shown, (held) => change({ conditions: (held.conditions as string[] | undefined) ?? [], conditionValues: (held.conditionValues as Record<string, number> | undefined) ?? {} }), what);
  }

  /** Atlas's Reset: every defined resource back at its start, every condition gone. */
  private resetToken(id: string): void {
    const token = this.map?.tokens.find((candidate) => candidate.id === id);
    if (!token) return;
    const definitions = this.rules.definitions;
    const shown = resetChange(token, definitions);
    this.changeToken(id, { resources: shown.resources ?? token.resources, conditions: [], conditionValues: {} }, (held) => ({ ...resetChange(held, definitions) }), 'reset');
  }

  /** Puts the token in Atlas's initiative tracker or takes it out. */
  private setInitiative(id: string, join: boolean): void {
    const map = this.map;
    if (!map) return;
    this.watchAtlas();
    // As Atlas: adding a token opens the tracker.
    if (join) this.initiative?.setOpen(true);
    if (!this.watched) {
      const token = map.tokens.find((candidate) => candidate.id === id);
      const held = map.initiative as unknown as Parameters<typeof removeFromInitiative>[0];
      map.initiative = readInitiative(join && token ? addToInitiative(held, initiativeEntryFor(token), initiativeId()) : removeFromInitiative(held, id));
      this.initiative?.render();
    }
    this.services.writer.initiative(map.path, id, join).catch((error: unknown) => this.unsaved('initiative change', error));
  }

  private killToken(id: string): void {
    const token = this.map?.tokens.find((candidate) => candidate.id === id);
    if (!token) return;
    const definitions = this.rules.definitions;
    const resources = defeatedResources(token, definitions);
    if (resources) this.board?.changeToken(id, { ...token, resources });
    this.services.writer.kill(this.path ?? '', id, definitions).catch((error: unknown) => this.unsaved('kill', error));
  }

  private deleteToken(id: string): void {
    const path = this.path ?? '';
    this.board?.changeToken(id, null);
    const { assignments, boardData, writer } = this.services;
    writer.remove(path, id).then(() => {
      // The token is gone: so is the mini Tabletop gave it, and its look.
      assignments.remove(path, id);
      boardData.setStyle(path, id, 'disc');
    }).catch((error: unknown) => this.unsaved('deletion', error));
  }
}
