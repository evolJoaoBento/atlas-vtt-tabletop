import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrbitCamera } from '../src/board/camera';
import { throwVector } from '../src/dice/throwInput';

const close = (actual: number, expected: number): void => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≉ ${expected}`);

/** The way the camera's forward goes on the ground at `yaw`, as panning the board moves it. */
function forwardOf(yaw: number): { x: number; z: number } {
  const camera = new OrbitCamera({ yaw });
  camera.pan(0, 1);
  return { x: camera.goal.target.x, z: camera.goal.target.z };
}

test('a flick up the screen throws along the camera\'s forward, away from the viewer', () => {
  const thrown = throwVector({ dx: 0, dy: -200, ms: 100 }, 0);
  const forward = forwardOf(0);
  close(thrown.x, 0);
  assert.ok(thrown.z < 0, `away from the viewer: ${thrown.z}`);
  close(thrown.x, forward.x);
  close(thrown.z, forward.z);
  close(thrown.speed, 2);
});

test('the throw turns with the camera; right on the screen is the camera\'s right', () => {
  const up = throwVector({ dx: 0, dy: -200, ms: 100 }, Math.PI / 2);
  const forward = forwardOf(Math.PI / 2);
  close(up.x, forward.x);
  close(up.z, forward.z);
  close(up.x, -1);
  const camera = new OrbitCamera({ yaw: 0.7 });
  camera.pan(1, 0);
  const right = throwVector({ dx: 50, dy: 0, ms: 100 }, 0.7);
  close(right.x, camera.goal.target.x);
  close(right.z, camera.goal.target.z);
});

test('a click without movement is a gentle toss straight ahead; a fling has a limit', () => {
  const still = throwVector({ dx: 0, dy: 0, ms: 0 }, 0.4);
  const forward = forwardOf(0.4);
  close(still.speed, 0.2);
  close(still.x, forward.x);
  close(still.z, forward.z);
  close(throwVector({ dx: 0, dy: -5000, ms: 100 }, 0).speed, 3);
  close(throwVector({ dx: 0, dy: -10, ms: 100 }, 0).speed, 0.2);
  close(throwVector({ dx: 0, dy: -30, ms: 1 }, 0).speed, 30 / 16);
});
