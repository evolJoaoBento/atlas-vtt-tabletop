import assert from 'node:assert/strict';
import { test } from 'node:test';
import { previewReach } from '../src/miniPreview';

const elf = { height: 1.485, footprint: 1.055 };

test('the preview keeps one framing while the mini fits, so its token square stays one size', () => {
  assert.equal(previewReach(null, 1, 'none'), previewReach(elf, 0.3, 'none'));
  assert.equal(previewReach(elf, 0.3, 'none'), previewReach(elf, 0.6, 'round'));
});

test('the preview takes in more once a mini would be cut off, and grows with its size', () => {
  const fits = previewReach(elf, 0.6, 'none');
  const big = previewReach(elf, 1.5, 'none');
  const bigger = previewReach(elf, 3, 'none');
  assert.ok(big > fits);
  assert.ok(bigger > big);
  // A base adds its thickness to the height.
  assert.ok(previewReach(elf, 3, 'round') > previewReach(elf, 3, 'none'));
});

test('a wide mini is framed by its width as well as its height', () => {
  const wide = { height: 0.2, footprint: 4 };
  assert.ok(previewReach(wide, 3, 'none') >= 0.9 * 3 * 1.5 - 1e-9);
});
