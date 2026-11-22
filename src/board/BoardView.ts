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
import type { BoardMark, BoardSession, BoardViewer, GmCutscene } from '../connectContract';
import type { CutsceneOwner } from '../cutscene/cutsceneRun';
import type { BackgroundStore } from '../background/backgroundStore';
import type { LoadedBackground } from '../background/backgroundData';
import { ItemView, Menu, Modal, Notice, TFile, TFolder, debounce, setIcon, type App, type EventRef, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import { ATLAS_VIEW_TYPE, presentedSceneOf, tabViewOf, type AtlasSceneState, type AtlasView } from '../atlas';
import { AtlasBridge } from '../atlasBridge';
import { collectionRulesOf } from '../collectionRulesOf';
import { BoardAtlasTools } from './boardAtlasTools';
import { tabletopCommands } from '../palette/tabletopCommands';
import { MOSAIC_FROM_BYTES, mapPicture } from '../atlasMosaic';
import { SceneTabBar, type SceneTabEntry } from './sceneTabBar';
import type { ElevationLayerData } from './elevationLayer';
import { NO_PLACEMENT, type Placement } from './layerPlacement';
import type { Assignments } from '../assignments';
import { MiniPicker } from '../gallery';
import type { LoadedMini, MiniLibrary } from '../library';
import type { MaterialLibrary } from '../materials';
import { Board, GM_SPELL_OWNER, type BoardHost } from './board';
import { isInstantaneous, readCastSpells, type CastSpell, type SpellAsk } from './spells';
import { castsOfMeasures, marksOfMeasures, measureWrite, spellWrite, templateWrite, type MeasureChange, type MeasureWrite } from './boardMeasures';
import { DEFAULT_MEASURE_TOOL, type MeasureToolOptions } from './measureOptions';
import { formatHotkey } from '../atlasPort/app/keyboard/mapHotkeys';
import { boardBinding } from './boardHotkeys';
import { readGmView, writeGmView } from './gmView';
import type { SpellBook } from './spellPicker';
import type { SpellChange, TemplateChange } from './playerTools';
import { isVideoPath } from './textures';
import type { BoardData, PropLook, PropVariant } from './boardData';
import { lookOf } from './boardData';
import type { UndoHistory } from './undoHistory';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './conditions';
import { levelName, levelRise, onFirstLevel, onLevelRecord, propsOnLevel, resolveLevel } from './levels';
import { mapStateChanged, readMap, readMapMeasures, readMapState, type BoardMap, type BoardToken } from './mapModel';
import { feetPerSquare, readMeasurement } from './measure';
import { reconcileSpells } from './spellReconciler';
import { defeatedResources, isDefeated, tokenFromFile } from './resources';
import { AtlasMenu, type MenuEntry } from './atlasMenu';
import { tokenMenuEntries } from './tokenMenu';
import { pinMenuEntries } from './pinMenu';
import { presentToEntry } from './sessionMenus';
import { SpellAskModal } from '../spellAskModal';
import { conditionChange, conditionStep, resetChange, type ConditionFields } from './tokenEdits';
import { currentTokenIds, delayedTokens, emptyInitiative, ownModifier, readInitiative, statblockModifier, turnAnnouncement, type InitiativeAction, type InitiativeState } from './initiative';
import { InitiativePanel, type InitiativePanelHost } from './initiativePanel';
import { wholeWall, isWindow, mirroredDoor, rotatedDoor, windowSpan, WINDOW_STEP, type DoorFlip } from './walls';
import { extrasOf, readLightHeight, readWallExtra, type RecordExtras, type WallExtraChange } from './recordExtras';
import { planExtrasMove } from './extrasMigration';
import { brushGlows, givenUpText, legacyWaterMove, LIQUID_LIMITS, readLiquids, restyledLiquids, strokeLiquids, waterSourceOf, type LiquidMasks, type LiquidMotions, type OutlineReport, type WaterSource } from './liquids';
import { LIQUID_DEFAULTS, LIQUID_KINDS, readWaterMotion, WaterMask, type LiquidKind, type SavedWaterMask, type WaterMotion } from './water';
import { MeasureFullError, NotHeldError, type TokenChange } from './tokenWriter';
import type { FogHost, FogSwitchId } from './fogTool';
import { HOST_BAR_LABELS, hostBar, mapName } from './hostBar';
import { migrationWalls, roomsAwaitAtlas, roomWallMoves } from './roomWallMigration';
import { writeBackup } from '../backups';
import type { LaserSettings } from './laser';
import type { PlayerView } from './PlayerWindow';
import { DEFAULT_EDGES, DEFAULT_SEE_THROUGH_SIZE, QUALITY, withLooks, type LayerLook, type Quality, type QualityPreset, type WallEdges } from './quality';
import { DEFAULT_SKY, type LightingChoice, type Sky } from './look';
import type { TokenWriter } from './tokenWriter';
import { copyTokens, cutTokens, pasteTokens } from './tokenClipboard';
import { BoardDice } from '../dice/boardDice';
import { DEFAULT_CINEMATIC_SETTINGS, type CinematicSettings } from '../cutscene/cinematicSettings';
import { levelOfPlace, mapOfPlace, placeAt } from '../cutscene/cutsceneData';
import { askName } from '../cutscene/nameModal';
import { CutsceneStudio, type StudioHost } from '../cutscene/studio';
import type { CardHost } from '../sheets/atlasCard';
import { atlasCardHost } from '../sheets/atlasCardHost';
import { atlasPreviews, previewAnchor, routeAtlasWindowRolls } from '../sheets/atlasPreview';
import { StatblockHoverCard } from '../sheets/hoverCard';
import { builtInTemplate } from '../atlasPort/app/statblocks/library/builtInTemplates';
import { rollViewFor, type MapViewLike } from '../dice/atlasDice';
import type { ChosenPack } from '../dice/dicePack';
import type { TabletopDiceSettings } from '../dice/diceSettings';
import { loadSound } from '../sound/catalog';
import { SoundEngine } from '../sound/soundEngine';
import type { SoundSettings } from '../sound/soundSettings';
import type { SoundLoader } from '../sound/customSounds';
import { documentHasWebgl, NO_WEBGL_HELP, NO_WEBGL_TITLE } from '../webgl';
import { buildPlayerSheet, linkedCreatures, type AtlasFloor, type AtlasHost, type LinkedCreatures, type PlayerSheet } from '../../packages/atlas-host/src/index';
import { SightWatch } from './sightWatch';
import { floorState } from '../atlasFloorGate';
import { TABLETOP_ICON } from '../tabletopIcon';

export const BOARD_VIEW_TYPE = 'atlas-tabletop-board';
/** A wall's own width: its step in the wall's menu and its most, in grid squares. */
const WIDTH_STEP = 0.02;
const WIDTH_MAX = 2;

/** Where the board's toolbar mode (Play or Edit) is kept, for this vault. */
const BOARD_MODE_KEY = 'tabletop-board-mode';

/** The hover source Tabletop registers, so Obsidian's page preview shows stat blocks from the board. */
export const HOVER_SOURCE = 'tabletop-for-atlas';
/** How long a player's instantaneous spell shows on the board: as long as Connect shows it to the players. */
const FLASH_MS = 6000;
/** The colour of a measure that names none: Atlas's accent, as its measurements always were. */
const MEASURE_ACCENT = '#7c5cff';
/** How long Atlas's measures, walls and features must stay as they are before its records of the kept spells are put in step. */
const RECONCILE_MS = 150;
/** The maps whose 3D settings are being moved onto Atlas's records right now, whichever board started it. */
const MOVING_EXTRAS = new Set<string>();
/** The maps whose painted water is being moved to Atlas's liquids right now. */
const MOVING_WATER = new Set<string>();
/** The maps whose old painted water was not moved and is not tried again while Obsidian runs (it cannot be read, or does not fit). */
const WATER_STAYS = new Set<string>();
/** How long after saying what Atlas's limits made a stroke give up it is not said again. */
const WATER_TOLD_MS = 30000;
/** What names a level of a map: the motion chosen for water is a level's. */
const waterLevel = (path: string, level: string | null): string => `${path}\n${level ?? ''}`;
/** How long the water's sliders must rest before its motion is written to Atlas's liquids (one step of its undo, not one per notch). */
const WATER_MOTION_MS = 500;
const RELOAD_MS = 300;
/** A light hangs a square above the map until the GM sets its height; the menu steps it a quarter square. */
const DEFAULT_LIGHT_SQUARES = 1;
const HEIGHT_STEP = 0.25;

/** What the board's tab uses of the plugin. */
export interface BoardServices {
  /**
   * The one Atlas view every edit of Atlas's records goes through. The board makes it hold its map when the board is
   * worked on, and says so when it holds another. Without it (the test harness) the board takes Atlas's views as they are.
   */
  host?: AtlasHost;
  /** The Atlas that is there, against the version Tabletop needs; without it the board takes Atlas as it finds it. */
  floor?(): AtlasFloor;
  /** Keeps a prop as a variant in the gallery. */
  saveVariant?(variant: Omit<PropVariant, 'id'>): void;
  /** Tabletop's undo history (src/board/undoHistory.ts). */
  history?: UndoHistory;
  /** How cinematic cutscenes look and move by default, and keeping a change. */
  cinematicSettings?(): CinematicSettings;
  setCinematicSettings?(changes: Partial<CinematicSettings>): void;
  assignments: Assignments;
  boardData: BoardData;
  minis: MiniLibrary;
  props: MiniLibrary;
  materials: MaterialLibrary;
  /** The saved painted backgrounds the Painted ground can show; without it (the test harness) the board offers none. */
  backgrounds?: BackgroundStore;
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
  /** The GM's Measure tool choices, kept for every board. */
  measureTool?(): MeasureToolOptions;
  setMeasureTool?(changes: Partial<MeasureToolOptions>): void;
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
  /** What the GM set in 3D on a wall, a door or a light of this map changed: what players are sent changes with it. */
  lookChanged?(mapPath: string): void;
  /** The board showed another level of its scene (Atlas levels): what players are sent changes with it. */
  levelShown?(mapPath: string): void;
  /** The GM's camera or the players' moved on this board. */
  cameraMoved?(view: BoardView): void;
  /** Connect's hosted session, while Connect hands one over. */
  session?(): BoardSession | null;
  /** This board's cutscene run for players changed (null: it ended): what `api.cutscene` hands Connect. */
  publishCutscene?(owner: CutsceneOwner, run: GmCutscene | null): void;
  /** The vault's spell notes, for the spell search. */
  spellBook?(): SpellBook | null;
  /** The materials walls and doors wear when none is painted on them, by kind. */
  materialDefaults?(): MaterialDefaults;
  /** The dice settings, and the pack the dice are made from (the default pack Tabletop carries until it is read). */
  diceSettings(): TabletopDiceSettings;
  dicePack(): ChosenPack;
  /** The body colour Atlas's dice look gives a die no dice set colours (null: the pack's own). */
  diceBody?(): string | null;
  /** What the player chose for board sounds (per device). */
  soundSettings(): SoundSettings;
  /** Where the sound files come from: the vault's custom sounds folder first, the bundled sounds otherwise. */
  soundLoader?(): SoundLoader;
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
  /** Where cutscenes are made and previewed over this board; lives as long as the tab. */
  private studio: CutsceneStudio | null = null;
  /** The players' window is held (a cutscene is being authored): a board made or a window attached later holds it too. */
  private playersHeld = false;
  /** The players' window lent to a cutscene run: it follows this tab across maps instead of waiting for its own. */
  private lent: PlayerView | null = null;
  /** A run lends the players' window now (whichever window this tab has, now or opened later). */
  private lending = false;
  /** This tab's side of `api.cutscene`: what the channel asks of the run it holds. */
  readonly cutsceneOwner: CutsceneOwner = {
    end: () => this.studio?.endRun(),
    dispose: () => this.studio?.endRunNow(),
    liveCamera: () => this.studio?.liveCamera() ?? null,
  };
  private map: BoardMap | null = null;
  private rules: CollectionRules = emptyRules();
  private readonly warned = new Set<string>();
  /** Closed: a read still on its way must not build a board on a tab that is gone. */
  private closed = false;
  /** Reads the stat block a token links, as Atlas does (`packages/atlas-host` `linkedCreatures`, shared with Connect). */
  private linked: LinkedCreatures | null = null;
  private readonly reload = debounce(() => { void this.read(); }, RELOAD_MS, true);
  /** The local player view this board draws into. */
  private playerWindow: PlayerView | null = null;
  /** The token menu while it is open: it follows the map as it changes. */
  private menu: AtlasMenu | null = null;
  /**
   * Instantaneous spells going off on this board (the GM's own, and players' sent by Connect): among the map's spells
   * for a moment, kept nowhere. A timer takes a player's off; the board takes the GM's own off after its cast.
   */
  private flashes: Array<{ cast: CastSpell; timer: number | null }> = [];
  private nextFlash = 1;
  /** The map and level whose measures the board was last given. */
  private measuresOf: string | null = null;
  /** Atlas's initiative tracker on the board. */
  private initiative: InitiativePanel | null = null;
  /** The Atlas view holding this map, whose store is followed so its tracker shows each change at once. */
  private watched: { view: AtlasView; stop: () => void } | null = null;
  /** What Atlas shows players of the lit scene, followed in the tab that holds the map (fusion 4D). */
  private sightWatch: SightWatch | null = null;
  /** The token whose point of view the GM previews on the board. */
  private povId: string | null = null;

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
      // The player view shows the map this tab showed: it waits for that map's board again. Lent to a cutscene run, it
      // does not wait (the fade is black) and is drawn into the new board.
      const lent = this.lent;
      if (!lent) this.playerWindow?.waiting(true);
      this.playerWindow = null;
      this.retitle();
      // A cutscene being made stays open over the new scene: `read` tells the studio, which gives the new board its driver.
      const reading = this.read().then(() => {
        if (lent && this.lent === lent && this.board) this.showPlayer(lent);
      });
      // Obsidian restoring its layout at startup waits for every view's state: the board loads behind it instead. A
      // long load there (a cold disk) opens Obsidian's slow-start dialog, whose closing can fail Obsidian's whole start.
      if (this.app.workspace.layoutReady) await reading;
      else reading.catch((error) => console.warn('Tabletop: the 3D board could not load:', error));
    }
    await super.setState(state, result);
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('atlas-tabletop-board-view');
    // A template file changing is read again, so a templated stat block's sheet follows it.
    this.register(this.statblocks().watchTemplates());
    this.registerEvent(this.app.vault.on('modify', (file) => {
      // Atlas saving the map it holds says nothing new: the board already drew it from Atlas's store.
      if (file.path === this.path) { if (!this.services.host?.holds(file.path)) this.reload(); }
      else if (file.path === ASSETS_METADATA_PATH) this.reload();
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      // A cutscene being made follows its map (or a shot's map) being renamed, whichever map this tab shows.
      this.studio?.mapRenamed(oldPath, file.path);
      if (oldPath !== this.path) return;
      this.path = file.path;
      this.retitle();
      this.reload();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => { if (file.path === this.path) this.leaf.detach(); }));
    // Atlas saved a collection's settings (its units, its diagonal rule, its conditions): the board reads its rules again.
    this.registerEvent((this.app.workspace as unknown as { on(name: string, callback: () => void): EventRef }).on('atlas-vtt:collection-settings-changed', () => this.reload()));
    this.registerDomEvent(this.contentEl, 'pointerdown', () => { this.services.focused(this); this.followHost(); }, true);
    // Atlas's "Fog opacity in GM view" changed (here or in Atlas): the fog in the GM's view takes it. Heard once Atlas has loaded.
    {
      const bridge = new AtlasBridge(this.app);
      let stopSettings = (): void => undefined;
      this.register(bridge.onLoaded(() => { stopSettings = bridge.onSettingsChange(() => this.board?.refreshFogOpacity()); this.board?.refreshFogOpacity(); }));
      this.register(() => stopSettings());
    }
    const host = this.services.host;
    if (host) {
      // This board needs Atlas's tab while it is open; working on the board (its tab made active, a press on it) brings
      // Atlas to its map. Only an Atlas of the floor or later is asked (`floorChanged` claims once one is there).
      if (this.mayFollow()) this.releaseHost = host.claim();
      this.register(host.onChange(() => {
        // Atlas came to hold this map, or let go of it: the board reads it from the other source.
        const holds = this.path !== null && host.holds(this.path);
        if (holds !== this.hostHolds) { this.hostHolds = holds; this.reload(); }
        this.watchAtlas();
        this.sessionChanged();
      }));
      this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => { if (leaf === this.leaf) this.followHost(); }));
    }
    this.initiative = new InitiativePanel(this.contentEl, this.initiativeHost());
    this.studio = new CutsceneStudio(this.contentEl, this.studioHost());
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
    // The painted backgrounds: the list the Painted ground chooses from, kept fresh; one saved while shown is drawn again.
    const backgrounds = this.services.backgrounds;
    if (backgrounds) {
      void this.listBackgrounds();
      this.register(backgrounds.onChange(() => { void this.listBackgrounds(); this.backgroundSaved(); }));
    }
  }

  /** The saved backgrounds, as the Painted ground's choices; filled when the tab opens and when one is made, renamed or removed. */
  private backgroundList: readonly { folder: string; name: string }[] = [];

  private async listBackgrounds(): Promise<void> {
    const store = this.services.backgrounds;
    if (!store) return;
    try {
      const items = await store.list();
      if (this.closed) return;
      this.backgroundList = items.map(({ folder, name }) => ({ folder, name }));
      this.board?.refreshToolbar();
    } catch (error) {
      this.warn(`Tabletop: cannot list the backgrounds: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** A background as the board draws it: its materials are the vault folders its slots name, null where one is gone. */
  private async readBackground(folder: string): Promise<LoadedBackground | null> {
    const loaded = await this.services.backgrounds?.load(folder);
    if (!loaded) return null;
    const materials = loaded.settings.materials.map((path) => (this.app.vault.getAbstractFileByPath(path) instanceof TFolder ? path : null));
    return { ...loaded, materials };
  }

  /** Some background was saved: if the ground shown is painted, it is read again and drawn (any change may be a save of that one). */
  private backgroundSaved(): void {
    const path = this.path;
    const board = this.board;
    if (!path || !board) return;
    const ground = this.services.boardData.ground(path);
    if (ground.mode !== 'painted' || !ground.background) return;
    board.forgetBackground(ground.background);
    board.refresh();
  }

  /** The maps this board's undo reaches: its own. */
  private undoPaths(): string[] {
    return this.path ? [this.path] : [];
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

  /** The sound engine of the window this tab is in, held while the tab lives; null where the window has no audio. */
  private sound: { win: Window; engine: SoundEngine | null } | null = null;

  private soundEngine(): SoundEngine | null {
    if (this.closed) return null;
    const win = this.contentEl.ownerDocument.defaultView;
    if (!win) return null;
    if (this.sound?.win !== win) {
      const old = this.sound;
      const engine = SoundEngine.shared(win, this.services.soundLoader?.() ?? loadSound);
      engine?.configure(this.services.soundSettings());
      this.sound = { win, engine };
      // The tab moved to another window: the board moves its loops and its listener to the new engine, before the old is let go.
      if (old) {
        this.board?.soundEngineChanged();
        old.engine?.dispose();
      }
    }
    return this.sound.engine;
  }

  private releaseSound(): void {
    this.sound?.engine?.dispose();
    this.sound = null;
  }

  /** The player changed the sound settings: the engine follows. */
  refreshSound(): void {
    this.sound?.engine?.configure(this.services.soundSettings());
  }

  async onClose(): Promise<void> {
    // A change of the water's motion still waiting for the sliders to rest is written now.
    this.writeMotion();
    this.closed = true;
    this.dropFlashes();
    if (this.reconcileTimer !== null) (this.contentEl.ownerDocument.defaultView ?? window).clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
    this.stopTabs?.();
    this.stopTabs = null;
    this.sceneTabs?.dispose();
    this.sceneTabs = null;
    this.menu?.close();
    this.watched?.stop();
    this.watched = null;
    this.sightWatch?.dispose();
    this.sightWatch = null;
    this.releaseHost?.();
    this.releaseHost = null;
    this.initiative?.dispose();
    this.initiative = null;
    this.reload.cancel();
    // Before the board goes: a cutscene being made gives the camera back.
    this.studio?.dispose();
    this.studio = null;
    this.dropBoard();
    // After the board: it stops its own loops on the engine it holds, even though `closed` now keeps `soundEngine()` from handing one out.
    this.releaseSound();
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
    // A window opened while a run lends this tab's players' window is lent too.
    if (this.lending) this.lent = view;
    view.waiting(false);
    this.board?.attachPlayer(view.stage);
    if (this.playersHeld) this.board?.holdPlayers(true);
  }

  /** What the cutscene studio needs of this tab. */
  private studioHost(): StudioHost {
    const view = this;
    const tabs = (): Array<{ id: string; filePath: string }> => {
      const found = view.path ? tabViewOf(view.app, view.path) : null;
      return found?.view.tabMetaStore.getState().tabs ?? [];
    };
    return {
      get board(): Board { return view.board as Board; },
      mapPath: () => view.path,
      cutscenes: (mapPath) => view.services.boardData.cutscenesOf(mapPath),
      save: (mapPath, cutscene) => view.services.boardData.putCutscene(mapPath, cutscene),
      remove: (mapPath, id) => view.services.boardData.removeCutscene(mapPath, id),
      mapTabs: () => tabs().map((tab) => tab.filePath),
      place: () => (view.path ? placeAt(view.path, view.map?.path === view.path ? view.map.level : null) : null),
      at: (place) => view.showsPlace(place),
      showPlace: async (place) => {
        const mapPath = mapOfPlace(place);
        if (view.path !== mapPath) {
          const tab = tabs().find((entry) => entry.filePath === mapPath);
          if (!tab) return false;
          await view.switchScene(tab.id);
          if (view.path !== mapPath) return false;
        }
        // The level the place names (a map's own place is its first level), of a scene that has it.
        const map = view.map;
        const level = map && map.path === mapPath ? resolveLevel(map.levels, levelOfPlace(place)) : null;
        if (map && level !== null && level !== map.level) {
          await view.switchLevel(level);
          // A run or a preview under way takes the level as it takes a map.
          view.studio?.mapChanged();
        }
        return view.showsPlace(place);
      },
      settings: () => view.services.cinematicSettings?.() ?? DEFAULT_CINEMATIC_SETTINGS,
      setSettings: (changes) => view.services.setCinematicSettings?.(changes),
      askName: (initial) => askName(view.app, 'Cutscene name', initial),
      notice: (text) => { new Notice(text); },
      holdPlayers: (hold) => {
        view.playersHeld = hold;
        view.board?.holdPlayers(hold);
      },
      session: () => view.services.session?.() ?? null,
      lendPlayers: (lend) => {
        view.lending = lend;
        view.lent = lend ? view.playerWindow : null;
      },
      publishRun: (run) => view.services.publishCutscene?.(view.cutsceneOwner, run),
    };
  }

  /** Whether this board shows `place` (a cutscene's: a map, or a level of one): its map, and the level it names of a scene with levels. */
  private showsPlace(place: string): boolean {
    const map = this.map;
    if (!this.path || this.path !== mapOfPlace(place)) return false;
    if (!map || map.path !== this.path) return levelOfPlace(place) === null;
    return resolveLevel(map.levels, levelOfPlace(place)) === map.level;
  }

  /** Stops drawing into the local player view (it closed, or shows another map). */
  hidePlayer(view: PlayerView): void {
    // A window that closed is not lent any more (the next map switch must not attach to it).
    if (this.lent === view) this.lent = null;
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
    this.studio?.mapChanged();
    // The new board has no measure yet: the map's are shown on it, standing (none is cast again).
    this.measuresOf = null;
    this.sessionChanged();
  }

  /** The board as it is drawn now, as a PNG, for a snapshot saved in the vault. */
  snapshot(): Promise<Blob | null> {
    return this.board?.snapshot() ?? Promise.resolve(null);
  }

  /** The quality setting, with the miniature look if it is on. */
  private preset(): QualityPreset {
    return withLooks(QUALITY[this.services.quality()], { tiltShift: this.services.tiltShift?.() === true, occlusion: this.services.occlusion?.() === true, painted: this.services.painted?.() === true, sky: this.services.sky?.() ?? DEFAULT_SKY, edges: this.services.wallEdges?.() ?? DEFAULT_EDGES, seeThrough: this.services.seeThrough?.() === true, seeThroughSize: this.services.seeThroughSize?.(), layerLook: this.services.layerLook?.(), layerTick: this.services.layerTick?.() });
  }

  /** A board, and the GM's dice on it. */
  private makeBoard(preset: QualityPreset): Board {
    const board = new Board(this.contentEl, this.host(), preset);
    this.board = board;
    // A board made anew (a change of quality, a reload) starts with no sight: it is given Atlas's last answer at once, and
    // previews no point of view.
    this.povId = null;
    this.sightWatch?.replay();
    this.atlasTools ??= this.makeAtlasTools();
    this.atlasTools.attach(board);
    this.dice = new BoardDice({
      board,
      container: this.contentEl,
      mapPath: () => this.path ?? '',
      atlasView: () => this.rollView(),
      settings: () => this.services.diceSettings(),
      dieBody: () => this.services.diceBody?.() ?? null,
      pack: () => this.services.dicePack(),
      warn: (message) => this.warn(message),
      setSheetPinned: (pinned) => this.services.setSheetPinned?.(pinned),
      sheetOf: (tokenId) => this.sheetOf(tokenId),
      cardOf: (tokenId) => this.cardOf(tokenId),
    });
    board.cinemaButton({
      live: () => this.studio?.live === true,
      toggleLive: () => this.studio?.toggleLive(),
    });
    return board;
  }

  /** The sheet of a token's stat block, named as the token when the stat block has no name. */
  private async sheetOf(tokenId: string): Promise<PlayerSheet | null> {
    const token = this.map?.tokens.find((candidate) => candidate.id === tokenId);
    if (!token?.statblockPath) return null;
    // A note of one of Atlas's built-in templates is laid out by Atlas's own template (its 5e ones read as 5e stat blocks).
    return buildPlayerSheet(await this.statblocks().readNote(token), token.name, (id) => builtInTemplate(id)?.template ?? null);
  }

  private statblocks(): LinkedCreatures {
    this.linked ??= linkedCreatures(this.app, { label: 'Tabletop' });
    return this.linked;
  }

  /** What draws Atlas's own card of a token's stat block; null when the token links none. */
  private cardOf(tokenId: string): CardHost | null {
    const token = this.map?.tokens.find((candidate) => candidate.id === tokenId);
    return token?.statblockPath ? atlasCardHost(this.app, token.statblockPath, token.name ?? undefined) : null;
  }

  /** The board goes (another map, new quality, the tab closing): its dice first, the roll in play never logged. */
  private dropBoard(): void {
    try {
      this.dice?.sceneChanged();
      this.dice?.dispose();
      this.dice = null;
      this.hoverCard?.dispose();
      this.hoverCard = null;
      this.stopWindowRolls?.();
      this.stopWindowRolls = null;
      this.board?.dispose();
    } finally {
      this.board = null;
    }
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
          if (tool === 'move') { this.board?.goToToolbar('move'); return; }
          if (tool === 'measure') { this.board?.goToToolbar('measure'); return; }
          if (tool === 'fog' && this.board?.goToToolbar('fog') === true) return;
          openInAtlas();
        },
        setDiceLogOpen: (open) => {
          if (open && this.board?.toolbarActions().mode?.() !== 'play') this.board?.toolbarActions().setMode?.('play');
          this.dice?.setLogOpen(open);
        },
        initiativeOpen: () => this.initiative?.isOpen ?? false,
        setInitiativeOpen: (open) => this.initiative?.setOpen(open),
        openSceneBrowser: () => { const found = atlasView(); if (found?.view.openSceneBrowser) found.view.openSceneBrowser(); else new Notice('Tabletop: open another scene in Atlas.'); },
        playerViewOpen: () => this.services.playerViewOpen(this.path ?? ''),
        togglePlayerView: () => this.services.togglePlayerView(this),
        playerFrozen: () => this.board?.playerFrozen ?? false,
        togglePlayerFreeze: () => this.board?.setPlayerFrozen(!(this.board?.playerFrozen ?? false)),
        presentInAtlas: () => { if (!this.path || !new AtlasBridge(this.app).runInAtlas(this.path, 'atlas-vtt:send-map-to-player-view', this.leaf)) new Notice('Tabletop: Atlas could not show this scene to players.'); },
        openInAtlas,
        tabletopCommands: () => { const board = this.board; return board ? tabletopCommands(board.toolbarActions(), () => board.refreshToolbar(), board.toolbarCommandHost()) : []; },
      },
      spawn: {
        centre: () => this.board?.viewCentre() ?? { x: 0, y: 0 },
        grid: () => this.map?.grid ?? null,
        tokens: () => Object.fromEntries((this.map?.tokens ?? []).map((token) => [token.id, token as unknown as Record<string, unknown>])),
        select: (ids) => this.board?.selectTokens(ids),
        joinInitiative: async (ids) => { for (const id of ids) await this.services.writer.initiative(this.path ?? '', id, true); this.initiative?.setOpen(true); },
        openMap: async (file) => { await this.leaf.setViewState({ type: BOARD_VIEW_TYPE, state: { file }, active: true }); },
        refused: (error) => this.unsaved('tokens', error),
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


  /** The scene's other levels as last read (their maps, tokens included). */
  private stackLayers: ElevationLayerData[] = [];

  /** The level the board was sent to from its height ruler, while Atlas (if it shows the scene) has not followed yet; null for Atlas's. */
  private chosenLevel: string | null = null;

  /** Game units a grid square spans on this map: Atlas's own reading (the scene's distance per cell, else the measuring rules'). */
  private unitDistance(): number {
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
        // A scene Atlas holds is read from its store: what was just set (or moved onto its records) is there, saved or not.
        const held = this.services.host?.store(path) ?? null;
        map = held ? readMapState(path, held.getState(), level.id) : readMap(path, text, level.id);
      } catch {
        continue;
      }
      // A light on several levels lights the shown one already: the layer does not light it twice.
      const lit = new Set(shown.lights.map((light) => light.id));
      if (!current) map = { ...map, lights: map.lights.filter((light) => !lit.has(light.id)) };
      layers.push({
        path: levelKey(level.id),
        elevation: levelRise(shown.levels, shown.level, level.id, unit),
        map,
        ...layerExtras(extrasOf(map, boardData.legacyExtras(path))),
        fogHeight: boardData.fogHeight(path),
        wallThickness: boardData.wallThickness(path),
        props: propsOnLevel(boardData.props(path), level.id, shown.levels),
        shapes: propsOnLevel(boardData.shapes(path), level.id, shown.levels),
        // The level's own liquids; a mask painted before water was Atlas's lies on the first level.
        water: waterSourceOf(map.liquids, onFirstLevel(shown.levels, level.id) ? boardData.legacyWater(path) : null),
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

  private stackRead = 0;

  /**
   * Reads the scene's other levels (Atlas levels) and gives them to the board to draw beside the one shown. A scene
   * without levels stands alone: a scene stack of older Tabletop is not drawn (it becomes levels: `stackMigration.ts`).
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
      this.stackLayers = layers.filter((layer) => !layer.current);
      board.setStack(layers);
      const unit = this.unitDistance();
      board.setLayerMenu(shown.levels.map((level) => ({ path: levelKey(level.id), name: levelName(shown.levels, level.id), elevation: levelRise(shown.levels, shown.levels[0].id, level.id, unit), active: level.id === shown.level })).sort((a, b) => b.elevation - a.elevation));
      return;
    }
    this.stackRead += 1;
    this.stackLayers = [];
    board.setStack([]);
    board.setLayerMenu(null);
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
    // An Atlas older than Tabletop needs: the tab says so, and no board is made or read.
    if (this.showFloor()) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      this.warn(`Tabletop: the map ${path} is missing.`);
      return;
    }
    let map: BoardMap;
    try {
      // While Atlas holds the map its store is the map: what was just edited is there at once, saved or not. Else the
      // file is read, to show the map only.
      const store = this.services.host?.store(path);
      if (store) {
        map = readMapState(path, store.getState(), this.shownLevel(path));
        // Old room-wall names are re-keyed first; then what is kept by Atlas's ids goes onto Atlas's own records.
        void this.moveRoomWalls(path, store.getState()).then(() => this.moveExtras(path));
      } else {
        const text = await this.app.vault.read(file);
        if (this.closed) return;
        map = readMap(path, text, this.shownLevel(path));
      }
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
    // Water painted before water was Atlas's: moved to Atlas's liquids now that the board knows the map's size.
    void this.moveWater(path);
    // The board the GM is on brings Atlas to its map as it opens; one opened behind another tab waits to be worked on.
    if (fresh && (this.app.workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }).activeLeaf === this.leaf) this.followHost();
    // The tracker shows when the map has combatants; the I key or the board settings show or hide it.
    if (fresh) this.initiative?.setOpen(this.liveInitiative().entries.length > 0);
    this.showInitiative();
    this.sessionChanged();
    void this.readStack();
    if (fresh && !this.closed) {
      this.services.boardReady(this);
      // A board made while a cutscene is being made (a scene switch, a retry after a failed first read) takes over the camera driver and role.
      this.studio?.mapChanged();
    } else if (levelChanged && !this.closed) {
      // Another level of the same scene: a cutscene running on the board follows it (a live run tells players the new floor).
      this.studio?.mapChanged();
    }
  }

  /**
   * The map's measures as the board shows them (`boardMeasures.ts`): Atlas's areas, kept rulers and templates flat on
   * the map, its spells in 3D, with the instantaneous ones going off. Read from the map alone, hosting or not; the
   * first list of a map or of a level only seeds what stands there, so opening a board casts nothing again.
   */
  private showMeasures(): void {
    const board = this.board;
    const map = this.map;
    if (!board || !map || map.path !== this.path) return;
    const shown = `${map.path}\n${map.level ?? ''}`;
    if (this.measuresOf !== shown) {
      this.measuresOf = shown;
      this.dropFlashes();
      board.forgetCasts();
    }
    const cone = readMeasurement(this.rules.gridDefaults, map.rawGrid).coneAngle;
    board.tools.coneAngle = ((cone !== undefined && cone > 0 && cone < 180 ? cone : 90) * Math.PI) / 180;
    // A measure that follows a token lies around it; what Atlas keeps from its players (hidden, or on a token they do
    // not see) is drawn for the GM alone, never in the players' window.
    const tokens = new Map(map.tokens.map((token) => [token.id, token]));
    const look = {
      tokenAt: (id: string) => { const token = tokens.get(id); return token ? { x: token.x, y: token.y } : null; },
      unseen: (id: string) => tokens.get(id)?.hidden !== false,
    };
    board.receiveTemplates(marksOfMeasures(map.measures, { cell: map.grid.size, accent: MEASURE_ACCENT, ...look }));
    board.receiveSpells(map.path, [...castsOfMeasures(map.measures, look), ...this.flashes.map(({ cast }) => cast)], [], map.measuresElsewhere);
  }

  private reconcileTimer: number | null = null;
  /** A pass is writing: the store's changes it makes itself ask for no other. */
  private reconciling = false;

  /**
   * Puts Atlas's records of the kept spells in step with their measures (`spellReconciler.ts`), once the store holding
   * the map has been still for a moment (a measure dragged in Atlas changes at every frame).
   */
  private reconcileSoon(): void {
    if (this.reconciling || this.closed) return;
    const win = this.contentEl.ownerDocument.defaultView ?? window;
    if (this.reconcileTimer !== null) win.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = win.setTimeout(() => {
      this.reconcileTimer = null;
      const view = this.watched?.view;
      const map = this.map;
      if (this.closed || !view || !map || map.path !== this.path || view.atlasStore.getState().mapPath !== this.path) return;
      const measurement = readMeasurement(this.rules.gridDefaults, map.rawGrid);
      const unitDistance = measurement.unitDistance > 0 ? measurement.unitDistance : 5;
      this.reconciling = true;
      try {
        reconcileSpells(view, { unitsPerFoot: unitDistance / feetPerSquare(measurement), pxPerUnit: map.grid.size / unitDistance });
      } catch (error) {
        console.warn('Tabletop: what the kept spells stand in Atlas could not be put in step:', error);
      } finally {
        this.reconciling = false;
      }
    }, RECONCILE_MS);
  }

  /** An instantaneous spell goes off on this board; `ms` takes it off again (null: the board does, after its cast). */
  private flash(cast: CastSpell, ms: number | null): void {
    const win = this.contentEl.ownerDocument.defaultView ?? window;
    this.flashes.push({ cast, timer: ms === null ? null : win.setTimeout(() => this.endFlash(cast.id), ms) });
    this.showMeasures();
  }

  /** Takes a spell going off away; false when `id` is none of them. */
  private endFlash(id: string): boolean {
    const index = this.flashes.findIndex((flash) => flash.cast.id === id);
    if (index < 0) return false;
    const [gone] = this.flashes.splice(index, 1);
    if (gone.timer !== null) (this.contentEl.ownerDocument.defaultView ?? window).clearTimeout(gone.timer);
    this.showMeasures();
    return true;
  }

  private dropFlashes(): void {
    const win = this.contentEl.ownerDocument.defaultView ?? window;
    for (const { timer } of this.flashes.splice(0)) if (timer !== null) win.clearTimeout(timer);
  }

  /**
   * Connect's session as this board shows it: the handout shown to players, and, while Atlas does not hold the map (so
   * nothing done here reaches players), a banner that opens it in Atlas. The map's measures are shown with it.
   */
  sessionChanged(): void {
    // A cutscene run for players needs the session: when it stops hosting, the run ends.
    if (this.services.session?.()?.hosting() !== true) this.studio?.endRun();
    this.studio?.sessionChanged();
    const board = this.board;
    const path = this.path;
    if (!board || !path) return;
    this.showTable();
    this.showMeasures();
    const session = this.services.session?.() ?? null;
    if (!session?.hosting()) {
      board.setHandout(null);
      board.setBanner(this.hostBanner());
      board.refreshToolbar();
      return;
    }
    const handout = session.overlay(path).handout;
    const file = handout ? this.app.vault.getAbstractFileByPath(handout.path) : null;
    board.setHandout(handout ? { title: handout.title, url: file instanceof TFile ? this.app.vault.getResourcePath(file) : null } : null);
    board.setBanner(this.hostBanner());
    board.refreshToolbar();
  }

  /** The maps whose 0.14 room-wall settings are being moved right now. */
  private readonly movingRoomWalls = new Set<string>();

  /**
   * Once per map, when Atlas 0.15 holds it: what the GM set on a 0.14 room's outline (a height, a width, a material, a
   * window opening) is moved to the walls Atlas 0.15 made of that room, which it named anew. A backup of the map and
   * of Tabletop's data for it is written first, and one notice says what was moved.
   */
  private async moveRoomWalls(path: string, state: unknown): Promise<void> {
    const { boardData } = this.services;
    if (boardData.roomWallsMoved(path) || this.movingRoomWalls.has(path)) return;
    // Only a map with settings under 0.14's room-wall names has anything to move.
    const old = new Set([...boardData.wallKeys(path)].filter((key) => /^room_-?\d+_-?\d+_-?\d+_-?\d+$/.test(key)));
    if (old.size === 0) return;
    const walls = migrationWalls(state);
    // Atlas still holds rooms it has not made walls of: nothing to move them to yet.
    if (roomsAwaitAtlas(state)) return;
    const moves = roomWallMoves(walls, old);
    this.movingRoomWalls.add(path);
    try {
      let folder: string | null = null;
      if (moves.length > 0) {
        const name = mapName(path);
        folder = await writeBackup(this.app, new Date(), [
          { name: `${name}.atlasmap`, text: await this.app.vault.adapter.read(path) },
          { name: `${name}.tabletop.json`, text: JSON.stringify(boardData.toJSON()[path] ?? {}, null, 2) },
        ]);
      }
      const moved = boardData.moveWallKeys(path, moves);
      if (moved > 0 && folder) new Notice(`Tabletop: moved ${moved} wall ${moved === 1 ? 'setting' : 'settings'} to Atlas 0.15's room walls on ${mapName(path)}; backup in ${folder}/`, 0);
    } catch (error) {
      console.warn('Tabletop: the room-wall settings could not be moved:', error);
    } finally {
      this.movingRoomWalls.delete(path);
    }
  }


  /**
   * Once per map, when Atlas holds it: what the GM set in 3D on its walls, doors and lights, which Tabletop kept in
   * its own data by Atlas's ids, is moved onto Atlas's own records (`extrasMigration.ts`). A backup of the map and of
   * Tabletop's data for it is written first, and one notice says what was moved. Nothing is lost that Atlas still has
   * a record for, so nobody is asked.
   */
  private async moveExtras(path: string): Promise<void> {
    const { boardData, writer } = this.services;
    const legacy = boardData.legacyExtras(path);
    if (!legacy || MOVING_EXTRAS.has(path) || this.closed) return;
    const view = writer.holder(path);
    if (!view) return;
    // Settings still under 0.14's room-wall names wait for Atlas 0.15 to make walls of the rooms (migration 1).
    if (!boardData.roomWallsMoved(path) && roomsAwaitAtlas(view.atlasStore.getState())) return;
    const move = planExtrasMove(legacy, view.atlasStore.getState().objects ?? {});
    MOVING_EXTRAS.add(path);
    try {
      const name = mapName(path);
      const folder = await writeBackup(this.app, new Date(), [
        { name: `${name}.atlasmap`, text: await this.app.vault.adapter.read(path) },
        { name: `${name}.tabletop.json`, text: JSON.stringify(boardData.toJSON()[path] ?? {}, null, 2) },
      ]);
      // Another board of this map did it meanwhile.
      if (boardData.legacyExtras(path) === null) return;
      await writer.applyExtrasMove(path, move);
      boardData.clearLegacyExtras(path);
      const left = move.orphaned > 0 ? ` (${move.orphaned} for walls or lights Atlas no longer has were left in the backup)` : '';
      if (move.moved > 0 || move.orphaned > 0) new Notice(`Tabletop: moved ${move.moved} wall, door and light ${move.moved === 1 ? 'setting' : 'settings'} onto Atlas's own records on ${name}${left}; backup in ${folder}/`, 0);
      // The board was read before the move: it is read again with the records as they are now.
      this.reload();
    } catch (error) {
      // Atlas let go of the map, or the backup could not be written: the settings stay where they were, for the next time.
      if (!(error instanceof NotHeldError)) console.warn('Tabletop: the 3D settings of walls and lights could not be moved:', error);
    } finally {
      MOVING_EXTRAS.delete(path);
    }
  }

  /**
   * Once per map, when Atlas holds it and the board has drawn it: the water painted on it before water was Atlas's,
   * which Tabletop kept as a brush mask in its own data, is written as Atlas's liquids (`liquids.ts`: its outlines,
   * within a sixteenth of a square of the brush's edge, on the scene's first level), all of it or none. A backup of
   * the map and of Tabletop's data for it is written first, and one notice says what was moved. A mask that cannot
   * be read on this image, or that does not fit beside the level's liquids, stays where it is.
   */
  private async moveWater(path: string): Promise<void> {
    const { boardData, writer } = this.services;
    const legacy = boardData.legacyWater(path);
    const map = this.map;
    // The old mask lay on the scene's first level, over its image: it is read with that level shown, on a board that
    // knows the image's size (not the stand-in size of an image that could not be read).
    const size = this.board?.mapSizeKnown ? this.board.mapSize : null;
    if (!legacy || MOVING_WATER.has(path) || WATER_STAYS.has(path) || this.closed || !size || !map || map.path !== path || !onFirstLevel(map.levels, map.level)) return;
    const view = writer.holder(path);
    if (!view) return;
    const name = mapName(path);
    // Not moved now, and not tried again while Obsidian runs (so no backup is written over and over).
    const stays = (why: string): void => { WATER_STAYS.add(path); console.warn(`Tabletop: the water painted on ${name} was not moved to Atlas: ${why}`); };
    // All of it or none: the level takes what Atlas keeps there, less what it already has.
    const there = readLiquids(onLevelRecord(view.atlasStore.getState().objects?.liquids, map.level, map.levels)).length;
    const move = legacyWaterMove(legacy, size.width, size.height, map.grid.size, map.level, there);
    if ('stays' in move) {
      // Painted on an image, or a grid, of another size: it cannot be read (and was not drawn before either). It stays
      // in Tabletop's data, and moves once the map is that size again.
      if (move.stays === 'unreadable') { stays('it was painted on an image or a grid of another size, and stays in Tabletop\'s data'); return; }
      const why = move.stays === 'no-room'
        ? `its ${move.patches} patches do not fit beside the ${there} liquids this level has (Atlas keeps ${LIQUID_LIMITS.patches})`
        : `Atlas would not keep ${move.patches} of its patches (it keeps ${LIQUID_LIMITS.patches} liquids on a level, of ${LIQUID_LIMITS.corners} corners each)`;
      stays(why);
      new Notice(`Tabletop: the water painted on ${name} was not moved to Atlas: ${why}. It is drawn as before, and stays in Tabletop's data${move.stays === 'no-room' ? '; take some liquids off in Atlas, then start Obsidian again' : ''}.`, 0);
      return;
    }
    const { liquids: add, gave } = move;
    MOVING_WATER.add(path);
    try {
      const folder = await writeBackup(this.app, new Date(), [
        { name: `${name}.atlasmap`, text: await this.app.vault.adapter.read(path) },
        { name: `${name}.tabletop.json`, text: JSON.stringify(boardData.toJSON()[path] ?? {}, null, 2) },
      ]);
      // Another board of this map did it meanwhile.
      if (boardData.legacyWater(path) === null) return;
      await writer.applyWaterMove(path, add);
      boardData.clearLegacyWater(path);
      const lost = givenUpText(gave);
      new Notice(`Tabletop: the water painted on ${name} is now Atlas's own (${add.length} ${add.length === 1 ? 'liquid' : 'liquids'}); backup in ${folder}/${lost ? `. ${lost}` : ''}`, 0);
      this.reload();
    } catch (error) {
      // Atlas let go of the map: the water stays where it was, for the next time the board reads the map. Anything
      // else (the backup could not be written, Atlas took fewer liquids than it should): not tried again this run.
      if (!(error instanceof NotHeldError)) stays(error instanceof Error ? error.message : String(error));
    } finally {
      MOVING_WATER.delete(path);
    }
  }

  private releaseHost: (() => void) | null = null;
  /** Whether Atlas held this board's map when last heard of. */
  private hostHolds = false;
  /** How the last try to bring Atlas to this map ended, when it failed. */
  private followFailed: 'timeout' | 'no-atlas' | null = null;

  /** Whether the Atlas found may be asked to bring its tab to a map: one older than the floor never is. Unknown: it may. */
  private mayFollow(): boolean {
    const floor = this.services.floor?.();
    return floor ? floorState(floor).follow : true;
  }

  /** Brings Atlas to this board's map (the board staying in front), so what is edited here goes to Atlas's store. */
  private followHost(): void {
    const host = this.services.host;
    const path = this.path;
    if (!host || !path || this.closed || !this.mayFollow()) return;
    if (host.holds(path)) {
      if (this.followFailed === null) return;
      this.followFailed = null;
      this.sessionChanged();
      return;
    }
    void host.follow(path, this.leaf).then((result) => {
      if (this.closed || path !== this.path) return;
      this.followFailed = result === 'timeout' || result === 'no-atlas' ? result : null;
      this.sessionChanged();
    });
  }

  /** The bar over the board while Atlas does not hold its map: why the board only shows it, and the way out. */
  private hostBanner(): { text: string; action?: { label: string; run(): void } } | null {
    const host = this.services.host;
    const path = this.path;
    if (!host || !path) return null;
    const bar = hostBar({ mapPath: path, status: host.status(), closedByUser: host.closedByUser(), failed: this.followFailed, nameOf: mapName });
    if (!bar) return null;
    const action = bar.action;
    if (!action) return { text: bar.text };
    return {
      text: bar.text,
      action: {
        label: HOST_BAR_LABELS[action],
        run: () => {
          if (action === 'edit-here') this.app.workspace.setActiveLeaf(this.leaf, { focus: true });
          this.followFailed = null;
          this.followHost();
        },
      },
    };
  }

  /** Someone's ping or laser on this board's map, or a player's instantaneous spell going off there. */
  mark(mark: BoardMark): void {
    if (!this.board || mark.mapPath !== this.path) return;
    if (mark.kind === 'ping') this.board.receivePing(mark.x, mark.y, mark.color);
    else if (mark.kind === 'laser') this.board.receiveLaser(mark.from, mark.points, mark.lifted, mark.color);
    else {
      const [cast] = readCastSpells([mark.cast]);
      if (cast && !this.flashes.some((flash) => flash.cast.id === cast.id)) this.flash(cast, FLASH_MS);
    }
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

  /** The map's conditions and resource names, from Atlas's asset index (in a hidden folder, read off the disk). */
  private readRules(path: string): Promise<CollectionRules> {
    return collectionRulesOf(this.app, path);
  }

  /** A change the board showed could not be saved: say so, and show the map as it is. */
  private unsaved(what: string, error: unknown): void {
    // Atlas does not hold this map: the bar over the board says so and offers the way out; the board shows the map as it is.
    if (error instanceof NotHeldError) {
      this.sessionChanged();
      new Notice(`Tabletop: ${this.hostBanner()?.text ?? error.message}`, 5000);
      this.reload();
      return;
    }
    new Notice(`Tabletop: the ${what} was not saved: ${error instanceof Error ? error.message : String(error)}`, 8000);
    this.reload();
  }

  private noWebgl: HTMLElement | null = null;
  /** The box that says Atlas is too old, while it is. */
  private noAtlas: HTMLElement | null = null;

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

  /** Atlas changed (enabled, disabled, updated): the tab says why it shows nothing, or reads its map again. */
  floorChanged(): void {
    // An Atlas of the floor came: the board claims its tab now (it did not while an older one was there).
    // An older one came in its place: the claim is let go, so its tab is never asked for.
    if (!this.releaseHost && this.services.host && this.mayFollow()) this.releaseHost = this.services.host.claim();
    else if (this.releaseHost && !this.mayFollow()) { this.releaseHost(); this.releaseHost = null; }
    const blocked = this.noAtlas !== null;
    if (this.showFloor() === blocked) return;
    if (blocked) void this.read();
  }

  /** While Atlas is older than Tabletop needs: says so over the tab, and answers true. Else clears that and answers false. */
  private showFloor(): boolean {
    const floor = this.services.floor?.();
    const state = floor ? floorState(floor) : null;
    const text = state && !state.publish ? state.boardText : null;
    if (text === null) {
      this.noAtlas?.remove();
      this.noAtlas = null;
      return false;
    }
    if (this.closed) return true;
    if (!this.noAtlas) {
      const doc = this.contentEl.ownerDocument;
      const box = doc.win.createEl('div');
      box.className = 'atlas-tabletop-no-webgl atlas-tabletop-no-atlas';
      box.setAttribute('role', 'alert');
      box.append(doc.win.createEl('strong'), doc.win.createEl('p'));
      this.contentEl.appendChild(box);
      this.noAtlas = box;
    }
    const [title, help] = [this.noAtlas.querySelector('strong'), this.noAtlas.querySelector('p')];
    if (title) title.textContent = NO_WEBGL_TITLE;
    if (help) help.textContent = text;
    return true;
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

  /** The fog tool's host: Atlas's fog actions through the writer (on the level the board shows), Atlas's settings and notices. */
  private fogHost(): FogHost {
    const { writer } = this.services;
    const mapPath = (): string => this.path ?? '';
    const bridge = (): AtlasBridge => new AtlasBridge(this.app);
    const level = (): string | null => this.map?.level ?? null;
    const refused = (error: unknown): never => { this.unsaved('fog', error); throw error; };
    // Atlas 0.18's tool switches live in the store of the view holding the map; Atlas's own defaults where unset.
    const switches = (): { toolSwitches?: Partial<Record<string, boolean>>; setToolSwitch?: (id: string, on: boolean) => void } | null => {
      const state = tabViewOf(this.app, mapPath())?.view.atlasStore.getState();
      return typeof state?.setToolSwitch === 'function' ? state : null;
    };
    const defaults: Record<FogSwitchId, boolean> = { fogSnap: true, fogConstrain: false };
    // Where Atlas has no tool switches the tool keeps its own, per device (this vault on this device, like the board's mode).
    const deviceKey = (id: FogSwitchId): string => `tabletop-${id}`;
    return {
      offers: () => writer.fogOffers(mapPath()),
      add: (operations) => writer.addFog(mapPath(), operations, level()).then(() => true, (error: unknown) => { this.unsaved('fog', error); return false; }),
      clear: () => writer.clearFog(mapPath(), level()).catch(refused),
      cover: (rect) => writer.coverAllFog(mapPath(), rect, level()).catch(refused),
      hideRooms: (rect) => writer.hideRooms(mapPath(), rect, undefined, level()).catch(refused),
      reveal: (outlines) => writer.revealFogGround(mapPath(), outlines, level()).catch(refused),
      hide: (id) => writer.hideFogArea(mapPath(), id, level()).catch(refused),
      forget: (id) => writer.forgetFogArea(mapPath(), id, level()).catch(refused),
      gmOpacity: () => bridge().gmFogOpacity(),
      setGmOpacity: (opacity) => { bridge().setGmFogOpacity(opacity); },
      switchOn: (id) => {
        const state = switches();
        if (state) return state.toolSwitches?.[id] ?? defaults[id];
        const kept: unknown = this.app.loadLocalStorage(deviceKey(id));
        return kept === 'on' ? true : kept === 'off' ? false : defaults[id];
      },
      setSwitch: (id, on) => {
        const state = switches();
        if (state) state.setToolSwitch?.(id, on);
        else this.app.saveLocalStorage(deviceKey(id), on ? 'on' : 'off');
        return true;
      },
      brushKeys: () => {
        const keys = [bridge().hotkey('drawSmaller'), bridge().hotkey('drawLarger')];
        return keys.map((key) => (key ? formatHotkey(key) : '')).filter((key) => key !== '').join(' ');
      },
      notice: (text) => { new Notice(text); },
    };
  }

  private host(): BoardHost {
    const { assignments, boardData, writer } = this.services;
    const mapPath = (): string => this.path ?? '';
    return {
      fog: this.fogHost(),
      fogMenu: (entries, event, onClose) => {
        this.menu?.close();
        this.menu = new AtlasMenu(this.contentEl.ownerDocument, () => entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; onClose(); });
      },
      fogHotkey: () => { const key = new AtlasBridge(this.app).hotkey('fog'); return key ? formatHotkey(key) : null; },
      sounds: () => this.soundEngine(),
      controlledByPlayers: (tokenId) => this.services.session?.()?.controllers?.(tokenId)?.some((player) => player.controls) === true,
      spellBook: () => this.services.spellBook?.() ?? null,
      layerHidden: (path) => path !== this.path && boardData.layerHidden(levelOfKey(path) !== null ? `${this.path ?? ''}#${path}` : path),
      water: () => this.water(),
      povChanged: (id) => { this.povId = id; this.followSight(); },
      saveWater: (masks) => this.saveWater(mapPath(), masks),
      saveWaterMotion: (motion, liquid) => this.saveWaterMotion(mapPath(), motion, liquid),
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
      shapes: () => propsOnLevel(boardData.shapes(mapPath()), this.map?.level ?? null, this.map?.levels ?? []),
      // A new shape stands on the level shown (none named: the first, as for Atlas's own objects).
      saveShape: (shape) => {
        const level = this.map && !onFirstLevel(this.map.levels, this.map.level) ? this.map.level : null;
        const known = boardData.shapes(mapPath()).some((one) => one.id === shape.id);
        boardData.saveShape(mapPath(), known || shape.level || !level ? shape : { ...shape, level });
      },
      removeShape: (id) => boardData.removeShape(mapPath(), id),
      ground: () => boardData.ground(mapPath()),
      setGround: (settings) => boardData.setGround(mapPath(), settings),
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
      copyTokens: (ids) => copyTokens(writer, mapPath(), ids).catch((error: unknown) => { this.unsaved('copy', error); return false; }),
      cutTokens: async (ids) => {
        const path = mapPath();
        try {
          const cut = await cutTokens(writer, path, ids);
          // The tokens are gone: so are the minis Tabletop gave them, and their looks (as a Delete does).
          if (cut) for (const id of ids) { assignments.remove(path, id); boardData.setStyle(path, id, 'disc'); }
          return cut;
        } catch (error) {
          this.unsaved('cut', error);
          return false;
        }
      },
      pasteTokens: (at) => pasteTokens(writer, mapPath(), at).catch((error: unknown) => { this.unsaved('paste', error); return []; }),
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
      // Atlas 0.15: what Atlas's own drag ruler reads (the system's rules, statblock speeds) where its view holds the map;
      // else the collection's stored rules, and a token's own speed (the rules' for one without a statblock).
      movement: () => {
        const path = this.path;
        if (!path) return null;
        const live = new AtlasBridge(this.app).movementFor(path);
        const raw = (id: string): unknown => (this.services.host?.store(path)?.getState() as { objects?: { tokens?: Record<string, unknown> } } | undefined)?.objects?.tokens?.[id];
        if (live) return { rules: live.rules, speedOf: (id) => { const token = raw(id); return token ? live.speedOf(token) : null; } };
        const rules = this.rules.movement;
        return {
          rules,
          speedOf: (id) => {
            const token = this.map?.tokens.find((candidate) => candidate.id === id);
            if (!token) return null;
            return token.speed ?? (token.statblockPath ? null : rules.speed ?? null);
          },
        };
      },
      dragDistance: () => new AtlasBridge(this.app).dragDistance(),
      setDragDistance: (choice) => {
        if (!new AtlasBridge(this.app).setDragDistance(choice)) new Notice('Tabletop: drag distance is kept in Atlas, which is not enabled.');
        this.board?.refreshToolbar();
      },
      measureTool: () => this.services.measureTool?.() ?? DEFAULT_MEASURE_TOOL,
      setMeasureTool: (changes) => this.services.setMeasureTool?.(changes),
      measureAction: (change) => {
        const path = this.path;
        if (path) this.gmMeasure(path, change);
      },
      measureHotkeys: () => {
        const bridge = new AtlasBridge(this.app);
        const fmt = (id: 'measure' | 'measureKeep' | 'gmView'): string | null => {
          // On the board a camera letter takes Shift (D is Shift + D here).
          const key = boardBinding(bridge.hotkey(id));
          return key ? formatHotkey(key) : null;
        };
        return { measure: fmt('measure'), measureKeep: fmt('measureKeep'), gmView: fmt('gmView') };
      },
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
      // Atlas's GM view switch, in the store of the Atlas view holding this map: Atlas's 2D view and the board share it.
      gmView: () => readGmView(this.path ? this.services.writer.holder(this.path)?.atlasStore.getState() : null),
      setGmView: (on) => writeGmView(this.path ? this.services.writer.holder(this.path)?.atlasStore.getState() : null, on),
      laser: () => this.services.laser(),
      setLaser: (changes) => this.services.setLaser(changes),
      setLighting: (choice) => this.services.setLighting?.(choice),
      setTiltShift: (on) => this.services.setTiltShift?.(on),
      ...(this.services.setSeeThrough && { setSeeThrough: (on: boolean) => this.services.setSeeThrough?.(on) }),
      ...(this.services.setSeeThroughSize && { setSeeThroughSize: (squares: number) => this.services.setSeeThroughSize?.(squares) }),
      ...(this.services.setLayerLook && { setLayerLook: (look: LayerLook) => this.services.setLayerLook?.(look) }),
      switchLayer: (path: string) => { const level = levelOfKey(path); if (level !== null) void this.switchLevel(level); },
      layerMenu: (path: string, event: MouseEvent) => { if (levelOfKey(path) !== null) this.levelMenu(path, event); },
      tablePlaced: (table: SavedArTable) => { if (this.path) this.services.boardData.setArTable(this.path, table); },
      tableRemoved: () => { if (this.path) this.services.boardData.setArTable(this.path, null); },
      moveTokensToLayer: (ids, path, places, follow) => {
        const level = levelOfKey(path);
        void (async () => {
          if (level === null) return;
          await this.moveTokensToLevel(ids, level, places);
          // Let go over the level: it is the one shown now, the tokens on it.
          if (follow && !this.closed) await this.switchLevel(level);
        })();
      },
      ...(this.services.setWallEdges && { setWallEdges: (edges: WallEdges) => this.services.setWallEdges?.(edges) }),
      setOcclusion: (on) => this.services.setOcclusion?.(on),
      autoRoll: () => this.services.diceSettings().autoRoll,
      setAutoRoll: (on) => this.services.setAutoRoll?.(on),
      playerViewOpen: () => this.services.playerViewOpen(mapPath()),
      initiativeOpen: () => this.initiative?.isOpen ?? false,
      toggleInitiative: () => this.initiative?.setOpen(!this.initiative.isOpen),
      wallMaterial: (id) => this.extras().wallMaterial(id),
      materialDefaults: () => this.services.materialDefaults?.() ?? {},
      wallHeight: (id) => this.extras().wallHeight(id),
      windowOf: (id) => this.extras().windowOf(id),
      wallWidth: (id) => this.extras().wallWidth(id),
      setWallHeight: (id, squares, whole) => this.setExtras(mapPath(), whole ? wholeWall(this.map?.walls ?? [], id) : [id], { height: squares }),
      setWallWidth: (id, squares, whole) => this.setExtras(mapPath(), whole ? wholeWall(this.map?.walls ?? [], id) : [id], { width: squares }),
      setWindowSpan: (id, span, whole) => {
        const walls = this.map?.walls ?? [];
        const ids = whole ? wholeWall(walls, id).filter((other) => walls.some((candidate) => candidate.id === other && isWindow(candidate))) : [id];
        this.setExtras(mapPath(), ids.length > 0 ? ids : [id], { window: span });
      },
      setLightHeight: (id, squares) => this.setLightHeight(mapPath(), id, squares),
      doorProp: (id) => this.extras().doorProp(id),
      doorFlip: (id) => this.extras().doorFlip(id),
      ...(this.services.backgrounds && {
        // A background with the vault folders of its materials as `readMaterial` takes them (null where a folder is gone).
        readBackground: (folder: string) => this.readBackground(folder),
        backgrounds: () => this.backgroundList,
      }),
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
      // The board is as light as Atlas's scene (daylight while Atlas's lighting is off), tinted as Atlas tints it; the
      // slider and the picker set Atlas's own scene lighting.
      ambient: () => (this.map?.lighting.enabled ? this.map.lighting.ambient : 1),
      lightingOn: () => this.map?.lighting.enabled === true,
      setAmbient: (level) => { writer.setSceneLighting(mapPath(), { ambient: level }).catch((error: unknown) => this.unsaved('light level', error)); },
      tint: () => this.map?.lighting.ambientColor ?? null,
      setTint: (color) => { writer.setSceneLighting(mapPath(), { ambientColor: color }).catch((error: unknown) => this.unsaved('tint', error)); },
      clearTint: () => { writer.setSceneLighting(mapPath(), { ambientColor: undefined }).catch((error: unknown) => this.unsaved('tint', error)); },
      lightHeight: (light) => this.extras().lightHeight(light.id) ?? DEFAULT_LIGHT_SQUARES,
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
      // Cinematic is the cutscene gallery or editor being open; it is never kept, so a board opens in the last Play or Edit.
      boardMode: () => (this.studio?.cinematic ? 'cinematic' : this.app.loadLocalStorage(BOARD_MODE_KEY) === 'edit' ? 'edit' : 'play'),
      setBoardMode: (mode) => {
        if (mode === 'cinematic') {
          this.studio?.openGallery();
          return;
        }
        this.app.saveLocalStorage(BOARD_MODE_KEY, mode);
        this.studio?.leaveCinematic();
      },
      paintWall: (id, material, whole) => {
        const walls = this.map?.walls ?? [];
        const wall = walls.find((candidate) => candidate.id === id);
        if (!wall) return;
        // Shift paints the whole wall (`wholeWall`); a door is always painted alone.
        const ids = whole ? wholeWall(walls, id) : [id];
        this.setExtras(mapPath(), ids, { material });
      },
      cameraMoved: () => this.services.cameraMoved?.(this),
      hosting: () => this.services.session?.()?.hosting() === true,
      // The GM's spells and Template tool: kept in Atlas's measures, where every player of the map's scene gets them.
      playerAction: (action) => {
        const path = this.path;
        if (!path) return;
        if (action.type === 'spell') this.gmSpell(path, action.change);
        else if (action.type === 'template') this.gmTemplate(path, action.change);
      },
    };
  }

  /** The motions chosen on a level (`waterLevel`), by liquid, that its brush liquids do not carry yet: the level has none of that liquid so far, or the change waits to be written. */
  private readonly chosenMotion = new Map<string, Partial<LiquidMotions>>();
  /** The level whose chosen motion waits for the sliders to rest. */
  private motionWait: { path: string; level: string | null; levels: BoardMap['levels']; timer: number } | null = null;
  private waterToldAt = -Infinity;

  /**
   * This map's water as the board draws it: every liquid Atlas has on the level shown (`liquids.ts`), and, on the
   * first level of a map whose painted water was not moved to Atlas yet, its old mask.
   */
  private water(): WaterSource | null {
    const map = this.map && this.map.path === this.path ? this.map : null;
    if (!map) return null;
    const legacy = onFirstLevel(map.levels, map.level) ? this.services.boardData.legacyWater(map.path) : null;
    return waterSourceOf(map.liquids, legacy, this.chosenMotion.get(waterLevel(map.path, map.level)) ?? {});
  }

  /** What Atlas's limits made a write of water give up, said once in a while (a stroke after another on the same lake says the same). */
  private tellWaterLimits(gave: OutlineReport): void {
    const text = givenUpText(gave);
    const now = Date.now();
    // Water left out is always said; fillings and smoothings not over and over.
    if (!text || (gave.patches === 0 && now - this.waterToldAt < WATER_TOLD_MS)) return;
    this.waterToldAt = now;
    new Notice(`Tabletop: ${text} The board shows what was kept.`, 10000);
  }

  /**
   * A finished stroke of the water brush (or bucket): the mask as painted, null when no water is left. It is written
   * to Atlas's liquids of the level shown, in one step of Atlas's undo: the brush-made liquids Atlas has there at
   * that moment are replaced by the mask's outlines (`strokeLiquids`); liquids made in Atlas are not touched. Settles
   * once that is kept or refused: the board then draws what Atlas has.
   */
  private saveWater(path: string, saved: Record<LiquidKind, SavedWaterMask | null>): Promise<void> | void {
    const map = this.map;
    const size = this.board?.mapSize ?? null;
    if (!map || map.path !== path || !size) return;
    const painted = {} as LiquidMasks;
    for (const liquid of LIQUID_KINDS) {
      const mask = saved[liquid] ? WaterMask.read(saved[liquid], size.width, size.height, map.grid.size) : WaterMask.forMap(size.width, size.height, map.grid.size);
      if (!mask) return;
      painted[liquid] = mask;
    }
    const { level, levels } = map;
    const key = waterLevel(path, level);
    const unit = this.unitDistance();
    const gave: OutlineReport = { holes: 0, thinned: 0, patches: 0 };
    let asked = 0;
    return this.services.writer.replaceLiquids(path, (record, lights) => {
      const now = readLiquids(onLevelRecord(record, level, levels));
      // Each as chosen on this level just now, else as its brush liquid moves, else (water) as the old mask did.
      const chosen = this.chosenMotion.get(key) ?? {};
      const legacy = this.services.boardData.legacyWater(path)?.motion;
      const motions = Object.fromEntries(LIQUID_KINDS.map((liquid) => [liquid, chosen[liquid]
        ?? now.find((one) => one.liquid === liquid && one.motion !== null)?.motion
        ?? (liquid === 'water' ? readWaterMotion(legacy) : LIQUID_DEFAULTS[liquid])])) as LiquidMotions;
      const stroke = strokeLiquids(painted, now, level, motions, gave, unit);
      asked = stroke.add.length;
      // The glow of the brush's lava and acid is made again with them.
      return { ...stroke, removeLights: brushGlows(lights, level) };
    }).then((ids) => {
      // The brush's liquids carry the motions now: they are no longer only chosen.
      if (ids.length > 0) this.chosenMotion.delete(key);
      this.tellWaterLimits({ ...gave, patches: gave.patches + Math.max(0, asked - ids.length) });
    }, (error: unknown) => this.unsaved('water', error));
  }

  /** A liquid's motion was changed on the board: shown at once, and written to the brush's liquids of the level once the sliders rest. */
  private saveWaterMotion(path: string, motion: WaterMotion, liquid: LiquidKind): void {
    const map = this.map;
    if (!map || map.path !== path) return;
    const key = waterLevel(path, map.level);
    // A change still waiting on another level is written first: one level waits at a time.
    if (this.motionWait && waterLevel(this.motionWait.path, this.motionWait.level) !== key) this.writeMotion();
    this.chosenMotion.set(key, { ...this.chosenMotion.get(key), [liquid]: motion });
    const win = this.contentEl.ownerDocument.defaultView ?? window;
    if (this.motionWait) win.clearTimeout(this.motionWait.timer);
    this.motionWait = { path, level: map.level, levels: map.levels, timer: win.setTimeout(() => this.writeMotion(), WATER_MOTION_MS) };
  }

  /**
   * Writes the motion that waited to the brush's liquids of its level (whichever level the board shows by now), in
   * one step of Atlas's undo; a level with no brush water yet keeps it chosen, for its first stroke. Once written or
   * refused it is no longer chosen: the liquids say how the water moves.
   */
  private writeMotion(): void {
    const wait = this.motionWait;
    this.motionWait = null;
    if (!wait) return;
    (this.contentEl.ownerDocument.defaultView ?? window).clearTimeout(wait.timer);
    const key = waterLevel(wait.path, wait.level);
    const motions = this.chosenMotion.get(key);
    if (!motions) return;
    const unit = this.unitDistance();
    let carried = false;
    // Each chosen motion is carried once its liquid has brush liquids on the level; the others stay chosen, for its first stroke.
    const settle = (): void => {
      const now = this.chosenMotion.get(key);
      if (!carried || now !== motions) return;
      const left = Object.fromEntries(Object.entries(motions).filter(([liquid]) => !carriedKinds.has(liquid as LiquidKind)));
      if (Object.keys(left).length > 0) this.chosenMotion.set(key, left); else this.chosenMotion.delete(key);
    };
    const carriedKinds = new Set<LiquidKind>();
    this.services.writer.replaceLiquids(wait.path, (record, lights) => {
      const now = readLiquids(onLevelRecord(record, wait.level, wait.levels));
      for (const liquid of now) if (liquid.brush) carriedKinds.add(liquid.liquid);
      carried = carriedKinds.size > 0;
      const restyled = restyledLiquids(now, wait.level, motions, unit);
      return restyled.add.length > 0 ? { ...restyled, removeLights: brushGlows(lights, wait.level) } : restyled;
    }).then(settle, (error: unknown) => {
      carried = true;
      settle();
      if (!this.closed) this.unsaved('water', error);
    });
  }

  private extrasOfMap: { map: BoardMap; walls: BoardMap['walls']; lights: BoardMap['lights']; legacy: unknown; extras: RecordExtras } | null = null;

  /**
   * What the GM set in 3D on this map's walls, doors and lights: read off Atlas's own records (`recordExtras.ts`), and,
   * for a map not moved yet, off what Tabletop's data still holds. Worked out again only when the map or that data changed.
   */
  private extras(): RecordExtras {
    const map = this.map && this.map.path === this.path ? this.map : null;
    const legacy = this.path ? this.services.boardData.legacyExtras(this.path) : null;
    const kept = this.extrasOfMap;
    if (map && kept && kept.map === map && kept.walls === map.walls && kept.lights === map.lights && kept.legacy === legacy) return kept.extras;
    const extras = extrasOf(map, legacy);
    this.extrasOfMap = map ? { map, walls: map.walls, lights: map.lights, legacy, extras } : null;
    return extras;
  }

  /**
   * The 3D extras of the records the map was read with, as Atlas's store has them now: a height dragged, a material
   * painted or an undo shows at once. Only the extras: a wall moved, made or deleted waits for the map's next read.
   */
  private showExtras(objects: AtlasSceneState['objects'] | undefined): void {
    const map = this.map;
    if (!map || map.path !== this.path || !objects) return;
    const record = (from: Readonly<Record<string, unknown>> | undefined, id: string): Record<string, unknown> | null => {
      const raw = from && Object.hasOwn(from, id) ? from[id] : null;
      return typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : null;
    };
    let changed = false;
    for (const wall of map.walls) {
      const raw = record(objects.walls, wall.id);
      if (!raw) continue;
      const next = readWallExtra(raw.tabletop);
      if (JSON.stringify(next) === JSON.stringify(wall.extra ?? null)) continue;
      if (next) wall.extra = next; else delete wall.extra;
      changed = true;
    }
    for (const light of map.lights) {
      const raw = light.tokenId !== null ? record(objects.tokens, light.tokenId) : record(objects.lights, light.id);
      if (!raw) continue;
      const next = readLightHeight(raw.tabletop, light.tokenId !== null ? 'lightHeight' : 'height');
      if (next === (light.ownHeight ?? null)) continue;
      if (next !== null) light.ownHeight = next; else delete light.ownHeight;
      changed = true;
    }
    if (!changed) return;
    this.extrasOfMap = null;
    this.refresh();
    this.services.lookChanged?.(map.path);
  }

  /** Sets extras of walls or doors on Atlas's own records (one step of its undo); refused, with the bar's words, on a map Atlas does not hold. */
  private setExtras(path: string, ids: readonly string[], change: WallExtraChange): void {
    this.services.writer.setWallExtras(path, ids, change).catch((error: unknown) => this.unsaved('wall', error));
  }

  private setLightHeight(path: string, id: string, height: number | null): void {
    if (height !== null && (!Number.isFinite(height) || height < 0)) return;
    this.services.writer.setLightHeight(path, id, height).catch((error: unknown) => this.unsaved('light height', error));
  }

  /** Turns a door from the way it stands now (rotated half a turn, or mirrored). */
  private turnDoor(path: string, id: string, turn: (flip: DoorFlip) => DoorFlip): void {
    const next = turn(this.extras().doorFlip(id));
    this.setExtras(path, [id], { hinge: next.hinge ? true : null, side: next.side ? true : null });
  }

  /** A light's menu: how high it hangs, in quarter squares, and back to the default. */
  private lightMenu(id: string, event: MouseEvent): void {
    const path = this.path;
    if (!path) return;
    const { boardData } = this.services;
    const entries = (): MenuEntry[] => {
      const stored = this.extras().lightHeight(id);
      const height = stored ?? DEFAULT_LIGHT_SQUARES;
      const set = (next: number): void => this.setLightHeight(path, id, Math.max(0, Math.round(next * 4) / 4));
      return [
        {
          type: 'item', label: 'Height', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${height} sq`, label: 'Height', canDecrement: height > 0, onDecrement: () => set(height - HEIGHT_STEP), onIncrement: () => set(height + HEIGHT_STEP) },
        },
        { type: 'item', label: 'Reset height', disabled: stored === null, onClick: () => this.setLightHeight(path, id, null) },
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
      const prop = door ? this.extras().doorProp(id) : null;
      const paint = this.extras().wallMaterial(id);
      const painted = door ? [] : wholeWall(this.map?.walls ?? [], id).filter((other) => this.extras().wallMaterial(other) !== null);
      const list: MenuEntry[] = [];
      // Its own height, by quarter squares; until set, as tall as the fog (a low wall half that).
      const own = this.extras().wallHeight(id);
      const fog = boardData.fogHeight(path);
      const height = own ?? (wall.limited ? fog / 2 : fog);
      const setHeight = (next: number): void => this.setExtras(path, [id], { height: Math.max(0, Math.round(next * 4) / 4) });
      list.push({
        type: 'item', label: own === null ? 'Height (fog)' : 'Height', keepOpen: true, onClick: () => undefined,
        stepper: { value: `${height} sq`, label: 'Height', canDecrement: height > 0, onDecrement: () => setHeight(height - HEIGHT_STEP), onIncrement: () => setHeight(height + HEIGHT_STEP) },
      });
      const whole = door ? [id] : wholeWall(this.map?.walls ?? [], id);
      if (whole.length > 1) list.push({ type: 'item', label: 'Give the whole wall this height', onClick: () => this.setExtras(path, whole, { height: height }) });
      if (own !== null || whole.some((other) => this.extras().wallHeight(other) !== null)) {
        list.push({ type: 'item', label: 'Back to the fog\'s height', onClick: () => this.setExtras(path, whole, { height: null }) });
      }
      // A plain wall can be made Atlas's window (it stops only tokens; sight and light pass both ways), and back. Not the
      // outline worked out for a 0.14 file's rooms (chain `rooms`): it has no wall in the file to change. Atlas 0.15's
      // room walls (chain `rooms_<level>`) are real walls, and can.
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
      const ownWidth = this.extras().wallWidth(id);
      const width = ownWidth ?? boardData.wallThickness(path);
      const setWidth = (next: number): void => this.setExtras(path, [id], { width: Math.min(WIDTH_MAX, Math.max(WIDTH_STEP, Math.round(next * 100) / 100)) });
      list.push({
        type: 'item', label: ownWidth === null ? 'Width (default)' : 'Width', keepOpen: true, onClick: () => undefined,
        stepper: { value: `${width} sq`, label: 'Width', canDecrement: width > WIDTH_STEP, onDecrement: () => setWidth(width - WIDTH_STEP), onIncrement: () => setWidth(width + WIDTH_STEP) },
      });
      if (whole.length > 1) list.push({ type: 'item', label: 'Give the whole wall this width', onClick: () => this.setExtras(path, whole, { width: width }) });
      if (ownWidth !== null || whole.some((other) => this.extras().wallWidth(other) !== null)) {
        list.push({ type: 'item', label: 'Back to the default width', onClick: () => this.setExtras(path, whole, { width: null }) });
      }
      // Atlas's window: where its opening begins and ends, by quarter squares, inside the wall.
      if (isWindow(wall)) {
        const span = windowSpan(height, this.extras().windowOf(id));
        const setSpan = (ids: readonly string[], next: { bottom: number; top: number }): void => this.setExtras(path, ids, { window: windowSpan(height, next) });
        list.push({
          type: 'item', label: 'Window bottom', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${span.bottom} sq`, label: 'Window bottom', canDecrement: span.bottom > 0, onDecrement: () => setSpan([id], { ...span, bottom: span.bottom - WINDOW_STEP }), onIncrement: () => setSpan([id], { bottom: Math.min(span.bottom + WINDOW_STEP, span.top - WINDOW_STEP), top: span.top }) },
        });
        list.push({
          type: 'item', label: 'Window top', keepOpen: true, onClick: () => undefined,
          stepper: { value: `${span.top} sq`, label: 'Window top', canDecrement: span.top - WINDOW_STEP > span.bottom, onDecrement: () => setSpan([id], { ...span, top: span.top - WINDOW_STEP }), onIncrement: () => setSpan([id], { ...span, top: span.top + WINDOW_STEP }) },
        });
        const windowWall = wholeWall(this.map?.walls ?? [], id).filter((other) => this.map?.walls.some((candidate) => candidate.id === other && isWindow(candidate)));
        if (windowWall.length > 1) list.push({ type: 'item', label: 'Give the whole window this opening', onClick: () => this.setExtras(path, windowWall, { window: span }) });
        if (windowWall.some((other) => this.extras().windowOf(other) !== null)) list.push({ type: 'item', label: 'Default window opening', onClick: () => this.setExtras(path, windowWall.length > 0 ? windowWall : [id], { window: null }) });
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
        list.push({ type: 'item', label: 'Rotate 180°', onClick: () => this.turnDoor(path, id, rotatedDoor) });
        list.push({ type: 'item', label: 'Mirror', onClick: () => this.turnDoor(path, id, mirroredDoor) });
        list.push({ type: 'separator' });
        list.push({
          type: 'item', label: prop ? 'Change door prop…' : 'Replace with prop…',
          onClick: () => new MiniPicker(this.app, props, 'door', prop ? { mini: prop, scale: 1, turn: 0 } : null, (result) => this.setExtras(path, [id], { prop: result.mini }), {
            title: wall.type === 'secret-door' ? 'Prop for this secret door' : 'Prop for this door', action: 'Use prop', fitted: true,
          }).open(),
        });
        if (prop) list.push({ type: 'item', label: 'Use plain door', onClick: () => this.setExtras(path, [id], { prop: null }) });
      }
      if (paint) list.push({ type: 'item', label: door ? 'Remove material' : 'Remove material from segment', onClick: () => this.setExtras(path, [id], { material: null }) });
      if (!door && painted.length > 1) list.push({ type: 'item', label: 'Remove material from whole wall', onClick: () => this.setExtras(path, painted, { material: null }) });
      if (list.length === 0) list.push({ type: 'item', label: 'Drag a material from the gallery onto this wall', disabled: true, onClick: () => undefined });
      return list;
    };
    this.menu?.close();
    this.menu = new AtlasMenu(this.contentEl.ownerDocument, entries, { x: event.clientX, y: event.clientY }, (element, name) => setIcon(element, name), () => { this.menu = null; });
  }

  // ── Initiative ────────────────────────────────────────────────────────────

  /** Follows the store of the Atlas view holding this map, if one does; the tracker shows what it holds. */
  /** Hands the board Atlas's sight of its map, followed in the tab that holds it (none: pending or unlit, by the scene). */
  private followSight(): void {
    const board = this.board;
    if (!board || this.closed) return;
    this.sightWatch ??= new SightWatch((players, pov) => this.board?.setAtlasSight(players, pov));
    const view = this.path ? this.services.writer.holder(this.path) : null;
    const map = this.map && this.map.path === this.path ? { path: this.map.path, lighting: this.map.lighting, level: this.map.level, levels: this.map.levels } : null;
    this.sightWatch.follow(view, map, this.povId);
  }

  private watchAtlas(): void {
    const view = this.path && !this.closed ? this.services.writer.holder(this.path) : null;
    this.followSight();
    // The host's own changes say when Atlas comes to hold the map, or lets go of it (`host.onChange`, in `onOpen`).
    if (this.watched?.view === view) return;
    this.watched?.stop();
    this.watched = null;
    if (view) {
      let held = view.atlasStore.getState().initiative;
      let drawn = view.atlasStore.getState() as unknown as Record<string, unknown>;
      let measures = view.atlasStore.getState().objects?.measures;
      let liquids = view.atlasStore.getState().objects?.liquids;
      let derived = view.atlasStore.getState().objects;
      let extrasOf3d = view.atlasStore.getState().objects;
      let gmView = readGmView(view.atlasStore.getState());
      const stop = view.atlasStore.subscribe(() => {
        const state = view.atlasStore.getState();
        // Atlas moved to another map in that view: the file is this map's tracker again.
        if (state.mapPath !== this.path) { this.watchAtlas(); return; }
        // The GM view switch was thrown in Atlas (its button, its key, Table mode): the board shows the same look.
        const gmNow = readGmView(state);
        if (gmNow !== gmView) { gmView = gmNow; this.board?.gmViewChanged(); }
        // What a kept spell stands in Atlas (walls, difficult ground, light) follows its measure: after a cast, a move, an undo.
        const objects = state.objects;
        // What the GM set in 3D on a wall, a door or a light (on its record): shown at once, ahead of the map's next read.
        if (objects?.walls !== extrasOf3d?.walls || objects?.lights !== extrasOf3d?.lights || objects?.tokens !== extrasOf3d?.tokens) {
          extrasOf3d = objects;
          this.showExtras(objects);
        }
        // (A spell that follows a token stands them round the token: its moves count too.)
        if (objects?.measures !== derived?.measures || objects?.walls !== derived?.walls || objects?.mapFeatures !== derived?.mapFeatures || objects?.tokens !== derived?.tokens) {
          derived = objects;
          this.reconcileSoon();
        }
        // A liquid written, taken off or put back (a stroke, a pool made in Atlas, its undo): drawn at once, ahead of
        // the map's next read, so the board never draws water a write behind.
        if (objects?.liquids !== liquids) {
          liquids = objects?.liquids;
          const map = this.map;
          if (map && map.path === this.path && state.mapLoaded !== false && state.isMapLoading !== true) {
            map.liquids = readLiquids(onLevelRecord(liquids, map.level, map.levels));
            this.board?.refresh();
          }
        }
        // A measure kept, changed or taken off (a cast, a template, an area drawn in Atlas, its undo): shown at once, ahead of the map's next read.
        if (state.objects?.measures !== measures) {
          measures = state.objects?.measures;
          const map = this.map;
          if (map && map.path === this.path && state.mapLoaded !== false && state.isMapLoading !== true) {
            Object.assign(map, readMapMeasures(measures, map.level, map.levels));
            this.showMeasures();
          }
        }
        // The board draws from this store (with a host): it reads again when what it draws changed, and only then (the
        // camera, the selection and the tools replace the state many times a second).
        const now = state as unknown as Record<string, unknown>;
        if (this.services.host && mapStateChanged(drawn, now)) this.reload();
        drawn = now;
        // The GM went to another floor (Atlas 0.10): the board shows that floor.
        if (state.viewedLevel !== undefined && this.map && resolveLevel(this.map.levels, state.viewedLevel) !== this.map.level) this.reload();
        if (state.initiative === held) return;
        held = state.initiative;
        this.showInitiative();
        this.menu?.refresh();
      });
      this.watched = { view, stop };
      // The map as Atlas holds it now: a spell kept while no board was open gets what it stands.
      this.reconcileSoon();
    }
    this.showInitiative();
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
    this.board?.setActiveTokens(currentTokenIds(fight));
    this.board?.setDelayedTokens(delayedTokens(fight));
    // The turn passing flashes a banner; opening the board in the middle of a fight does not.
    const turn = turnAnnouncement(fight);
    if (turn && this.lastTurn !== null && this.lastTurn !== turn.key) this.board?.flashTurn(turn.text);
    this.lastTurn = turn?.key ?? null;
    // The horn goes through the board's own watcher, which also hears the file's tracker, so one turn sounds once.
    this.board?.hearTurn(turn?.key ?? null, currentTokenIds(fight));
  }

  /** The turn last announced, to flash the banner only when it changes. */
  private lastTurn: string | null = null;

  private liveInitiative(): InitiativeState {
    const state = this.watched?.view.atlasStore.getState();
    if (state && state.mapPath === this.path && state.initiative) return readInitiative(state.initiative);
    return this.map?.initiative ?? emptyInitiative();
  }

  /** A change of the tracker: Atlas's store changes (once Atlas holds the map), and the tracker follows it. */
  private initiativeAct(given: InitiativeAction): void {
    const map = this.map;
    if (!map) return;
    this.watchAtlas();
    const action = this.withDefeated(given);
    this.services.writer.initiativeAction(map.path, action)
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
      if (entry.tokenId === undefined) return false;
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
      const fields = path ? await this.statblocks().noteFields(path) : null;
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
      if (!event.repeat) {
        panel.setOpen(!panel.isOpen);
        this.board?.refreshToolbar();
      }
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
      lightHeight: () => (this.map?.lights.some((light) => light.tokenId === id) ? this.extras().lightHeight(id) ?? DEFAULT_LIGHT_SQUARES : null),
      controllers: () => this.services.session?.()?.controllers?.(id) ?? null,
      resourceShows: () => this.services.session?.()?.resourceShows?.(map.path, id) ?? null,
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
        setLightHeight: (height) => this.setLightHeight(map.path, id, Math.max(0, Math.round(height * 4) / 4)),
        setController: (playerId, controls) => {
          this.services.session?.()?.setController?.(id, playerId, controls);
          this.menu?.refresh();
        },
        setResourceShow: (choiceId, value) => {
          this.services.session?.()?.setResourceShow?.(map.path, id, choiceId, value);
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

  /** A measure the board asked for was not kept: Atlas holds another map (the bar offers the way out), or its level is full. */
  private measureRefused(what: string, error: unknown): void {
    if (error instanceof MeasureFullError) { new Notice(`Tabletop: ${error.message}`, 6000); return; }
    this.unsaved(what, error);
  }

  /**
   * A spell change from the GM's board: one cast through a token's eyes, one erased (the Template tool's tap, Ctrl +
   * click), or the GM's own cleared. A spell that lasts is one of Atlas's kept measures (in one step of its history),
   * hosting or not: the board, Atlas and every player get it from there. An instantaneous one goes off and is kept
   * nowhere: shown here, and flashed to the players while Connect hosts.
   */
  private gmSpell(path: string, change: SpellChange): void {
    if ('remove' in change && this.endFlash(change.remove)) return;
    if ('clear' in change) for (const { cast } of [...this.flashes]) if (cast.owner === GM_SPELL_OWNER) this.endFlash(cast.id);
    const write = spellWrite(change, this.map?.measures ?? [], this.map?.level ?? null);
    if (!write) return;
    if ('flash' in write) {
      this.flash({ id: `flash:${this.nextFlash++}`, ...write.flash }, null);
      const session = this.services.session?.();
      if ('add' in change && session?.hosting()) session.flashSpell?.(path, change.add, change.rules, change.name ? { name: change.name, ...(change.about ? { about: change.about } : {}) } : undefined);
      return;
    }
    this.writeMeasures(path, write, 'spell');
  }

  /**
   * The GM's Template tool: a template placed is one of Atlas's kept measures, as wide and as long as Atlas shapes it;
   * a tap takes anyone's off, and the clear the GM's own (each in one step of Atlas's history).
   */
  private gmTemplate(path: string, change: TemplateChange): void {
    this.writeMeasures(path, templateWrite(change, this.map?.measures ?? [], this.map?.level ?? null), 'template');
  }

  /**
   * The GM's Measure tool: keeps a measurement (with colour, visibility, effect, width) or clears every kept
   * measurement of the shown level in one step of Atlas's history.
   */
  private gmMeasure(path: string, change: MeasureChange): void {
    this.writeMeasures(path, measureWrite(change, this.map?.measures ?? [], this.map?.level ?? null), 'measure');
  }

  private writeMeasures(path: string, write: MeasureWrite, what: string): void {
    const { writer } = this.services;
    const done = 'add' in write ? writer.addMeasure(path, write.add) : writer.removeMeasures(path, write.remove);
    done.catch((error: unknown) => this.measureRefused(what, error));
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

/** A layer's extras as its drawing asks for them (`ElevationLayerData`). */
function layerExtras(extras: RecordExtras): Pick<ElevationLayerData, 'wallHeight' | 'windowOf' | 'wallWidth' | 'wallMaterial' | 'doorProp' | 'doorFlip' | 'lightHeight'> {
  return {
    wallHeight: extras.wallHeight, windowOf: extras.windowOf, wallWidth: extras.wallWidth, wallMaterial: extras.wallMaterial,
    doorProp: extras.doorProp, doorFlip: extras.doorFlip, lightHeight: (id) => extras.lightHeight(id) ?? DEFAULT_LIGHT_SQUARES,
  };
}
