import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fogAreas, readFog, ringArea, type FogOperation } from '../src/board/fog';

const rect = (id: string, timestamp: number, x: number, y: number, width: number, height: number, isErasing = false): FogOperation =>
  ({ id, type: 'rectangle', timestamp, isErasing, offsetX: 0, offsetY: 0, x, y, width, height });

const totalArea = (areas: ReturnType<typeof fogAreas>): number =>
  areas.reduce((sum, area) => sum + Math.abs(ringArea(area.outer)) - area.holes.reduce((h, hole) => h + Math.abs(ringArea(hole)), 0), 0);

test('fog operations are read from the map, malformed ones left out', () => {
  const ops = readFog({
    a: { id: 'a', kind: 'fog', type: 'rectangle', timestamp: 2, isErasing: false, x: 0, y: 0, width: 10, height: 20 },
    b: { id: 'b', kind: 'fog', type: 'brush', timestamp: 1, isErasing: true, points: [{ x: 1, y: 2 }], brushRadius: 5, offsetX: 3 },
    c: { id: 'c', kind: 'fog', type: 'lasso', timestamp: 3, isErasing: false, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }] },
    d: { id: 'd', kind: 'fog', type: 'brush', timestamp: 4, isErasing: false, points: [], brushRadius: 'x' },
    e: { id: 'e', kind: 'fog', type: 'cloud', timestamp: 5 },
  });
  assert.deepEqual(ops.map((op) => op.id), ['a', 'b', 'c']);
  assert.equal(ops[1]!.offsetX, 3);
  assert.equal(ops[1]!.offsetY, 0);
});

test('a painted rectangle is one area of fog', () => {
  const areas = fogAreas([rect('a', 1, 0, 0, 100, 50)]);
  assert.equal(areas.length, 1);
  assert.equal(areas[0]!.holes.length, 0);
  assert.equal(totalArea(areas), 5000);
});

test('an erase cut out of the middle leaves a hole; operations replay in time order', () => {
  const holed = fogAreas([rect('a', 1, 0, 0, 100, 100), rect('b', 2, 25, 25, 50, 50, true)]);
  assert.equal(holed.length, 1);
  assert.equal(holed[0]!.holes.length, 1);
  assert.equal(totalArea(holed), 10000 - 2500);
  // The erase came first: there was nothing to erase, and the paint covers everything.
  const later = fogAreas([rect('b', 1, 25, 25, 50, 50, true), rect('a', 2, 0, 0, 100, 100)]);
  assert.equal(totalArea(later), 10000);
});

test('overlapping paint merges; separate paint stays separate', () => {
  assert.equal(fogAreas([rect('a', 1, 0, 0, 10, 10), rect('b', 2, 5, 0, 10, 10)]).length, 1);
  assert.equal(totalArea(fogAreas([rect('a', 1, 0, 0, 10, 10), rect('b', 2, 5, 0, 10, 10)])), 150);
  assert.equal(fogAreas([rect('a', 1, 0, 0, 10, 10), rect('b', 2, 50, 0, 10, 10)]).length, 2);
});

test('a brush stroke is its path widened by its radius, round at the ends', () => {
  const areas = fogAreas([{ id: 'a', type: 'brush', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], brushRadius: 10 }]);
  const area = totalArea(areas);
  // A 100 × 20 band plus a disc of radius 10.
  assert.ok(Math.abs(area - (2000 + Math.PI * 100)) < 15, String(area));
});

test('a lasso is its outline filled, moved by its offset', () => {
  const areas = fogAreas([{ id: 'a', type: 'lasso', timestamp: 1, isErasing: false, offsetX: 100, offsetY: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }]);
  assert.equal(totalArea(areas), 100);
  assert.ok(areas[0]!.outer.every((point) => point.x >= 100 && point.x <= 110));
});

test('no fog, or only erasing, is no area', () => {
  assert.deepEqual(fogAreas([]), []);
  assert.deepEqual(fogAreas([rect('a', 1, 0, 0, 10, 10, true)]), []);
});
