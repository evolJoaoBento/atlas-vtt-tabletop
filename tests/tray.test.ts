import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dieEdgePx, START_SHARE, trayAt } from '../src/dice/tray';

const VIEW_SHARE = 0.8;

test('tray centred on the target', () => {
  const tray = trayAt({ x: 100, z: 50 }, { x: 400, z: 300 }, 50, 0, 30);
  assert.deepEqual(tray.center, { x: 100, z: 50 });
  assert.equal(tray.halfWidth, 320);
  assert.equal(tray.halfDepth, 240);
  assert.equal(tray.yaw, 0);
});

test('tray at an off-map target', () => {
  const tray = trayAt({ x: -9000, z: 9000 }, { x: 5000, z: 5000 }, 50, 1.2, 30);
  assert.deepEqual(tray.center, { x: -9000, z: 9000 });
  assert.equal(tray.halfWidth, 1000, 'clamped to 20 squares');
  assert.equal(tray.halfDepth, 1000);
  assert.equal(tray.yaw, 1.2);
});

test('a view of a few squares: the tray is most of it, with no floor of 3 squares', () => {
  const tray = trayAt({ x: 0, z: 0 }, { x: 200, z: 170 }, 50, 0, 30);
  assert.equal(tray.halfWidth, 160);
  assert.equal(tray.halfDepth, 136, 'inside the 170 shown, though under 3 squares');
});

test('a view under 3 squares is most of the tray, down to one die', () => {
  const tray = trayAt({ x: 0, z: 0 }, { x: 60, z: 20 }, 50, 0, 30);
  assert.equal(tray.halfWidth, 48, 'inside the view');
  assert.equal(tray.halfDepth, 30, 'never under one die');
});

// The review's case: a 20-square map at the closest zoom (0.13 of its span), FOV 35, 16:9, the lowest pitch (0.22).
test('at the closest zoom the tray stays inside the view and the throw starts on screen', () => {
  const grid = 70;
  const distance = 20 * grid * 0.13;
  const halfFov = (35 / 2) * Math.PI / 180;
  const visible = { x: distance * Math.tan(halfFov) * 16 / 9, z: distance * Math.tan(halfFov) };
  const tray = trayAt({ x: 0, z: 0 }, visible, grid, 0, dieEdgePx(grid));
  assert.ok(tray.halfWidth <= VIEW_SHARE * visible.x + 1e-9, `width ${tray.halfWidth} inside the ${visible.x} shown, with a margin`);
  assert.ok(tray.halfDepth <= VIEW_SHARE * visible.z + 1e-9, `depth ${tray.halfDepth} inside the ${visible.z} shown, with a margin`);
  assert.ok(tray.halfWidth >= dieEdgePx(grid) && tray.halfDepth >= dieEdgePx(grid), 'a die still fits');
  // The nearest ground the camera shows, toward it from the target, at the lowest pitch.
  const pitch = 0.22;
  const nearestGround = distance * Math.cos(pitch) - (distance * Math.sin(pitch)) / Math.tan(pitch + halfFov);
  assert.ok(nearestGround > 1.5 * grid && nearestGround < 1.6 * grid, `the review's 1.56 squares: ${nearestGround / grid}`);
  assert.ok(tray.halfDepth * START_SHARE < nearestGround, `throw starts ${tray.halfDepth * START_SHARE}, on screen to ${nearestGround}`);
  const cameraBack = distance * Math.cos(pitch);
  assert.ok(tray.halfDepth < cameraBack, 'the near wall stands in front of the camera');
});

test('a die is a share of a grid square on the board', () => {
  assert.equal(dieEdgePx(70, 0.6), 42);
  assert.equal(dieEdgePx(70), 42, 'six tenths of a square by default');
});
