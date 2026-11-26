/**
 * Atlas's widgets (counters, clocks and timers) on the 3D board: Atlas's own widget bar (copied, src/atlasPort/app),
 * mounted at the board's top right inside an `.atlas-vtt-plugin` root, as Atlas's map shows it at its top right. It
 * reads and writes the store of the Atlas view holding the board's map, so a widget stepped here is stepped in Atlas
 * (and for players), and one stepped in Atlas moves here; the board keeps no widgets of its own. Without an Atlas view
 * holding the map no widgets show. Its number keys (hold 1-5) work while the board's tab is the active one; Atlas's own
 * bar in its map tab then stays still (Atlas checks its own tab is the active one).
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { ResponsiveWidgetBar } from '../atlasPort/app/react/components/ResponsiveWidgetBar';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The Atlas view holding the map, as far as the bar goes: its store (and its services, for the timer's ding). */
export interface WidgetBarView {
  atlasStore: any;
}

let mounts = 0;

export class BoardWidgets {
  private readonly el: HTMLElement;
  private readonly root: Root;
  private view: WidgetBarView | null = null;
  private readonly viewId = `tabletop-widgets-${++mounts}`;

  constructor(parent: HTMLElement, private readonly app: App) {
    this.el = parent.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-widgets';
    // Atlas's hotkey guard asks whether the view with this id lies in the active tab: the board's.
    this.el.dataset.viewId = this.viewId;
    parent.appendChild(this.el);
    this.root = createRoot(this.el);
  }

  /** The Atlas view now holding the board's map (null when none does): the bar follows its store. */
  setView(view: WidgetBarView | null): void {
    if (view === this.view) return;
    this.view = view;
    this.render();
  }

  private render(): void {
    const view = this.view;
    if (!view) { this.root.render(null); return; }
    this.root.render(
      <AtlasUIContext.Provider value={{ app: this.app, view: view as never, pixiApp: null, renderer: null }}>
        <ResponsiveWidgetBar store={view.atlasStore} viewId={this.viewId} />
      </AtlasUIContext.Provider>,
    );
  }

  dispose(): void {
    this.root.unmount();
    this.el.remove();
  }
}
