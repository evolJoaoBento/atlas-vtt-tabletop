import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { decayOf, HALO_FLAG, LightRig } from '../src/board/lightRig';

test('a lamp carries its bright share in decay, flagged for the halo only when it is on', () => {
  assert.equal(decayOf(0.5, false), 0.5);
  assert.equal(decayOf(0.5, true), 0.5 + HALO_FLAG);
  // The falloff tells a flagged share from a plain one at half the flag: every share is at most 1.
  assert.ok(decayOf(1, false) < HALO_FLAG / 2 && decayOf(0, true) >= HALO_FLAG / 2);
});

test('the falloff that replaced three.js\'s adds the halo for a flagged lamp', () => {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  assert.match(chunk, /bool flagged = decayExponent >= 5\.0;/);
  assert.match(chunk, /float halo = flagged \? 0\.80 \* exp/);
});

test('turning the halo on flags the lamps already up, and new ones; off unflags them', () => {
  const rig = new LightRig();
  const light = { id: 'a', x: 10, y: 10, bright: 10, dim: 20, color: '#ffaa55', intensity: 1, angle: null, rotation: 0, darkness: false, hidden: false, tokenId: null, animation: 'none', activeBelowAmbient: null } as unknown as Parameters<LightRig['update']>[0][number];
  const layout = { unitDistance: 5, cell: 50, heightOf: () => 50, ambient: 0, litThreshold: 0.5 };
  rig.update([light], layout);
  const lamp = (): THREE.PointLight => rig.object3d.children.find((c) => c instanceof THREE.PointLight) as THREE.PointLight;
  assert.equal(lamp().decay, 0.5);
  rig.setHalo(true);
  assert.equal(lamp().decay, 0.5 + HALO_FLAG);
  rig.update([{ ...light, id: 'b' }], layout);
  assert.equal(lamp().decay, 0.5 + HALO_FLAG);
  rig.setHalo(false);
  assert.equal(lamp().decay, 0.5);
});
