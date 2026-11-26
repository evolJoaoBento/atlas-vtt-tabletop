import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { deviceQuaternion, screenTurn } from '../src/board/eyeView';

test('the screen turn: the browser is believed where its angle fits the window', () => {
  assert.equal(screenTurn(0, true, 80, 0, null), 0);
  assert.equal(screenTurn(90, false, 0, -80, null), 90);
  assert.equal(screenTurn(-90, false, 0, 80, null), 270);
  assert.equal(screenTurn(180, true, -80, 0, null), 180);
});

test("an iPad's Safari saying 0 in landscape: the lean says which side is up", () => {
  // Held upright in landscape, top to the left (right side up): 90; top to the right: 270.
  assert.equal(screenTurn(0, false, 5, -85, null), 90);
  assert.equal(screenTurn(0, false, 5, 85, null), 270);
  // No angle at all (no screen.orientation, no window.orientation), upright in portrait: 0; upside down: 180.
  assert.equal(screenTurn(null, true, 85, 0, null), 0);
  assert.equal(screenTurn(null, true, -85, 0, null), 180);
  // Lying flat it cannot tell: the last turn found stays.
  assert.equal(screenTurn(0, false, 3, 2, 270), 270);
});

test('upright in landscape, top to the left, the camera looks out of the back, level, its up the world up', () => {
  // The phone on its side, right side up (gamma -90 from portrait), screen at 90.
  const turn = deviceQuaternion(0, 0, -90, screenTurn(0, false, 0, -89.9, null));
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
  assert.ok(Math.abs(forward.y) < 1e-6, `level: ${forward.y}`);
  assert.ok(up.y > 0.99, `upright: ${up.y}`);
});
