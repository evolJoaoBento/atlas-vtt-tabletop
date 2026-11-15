import type { ParityRow } from './types';

/** Atlas 0.15.0's asset manager tabs (as 0.12.0's) (`asset-manager/types.ts`), in order. */
export const ATLAS_ASSET_TABS: readonly ParityRow[] = [
  { id: 'scenes', status: 'native', note: 'Opens the scene on the board.' },
  { id: 'maps', status: 'native', note: 'Browsed on the board; a map opens its latest scene on the board, and a new scene from a map is made in Atlas.' },
  { id: 'encounters', status: 'native', note: 'Spawned onto the board: on the map, fight or beside the map.' },
  { id: 'tokens', status: 'native', note: 'Spawned onto the board at the camera centre.' },
  { id: 'party', status: 'native', note: 'Spawned onto the board at the camera centre.' },
];
