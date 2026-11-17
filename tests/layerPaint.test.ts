import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floodFill, LayerHistory, paintStroke } from '../src/background/layerPaint';

const S = 64;
const at = (l: Uint8Array, x: number, y: number): number => l[y * S + x];

test('a hard stroke sets the value along the segment and reports its box', () => {
  const l = new Uint8Array(S * S);
  const box = paintStroke(l, S, { x: 10, y: 10 }, { x: 20, y: 10 }, 3, 200);
  assert.equal(at(l, 15, 10), 200);
  assert.equal(at(l, 15, 15), 0);
  assert.equal(at(l, 10, 10), 200);
  assert.equal(at(l, 20, 10), 200);
  assert.ok(box && box.x0 <= 8 && box.x1 >= 22 && box.y0 <= 8 && box.y1 >= 12);
  assert.ok(box.x0 >= 6 && box.x1 <= 24 && box.y0 >= 6 && box.y1 <= 14);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    if (at(l, i, j) !== 0) assert.ok(i >= box.x0 && i <= box.x1 && j >= box.y0 && j <= box.y1);
  }
});

test('a stroke clips to the layer and gives null when nothing changes', () => {
  const l = new Uint8Array(S * S);
  const box = paintStroke(l, S, { x: 1, y: 1 }, { x: -5, y: 1 }, 4, 9);
  assert.ok(box && box.x0 === 0 && box.y0 === 0);
  assert.equal(paintStroke(l, S, { x: 200, y: 200 }, { x: 210, y: 200 }, 3, 9), null);
  assert.equal(paintStroke(l, S, { x: 1, y: 1 }, { x: 1, y: 1 }, 2, 9), null, 'same value again changes nothing');
  assert.equal(paintStroke(l, S, { x: NaN, y: 1 }, { x: 4, y: 1 }, 2, 9), null);
});

test('a soft stroke moves values toward the target, barely at the rim', () => {
  const l = new Uint8Array(S * S);
  const box = paintStroke(l, S, { x: 32, y: 32 }, { x: 32, y: 32 }, 10, 255, true);
  assert.ok(box);
  assert.ok(at(l, 32, 32) > 220);
  assert.ok(at(l, 41, 32) < 40, 'rim barely changes');
  assert.ok(at(l, 41, 32) < at(l, 36, 32) && at(l, 36, 32) < at(l, 32, 32));
  const before = at(l, 36, 32);
  paintStroke(l, S, { x: 32, y: 32 }, { x: 32, y: 32 }, 10, 255, true);
  assert.ok(at(l, 36, 32) > before);
  assert.ok(at(l, 36, 32) <= 255);
});

test('a soft stroke can also lower values', () => {
  const l = new Uint8Array(S * S).fill(200);
  paintStroke(l, S, { x: 32, y: 32 }, { x: 32, y: 32 }, 8, 0, true);
  assert.ok(at(l, 32, 32) < 30);
  assert.equal(at(l, 0, 0), 200);
});

test('a continued segment does not dab twice at the joint', () => {
  const run = (continued: boolean): Uint8Array => {
    const l = new Uint8Array(S * S);
    paintStroke(l, S, { x: 10, y: 32 }, { x: 20, y: 32 }, 4, 255, true);
    paintStroke(l, S, { x: 20, y: 32 }, { x: 30, y: 32 }, 4, 255, true, continued);
    return l;
  };
  const twice = run(false), once = run(true);
  assert.ok(at(once, 20, 32) < at(twice, 20, 32));
  assert.ok(at(once, 20, 32) <= Math.max(at(once, 18, 32), at(once, 22, 32)) + 1, 'joint no darker than its neighbours');
});

test('fill of a closed ring fills inside only and reports the filled box', () => {
  const l = new Uint8Array(S * S);
  for (let i = 10; i <= 30; i++) { l[10 * S + i] = 5; l[30 * S + i] = 5; l[i * S + 10] = 5; l[i * S + 30] = 5; }
  assert.deepEqual(floodFill(l, S, 20, 20, 7), { x0: 11, y0: 11, x1: 29, y1: 29 });
  assert.equal(at(l, 20, 20), 7);
  assert.equal(at(l, 11, 11), 7);
  assert.equal(at(l, 10, 10), 5);
  assert.equal(at(l, 5, 5), 0);
  assert.equal(at(l, 40, 40), 0);
});

test('fill does not leak through a diagonal gap', () => {
  const l = new Uint8Array(S * S);
  for (let i = 0; i <= 20; i++) l[(20 - i) * S + i] = 3;
  assert.deepEqual(floodFill(l, S, 5, 5, 9), { x0: 0, y0: 0, x1: 19, y1: 19 });
  assert.equal(at(l, 15, 15), 0);
  assert.equal(at(l, 10, 10), 3, 'wall stays');
});

test('fill refuses when the value is the same or the start is outside', () => {
  const l = new Uint8Array(S * S);
  assert.equal(floodFill(l, S, 3, 3, 0), null);
  assert.equal(floodFill(l, S, -1, 3, 4), null);
  assert.equal(floodFill(l, S, 3, S, 4), null);
  assert.equal(floodFill(l, S, NaN, 3, 4), null);
  assert.equal(floodFill(l, S, 3, Infinity, 4), null);
  assert.equal(floodFill(l, S, 3, 3, NaN), null);
});

test('fill holds the value to a byte, so it cannot loop on a wrapped value', () => {
  const l = new Uint8Array(S * S);
  assert.deepEqual(floodFill(l, S, 3, 3, 256), { x0: 0, y0: 0, x1: S - 1, y1: S - 1 });
  assert.equal(at(l, 3, 3), 255);
  const m = new Uint8Array(S * S);
  assert.ok(floodFill(m, S, 0, 0, 1.5));
  assert.equal(at(m, 5, 5), 2, '1.5 rounds to 2');
  assert.equal(floodFill(m, S, 0, 0, 2.4), null, 'rounds to what is there already');
});

test('fill does not overflow the stack on a big layer', () => {
  const big = 2048;
  const l = new Uint8Array(big * big);
  assert.deepEqual(floodFill(l, big, 0, 0, 1), { x0: 0, y0: 0, x1: big - 1, y1: big - 1 });
  assert.equal(l[big * big - 1], 1);
});

test('a drag of three segments is one undo step; undo gives the exact bytes back, redo re-applies', () => {
  const l = new Uint8Array(S * S);
  l[5 * S + 5] = 77;
  const original = l.slice();
  const h = new LayerHistory(S);
  assert.equal(h.canUndo, false);
  assert.equal(h.undo(l), null);
  h.begin(l);
  paintStroke(l, S, { x: 20, y: 30 }, { x: 30, y: 30 }, 3, 200);
  paintStroke(l, S, { x: 30, y: 30 }, { x: 30, y: 40 }, 3, 200, false, true);
  paintStroke(l, S, { x: 30, y: 40 }, { x: 40, y: 40 }, 3, 200, false, true);
  const painted = l.slice();
  const box = h.commit(l);
  assert.ok(box && box.x0 > 0 && box.y0 > 0 && box.x1 < 50);
  assert.equal(h.canUndo, true);
  assert.deepEqual(h.undo(l), box);
  assert.deepEqual(l, original);
  assert.equal(h.canUndo, false, 'one step only');
  assert.equal(h.canRedo, true);
  assert.deepEqual(h.redo(l), box);
  assert.deepEqual(l, painted);
  assert.equal(h.canRedo, false);
});

test('a fill is one step with a box no bigger than the filled region', () => {
  const l = new Uint8Array(S * S);
  for (let i = 10; i <= 30; i++) { l[10 * S + i] = 5; l[30 * S + i] = 5; l[i * S + 10] = 5; l[i * S + 30] = 5; }
  const original = l.slice();
  const h = new LayerHistory(S);
  h.begin(l);
  floodFill(l, S, 20, 20, 7);
  assert.deepEqual(h.commit(l), { x0: 11, y0: 11, x1: 29, y1: 29 });
  h.undo(l);
  assert.deepEqual(l, original);
  assert.equal(h.canUndo, false);
});

test('a stroke that changes nothing makes no step; cancel makes none either', () => {
  const l = new Uint8Array(S * S);
  const h = new LayerHistory(S);
  h.begin(l);
  assert.equal(h.commit(l), null);
  assert.equal(h.canUndo, false);
  h.begin(l);
  l[0] = 9;
  h.cancel();
  assert.equal(h.commit(l), null, 'no stroke is open any more');
  assert.equal(h.canUndo, false);
});

test('undo only touches its box, away from the origin', () => {
  const l = new Uint8Array(S * S).fill(1);
  const h = new LayerHistory(S);
  h.begin(l);
  paintStroke(l, S, { x: 40, y: 40 }, { x: 44, y: 40 }, 2, 250);
  const box = h.commit(l);
  assert.ok(box && box.x0 > 0 && box.y0 > 0);
  l[0] = 99; // a change outside the box made after the step
  h.undo(l);
  assert.equal(l[0], 99, 'outside the box is left alone');
  assert.equal(at(l, 42, 40), 1);
});

test('a chain of steps undoes and redoes in order; a new stroke clears redo', () => {
  const l = new Uint8Array(S * S);
  const h = new LayerHistory(S);
  const states: Uint8Array[] = [l.slice()];
  for (let n = 1; n <= 3; n++) {
    h.begin(l);
    paintStroke(l, S, { x: n * 10, y: 20 }, { x: n * 10, y: 20 }, 2, 50 * n);
    h.commit(l);
    states.push(l.slice());
  }
  for (let n = 2; n >= 0; n--) { assert.ok(h.undo(l)); assert.deepEqual(l, states[n]); }
  assert.equal(h.undo(l), null);
  for (let n = 1; n <= 3; n++) { assert.ok(h.redo(l)); assert.deepEqual(l, states[n]); }
  assert.equal(h.redo(l), null);
  h.undo(l);
  h.begin(l);
  l[0] = 1;
  h.commit(l);
  assert.equal(h.canRedo, false);
});

test('history keeps the newest 30 of 31 steps', () => {
  const l = new Uint8Array(S * S);
  const h = new LayerHistory(S, 30);
  for (let n = 1; n <= 31; n++) { h.begin(l); l[0] = n; h.commit(l); }
  let undone = 0;
  while (h.undo(l)) undone++;
  assert.equal(undone, 30);
  assert.equal(l[0], 1, 'the oldest step (0 to 1) was dropped, so we stop at 1');
});
