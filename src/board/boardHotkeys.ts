/**
 * Atlas's map shortcuts on the 3D board: which of the GM's Atlas key bindings does what on the board. Pure.
 *
 * The board's camera keeps W/A/S/D/Q/E (the user's call, 2026-11-20), so an Atlas binding that is one of those letters
 * works with Shift added on the board (`boardBinding`): Shift+A opens the asset manager. Every other binding is Atlas's
 * as the GM set it. Atlas's tools that live only on its 2D map (fog, draw, erase, text, pin, walls, sound) have no
 * action here (docs/BACKLOG.md).
 */
import { matchesHotkey, type MapHotkeyId } from '../atlasPort/app/keyboard/mapHotkeys';
import type { MeasureMode } from '../atlasPort/app/measure/measureTypes';
import { MEASURE_MODES } from './measureOptions';

/** The keys that move and turn the board's camera (`board.ts`), lower case as `KeyboardEvent.key` gives them. */
export const CAMERA_KEYS: readonly string[] = ['w', 'a', 's', 'd', 'q', 'e'];

/** An Atlas binding as the board takes it: a camera letter gets Shift, anything else is left as it is. */
export function boardBinding(binding: string | null): string | null {
  if (!binding) return null;
  return CAMERA_KEYS.includes(binding) ? `Shift+${binding}` : binding;
}

/** What an Atlas shortcut does on the board. */
export type BoardHotkeyAction =
  | 'measure' | 'diceTray' | 'diceLog' | 'sceneSwitcher' | 'dashboard' | 'nextMood' | 'silence'
  | 'fitMap' | 'fitToken' | 'levelUp' | 'levelDown' | 'selectAll' | 'delete';

/** Atlas's shortcut ids behind each action, in the order they are tried (Delete has two keys, as in Atlas). */
const ACTION_KEYS: ReadonlyArray<readonly [BoardHotkeyAction, MapHotkeyId]> = [
  ['measure', 'measure'],
  ['diceTray', 'diceTray'],
  ['diceLog', 'diceLog'],
  ['sceneSwitcher', 'sceneSwitcher'],
  ['dashboard', 'dashboard'],
  ['nextMood', 'nextMood'],
  ['silence', 'silence'],
  ['fitMap', 'fitMap'],
  ['fitToken', 'fitToken'],
  ['levelUp', 'levelUp'],
  ['levelDown', 'levelDown'],
  ['selectAll', 'selectAll'],
  ['delete', 'delete'],
  ['delete', 'deleteAlt'],
];

/** The action a key stands for on the board, read with the GM's Atlas bindings (`binding(id)`), or null. */
export function boardHotkeyAction(event: KeyboardEvent, binding: (id: MapHotkeyId) => string | null): BoardHotkeyAction | null {
  for (const [action, id] of ACTION_KEYS) {
    const key = boardBinding(binding(id));
    if (key && matchesHotkey(event, key)) return action;
  }
  return null;
}

/**
 * The measure mode Atlas's Measure key steps to while the tool is already chosen: the next in the bar's order, the
 * first after the last, passing over Ranges while it cannot be chosen (`nextMeasureMode` in Atlas).
 */
export function nextBoardMeasureMode(mode: MeasureMode, ranges: boolean): MeasureMode {
  const modes = ranges ? MEASURE_MODES : MEASURE_MODES.filter((one) => one !== 'ranges');
  const index = modes.indexOf(mode);
  return modes[(index + 1) % modes.length] ?? 'ruler';
}
