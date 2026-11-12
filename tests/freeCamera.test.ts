import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drivenView } from '../src/cutscene/drivenView';
import { FreeCamera } from '../src/cutscene/freeCamera';
import { positionOf } from '../src/board/camera';

const near = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('look clamps the pitch just short of straight up', () => {
  const cam = new FreeCamera({ x: 0, y: 5, z: 0 }, { x: 0, y: 5, z: -10 });
  cam.look(0, 10);
  const { eye, target } = cam.pose();
  assert.ok(target.y > eye.y);
  near(Math.asin((target.y - eye.y) / 10), Math.PI / 2 - 0.01);
  cam.look(0, -20);
  near(Math.asin((cam.pose().target.y - eye.y) / 10), -(Math.PI / 2 - 0.01));
});

test('a number that is not finite changes nothing', () => {
  const cam = new FreeCamera({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: -7 });
  const before = JSON.stringify(cam.pose());
  cam.look(NaN, 0);
  cam.look(0, Infinity);
  cam.fly(NaN, 0, 0);
  cam.fly(0, 0, -Infinity);
  cam.dolly(NaN);
  assert.equal(JSON.stringify(cam.pose()), before);
});

test('fly moves the eye along the view, and the target with it', () => {
  const cam = new FreeCamera({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
  const before = cam.pose();
  cam.fly(0, 0, 10);
  const after = cam.pose();
  near(Math.hypot(after.eye.x - before.eye.x, after.eye.y - before.eye.y, after.eye.z - before.eye.z), 10);
  // Along the view: the direction from the old eye to the new one is the direction it looked.
  near((after.eye.x - before.eye.x) / 10, 0.6);
  near((after.eye.y - before.eye.y) / 10, 0.8);
  near(after.target.x - before.target.x, after.eye.x - before.eye.x);
  near(after.target.y - before.target.y, after.eye.y - before.eye.y);
});

test('fly: right is across the view and up is world y', () => {
  const cam = new FreeCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: -4 });
  cam.fly(2, 7, 0);
  const { eye } = cam.pose();
  near(eye.x, 2);
  near(eye.y, 7);
  near(eye.z, 0);
});

test('look turns to the right with a positive dx, and never rolls', () => {
  const cam = new FreeCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -5 });
  cam.look(Math.PI / 2, 0);
  const { target } = cam.pose();
  near(target.x, 5);
  near(target.z, 0, 1e-9);
});

test('pose keeps the reach it was made with, through look, fly and dolly', () => {
  const cam = new FreeCamera({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: -17 });
  cam.look(0.7, -0.3);
  cam.fly(5, 1, -2);
  cam.dolly(1.1);
  const { eye, target } = cam.pose();
  near(Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z), 20, 1e-9);
});

test('dolly moves along the view by reach * (factor - 1)', () => {
  const cam = new FreeCamera({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -100 });
  cam.dolly(1.1);
  near(cam.pose().eye.z, -10, 1e-9);
  cam.dolly(0.5);
  near(cam.pose().eye.z, 40, 1e-9);
});

test('an eye on its target still gives a camera', () => {
  const cam = new FreeCamera({ x: 4, y: 4, z: 4 }, { x: 4, y: 4, z: 4 });
  const { eye, target } = cam.pose();
  assert.ok(Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z));
  assert.notDeepEqual(eye, target);
});

test('drivenView reproduces the pose through the orbit camera\'s own maths', () => {
  const eye = { x: 500, y: 900, z: 1400 };
  const target = { x: 500, y: 0, z: 500 };
  const view = drivenView(eye, target, { yaw: 0, pitch: 0 })!;
  const back = positionOf({ target: view.target, yaw: view.yaw, pitch: view.pitch, distance: view.distance });
  near(back.x, eye.x, 1e-6);
  near(back.y, eye.y, 1e-6);
  near(back.z, eye.z, 1e-6);
});

test('drivenView keeps the last look when the eye coincides with its target, and is never NaN', () => {
  const first = drivenView({ x: 0, y: 10, z: 10 }, { x: 0, y: 0, z: 0 }, { yaw: 0, pitch: 0 })!;
  const same = drivenView({ x: 5, y: 5, z: 5 }, { x: 5, y: 5, z: 5 }, first)!;
  assert.equal(same.yaw, first.yaw);
  assert.equal(same.pitch, first.pitch);
  for (const value of [same.distance, same.target.x, same.target.y, same.target.z, same.aim.x, same.aim.y, same.aim.z]) assert.ok(Number.isFinite(value));
  // It still looks the way it did: the aim is ahead of the eye along the old direction.
  const before = { x: 0 - 0, y: 0 - 10, z: 0 - 10 };
  const ahead = { x: same.aim.x - 5, y: same.aim.y - 5, z: same.aim.z - 5 };
  const dot = (before.x * ahead.x + before.y * ahead.y + before.z * ahead.z) / (Math.hypot(before.x, before.y, before.z) * Math.hypot(ahead.x, ahead.y, ahead.z));
  near(dot, 1, 1e-9);
  assert.equal(drivenView({ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, first), null);
});
