import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waterDistance, waterLoop } from '../src/sound/waterSound';

function leftHalf(width: number, height: number): { width: number; height: number; data: Uint8Array; version?: number } {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) data.fill(255, y * width, y * width + width / 2);
  return { width, height, data };
}

test('a point over the water is at distance 0, one at the far edge is far from it', () => {
  const mask = leftHalf(400, 300);
  assert.equal(waterDistance(mask, 4000, 3000, { x: 1000, y: 1500 }), 0);
  assert.ok(waterDistance(mask, 4000, 3000, { x: 4000, y: 1500 }) > 0.4 * 4000);
});

test('a mask without water is infinitely far', () => {
  assert.equal(waterDistance({ width: 100, height: 100, data: new Uint8Array(10000) }, 1000, 1000, { x: 500, y: 500 }), Infinity);
});

test('a big mask is searched on a coarse grid yet still found', () => {
  const data = new Uint8Array(2048 * 2048);
  data[2000 * 2048 + 2000] = 255;
  const far = waterDistance({ width: 2048, height: 2048, data }, 20480, 20480, { x: 0, y: 0 });
  assert.ok(far > 20000 && far < 29000, String(far));
});

test('the search is cached per mask version', () => {
  const mask = { ...leftHalf(100, 100), version: 1 };
  assert.equal(waterDistance(mask, 1000, 1000, { x: 900, y: 500 }) > 300, true);
  mask.data.fill(255);
  assert.equal(waterDistance(mask, 1000, 1000, { x: 900, y: 500 }) > 300, true, 'same version: the cached grid is used');
  mask.version = 2;
  assert.equal(waterDistance(mask, 1000, 1000, { x: 900, y: 500 }), 0);
});

test('each motion has its own loop', () => {
  assert.equal(waterLoop('still'), 'water.still');
  assert.equal(waterLoop('ripples'), 'water.ripples');
  assert.equal(waterLoop('flow'), 'water.flow');
  assert.equal(waterLoop('waves'), 'water.waves');
});
