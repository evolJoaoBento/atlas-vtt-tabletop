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
  | 'help' | 'measure' | 'diceTray' | 'diceLog' | 'sceneSwitcher' | 'dashboard' | 'nextMood' | 'silence'
  | 'fitMap' | 'fitToken' | 'levelUp' | 'levelDown' | 'selectAll' | 'delete';

/**
 * Atlas's shortcuts that do something on the board: these here, Atlas's tools the board opens (`atlasTools.ts`), undo and
 * redo, and the keys the board handles itself (Move, Keep, Escape, the initiative tracker and its turns). The shortcut
 * help lists these alone.
 */
const ON_BOARD: ReadonlySet<MapHotkeyId> = new Set<MapHotkeyId>([
  'help', 'palette', 'assets', 'lootRoller', 'undo', 'redo', 'redoAlt', 'cancel', 'move', 'measure', 'measureKeep',
  'initiative', 'previousTurn', 'nextTurn', 'diceTray', 'diceLog', 'sceneSwitcher', 'dashboard', 'nextMood', 'silence',
  'fitMap', 'fitToken', 'levelUp', 'levelDown', 'selectAll', 'delete', 'deleteAlt',
]);

/** Whether Atlas's shortcut `id` does something on the board. */
export function worksOnBoard(id: string): boolean {
  return ON_BOARD.has(id as MapHotkeyId);
}

/** The board's own keys, for the shortcut help: a heading, then what each key does. */
export const BOARD_OWN_KEYS: ReadonlyArray<{ heading: string; keys: ReadonlyArray<{ does: string; keys: string; when?: string }> }> = [
  {
    heading: 'Tabletop: camera',
    keys: [
      { does: 'Move the camera', keys: 'W A S D / Arrow keys' },
      { does: 'Turn the camera', keys: 'Q / E' },
      { does: 'Frame the whole map', keys: 'Home' },
    ],
  },
  {
    heading: 'Tabletop: board',
    keys: [
      { does: 'Send a carried token up or down a level', keys: '↑ / ↓ or Page Up / Page Down', when: 'while dragging' },
      { does: 'Show wall height handles', keys: 'Ctrl/Cmd', when: 'held over a wall' },
      { does: 'Show wall width handles', keys: 'Alt/Option', when: 'held over a wall' },
      { does: 'Erase with the water brush', keys: 'Alt', when: 'held' },
      { does: 'Finish a shape', keys: 'Enter', when: 'Shapes tool' },
      { does: "Remove a shape's corner", keys: 'Delete / Backspace', when: 'Shapes tool' },
    ],
  },
  {
    heading: "Tabletop: through a token's eyes",
    keys: [
      { does: 'Cast a spell', keys: 'F' },
      { does: 'Step back, or leave the eyes', keys: 'Escape' },
    ],
  },
];

/** Atlas's shortcut ids behind each action, in the order they are tried (Delete has two keys, as in Atlas). */
const ACTION_KEYS: ReadonlyArray<readonly [BoardHotkeyAction, MapHotkeyId]> = [
  ['help', 'help'],
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
