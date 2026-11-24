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
import { atlasViewFor } from './atlasViewProxy';
import { paletteChanged, setPaletteHost, type PaletteHost } from './paletteHost';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** What a map view's store has for the palette when no Atlas view holds the board's map (the pages show Atlas's defaults). */
const NO_ATLAS_STATE: any = {
  mapPath: null,
  widgetSettings: { widgets: {} },
  setWidgetSettings: () => {}, updateWidget: () => {}, addWidget: () => {}, removeWidget: () => {}, setWidgetOn: () => {},
  initiative: { entries: [] },
  isGridAlignmentOpen: false,
  setGridAlignmentOpen: () => {},
  setHotkeyHelpOpen: () => {},
  setDMScreenPage: () => {}, setDMScreenOpen: () => {}, setDocsOpen: () => {}, openArmarium: () => {},
  levels: [],
};

/**
 * The store the palette reads: Atlas's own store of the map view holding the board's map (so its pages read and write the map
 * as Atlas's do, and Atlas's map and the board agree), with the few entries that are the board's own on top (its tools, dice
 * log, random tables, initiative tracker, DM screen, shortcut help). Without an Atlas view the pages show Atlas's defaults.
 */
export function paletteStore(host: PaletteHost, close: () => void, atlasStore: () => any | null = () => null, help: () => void = () => {}): any {
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const listener of [...listeners]) listener(); };
  let own: any;
  let held: any = null;
  let stopHeld: (() => void) | null = null;
  let merged: any = null;
  let mergedFor: [any, any] = [null, null];
  /** Follows whichever Atlas store holds the map now, telling the palette's pages when it or the board's own state changes. */
  const follow = (): void => {
    const next = atlasStore();
    if (next === held) return;
    stopHeld?.();
    held = next;
    stopHeld = next ? next.subscribe(notify) : null;
  };
  const refresh = (): void => {
    follow();
    own = { ...own, initiativeTrackerOpen: host.initiativeOpen() };
    notify();
  };
  own = {
    commandPalettePage: null,
    setActiveTool: (tool: string) => host.selectTool(tool),
    initiativeTrackerOpen: host.initiativeOpen(),
    setInitiativeTrackerOpen: (open: boolean) => { host.setInitiativeOpen(open); refresh(); },
    setDiceLogOpen: (open: boolean) => host.setDiceLogOpen(open),
    setLootRollerOpen: (open: boolean) => host.setLootRollerOpen(open),
    setCommandPaletteOpen: (open: boolean) => { if (!open) close(); },
    lootRoller: { open: false },
    // Atlas's shortcut help is the board's; its DM screen, docs and armarium are Atlas's windows, opened in Atlas.
    setHotkeyHelpOpen: (open: boolean) => { if (open) help(); },
    // Grid alignment is done on Atlas's own map: the palette gives way and Atlas's view takes it from there.
    isGridAlignmentOpen: false,
    setGridAlignmentOpen: (open: boolean) => { if (open) { close(); host.openInAtlas('grid-alignment'); } },
    setDMScreenPage: () => {},
    setDMScreenOpen: (open: boolean) => { if (open) host.openInAtlas('dm-screen'); },
    setDocsOpen: (open: boolean) => { if (open) host.openInAtlas('docs'); },
    openArmarium: () => host.openInAtlas('armarium'),
  };
  return {
    getState: () => {
      const atlas = held?.getState() ?? null;
      if (merged === null || mergedFor[0] !== own || mergedFor[1] !== atlas) {
        merged = { ...NO_ATLAS_STATE, ...(atlas ?? {}), ...own };
        mergedFor = [own, atlas];
      }
      return merged;
    },
    getInitialState: () => merged ?? NO_ATLAS_STATE,
    setState: (partial: any) => { own = { ...own, ...(typeof partial === 'function' ? partial(own) : partial) }; notify(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    refresh,
  };
}

export class PaletteWindow {
  private readonly root: Root;
  private readonly el: HTMLElement;
  private readonly store: any;
  private open_ = false;
  private heldView: object | null = null;
  private view: Record<string, unknown> | null = null;

  constructor(
    host: HTMLElement,
    private readonly app: App,
    private readonly palette: PaletteHost,
    private readonly onStateChange?: () => void,
  ) {
    this.el = host.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-atlas-ui';
    host.appendChild(this.el);
    this.store = paletteStore(palette, () => this.close(), () => (palette.atlasView?.() as any)?.atlasStore ?? null, () => palette.openHotkeyHelp?.());
    this.root = createRoot(this.el);
    this.render();
  }

  isOpen(): boolean {
    return this.open_;
  }

  /** Opens the palette: on its list, or straight on one of its settings pages (Atlas's `setCommandPaletteOpen(true, page)`). */
  open(page?: string): void {
    setPaletteHost(this.palette);
    this.store.setState({ commandPalettePage: page ?? null });
    this.store.refresh();
    this.open_ = true;
    this.render();
    this.onStateChange?.();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.store.setState({ commandPalettePage: null });
    this.render();
    this.onStateChange?.();
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
    // The palette's map view: the Atlas view holding the board's map, whose store and services Atlas's settings pages read and
    // write; what its entries do to the view itself (the scene browser, Atlas's player mode) is the board's to answer.
    const own: Record<string, unknown> = {
      openSceneBrowser: () => this.palette.openSceneBrowser(),
      isInPlayerMode: () => false,
      setPlayerMode: () => this.palette.openInAtlas(),
    };
    const atlas = this.palette.atlasView?.() as object | null | undefined;
    if (atlas !== this.heldView) { this.heldView = atlas ?? null; this.view = atlas ? atlasViewFor(atlas, own) : own; }
    const view = atlas ? this.view : own;
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
