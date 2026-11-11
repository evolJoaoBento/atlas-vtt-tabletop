import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { SpellEffect, volumeOf } from '../src/board/spellEffects';
import { DAMAGE_TYPES, type Spell } from '../src/board/spells';

const base: Spell = { shape: 'sphere', from: 'point', at: { x: 100, y: 100, h: 10 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1, effect: 'fire' };
const shapes: Spell[] = [
  base,
  { ...base, shape: 'cube' },
  { ...base, shape: 'cylinder', from: 'self', size: 35, length: 420 },
  { ...base, shape: 'cone', from: 'self', size: 280 },
  { ...base, shape: 'wall', to: { x: 380, y: 100 }, size: 35, length: 140 },
];
const mask = () => ({ mask: { value: null }, maskBox: { value: new THREE.Vector4(0, 0, 1, 1) }, useMask: { value: 0 } });

test('every damage type builds for every shape, moves on, and is freed', () => {
  for (const spell of shapes) {
    for (const type of DAMAGE_TYPES) {
      const effect = new SpellEffect(type, { ...spell, effect: type }, 70, new THREE.Quaternion(), mask());
      assert.ok(effect.object3d.children.length > 0, `${type} on a ${spell.shape} draws something`);
      effect.tick(1.3, 800);
      effect.tick(2.7, 800);
      effect.dispose();
    }
  }
});

test("points of a shape's volume lie inside it", () => {
  let state = 1;
  const random = (): number => { state = (state * 16807) % 2147483647; return state / 2147483647; };
  const sphere = volumeOf(base);
  for (let i = 0; i < 200; i++) assert.ok(sphere.sample(random).length() <= 140 + 1e-6);
  const cone = volumeOf(shapes[3]!);
  for (let i = 0; i < 200; i++) {
    const point = cone.sample(random);
    assert.ok(point.z <= 1e-6 && point.z >= -280 - 1e-6, 'along the cone, ahead of its tip');
    assert.ok(Math.hypot(point.x, point.y) <= (-point.z / 280) * 280 * Math.tan(0.5) + 1e-6, 'within its widening');
  }
});
