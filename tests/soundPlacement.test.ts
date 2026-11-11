import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nearness, placeAt, type Listener } from '../src/sound/placement';

// The camera is above the table at the south edge, looking north (toward -z), so the screen's right is +x.
const listener: Listener = { eye: { x: 0, y: 100, z: 200 }, target: { x: 0, y: 0, z: 0 } };

test('placeAt is full and centred at the eye, and falls to 0.15 far away', () => {
  const here = placeAt(listener, listener.eye, 100);
  assert.equal(here.gain, 1);
  assert.equal(here.pan, 0);
  const far = placeAt(listener, { x: listener.eye.x + 500, y: listener.eye.y, z: listener.eye.z }, 100);
  assert.equal(far.gain, 0.15);
});

test('placeAt falls off linearly between a quarter span and two spans', () => {
  const halfway = 0.25 * 100 + (2 * 100 - 0.25 * 100) / 2;
  const { gain } = placeAt(listener, { x: halfway, y: 100, z: 200 }, 100);
  assert.ok(Math.abs(gain - (1 + 0.15) / 2) < 1e-9);
  assert.equal(placeAt(listener, { x: 25, y: 100, z: 200 }, 100).gain, 1);
});

test('placeAt pans right for points right of the eye-to-target line and left for the others', () => {
  const right = placeAt(listener, { x: 80, y: 0, z: 0 }, 100);
  const left = placeAt(listener, { x: -80, y: 0, z: 0 }, 100);
  assert.ok(right.pan > 0);
  assert.ok(left.pan < 0);
  assert.ok(Math.abs(right.pan) <= 0.6 && Math.abs(left.pan) <= 0.6);
  assert.equal(placeAt(listener, { x: 5000, y: 100, z: 200 }, 100).pan, 0.6);
  assert.equal(placeAt(listener, { x: -5000, y: 100, z: 200 }, 100).pan, -0.6);
});

test('placeAt still tells left from right when the camera looks straight down', () => {
  const down: Listener = { eye: { x: 0, y: 300, z: 0 }, target: { x: 0, y: 0, z: 0 } };
  assert.ok(placeAt(down, { x: 50, y: 0, z: 0 }, 100).pan > 0);
  assert.ok(placeAt(down, { x: -50, y: 0, z: 0 }, 100).pan < 0);
});

test('nearness is 1 at 0, 0 at the reach and a smoothstep between', () => {
  assert.equal(nearness(0, 10), 1);
  assert.equal(nearness(10, 10), 0);
  assert.equal(nearness(25, 10), 0);
  assert.equal(nearness(5, 10), 0.5);
  assert.ok(nearness(2, 10) > nearness(6, 10));
});
