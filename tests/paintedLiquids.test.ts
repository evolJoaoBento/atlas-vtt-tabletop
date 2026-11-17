import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLayers, TERRAINS } from '../src/background/backgroundData';
import { liquidMask } from '../src/background/paintedLiquids';

const SIZE = 256;
const LAVA = TERRAINS.find((t) => t.id === 'lava')!.index;
// A picture 100 squares across, its middle at (50, 50); a square is 10 world units.
const frame = { cx: 50, cy: 50, extent: 100, size: SIZE };
const flat = { x0: 40, y0: 40, x1: 60, y1: 60 };
const CELL = 10;

/** Paints a block of the picture, in picture cells. */
function paint(layers: ReturnType<typeof emptyLayers>, id: number, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) layers.terrain[y * SIZE + x] = id;
}

/** Whether the mask is wet at the square (x, y). */
function wetAt(mask: NonNullable<ReturnType<typeof liquidMask>>, x: number, y: number): boolean {
  const left = frame.cx - frame.extent / 2, top = frame.cy - frame.extent / 2;
  const tx = Math.floor((x - left) * CELL / mask.texel), ty = Math.floor((y - top) * CELL / mask.texel);
  return mask.data[ty * mask.width + tx] === 255;
}

test('a painted lava square is wet there and nowhere else', () => {
  const layers = emptyLayers(SIZE);
  paint(layers, LAVA, 200, 200, 230, 230); // squares 78 to 90
  const mask = liquidMask(layers, frame, CELL, 'lava', flat)!;
  assert.ok(mask);
  assert.equal(wetAt(mask, 85, 85), true);
  assert.equal(wetAt(mask, 70, 85), false);
  assert.equal(wetAt(mask, 95, 85), false);
  assert.equal(wetAt(mask, 20, 20), false);
});

test('the mask covers the picture\'s square, at the size the sea plane uses', () => {
  const layers = emptyLayers(SIZE);
  paint(layers, LAVA, 0, 0, 10, 10);
  const mask = liquidMask(layers, frame, CELL, 'lava', flat)!;
  assert.ok(mask.width * mask.texel >= frame.extent * CELL - mask.texel);
  assert.equal(mask.width, mask.height);
});

test('nothing is wet inside the usable board, even where lava is painted', () => {
  const layers = emptyLayers(SIZE);
  paint(layers, LAVA, 80, 80, 180, 180); // squares 31 to 70: over the board and past it
  const mask = liquidMask(layers, frame, CELL, 'lava', flat)!;
  assert.equal(wetAt(mask, 50, 50), false);
  assert.equal(wetAt(mask, 41, 59), false);
  assert.equal(wetAt(mask, 35, 50), true);
  assert.equal(wetAt(mask, 65, 50), true);
});

test('a liquid not painted at all has no mask', () => {
  const layers = emptyLayers(SIZE);
  paint(layers, LAVA, 200, 200, 230, 230);
  assert.equal(liquidMask(layers, frame, CELL, 'acid', flat), null);
  assert.equal(liquidMask(layers, frame, CELL, 'water', flat), null);
});

test('liquid painted only under the board has no mask', () => {
  const layers = emptyLayers(SIZE);
  paint(layers, LAVA, 110, 110, 140, 140); // squares 43 to 55
  assert.equal(liquidMask(layers, frame, CELL, 'lava', flat), null);
});
