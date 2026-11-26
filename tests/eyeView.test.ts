import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { deviceQuaternion, ScreenTurn } from '../src/board/eyeView';

test('the screen turn: the browser is believed where its angle fits the window', () => {
  const turn = new ScreenTurn();
  assert.equal(turn.read(0, true, 80, 0), 0);
  assert.equal(turn.read(90, false, 0, -80), 90);
  assert.equal(turn.read(-90, false, 0, 80), 270);
  assert.equal(turn.read(180, true, -80, 0), 180);
});

test("an iPad's Safari a quarter wrong: the lean says which side is up, once, and looking about never flips it", () => {
  const turn = new ScreenTurn();
  // Landscape, Safari saying 0; lying flat it guesses, held up (top to the left) it finds 90.
  assert.equal(turn.read(0, false, 3, 2), 90);
  assert.equal(turn.read(0, false, 5, -85), 90);
  // Looking about (the lean swinging past level and over) keeps it.
  assert.equal(turn.read(0, false, 40, 60), 90);
  assert.equal(turn.read(0, false, -30, 10), 90);
  // Turned to portrait (Safari saying 90 there): found again, and kept.
  assert.equal(turn.read(90, true, 80, 0), 0);
  assert.equal(turn.read(90, true, -60, 0), 0);
  // The other landscape, top to the right.
  const other = new ScreenTurn();
  assert.equal(other.read(0, false, 5, 85), 270);
  assert.equal(other.read(0, false, 5, -40), 270);
  // No angle at all, held upside down in portrait.
  assert.equal(new ScreenTurn().read(null, true, -85, 0), 180);
});

test('upright in landscape, top to the left, the camera looks out of the back, level, its up the world up', () => {
  const turn = deviceQuaternion(0, 0, -90, new ScreenTurn().read(0, false, 0, -89.9));
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
  assert.ok(Math.abs(forward.y) < 1e-6, `level: ${forward.y}`);
  assert.ok(up.y > 0.99, `upright: ${up.y}`);
});
