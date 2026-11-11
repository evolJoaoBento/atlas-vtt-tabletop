/**
 * What Atlas's command palette (copied, src/atlasPort/app) does on the 3D board, by Atlas's own command ids
 * (src/parity/palette.ts): its tools are the board's tools, its player window is the board's player view, and what lives
 * on Atlas's 2D map or in Atlas's settings opens Atlas's own palette on that page.
 */
import type { TabletopCommand } from './tabletopCommands';

export interface PaletteHost {
  /** Atlas's tools: `move` and `measure` are the board's, the rest open in Atlas. */
  selectTool(tool: string): void;
  setDiceLogOpen(open: boolean): void;
  setLootRollerOpen(open: boolean): void;
  initiativeOpen(): boolean;
  setInitiativeOpen(open: boolean): void;
  openSceneBrowser(): void;
  playerViewOpen(): boolean;
  togglePlayerView(): void;
  playerFrozen(): boolean;
  togglePlayerFreeze(): void;
  /** Shows the board's scene to players through Atlas (its send-map-to-player-view). */
  presentInAtlas(): void;
  /** Tabletop's own settings (lighting, board settings) as palette entries. */
  tabletopCommands?(): TabletopCommand[];
  /** Opens Atlas's own command palette on one of its pages (or its first) for what the board does not do. */
  openInAtlas(page?: string): void;
}

let current: PaletteHost | null = null;
const listeners = new Set<() => void>();

export function setPaletteHost(host: PaletteHost | null): void {
  current = host;
  for (const listener of [...listeners]) listener();
}

export function paletteHost(): PaletteHost | null {
  return current;
}

/** Tells the palette's stand-ins to read the host again (the player view opened, a freeze). */
export function paletteChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function onPaletteChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
