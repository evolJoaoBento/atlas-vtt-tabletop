import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BACKGROUND, emptyLayers, TERRAINS, type BackgroundSettings, type PropBrush } from '../src/background/backgroundData';
import { MAX_IMPOSTORS, MAX_MODELS, scatterProps } from '../src/background/propScatter';
import type { BackgroundFrame } from '../src/background/terrainHeight';

const brush = (density: number, scale = 1, props = ['a.glb']): PropBrush => ({ name: 'Trees', props, density, scale });
const settingsOf = (...brushes: PropBrush[]): BackgroundSettings => ({ ...DEFAULT_BACKGROUND, props: brushes });
const WATER = TERRAINS.find((t) => t.id === 'water')!.index;
const NO_MAP = { x0: -1, y0: -1, x1: -1, y1: -1 };
const one = (): number => 1;

/** 512 cells across 256 squares: half a square per cell, the map's middle at (128, 128). */
const frame: BackgroundFrame = { cx: 128, cy: 128, extent: 256, size: 512 };
const layersFor = (size = 512) => emptyLayers(size);

function paint(layers: ReturnType<typeof emptyLayers>, f: BackgroundFrame, x0: number, y0: number, x1: number, y1: number, value: number, field: 'props' | 'terrain' = 'props'): void {
  const cell = f.extent / f.size, left = f.cx - f.extent / 2, top = f.cy - f.extent / 2;
  for (let j = 0; j < f.size; j++) for (let i = 0; i < f.size; i++) {
    const x = left + (i + 0.5) * cell, y = top + (j + 0.5) * cell;
    if (x >= x0 && x < x1 && y >= y0 && y < y1) layers[field][j * f.size + i] = value;
  }
}

test('a one-cell dot is one prop at its middle', () => {
  const layers = layersFor();
  const i = 300, j = 200;
  layers.props[j * 512 + i] = 1;
  const out = scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, one);
  assert.equal(out.length, 1);
  assert.equal(out[0].x, 128 - 128 + (i + 0.5) * 0.5);
  assert.equal(out[0].y, (j + 0.5) * 0.5);
  assert.equal(out[0].brush, 0);
});

test('a 20x20-square forest at density 20 has about 80 props', () => {
  const layers = layersFor();
  paint(layers, frame, 40, 40, 60, 60, 1);
  const out = scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, one);
  // One small patch sees only a couple of clumps, so it may be thick or thin; patches in 8 places average out to the density.
  assert.ok(out.length > 30 && out.length < 150, `got ${out.length}`);
  let total = 0;
  for (let k = 0; k < 8; k++) {
    const patch = layersFor();
    paint(patch, frame, 20 + k * 25, 30 + (k % 3) * 60, 40 + k * 25, 50 + (k % 3) * 60, 1);
    total += scatterProps(patch, settingsOf(brush(20)), frame, NO_MAP, one).length;
  }
  assert.ok(total / 8 > 60 && total / 8 < 100, `mean ${total / 8}`);
  for (const p of out) assert.ok(p.x >= 40 && p.x < 60 && p.y >= 40 && p.y < 60);
  for (const p of out) assert.ok(p.turn >= 0 && p.turn < Math.PI * 2 && p.scale >= 0.85 && p.scale <= 1.15 && p.prop === 0);
});

test('nothing stands on the map rectangle or on water cells', () => {
  const layers = layersFor();
  paint(layers, frame, 40, 40, 100, 100, 1);
  paint(layers, frame, 70, 40, 85, 100, WATER, 'terrain');
  const map = { x0: 40, y0: 40, x1: 55, y1: 100 };
  const out = scatterProps(layers, settingsOf(brush(20)), frame, map, one);
  assert.ok(out.length > 100);
  for (const p of out) {
    assert.ok(!(p.x >= 40 && p.x <= 55 && p.y >= 40 && p.y <= 100), 'on the map');
    assert.ok(!(p.x >= 70 && p.x < 85), 'on water');
  }
});

test('a small spot on the map or on water moves to an allowed cell, or places nothing', () => {
  const layers = layersFor();
  for (let j = 100; j < 104; j++) for (let i = 100; i < 104; i++) layers.props[j * 512 + i] = 1;
  const big = (): number => 100;
  // Footprint big enough for one prop; the middle (51, 51) is on the map but the spot reaches outside it.
  const map = { x0: 0, y0: 0, x1: 51.2, y1: 100 };
  const out = scatterProps(layers, settingsOf(brush(20)), frame, map, big);
  assert.equal(out.length, 1);
  assert.ok(out[0].x > 51.2);
  assert.equal(scatterProps(layers, settingsOf(brush(20)), frame, { x0: 0, y0: 0, x1: 100, y1: 100 }, big).length, 0);
});

test('same input gives the same output', () => {
  const layers = layersFor();
  paint(layers, frame, 40, 40, 90, 90, 1);
  const a = scatterProps(layers, settingsOf(brush(20, 1, ['a', 'b', 'c'])), frame, NO_MAP, one);
  const b = scatterProps(layers, settingsOf(brush(20, 1, ['a', 'b', 'c'])), frame, NO_MAP, one);
  assert.deepEqual(a, b);
  assert.ok(new Set(a.map((p) => p.prop)).size === 3);
});

test('far is by distance from the middle', () => {
  const layers = layersFor();
  paint(layers, frame, 120, 120, 136, 136, 1);
  paint(layers, frame, 10, 10, 26, 26, 1);
  const out = scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, one);
  assert.ok(out.some((p) => !p.far) && out.some((p) => p.far));
  for (const p of out) assert.equal(p.far, Math.hypot(p.x - 128, p.y - 128) > 64);
});

test('a brush with no known props, an unknown value or no props places nothing', () => {
  const layers = layersFor();
  paint(layers, frame, 40, 40, 60, 60, 1);
  assert.equal(scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, () => 0).length, 0);
  assert.equal(scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, () => NaN).length, 0);
  assert.equal(scatterProps(layers, settingsOf(brush(20, 1, [])), frame, NO_MAP, one).length, 0);
  paint(layers, frame, 40, 40, 60, 60, 2);
  assert.equal(scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, one).length, 0);
});

test('two touching spots of one brush share one grid, and two brushes stay apart', () => {
  const layers = layersFor();
  paint(layers, frame, 40, 40, 60, 60, 1);
  paint(layers, frame, 60, 40, 80, 60, 1);
  const joined = scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, one);
  const whole = layersFor();
  paint(whole, frame, 40, 40, 80, 60, 1);
  assert.deepEqual(joined, scatterProps(whole, settingsOf(brush(20)), frame, NO_MAP, one));
  paint(layers, frame, 100, 40, 120, 60, 2);
  const two = scatterProps(layers, settingsOf(brush(20), brush(20)), frame, NO_MAP, one);
  assert.ok(two.some((p) => p.brush === 1) && two.every((p) => (p.brush === 1) === (p.x >= 100)));
});

test('a dense forest over half a 2048 picture is capped, spread and fast', () => {
  const size = 2048;
  const big: BackgroundFrame = { cx: 350, cy: 350, extent: 700, size };
  const layers = emptyLayers(size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size / 2; i++) layers.props[j * size + i] = 1;
  const map = { x0: 325, y0: 325, x1: 375, y1: 375 };
  const t0 = performance.now();
  const out = scatterProps(layers, settingsOf(brush(200)), big, map, one);
  const ms = performance.now() - t0;
  console.log(`dense forest: ${out.length} props in ${ms.toFixed(0)} ms`);
  const near = out.filter((p) => !p.far), far = out.filter((p) => p.far);
  assert.ok(near.length <= MAX_MODELS && far.length <= MAX_IMPOSTORS);
  assert.ok(near.length > MAX_MODELS * 0.9 && far.length > MAX_IMPOSTORS * 0.9);
  // Spread: four equal quadrants of the painted area that lie wholly far (x under 150), each within 25 % of the mean.
  const quadrants = [0, 0, 0, 0];
  for (const p of far) if (p.x < 150) quadrants[(p.x < 75 ? 0 : 1) + (p.y < 350 ? 0 : 2)]++;
  const mean = quadrants.reduce((a, b) => a + b, 0) / 4;
  assert.ok(mean > 1000);
  for (const q of quadrants) assert.ok(Math.abs(q - mean) <= mean * 0.25, `quadrants ${quadrants.join(', ')}`);
  assert.ok(ms < 1500, `took ${ms} ms`);
});

test('a 100-square map (a picture 1 500 squares across) with density 200 over half of it is capped, spread and fast', () => {
  const size = 2048;
  const big: BackgroundFrame = { cx: 750, cy: 750, extent: 1500, size };
  const layers = emptyLayers(size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size / 2; i++) layers.props[j * size + i] = 1;
  const map = { x0: 700, y0: 700, x1: 800, y1: 800 };
  const t0 = performance.now();
  const out = scatterProps(layers, settingsOf(brush(200)), big, map, one);
  const ms = performance.now() - t0;
  console.log(`huge forest: ${out.length} props in ${ms.toFixed(0)} ms`);
  const near = out.filter((p) => !p.far), far = out.filter((p) => p.far);
  assert.ok(near.length <= MAX_MODELS && far.length <= MAX_IMPOSTORS);
  assert.ok(near.length > MAX_MODELS * 0.9 && far.length > MAX_IMPOSTORS * 0.9);
  // Spread: four equal quadrants of the painted area that lie wholly far (x under 375), each within 25 % of the mean.
  const quadrants = [0, 0, 0, 0];
  for (const p of far) if (p.x < 375) quadrants[(p.x < 187.5 ? 0 : 1) + (p.y < 750 ? 0 : 2)]++;
  const mean = quadrants.reduce((a, b) => a + b, 0) / 4;
  assert.ok(mean > 1000);
  for (const q of quadrants) assert.ok(Math.abs(q - mean) <= mean * 0.25, `quadrants ${quadrants.join(', ')}`);
  assert.ok(ms < 1500, `took ${ms} ms`);
  // The same input gives the same list.
  assert.deepEqual(scatterProps(layers, settingsOf(brush(200)), big, map, one).slice(0, 50), out.slice(0, 50));
});

test('a class whose estimate came in high is made again on its own: the other class stays thinned and single props stay', () => {
  const size = 2048;
  const big: BackgroundFrame = { cx: 750, cy: 750, extent: 1500, size };
  const layers = emptyLayers(size);
  // Far: a dense band down the left side (over a million candidates before the caps).
  for (let j = 0; j < size; j++) for (let i = 0; i < 512; i++) layers.props[j * size + i] = 1;
  // Near: a big painted patch that is all water, so the estimate counts it but nothing can stand there.
  for (let j = 683; j < 929; j++) for (let i = 683; i < 929; i++) { layers.props[j * size + i] = 1; layers.terrain[j * size + i] = WATER; }
  // Two one-cell dots on dry ground near the middle: one prop each.
  const dots = [[1000, 700], [1100, 1300]];
  for (const [i, j] of dots) layers.props[j * size + i] = 1;
  const map = { x0: 700, y0: 700, x1: 800, y1: 800 };
  const t0 = performance.now();
  const out = scatterProps(layers, settingsOf(brush(200)), big, map, one);
  const ms = performance.now() - t0;
  const near = out.filter((p) => !p.far), far = out.filter((p) => p.far);
  const cell = big.extent / size;
  for (const [i, j] of dots) {
    assert.ok(near.some((p) => Math.abs(p.x - (i + 0.5) * cell) < 1e-6 && Math.abs(p.y - (j + 0.5) * cell) < 1e-6), `dot ${i},${j} kept`);
  }
  assert.equal(near.length, dots.length);
  assert.ok(far.length <= MAX_IMPOSTORS && far.length > MAX_IMPOSTORS * 0.9, `far ${far.length}`);
  assert.ok(ms < 1500, `took ${ms} ms`);
});

/** A square of `cells` by `cells` cells with its top-left cell at (i0, j0). */
function square(layers: ReturnType<typeof emptyLayers>, i0: number, j0: number, cells: number): void {
  for (let j = j0; j < j0 + cells; j++) for (let i = i0; i < i0 + cells; i++) layers.props[j * 512 + i] = 1;
}

test('a spot just under the footprint area is one prop at its middle', () => {
  const layers = layersFor();
  square(layers, 100, 100, 7); // area 12.25 < 4 * 4
  const out = scatterProps(layers, settingsOf(brush(200)), frame, NO_MAP, () => 4);
  assert.equal(out.length, 1);
  assert.equal(out[0].x, 51.75);
  assert.equal(out[0].y, 51.75);
});

test('a spot just over with no grid point still gets one prop at its middle', () => {
  const layers = layersFor();
  square(layers, 100, 100, 8); // area 16, not under 4 * 4
  const out = scatterProps(layers, settingsOf(brush(0.1)), frame, NO_MAP, () => 4);
  assert.equal(out.length, 1);
  assert.equal(out[0].x, 52);
  assert.equal(out[0].y, 52);
});

test('a spot just over at high density has grid props only, no extra centroid prop', () => {
  const layers = layersFor();
  square(layers, 100, 100, 8);
  const out = scatterProps(layers, settingsOf(brush(200)), frame, NO_MAP, () => 4);
  assert.ok(out.length > 5);
  assert.ok(out.every((p) => p.x !== 52 || p.y !== 52));
});

test('a small spot whose middle is water puts its one prop on a dry cell of the spot', () => {
  const layers = layersFor();
  square(layers, 100, 100, 7);
  for (let j = 100; j < 107; j++) for (let i = 100; i < 105; i++) layers.terrain[j * 512 + i] = WATER;
  const out = scatterProps(layers, settingsOf(brush(20)), frame, NO_MAP, () => 4);
  assert.equal(out.length, 1);
  assert.ok(out[0].x >= 105 * 0.5 && out[0].x < 107 * 0.5 && out[0].y >= 50 && out[0].y < 53.5);
});

test('with no usable brush nothing is placed', () => {
  assert.deepEqual(scatterProps(layersFor(), settingsOf(brush(20)), frame, NO_MAP, () => 0), []);
});

test('a big forest is natural: uneven spacing, clumps and clearings, and the brush density holds', () => {
  const size = 1024;
  const f: BackgroundFrame = { cx: 128, cy: 128, extent: 256, size };
  const layers = emptyLayers(size);
  paint(layers, f, 20, 20, 220, 220, 1);
  const out = scatterProps(layers, settingsOf(brush(20)), f, NO_MAP, one);
  // Mean density: 200 x 200 squares at 20 per 100 squares.
  const expected = 200 * 200 * 20 / 100;
  assert.ok(Math.abs(out.length - expected) < expected * 0.1, `got ${out.length}, expected ${expected}`);
  // Nearest-neighbour distances (props well inside the forest) vary widely.
  const bucket = 4, buckets = new Map<number, number[]>();
  const key = (bx: number, by: number): number => by * 1000 + bx;
  out.forEach((p, i) => {
    const k = key(Math.floor(p.x / bucket), Math.floor(p.y / bucket));
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(i);
  });
  const nearest: number[] = [];
  for (const p of out) {
    if (p.x < 40 || p.x > 200 || p.y < 40 || p.y > 200) continue;
    let best = Infinity;
    const bx = Math.floor(p.x / bucket), by = Math.floor(p.y / bucket);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) for (const i of buckets.get(key(bx + dx, by + dy)) ?? []) {
      const q = out[i];
      if (q !== p) best = Math.min(best, Math.hypot(q.x - p.x, q.y - p.y));
    }
    nearest.push(best);
  }
  const mean = nearest.reduce((a, b) => a + b, 0) / nearest.length;
  const sd = Math.sqrt(nearest.reduce((a, b) => a + (b - mean) ** 2, 0) / nearest.length);
  console.log(`nearest-neighbour CV ${(sd / mean).toFixed(3)}`);
  assert.ok(sd / mean > 0.35, `CV ${sd / mean}`);
  // Local density: counts in 8 x 8 blocks spread far more than an even grid (variance above the mean, as for random scatter; an even grid is far below it).
  const counts: number[] = [];
  for (let by = 24; by < 216; by += 8) for (let bx = 24; bx < 216; bx += 8) {
    counts.push(out.filter((p) => p.x >= bx && p.x < bx + 8 && p.y >= by && p.y < by + 8).length);
  }
  const cm = counts.reduce((a, b) => a + b, 0) / counts.length;
  const cv = counts.reduce((a, b) => a + (b - cm) ** 2, 0) / counts.length;
  console.log(`block counts mean ${cm.toFixed(2)} variance ${cv.toFixed(2)}`);
  assert.ok(cv > cm * 1.6, `variance ${cv} vs mean ${cm}`);
  assert.deepEqual(out, scatterProps(layers, settingsOf(brush(20)), f, NO_MAP, one));
});
