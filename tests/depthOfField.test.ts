import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOF_RANGE, DOF_SHARP, dofBlurAt, focusOf } from '../src/board/postFx';
import { postFxOn, QUALITY, withLooks } from '../src/board/quality';

test('what the focus rests on is sharp, and the blur grows with how far nearer or farther a thing is', () => {
  assert.equal(dofBlurAt(100, 100), 0);
  assert.equal(dofBlurAt(100 * (1 + DOF_SHARP), 100), 0);
  const farther = [0.2, 0.4, 0.6].map((share) => dofBlurAt(100 * (1 + DOF_SHARP + share * DOF_RANGE), 100));
  assert.ok(farther[0]! > 0 && farther[0]! < farther[1]! && farther[1]! < farther[2]! && farther[2]! < 1);
  assert.equal(dofBlurAt(100 * (1 + DOF_SHARP + DOF_RANGE), 100), 1);
  // Half as far as the focus is well blurred.
  assert.ok(dofBlurAt(50, 100) > 0.75);
});

test('the blur is a share of the focus distance, so a big map and a small one look alike', () => {
  assert.ok(Math.abs(dofBlurAt(130, 100) - dofBlurAt(13000, 10000)) < 1e-9);
});

test('the sky is blurred fully, and nothing is blurred with no focus', () => {
  assert.equal(dofBlurAt(Infinity, 100), 1);
  assert.equal(dofBlurAt(70, null), 0);
});

test('the focus is what the middle of the view rests on; off the sky, the nearest thing beside the middle', () => {
  assert.equal(focusOf([40, 10, 90, 60, 70]), 40);
  assert.equal(focusOf([Infinity, 90, 60, Infinity, 70]), 60);
  assert.equal(focusOf([Infinity, Infinity, Infinity, Infinity, Infinity]), null);
});

test('depth of field is off in every preset, added without changing the preset, and asks for the post-processing pass', () => {
  for (const preset of Object.values(QUALITY)) assert.equal(preset.depthOfField, false);
  const looks = { tiltShift: false, occlusion: false, painted: false, sky: 'dusk' as const };
  assert.equal(withLooks(QUALITY.high, { ...looks, depthOfField: false }), QUALITY.high);
  const on = withLooks(QUALITY.high, { ...looks, depthOfField: true });
  assert.deepEqual(on, { ...QUALITY.high, depthOfField: true });
  assert.equal(postFxOn(QUALITY.high), false);
  assert.equal(postFxOn(on), true);
});

test('the intensity is held to 25%..250% (anything else is 100%), and makes the blur bigger and nearer the focus', async () => {
  const { readDofStrength, MIN_DOF_STRENGTH, MAX_DOF_STRENGTH, DEFAULT_DOF_STRENGTH } = await import('../src/board/quality');
  const { dofParams, MAX_DOF_PX, DOF_RANGE } = await import('../src/board/postFx');
  assert.equal(DEFAULT_DOF_STRENGTH, 1);
  assert.equal(readDofStrength(1.5), 1.5);
  assert.equal(readDofStrength(9), MAX_DOF_STRENGTH);
  assert.equal(readDofStrength(0), MIN_DOF_STRENGTH);
  assert.equal(readDofStrength('x'), 1);
  assert.deepEqual(dofParams(1), { px: MAX_DOF_PX, range: DOF_RANGE });
  const strong = dofParams(2);
  assert.ok(strong.px > MAX_DOF_PX && strong.range < DOF_RANGE);
  const soft = dofParams(0.5);
  assert.ok(soft.px < MAX_DOF_PX && soft.range > DOF_RANGE);
  assert.ok(dofBlurAt(130, 100, 2) > dofBlurAt(130, 100, 1));
});

test('the intensity and the centre focus are kept in the preset, unchanged when the same', () => {
  const looks = { tiltShift: false, occlusion: false, painted: false, sky: 'dusk' as const };
  for (const preset of Object.values(QUALITY)) { assert.equal(preset.dofStrength, 1); assert.equal(preset.dofCenter, false); }
  assert.equal(withLooks(QUALITY.high, { ...looks, dofStrength: 1, dofCenter: false }), QUALITY.high);
  assert.deepEqual(withLooks(QUALITY.high, { ...looks, dofStrength: 2, dofCenter: true }), { ...QUALITY.high, dofStrength: 2, dofCenter: true });
});
