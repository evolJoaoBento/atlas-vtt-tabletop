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

test('painted height lifts any land on top of its own hills', () => {
  const frame = backgroundFrame(60, 10, 1, SIZE);
  const range = settings({ height: { low: -2, high: 6 } });
  const plain = backgroundHeight(30, 60, range, fill('plains', 255), frame, strip);
  assert.ok(Math.abs(plain - 127 / 255 * 8) < 1e-9, `${plain}`);
  assert.ok(Math.abs(backgroundHeight(30, 60, range, fill('plains', 128), frame, strip)) < 1e-9);
  const base = backgroundHeight(30, 60, range, fill('rolling', 128), frame, strip);
  const lifted = backgroundHeight(30, 60, range, fill('rolling', 200), frame, strip);
  assert.ok(Math.abs(lifted - base - 72 / 255 * 8) < 1e-9, `${lifted} vs ${base}`);
  assert.ok(backgroundHeight(30, 60, range, fill('rolling', 0), frame, strip) < base - 3);
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

// ── Shores: the liquid lies in a bed; land that would dip under it rises to a low bank, land above it stays an edge ──
/** A picture split down the middle: `left` on the left half, `right` on the right half; the frame puts square 0 in its middle. */
function split(left: TerrainId, right: TerrainId, rightHeight = 128): { layers: ReturnType<typeof emptyLayers>; frame: { cx: number; cy: number; extent: number; size: number } } {
  const layers = emptyLayers(SIZE);
  for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) {
    layers.terrain[j * SIZE + i] = indexOf(i < SIZE / 2 ? left : right);
    layers.height[j * SIZE + i] = i < SIZE / 2 ? 128 : rightHeight;
  }
  // 256 squares across, square 0 at the border between the halves (pixel 128 starts at square 0).
  return { layers, frame: { cx: 0, cy: 0, extent: SIZE, size: SIZE } };
}
// Far from any board: the board is nowhere near these points.
const far = { x0: -2000, y0: -2000, x1: -1990, y1: -1990 };

test('shore: land lower than the water comes up to a shelf just under its surface by the shore, then eases down to its own height', () => {
  // Painted topography at its lowest (-2 squares) beside water: the sheet's edge must not float over it.
  const { layers, frame } = split('water', 'topography', 0);
  const s = settings();
  for (const x of [0.25, 0.5, 1, 1.4]) {
    const h = backgroundHeight(x, 0, s, layers, frame, far);
    assert.ok(h < 0 && h > -0.2, `land ${x} sq from the shore lies just under the water's surface (${h})`);
  }
  assert.ok(Math.abs(backgroundHeight(30, 0, s, layers, frame, far) - -2) < 1e-6);
  const shallow = backgroundHeight(-0.5, 0, s, layers, frame, far), deep = backgroundHeight(-30, 0, s, layers, frame, far);
  assert.ok(shallow < 0 && shallow > -1, `shallow at the shore (${shallow})`);
  assert.ok(Math.abs(deep - -LIQUID_BED) < 1e-6, `full depth away from it (${deep})`);
  let worst = 0;
  for (let x = -10; x < 12; x += 0.25) worst = Math.max(worst, Math.abs(backgroundHeight(x + 0.25, 0, s, layers, frame, far) - backgroundHeight(x, 0, s, layers, frame, far)));
  assert.ok(worst < 1, `smooth all round (worst step ${worst})`);
});

test('shore: land higher than the water slopes down smoothly to the shelf at the waterline, no cliff', () => {
  const { layers, frame } = split('water', 'topography', 255);
  const s = settings();
  const heights = [0.5, 1, 2, 3, 4, 6, 8].map((x) => backgroundHeight(x, 0, s, layers, frame, far));
  for (let k = 1; k < heights.length; k++) assert.ok(heights[k] >= heights[k - 1] - 1e-9, `rises away from the shore: ${heights.join(', ')}`);
  assert.ok(heights[0] < 0 && heights[0] > -0.2, `the shelf just under the water at the shore (${heights[0]})`);
  assert.ok(Math.abs(backgroundHeight(30, 0, s, layers, frame, far) - 6) < 1e-6);
  let worst = 0;
  for (let x = -4; x < 10; x += 0.25) worst = Math.max(worst, Math.abs(backgroundHeight(x + 0.25, 0, s, layers, frame, far) - backgroundHeight(x, 0, s, layers, frame, far)));
  assert.ok(worst < 1, `smooth all round (worst step ${worst})`);
});
