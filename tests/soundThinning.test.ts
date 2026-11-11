import assert from 'node:assert/strict';
import { test } from 'node:test';
import { staggerOffsets, Thinner } from '../src/sound/thinning';

test('Thinner lets only the cap through in a window, then opens again', () => {
  const thinner = new Thinner(6, 50);
  let taken = 0;
  for (let i = 0; i < 20; i++) if (thinner.take(1000)) taken++;
  assert.equal(taken, 6);
  assert.equal(thinner.take(1051), true);
});

test('staggerOffsets without jitter steps evenly from 0', () => {
  assert.deepEqual(staggerOffsets(5, 45, 15, () => 0.5), [0, 45, 90, 135, 180]);
});

test('staggerOffsets with real jitter is sorted, starts at 0 and keeps its gaps', () => {
  for (let run = 0; run < 50; run++) {
    const offsets = staggerOffsets(8);
    assert.equal(offsets.length, 8);
    assert.equal(offsets[0], 0);
    assert.deepEqual([...offsets].sort((a, b) => a - b), offsets);
    for (let i = 1; i < offsets.length; i++) assert.ok(offsets[i] - offsets[i - 1] >= 30);
  }
  assert.deepEqual(staggerOffsets(0), []);
});
