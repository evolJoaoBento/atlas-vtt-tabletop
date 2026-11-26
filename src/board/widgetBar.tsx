/**
 * Atlas's widgets (counters, clocks and timers) on the 3D board: Atlas's own widget bar (copied, src/atlasPort/app),
 * mounted at the board's top right inside an `.atlas-vtt-plugin` root, as Atlas's map shows it at its top right. It
 * reads and writes the store of the Atlas view holding the board's map, so a widget stepped here is stepped in Atlas
 * (and for players), and one stepped in Atlas moves here; the board keeps no widgets of its own. Without an Atlas view
 * holding the map no widgets show. Its number keys (hold 1-5) work while the board's tab is the active one; Atlas's own
 * bar in its map tab then stays still (Atlas checks its own tab is the active one). While a number is held the widget's
 * keys are the bar's: the board's own shortcuts leave them alone (`widgetKeys.ts`), as Atlas's map shortcuts do.
 * The local player window shows Atlas's player window's own bar (`PlayerWindowWidgets`): the widgets shown to players,
 * read only.
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { ResponsiveWidgetBar } from '../atlasPort/app/react/components/ResponsiveWidgetBar';
import { AtlasUIContext } from '../atlasPort/shims/atlasUI';
import { matchesMapHotkey } from '../atlasPort/app/keyboard/mapHotkeys';
import { SettingsService, playerWindowSettings } from '../atlasPort/shims/settingsService';
import { giveToWidgets } from './widgetKeys';
import { PlayerWidgetBar } from '../atlasPort/app/services/PlayerWidgetBar';

/** Atlas's keys that act on the widget whose number is held. */
const HELD_KEYS = ['increase', 'increaseAlt', 'decrease', 'timerPlayPause', 'timerReset'] as const;
const NUMBERS = [1, 2, 3, 4, 5] as const;

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
  /** The widget numbers held now, by the key that holds them. */
  private readonly held = new Map<string, number>();
  private readonly stops: Array<() => void> = [];

  constructor(parent: HTMLElement, private readonly app: App) {
    this.el = parent.ownerDocument.createElement('div');
    this.el.className = 'atlas-vtt-plugin atlas-tabletop-widgets';
    // Atlas's hotkey guard asks whether the view with this id lies in the active tab: the board's.
    this.el.dataset.viewId = this.viewId;
    parent.appendChild(this.el);
    this.root = createRoot(this.el);
    // Heard before the board's own keys (made before the board is), so they can be left to the bar.
    const win = parent.ownerDocument.defaultView;
    if (win) {
      const down = (event: KeyboardEvent): void => this.keyDown(event);
      const up = (event: KeyboardEvent): void => { this.held.delete(event.code || event.key); };
      const blur = (): void => { this.held.clear(); };
      win.addEventListener('keydown', down, true);
      win.addEventListener('keyup', up, true);
      win.addEventListener('blur', blur);
      this.stops.push(() => { win.removeEventListener('keydown', down, true); win.removeEventListener('keyup', up, true); win.removeEventListener('blur', blur); });
    }
  }

  /** A widget's number held over the board, and the keys that step it meanwhile, are the bar's (not the board's shortcuts). */
  private keyDown(event: KeyboardEvent): void {
    if (!this.view || event.isComposing) return;
    if (this.el.closest('.workspace-leaf')?.classList.contains('mod-active') === false) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const settings = SettingsService.forApp(this.app);
    const shown = this.el.querySelectorAll('.atlas-widget').length;
    const number = NUMBERS.find((n) => n <= shown && matchesMapHotkey(event, `widget${n}`, settings));
    if (number) {
      this.held.set(event.code || event.key, number);
      giveToWidgets(event);
      return;
    }
    if (this.held.size > 0 && HELD_KEYS.some((id) => matchesMapHotkey(event, id, settings))) giveToWidgets(event);
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
    for (const stop of this.stops.splice(0)) stop();
    this.root.unmount();
    this.el.remove();
  }
}

/**
 * Atlas's widgets in the local player window (a screen the players look at), as Atlas's player window shows them: its own
 * read-only bar (`PlayerWidgetBar`, copied), with the widgets shown to players, at the window's top right.
 */
export class PlayerWindowWidgets {
  private readonly bar: PlayerWidgetBar;
  private view: WidgetBarView | null = null;

  constructor(readonly parent: HTMLElement, app: App) {
    // The players' list stands across the top (`playerWindowSettings`): the widgets come down the right edge, clear of it.
    this.bar = new PlayerWidgetBar(playerWindowSettings(app) as never);
    this.bar.mount(parent);
  }

  /** The Atlas view now holding the map; with none, the widgets last shown stay (Atlas's player window holds them so too). */
  setView(view: WidgetBarView | null): void {
    if (view === this.view) return;
    this.view = view;
    if (view) this.bar.present(view.atlasStore);
    else this.bar.hold();
  }

  dispose(): void {
    this.bar.destroy();
    this.parent.querySelector(':scope > #atlas-player-widgets')?.remove();
  }
}
