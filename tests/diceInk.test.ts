import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digitInk, inkDigits } from '../src/dice/diceTextures';

test("on a dark body the pack's dark digits are written in Atlas's light ink (readableInk); a light body keeps them", () => {
  assert.equal(digitInk('#1f1e21'), '#e2e8f0');
  assert.equal(digitInk('#e7dcc3'), null);
  assert.equal(digitInk('not a colour'), null);
  // Two pixels: an opaque dark digit, and the faint wash of a face (mostly transparent), then an opaque light one.
  const pixels = Uint8ClampedArray.from([10, 10, 10, 255, 20, 20, 20, 40, 250, 250, 250, 255]);
  inkDigits(pixels, '#e2e8f0');
  assert.deepEqual([...pixels], [0xe2, 0xe8, 0xf0, 255, 20, 20, 20, 40, 250, 250, 250, 255]);
});
