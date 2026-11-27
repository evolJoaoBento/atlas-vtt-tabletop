/**
 * Atlas's toolbar tools on one board view: the random tables window, the asset manager and the command palette (Atlas's own
 * components, src/loot, src/assets, src/palette), their toolbar buttons in the GM's Atlas order and their keys.
 */
import { matchesHotkey } from '../atlasPort/app/keyboard/mapHotkeys';
import { Notice, type App, type WorkspaceLeaf } from 'obsidian';
import { AtlasBridge } from '../atlasBridge';
import { AssetWindow } from '../assets/AssetWindow';
import type { BoardSpawnHost } from '../assets/boardTarget';
import { at } from '../atlasPort/atlasText';
import { formatHotkey } from '../atlasPort/app/keyboard/mapHotkeys';
import { LootWindow } from '../loot/LootWindow';
import type { PaletteHost } from '../palette/paletteHost';
import { PaletteWindow } from '../palette/PaletteWindow';
import { HotkeyHelpWindow } from './HotkeyHelpWindow';
import { SoundWindow } from './SoundWindow';
import { atlasPlayToolButtons, boardKey, type AtlasToolId } from './atlasTools';
import { widgetTakes } from './widgetKeys';
import { boardBinding, boardHotkeyAction } from './boardHotkeys';
import type { Board } from './board';
import type { AtlasToolButton } from './toolbar';
import type { TokenWriter } from './tokenWriter';

export interface BoardAtlasToolsDeps {
  app: App;
  leaf: WorkspaceLeaf;
  container: HTMLElement;
  writer: TokenWriter;
  board(): Board | null;
  mapPath(): string | null;
  palette: Omit<PaletteHost, 'setLootRollerOpen'>;
  spawn: Omit<BoardSpawnHost, 'leaf' | 'writer' | 'mapPath'>;
  /** Tabletop's undo history, on Atlas's undo and redo keys. */
  undo?(): void;
  redo?(): void;
}

export class BoardAtlasTools {
  private readonly bridge: AtlasBridge;
  readonly loot: LootWindow;
  readonly assets: AssetWindow;
  readonly palette: PaletteWindow;
  readonly help: HotkeyHelpWindow;
  readonly sound: SoundWindow;
  private readonly stopKeys: () => void;

  constructor(private readonly deps: BoardAtlasToolsDeps) {
    this.bridge = new AtlasBridge(deps.app);
    const vault = deps.app.vault;
    this.loot = new LootWindow(deps.container, {
      app: deps.app,
      readMap: async (path) => { const file = vault.getFileByPath(path); return file ? vault.read(file) : null; },
      save: (path, settings) => deps.writer.lootRoller(path, settings),
    });
    this.assets = new AssetWindow(deps.container, deps.app, { ...deps.spawn, leaf: deps.leaf, writer: deps.writer, mapPath: deps.mapPath });
    // Atlas's keys work wherever the board's tab is active, as in Atlas's map view (not only on the 3D canvas), and never
    // while a text field or one of Atlas's windows has the key.
    const win = deps.container.ownerDocument.defaultView ?? window;
    const onKey = (event: KeyboardEvent): void => {
      // A widget's number held (Atlas's widget bar): its keys (Space among them) step the widget, as in Atlas's map.
      if (event.defaultPrevented || widgetTakes(event) || !deps.container.closest('.workspace-leaf')?.classList.contains('mod-active')) return;
      // Atlas's Sound page over the board has the keys, wherever the focus fell.
      if (this.sound?.isOpen()) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .atlas-tabletop-atlas-ui, .modal-container')) return;
      if (this.key(event, deps.board()?.carryingToken ?? false)) { event.preventDefault(); event.stopPropagation(); }
    };
    win.addEventListener('keydown', onKey, true);
    this.stopKeys = () => win.removeEventListener('keydown', onKey, true);
    this.palette = new PaletteWindow(deps.container, deps.app, {
      ...deps.palette,
      setLootRollerOpen: (open) => (open ? this.loot.open() : this.loot.close()),
      openHotkeyHelp: () => { if (!this.help.isOpen()) this.help.toggle(); },
      openSoundPage: () => this.openSound(),
    }, () => this.deps.board()?.refreshToolbar());
    this.sound = new SoundWindow(deps.container, deps.app, () => this.deps.board()?.refreshToolbar());
    this.help = new HotkeyHelpWindow(deps.container, deps.app, () => this.deps.board()?.refreshToolbar());
  }

  /** The board's toolbar buttons for Atlas's tools, in the GM's Atlas layout. */
  attach(board: Board): void {
    const layout = this.bridge.toolbarLayout();
    const label: Record<AtlasToolId, string> = { loot: at('toolbar.lootRoller'), assets: at('toolbar.assetManager'), palette: at('toolbar.commandPalette') };
    const shortcut = (id: AtlasToolId): string | null => {
      const key = id === 'loot' ? this.bridge.hotkey('lootRoller') : id === 'assets' ? boardBinding(this.bridge.hotkey('assets')) : this.bridge.hotkey('palette');
      return key ? formatHotkey(key) : null;
    };
    const ids: AtlasToolId[] = [...atlasPlayToolButtons(layout), 'palette'];
    const tools: AtlasToolButton[] = ids.map((id) => ({
      id, label: label[id], shortcut: shortcut(id),
      enabled: () => id !== 'assets' || this.assets.available(),
      active: () => (id === 'loot' ? this.loot.isOpen() : id === 'assets' ? this.assets.isOpen() : this.palette.isOpen()),
      run: () => this.run(id),
      ...(id === 'palette' && { openPage: (page: string) => { this.palette.open(page); this.deps.board()?.refreshToolbar(); } }),
    }));
    board.setAtlasTools(tools);
    const help = this.bridge.hotkey('help');
    board.setHelp({
      label: at('hotkey.help'), shortcut: help ? formatHotkey(help) : null,
      active: () => this.help.isOpen(),
      open: () => this.help.toggle(),
    });
  }

  run(id: AtlasToolId): void {
    if (id === 'loot') this.loot.toggle();
    else if (id === 'palette') this.palette.toggle();
    else if (this.assets.available()) this.assets.toggle();
    else new Notice(`Tabletop: ${at('toolbarEdit.assets.label')} needs Atlas with a map open.`);
    this.deps.board()?.refreshToolbar();
  }

  /** A key on the board: true when it opened one of Atlas's tools. */
  key(event: KeyboardEvent, carrying: boolean): boolean {
    const deps = this.deps;
    const bound = (id: 'undo' | 'redo' | 'redoAlt'): boolean => { const key = this.bridge.hotkey(id); return key !== null && matchesHotkey(event, key, true); };
    // A fog polygon under way takes Enter, Backspace and the undo key before the undo history does (the undo drops its last corner).
    if (deps.board()?.fogKey(event, bound('undo')) === true) return true;
    if (deps.undo && bound('undo')) { deps.undo(); return true; }
    if (deps.redo && (bound('redo') || bound('redoAlt'))) { deps.redo(); return true; }
    const id = boardKey(event, {
      carrying, typing: false,
      hotkeys: { lootRoller: this.bridge.hotkey('lootRoller'), assets: this.bridge.hotkey('assets'), palette: this.bridge.hotkey('palette') },
    });
    if (id) { this.run(id); return true; }
    return this.boardAction(event);
  }

  /**
   * The rest of Atlas's map shortcuts that the board has something for (`boardHotkeys.ts`): true when the key did it.
   * A key the board itself uses now (the Shapes tool, the eyes, a token being carried) is left to the board.
   */
  private boardAction(event: KeyboardEvent): boolean {
    const board = this.deps.board();
    if (!board || board.ownsKey(event)) return false;
    const action = boardHotkeyAction(event, (id) => this.bridge.hotkey(id));
    switch (action) {
      case null: return false;
      case 'help': this.help.toggle(); return true;
      case 'measure': return board.measureKey(event);
      case 'diceTray': return board.goToToolbar('dice');
      case 'diceLog': return board.goToToolbar('dice-log');
      case 'sceneSwitcher': this.deps.palette.openSceneBrowser(); return true;
      case 'dashboard': return this.inAtlas('atlas-vtt:open-dashboard');
      case 'nextMood': return this.inAtlas('atlas-vtt:sound-next-mood');
      case 'silence': return this.inAtlas('atlas-vtt:sound-silence');
      case 'fitMap': board.frameMap(); return true;
      case 'fitToken': return board.frameToken();
      case 'levelUp': return board.stepLevel(1);
      case 'levelDown': return board.stepLevel(-1);
      case 'selectAll': return board.selectAll();
      case 'delete': return board.deleteSelection();
      case 'copy': return board.copySelection();
      case 'cut': return board.cutSelection();
      case 'paste': return board.pasteSelection();
      case 'duplicate': return board.duplicateSelection();
      case 'fog': return board.toggleFogTool();
      case 'brushSmaller': return board.stepFogBrush(-1, event.repeat);
      case 'brushLarger': return board.stepFogBrush(1, event.repeat);
      case 'gmView': return board.toggleGmView();
      case 'peek': return board.peek(true, event.key.toLowerCase());
    }
  }

  /** Shows Atlas's Sound page over the board: false when no Atlas has one (its DM screen opens in Atlas then). */
  openSound(): boolean {
    if (!this.sound.available()) return false;
    void this.sound.open().then((shown) => { if (!shown) new Notice("Tabletop: Atlas's Sound page could not be shown on the board."); });
    return true;
  }

  /** Runs one of Atlas's own commands on this scene's Atlas view (the dashboard, the sound desk). */
  private inAtlas(command: string): boolean {
    const path = this.deps.mapPath();
    if (!path || !this.bridge.runInAtlas(path, command, this.deps.leaf)) new Notice('Tabletop: this needs the scene open in Atlas.');
    return true;
  }

  setMap(path: string | null): void {
    void this.loot.setMap(path);
    this.assets.close();
  }

  dispose(): void {
    this.stopKeys();
    this.loot.dispose();
    this.assets.dispose();
    this.palette.dispose();
    this.help.dispose();
    this.sound.dispose();
  }
}
