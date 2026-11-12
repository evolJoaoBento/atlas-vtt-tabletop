import assert from 'node:assert/strict';
import { test } from 'node:test';
import { growScale, SpellView } from '../src/board/spellView';
import type { Spell } from '../src/board/spells';

const fire: Spell = { shape: 'sphere', from: 'point', at: { x: 100, y: 100, h: 10 }, yaw: 0, pitch: 0, roll: 0, size: 50, length: 0, angle: 1, effect: 'fire' };

test('a sphere grows from nothing to whole', () => {
  const none = growScale('sphere', 0);
  assert.deepEqual([none.x, none.y, none.z], [0, 0, 0]);
  const whole = growScale('sphere', 1);
  assert.deepEqual([whole.x, whole.y, whole.z, whole.lift], [1, 1, 1, 0]);
});

test('a wall and a cylinder grow along their axis with the base kept still', () => {
  for (const shape of ['wall', 'cylinder'] as const) {
    const half = growScale(shape, 0.5);
    assert.ok(half.y > 0 && half.y < 1);
    assert.equal(half.x, 1);
    assert.equal(half.z, 1);
    // The base is at lift - y (in half extents): it stays at -1.
    assert.ok(Math.abs(half.lift - half.y + 1) < 1e-9);
    assert.equal(growScale(shape, 1).lift, 0);
  }
});

test('a cone scales only along its axis', () => {
  const half = growScale('cone', 0.5);
  assert.ok(half.y > 0 && half.y < 1);
  assert.equal(half.x, 1);
  assert.equal(half.z, 1);
});

test('a plain view does not move by itself, a damage view does', () => {
  assert.equal(new SpellView(fire, '#fff', [], 0.45, 50, { plain: true }).animated, false);
  assert.equal(new SpellView(fire, '#fff', [], 0.45, 50).animated, true);
});

test('anchors by shape', () => {
  assert.equal(new SpellView(fire, '#fff', [], 0.45, 50, { plain: true }).anchorOf, 'centre');
  assert.equal(new SpellView({ ...fire, shape: 'cone' }, '#fff', [], 0.45, 50, { plain: true }).anchorOf, 'tip');
  assert.equal(new SpellView({ ...fire, shape: 'cylinder', length: 100 }, '#fff', [], 0.45, 50, { plain: true }).anchorOf, 'base');
});
