/**
 * Follows what Atlas shows players of a board's lit scene (fusion 4D): the shared player visibility reader
 * (`packages/atlas-host/src/lighting`, the one Connect sends players from) read from the Atlas tab that holds the map,
 * again whenever it may have changed, handed to the board as `BoardSight`s.
 *
 * Fails closed: a scene saved lit whose Atlas tab is not there, not on this map, or shows another level than the board
 * is `pending` (players are shown nothing); one saved unlit is `unlit`.
 */
import { atlasMapSize, playerVisibilityApi, type LightingApi, type LightingView } from '../../packages/atlas-host/src/index';
import type { AtlasView } from '../atlas';
import { boardSightOf, PENDING, UNLIT, type BoardSight } from './atlasSight';

/** What the watch reads of the board's map. */
export interface SightMap {
  readonly path: string;
  readonly lighting: { readonly enabled?: boolean } | null | undefined;
  /** The level the board shows (null: the scene's only one). */
  readonly level: string | null;
}

type HostView = AtlasView & { readonly renderer?: unknown };

/** Whether `view` holds `map` loaded, on the level the board shows. */
export function hostShows(view: HostView | null, map: SightMap): boolean {
  if (!view) return false;
  const state = view.atlasStore.getState() as unknown as { mapPath?: string | null; mapLoaded?: boolean; isMapLoading?: boolean; viewedLevel?: string | null };
  if (state.mapPath !== map.path || state.mapLoaded === false || state.isMapLoading === true) return false;
  const viewed = typeof state.viewedLevel === 'string' ? state.viewedLevel : null;
  return map.level === null || viewed === null || viewed === map.level;
}

/** The answer where Atlas cannot give one: nothing for a scene saved lit, no sight for one saved unlit. */
export function withoutHost(map: SightMap | null): BoardSight {
  return map?.lighting?.enabled === true ? PENDING : UNLIT;
}

export class SightWatch {
  private view: HostView | null = null;
  private map: SightMap | null = null;
  private pov: string | null = null;
  private stop: (() => void) | null = null;
  private readonly disposers = new Set<() => void>();
  private readonly api: LightingApi;

  constructor(private readonly answer: (players: BoardSight, pov: BoardSight | null) => void) {
    this.api = playerVisibilityApi({
      label: 'Tabletop',
      view: (viewId) => (this.view && this.view.viewId === viewId ? this.view as unknown as LightingView : null),
      mapSize: (view) => atlasMapSize(view),
      // Atlas lights scenes as standard since 0.9.1; Tabletop asks for 0.15.
      dynamicLighting: () => true,
      add: (dispose) => {
        this.disposers.add(dispose);
        return () => { this.disposers.delete(dispose); dispose(); };
      },
    });
  }

  /** Follows `view` (the Atlas tab holding the board's map, or null) for `map`, previewing `pov`'s sight; answers at once. */
  follow(view: HostView | null, map: SightMap | null, pov: string | null): void {
    if (view !== this.view) {
      this.stop?.();
      this.stop = null;
      this.view = view;
      if (view) this.stop = this.api.watch(view.viewId, () => this.update());
    }
    this.map = map;
    this.pov = pov;
    this.update();
  }

  /** Asks again and answers. */
  update(): void {
    const map = this.map;
    if (!map || !hostShows(this.view, map)) {
      const none = withoutHost(map);
      this.answer(none, this.pov === null ? null : none);
      return;
    }
    const id = this.view!.viewId;
    const players = boardSightOf(this.api.playerVisibility(id));
    const pov = this.pov === null ? null : boardSightOf(this.api.playerVisibility(id, { onlyToken: this.pov }));
    this.answer(players, pov);
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    for (const dispose of [...this.disposers]) dispose();
    this.disposers.clear();
    this.view = null;
  }
}
