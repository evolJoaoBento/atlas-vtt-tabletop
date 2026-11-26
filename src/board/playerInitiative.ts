/**
 * Atlas's players' initiative list in the local player window (a screen the players look at), as Atlas's own player window
 * shows it: Atlas's `PlayerInitiativePanel` (copied, src/atlasPort/app), with the cards of the combatants players see, their
 * turn, hit points and conditions as Atlas lets players see them. It stands in a row across the top of the window, the
 * Baldur's Gate way (`playerWindowSettings`), and follows the store of the Atlas view holding the board's map.
 */
import '../atlasPort/installHost';
import type { App } from 'obsidian';
import { PlayerInitiativePanel } from '../atlasPort/app/services/PlayerInitiativePanel';
import { initiativeScaleOf } from '../atlasPort/app/services/playerInitiativeList';
import { playerWindowSettings } from '../atlasPort/shims/settingsService';
import type { WidgetBarView } from './widgetBar';

/* eslint-disable @typescript-eslint/no-explicit-any */
export class PlayerWindowInitiative {
  private readonly panel: PlayerInitiativePanel;
  private view: WidgetBarView | null = null;
  private readonly listeners = new Set<(state: any, previous: any) => void>();
  private readonly stopScale: () => void;

  /** `trackerOpen` says whether the board's tracker is open: players see the list while it is, as they do while Atlas's own tracker is. */
  constructor(readonly parent: HTMLElement, app: App, private readonly trackerOpen: () => boolean) {
    const settings = playerWindowSettings(app) as any;
    this.panel = new PlayerInitiativePanel(app, settings);
    this.panel.mount(parent);
    const container = parent.querySelector<HTMLElement>(':scope > .atlas-player-initiative-container');
    // Atlas's own CSS reads its variables under this class, which the player window's stage lacks.
    container?.classList.add('atlas-vtt-plugin');
    // The list's size is Atlas's Player view setting (the player window puts it on its overlays)
    const scale = (): void => container?.style.setProperty('--atlas-player-initiative-scale', String(initiativeScaleOf(settings?.getLocalPlayerViewSettings?.()?.initiativeScale)));
    scale();
    this.stopScale = settings?.onChange?.(scale) ?? (() => {});
  }

  /** The Atlas view now holding the map; with none, the list last shown stays (Atlas's player window holds it so too). */
  setView(view: WidgetBarView | null): void {
    if (view === this.view) return;
    this.view = view;
    if (view) this.panel.present(this.store(view.atlasStore));
    else this.panel.hold();
  }

  /** The board's tracker opened or closed: the list is picked again. */
  trackerChanged(): void {
    for (const listener of this.listeners) listener(this.stateOf(this.view?.atlasStore), undefined);
  }

  /** Atlas's store as the list reads it, its tracker open where the board's is too. */
  private store(store: any): any {
    return {
      ...store,
      getState: () => this.stateOf(store),
      subscribe: (listener: (state: any, previous: any) => void) => {
        const stop = store.subscribe((state: any, previous: any) => listener(this.stateOf(store, state), previous));
        this.listeners.add(listener);
        return () => { stop(); this.listeners.delete(listener); };
      },
    };
  }

  private stateOf(store: any, state: any = store?.getState()): any {
    return !state || state.initiativeTrackerOpen === true || !this.trackerOpen() ? state : { ...state, initiativeTrackerOpen: true };
  }

  dispose(): void {
    this.stopScale();
    this.panel.destroy();
    this.listeners.clear();
    this.parent.querySelector(':scope > .atlas-player-initiative-container')?.remove();
  }
}
