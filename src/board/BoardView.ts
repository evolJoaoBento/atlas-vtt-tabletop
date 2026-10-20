/**
 * The 3D board's tab: an Atlas map (`.atlasmap`) opened in 3D. It reads the map, follows the file as it changes (Atlas
 * saving it, a sync tool), follows a rename and closes when the map is deleted. What the board asks of Obsidian (images,
 * GLBs, the minis and props kept by Tabletop, saving a token's move, opening a note, the token menu) goes through
 * the plugin's `BoardServices`.
 */
import { ItemView, Menu, Notice, TFile, debounce, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { Assignments } from '../assignments';
import { MiniPicker } from '../gallery';
import type { LoadedMini, MiniLibrary } from '../library';
import { Board, type BoardHost } from './board';
import type { BoardData } from './boardData';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './conditions';
import { readMap, type BoardMap, type BoardToken } from './mapModel';
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
  /** This tab was used last: props from the gallery go to it. */
  focused(view: BoardView): void;
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
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.reload.cancel();
    this.board?.dispose();
    this.board = null;
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
    if (!this.board) this.board = new Board(this.contentEl, this.host(), QUALITY[this.services.quality()]);
    await this.board.load(map);
  }

  /** The map's conditions and resource names, from Atlas's asset index (in a hidden folder, read off the disk). */
  private async readRules(path: string): Promise<CollectionRules> {
    const collection = collectionOf(path);
    if (!collection) return emptyRules();
    try {
      return readCollectionRules(JSON.parse(await this.app.vault.adapter.read(ASSETS_METADATA_PATH)), collection);
    } catch {
      return emptyRules();
    }
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
        writer.move(mapPath(), id, x, y).catch((error: unknown) => {
          new Notice(`Tabletop: the move was not saved: ${error instanceof Error ? error.message : String(error)}`, 8000);
          this.reload();
        });
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
      statblockPreview: (id, event) => {
        const path = this.map?.tokens.find((token) => token.id === id)?.statblockPath;
        if (!path || !this.board) return;
        // Obsidian's page preview shows the note as it reads, the stat block drawn (Fantasy Statblocks) and its dice.
        this.app.workspace.trigger('hover-link', {
          event, source: HOVER_SOURCE, hoverParent: this, targetEl: this.board.canvas, linktext: path, sourcePath: mapPath(),
        });
      },
      warn: (message) => this.warn(message),
    };
  }

  private tokenMenu(id: string, event: MouseEvent): void {
    const map = this.map;
    const token = map?.tokens.find((candidate) => candidate.id === id);
    if (!map || !token) return;
    const { assignments, boardData, minis } = this.services;
    const current = assignments.get(map.path, id);
    const menu = new Menu();
    menu.addItem((item) => item.setTitle(current ? 'Change mini…' : 'Assign mini…').setIcon('box').onClick(() => {
      new MiniPicker(this.app, minis, tokenName(token), current, (result) => assignments.set(map.path, id, result)).open();
    }));
    if (current) menu.addItem((item) => item.setTitle('Remove mini').setIcon('x').onClick(() => assignments.remove(map.path, id)));
    const standee = boardData.style(map.path, id) === 'standee';
    menu.addItem((item) => item.setTitle(standee ? 'Show as disc' : 'Show as standee').setIcon(standee ? 'circle' : 'square-user')
      .onClick(() => boardData.setStyle(map.path, id, standee ? 'disc' : 'standee')));
    menu.showAtMouseEvent(event);
  }
}
