import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  flicker, leafHeading, readLights, readSceneLighting, readWalls, segmentFrame, seedOf, stepOpenness, swingSide, unitsToPx,
} from '../src/board/walls';

test('walls and doors are read as Atlas stores them; a segment of no length is left out', () => {
  const walls = readWalls({
    a: { id: 'a', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, chainId: 'c1' },
    b: { id: 'b', kind: 'wall', type: 'secret-door', p1: { x: 0, y: 0 }, p2: { x: 0, y: 70 }, direction: 'left', closed: false, locked: true, limited: true, blocks: 'light' },
    c: { id: 'c', kind: 'wall', type: 'door', p1: { x: 5, y: 5 }, p2: { x: 5, y: 5 } },
    d: { id: 'd', type: 'weird', p1: { x: 0, y: 0 } },
  });
  assert.deepEqual(walls, [
    { id: 'a', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: 'c1' },
    { id: 'b', type: 'secret-door', p1: { x: 0, y: 0 }, p2: { x: 0, y: 70 }, direction: 'left', closed: false, locked: true, blocks: 'light', limited: true, chain: null },
  ]);
});

test('lights placed on the map and carried by tokens are read; bright never passes dim', () => {
  const lights = readLights(
    { l: { id: 'l', kind: 'light', x: 10, y: 20, hidden: true, rotation: 90, activeBelowAmbient: 0.4, emission: { bright: 50, dim: 40, color: '#ff9a3c', intensity: 1, animation: 'torch', angle: 60 } } },
    { t: { id: 't', x: 1, y: 2, light: { bright: 20, dim: 40, color: '#fff', intensity: 0.5, animation: 'candle' } }, u: { id: 'u', x: 0, y: 0 } },
  );
  assert.deepEqual(lights.map((light) => [light.id, light.bright, light.dim, light.angle, light.rotation, light.hidden, light.activeBelowAmbient, light.tokenId, light.animation]), [
    ['l', 40, 40, 60, 90, true, 0.4, null, 'torch'],
    ['t', 20, 40, null, 0, false, null, 't', 'candle'],
  ]);
});

test('the scene\'s light defaults as Atlas defaults it', () => {
  assert.deepEqual(readSceneLighting(undefined), { enabled: false, ambient: 0.1, ambientColor: null });
  assert.deepEqual(readSceneLighting({ enabled: true, ambient: 0.05, ambientColor: '#1e293b' }), { enabled: true, ambient: 0.05, ambientColor: '#1e293b' });
});

test('a segment\'s frame; a door swings a quarter turn to its side, a one-way door away from the side that sees', () => {
  const frame = segmentFrame({ x: 0, y: 0 }, { x: 70, y: 0 });
  assert.deepEqual(frame, { cx: 35, cy: 0, length: 70, heading: 0 });
  const door = { p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, direction: null };
  assert.equal(swingSide(door), 1);
  // Drawn eastward, it opens toward the north of the map (its left as drawn, y up on screen).
  assert.ok(Math.abs(leafHeading(door, 1) + Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(leafHeading({ ...door, direction: 'left' }, 1) - Math.PI / 2) < 1e-9);
  assert.equal(leafHeading(door, 0), 0);
  assert.equal(stepOpenness(0, 1, 0.25), 0.5);
  assert.equal(stepOpenness(0.9, 1, 0.25), 1);
  assert.equal(stepOpenness(0.2, 0, 0.25), 0);
});

test('a light\'s reach in map pixels, and flames that flicker within bounds, each its own way', () => {
  assert.equal(unitsToPx(40, 5, 70), 560);
  assert.equal(unitsToPx(40, 0, 70), 0);
  for (const animation of ['torch', 'candle', 'pulse', 'magic'] as const) {
    for (let t = 0; t < 5; t += 0.07) {
      const value = flicker(animation, t, 1.3);
      assert.ok(value > 0.4 && value <= 1.11, `${animation} ${value}`);
    }
  }
  assert.equal(flicker('none', 3, 1), 1);
  assert.notEqual(seedOf('light_a'), seedOf('light_b'));
});
