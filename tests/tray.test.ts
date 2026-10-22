import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dieEdgePx, trayOnMap } from '../src/dice/tray';

test('the tray is the whole map: its edges are the walls, wherever the camera looks', () => {
  const tray = trayOnMap({ width: 1400, height: 980 }, { x: 100, z: 900 }, 70, 42);
  assert.deepEqual(tray, { center: { x: 700, z: 490 }, halfWidth: 700, halfDepth: 490, yaw: 0 });
  // Zoomed in or out, turned or not: the map decides, not the view.
  assert.deepEqual(trayOnMap({ width: 1400, height: 980 }, { x: 5000, z: -300 }, 70, 42), tray);
});

test('with no map a die fits on, a room of 20 squares each way round where the camera looks', () => {
  assert.deepEqual(trayOnMap({ width: 0, height: 0 }, { x: 300, z: 200 }, 70, 42), { center: { x: 300, z: 200 }, halfWidth: 1400, halfDepth: 1400, yaw: 0 });
  assert.deepEqual(trayOnMap({ width: 50, height: 900 }, { x: 0, z: 0 }, 70, 42).halfWidth, 1400);
});

test('a die is a share of a grid square', () => {
  assert.equal(dieEdgePx(70), 42);
  assert.equal(dieEdgePx(100, 0.5), 50);
});
