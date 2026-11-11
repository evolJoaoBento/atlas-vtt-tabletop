import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WaterMask, readWaterMotion, DEFAULT_WATER_MOTION } from '../src/board/water';

test('the mask covers the map at a fraction of a grid cell, at most 2048 texels a side', () => {
  const small = WaterMask.forMap(1400, 700, 70);
  assert.equal(small.texel, 70 / 8);
  assert.equal(small.width, 160);
  assert.equal(small.height, 80);
  const huge = WaterMask.forMap(40_000, 10_000, 70);
  assert.ok(huge.width <= 2048 && huge.height <= 2048);
});

test('painting a stroke fills the brush and erasing takes it away', () => {
  const mask = WaterMask.forMap(1400, 700, 70);
  assert.equal(mask.empty, true);
  mask.paint(700, 350, 70, true);
  assert.equal(mask.at(700, 350), 255);
  assert.equal(mask.at(700 + 60, 350), 255, 'inside the brush');
  assert.equal(mask.at(700 + 200, 350), 0, 'outside the brush');
  assert.equal(mask.empty, false);
  mask.paint(700, 350, 100, false);
  assert.equal(mask.at(700, 350), 0);
  assert.equal(mask.empty, true);
});

test('a line of strokes leaves no gaps between them', () => {
  const mask = WaterMask.forMap(1400, 700, 70);
  mask.stroke({ x: 100, y: 350 }, { x: 1300, y: 350 }, 35, true);
  for (let x = 100; x <= 1300; x += 20) assert.equal(mask.at(x, 350), 255, `at ${x}`);
});

test('a mask saves and reads back the same', () => {
  const mask = WaterMask.forMap(1400, 700, 70);
  mask.paint(300, 300, 90, true);
  mask.paint(1000, 500, 40, true);
  const saved = mask.save();
  const read = WaterMask.read(saved, 1400, 700, 70);
  assert.ok(read);
  assert.deepEqual([...read!.data], [...mask.data]);
  assert.ok(saved.data.length < mask.data.length / 4, 'saved compactly');
});

test('a saved mask of another size or a broken one is not read', () => {
  const mask = WaterMask.forMap(1400, 700, 70);
  mask.paint(300, 300, 90, true);
  assert.equal(WaterMask.read(mask.save(), 2800, 700, 70), null);
  assert.equal(WaterMask.read({ width: 160, height: 80, data: 'nonsense!' }, 1400, 700, 70), null);
  assert.equal(WaterMask.read(null, 1400, 700, 70), null);
});

test('the motion setting is read with defaults and kept in range', () => {
  assert.deepEqual(readWaterMotion(undefined), DEFAULT_WATER_MOTION);
  assert.deepEqual(readWaterMotion({ kind: 'flow', amount: 3, direction: 450 }), { ...DEFAULT_WATER_MOTION, kind: 'flow', amount: 1, direction: 90 });
  assert.deepEqual(readWaterMotion({ tint: '#AABBCC', clarity: 2 }), { ...DEFAULT_WATER_MOTION, tint: '#aabbcc', clarity: 1 });
  assert.deepEqual(readWaterMotion({ tint: 'blue', clarity: -3 }), { ...DEFAULT_WATER_MOTION, clarity: 0 });
  assert.deepEqual(readWaterMotion({ kind: 'lava', amount: -1 }), { ...DEFAULT_WATER_MOTION, amount: 0 });
});

test('the bucket fills the area of like colour joined to the point, stops at walls, and takes the sensitivity', () => {
  // 80 by 80 map, a texel a pixel (cell 8): the left half blue, the right half green, a slightly lighter blue strip.
  const mask = WaterMask.forMap(80, 80, 8);
  assert.equal(mask.texel, 1);
  const colors = new Uint8ClampedArray(mask.width * mask.height * 4);
  for (let j = 0; j < mask.height; j++) for (let i = 0; i < mask.width; i++) {
    const k = (j * mask.width + i) * 4;
    const [r, g, b] = i >= 40 ? [40, 160, 40] : i < 10 ? [30, 60, 200] : [20, 50, 190];
    colors[k] = r; colors[k + 1] = g; colors[k + 2] = b; colors[k + 3] = 255;
  }
  assert.equal(mask.fill(20, 20, colors, 5, true), true);
  assert.equal(mask.at(20, 20), 255);
  assert.equal(mask.at(5, 20), 0, 'a little off the colour: left out at low sensitivity');
  assert.equal(mask.at(60, 20), 0, 'another colour: left out');
  mask.fill(20, 20, colors, 30, true);
  assert.equal(mask.at(5, 20), 255, 'taken in at higher sensitivity');
  assert.equal(mask.at(60, 20), 0);
  mask.fill(20, 20, colors, 30, false);
  assert.equal(mask.empty, true, 'the bucket erases as well');
  // A wall down the blue at x 25: the fill stays on its side.
  const blocked = new Uint8Array(mask.width * mask.height);
  for (let j = 0; j < mask.height; j++) blocked[j * mask.width + 25] = 1;
  mask.fill(20, 20, colors, 30, true, blocked);
  assert.equal(mask.at(20, 20), 255);
  assert.equal(mask.at(30, 20), 0, 'past the wall: dry');
  assert.equal(mask.fill(25, 20, colors, 30, true, blocked), false, 'on a wall: nothing');
});
