/**
 * The 3D board's tab: an Atlas map (`.atlasmap`) opened in 3D. It reads the map, follows the file as it changes (Atlas
 * saving it, a sync tool), follows a rename and closes when the map is deleted. What the board asks of Obsidian (images,
 * GLBs, the minis and props kept by Tabletop, saving a token's move or resources, opening a note, the token menu with
 * Atlas's Kill and Delete) goes through the plugin's `BoardServices`. Atlas's initiative tracker stands at the board's
 * right edge (`initiativePanel.ts`): it shows the tracker Atlas holds while Atlas has the map open, following its
 * store as it changes, else the one in the file.
 */
import { ItemView, Menu, Notice, TFile, debounce, parseYaml, setIcon, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { AtlasView } from '../atlas';
import type { Assignments } from '../assignments';
import { MiniPicker } from '../gallery';
import type { LoadedMini, MiniLibrary } from '../library';
import { Board, type BoardHost } from './board';
import type { BoardData } from './boardData';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './conditions';
import { readMap, type BoardMap, type BoardToken } from './mapModel';
import { readMeasurement } from './measure';
import { defeatedResources } from './resources';
import { AtlasMenu } from './atlasMenu';
import { tokenMenuEntries } from './tokenMenu';
import { addToInitiative, conditionChange, conditionStep, initiativeEntryFor, initiativeId, removeFromInitiative, resetChange, type ConditionFields } from './tokenEdits';
import { applyInitiative, emptyInitiative, ownModifier, readInitiative, statblockModifier, type InitiativeAction, type InitiativeState } from './initiative';
import { InitiativePanel, type InitiativePanelHost } from './initiativePanel';
import type { TokenChange } from './tokenWriter';
import type { LaserSettings } from './laser';
import type { PlayerView } from './PlayerWindow';
import { QUALITY, type Quality } from './quality';
import type { TokenWriter } from './tokenWriter';

export const BOARD_VIEW_TYPE = 'atlas-tabletop-board';
/** The hover source Tabletop registers, so Obsidian's page preview shows stat blocks from the board. */
export const HOVER_SOURCE = 'atlas-vtt-tabletop';
const RELOAD_MS = 300;

/** What the board's tab uses of the plugin. */
export interface BoardServices {
  assignments: Assignments;
  boardData: BoardData;
  minis: MiniLibrary;
  props: MiniLibrary;
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
}

const tokenName = (token: BoardToken): string => token.name ?? token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'Token';

export class BoardView extends ItemView {
  private path: string | null = null;
  private board: Board | null = null;
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
      this.board?.dispose();
      this.board = null;
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
    // Atlas's keys for its tracker, taken before the board's (whose arrows move the camera).
    this.registerDomEvent(this.contentEl, 'keydown', (event) => this.initiativeKey(event), { capture: true });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.watchAtlas()));
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.menu?.close();
    this.watched?.stop();
    this.watched = null;
    this.initiative?.dispose();
    this.initiative = null;
    this.reload.cancel();
    this.board?.dispose();
    this.board = null;
    this.playerWindow?.waiting(true);
    this.playerWindow = null;
  }

  /** Whether this board has drawn its map, and so can draw a player view of it. */
  get ready(): boolean {
    return this.board !== null && this.map !== null;
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
    board.dispose();
    this.board = new Board(this.contentEl, this.host(), preset);
    await this.board.load(this.map);
    this.board.camera = camera;
    if (this.playerWindow) this.board.attachPlayer(this.playerWindow.stage);
    this.board.wake(true);
  }

  /** The minis, styles or props changed: the board draws them again. */
  refresh(): void {
    this.board?.refresh();
  }

  /** The next click on the board puts a prop of `glb` there. */
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
    if (!this.board) this.board = new Board(this.contentEl, this.host(), QUALITY[this.services.quality()]);
    await this.board.load(map);
    this.menu?.refresh();
    this.watchAtlas();
    // The tracker shows when the map has combatants; the I key or the board settings show or hide it.
    if (fresh) this.initiative?.setOpen(this.liveInitiative().entries.length > 0);
    this.initiative?.render();
    if (fresh && !this.closed) this.services.boardReady(this);
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
    };
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
  private initiativeAct(action: InitiativeAction): void {
    const map = this.map;
    if (!map) return;
    this.watchAtlas();
    const draws: number[] = [];
    let next = 0;
    if (!this.watched) {
      map.initiative = applyInitiative(map.initiative, action, () => { const draw = Math.random(); draws.push(draw); return draw; });
      this.initiative?.render();
    }
    this.services.writer.initiativeAction(map.path, action, () => draws[next++] ?? Math.random())
      .catch((error: unknown) => this.unsaved('initiative change', error));
  }

  /** Atlas's Roll: everyone, or one combatant, each adding its own modifier, else the one its statblock holds. */
  private async rollInitiative(entryId?: string): Promise<void> {
    const rules = this.rules.initiative;
    const statblockModifiers: Record<string, number> = {};
    for (const entry of this.liveInitiative().entries) {
      if ((entryId !== undefined && entry.id !== entryId) || ownModifier(entry) !== undefined) continue;
      const path = this.map?.tokens.find((token) => token.id === entry.tokenId)?.statblockPath ?? entry.statblockPath;
      const fields = path ? await this.statblockFields(path) : null;
      const modifier = fields ? statblockModifier(fields, rules) : null;
      if (modifier !== null) statblockModifiers[entry.id] = modifier;
    }
    if (this.closed) return;
    this.initiativeAct({ type: 'roll', roll: rules.roll, statblockModifiers, ...(entryId !== undefined && { entryId }) });
  }

  /** A statblock note's fields: its `statblock` block's, with its frontmatter laid over them, as Atlas reads them. */
  private async statblockFields(path: string): Promise<Record<string, unknown> | null> {
    const file = this.app.vault.getAbstractFileByPath(path.split('#')[0]!);
    if (!(file instanceof TFile)) return null;
    const front = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
    let block: Record<string, unknown> | undefined;
    const match = /```statblock[^\n]*\n([\s\S]*?)```/.exec(await this.app.vault.cachedRead(file));
    if (match) {
      try {
        const parsed: unknown = parseYaml(match[1]!);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) block = parsed as Record<string, unknown>;
      } catch {
        // A block that is not YAML holds no fields.
      }
    }
    return front || block ? { ...block, ...front } : null;
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
