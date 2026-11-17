import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planeReach } from '../src/board/ground';
import { DEFAULT_BACKGROUND, emptyLayers, TERRAINS, type BackgroundSettings, type TerrainId } from '../src/background/backgroundData';
import { backgroundFrame, backgroundHeight, LIQUID_BED, pixelAt, typeHeight } from '../src/background/terrainHeight';

const SIZE = 256;
const indexOf = (id: TerrainId): number => TERRAINS.find((t) => t.id === id)!.index;
const settings = (over: Partial<BackgroundSettings> = {}): BackgroundSettings => ({ ...DEFAULT_BACKGROUND, ...over });
const fill = (id: TerrainId, height = 128): ReturnType<typeof emptyLayers> => {
  const layers = emptyLayers(SIZE);
  layers.terrain.fill(indexOf(id));
  layers.height.fill(height);
  return layers;
};
const strip = { x0: 0, y0: 0, x1: 60, y1: 10 };

test('the frame is centred on the map and as wide as the plane to the horizon', () => {
  const frame = backgroundFrame(4200, 3000, 100);
  assert.equal(frame.extent, 2 * planeReach(80, 4200) / 100);
  assert.equal(frame.cx, 21);
  assert.equal(frame.cy, 15);
  assert.equal(frame.size, 2048);
});

test('pixelAt finds the pixel a square lies in and clamps past the edge', () => {
  const frame = { cx: 0, cy: 0, extent: 100, size: 10 };
  assert.equal(pixelAt(frame, 0, 0), 5 * 10 + 5);
  assert.equal(pixelAt(frame, -49, -49), 0);
  assert.equal(pixelAt(frame, 1000, 1000), 99);
  assert.equal(pixelAt(frame, -1000, 1000), 90);
});

test('rolling hills leave the board level and shape the ground beyond it', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const layers = fill('rolling');
  for (let x = 0; x <= 60; x += 3) for (let y = 0; y <= 10; y += 2.5) {
    assert.equal(backgroundHeight(x, y, settings(), layers, frame, strip), 0);
  }
  let far = 0;
  for (let x = 0; x <= 60; x += 3) far = Math.max(far, Math.abs(backgroundHeight(x, 40, settings(), layers, frame, strip)));
  assert.ok(far > 0.1, `height at y = 40 was ${far}`);
});

test('water lies one bed below the board edge, far from it', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const h = backgroundHeight(30, 40, settings(), fill('water'), frame, strip);
  assert.ok(Math.abs(h + LIQUID_BED) < 1e-9, `${h}`);
  assert.equal(typeHeight('lava', 3, 4, settings(), 0.5), -LIQUID_BED);
  assert.equal(typeHeight('acid', 3, 4, settings(), 0.5), -LIQUID_BED);
});

test('painted topography runs from low to high', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const range = settings({ height: { low: -2, high: 6 } });
  assert.ok(Math.abs(backgroundHeight(30, 60, range, fill('topography', 255), frame, strip) - 6) < 1e-9);
  assert.ok(Math.abs(backgroundHeight(30, 60, range, fill('topography', 0), frame, strip) + 2) < 1e-9);
});

test('neighbouring hills and dunes meet softly', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const layers = emptyLayers(SIZE);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) layers.terrain[j * SIZE + i] = indexOf(i < SIZE / 2 ? 'rolling' : 'dunes');
  // The border runs down the picture's middle line, x = the frame's centre.
  for (let y = 60; y <= 100; y += 4) for (let step = -40; step <= 40; step++) {
    const x = frame.cx + step * 0.25;
    const a = backgroundHeight(x, y, settings(), layers, frame, strip);
    const b = backgroundHeight(x + 0.25, y, settings(), layers, frame, strip);
    assert.ok(Math.abs(a - b) < 1, `jump of ${Math.abs(a - b)} at ${x}, ${y}`);
  }
});

test('far past the picture the edge continues, finite', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const far = frame.cx + frame.extent * 3;
  const high = backgroundHeight(far, frame.cy, settings(), fill('topography', 255), frame, strip);
  assert.equal(high, 6);
  const hills = backgroundHeight(far, frame.cy + 5, settings(), fill('rough'), frame, strip);
  assert.ok(Number.isFinite(hills));
});

test('a terraced pattern climbs in steps', () => {
  const terraced = settings({ patterns: [{ name: 'Steps', scale: 30, height: 8, roughness: 3, shape: 'terraced' }] });
  const seen = new Set<string>();
  let seed = 7;
  const next = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  for (let n = 0; n < 200; n++) seen.add(typeHeight('custom1', next() * 2000 - 1000, next() * 2000 - 1000, terraced, 0.5).toFixed(2));
  assert.ok(seen.size <= 6, `${seen.size} levels: ${[...seen].join(' ')}`);
});

test('every custom shape gives finite heights, and a missing pattern is flat', () => {
  for (const shape of ['smooth', 'ridged', 'terraced', 'craters'] as const) {
    const s = settings({ patterns: [{ name: 'P', scale: 20, height: 5, roughness: 2, shape }] });
    let varies = false;
    for (let x = 0; x < 100; x += 7) {
      const h = typeHeight('custom1', x, x * 0.7, s, 0.5);
      assert.ok(Number.isFinite(h));
      if (Math.abs(h) > 0.01) varies = true;
    }
    assert.ok(varies, shape);
  }
  assert.equal(typeHeight('custom3', 10, 10, settings(), 0.5), 0);
  assert.equal(typeHeight('plains', 10, 10, settings(), 0.5), 0);
});
