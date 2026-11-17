import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_SIZE, DEFAULT_BACKGROUND, emptyLayers, readBackgroundSettings, TERRAINS, terrainOf } from '../src/background/backgroundData';
import { LIQUID_DEFAULTS } from '../src/board/water';

test('background settings read tolerantly: defaults when missing', () => {
  assert.deepEqual(readBackgroundSettings(undefined), DEFAULT_BACKGROUND);
  assert.deepEqual(readBackgroundSettings('junk'), DEFAULT_BACKGROUND);
  assert.equal(BACKGROUND_SIZE, 2048);
});

test('only four patterns and four materials are kept', () => {
  const pattern = { name: 'Hill', scale: 30, height: 5, roughness: 3, shape: 'smooth' };
  assert.equal(readBackgroundSettings({ patterns: [pattern, pattern, pattern, pattern, pattern] }).patterns.length, 4);
  assert.deepEqual(readBackgroundSettings({ materials: ['a', '', 7, 'b', 'c', 'd', 'e'] }).materials, ['a', 'b', 'c', 'd']);
});

test('a pattern is clamped and an unknown shape becomes smooth', () => {
  const read = readBackgroundSettings({ patterns: [{ scale: 1000, height: -3, roughness: 9.4, shape: 'spiky' }] });
  assert.deepEqual(read.patterns[0], { name: 'Background', scale: 200, height: 0, roughness: 6, shape: 'smooth' });
});

test('the height range is swapped when low is above high', () => {
  assert.deepEqual(readBackgroundSettings({ height: { low: 8, high: -1 } }).height, { low: -1, high: 8 });
});

test('lava is read with lava\'s own fallback, so its style is kept', () => {
  const read = readBackgroundSettings({ liquids: { lava: { amount: 0.9 } } });
  assert.equal(read.liquids.lava.style, LIQUID_DEFAULTS.lava.style);
  assert.equal(read.liquids.lava.amount, 0.9);
  assert.equal(read.liquids.water.style, undefined);
});

test('terrains are numbered 0 to 12 and unknown numbers are plains', () => {
  assert.deepEqual(TERRAINS.map((t) => t.index), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(terrainOf(99), 'plains');
  assert.equal(terrainOf(10), 'water');
});

test('empty layers are plains, first material, mid height', () => {
  const layers = emptyLayers(4);
  assert.equal(layers.height.length, 16);
  assert.ok(layers.height.every((v) => v === 128));
  assert.ok(layers.terrain.every((v) => v === 0) && layers.material.every((v) => v === 0));
  assert.equal(emptyLayers().terrain.length, BACKGROUND_SIZE * BACKGROUND_SIZE);
});
