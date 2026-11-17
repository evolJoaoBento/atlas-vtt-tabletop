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
  assert.ok(box && box.x0 <= 7 && box.x1 >= 23 && box.y0 <= 7 && box.y1 >= 13);
  assert.ok(box.x0 >= 6 && box.x1 <= 24 && box.y0 >= 6 && box.y1 <= 14);
  // every changed pixel is inside the box
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
});

test('a soft stroke moves values toward the target, barely at the rim', () => {
  const l = new Uint8Array(S * S);
  const box = paintStroke(l, S, { x: 32, y: 32 }, { x: 32, y: 32 }, 10, 255, true);
  assert.ok(box);
  assert.ok(at(l, 32, 32) > 240);
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
  assert.ok(at(l, 32, 32) < 20);
  assert.equal(at(l, 0, 0), 200);
});

test('fill of a closed ring fills inside only', () => {
  const l = new Uint8Array(S * S);
  for (let i = 10; i <= 30; i++) { l[10 * S + i] = 5; l[30 * S + i] = 5; l[i * S + 10] = 5; l[i * S + 30] = 5; }
  assert.equal(floodFill(l, S, 20, 20, 7), true);
  assert.equal(at(l, 20, 20), 7);
  assert.equal(at(l, 11, 11), 7);
  assert.equal(at(l, 10, 10), 5);
  assert.equal(at(l, 5, 5), 0);
  assert.equal(at(l, 40, 40), 0);
});

test('fill refuses when the value is the same or the start is outside', () => {
  const l = new Uint8Array(S * S);
  assert.equal(floodFill(l, S, 3, 3, 0), false);
  assert.equal(floodFill(l, S, -1, 3, 4), false);
  assert.equal(floodFill(l, S, 3, S, 4), false);
});

test('fill does not overflow the stack on a big layer', () => {
  const big = 2048;
  const l = new Uint8Array(big * big);
  assert.equal(floodFill(l, big, 0, 0, 1), true);
  assert.equal(l[big * big - 1], 1);
});

test('undo puts the exact bytes back and redo re-applies', () => {
  const l = new Uint8Array(S * S);
  l[5 * S + 5] = 77;
  const original = l.slice();
  const h = new LayerHistory();
  assert.equal(h.canUndo, false);
  assert.equal(h.undo(l), false);
  const box = { x0: 0, y0: 0, x1: 30, y1: 30 };
  h.record(l, box);
  paintStroke(l, S, { x: 10, y: 10 }, { x: 20, y: 10 }, 3, 200);
  const painted = l.slice();
  assert.equal(h.canUndo, true);
  assert.equal(h.undo(l), true);
  assert.deepEqual(l, original);
  assert.equal(h.canRedo, true);
  assert.equal(h.redo(l), true);
  assert.deepEqual(l, painted);
  assert.equal(h.canRedo, false);
});

test('a new record clears redo', () => {
  const l = new Uint8Array(S * S);
  const h = new LayerHistory();
  const box = { x0: 0, y0: 0, x1: 63, y1: 63 };
  h.record(l, box); l[0] = 1;
  h.undo(l);
  assert.equal(h.canRedo, true);
  h.record(l, box);
  assert.equal(h.canRedo, false);
});

test('history keeps the newest 30 of 31 records', () => {
  const l = new Uint8Array(S * S);
  const h = new LayerHistory(30);
  const box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let n = 1; n <= 31; n++) { h.record(l, box); l[0] = n; }
  let undone = 0;
  while (h.undo(l)) undone++;
  assert.equal(undone, 30);
  assert.equal(l[0], 1, 'the oldest record (before value 1) was dropped, so we stop at 1');
});
