import assert from 'node:assert/strict';
import { test } from 'node:test';
import { castsToAnnounce, spellImpactSound, spellLoopGains, spellLoopSound } from '../src/sound/spellSounds';

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

test('a lasting bludgeoning, piercing or slashing spell has no loop: it adds no entry and breaks nothing', () => {
  for (const effect of ['bludgeoning', 'piercing', 'slashing'] as const) {
    assert.equal(spellLoopSound(effect), null, effect);
    assert.equal(spellLoopGains([{ id: effect, effect, at: { x: 0, y: 0, z: 0 }, lasting: true }], listener, reach).size, 0, effect);
  }
  const mixed = spellLoopGains([
    { id: 'a', effect: 'slashing', at: { x: 0, y: 0, z: 0 }, lasting: true },
    { id: 'b', effect: 'fire', at: { x: 0, y: 0, z: 20 }, lasting: true },
    { id: 'c', effect: 'piercing', at: { x: 0, y: 0, z: 10 }, lasting: true },
  ], listener, reach);
  assert.deepEqual([...mixed.keys()], ['spell.loop.fire']);
});

test('every other damage type, and no type, has a loop sound', () => {
  for (const effect of ['acid', 'cold', 'explosion', 'fire', 'force', 'lightning', 'necrotic', 'poison', 'psychic', 'radiant', 'thunder'] as const) assert.equal(spellLoopSound(effect), `spell.loop.${effect}`);
  assert.equal(spellLoopSound(null), 'spell.loop.plain');
});
