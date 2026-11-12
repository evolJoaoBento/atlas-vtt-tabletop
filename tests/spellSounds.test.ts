import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castsToAnnounce, spellImpactSound, spellLoopGains } from '../src/sound/spellSounds';

const listener = { eye: { x: 0, y: 100, z: 0 }, target: { x: 0, y: 0, z: 0 } };
const reach = 300;

test('nothing is announced on the first load', () => {
  assert.deepEqual(castsToAnnounce(new Set(), true, ['a', 'b']), []);
});

test('a new id is announced, a seen one never again', () => {
  assert.deepEqual(castsToAnnounce(new Set(['a']), false, ['a', 'b']), ['b']);
  assert.deepEqual(castsToAnnounce(new Set(['a', 'b']), false, ['a', 'b']), []);
});

test('impact sounds follow the damage type, plain without one', () => {
  assert.equal(spellImpactSound('fire'), 'spell.impact.fire');
  assert.equal(spellImpactSound(null), 'spell.impact.plain');
});

test('two fire walls give one fire entry at the louder gain', () => {
  const gains = spellLoopGains([
    { id: 'a', effect: 'fire', at: { x: 0, y: 0, z: 200 }, lasting: true },
    { id: 'b', effect: 'fire', at: { x: 0, y: 0, z: 20 }, lasting: true },
  ], listener, reach);
  assert.equal(gains.size, 1);
  const near = spellLoopGains([{ id: 'b', effect: 'fire', at: { x: 0, y: 0, z: 20 }, lasting: true }], listener, reach);
  assert.equal(gains.get('spell.loop.fire'), near.get('spell.loop.fire'));
  assert.ok(gains.get('spell.loop.fire')! > 0.5);
});

test('a cold spell beyond reach gives gain 0', () => {
  const gains = spellLoopGains([{ id: 'c', effect: 'cold', at: { x: 0, y: 0, z: 5000 }, lasting: true }], listener, reach);
  assert.equal(gains.get('spell.loop.cold'), 0);
});

test('a spell that is not lasting gives no entry', () => {
  assert.equal(spellLoopGains([{ id: 'd', effect: 'fire', at: { x: 0, y: 0, z: 0 }, lasting: false }], listener, reach).size, 0);
});
