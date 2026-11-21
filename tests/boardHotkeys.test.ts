import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availableHotkeys, DEFAULT_MAP_HOTKEYS, type MapHotkeyId } from '../src/atlasPort/app/keyboard/mapHotkeys';
import { BOARD_OWN_KEYS, boardBinding, boardHotkeyAction, nextBoardMeasureMode, worksOnBoard } from '../src/board/boardHotkeys';

const key = (init: Partial<KeyboardEvent> & { key: string }) =>
  ({ shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, ...init }) as KeyboardEvent;
const defaults = (id: MapHotkeyId): string | null => DEFAULT_MAP_HOTKEYS[id] ?? null;

test('a camera letter takes Shift on the board, every other binding stays as Atlas has it', () => {
  for (const letter of ['w', 'a', 's', 'd', 'q', 'e']) assert.equal(boardBinding(letter), `Shift+${letter}`);
  assert.equal(boardBinding('m'), 'm');
  assert.equal(boardBinding('Shift+1'), 'Shift+1');
  assert.equal(boardBinding('Mod+a'), 'Mod+a');
  assert.equal(boardBinding(null), null);
});

test("Atlas's default keys reach their board actions", () => {
  const cases: Array<[Partial<KeyboardEvent> & { key: string }, string]> = [
    [{ key: '?', shiftKey: true, code: 'Slash' }, 'help'],
    [{ key: 'm' }, 'measure'],
    [{ key: 'r' }, 'diceTray'],
    [{ key: 'Enter' }, 'diceLog'],
    [{ key: 'g' }, 'sceneSwitcher'],
    [{ key: 'Tab' }, 'dashboard'],
    [{ key: 'n' }, 'nextMood'],
    [{ key: 'S', shiftKey: true }, 'silence'],
    [{ key: '!', shiftKey: true, code: 'Digit1' }, 'fitMap'],
    [{ key: '@', shiftKey: true, code: 'Digit2' }, 'fitToken'],
    [{ key: 'PageUp' }, 'levelUp'],
    [{ key: 'PageDown' }, 'levelDown'],
    [{ key: 'a', ctrlKey: true }, 'selectAll'],
    [{ key: 'Delete' }, 'delete'],
    [{ key: 'Backspace' }, 'delete'],
    [{ key: 'f' }, 'fog'],
    [{ key: ',' }, 'brushSmaller'],
    [{ key: '.' }, 'brushLarger'],
  ];
  for (const [init, action] of cases) assert.equal(boardHotkeyAction(key(init), defaults), action, `${JSON.stringify(init)} -> ${action}`);
});

test('the camera letters and the 2D-only tools do nothing here', () => {
  for (const letter of ['w', 'a', 's', 'd', 'q', 'e', 'b', 't', 'p']) assert.equal(boardHotkeyAction(key({ key: letter }), defaults), null, letter);
});

test("the GM's rebinding wins, and a rebinding to a camera letter takes Shift", () => {
  const bound = (id: MapHotkeyId): string | null => (id === 'diceTray' ? 'x' : id === 'measure' ? 'w' : defaults(id));
  assert.equal(boardHotkeyAction(key({ key: 'x' }), bound), 'diceTray');
  assert.equal(boardHotkeyAction(key({ key: 'r' }), bound), null);
  assert.equal(boardHotkeyAction(key({ key: 'w' }), bound), null);
  assert.equal(boardHotkeyAction(key({ key: 'W', shiftKey: true }), bound), 'measure');
});

test('a held key does not repeat an action', () => {
  assert.equal(boardHotkeyAction(key({ key: 'r', repeat: true }), defaults), null);
  assert.equal(boardHotkeyAction(key({ key: 'f', repeat: true }), defaults), null);
  // The brush keys of the fog tool are the exception: held, they go on sizing it.
  assert.equal(boardHotkeyAction(key({ key: ',', repeat: true }), defaults), 'brushSmaller');
  assert.equal(boardHotkeyAction(key({ key: '.', repeat: true }), defaults), 'brushLarger');
});

test("the Measure key steps through the modes in the bar's order, passing over Ranges while it cannot be chosen", () => {
  assert.equal(nextBoardMeasureMode('ruler', true), 'circle');
  assert.equal(nextBoardMeasureMode('line', true), 'ranges');
  assert.equal(nextBoardMeasureMode('ranges', true), 'ruler');
  assert.equal(nextBoardMeasureMode('line', false), 'ruler');
});

test("the shortcut help lists Atlas's shortcuts the board has, not its 2D map tools or what the board lacks", () => {
  for (const id of ['help', 'palette', 'assets', 'measure', 'diceTray', 'fitToken', 'levelUp', 'selectAll', 'delete', 'initiative', 'nextTurn', 'fog', 'drawSmaller', 'drawLarger']) assert.ok(worksOnBoard(id), id);
  for (const id of ['draw', 'erase', 'text', 'pin', 'wall', 'audio', 'gmView', 'lightingPeek', 'copy', 'paste', 'duplicate', 'widget1', 'increase']) assert.ok(!worksOnBoard(id), id);
});

test("the board's own keys name the camera and the eyes", () => {
  const all = BOARD_OWN_KEYS.flatMap((group) => group.keys.map((entry) => entry.keys));
  assert.ok(all.includes('W A S D / Arrow keys') && all.includes('Q / E') && all.includes('F'));
});

test('Atlas 0.17+: Next mood and Silence need no experimental switch; the Sound page is not on the board, the brush size keys size the fog brush', () => {
  const ids = (player: boolean): string[] => availableHotkeys(player, () => false).map((action) => action.id);
  assert.ok(ids(false).includes('nextMood'));
  assert.ok(ids(false).includes('silence'));
  assert.equal(DEFAULT_MAP_HOTKEYS.soundPage, 's');
  assert.equal(DEFAULT_MAP_HOTKEYS.drawSmaller, ',');
  assert.equal(DEFAULT_MAP_HOTKEYS.drawLarger, '.');
  assert.ok(!ids(true).includes('soundPage'), 'the DM screen is the GM\'s');
  // Its S would become Shift+S on the board, which is Silence: so it is left off the board, and out of the shortcut help.
  assert.equal(worksOnBoard('soundPage'), false);
  // The brush size keys size the fog tool's brush (and are the shortcut help's, as they work).
  for (const id of ['drawSmaller', 'drawLarger']) assert.equal(worksOnBoard(id), true, id);
  assert.equal(worksOnBoard('silence'), true);
  assert.equal(DEFAULT_MAP_HOTKEYS.silence, 'Shift+s');
});
