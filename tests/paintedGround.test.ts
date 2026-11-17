import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EASE_SQUARES } from '../src/board/ground';
import { emptyLayers } from '../src/background/backgroundData';
import { splatTexture } from '../src/background/paintedGround';

const SIZE = 256;
// A picture 128 squares across (two cells to a square), its middle at (64, 64); the usable board is squares 54 to 74.
const frame = { cx: 64, cy: 64, extent: 128, size: SIZE };
const flat = { x0: 54, y0: 54, x1: 74, y1: 74 };

/** The first slot's weight (0 to 255) at the square (x, y). */
function weightAt(data: Uint8Array, x: number, y: number): number {
  const cx = Math.floor(x / frame.extent * SIZE), cy = Math.floor(y / frame.extent * SIZE);
  return data[(cy * SIZE + cx) * 4];
}

test('materials ease in past the usable board as heights do: none at its edge, full strength EASE_SQUARES out', () => {
  const layers = emptyLayers(SIZE);
  layers.material.fill(1);
  const data = (splatTexture(layers, frame, flat).image as { data: Uint8Array }).data;
  assert.equal(weightAt(data, 64, 64), 0, 'plain inside the board');
  const near = weightAt(data, flat.x1 + 1, 64), mid = weightAt(data, flat.x1 + EASE_SQUARES / 2, 64), far = weightAt(data, flat.x1 + EASE_SQUARES + 2, 64);
  assert.ok(near > 0 && near < 60, `just past the edge it is faint (${near})`);
  assert.ok(mid > near && mid < far, `it grows with the distance (${near}, ${mid}, ${far})`);
  assert.equal(far, 255);
});
