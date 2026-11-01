import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLayerTick, rulerLayout, spreadMarkers } from '../src/board/layerRuler';

test('the rail runs from the lowest scene to the highest, with a dash every step in between', () => {
  const layout = rulerLayout([{ elevation: 2 }, { elevation: 0 }, { elevation: -2 }], 2);
  assert.equal(layout.min, -2);
  assert.equal(layout.max, 2);
  assert.deepEqual(layout.at, [1, 0.5, 0]);
  assert.deepEqual(layout.ticks.map((tick) => tick.height), [-2, 0, 2]);
});

test('the dashes follow the step, starting at the first multiple of it above the bottom', () => {
  const layout = rulerLayout([{ elevation: 0 }, { elevation: 7 }], 2);
  assert.deepEqual(layout.ticks.map((tick) => tick.height), [0, 2, 4, 6]);
  assert.ok(layout.ticks.every((tick) => tick.at >= 0 && tick.at <= 1));
  assert.deepEqual(rulerLayout([{ elevation: 0 }, { elevation: 3 }], 1).ticks.map((tick) => tick.height), [0, 1, 2, 3]);
});

test('a very tall stack widens the step instead of drawing hundreds of dashes', () => {
  const layout = rulerLayout([{ elevation: 0 }, { elevation: 400 }], 0.5);
  assert.ok(layout.ticks.length <= 61);
});

test('two scenes at one height still make a rail', () => {
  const layout = rulerLayout([{ elevation: 1 }, { elevation: 1 }], 2);
  assert.deepEqual(layout.at, [0, 0]);
});

test('markers too close are spread up the rail, and slide back down together at the top', () => {
  assert.deepEqual(spreadMarkers([0, 0.5, 1], 200, 30), [0, 100, 200]);
  const crowded = spreadMarkers([0, 0.05, 0.1], 200, 30);
  assert.ok(crowded[1]! - crowded[0]! >= 30 && crowded[2]! - crowded[1]! >= 30);
  const top = spreadMarkers([0.95, 1, 1], 200, 30);
  assert.ok(Math.max(...top) <= 200 && Math.min(...top) >= 0);
  assert.ok(top[1]! - top[0]! >= 30 - 1e-9 && top[2]! - top[1]! >= 30 - 1e-9);
});

test('the ruler step is read back within its range, to a half square', () => {
  assert.equal(readLayerTick(undefined), 2);
  assert.equal(readLayerTick(0.1), 0.5);
  assert.equal(readLayerTick(99), 10);
  assert.equal(readLayerTick(3.3), 3.5);
});
