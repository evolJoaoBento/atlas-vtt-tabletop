import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hpChange, hpKey, readAmount, turned } from '../src/board/groupActions';
import { HP_RESOURCE, type ResourceDefinition } from '../src/board/resources';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { fakeAtlas } from './fakeAtlasStore';

test('turning wraps within 0 to 360, either way', () => {
  assert.equal(turned(0, 45), 45);
  assert.equal(turned(350, 45), 35);
  assert.equal(turned(0, -45), 315);
  assert.equal(turned(90, -450), 0);
});

test('the group HP change names the hp resource, else the first draining one that defeats', () => {
  assert.equal(hpKey([HP_RESOURCE]), 'hp');
  const wounds: ResourceDefinition = { ...HP_RESOURCE, key: 'wounds', name: 'Wounds' };
  assert.equal(hpKey([{ ...HP_RESOURCE, key: 'stress', direction: 'fills', defeatedWhenSpent: false }, wounds]), 'wounds');
  assert.equal(hpKey([]), null);
});

test('a token takes a group change within 0 and its maximum, and one without the resource or at its limit is skipped', () => {
  const token = { resources: { hp: { current: 5, max: 10 } } };
  assert.deepEqual(hpChange(token, 'hp', -3), { current: 2, max: 10 });
  assert.deepEqual(hpChange(token, 'hp', -30), { current: 0, max: 10 });
  assert.deepEqual(hpChange(token, 'hp', 30), { current: 10, max: 10 });
  assert.equal(hpChange({ resources: { hp: { current: 0, max: 10 } } }, 'hp', -1), null, 'already at 0');
  assert.equal(hpChange({ resources: {} }, 'hp', 1), null, 'no hp');
});

test('the amount box takes a whole number from 1', () => {
  assert.equal(readAmount('5'), 5);
  assert.equal(readAmount(' 12 '), 12);
  for (const bad of ['', '0', '-3', '2.5', 'abc', '1000']) assert.equal(readAmount(bad), null, bad);
});

test("turning tokens goes to Atlas's store as one change, and refuses a token or a map Atlas does not hold", async () => {
  const atlas = fakeAtlas('m.atlasmap', { a: { id: 'a', x: 1, y: 2 }, b: { id: 'b', x: 3, y: 4, rotation: 90 } });
  const writer = new TokenWriter(atlas.deps());
  await writer.rotate('m.atlasmap', [{ id: 'a', rotation: 45 }, { id: 'b', rotation: 135 }]);
  assert.equal(atlas.state.objects.tokens.a!.rotation, 45);
  assert.equal(atlas.state.objects.tokens.b!.rotation, 135);
  assert.equal(atlas.state.objects.tokens.a!.x, 1, 'nothing else changes');
  await assert.rejects(writer.rotate('m.atlasmap', [{ id: 'zz', rotation: 10 }]), /no token zz/);
  await assert.rejects(new TokenWriter(atlas.deps(false)).rotate('m.atlasmap', [{ id: 'a', rotation: 10 }]), NotHeldError);
});
