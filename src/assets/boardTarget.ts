/**
 * The 3D board as Atlas's asset manager sees it. Atlas's spawn code (copied, src/atlasPort/app) asks for "the map view"
 * (`loadAtlasView`, whose stand-in answers with `boardAtlasView`) and places tokens around its viewport's centre with its
 * grid, then adds them to its store in one write. Here the viewport's centre is the board camera's, the grid is the
 * map's, and the store's `addTokens` writes through the board's `TokenWriter` (Atlas's own store when Atlas holds the map).
 * So Atlas's own layout, hit point rolls, vision defaults and encounter formations run unchanged against the board.
 */
import type { WorkspaceLeaf } from 'obsidian';
import { snapPoint } from '../board/geometry';
import type { BoardGrid } from '../board/mapModel';
import type { TokenWriter } from '../board/tokenWriter';

export interface BoardSpawnHost {
  leaf: WorkspaceLeaf;
  writer: TokenWriter;
  /** The map the board shows; null while none. */
  mapPath(): string | null;
  /** The point of the map the camera looks at, in map pixels. */
  centre(): { x: number; y: number };
  grid(): BoardGrid | null;
  /** The map's tokens as its file holds them (for laying out tokens beside the map). */
  tokens(): Record<string, Record<string, unknown>>;
  /** Selects tokens on the board (once they stand on it). */
  select(ids: readonly string[]): void;
  /** Puts tokens into the initiative tracker and opens it. */
  joinInitiative(ids: readonly string[]): Promise<void>;
  /** Shows another scene on the board. */
  openMap(path: string): Promise<void>;
}

let current: BoardSpawnHost | null = null;

/** The board the asset manager acts on (the one it was opened over); null closes the way. */
export function setSpawnBoard(host: BoardSpawnHost | null): void {
  current = host;
}

export function spawnBoard(): BoardSpawnHost | null {
  return current;
}

/** Atlas's grid system, as its spawn code uses it: the options and where a token of a size snaps. */
function gridSystemOf(grid: BoardGrid): { getOptions(): { type: string; size: number; offsetX: number; offsetY: number; enabled: boolean }; snapTokenCenter(x: number, y: number, size: number): { x: number; y: number } } {
  return {
    getOptions: () => ({ type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY, enabled: grid.enabled }),
    snapTokenCenter: (x, y, size) => snapPoint({ ...grid, snap: true }, x, y, size),
  };
}

/** The board dressed as the members of an Atlas map view that Atlas's spawn code reads; null without a board and map. */
export function boardAtlasView(host: BoardSpawnHost | null = current): unknown {
  const path = host?.mapPath();
  if (!host || !path) return null;
  const grid = host.grid();
  const viewport = {
    screenWidth: 2, screenHeight: 2, scale: { x: 1 },
    toWorld: () => host.centre(),
  };
  const state = () => ({
    mapPath: path,
    isMapLoading: false,
    grid: grid ? { size: grid.size, snapToGrid: grid.snap } : null,
    objects: { tokens: host.tokens() },
    addTokens: (inputs: ReadonlyArray<Record<string, unknown>>): string[] => {
      const { ids, done } = host.writer.addTokensNow(path, inputs);
      void Promise.resolve(done).catch((error: unknown) => console.error('Tabletop: could not add the tokens', error));
      return ids;
    },
    setSelection: (ids: readonly string[]) => host.select(ids),
  });
  return {
    leaf: host.leaf,
    getStore: () => ({ getState: state, subscribe: () => () => {} }),
    serviceManager: {
      getRendererService: () => ({
        getViewport: () => viewport,
        getGridSystem: () => (grid?.enabled ? gridSystemOf(grid) : null),
        getRenderer: () => null,
      }),
    },
  };
}
