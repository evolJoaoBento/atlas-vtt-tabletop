/**
 * The 3D board's tab: an Atlas map (`.atlasmap`) opened in 3D. It reads the map, follows the file as it changes (Atlas
 * saving it, a sync tool), follows a rename and closes when the map is deleted. What the board asks of Obsidian (images,
 * GLBs, the minis and props kept by Tabletop, saving a token's move or resources, opening a note, the token menu with
 * Atlas's Kill and Delete) goes through the plugin's `BoardServices`. Atlas's initiative tracker stands at the board's
 * right edge (`initiativePanel.ts`): it shows the tracker Atlas holds while Atlas has the map open, following its
 * store as it changes, else the one in the file.
 */
import type { MaterialDefaults } from '../materialDefaults';
import { placeSurvey, type ArSurvey, type SavedArTable } from '../arTable';
import type { BoardMark, BoardSession, BoardViewer } from '../connectContract';
import { ItemView, Menu, Modal, Notice, TFile, debounce, setIcon, type App, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { ATLAS_VIEW_TYPE, presentedSceneOf, tabViewOf, type AtlasView } from '../atlas';
import { AtlasBridge } from '../atlasBridge';
import { BoardAtlasTools } from './boardAtlasTools';
import { tabletopCommands } from '../palette/tabletopCommands';
import { MOSAIC_FROM_BYTES, mapPicture } from '../atlasMosaic';
import { SceneTabBar, type SceneTabEntry } from './sceneTabBar';
import { LayerModal } from '../layerModal';
import type { ElevationLayerData } from './elevationLayer';
import { compose, isNoPlacement, NO_PLACEMENT, relativeTo, type Placement } from './layerPlacement';
import type { SightMode, SightStyle } from './lineOfSight';
import { spiralSpot, type Occupant } from './spiral';
import type { Assignments } from '../assignments';
import { MiniPicker } from '../gallery';
import type { LoadedMini, MiniLibrary } from '../library';
import type { MaterialLibrary } from '../materials';
import { Board, GM_SPELL_OWNER, type BoardHost } from './board';
import type { CastSpell, SpellAsk } from './spells';
import type { SpellBook } from './spellPicker';
import type { SpellChange } from './playerTools';
import { isVideoPath } from './textures';
import type { BoardData, PropLook, PropVariant } from './boardData';
import { lookOf } from './boardData';
import type { UndoHistory } from './undoHistory';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './conditions';
import { levelName, levelRise, onFirstLevel, propsOnLevel, resolveLevel } from './levels';
import { readMap, type BoardMap, type BoardToken } from './mapModel';
import { readMeasurement } from './measure';
import { defeatedResources, isDefeated, tokenFromFile } from './resources';
import { AtlasMenu, type MenuEntry } from './atlasMenu';
import { tokenMenuEntries } from './tokenMenu';
import { pinMenuEntries } from './pinMenu';
import { presentToEntry } from './sessionMenus';
import { SpellAskModal } from '../spellAskModal';
import { addToInitiative, conditionChange, conditionStep, initiativeEntryFor, initiativeId, removeFromInitiative, resetChange, type ConditionFields } from './tokenEdits';
import { applyInitiative, currentEntries, delayedTokens, emptyInitiative, fileCannotRun, ownModifier, readInitiative, statblockModifier, turnAnnouncement, type InitiativeAction, type InitiativeState } from './initiative';
import { InitiativePanel, type InitiativePanelHost } from './initiativePanel';
import { wholeWall, isWindow, windowSpan, WINDOW_STEP } from './walls';
import type { TokenChange } from './tokenWriter';
import type { LaserSettings } from './laser';
import type { PlayerView } from './PlayerWindow';
import { DEFAULT_EDGES, DEFAULT_SEE_THROUGH_SIZE, QUALITY, withLooks, type LayerLook, type Quality, type QualityPreset, type WallEdges } from './quality';
import { DEFAULT_SKY, type LightingChoice, type Sky } from './look';
import type { TokenWriter } from './tokenWriter';
import { BoardDice } from '../dice/boardDice';
import { buildAtlasSheet } from '../sheets/nativeSheet';
import type { PlayerSheet } from '../sheets/sheet';
import type { CardHost } from '../sheets/atlasCard';
import { atlasCardHost } from '../sheets/atlasCardHost';
import { atlasPreviews, previewAnchor, routeAtlasWindowRolls } from '../sheets/atlasPreview';
import { StatblockHoverCard } from '../sheets/hoverCard';
import { statblockFields, statblockOf } from '../sheets/statblock';
import { rollViewFor, type MapViewLike } from '../dice/atlasDice';
import type { ChosenPack } from '../dice/dicePack';
import type { TabletopDiceSettings } from '../dice/diceSettings';
import { documentHasWebgl, NO_WEBGL_HELP, NO_WEBGL_TITLE } from '../webgl';
import { TABLETOP_ICON } from '../tabletopIcon';

export const BOARD_VIEW_TYPE = 'atlas-tabletop-board';
/** A wall's own width: its step in the wall's menu and its most, in grid squares. */
const WIDTH_STEP = 0.02;
const WIDTH_MAX = 2;

/** Where the board's toolbar mode (Play or Edit) is kept, for this vault. */
const BOARD_MODE_KEY = 'tabletop-board-mode';

/** The hover source Tabletop registers, so Obsidian's page preview shows stat blocks from the board. */
export const HOVER_SOURCE = 'tabletop-for-atlas';
const RELOAD_MS = 300;
/** A light hangs a square above the map until the GM sets its height; the menu steps it a quarter square. */
const DEFAULT_LIGHT_SQUARES = 1;
const HEIGHT_STEP = 0.25;

/** What the board's tab uses of the plugin. */
export interface BoardServices {
  /** Keeps a prop as a variant in the gallery. */
  saveVariant?(variant: Omit<PropVariant, 'id'>): void;
  /** Tabletop's undo history (src/board/undoHistory.ts). */
  history?: UndoHistory;
  assignments: Assignments;
  boardData: BoardData;
  minis: MiniLibrary;
  props: MiniLibrary;
  materials: MaterialLibrary;
  writer: TokenWriter;
  /** The quality setting the board draws with. */
  quality(): Quality;
  /** Whether the board gets the miniature look (a blur towards the top and bottom). */
  tiltShift?(): boolean;
  wallEdges?(): WallEdges;
  setWallEdges?(edges: WallEdges): void;
  seeThrough?(): boolean;
  setSeeThrough?(on: boolean): void;
  /** Whether dropped props snap to the grid, kept for every board. */
  snapProps?(): boolean;
  setSnapProps?(on: boolean): void;
  seeThroughSize?(): number;
  setSeeThroughSize?(squares: number): void;
  layerLook?(): LayerLook;
  setLayerLook?(look: LayerLook): void;
  lineOfSight?(): SightMode;
  setLineOfSight?(mode: SightMode): void;
  sightStyle?(): SightStyle;
  setSightStyle?(style: SightStyle): void;
  layerTick?(): number;
  /** Whether the board gets contact shadows (ambient occlusion). */
  occlusion?(): boolean;
  /** Whether the board gets the painted lighting. */
  painted?(): boolean;
  /** The painted sky's palette. */
  sky?(): Sky;
  /** The laser's colour and size, kept for every map; and saving a change. */
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** Chooses the board's lighting, for every board. */
  setLighting?(choice: LightingChoice): void;
  setTiltShift?(on: boolean): void;
  setOcclusion?(on: boolean): void;
  /** Changes whether a stat sheet's roll is thrown at once, for every board. */
  setAutoRoll?(on: boolean): void;
  /** Keeps whether the stat sheet drawer is pinned. */
  setSheetPinned?(pinned: boolean): void;
  /** This tab was used last: props from the gallery go to it. */
  focused(view: BoardView): void;
  /** The local player view: open, switch to or close it for this board's map; whether one shows its map. */
  togglePlayerView(view: BoardView): void;
  playerViewOpen(path: string): boolean;
  /** This board has drawn its map: a player view of that map can be drawn into. */
  boardReady(view: BoardView): void;
  /** The board showed another level of its scene (Atlas levels): what players are sent changes with it. */
  levelShown?(mapPath: string): void;
  /** The GM's camera or the players' moved on this board. */
  cameraMoved?(view: BoardView): void;
  /** Connect's hosted session, while Connect hands one over. */
  session?(): BoardSession | null;
  /** The vault's spell notes, for the spell search. */
  spellBook?(): SpellBook | null;
  /** The materials walls and doors wear when none is painted on them, by kind. */
  materialDefaults?(): MaterialDefaults;
  /** The dice settings, and the pack the dice are made from (the default pack Tabletop carries until it is read). */
  diceSettings(): TabletopDiceSettings;
  dicePack(): ChosenPack;
}

const tokenName = (token: BoardToken): string => token.name ?? token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Token';


/** The casts whose token changes a board of the GM's has carried out: map path and spell id. */
const claimedSpells = new Set<string>();

export class BoardView extends ItemView {
  private path: string | null = null;
  private board: Board | null = null;
  /** The GM's dice on the board: its picker, table and roll. */
  private dice: BoardDice | null = null;
  /** Atlas's random tables, asset manager and command palette over this board. */
  private atlasTools: BoardAtlasTools | null = null;
  /** The stat block card Ctrl/Cmd + hover opens over a token, and the token it is for. */
  private hoverCard: StatblockHoverCard | null = null;
  /** Stops the board's dice throwing the rolls of Atlas's own hover window. */
  private stopWindowRolls: (() => void) | null = null;
  private hoverToken: string | null = null;
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
  /** The GM's spells while Connect does not host: on this board alone, per map. */
  private localSpells: Array<CastSpell & { path: string }> = [];
  /** The map whose spells the board was last given. */
  private spellsPath: string | null = null;
  private nextLocalSpell = 1;
  /** Atlas's initiative tracker on the board. */
  private initiative: InitiativePanel | null = null;
  /** The Atlas view holding this map, whose store is followed so its tracker shows each change at once. */
  private watched: { view: AtlasView; stop: () => void } | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly services: BoardServices) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string { return BOARD_VIEW_TYPE; }
  getIcon(): string { return TABLETOP_ICON; }
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
      this.chosenLevel = null;
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
      else if (this.stackPaths.has(file.path)) this.reloadStack();
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
      layerMenu: (id, at) => this.layerMenu(id, at),
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
    // The toolbar's undo and redo follow the history.
    const history = this.services.history;
    if (history) this.register(history.onChange(() => this.board?.refreshToolbar()));
  }

  /** The maps this board's undo reaches: its own and the scenes stacked with it. */
  private undoPaths(): string[] {
    const path = this.path;
    if (!path) return [];
    return [...new Set([path, ...this.services.boardData.stackOf(path).map((member) => member.path)])];
  }

  /** Takes back (or brings back) the latest change on this board's maps; says so where there was none or it failed. */
  private travel(way: 'undo' | 'redo'): void {
    const history = this.services.history;
    if (!history) return;
    void history[way](this.undoPaths()).then((result) => {
      if (!result) new Notice(way === 'undo' ? 'Tabletop: nothing to undo.' : 'Tabletop: nothing to redo.');
      else if (!result.done) new Notice(`Tabletop: could not ${way} the ${result.label}: the map was changed elsewhere since.`);
      this.board?.refreshToolbar();
    });
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
    this.stopWaiting?.();
    this.stopWaiting = null;
    this.initiative?.dispose();
    this.initiative = null;
    this.reload.cancel();
    this.dropBoard();
    this.playerWindow?.waiting(true);
    this.playerWindow = null;
    this.atlasTools?.dispose();
    this.atlasTools = null;
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
    const preset = this.preset();
    if (board.setQuality(preset)) return;
    const camera = board.camera;
    this.dropBoard();
    const fresh = this.makeBoard(preset);
    await fresh.load(this.map);
    fresh.camera = camera;
    if (this.playerWindow) fresh.attachPlayer(this.playerWindow.stage);
    fresh.wake(true);
  }

  /** The board as it is drawn now, as a PNG, for a snapshot saved in the vault. */
  snapshot(): Promise<Blob | null> {
    return this.board?.snapshot() ?? Promise.resolve(null);
  }

  /** The quality setting, with the miniature look if it is on. */
  private preset(): QualityPreset {
    return withLooks(QUALITY[this.services.quality()], { tiltShift: this.services.tiltShift?.() === true, occlusion: this.services.occlusion?.() === true, painted: this.services.painted?.() === true, sky: this.services.sky?.() ?? DEFAULT_SKY, edges: this.services.wallEdges?.() ?? DEFAULT_EDGES, seeThrough: this.services.seeThrough?.() === true, seeThroughSize: this.services.seeThroughSize?.(), layerLook: this.services.layerLook?.(), lineOfSight: this.services.lineOfSight?.(), sightStyle: this.services.sightStyle?.(), layerTick: this.services.layerTick?.() });
  }

  /** A board, and the GM's dice on it. */
  private makeBoard(preset: QualityPreset): Board {
    const board = new Board(this.contentEl, this.host(), preset);
    this.board = board;
    this.atlasTools ??= this.makeAtlasTools();
    this.atlasTools.attach(board);
    this.dice = new BoardDice({
      board,
      container: this.contentEl,
      mapPath: () => this.path ?? '',
      atlasView: () => this.rollView(),
      settings: () => this.services.diceSettings(),
      pack: () => this.services.dicePack(),
      warn: (message) => this.warn(message),
      setSheetPinned: (pinned) => this.services.setSheetPinned?.(pinned),
      sheetOf: (tokenId) => this.sheetOf(tokenId),
      cardOf: (tokenId) => this.cardOf(tokenId),
    });
    return board;
  }

  /** The sheet of a token's stat block, named as the token when the stat block has no name. */
  private async sheetOf(tokenId: string): Promise<PlayerSheet | null> {
    const token = this.map?.tokens.find((candidate) => candidate.id === tokenId);
    if (!token?.statblockPath) return null;
    return buildAtlasSheet(await statblockOf(this.app, token), token.name);
  }

  /** What draws Atlas's own card of a token's stat block; null when the token links none. */
  private cardOf(tokenId: string): CardHost | null {
    const token = this.map?.tokens.find((candidate) => candidate.id === tokenId);
    return token?.statblockPath ? atlasCardHost(this.app, token.statblockPath, token.name ?? undefined) : null;
  }

  /** The board goes (another map, new quality, the tab closing): its dice first, the roll in play never logged. */
  private dropBoard(): void {
    this.dice?.sceneChanged();
    this.dice?.dispose();
    this.dice = null;
    this.hoverCard?.dispose();
    this.hoverCard = null;
    this.stopWindowRolls?.();
    this.stopWindowRolls = null;
    this.board?.dispose();
    this.board = null;
  }

  /** Atlas's toolbar tools for this board: what each asks of the board. */
  private makeAtlasTools(): BoardAtlasTools {
    const atlasView = () => (this.path ? tabViewOf(this.app, this.path) : null);
    const openInAtlas = (page?: string): void => {
      const found = atlasView();
      const state = found?.view.atlasStore.getState() as { setCommandPaletteOpen?: (open: boolean, page?: string) => void } | undefined;
      if (!found || typeof state?.setCommandPaletteOpen !== 'function') { new Notice('Tabletop: this needs Atlas with this map open.'); return; }
      this.app.workspace.setActiveLeaf(found.leaf, { focus: true });
      state.setCommandPaletteOpen(true, page && page !== 'customize-toolbar' ? page : undefined);
    };
    return new BoardAtlasTools({
      app: this.app, leaf: this.leaf, container: this.contentEl, writer: this.services.writer,
      board: () => this.board, mapPath: () => this.path,
      undo: () => this.travel('undo'), redo: () => this.travel('redo'),
      palette: {
        selectTool: (tool) => {
          if (tool === 'move') return;
          if (tool === 'measure') { this.board?.toolbarActions().selectMeasure?.('line'); return; }
          openInAtlas();
        },
        setDiceLogOpen: (open) => this.dice?.setLogOpen(open),
        initiativeOpen: () => this.initiative?.isOpen ?? false,
        setInitiativeOpen: (open) => this.initiative?.setOpen(open),
        openSceneBrowser: () => { const found = atlasView(); if (found?.view.openSceneBrowser) found.view.openSceneBrowser(); else new Notice('Tabletop: open another scene in Atlas.'); },
        playerViewOpen: () => this.services.playerViewOpen(this.path ?? ''),
        togglePlayerView: () => this.services.togglePlayerView(this),
        playerFrozen: () => this.board?.playerFrozen ?? false,
        togglePlayerFreeze: () => this.board?.setPlayerFrozen(!(this.board?.playerFrozen ?? false)),
        presentInAtlas: () => { if (!this.path || !new AtlasBridge(this.app).runInAtlas(this.path, 'atlas-vtt:send-map-to-player-view', this.leaf)) new Notice('Tabletop: Atlas could not show this scene to players.'); },
        openInAtlas,
        tabletopCommands: () => { const board = this.board; return board ? tabletopCommands(board.toolbarActions(), () => board.refreshToolbar()) : []; },
      },
      spawn: {
        centre: () => this.board?.viewCentre() ?? { x: 0, y: 0 },
        grid: () => this.map?.grid ?? null,
        tokens: () => Object.fromEntries((this.map?.tokens ?? []).map((token) => [token.id, token as unknown as Record<string, unknown>])),
        select: (ids) => this.board?.selectTokens(ids),
        joinInitiative: async (ids) => { for (const id of ids) await this.services.writer.initiative(this.path ?? '', id, true); this.initiative?.setOpen(true); },
        openMap: async (file) => { await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file }, active: true }); },
      },
    });
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
    void this.readStack();
    this.showTable();
  }

  /** The players' AR table on this map, for the board to fine-tune (Board settings, AR table). */
  private showTable(): void {
    const board = this.board;
    if (!board || !this.path) return;
    board.setArTable(this.services.boardData.arTable(this.path));
  }

  /**
   * A player's survey of the table's AR marker sheets, for this board's map: kept, placed where an earlier placing had
   * the sheets they share (else in the middle of the view), and the handles put on it to place it.
   */
  takeSurvey(survey: ArSurvey): void {
    const board = this.board;
    const path = this.path;
    if (!board || !path) return;
    const before = this.services.boardData.arTable(path);
    const middle = board.viewMiddle();
    this.services.boardData.setArTable(path, placeSurvey(survey, before, middle));
    this.showTable();
    board.placeTable(true);
  }


  /** The stacked scenes as last read (their maps, tokens included), and the places tokens were just dropped on them: the next read has those too. */
  private stackLayers: ElevationLayerData[] = [];
  private readonly arrived = new Map<string, Occupant[]>();

  /**
   * Tokens dropped on another scene's pill on the height ruler: each goes to that scene, to the middle of its board or,
   * where that place is taken, to the next square of a spiral round it with room for it, and leaves this one. Its mini
   * and its look go with it.
   */
  private async moveTokensToLayer(ids: readonly string[], target: string, places?: Readonly<Record<string, { x: number; y: number }>>): Promise<void> {
    const board = this.board;
    const from = this.path;
    const map = this.map;
    const layer = this.stackLayers.find((candidate) => candidate.path === target);
    if (!board || !from || !map || !layer) return;
    const { assignments, boardData, writer } = this.services;
    const size = board.layerSize(target) ?? { width: layer.map.world?.width ?? 0, height: layer.map.world?.height ?? 0 };
    const grid = layer.map.grid;
    const reach = (tokenSize: number): number => ((2 * tokenSize - 1) * grid.size) / 2;
    const occupied: Occupant[] = [
      ...layer.map.tokens.filter((token) => !token.offMap && !token.offLevel).map((token) => ({ x: token.x, y: token.y, radius: reach(token.size) })),
      ...(this.arrived.get(target) ?? []),
    ];
    let moved = 0;
    for (const id of ids) {
      const token = map.tokens.find((candidate) => candidate.id === id);
      if (!token) continue;
      const radius = reach(token.size);
      // Where it was let go over the layer, else its middle: the nearest free square to that.
      const wanted = places?.[id];
      const spot = spiralSpot({ center: wanted ? { x: wanted.x, y: wanted.y } : { x: size.width / 2, y: size.height / 2 }, cell: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY, width: size.width, height: size.height, occupied, radius });
      const newId = layer.map.tokens.some((candidate) => candidate.id === id) ? `tok_${Date.now()}_${Math.random().toString(36).slice(2, 11)}` : id;
      // Connect hears first, so a player who controls the token keeps it there and is shown that scene.
      try {
        this.services.session?.()?.tokensMoved?.({ from, to: target, tokens: [{ id, newId }] });
      } catch (error) {
        console.warn('[Tabletop] Connect could not hear of the token moving:', error);
      }
      try {
        await writer.transfer(from, id, target, newId, spot);
      } catch (error) {
        this.unsaved('move to another scene', error);
        continue;
      }
      occupied.push({ ...spot, radius });
      this.arrived.set(target, [...(this.arrived.get(target) ?? []), { ...spot, radius }]);
      // Its mini and its look go with it.
      const mini = assignments.get(from, id);
      if (mini) {
        assignments.set(target, newId, mini);
        assignments.remove(from, id);
      }
      const style = boardData.style(from, id);
      if (style !== 'disc') {
        boardData.setStyle(target, newId, style);
        boardData.setStyle(from, id, 'disc');
      }
      board.changeToken(id, null);
      moved++;
    }
    if (moved > 0) new Notice(`Tabletop: ${moved === 1 ? 'a token' : `${moved} tokens`} moved to ${target.replace(/^.*\//, '').replace(/\.[^.]+$/, '')}.`);
  }

  /** The level the board was sent to from its height ruler, while Atlas (if it shows the scene) has not followed yet; null for Atlas's. */
  private chosenLevel: string | null = null;

  /** Game units a grid square spans on this map (the scene's own override, else the measuring rules'). */
  private unitDistance(): number {
    const grid = this.map?.rawGrid as { unitDistanceOverride?: unknown } | undefined;
    const own = grid?.unitDistanceOverride;
    if (typeof own === 'number' && Number.isFinite(own) && own > 0) return own;
    const measured = readMeasurement(this.rules.gridDefaults, this.map?.rawGrid).unitDistance;
    return measured > 0 ? measured : 5;
  }

  /**
   * The other levels of a scene with Atlas levels, as layers: the same file read for each level (its own floor image,
   * walls, lights and tokens), standing at its height above the level shown, on the scene's one grid.
   */
  private async readLevels(path: string, shown: BoardMap): Promise<ElevationLayerData[] | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    let text: string;
    try {
      text = await this.app.vault.read(file);
    } catch (error) {
      this.warn(`Tabletop: cannot read the levels of ${path}: ${error instanceof Error ? error.message : String(error)}.`);
      return null;
    }
    const { assignments, boardData } = this.services;
    const unit = this.unitDistance();
    const layers: ElevationLayerData[] = [];
    for (const level of shown.levels) {
      // The level shown is given too, kept ready (put away) as a layer for when another is shown.
      const current = level.id === shown.level;
      let map: BoardMap;
      try {
        map = readMap(path, text, level.id);
      } catch {
        continue;
      }
      // A light on several levels lights the shown one already: the layer does not light it twice.
      const lit = new Set(shown.lights.map((light) => light.id));
      if (!current) map = { ...map, lights: map.lights.filter((light) => !lit.has(light.id)) };
      const water = onFirstLevel(shown.levels, level.id) ? boardData.water(path) : null;
      layers.push({
        path: levelKey(level.id),
        elevation: levelRise(shown.levels, shown.level, level.id, unit),
        map,
        wallHeight: (id) => boardData.wallHeight(path, id),
        windowOf: (id) => boardData.windowOf(path, id),
        wallWidth: (id) => boardData.wallWidth(path, id),
        wallMaterial: (id) => boardData.wallMaterial(path, id),
        doorProp: (id) => boardData.doorProp(path, id),
        doorFlip: (id) => boardData.doorFlip(path, id),
        lightHeight: (id) => boardData.lightHeight(path, id) ?? DEFAULT_LIGHT_SQUARES,
        fogHeight: boardData.fogHeight(path),
        wallThickness: boardData.wallThickness(path),
        props: propsOnLevel(boardData.props(path), level.id, shown.levels),
        water: water ? { mask: water.mask, motion: boardData.waterMotion(path) } : null,
        // Levels share the scene's grid: each lies where it is.
        stands: NO_PLACEMENT,
        placement: (id) => assignments.get(path, id),
        style: (id) => boardData.style(path, id),
        ...(current ? { current: true } : {}),
      });
    }
    return layers;
  }

  /**
   * Another level from the height ruler: the board stays, shows that level at once and glides the camera to its floor;
   * Atlas, where it shows the scene, follows to the same level.
   */
  private async switchLevel(id: string): Promise<void> {
    const map = this.map;
    const path = this.path;
    if (!this.board || !map || !path || map.level === id || !map.levels.some((level) => level.id === id)) return;
    const rise = levelRise(map.levels, map.level, id, this.unitDistance());
    this.chosenLevel = id;
    this.board.switchingTo(levelKey(id));
    await this.read(-rise * map.grid.size);
    if (this.closed || this.path !== path) return;
    // Atlas follows; once it shows the level, it is Atlas's choice again (and its change does not read the scene twice).
    const store = tabViewOf(this.app, path)?.view.atlasStore;
    const state = store?.getState() as { setViewedLevel?: (level: string | null) => void } | undefined;
    if (state?.setViewedLevel) {
      try {
        state.setViewedLevel(id);
        this.chosenLevel = null;
      } catch (error) {
        console.warn('[Tabletop] Atlas could not show the level:', error);
      }
    }
  }

  /** A level's pill on the height ruler: show it, or hide it on this board (Atlas sets its height and its order). */
  private levelMenu(key: string, event: MouseEvent): void {
    const id = levelOfKey(key);
    const map = this.map;
    const path = this.path;
    if (id === null || !map || !path) return;
    const { boardData } = this.services;
    const hideKey = `${path}#${key}`;
    const active = id === map.level;
    const entries = (): MenuEntry[] => [
      { type: 'item', label: active ? 'Showing this level' : 'Show this level', disabled: active, onClick: () => { void this.switchLevel(id); } },
      { type: 'separator' },
      { type: 'item', label: boardData.layerHidden(hideKey) ? 'Show this layer' : active ? 'Hide this layer (show another level to hide this one)' : 'Hide this layer', disabled: active && !boardData.layerHidden(hideKey), onClick: () => { boardData.setLayerHidden(hideKey, !boardData.layerHidden(hideKey)); void this.readStack(); } },
    ];
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /** Tokens dropped on another level's pill on the height ruler: they go to that level, where they stand. */
  private async moveTokensToLevel(ids: readonly string[], level: string, places?: Readonly<Record<string, { x: number; y: number }>>): Promise<void> {
    const path = this.path;
    const map = this.map;
    if (!path || !map || !map.levels.some((entry) => entry.id === level)) return;
    let moved = 0;
    for (const id of ids) {
      if (!map.tokens.some((token) => token.id === id)) continue;
      try {
        await this.services.writer.update(path, id, () => ({ level }));
        // Let go over the level: where it was let go (levels share the scene's grid).
        const place = places?.[id];
        if (place) await this.services.writer.move(path, id, place.x, place.y);
        moved++;
      } catch (error) {
        this.unsaved('move to another level', error);
      }
    }
    if (moved > 0) new Notice(`Tabletop: ${moved === 1 ? 'a token' : `${moved} tokens`} moved to ${levelName(map.levels, level)}.`);
  }

  /** The scenes stacked with this one that were read, whose files are followed. */
  private stackPaths = new Set<string>();
  private stackRead = 0;
  private readonly reloadStack = debounce(() => { void this.readStack(); }, RELOAD_MS, true);

  /**
   * Reads the scenes stacked with this one (elevation layers: this scene's data says which, and how high) and gives them
   * to the board to draw beside it. A scene on its own has none.
   */
  private async readStack(): Promise<void> {
    const path = this.path;
    const board = this.board;
    if (!path || !board) return;
    const { assignments, boardData } = this.services;
    // A scene with Atlas levels: its other levels are the layers (the scene stacks of older Tabletop are left aside).
    const shown = this.map;
    if (shown && shown.levels.length > 1) {
      const turn = ++this.stackRead;
      const layers = await this.readLevels(path, shown);
      if (this.closed || turn !== this.stackRead || path !== this.path || !layers) return;
      this.stackPaths = new Set();
      this.stackLayers = layers.filter((layer) => !layer.current);
      this.arrived.clear();
      board.setStack(layers);
      const unit = this.unitDistance();
      board.setLayerMenu(shown.levels.map((level) => ({ path: levelKey(level.id), name: levelName(shown.levels, level.id), elevation: levelRise(shown.levels, shown.levels[0].id, level.id, unit), active: level.id === shown.level })).sort((a, b) => b.elevation - a.elevation));
      return;
    }
    const stack = boardData.stackOf(path);
    const mine = stack.find((member) => member.path === path);
    const turn = ++this.stackRead;
    const layers: ElevationLayerData[] = [];
    for (const member of mine ? stack : []) {
      // The scene shown is given too, kept ready as a layer for when another is shown.
      const current = member.path === path;
      const file = this.app.vault.getAbstractFileByPath(member.path);
      if (!(file instanceof TFile)) continue;
      try {
        const map = readMap(member.path, await this.app.vault.read(file), null);
        layers.push({
          path: member.path,
          elevation: member.elevation - (mine?.elevation ?? 0),
          map,
          wallHeight: (id) => boardData.wallHeight(member.path, id),
          windowOf: (id) => boardData.windowOf(member.path, id),
          wallWidth: (id) => boardData.wallWidth(member.path, id),
          wallMaterial: (id) => boardData.wallMaterial(member.path, id),
          doorProp: (id) => boardData.doorProp(member.path, id),
          doorFlip: (id) => boardData.doorFlip(member.path, id),
          lightHeight: (id) => boardData.lightHeight(member.path, id) ?? DEFAULT_LIGHT_SQUARES,
          fogHeight: boardData.fogHeight(member.path),
          wallThickness: boardData.wallThickness(member.path),
          props: boardData.props(member.path),
          water: (() => { const saved = boardData.water(member.path); const motion = boardData.waterMotion(member.path); return saved ? { mask: saved.mask, motion } : null; })(),
          // Where it stands on the plane, seen from this scene: the one being played is drawn as it is.
          stands: relativeTo(mine?.placement ?? NO_PLACEMENT, member.placement),
          placement: (id) => assignments.get(member.path, id),
          style: (id) => boardData.style(member.path, id),
          ...(current ? { current: true } : {}),
        });
      } catch (error) {
        this.warn(`Tabletop: cannot show the stacked scene ${member.path}: ${error instanceof Error ? error.message : String(error)}.`);
      }
    }
    if (this.closed || turn !== this.stackRead || path !== this.path) return;
    this.stackLayers = layers.filter((layer) => !layer.current);
    this.stackPaths = new Set(this.stackLayers.map((layer) => layer.path));
    // What arrived since the last read is in the files now.
    this.arrived.clear();
    board.setStack(layers);
    const name = (member: string): string => member.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
    board.setLayerMenu(mine ? stack.map((member) => ({ path: member.path, name: name(member.path), elevation: member.elevation, active: member.path === path })).sort((a, b) => b.elevation - a.elevation) : null);
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

  placeProp(glb: string, look?: PropLook): void {
    this.board?.placeProp(glb, look);
  }

  /** The floor of the map Atlas shows (its view's), else the one players were sent; unset is the first. */
  private shownLevel(path: string): string | null {
    if (this.chosenLevel !== null) return this.chosenLevel;
    const held = tabViewOf(this.app, path)?.view.atlasStore.getState();
    if (held?.viewedLevel) return held.viewedLevel;
    const presented = presentedSceneOf(this.app)?.get();
    return presented?.filePath === path ? presented.levelId ?? null : null;
  }

  private async read(shiftY = 0, carry: Placement = NO_PLACEMENT): Promise<void> {
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
      map = readMap(path, text, this.shownLevel(path));
    } catch (error) {
      this.warn(`Tabletop: cannot open ${path} in 3D: ${error instanceof Error ? error.message : String(error)}.`);
      return;
    }
    const rules = await this.readRules(path);
    if (this.closed || path !== this.path) return;
    const fresh = !this.board;
    let board = this.board;
    if (!board) {
      // No WebGL: say so where the board would be, instead of a blank tab; the next load tries again.
      if (!documentHasWebgl(this.contentEl.ownerDocument)) return this.showNoWebgl();
      try {
        board = this.makeBoard(this.preset());
      } catch (error) {
        console.warn('Tabletop: the 3D board could not start:', error);
        this.board = null;
        this.contentEl.querySelectorAll(':scope > canvas').forEach((canvas) => canvas.remove());
        return this.showNoWebgl();
      }
    }
    this.hideNoWebgl();
    this.rules = rules;
    const levelChanged = this.map !== null && this.map.path === map.path && this.map.level !== map.level;
    this.map = map;
    if (levelChanged) this.services.levelShown?.(path);
    this.atlasTools?.setMap(path);
    await board.load(map, shiftY, carry);
    this.menu?.refresh();
    this.watchAtlas();
    // The tracker shows when the map has combatants; the I key or the board settings show or hide it.
    if (fresh) this.initiative?.setOpen(this.liveInitiative().entries.length > 0);
    this.showInitiative();
    this.sessionChanged();
    void this.readStack();
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
    this.showTable();
    if (this.spellsPath !== path) { this.spellsPath = path; board.forgetCasts(); }
    const session = this.services.session?.() ?? null;
    if (!session?.hosting()) {
      board.receiveTemplates([]);
      // Not hosting: the GM's own spells, kept here alone.
      board.receiveSpells(this.localSpells.filter((cast) => cast.path === path).map(({ path: _path, ...cast }) => cast));
      board.setHandout(null);
      board.setBanner(null);
      board.refreshToolbar();
      return;
    }
    const overlay = session.overlay(path);
    board.tools.coneAngle = overlay.coneAngle;
    board.receiveTemplates(overlay.templates);
    board.receiveSpells(overlay.spells ?? []);
    const handout = overlay.handout;
    const file = handout ? this.app.vault.getAbstractFileByPath(handout.path) : null;
    board.setHandout(handout ? { title: handout.title, url: file instanceof TFile ? this.app.vault.getResourcePath(file) : null } : null);
    // Atlas still reading the map (a session just started, a tab just switched to) holds it in a moment: no banner.
    const held = this.services.writer.holder(path) !== null || this.services.writer.loading(path);
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

  /** Players in AR this board has said it heard of (once each, in the console). */
  private readonly viewersSeen = new Set<string>();

  /** A player's phone in augmented reality: its eye shows on this board while it looks at this board's map. */
  viewer(viewer: BoardViewer): void {
    if (!this.board) return;
    if (viewer.pose && !this.viewersSeen.has(viewer.from)) {
      this.viewersSeen.add(viewer.from);
      const at = viewer.pose.position.map((v) => Math.round(v)).join(', ');
      console.info(`[Tabletop] ${viewer.name} is in AR on ${viewer.mapPath}, at ${at}: ${viewer.mapPath === this.path ? 'their eye shows on this board' : `not this board's map (${this.path ?? 'none'})`}.`);
    }
    this.board.receiveViewer(viewer.from, viewer.name, viewer.color, viewer.mapPath === this.path ? viewer.pose : null);
  }

  /** Opens this board's map in an Atlas tab beside it, leaving the board in front. */
  private async openInAtlas(): Promise<void> {
    const file = this.path ? this.app.vault.getAbstractFileByPath(this.path) : null;
    if (!(file instanceof TFile)) return;
    // An Atlas tab of Obsidian's not loaded yet (deferred, since the app started) with this map: it is loaded, not the
    // map opened again.
    const deferred = this.app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE).find((leaf) => leaf.isDeferred && (leaf.getViewState().state as { file?: unknown } | undefined)?.file === file.path);
    if (deferred) {
      await deferred.loadIfDeferred();
      this.watchAtlas();
      this.sessionChanged();
      return;
    }
    // Atlas has a tab of this map already, not the one it shows: that tab is shown, not the map opened again.
    const found = tabViewOf(this.app, file.path);
    const tab = found?.view.tabMetaStore.getState().tabs.find((each) => each.filePath === file.path);
    if (found && tab && found.view.atlasStore.getState().mapPath !== file.path) {
      await found.view.switchToTab(tab.id);
      this.watchAtlas();
      this.sessionChanged();
      return;
    }
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

  private noWebgl: HTMLElement | null = null;

  /** Where the board would be: why it cannot be drawn here. */
  private showNoWebgl(): void {
    if (this.noWebgl || this.closed) return;
    const doc = this.contentEl.ownerDocument;
    const box = doc.win.createEl('div');
    box.className = 'atlas-tabletop-no-webgl';
    box.setAttribute('role', 'alert');
    const title = doc.win.createEl('strong');
    title.textContent = NO_WEBGL_TITLE;
    const help = doc.win.createEl('p');
    help.textContent = NO_WEBGL_HELP;
    box.append(title, help);
    this.contentEl.appendChild(box);
    this.noWebgl = box;
  }

  private hideNoWebgl(): void {
    this.noWebgl?.remove();
    this.noWebgl = null;
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
      spellBook: () => this.services.spellBook?.() ?? null,
      layerHidden: (path) => path !== this.path && boardData.layerHidden(levelOfKey(path) !== null ? `${this.path ?? ''}#${path}` : path),
      water: () => { if (this.map && !onFirstLevel(this.map.levels, this.map.level)) return null; const path = mapPath(); const saved = boardData.water(path); const motion = boardData.waterMotion(path); return saved || motion ? { mask: saved?.mask ?? null, motion } : null; },
      saveWater: (mask) => boardData.setWater(mapPath(), mask),
      saveWaterMotion: (motion) => boardData.setWaterMotion(mapPath(), motion),
      undo: () => this.travel('undo'),
      redo: () => this.travel('redo'),
      canUndo: () => this.services.history?.canUndo(this.undoPaths()) === true,
      canRedo: () => this.services.history?.canRedo(this.undoPaths()) === true,
      recordUndo: (step) => this.services.history?.push({ ...step, paths: [mapPath()] }),
      readImage: async (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
      },
      readPicture: async (path, maxSide) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        // A small map decodes whole; a video is no picture of tiles.
        if (!(file instanceof TFile) || file.stat.size < MOSAIC_FROM_BYTES || isVideoPath(path)) return null;
        return mapPicture(this.app, file, maxSide);
      },
      readMini: (path): Promise<LoadedMini> => this.library(path).load(path),
      placement: (id) => assignments.get(mapPath(), id),
      style: (id) => boardData.style(mapPath(), id),
      props: () => propsOnLevel(boardData.props(mapPath()), this.map?.level ?? null, this.map?.levels ?? []),
      rules: () => this.rules,
      moveToken: (id, x, y) => {
        writer.move(mapPath(), id, x, y).catch((error: unknown) => this.unsaved('move', error));
      },
      moveTokens: (moves) => {
        writer.moveMany(mapPath(), moves).catch((error: unknown) => this.unsaved('move', error));
      },
      claimSpell: (id) => {
        // Once for the map, whichever of the GM's boards sees the cast first.
        const key = `${mapPath()}\u0000${id}`;
        if (claimedSpells.has(key)) return false;
        claimedSpells.add(key);
        return true;
      },
      summonTokens: (tokens) => {
        const path = mapPath();
        const inputs = tokens.map((token) => {
          // A statblock by link or name, when the vault has one.
          const link = (token.statblock ?? token.name).replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();
          const file = this.app.metadataCache.getFirstLinkpathDest(link, path);
          return { x: token.x, y: token.y, kind: 'character', name: token.name, imagePath: '', ...(file ? { statblockPath: file.path } : {}) };
        });
        try {
          const { ids, done } = writer.addTokensNow(path, inputs);
          done.catch((error: unknown) => this.unsaved('summons', error));
          return ids;
        } catch (error) {
          this.unsaved('summons', error);
          return [];
        }
      },
      removeTokens: (ids) => { for (const id of ids) this.deleteToken(id); },
      moveProp: (id, x, y) => boardData.moveProp(mapPath(), id, x, y),
      scaleProp: (id, scale) => boardData.setPropScale(mapPath(), id, scale),
      liftProp: (id, lift) => boardData.setPropLift(mapPath(), id, lift),
      snapProps: () => this.services.snapProps?.() ?? true,
      setSnap: (kind: 'tokens' | 'props', on: boolean) => {
        if (kind === 'props') { this.services.setSnapProps?.(on); return; }
        // Tokens: the map's own Snap to grid, as Atlas has it; shown at once, then saved to the map.
        if (this.map) (this.map.grid as { snap: boolean }).snap = on;
        this.board?.refreshToolbar();
        writer.setSnapToGrid(mapPath(), on).catch((error: unknown) => this.unsaved('snap to grid', error));
      },
      addProp: (glb, x, y, look) => { const level = this.map && !onFirstLevel(this.map.levels, this.map.level) ? this.map.level : null; boardData.addProp(mapPath(), { glb, x, y, rotation: 0, ...lookOf(look), ...(level ? { level } : {}) }); },
      openNote: (path) => { void this.app.workspace.openLinkText(path, mapPath(), 'tab'); },
      tokenMenu: (id, event) => this.tokenMenu(id, event),
      propMenu: (id, event) => {
        const menu = new Menu();
        const solid = boardData.props(mapPath()).find((prop) => prop.id === id)?.solid === true;
        menu.addItem((item) => item.setTitle('Make solid').setIcon('box').setChecked(solid).onClick(() => boardData.setPropSolid(mapPath(), id, !solid)));
        const prop = boardData.props(mapPath()).find((candidate) => candidate.id === id);
        if (prop && this.services.saveVariant) {
          menu.addItem((item) => item.setTitle('Save as variant').setIcon('copy-plus').onClick(() => {
            const base = prop.glb.split('/').pop()?.replace(/\.glb$/i, '') ?? 'Prop';
            new VariantModal(this.app, `${base} variant`, (name) => {
              this.services.saveVariant?.({ name, glb: prop.glb, ...lookOf(prop) });
              new Notice(`Tabletop: ${name} saved to the gallery's props.`);
            }).open();
          }));
        }
        menu.addItem((item) => item.setTitle('Remove prop').setIcon('trash').onClick(() => boardData.removeProp(mapPath(), id)));
        menu.showAtMouseEvent(event);
      },
      copyToken: (id, newId, x, y) => {
        writer.copy(mapPath(), id, newId, x, y).catch((error: unknown) => this.unsaved('copy', error));
      },
      rotateTokens: (turns) => {
        writer.rotate(mapPath(), turns).catch((error: unknown) => this.unsaved('rotation', error));
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
        const token = this.map?.tokens.find((candidate) => candidate.id === id);
        const path = token?.statblockPath;
        if (!token || !path || !this.board) return;
        this.hoverCard ??= new StatblockHoverCard(this.board.canvas.ownerDocument, (formula, label, side) => this.dice?.cardRoll(this.hoverToken, formula, label, side), () => this.board?.previewEnded());
        this.hoverToken = id;
        // The rolls of Atlas's own window (a click on a dice link) throw the board's dice too.
        this.stopWindowRolls ??= routeAtlasWindowRolls(this.board.canvas.ownerDocument, (formula, label, side) => this.dice?.cardRoll(this.hoverToken, formula, label, side));
        const { clientX, clientY } = event;
        const board = this.board;
        const card = this.hoverCard;
        // Otherwise: Atlas's card drawn here, and where this Atlas draws none, Obsidian's page preview of the note.
        const drawn = (): void => {
          void card.show(atlasCardHost(this.app, path, token.name ?? undefined), { x: clientX, y: clientY }, () => {
            this.app.workspace.trigger('hover-link', { event, source: HOVER_SOURCE, hoverParent: this, targetEl: board.canvas, linktext: path, sourcePath: mapPath() });
          });
        };
        // Atlas's own window first: the same one its map opens, with the token's portrait and live HP.
        const previews = atlasPreviews(this.rollView());
        if (!previews) {
          drawn();
          return;
        }
        card.adopt(() => previews.hide(id));
        previews.show(previewAnchor(token), clientX, clientY).catch((error: unknown) => {
          console.warn('Tabletop: Atlas did not open its stat block window, drawing the card here instead:', error);
          drawn();
        });
      },
      statblockPreviewEnd: () => this.hoverCard?.hide(),
      warn: (message) => this.warn(message),
      togglePlayerView: () => this.services.togglePlayerView(this),
      laser: () => this.services.laser(),
      setLaser: (changes) => this.services.setLaser(changes),
      setLighting: (choice) => this.services.setLighting?.(choice),
      setTiltShift: (on) => this.services.setTiltShift?.(on),
      ...(this.services.setSeeThrough && { setSeeThrough: (on: boolean) => this.services.setSeeThrough?.(on) }),
      ...(this.services.setSeeThroughSize && { setSeeThroughSize: (squares: number) => this.services.setSeeThroughSize?.(squares) }),
      ...(this.services.setLayerLook && { setLayerLook: (look: LayerLook) => this.services.setLayerLook?.(look) }),
      ...(this.services.setLineOfSight && { setLineOfSight: (mode: SightMode) => this.services.setLineOfSight?.(mode) }),
      switchLayer: (path: string) => { const level = levelOfKey(path); if (level !== null) void this.switchLevel(level); else void this.switchMember(path); },
      layerMenu: (path: string, event: MouseEvent) => (levelOfKey(path) !== null ? this.levelMenu(path, event) : this.rulerMenu(path, event)),
      layerPlaced: (path: string, placement: Placement) => this.placeLayer(path, placement),
      layerReset: (path: string) => this.resetLayer(path),
      tablePlaced: (table: SavedArTable) => { if (this.path) this.services.boardData.setArTable(this.path, table); },
      tableRemoved: () => { if (this.path) this.services.boardData.setArTable(this.path, null); },
      moveTokensToLayer: (ids, path, places, follow) => {
        const level = levelOfKey(path);
        void (async () => {
          if (level !== null) await this.moveTokensToLevel(ids, level, places);
          else await this.moveTokensToLayer(ids, path, places);
          // Let go over the layer: it is the one shown now, the tokens on it.
          if (follow && !this.closed) { if (level !== null) await this.switchLevel(level); else await this.switchMember(path); }
        })();
      },
      ...(this.services.setSightStyle && { setSightStyle: (style: SightStyle) => this.services.setSightStyle?.(style) }),
      ...(this.services.setWallEdges && { setWallEdges: (edges: WallEdges) => this.services.setWallEdges?.(edges) }),
      setOcclusion: (on) => this.services.setOcclusion?.(on),
      autoRoll: () => this.services.diceSettings().autoRoll,
      setAutoRoll: (on) => this.services.setAutoRoll?.(on),
      playerViewOpen: () => this.services.playerViewOpen(mapPath()),
      initiativeOpen: () => this.initiative?.isOpen ?? false,
      toggleInitiative: () => this.initiative?.setOpen(!this.initiative.isOpen),
      wallMaterial: (id) => boardData.wallMaterial(mapPath(), id),
      materialDefaults: () => this.services.materialDefaults?.() ?? {},
      wallHeight: (id) => boardData.wallHeight(mapPath(), id),
      windowOf: (id) => boardData.windowOf(mapPath(), id),
      wallWidth: (id) => boardData.wallWidth(mapPath(), id),
      setWallHeight: (id, squares, whole) => boardData.setWallHeight(mapPath(), whole ? wholeWall(this.map?.walls ?? [], id) : [id], squares),
      setWallWidth: (id, squares, whole) => boardData.setWallWidth(mapPath(), whole ? wholeWall(this.map?.walls ?? [], id) : [id], squares),
      setWindowSpan: (id, span, whole) => {
        const walls = this.map?.walls ?? [];
        const ids = whole ? wholeWall(walls, id).filter((other) => walls.some((candidate) => candidate.id === other && isWindow(candidate))) : [id];
        boardData.setWindow(mapPath(), ids.length > 0 ? ids : [id], span);
      },
      setLightHeight: (id, squares) => boardData.setLightHeight(mapPath(), id, squares),
      doorProp: (id) => boardData.doorProp(mapPath(), id),
      doorFlip: (id) => boardData.doorFlip(mapPath(), id),
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
      pinMenu: (id, event) => this.pinMenu(id, event),
      // Until the GM moves the slider, the board is as light as Atlas's scene (daylight when Atlas's lighting is off).
      ambient: () => boardData.ambient(mapPath()) ?? (this.map?.lighting.enabled ? this.map.lighting.ambient : 1),
      setAmbient: (level) => boardData.setAmbient(mapPath(), level),
      tint: () => boardData.tint(mapPath()),
      setTint: (color) => boardData.setTint(mapPath(), color),
      clearTint: () => boardData.clearTint(mapPath()),
      lightHeight: (light) => boardData.lightHeight(mapPath(), light.id) ?? DEFAULT_LIGHT_SQUARES,
      lightMenu: (id, event) => this.lightMenu(id, event),
      miniTurn: (tokenId) => assignments.get(mapPath(), tokenId)?.turn ?? null,
      setMiniTurn: (tokenId, turn) => {
        const have = assignments.get(mapPath(), tokenId);
        if (have) assignments.set(mapPath(), tokenId, { ...have, turn });
      },
      assignMini: (tokenId, glb) => {
        const have = assignments.get(mapPath(), tokenId);
        assignments.set(mapPath(), tokenId, { mini: glb, scale: have?.scale ?? 1, turn: have?.turn ?? 0, ...(have?.base ? { base: have.base } : {}) });
      },
      materials: () => this.services.materials.list().map((folder) => ({ path: folder.path, name: folder.name, thumb: this.services.materials.thumbnail(folder.path) })),
      boardMode: () => (this.app.loadLocalStorage(BOARD_MODE_KEY) === 'edit' ? 'edit' : 'play'),
      setBoardMode: (mode) => this.app.saveLocalStorage(BOARD_MODE_KEY, mode),
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
        if (action.type === 'spell' && path) { this.gmSpell(path, action.change); return; }
        if (!session || !path) return;
        if (action.type !== 'template') return;
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
  /** A pin's right-click menu: whether players may read its note, as Atlas's pin menu has it. */
  private pinMenu(id: string, event: MouseEvent): void {
    const path = this.path;
    const map = this.map;
    if (!path || !map) return;
    const entries = (): MenuEntry[] => {
      const pin = this.map?.pins.find((each) => each.id === id);
      return pin ? pinMenuEntries(pin, (readable) => {
        pin.readable = readable;
        this.board?.refresh();
        this.services.writer.setPinReadable(path, id, readable).catch((error: unknown) => this.unsaved('pin', error));
      }) : [];
    };
    if (entries().length === 0) return;
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

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
      // A plain wall can be made Atlas's window (it stops only tokens; sight and light pass both ways), and back. Not a
      // room's outline (Atlas 0.14): it is the rooms' edge, never edited by hand, and has no wall in the file to change.
      if (!door && wall.chain !== 'rooms') {
        const glazed = isWindow(wall);
        const makeWindow = (ids: readonly string[], on: boolean): void => {
          for (const other of this.map?.walls ?? []) if (ids.includes(other.id) && other.type === 'solid') other.blocks = on ? 'movement' : null;
          this.board?.refresh();
          writer.setWindow(path, ids, on).catch((error: unknown) => this.unsaved('window', error));
        };
        list.push({ type: 'item', label: glazed ? 'Make plain wall' : 'Make window', onClick: () => makeWindow([id], !glazed) });
        if (whole.length > 1) list.push({ type: 'item', label: glazed ? 'Make the whole wall plain' : 'Make the whole wall a window', onClick: () => makeWindow(whole, !glazed) });
      }
      // Its own width, by fiftieths of a square; until set, as thick as the map's walls.
      const ownWidth = boardData.wallWidth(path, id);
      const width = ownWidth ?? boardData.wallThickness(path);
      const setWidth = (next: number): void => boardData.setWallWidth(path, [id], Math.min(WIDTH_MAX, Math.max(WIDTH_STEP, Math.round(next * 100) / 100)));
      list.push({
        type: 'item', label: ownWidth === null ? 'Width (default)' : 'Width', keepOpen: true, onClick: () => undefined,
        stepper: { value: `${width} sq`, label: 'Width', canDecrement: width > WIDTH_STEP, onDecrement: () => setWidth(width - WIDTH_STEP), onIncrement: () => setWidth(width + WIDTH_STEP) },
      });
      if (whole.length > 1) list.push({ type: 'item', label: 'Give the whole wall this width', onClick: () => boardData.setWallWidth(path, whole, width) });
      if (ownWidth !== null || whole.some((other) => boardData.wallWidth(path, other) !== null)) {
        list.push({ type: 'item', label: 'Back to the default width', onClick: () => boardData.setWallWidth(path, whole, null) });
      }
      // Atlas's window: where its opening begins and ends, by quarter squares, inside the wall.
      if (isWindow(wall)) {
        const span = windowSpan(height, boardData.windowOf(path, id));
        const setSpan = (ids: readonly string[], next: { bottom: number; top: number }): void => boardData.setWindow(path, ids, windowSpan(height, next));
        list.push({
          type: 'item', label: 'Window bottom', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${span.bottom} sq`, label: 'Window bottom', canDecrement: span.bottom > 0, onDecrement: () => setSpan([id], { ...span, bottom: span.bottom - WINDOW_STEP }), onIncrement: () => setSpan([id], { bottom: Math.min(span.bottom + WINDOW_STEP, span.top - WINDOW_STEP), top: span.top }) },
        });
        list.push({
          type: 'item', label: 'Window top', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${span.top} sq`, label: 'Window top', canDecrement: span.top - WINDOW_STEP > span.bottom, onDecrement: () => setSpan([id], { ...span, top: span.top - WINDOW_STEP }), onIncrement: () => setSpan([id], { ...span, top: span.top + WINDOW_STEP }) },
        });
        const windowWall = wholeWall(this.map?.walls ?? [], id).filter((other) => this.map?.walls.some((candidate) => candidate.id === other && isWindow(candidate)));
        if (windowWall.length > 1) list.push({ type: 'item', label: 'Give the whole window this opening', onClick: () => boardData.setWindow(path, windowWall, span) });
        if (windowWall.some((other) => boardData.windowOf(path, other) !== null)) list.push({ type: 'item', label: 'Default window opening', onClick: () => boardData.setWindow(path, windowWall.length > 0 ? windowWall : [id], null) });
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
        // How the door is hung: half a turn (hinge at the other end, opening to the other side), or mirrored (only the hinge moves).
        list.push({ type: 'item', label: 'Rotate 180°', onClick: () => boardData.rotateDoor(path, id) });
        list.push({ type: 'item', label: 'Mirror', onClick: () => boardData.mirrorDoor(path, id) });
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
    // While no Atlas view holds the map (Atlas still reading it as a session starts, or its tab not the active one),
    // its views are followed, so the board knows at once when one does (no layout change says so).
    this.stopWaiting?.();
    this.stopWaiting = view === null && this.path && !this.closed ? this.services.writer.whenHeld(this.path, () => { this.stopWaiting = null; this.watchAtlas(); }) : null;
    if (this.watched?.view === view) return;
    this.watched?.stop();
    this.watched = null;
    if (view) {
      let held = view.atlasStore.getState().initiative;
      const stop = view.atlasStore.subscribe(() => {
        const state = view.atlasStore.getState();
        // Atlas moved to another map in that view: the file is this map's tracker again.
        if (state.mapPath !== this.path) { this.watchAtlas(); return; }
        // The GM went to another floor (Atlas 0.10): the board shows that floor.
        if (state.viewedLevel !== undefined && this.map && resolveLevel(this.map.levels, state.viewedLevel) !== this.map.level) this.reload();
        if (state.initiative === held) return;
        held = state.initiative;
        this.showInitiative();
        this.menu?.refresh();
      });
      this.watched = { view, stop };
    }
    this.showInitiative();
    // The dice log listens on the Atlas view holding the map.
    this.dice?.listen();
    // Atlas opened or closed the map: whether players see the board's changes may have changed with it.
    this.sessionChanged();
    this.followTabs();
  }

  /** Stops following Atlas's views for one that holds this map (`watchAtlas`). */
  private stopWaiting: (() => void) | null = null;

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
  private sceneTabEntries(): SceneTabEntry[] {
    const found = this.path ? tabViewOf(this.app, this.path) : null;
    if (!found) return [];
    const presented = presentedSceneOf(this.app)?.get()?.tabId ?? null;
    return found.view.tabMetaStore.getState().tabs.map((tab) => ({
      id: tab.id, name: tab.displayName, filePath: tab.filePath, active: tab.filePath === this.path, presented: tab.id === presented,
      loaded: tab.isLoaded === true, dirty: tab.isDirty === true,
      ...this.layerLabel(tab.filePath),
    }));
  }

  /** A scene's place in a stack, for its tab: "base", or its elevation ("+2", "-1"). */
  private layerLabel(path: string): { layer?: string } {
    const { boardData } = this.services;
    const layer = boardData.layerOf(path);
    if (layer) return { layer: layer.elevation > 0 ? `+${layer.elevation}` : String(layer.elevation) };
    return boardData.layersOf(path).length > 0 ? { layer: 'base' } : {};
  }

  /**
   * A scene tab's layers menu: stack the scene on another one (an upper floor, a balcony), or take it out of the stack;
   * its elevation is set on the height ruler. Opening either scene of a stack in 3D shows them together.
   */
  private layerMenu(tabId: string, at: { x: number; y: number }): void {
    const found = this.path ? tabViewOf(this.app, this.path) : null;
    const tabs = found?.view.tabMetaStore.getState().tabs ?? [];
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    const { boardData } = this.services;
    const path = tab.filePath;
    const others = (): Array<{ path: string; name: string }> => tabs.filter((entry) => entry.filePath !== path).map((entry) => ({ path: entry.filePath, name: entry.displayName }));
    // Connect hosting a split party: who sees this scene, as the eye's menu on Atlas's own tabs.
    const viewId = found!.view.viewId;
    const session = (): BoardSession | null => this.services.session?.() ?? null;
    const presentTo = presentToEntry(
      () => session()?.presentTo?.(viewId, tabId) ?? null,
      (playerId) => { session()?.choosePresentTo?.(viewId, tabId, playerId); this.menu?.refresh(); },
      () => { session()?.everyoneBack?.(); },
    );
    const entries = (): MenuEntry[] => {
      const layer = boardData.layerOf(path);
      const hasLayers = boardData.layersOf(path).length > 0;
      const list: MenuEntry[] = presentTo ? [presentTo, { type: 'separator' }] : [];
      if (hasLayers) {
        const names = boardData.layersOf(path).map((member) => member.path.replace(/^.*\//, '').replace(/\.[^.]+$/, ''));
        list.push({ type: 'item', label: `Base of ${names.join(', ')}`, disabled: true, onClick: () => {} });
      } else if (layer) {
        // A scene stacked by an older Tabletop: it can still leave its stack (floors are Atlas levels now).
        list.push({ type: 'item', label: 'Remove from stack', destructive: true, onClick: () => { boardData.clearLayer(path); this.sceneTabs?.refresh(); } });
      }
      if (!hasLayers && !layer) list.push({ type: 'item', label: 'Floors are Atlas levels: add one in Atlas', disabled: true, onClick: () => {} });
      return list;
    };
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, at, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /** Any scene of the vault as the base of a layer, by the modal. */
  private pickLayerBase(path: string): void {
    const maps = this.app.vault.getFiles().filter((file) => file.path.toLowerCase().endsWith('.atlasmap')).map((file) => file.path);
    new LayerModal(this.app, this.services.boardData, path, maps).open();
  }

  /** The menu of a scene's pill on the height ruler: its elevation, placing it on the plane or putting it back, hiding it. */
  private rulerMenu(path: string, event: MouseEvent): void {
    const board = this.board;
    const here = this.path;
    if (!board || !here) return;
    const { boardData } = this.services;
    const active = path === here;
    // The base scene is the reference every other scene is placed against: it never moves.
    const base = boardData.layerOf(path) === null;
    const adjusting = board.adjustingPath === path;
    // Its elevation, a square at a time (the base scene is the ground every other one stands on).
    const elevation = (): MenuEntry[] => {
      const layer = boardData.layerOf(path);
      if (!layer) return [];
      const step = (delta: number): void => {
        const now = boardData.layerOf(path);
        if (!now) return;
        boardData.setLayer(path, now.base, Math.round((now.elevation + delta) * 100) / 100);
        this.sceneTabs?.refresh();
        void this.readStack().then(() => this.menu?.refresh());
      };
      return [
        { type: 'item', label: 'Elevation (squares)', keepOpen: true, onClick: () => {}, stepper: { value: String(layer.elevation), label: 'elevation', canDecrement: true, onDecrement: () => step(-1), onIncrement: () => step(1) } },
        { type: 'separator' },
      ];
    };
    const entries = (): MenuEntry[] => [
      ...elevation(),
      { type: 'item', label: adjusting ? 'Stop adjusting' : base ? 'Adjust position (the base scene never moves)' : active ? 'Adjust position (open another scene to move this one)' : 'Adjust position', disabled: base || active, onClick: () => board.setAdjust(adjusting ? null : path) },
      { type: 'item', label: 'Reset position', disabled: base || active || isNoPlacement(boardData.placementOf(path)), onClick: () => this.resetLayer(path) },
      { type: 'separator' },
      { type: 'item', label: boardData.layerHidden(path) ? 'Show this layer' : active ? 'Hide this layer (open another scene to hide this one)' : 'Hide this layer', disabled: active && !boardData.layerHidden(path), onClick: () => { boardData.setLayerHidden(path, !boardData.layerHidden(path)); void this.readStack(); } },
    ];
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /**
   * A scene of the stack was put somewhere on the plane, as seen from the scene being played: kept as its own placement
   * in the base scene's frame, so it lines up with the base whichever scene is played. The base scene never moves.
   */
  private placeLayer(path: string, placement: Placement): void {
    const here = this.path;
    if (!here) return;
    const { boardData } = this.services;
    if (!boardData.layerOf(path)) return;
    boardData.setPlacement(path, compose(boardData.placementOf(here), placement));
  }

  /** A scene back where its grid puts it, against the base scene. */
  private resetLayer(path: string): void {
    this.services.boardData.setPlacement(path, NO_PLACEMENT);
  }

  /**
   * Another scene of the stack from the layer menu: the board stays (no new graphics context, no new scene), shows the
   * scene at once and glides the camera to its floor; Atlas follows in the background.
   */
  private async switchMember(path: string): Promise<void> {
    const board = this.board;
    const from = this.path;
    if (!board || !from || path === from) return;
    const { boardData } = this.services;
    const stack = boardData.stackOf(from);
    const before = stack.find((member) => member.path === from);
    const after = stack.find((member) => member.path === path);
    if (!before || !after) return;
    const cell = this.map?.grid.size ?? 70;
    const found = tabViewOf(this.app, from);
    const tab = found?.view.tabMetaStore.getState().tabs.find((entry) => entry.filePath === path);
    if (found && tab) void found.view.switchToTab(tab.id);
    this.path = path;
    // The player view showed the scene this tab showed: it waits for the new scene's board.
    this.playerWindow?.waiting(true);
    this.playerWindow = null;
    this.retitle();
    // The camera keeps its view of the base scene: carried by the change of frame between the two scenes' places on the plane.
    board.switchingTo(path);
    await this.read((before.elevation - after.elevation) * cell, relativeTo(after.placement, before.placement));
    if (!this.closed && this.path === path) this.services.boardReady(this);
    this.sceneTabs?.refresh();
    this.app.workspace.requestSaveLayout();
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
    const ran = new AtlasBridge(this.app).runInAtlas(tab.filePath, 'atlas-vtt:send-map-to-player-view', this.leaf);
    if (!ran) new Notice('Tabletop: Atlas could not show this scene to players.');
    if (tab.filePath !== this.path) await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file: tab.filePath }, active: true });
    this.sceneTabs?.refresh();
  }

  /** The tracker as Atlas holds it while it has the map open, else as the file has it. */
  /** Draws the tracker, and rings on the board the combatants whose turn it is. */
  private showInitiative(): void {
    this.initiative?.render();
    const fight = this.liveInitiative();
    this.board?.setActiveTokens(currentEntries(fight).map((entry) => entry.tokenId));
    this.board?.setDelayedTokens(delayedTokens(fight));
    // The turn passing flashes a banner; opening the board in the middle of a fight does not.
    const turn = turnAnnouncement(fight);
    if (turn && this.lastTurn !== null && this.lastTurn !== turn.key) this.board?.flashTurn(turn.text);
    this.lastTurn = turn?.key ?? null;
  }

  /** The turn last announced, to flash the banner only when it changes. */
  private lastTurn: string | null = null;

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
      this.showInitiative();
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
      miniBase: () => assignments.get(map.path, id)?.base ?? 'none',
      standee: () => boardData.style(map.path, id) === 'standee',
      pov: () => this.board?.povToken === id,
      seeing: () => this.board?.seeingFrom === id,
      lightHeight: () => (this.map?.lights.some((light) => light.tokenId === id) ? boardData.lightHeight(map.path, id) ?? DEFAULT_LIGHT_SQUARES : null),
      controllers: () => this.services.session?.()?.controllers?.(id) ?? null,
      spellAsked: () => this.services.session?.()?.spellRequest?.(map.path, id) != null,
      gate: () => this.board?.gateFor(id)?.name ?? null,
      icon: (element, name) => setIcon(element, name),
      actions: {
        setCondition: (condition, active) => this.changeConditions(id, (now) => conditionChange(now, condition, active), 'condition'),
        stepCondition: (condition, delta) => this.changeConditions(id, (now) => conditionStep(now, condition, delta), 'condition'),
        setHidden: (hidden) => this.changeToken(id, { hidden }, () => ({ isHidden: hidden }), hidden ? 'hiding' : 'showing'),
        setInitiative: (join) => this.setInitiative(id, join),
        setPov: (on) => this.board?.setPov(on ? id : null),
        seeThrough: (on) => { this.board?.seeFrom(on ? id : null); },
        castSelf: () => { this.board?.castThrough(id); },
        goThroughGate: () => { this.board?.goThroughGate(id); },
        assignMini: () => {
          const now = token();
          if (now) new MiniPicker(this.app, minis, tokenName(now), assignments.get(map.path, id), (result) => assignments.set(map.path, id, result)).open();
        },
        removeMini: () => assignments.remove(map.path, id),
        setBase: (base) => {
          const have = assignments.get(map.path, id);
          if (have) assignments.set(map.path, id, { ...have, base });
        },
        setStandee: (standee) => boardData.setStyle(map.path, id, standee ? 'standee' : 'disc'),
        setLightHeight: (height) => boardData.setLightHeight(map.path, id, Math.max(0, Math.round(height * 4) / 4)),
        setController: (playerId, controls) => {
          this.services.session?.()?.setController?.(id, playerId, controls);
          this.menu?.refresh();
        },
        ...(this.services.session?.()?.requestSpell ? { askSpell: () => this.askSpell(id) } : {}),
        reset: () => this.resetToken(id),
        kill: () => this.killToken(id),
        remove: () => this.deleteToken(id),
      },
    });
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  /**
   * A spell change from the GM's board: one cast through a token's eyes (to every player of the scene while Connect
   * hosts, else kept on this board alone), one erased (the Template tool's tap, Ctrl + click), or the scene's cleared.
   */
  private gmSpell(path: string, change: SpellChange): void {
    const session = this.services.session?.();
    if (session?.hosting()) {
      if ('add' in change) {
        const words = change.name ? { name: change.name, ...(change.about ? { about: change.about } : {}) } : undefined;
        if (!session.castSpell?.(path, change.add, change.rules, words)) new Notice('Tabletop: this Connect cannot take the GM\'s spells; update it.');
      } else if ('remove' in change) session.eraseSpell?.(path, change.remove);
      else if ('clear' in change) session.clearSpells?.(path);
      return;
    }
    if ('add' in change) {
      this.localSpells.push({ path, id: `g${this.nextLocalSpell++}`, owner: GM_SPELL_OWNER, color: '#ffffff', spell: change.add, ...(change.rules ? { rules: change.rules } : {}), ...(change.name ? { name: change.name } : {}), ...(change.about ? { about: change.about } : {}) });
    } else if ('remove' in change) {
      this.localSpells = this.localSpells.filter((cast) => !(cast.path === path && cast.id === change.remove));
    } else if ('clear' in change) {
      this.localSpells = this.localSpells.filter((cast) => cast.path !== path);
    } else return;
    this.sessionChanged();
  }

  /**
   * The GM asks the token's player for a spell (Cast, Player): the spell search over the board, the spell drawn at the
   * token; without spell notes (or a board), the ask's form. Connect sends it.
   */
  private askSpell(id: string): void {
    const map = this.map;
    const session = this.services.session?.();
    const token = map?.tokens.find((candidate) => candidate.id === id);
    if (!map || !session?.requestSpell || !token) return;
    const name = tokenName(token);
    const waiting = session.spellRequest?.(map.path, id) ?? null;
    const send = (ask: SpellAsk): void => {
      let players = session.requestSpell?.(map.path, id, ask) ?? null;
      let plain = false;
      if (players === null && (ask.effect !== undefined || ask.about !== undefined || ask.rules !== undefined)) {
        // An older Connect takes only the shape and sizes: the ask goes without the spell's words.
        const { effect: _effect, about: _about, rules: _rules, ...shape } = ask;
        players = session.requestSpell?.(map.path, id, shape) ?? null;
        plain = players !== null;
      }
      if (players === null) new Notice('Tabletop: the spell could not be asked (is the scene shown to players?).');
      else if (players === 0) new Notice(`Tabletop: asked. None of ${name}'s players has this scene now; they are asked when they do.`);
      else new Notice(`Tabletop: asked ${name}'s player${players === 1 ? '' : 's'} for ${ask.name ?? 'the spell'}.`);
      if (plain) new Notice('Tabletop: this Connect cannot send the spell\'s words; update it to show players the description.');
    };
    const withdraw = waiting && session.cancelSpellRequest ? () => session.cancelSpellRequest?.(map.path, id) : null;
    const panel = this.board?.askSpellPanel(id, {
      title: `Ask ${name}'s player for a spell`,
      ...(waiting ? { note: `Waiting now: ${waiting.name ?? 'a spell'}. Sending another replaces it.` } : {}),
      send, ...(withdraw ? { withdraw } : {}),
    });
    if (!panel) new SpellAskModal(this.app, name, map.grid.size, waiting, send, withdraw).open();
  }

  /**
   * Shows a change of a token at once (`shown`, the board's fields) and saves it (`change`, the token's fields as
   * Atlas holds them); `what` names it if the save fails.
   */
  private changeToken(id: string, shown: Partial<BoardToken>, change: TokenChange, what: string): void {
    const token = this.map?.tokens.find((candidate) => candidate.id === id);
    if (!token) return;
    this.board?.changeToken(id, { ...token, ...shown });
    this.showInitiative();
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
      this.showInitiative();
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

/** Asks for a variant's name: Enter or Save keeps it, an empty one is not kept. */
class VariantModal extends Modal {
  constructor(app: App, private readonly suggested: string, private readonly save: (name: string) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Save as variant');
    const root = this.contentEl;
    root.createEl('p', { text: 'A new prop in the gallery, placed with this one\'s size, solid setting and standing height.' });
    const input = root.createEl('input', { type: 'text', value: this.suggested, attr: { 'aria-label': 'Variant name' } });
    input.addClass('atlas-tabletop-variant-name');
    const done = (): void => { const name = input.value.trim(); if (!name) return; this.close(); this.save(name); };
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); done(); } });
    const row = root.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', done);
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    window.setTimeout(() => { input.focus(); input.select(); }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** A level's place on the height ruler and among the board's layers (scene stacks go by scene path, never this). */
const LEVEL_KEY = 'atlas-level:';
function levelKey(id: string): string {
  return LEVEL_KEY + id;
}
function levelOfKey(key: string): string | null {
  return key.startsWith(LEVEL_KEY) ? key.slice(LEVEL_KEY.length) : null;
}
