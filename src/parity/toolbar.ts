import type { ParityRow } from './types';

/** Atlas 0.12.0's toolbar catalog (`toolbarCatalog.ts`), in Atlas's order, then its undo unit. */
export const ATLAS_TOOLBAR: readonly ParityRow[] = [
  { id: 'move', status: 'mapped', note: "The board's Move/Select tool (with the laser pointer)." },
  { id: 'fog', status: 'not-yet', note: 'Fog painting is a later round.' },
  { id: 'draw', status: 'not-yet', note: 'Drawing is a later round.' },
  { id: 'text', status: 'not-yet', note: 'Text is a later round.' },
  { id: 'measure', status: 'native', note: "The board's Measure tool (line, circle, cone, in the theme's accent), and the token drag ruler." },
  { id: 'wall', status: 'not-yet', note: 'Drawing walls and placing lights is a later round; the board has its lighting menu.' },
  { id: 'pin', status: 'not-yet', note: 'Placing note pins is a later round; the board shows them.' },
  { id: 'audio', status: 'not-yet', note: 'Ambient sound (off in Atlas 0.12.0) is a later round.' },
  { id: 'dice', status: 'native', note: "The board's own dice (Tabletop dice) and dice log." },
  { id: 'loot', status: 'native', note: 'Random tables window on the board (src/loot).' },
  { id: 'assets', status: 'native', note: 'Asset manager on the board, spawning onto the board (src/assets).' },
  { id: 'palette', status: 'native', note: 'Command palette on the board (src/palette).' },
  { id: 'undo', status: 'native', note: "The board's Undo/Redo (Atlas's keys): Atlas's own history for map changes Atlas takes, the file's text otherwise, and Tabletop's own data (water, props, walls, minis, layers) and templates." },
];
