import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dieEdgePx, trayAt } from '../src/dice/tray';

test('tray centred on the target', () => {
  const tray = trayAt({ x: 100, z: 50 }, { x: 400, z: 300 }, 50, 0);
  assert.deepEqual(tray.center, { x: 100, z: 50 });
  assert.equal(tray.halfWidth, 320);
  assert.equal(tray.halfDepth, 240);
  assert.equal(tray.yaw, 0);
});

test('tray at an off-map target', () => {
  const tray = trayAt({ x: -9000, z: 9000 }, { x: 5000, z: 5000 }, 50, 1.2);
  assert.deepEqual(tray.center, { x: -9000, z: 9000 });
  assert.equal(tray.halfWidth, 1000, 'clamped to 20 squares');
  assert.equal(tray.halfDepth, 1000);
  assert.equal(tray.yaw, 1.2);
});

test('small view clamps to 3 squares', () => {
  const tray = trayAt({ x: 0, z: 0 }, { x: 60, z: 20 }, 50, 0);
  assert.equal(tray.halfWidth, 150);
  assert.equal(tray.halfDepth, 150);
});

test('a die is a share of a grid square on the board', () => {
  assert.equal(dieEdgePx(70, 0.6), 42);
  assert.equal(dieEdgePx(70), 42, 'six tenths of a square by default');
});
