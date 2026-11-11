/**
 * Atlas's asset manager on the 3D board: Atlas's own React components (copied, src/atlasPort/app), mounted over the board
 * inside an `.atlas-vtt-plugin` root so Atlas's live stylesheet styles them. It reads Atlas's library through Atlas's
 * running asset service. Tokens and encounters spawn onto the board through Atlas's own spawn code (src/assets/boardTarget.ts),
 * scenes open on the board, and the authoring windows (token creator, encounter builder, new scene…) open in Atlas.
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import AssetManager from '../atlasPort/app/packages/components/asset-manager/AssetManager';
import type { Tab } from '../atlasPort/app/packages/components/asset-manager/types';
import { ContextMenuProvider } from '../atlasPort/app/react/root/ContextMenuContext';
import { readLootRollerState } from '../atlasPort/app/stores/lootRollerSlice';
import { setHandOffApp } from '../atlasPort/shims/assetHandOffs';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';
import { ViewStoreProvider } from '../atlasPort/shims/viewStore';
import { AtlasBridge, type AssetTab } from '../atlasBridge';
import { createBoardStore } from '../loot/boardStore';
import { setSpawnBoard, type BoardSpawnHost } from './boardTarget';

export class AssetWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private readonly store = createBoardStore();
  private open_ = false;
  private tab: AssetTab | undefined;

  constructor(host: HTMLElement, private readonly app: App, private readonly board: BoardSpawnHost) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.root = createRoot(this.el);
    this.render();
  }

  /** Atlas's asset service is what lists the library: without Atlas there is nothing to show. */
  available(): boolean {
    return new AtlasBridge(this.app).assetService() !== null;
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(tab?: AssetTab): void {
    if (!this.available()) return;
    this.tab = tab;
    this.open_ = true;
    // The asset manager acts on this board while it is open.
    setSpawnBoard(this.board);
    setHandOffApp(this.app);
    this.store.load(this.board.mapPath(), readLootRollerState(undefined));
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.render();
  }

  toggle(tab?: AssetTab): void {
    if (this.open_) this.close();
    else this.open(tab);
  }

  dispose(): void {
    this.root.unmount();
    this.el.remove();
  }

  private render(): void {
    this.root.render(
      <AtlasUIContext.Provider value={{ app: this.app, view: null, pixiApp: null, renderer: null }}>
        <ViewStoreProvider store={this.store}>
          <ContextMenuProvider>
            <AssetManager isOpen={this.open_} onClose={() => this.close()} initialTab={this.tab as Tab | undefined} />
          </ContextMenuProvider>
        </ViewStoreProvider>
      </AtlasUIContext.Provider>,
    );
  }
}
