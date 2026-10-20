import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QUALITY, ResolutionGovernor, readQuality } from '../src/board/quality';

test('quality presets go from cheap to sharp', () => {
  assert.deepEqual(QUALITY.low, { maxPixelRatio: 1, minPixelRatio: 0.6, antialias: false, shadowMapSize: 1024, miniShadows: 'blob' });
  assert.deepEqual(QUALITY.medium, { maxPixelRatio: 1.5, minPixelRatio: 0.75, antialias: true, shadowMapSize: 2048, miniShadows: 'blob' });
  assert.deepEqual(QUALITY.high, { maxPixelRatio: 2, minPixelRatio: 1, antialias: true, shadowMapSize: 4096, miniShadows: 'real' });
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
