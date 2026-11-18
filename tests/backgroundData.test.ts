import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_SIZE, DEFAULT_BACKGROUND, emptyLayers, MAX_BRUSHES, MAX_BRUSH_PROPS, readBackgroundSettings, TERRAINS, terrainOf } from '../src/background/backgroundData';
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

test('prop brushes: defaults, clamps and caps', () => {
  assert.deepEqual(DEFAULT_BACKGROUND.props, []);
  assert.equal(MAX_BRUSHES, 6);
  assert.equal(MAX_BRUSH_PROPS, 4);
  const read = readBackgroundSettings({ props: [{}, { name: '  Pines  ', props: ['a.glb'], density: 9999, scale: 0.001 }, { density: 'x', scale: null }] });
  assert.deepEqual(read.props[0], { name: 'Props 1', props: [], density: 10, scale: 1 });
  assert.deepEqual(read.props[1], { name: 'Pines', props: ['a.glb'], density: 200, scale: 0.1 });
  assert.deepEqual(read.props[2], { name: 'Props 3', props: [], density: 10, scale: 1 });
  assert.equal(readBackgroundSettings({ props: [{ density: -4, scale: 99 }] }).props[0].density, 0.1);
  assert.equal(readBackgroundSettings({ props: [{ density: -4, scale: 99 }] }).props[0].scale, 20);
  assert.equal(readBackgroundSettings({ props: [{ name: 'x'.repeat(80) }] }).props[0].name.length, 60);
  assert.equal(readBackgroundSettings({ props: Array.from({ length: 9 }, () => ({})) }).props.length, 6);
  assert.deepEqual(readBackgroundSettings({ props: 'junk' }).props, []);
  assert.deepEqual(readBackgroundSettings({ props: [7, null] }).props.map((b) => b.name), ['Props 1', 'Props 2']);
});

test('brush props must be .glb paths, are deduplicated and capped at four', () => {
  const read = readBackgroundSettings({ props: [{ props: ['a.glb', 'B.GLB', '', 7, 'c.png', 'a.glb', 'd.glb', 'e.glb', 'f.glb'] }] });
  assert.deepEqual(read.props[0].props, ['a.glb', 'B.GLB', 'd.glb', 'e.glb']);
  assert.deepEqual(readBackgroundSettings({ props: [{ props: 'a.glb' }] }).props[0].props, []);
});

test('empty layers are plains, first material, mid height', () => {
  const layers = emptyLayers(4);
  assert.equal(layers.props.length, 16);
  assert.ok(layers.props.every((v) => v === 0));
  assert.equal(layers.height.length, 16);
  assert.ok(layers.height.every((v) => v === 128));
  assert.ok(layers.terrain.every((v) => v === 0) && layers.material.every((v) => v === 0));
  assert.equal(emptyLayers().terrain.length, BACKGROUND_SIZE * BACKGROUND_SIZE);
});
