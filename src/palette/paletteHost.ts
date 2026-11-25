/**
 * What Atlas's command palette (copied, src/atlasPort/app) does on the 3D board, by Atlas's own command ids
 * (src/parity/palette.ts): its tools are the board's tools, its player window is the board's player view, and what lives
 * on Atlas's 2D map or in Atlas's settings opens Atlas's own palette on that page.
 */
import type { TabletopCommand } from './tabletopCommands';
import type { ToolbarActions } from '../board/toolbar';

/** What Tabletop's settings page in the palette reads and writes (the board's toolbar actions for the old Board settings panel). */
export type TabletopSettingsHost = Pick<ToolbarActions, 'fogHeight' | 'setFogHeight' | 'wallThickness' | 'setWallThickness' | 'wallEdges' | 'setWallEdges' | 'snap' | 'setSnap' | 'autoRoll' | 'setAutoRoll' | 'grade' | 'setGrade' | 'tiltShift' | 'setTiltShift' | 'occlusion' | 'setOcclusion' | 'halo' | 'setHalo' | 'seeThrough' | 'setSeeThrough' | 'seeThroughSize' | 'setSeeThroughSize' | 'layerLook' | 'setLayerLook' | 'initiativeOpen' | 'toggleInitiative'>;

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
  /** The settings Tabletop's own page in the palette holds; null when the board is not up. */
  tabletopSettings?(): TabletopSettingsHost | null;
  /** Opens Atlas's own command palette on one of its pages (or its first) for what the board does not do. */
  openInAtlas(page?: string): void;
  /** The Atlas map view holding the board's map (its store and services are what Atlas's settings pages write), or null. */
  atlasView?(): unknown;
  /** Shows the board's shortcut help (Atlas's palette entry for it). */
  openHotkeyHelp?(): void;
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
