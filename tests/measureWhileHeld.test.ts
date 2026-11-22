import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measureWhileHeld, type HeldMeasureKey } from '../src/atlasPort/measureWhileHeld';

/** A window that is only an event target, with the map's canvas as a known element. */
function setup() {
  const win = new EventTarget();
  const canvas = {};
  const log: string[] = [];
  const key: HeldMeasureKey = {
    onMap: (target) => target === canvas,
    tap: () => log.push('tap'),
    press: () => log.push('press'),
    release: () => log.push('release'),
  };
  const send = (type: string, props: object): void => {
    const event = new Event(type);
    for (const [name, value] of Object.entries(props)) Object.defineProperty(event, name, { value });
    win.dispatchEvent(event);
  };
  const down = (): void => measureWhileHeld({ code: 'KeyM', view: win } as unknown as KeyboardEvent, key);
  return {
    log, down,
    keyUp: () => send('keyup', { code: 'KeyM' }),
    press: (target: unknown = canvas, button = 0) => send('pointerdown', { target, button }),
    release: () => send('pointerup', {}),
    cancel: () => send('pointercancel', {}),
    blur: () => send('blur', {}),
  };
}

test('a key pressed and let go with no press on the map is a tap, on key up', () => {
  const held = setup();
  held.down();
  assert.deepEqual(held.log, []);
  held.keyUp();
  assert.deepEqual(held.log, ['tap']);
});

test('a press on the map while the key is down is a quick ruler: it starts at the press and ends when key and button are both up', () => {
  const held = setup();
  held.down();
  held.press();
  assert.deepEqual(held.log, ['press']);
  held.release();
  assert.deepEqual(held.log, ['press']);
  held.keyUp();
  assert.deepEqual(held.log, ['press', 'release']);
});

test('the key let go before the button: the ruler ends with the button', () => {
  const held = setup();
  held.down();
  held.press();
  held.keyUp();
  assert.deepEqual(held.log, ['press']);
  held.release();
  assert.deepEqual(held.log, ['press', 'release']);
});

test('a second press while the key is still down measures again without starting another hold', () => {
  const held = setup();
  held.down();
  held.press();
  held.release();
  held.press();
  held.release();
  held.keyUp();
  assert.deepEqual(held.log, ['press', 'release']);
});

test('a press off the map, or with another button, is not a measurement', () => {
  const held = setup();
  held.down();
  held.press({});
  held.press(undefined, 2);
  held.keyUp();
  assert.deepEqual(held.log, ['tap']);
});

test('losing the window focus ends a hold in use, and a tap not yet made is dropped', () => {
  const used = setup();
  used.down();
  used.press();
  used.blur();
  assert.deepEqual(used.log, ['press', 'release']);
  const unused = setup();
  unused.down();
  unused.blur();
  unused.keyUp();
  assert.deepEqual(unused.log, []);
});

test('a cancelled press ends like a released one', () => {
  const held = setup();
  held.down();
  held.press();
  held.keyUp();
  held.cancel();
  assert.deepEqual(held.log, ['press', 'release']);
});

test('after the hold ends nothing more is heard', () => {
  const held = setup();
  held.down();
  held.keyUp();
  held.press();
  held.keyUp();
  assert.deepEqual(held.log, ['tap']);
});
