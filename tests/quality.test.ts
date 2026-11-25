import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDGE_SHARE, MAX_SEE_THROUGH_SIZE, MIN_SEE_THROUGH_SIZE, postFxOn, QUALITY, ResolutionGovernor, readEdges, readLayerLook, readQuality, readSeeThroughSize, withLooks } from '../src/board/quality';

test('quality presets go from cheap to sharp, and carry no sight settings (sight follows Atlas)', () => {
  assert.deepEqual(QUALITY.low, { maxPixelRatio: 1, minPixelRatio: 0.6, antialias: false, shadowMapSize: 1024, miniShadows: 'blob', lightShadows: 0, displaceCuts: 0, tiltShift: false, occlusion: false, grade: false, halo: false, painted: false, sky: 'dusk', edges: 'soft', seeThrough: false, seeThroughSize: 1.2, layerLook: 'solid', layerTick: 2 });
  assert.deepEqual(QUALITY.medium, { maxPixelRatio: 1.5, minPixelRatio: 0.75, antialias: true, shadowMapSize: 2048, miniShadows: 'blob', lightShadows: 2, displaceCuts: 8, tiltShift: false, occlusion: false, grade: false, halo: false, painted: false, sky: 'dusk', edges: 'soft', seeThrough: false, seeThroughSize: 1.2, layerLook: 'solid', layerTick: 2 });
  assert.deepEqual(QUALITY.high, { maxPixelRatio: 2, minPixelRatio: 1, antialias: true, shadowMapSize: 4096, miniShadows: 'real', lightShadows: 4, displaceCuts: 16, tiltShift: false, occlusion: false, grade: false, halo: false, painted: false, sky: 'dusk', edges: 'soft', seeThrough: false, seeThroughSize: 1.2, layerLook: 'solid', layerTick: 2 });
  assert.equal(readQuality('high'), 'high');
  assert.equal(readQuality('ultra'), 'medium');
  assert.equal(readQuality(undefined), 'medium');
});

const run = (governor: ResolutionGovernor, dt: number, seconds: number): number[] => {
  const changes: number[] = [];
  for (let t = 0; t < seconds; t += dt) {
    const next = governor.sample(dt);
    if (next !== null) changes.push(next);
  }
  return changes;
};

test('the resolution starts at the preset\'s best the screen allows', () => {
  assert.equal(new ResolutionGovernor(QUALITY.medium, 2).ratio, 1.5);
  assert.equal(new ResolutionGovernor(QUALITY.high, 1.25).ratio, 1.25);
});

test('slow frames lower the resolution step by step, down to the preset\'s floor', () => {
  const governor = new ResolutionGovernor(QUALITY.medium, 2);
  const changes = run(governor, 1 / 20, 10);
  assert.deepEqual(changes, [1.25, 1, 0.75]);
  assert.equal(governor.ratio, 0.75);
});

test('fast frames raise it again, up to the preset\'s best', () => {
  const governor = new ResolutionGovernor(QUALITY.medium, 2);
  run(governor, 1 / 20, 10);
  const changes = run(governor, 1 / 60, 30);
  assert.deepEqual(changes, [1, 1.25, 1.5]);
});

test('a gap between frames (the board was idle) is not a slow frame', () => {
  const governor = new ResolutionGovernor(QUALITY.medium, 2);
  assert.deepEqual(run(governor, 2, 20), []);
  assert.equal(governor.ratio, 1.5);
});

test('a steady 45 fps changes nothing', () => {
  const governor = new ResolutionGovernor(QUALITY.medium, 2);
  assert.deepEqual(run(governor, 1 / 45, 20), []);
});

test('wall edges: read from a saved value, soft when unknown, and a looks change of them makes a new preset', () => {
  assert.equal(readEdges('round'), 'round');
  assert.equal(readEdges('nonsense'), 'soft');
  const looks = { tiltShift: false, occlusion: false, painted: false, sky: 'dusk' as const };
  assert.equal(withLooks(QUALITY.medium, { ...looks, edges: 'soft' }), QUALITY.medium);
  assert.equal(withLooks(QUALITY.medium, looks), QUALITY.medium);
  assert.equal(withLooks(QUALITY.medium, { ...looks, edges: 'round' }).edges, 'round');
  assert.ok(EDGE_SHARE.sharp < EDGE_SHARE.soft && EDGE_SHARE.soft < EDGE_SHARE.round);
});

test('the look of an upper layer is read back as stored, and anything else is solid', () => {
  for (const look of ['solid', 'faded', 'transparent'] as const) assert.equal(readLayerLook(look), look);
  for (const bad of [undefined, null, 'hidden', 3]) assert.equal(readLayerLook(bad), 'solid');
  assert.equal(withLooks(QUALITY.medium, { tiltShift: false, occlusion: false, painted: false, sky: 'dusk', layerLook: 'faded' }).layerLook, 'faded');
});

test('see-through window size clamps between 0.5 and 8 squares', () => {
  assert.equal(MIN_SEE_THROUGH_SIZE, 0.5);
  assert.equal(MAX_SEE_THROUGH_SIZE, 8);
  assert.equal(readSeeThroughSize(0.1), 0.5);
  assert.equal(readSeeThroughSize(6.5), 6.5);
  assert.equal(readSeeThroughSize(12), 8);
  assert.equal(readSeeThroughSize(undefined), 1.2);
});

test('the cinematic grade and the flame halo are own settings: off in every preset, kept by withLooks, the grade needing the post-processing', () => {
  for (const preset of Object.values(QUALITY)) { assert.equal(preset.grade, false); assert.equal(preset.halo, false); }
  const looks = { tiltShift: false, occlusion: false, painted: false, sky: 'dusk' as const };
  assert.equal(withLooks(QUALITY.high, looks), QUALITY.high);
  const both = withLooks(QUALITY.high, { ...looks, grade: true, halo: true });
  assert.equal(both.grade, true);
  assert.equal(both.halo, true);
  assert.equal(postFxOn(both), true);
  assert.equal(postFxOn(withLooks(QUALITY.high, { ...looks, halo: true })), false);
  assert.equal(postFxOn(withLooks(QUALITY.high, { ...looks, occlusion: true })), true);
});
