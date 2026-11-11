/**
 * Atlas's command palette on the 3D board: Atlas's own React component (copied, src/atlasPort/app), mounted over the board
 * inside an `.atlas-vtt-plugin` root, with the same entries, order, search and keys. Its store is the board's: each entry
 * does what src/parity/palette.ts says (the board's tools, dice log, random tables, initiative and player view), and what
 * is Atlas's opens Atlas's own palette on that page (src/palette/paletteHost.ts).
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { CommandPalette } from '../atlasPort/app/react/components/CommandPalette';
import { ContextMenuProvider } from '../atlasPort/app/react/root/ContextMenuContext';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';
import { ViewStoreProvider } from '../atlasPort/shims/viewStore';
import { paletteChanged, setPaletteHost, type PaletteHost } from './paletteHost';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The part of an Atlas map view's store the palette reads, answered by the board. */
export function paletteStore(host: PaletteHost, close: () => void): any {
  const listeners = new Set<() => void>();
  let state: any;
  const refresh = (): void => {
    state = {
      ...state,
      initiativeTrackerOpen: host.initiativeOpen(),
    };
    for (const listener of [...listeners]) listener();
  };
  state = {
    mapPath: null,
    commandPalettePage: null,
    isGridAlignmentOpen: false,
    setGridAlignmentOpen: () => {},
    setActiveTool: (tool: string) => host.selectTool(tool),
    widgetSettings: { widgets: {} },
    setWidgetSettings: () => {}, updateWidget: () => {}, addWidget: () => {}, removeWidget: () => {},
    initiative: { entries: [] },
    setInitiativeConfig: () => {},
    initiativeTrackerOpen: host.initiativeOpen(),
    setInitiativeTrackerOpen: (open: boolean) => { host.setInitiativeOpen(open); refresh(); },
    setDiceLogOpen: (open: boolean) => host.setDiceLogOpen(open),
    setLootRollerOpen: (open: boolean) => host.setLootRollerOpen(open),
    setCommandPaletteOpen: (open: boolean) => { if (!open) close(); },
    lootRoller: { open: false },
  };
  return {
    getState: () => state,
    getInitialState: () => state,
    setState: (partial: any) => { state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) }; refresh(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
  };
}

export class PaletteWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private readonly store: any;
  private open_ = false;

  constructor(host: HTMLElement, private readonly app: App, private readonly palette: PaletteHost) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.store = paletteStore(palette, () => this.close());
    this.root = createRoot(this.el);
    this.render();
  }

  isOpen(): boolean {
    return this.open_;
  }

  open(): void {
    setPaletteHost(this.palette);
    this.store.refresh();
    this.open_ = true;
    this.render();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.render();
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  /** The board's player view or initiative changed: entries that show a state read it again. */
  changed(): void {
    this.store.refresh();
    paletteChanged();
  }

  dispose(): void {
    this.root.unmount();
    this.el.remove();
  }

  private render(): void {
    // The palette's map view: only what its entries call on it (the board has no Atlas player mode of its own).
    const view = {
      openSceneBrowser: () => this.palette.openSceneBrowser(),
      isInPlayerMode: () => false,
      setPlayerMode: () => this.palette.openInAtlas(),
    };
    this.root.render(
      <AtlasUIContext.Provider value={{ app: this.app, view: view as never, pixiApp: null, renderer: null }}>
        <ViewStoreProvider store={this.store}>
          <ContextMenuProvider>
            <CommandPalette isOpen={this.open_} onClose={() => this.close()} onCustomizeToolbar={() => this.palette.openInAtlas('customize-toolbar')} />
          </ContextMenuProvider>
        </ViewStoreProvider>
      </AtlasUIContext.Provider>,
    );
  }
}
