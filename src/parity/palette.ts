import type { ParityRow } from './types';

/** Atlas 0.19.0's command palette entries (0.12.0's, 0.14's lighting pages, 0.17's and 0.18's later ones; 0.19 adds none) (`CommandPalette.tsx` `commandOptions`, sub-page entries included), in order. */
export const ATLAS_PALETTE: readonly ParityRow[] = [
  { id: 'move-tool', status: 'mapped', note: "The board's Move/Select tool." },
  { id: 'fog-tool', status: 'native', note: "The board's Fog Tool (Edit mode)." },
  { id: 'measure-tool', status: 'native', note: "The board's Measure tool." },
  { id: 'note-pin-tool', status: 'not-yet', note: "Placing note pins is a later round; the entry opens Atlas's palette." },
  { id: 'open-scene-browser', status: 'native', note: "Atlas's scene browser, opened over the board." },
  { id: 'scene-snapshots', status: 'atlas', note: "Opens Atlas's palette on its snapshots page (snapshots draw from Atlas's 2D map)." },
  { id: 'scene-levels', status: 'atlas', note: "Opens Atlas's palette on its levels page; the board follows Atlas's level." },
  { id: 'replace-map-image', status: 'atlas', note: "Hands off to Atlas (replacing the image goes through Atlas's 2D map)." },
  { id: 'open-dice-log', status: 'native', note: "The board's dice log." },
  { id: 'open-loot-roller', status: 'native', note: 'The random tables window on the board.' },
  { id: 'toggle-player-mode', status: 'atlas', note: "Atlas's player mode, run in Atlas." },
  { id: 'freeze-player-camera', status: 'native', note: "The board's player view freeze." },
  { id: 'open-player-window', status: 'native', note: "The board's player view." },
  { id: 'transfer-player-view', status: 'atlas', note: "Atlas's player-window transfer, run in Atlas." },
  { id: 'show-map-in-player-window', status: 'atlas', note: "Atlas's send-map-to-player-view command." },
  { id: 'grid-settings', status: 'native', note: "Atlas 0.19's own Grid settings page (copied), opened inside the board's palette; its controls write the Atlas map view's store, so Atlas's map and the board agree." },
  { id: 'grid-all-settings', status: 'native', note: "Sub-entry of grid settings." },
  { id: 'token-settings', status: 'native', note: "Atlas 0.19's own Token settings page, in the board's palette; it writes the Atlas map view's store." },
  { id: 'token-all-settings', status: 'native', note: "Sub-entry of token settings." },
  { id: 'widget-settings', status: 'native', note: "Atlas 0.19's own Widgets page, in the board's palette; it reads and writes the Atlas map view's store and the collection's widgets (the widgets themselves are Atlas's 2D overlay)." },
  { id: 'local-player-view-settings', status: 'native', note: "Atlas 0.19's own player view settings page, in the board's palette; it writes Atlas's settings." },
  { id: 'local-player-view-all-settings', status: 'native', note: "Sub-entry of local player view settings." },
  { id: 'dice-settings', status: 'native', note: "Atlas 0.19's own dice settings page, in the board's palette; it writes Atlas's settings (its colour strip has no Atlas dice renderer behind it on the board)." },
  { id: 'dice-all-settings', status: 'native', note: "Sub-entry of dice settings." },
  // Atlas 0.14: the lighting settings became a palette page of their own.
  { id: 'lighting-settings', status: 'atlas', note: "Atlas 0.14's lighting settings page (the scene's light, ambient, vision); they write Atlas's map, so they open in Atlas. The board has its own lighting menu." },
  { id: 'lighting-all-settings', status: 'atlas', note: 'Sub-entry of lighting settings.' },
  { id: 'graphics-settings', status: 'native', note: "Atlas 0.19's own Graphics page, in the board's palette; it writes Atlas's settings (they set Atlas's 2D lighting; the board has its own lighting menu)." },
  { id: 'graphics-all-settings', status: 'native', note: "Sub-entry of graphics settings." },
  { id: 'experimental-features', status: 'native', note: "Atlas 0.19's own experimental switches page, in the board's palette; it writes Atlas's settings." },
  { id: 'experimental-all-features', status: 'native', note: "Sub-entry of experimental features." },
  // Atlas 0.17: the DM screen and the sound page (its `s` key is not on the board: Shift+S there is Silence).
  { id: 'open-dm-screen', status: 'atlas', addedIn: '0.17.0', note: "Atlas's DM screen; opened in Atlas." },
  { id: 'open-sound-page', status: 'atlas', addedIn: '0.17.0', note: "Atlas's sound page; opened in Atlas. The board has Next mood and Silence." },
  // Atlas 0.18: positioning a floor under the others, and the table mode.
  { id: 'position-floor', status: 'atlas', addedIn: '0.18.0', note: "Atlas's floor positioning (it writes the level alignment the board already reads); done in Atlas." },
  { id: 'table-mode', status: 'atlas', addedIn: '0.18.0', note: "Atlas's table mode (hides Obsidian's chrome while on); Atlas only." },
  { id: 'customize-toolbar', status: 'atlas', note: "Opens Atlas's toolbar editor; the board follows the layout it saves." },
];
