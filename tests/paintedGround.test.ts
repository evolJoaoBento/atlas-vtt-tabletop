import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLayers } from '../src/background/backgroundData';
import { splatTexture } from '../src/background/paintedGround';

const SIZE = 256;
// A picture 128 squares across (two cells to a square), its middle at (64, 64); the map is squares 54 to 74.
const frame = { cx: 64, cy: 64, extent: 128, size: SIZE };
const map = { x0: 54, y0: 54, x1: 74, y1: 74 };

/** The first slot's weight (0 to 255) at the square (x, y). */
function weightAt(data: Uint8Array, x: number, y: number): number {
  const cx = Math.floor(x / frame.extent * SIZE), cy = Math.floor(y / frame.extent * SIZE);
  return data[(cy * SIZE + cx) * 4];
}

test('materials are painted right up to the map, on the extra board too: only under the map itself the ground stays plain', () => {
  const layers = emptyLayers(SIZE);
  layers.material.fill(1);
  const data = (splatTexture(layers, frame, map).image as { data: Uint8Array }).data;
  assert.equal(weightAt(data, 64, 64), 0, 'plain under the map');
  assert.equal(weightAt(data, map.x1 - 1, 64), 0, 'plain just inside the map');
  // The extra board round the map (a square or two past its edge) takes the painted material at full strength.
  assert.equal(weightAt(data, map.x1 + 1, 64), 255, 'full just past the map');
  assert.equal(weightAt(data, map.x0 - 2, map.y0 - 2), 255, 'full past a corner');
  assert.equal(weightAt(data, 100, 100), 255);
});
