import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLUR_RANGE, SHARP_BAND, blurAt } from '../src/board/postFx';
import { QUALITY, withLooks } from '../src/board/quality';

test('the middle band is sharp and the edges blur most', () => {
  assert.equal(blurAt(0.5), 0);
  assert.ok(blurAt(0.5 + SHARP_BAND) < 1e-9);
  assert.equal(blurAt(0), 1);
  assert.equal(blurAt(1), 1);
});

test('the blur grows steadily from the band outwards, the same above and below', () => {
  const up = [0.1, 0.2, 0.3].map((step) => blurAt(0.5 + SHARP_BAND + step * BLUR_RANGE));
  assert.ok(up[0] > 0 && up[0] < up[1] && up[1] < up[2] && up[2] <= 1);
  assert.ok(Math.abs(blurAt(0.5 + 0.3) - blurAt(0.5 - 0.3)) < 1e-9);
});

test('the miniature look is off in every preset and added without changing the preset', () => {
  for (const preset of Object.values(QUALITY)) assert.equal(preset.tiltShift, false);
  for (const preset of Object.values(QUALITY)) assert.equal(preset.occlusion, false);
  assert.equal(withLooks(QUALITY.high, { tiltShift: false, occlusion: false, painted: false, sky: 'dusk' }), QUALITY.high);
  assert.deepEqual(withLooks(QUALITY.high, { tiltShift: true, occlusion: false, painted: false, sky: 'dusk' }), { ...QUALITY.high, tiltShift: true });
  assert.deepEqual(withLooks(QUALITY.low, { tiltShift: false, occlusion: true, painted: false, sky: 'dusk' }), { ...QUALITY.low, occlusion: true });
});

test('a saved sky is read back, and anything else is dusk', async () => {
  const { readSky } = await import('../src/board/look');
  assert.equal(readSky('night'), 'night');
  assert.equal(readSky('day'), 'day');
  assert.equal(readSky('noon'), 'dusk');
  assert.equal(readSky(undefined), 'dusk');
});

test('a lighting choice sets the painted look and its sky, and the classic one keeps the sky', async () => {
  const { choiceOf, lookOf } = await import('../src/board/look');
  assert.deepEqual(lookOf('night', 'dusk'), { painted: true, sky: 'night' });
  assert.deepEqual(lookOf('classic', 'day'), { painted: false, sky: 'day' });
  assert.equal(choiceOf(true, 'day'), 'day');
  assert.equal(choiceOf(false, 'day'), 'classic');
});
