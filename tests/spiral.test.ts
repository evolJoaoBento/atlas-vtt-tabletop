import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spiralOffsets, spiralSpot, type SpiralOptions } from '../src/board/spiral';

const base = (over: Partial<SpiralOptions> = {}): SpiralOptions => ({ center: { x: 350, y: 350 }, cell: 70, offsetX: 0, offsetY: 0, width: 700, height: 700, occupied: [], radius: 35, ...over });
const taken = (x: number, y: number) => ({ x, y, radius: 35 });

test('the spiral starts in the middle and winds outward: right, down, left, up, each leg longer', () => {
  const offsets: Array<[number, number]> = [];
  for (const offset of spiralOffsets()) {
    offsets.push(offset);
    if (offsets.length === 10) break;
  }
  assert.deepEqual(offsets, [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [2, -1]]);
});

test('a free board puts the token in the middle square', () => {
  assert.deepEqual(spiralSpot(base()), { x: 385, y: 385 });
});

test('the middle square is the one the middle falls in, whatever the grid offset', () => {
  assert.deepEqual(spiralSpot(base({ offsetX: 20, offsetY: 5 })), { x: 20 + 4.5 * 70 + 70 * 0, y: 5 + 4.5 * 70 });
});

test('a taken middle sends the token to the next square of the spiral, and so on', () => {
  const centre = spiralSpot(base());
  const second = spiralSpot(base({ occupied: [taken(centre.x, centre.y)] }));
  assert.deepEqual(second, { x: centre.x + 70, y: centre.y });
  const third = spiralSpot(base({ occupied: [taken(centre.x, centre.y), taken(second.x, second.y)] }));
  assert.deepEqual(third, { x: centre.x + 70, y: centre.y + 70 });
  const fourth = spiralSpot(base({ occupied: [taken(centre.x, centre.y), taken(second.x, second.y), taken(third.x, third.y)] }));
  assert.deepEqual(fourth, { x: centre.x, y: centre.y + 70 });
});

test('a big token needs more room than a small one, and a small one fits beside a small one', () => {
  const centre = spiralSpot(base());
  // A big token (three squares across) standing in the middle pushes a small one out of its reach.
  const outside = spiralSpot(base({ occupied: [{ x: centre.x, y: centre.y, radius: 105 }] }));
  assert.ok(Math.hypot(outside.x - centre.x, outside.y - centre.y) >= (105 + 35) * 0.9);
  const beside = spiralSpot(base({ occupied: [taken(centre.x, centre.y)] }));
  assert.equal(Math.hypot(beside.x - centre.x, beside.y - centre.y), 70);
});

test('a spot off the board is skipped, and a board with no room falls back to the middle', () => {
  const tiny = base({ width: 140, height: 140, center: { x: 70, y: 70 } });
  const first = spiralSpot(tiny);
  const crowd = [first, { x: 105, y: 35 }, { x: 105, y: 105 }, { x: 35, y: 105 }, { x: 35, y: 35 }].map((p) => taken(p.x, p.y));
  const spot = spiralSpot({ ...tiny, occupied: crowd });
  assert.deepEqual(spot, first);
  const inside = spiralSpot({ ...tiny, occupied: [taken(first.x, first.y)] });
  assert.ok(inside.x >= 0 && inside.x <= 140 && inside.y >= 0 && inside.y <= 140);
});
