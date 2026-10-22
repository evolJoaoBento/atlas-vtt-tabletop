import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listenForDiePresses } from '../src/dice/diePress';
import { GENTLE, type Flick } from '../src/dice/throwInput';

type Listener = (event: FakePointer) => void;

/** Just enough of an event target: listeners by type (capture or not), and events handed to them by hand. */
class FakeTarget {
  listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: Listener): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((have) => have !== fn)); }
  fire(type: string, event: FakePointer): void { for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event); }
  count(type: string): number { return this.listeners.get(type)?.length ?? 0; }
}

class FakePointer {
  stopped = false;
  prevented = false;
  constructor(readonly clientX: number, readonly clientY: number, readonly timeStamp: number, readonly target: unknown = null, readonly button = 0, readonly pointerId = 1) {}
  stopPropagation(): void { this.stopped = true; }
  preventDefault(): void { this.prevented = true; }
}

function presses(onDie = true) {
  const win = new FakeTarget();
  const container = Object.assign(new FakeTarget(), { ownerDocument: { defaultView: win } });
  const canvas = {};
  const released: Flick[] = [];
  const asked: Array<[number, number]> = [];
  const stop = listenForDiePresses({
    container: container as unknown as HTMLElement,
    canvas: () => canvas as EventTarget,
    pickUp: (x, y) => { asked.push([x, y]); return onDie ? (flick) => { released.push(flick) } : null; },
  });
  const down = (x: number, y: number, t: number, target: unknown = canvas, button = 0): FakePointer => {
    const event = new FakePointer(x, y, t, target, button);
    container.fire('pointerdown', event);
    return event;
  };
  return { win, container, canvas, released, asked, stop, down };
}

test('a click on a die the roll waits on is taken from the board and tosses it gently', () => {
  const { win, released, down } = presses();
  const event = down(100, 100, 0);
  assert.equal(event.stopped && event.prevented, true, 'the board never sees the press');
  assert.equal(win.count('pointerup'), 1);
  win.fire('pointerup', new FakePointer(102, 101, 80));
  assert.deepEqual(released, [GENTLE]);
  assert.equal(win.count('pointermove') + win.count('pointerup') + win.count('pointercancel'), 0, 'let go, the press stops listening');
});

test('a drag throws the die the way the pointer went, over its last 100 ms', () => {
  const { win, released, down } = presses();
  down(100, 300, 0);
  win.fire('pointermove', new FakePointer(100, 280, 50));
  win.fire('pointermove', new FakePointer(100, 250, 150));
  win.fire('pointermove', new FakePointer(100, 200, 200));
  win.fire('pointerup', new FakePointer(110, 150, 250));
  assert.deepEqual(released, [{ dx: 10, dy: -100, ms: 100 }]);
});

test('a press that is not on a die it may throw, or not on the board, or not the main button, is the board\'s', () => {
  const off = presses(false);
  assert.equal(off.down(1, 1, 0).stopped, false);
  assert.equal(off.win.count('pointerup'), 0);
  const { asked, down, win } = presses();
  assert.equal(down(1, 1, 0, {}).stopped, false, 'not on the canvas');
  assert.equal(down(1, 1, 0, undefined, 2).stopped, false, 'the right button');
  assert.deepEqual(asked, [], 'no die is looked for');
  assert.equal(win.count('pointerup'), 0);
});

test('a cancelled press throws nothing; another pointer\'s moves and lifts are not its own', () => {
  const { win, released, down } = presses();
  down(100, 100, 0);
  win.fire('pointerup', Object.assign(new FakePointer(500, 500, 50), { pointerId: 2 }));
  assert.equal(released.length, 0);
  win.fire('pointercancel', new FakePointer(100, 100, 60));
  assert.equal(released.length, 0);
  assert.equal(win.count('pointermove') + win.count('pointerup') + win.count('pointercancel'), 0);
});

test('stopping takes the board\'s listener away, and a press in progress with it, unreleased', () => {
  const { win, container, released, down, stop } = presses();
  down(100, 100, 0);
  stop();
  assert.equal(container.count('pointerdown'), 0);
  assert.equal(win.count('pointermove') + win.count('pointerup') + win.count('pointercancel'), 0);
  win.fire('pointerup', new FakePointer(100, 100, 50));
  assert.equal(released.length, 0);
});
