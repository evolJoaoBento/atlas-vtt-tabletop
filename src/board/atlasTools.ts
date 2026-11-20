/**
 * Atlas's toolbar tools on the board (random tables, asset manager, command palette): which show, in what order, and the
 * keys that open them. Pure. The order and what is hidden are the GM's Atlas toolbar layout; the keys are Atlas's own
 * (its defaults or the GM's rebinding), matched the way Atlas matches them (`matchesHotkey`). On the board a key that
 * is one of the camera's letters takes Shift (`boardBinding`): the asset manager's is Shift+A by default.
 */
import { matchesHotkey } from '../atlasPort/app/keyboard/mapHotkeys';
import { boardBinding } from './boardHotkeys';
import { ATLAS_CHECKED_VERSION } from '../parity';

export type AtlasToolId = 'loot' | 'assets' | 'palette';
const TOOLS: readonly AtlasToolId[] = ['loot', 'assets', 'palette'];

/** The Atlas tools the board shows, in the GM's Atlas order, minus those hidden there. */
export function atlasToolButtons(layout: { order: readonly string[]; hidden: ReadonlySet<string> }): AtlasToolId[] {
  return layout.order.filter((id): id is AtlasToolId => (TOOLS as readonly string[]).includes(id) && !layout.hidden.has(id));
}

/** The Play-mode Atlas tools (random tables and asset manager), in the GM's Atlas order, minus those hidden there. */
export function atlasPlayToolButtons(layout: { order: readonly string[]; hidden: ReadonlySet<string> }): Array<'loot' | 'assets'> {
  return atlasToolButtons(layout).filter((id): id is 'loot' | 'assets' => id !== 'palette');
}

export interface BoardKeyState {
  /** A token is being carried (Space then drops a ruler waypoint). */
  carrying: boolean;
  /** The key went to a text field. */
  typing: boolean;
  /** Atlas's bindings of the three tools (`lootRoller`, `assets`, `palette`). */
  hotkeys: { lootRoller: string | null; assets: string | null; palette: string | null };
}


/** Which Atlas tool a key opens on the board, or null. */
export function boardKey(event: KeyboardEvent, state: BoardKeyState): AtlasToolId | null {
  if (state.typing) return null;
  const { lootRoller, assets, palette } = state.hotkeys;
  if (palette && matchesHotkey(event, palette)) return state.carrying && palette === 'Space' ? null : 'palette';
  if (lootRoller && matchesHotkey(event, lootRoller)) return 'loot';
  const boardAssets = boardBinding(assets);
  if (boardAssets && matchesHotkey(event, boardAssets)) return 'assets';
  return null;
}

const parts = (version: string): number[] => (version.split('-')[0] ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);

/** Whether the installed Atlas is newer than the one the parity tables were checked against. */
export function atlasNewerThanChecked(installed: string | null): boolean {
  if (!installed) return false;
  const [a, b] = [parts(installed), parts(ATLAS_CHECKED_VERSION)];
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
