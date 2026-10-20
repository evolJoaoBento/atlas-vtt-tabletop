import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fogAreas } from '../src/board/fog';
import { defaultFogMotion, fogNoise, readFogMotion, scatterWisps } from '../src/board/fogMotion';
import { insideFog } from '../src/board/playerView';

test('the fog noise tiles: its edges meet, and it spans soft values', () => {
  const size = 64;
  const noise = fogNoise(size, 7);
  assert.equal(noise.length, size * size);
  let min = 255, max = 0, edge = 0;
  for (let y = 0; y < size; y++) {
    edge = Math.max(edge, Math.abs(noise[y * size]! - noise[y * size + size - 1]!), Math.abs(noise[y] ! - noise[(size - 1) * size + y]!));
    for (let x = 0; x < size; x++) { min = Math.min(min, noise[y * size + x]!); max = Math.max(max, noise[y * size + x]!); }
  }
  // Neighbouring texels across the wrap differ as little as neighbours anywhere: no seam.
  assert.ok(edge < 40, String(edge));
  assert.ok(min < 60 && max > 195, `${min}..${max}`);
  assert.deepEqual(fogNoise(size, 7), noise);
});

test('wisps lie over the fog, about one per square, at most the cap', () => {
  const areas = fogAreas([
    { id: 'a', type: 'rectangle', timestamp: 1, isErasing: false, offsetX: 0, offsetY: 0, x: 0, y: 0, width: 700, height: 700 },
    { id: 'b', type: 'rectangle', timestamp: 2, isErasing: true, offsetX: 0, offsetY: 0, x: 210, y: 210, width: 280, height: 280 },
  ]);
  const wisps = scatterWisps(areas, 70, 3, 500);
  // 100 squares less the 16 erased: 84 squares, one wisp each.
  assert.ok(Math.abs(wisps.length - 84) <= 3, String(wisps.length));
  assert.ok(wisps.every((point) => insideFog(areas, point)));
  assert.equal(scatterWisps(areas, 70, 3, 10).length, 10);
  assert.deepEqual(scatterWisps([], 70, 3, 500), []);
});

test('fog motion: off, subtle or full; by default what the quality can afford', () => {
  assert.equal(readFogMotion('full'), 'full');
  assert.equal(readFogMotion('wild'), null);
  assert.equal(defaultFogMotion('low'), 'off');
  assert.equal(defaultFogMotion('medium'), 'subtle');
  assert.equal(defaultFogMotion('high'), 'full');
});
