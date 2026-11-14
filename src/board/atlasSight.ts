/**
 * What players are shown of a lit scene, as Atlas works it out (sight follows Atlas, fusion 4D): the answer of the
 * shared player visibility reader (`packages/atlas-host/src/lighting`) for the Atlas tab that holds the map, in the
 * board's terms. The board works out no sight of its own.
 */
import type { PlayerVisibility } from '../../packages/atlas-host/src/index';

/** Where players see the map, cell by cell (1 = shown), `cellSize` world px square from the map's top-left corner. */
export interface SightCells {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly shown: Uint8Array;
}

export type BoardSight =
  /** Lighting hides nothing: the scene is unlit. */
  | { readonly kind: 'unlit' }
  /** Not known yet (the host is loading, another map, the lighting switching): players are shown nothing. */
  | { readonly kind: 'pending' }
  | {
    readonly kind: 'ready';
    /** The tokens Atlas shows players (a token it only senses is outlined there, and left out here). */
    readonly seen: ReadonlySet<string>;
    /** Whether players see the map at (x, y). */
    seenAt(x: number, y: number): boolean;
    readonly cells: SightCells;
  };

export const UNLIT: BoardSight = Object.freeze({ kind: 'unlit' });
export const PENDING: BoardSight = Object.freeze({ kind: 'pending' });

/** Whether the raster shows the map at (x, y); nowhere off it. */
export function cellShown(cells: SightCells, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return false;
  const col = Math.floor(x / cells.cellSize);
  const row = Math.floor(y / cells.cellSize);
  return col < cells.cols && row < cells.rows && cells.shown[row * cells.cols + col] === 1;
}

/** Atlas's answer in the board's terms. */
export function boardSightOf(visibility: PlayerVisibility): BoardSight {
  if (visibility.status === 'unlit') return UNLIT;
  if (visibility.status !== 'ready') return PENDING;
  const cells = visibility.darkness;
  const seen = new Set(Object.entries(visibility.tokens).filter(([, perception]) => perception === 'seen').map(([id]) => id));
  return Object.freeze({ kind: 'ready', seen, cells, seenAt: (x: number, y: number) => cellShown(cells, x, y) });
}
