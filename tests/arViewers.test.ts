import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

// The name plate draws on a canvas: a stand-in that takes every call.
const context = new Proxy({}, { get: (_, key) => (key === 'measureText' ? () => ({ width: 40 }) : () => undefined), set: () => true });
(globalThis as { createEl?: unknown }).createEl ??= () => ({ width: 0, height: 0, style: {}, getContext: () => context });

const { ArViewers, isViewerPose, lidOpenness } = await import('../src/board/arViewers');

const pose = (x: number, y: number, z: number): { position: [number, number, number]; quaternion: [number, number, number, number] } =>
  ({ position: [x, y, z], quaternion: [0, 0, 0, 1] });

test('a pose needs three finite numbers and a unit quaternion', () => {
  assert.ok(isViewerPose(pose(1, 2, 3)));
  assert.ok(!isViewerPose({ position: [1, 2], quaternion: [0, 0, 0, 1] }));
  assert.ok(!isViewerPose({ position: [1, 2, Number.NaN], quaternion: [0, 0, 0, 1] }));
  assert.ok(!isViewerPose({ position: [1, 2, 3], quaternion: [0, 0, 0, 0] }));
  assert.ok(!isViewerPose({ position: [1, 2, 3], quaternion: [0, 0, 0, 2] }));
  assert.ok(!isViewerPose(null));
});

test('a blink shuts the lids half way through and opens them again', () => {
  assert.equal(lidOpenness(0), 1);
  assert.equal(lidOpenness(0.15), 0);
  assert.ok(lidOpenness(0.07) > 0 && lidOpenness(0.07) < 1);
  assert.equal(lidOpenness(0.31), 1);
  assert.equal(lidOpenness(-1), 1);
});

test('an eye fades in where the phone is, eases after it, and fades out when the player leaves AR', () => {
  const viewers = new ArViewers();
  viewers.set('p1', 'Ana', '#ff0059', pose(100, 400, 200), 30, 0);
  assert.equal(viewers.count, 1);
  viewers.step(0.05, 0.05, 0.01);
  const eye = viewers.object3d.children.find((child) => child.name === 'ar-viewer:p1')!;
  assert.deepEqual(eye.position.toArray(), [100, 400, 200]);
  viewers.set('p1', 'Ana', '#ff0059', pose(200, 400, 200), 30, 0.1);
  viewers.step(0.15, 0.05, 0.01);
  assert.ok(eye.position.x > 100 && eye.position.x < 200, 'eased part of the way');
  for (let t = 0.2; t < 2; t += 0.05) viewers.step(t, 0.05, 0.01);
  assert.ok(Math.abs(eye.position.x - 200) < 0.5, 'caught up');
  viewers.set('p1', 'Ana', '#ff0059', null, 30, 2);
  for (let t = 2; t < 3; t += 0.05) viewers.step(t, 0.05, 0.01);
  assert.equal(viewers.count, 0);
  assert.equal(viewers.object3d.children.length, 0);
});

test('an eye looks the way the phone looks', () => {
  const viewers = new ArViewers();
  const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  viewers.set('p1', 'Ana', '#ff0059', { position: [0, 500, 0], quaternion: [down.x, down.y, down.z, down.w] }, 30, 0);
  viewers.step(0.05, 0.05, 0.01);
  const eye = viewers.object3d.children.find((child) => child.name === 'ar-viewer:p1')!;
  const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(eye.quaternion);
  assert.ok(ahead.y < -0.99, 'looks down at the map');
});

test('a player who goes quiet fades out', () => {
  const viewers = new ArViewers();
  viewers.set('p1', 'Ana', '#ff0059', pose(0, 0, 0), 30, 0);
  for (let t = 0; t < 6; t += 0.1) viewers.step(t, 0.1, 0.01);
  assert.equal(viewers.count, 0);
});
