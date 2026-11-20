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
import { atlasPlayToolButtons, boardAssetsBinding, boardKey, type AtlasToolId } from './atlasTools';
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
      if (event.defaultPrevented || !deps.container.closest('.workspace-leaf')?.classList.contains('mod-active')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"], .atlas-tabletop-atlas-ui, .modal-container')) return;
      if (this.key(event, deps.board()?.carryingToken ?? false)) { event.preventDefault(); event.stopPropagation(); }
    };
    win.addEventListener('keydown', onKey, true);
    this.stopKeys = () => win.removeEventListener('keydown', onKey, true);
    this.palette = new PaletteWindow(deps.container, deps.app, {
      ...deps.palette,
      setLootRollerOpen: (open) => (open ? this.loot.open() : this.loot.close()),
    }, () => this.deps.board()?.refreshToolbar());
  }

  /** The board's toolbar buttons for Atlas's tools, in the GM's Atlas layout. */
  attach(board: Board): void {
    const layout = this.bridge.toolbarLayout();
    const label: Record<AtlasToolId, string> = { loot: at('toolbar.lootRoller'), assets: at('toolbar.assetManager'), palette: at('toolbar.commandPalette') };
    const shortcut = (id: AtlasToolId): string | null => {
      const key = id === 'loot' ? this.bridge.hotkey('lootRoller') : id === 'assets' ? boardAssetsBinding(this.bridge.hotkey('assets')) : this.bridge.hotkey('palette');
      return key ? formatHotkey(key) : null;
    };
    const ids: AtlasToolId[] = [...atlasPlayToolButtons(layout), 'palette'];
    const tools: AtlasToolButton[] = ids.map((id) => ({
      id, label: label[id], shortcut: shortcut(id),
      enabled: () => id !== 'assets' || this.assets.available(),
      active: () => (id === 'loot' ? this.loot.isOpen() : id === 'assets' ? this.assets.isOpen() : this.palette.isOpen()),
      run: () => this.run(id),
    }));
    board.setAtlasTools(tools);
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
    if (deps.undo && bound('undo')) { deps.undo(); return true; }
    if (deps.redo && (bound('redo') || bound('redoAlt'))) { deps.redo(); return true; }
    const id = boardKey(event, {
      carrying, typing: false,
      hotkeys: { lootRoller: this.bridge.hotkey('lootRoller'), assets: this.bridge.hotkey('assets'), palette: this.bridge.hotkey('palette') },
    });
    if (!id) return false;
    this.run(id);
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
  }
}
