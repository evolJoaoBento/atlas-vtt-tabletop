import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { conditionRingRadii, hexCenter, ringDiameter, sideBadgeSlots, snapPoint, tokenDiameter } from '../src/board/geometry';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null, ...over,
});
const near = (actual: { x: number; y: number }, x: number, y: number): void => {
  assert.ok(Math.abs(actual.x - x) < 1e-3 && Math.abs(actual.y - y) < 1e-3, `got (${actual.x}, ${actual.y}), want (${x}, ${y})`);
};

test('token diameter follows Atlas: 62, 186, 310 on a 70px grid', () => {
  assert.equal(tokenDiameter(grid(), 1), 62);
  assert.equal(tokenDiameter(grid(), 2), 186);
  assert.equal(tokenDiameter(grid(), 3), 310);
  assert.equal(ringDiameter(grid(), 1), 70);
});

test('square snapping goes to the cell centre, with offsets', () => {
  near(snapPoint(grid({ size: 26.033, offsetX: 15.82, offsetY: 13.79 }), 100, 100), 106.9355, 104.9055);
});

test('pointy-top hex snapping', () => {
  const hex = grid({ type: 'hex-vertical' });
  near(snapPoint(hex, 36, 42), 35, 70 / Math.sqrt(3));
  near(snapPoint(hex, 141, 100), 140, 70 / Math.sqrt(3) * 2.5);
});

test('flat-top hex snapping', () => {
  near(snapPoint(grid({ type: 'hex-horizontal' }), 100, 71), 70 / Math.sqrt(3) * 2.5, 70);
});

test('no snapping when the map turns it off or has no grid', () => {
  near(snapPoint(grid({ snap: false }), 12.3, 45.6), 12.3, 45.6);
  near(snapPoint(grid({ enabled: false }), 12.3, 45.6), 12.3, 45.6);
});

test('hexCenter is the snapped hex even when snapping is off', () => {
  near(hexCenter(grid({ type: 'hex-vertical', snap: false }), 36, 42), 35, 70 / Math.sqrt(3));
});

test('side badges alternate left and right, two to a row', () => {
  assert.deepEqual(sideBadgeSlots(5), [{ side: -1, row: 0 }, { side: 1, row: 0 }, { side: -1, row: 1 }, { side: 1, row: 1 }, { side: -1, row: 2 }]);
  assert.deepEqual(sideBadgeSlots(0), []);
});

test('condition rings widen one after another', () => {
  assert.deepEqual(conditionRingRadii(10, 3, 2, 1), [12, 15, 18]);
});
