import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OrbitCamera, limitsFor, pitchFloor, positionOf } from '../src/board/camera';

const limits = limitsFor(1000, 800);
const close = (actual: number, expected: number, digits = 6): void => assert.ok(Math.abs(actual - expected) < 10 ** -digits, `${actual} ≉ ${expected}`);

test('limitsFor loosens TacticalEngine\'s angles a little and scales the distances with the map', () => {
  assert.equal(limits.minPitch, 0.22);
  assert.equal(limits.maxPitch, 1.5);
  assert.equal(limits.farPitch, 1.12);
  close(limits.minDistance, 130);
  close(limits.maxDistance, 3000);
});

test('snap jumps the drawn pose to the goal: a drag moves the camera at once', () => {
  const cam = new OrbitCamera({ distance: 500 }, limits);
  cam.orbit(0.5, 0.1);
  cam.pan(30, 0);
  cam.snap();
  assert.deepEqual(cam.pose, cam.goal);
  assert.equal(cam.update(1 / 60), false);
});

test('the pitch floor rises as the camera pulls back', () => {
  close(pitchFloor(limits.minDistance, limits), limits.minPitch);
  close(pitchFloor(limits.maxDistance, limits), limits.farPitch);
  assert.ok(pitchFloor(800, limits) > pitchFloor(400, limits));
  const cam = new OrbitCamera({ distance: limits.maxDistance, pitch: 0.5 }, limits);
  assert.ok(cam.goal.pitch >= limits.farPitch - 1e-9);
});

test('a low angle asked for far out comes back when zooming in', () => {
  const cam = new OrbitCamera({ distance: limits.minDistance, pitch: 0.5 }, limits);
  cam.zoom(1000);
  close(cam.goal.pitch, limits.farPitch);
  cam.zoom(0.0001);
  close(cam.goal.pitch, 0.5);
});

test('pan is screen-relative: turned a quarter, right is along -z', () => {
  const cam = new OrbitCamera({ yaw: Math.PI / 2, distance: 500 }, limits);
  cam.pan(1, 0);
  close(cam.goal.target.x, 0);
  close(cam.goal.target.z, -1);
});

test('orbit turns around the target at the same height', () => {
  const cam = new OrbitCamera({ distance: 500, pitch: 0.8 }, limits);
  const before = positionOf(cam.goal);
  cam.orbit(Math.PI / 2, 0);
  const after = positionOf(cam.goal);
  close(after.y, before.y);
  close(Math.hypot(after.x, after.z), Math.hypot(before.x, before.z));
});

test('update eases, settles exactly, then reports no movement', () => {
  const cam = new OrbitCamera({ distance: 500 }, limits);
  cam.pan(100, 0);
  assert.equal(cam.update(1 / 60), true);
  for (let i = 0; i < 600; i++) cam.update(1 / 60);
  assert.equal(cam.pose.target.x, cam.goal.target.x);
  assert.equal(cam.update(1 / 60), false);
});

test('frame looks at a point from a distance fitting its radius', () => {
  const cam = new OrbitCamera({}, limits);
  cam.frame({ x: 500, y: 0, z: 400 }, 600);
  assert.deepEqual(cam.goal.target, { x: 500, y: 0, z: 400 });
  close(cam.goal.distance, 1080);
});

test('a camera set to look from an eye at a target stands there (the GM view a player glides to)', () => {
  const camera = new OrbitCamera({}, limitsFor(2000, 2000));
  camera.view({ x: 300, y: 400, z: 900 }, { x: 300, y: 0, z: 500 });
  const eye = positionOf(camera.goal);
  assert.ok(Math.abs(eye.x - 300) < 1e-6 && Math.abs(eye.y - 400) < 1e-6 && Math.abs(eye.z - 900) < 1e-6, JSON.stringify(eye));
  assert.deepEqual(camera.goal.target, { x: 300, y: 0, z: 500 });
});
