import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LASER, LASER_COLORS, LASER_FADE_MS, LaserTrail, beamWidth, resolveLaser, smoothBeam } from '../src/board/laser';

test('laser settings: Atlas\'s eight colours, size from 8 to 100, red 16 by default', () => {
  assert.equal(LASER_COLORS.length, 8);
  assert.deepEqual(DEFAULT_LASER, { color: '#ff0059', size: 16 });
  assert.deepEqual(resolveLaser({ color: '#00a9ff', size: 40 }), { color: '#00a9ff', size: 40 });
  assert.deepEqual(resolveLaser({ color: 'red', size: 500 }), { color: '#ff0059', size: 100 });
  assert.deepEqual(resolveLaser({ size: 1 }), { color: '#ff0059', size: 8 });
  assert.deepEqual(resolveLaser(undefined), DEFAULT_LASER);
});

test('the beam\'s width in screen pixels: a solid body and a glow that stops growing', () => {
  const small = beamWidth(16);
  assert.ok(Math.abs(small.halfWidth - (16 * 0.35 + 16 * 1.15)) < 1e-9);
  assert.ok(Math.abs(small.bodyShare - (16 * 0.35) / small.halfWidth) < 1e-9);
  assert.ok(Math.abs(beamWidth(100).halfWidth - (35 + 40)) < 1e-9);
});

test('the trail keeps what the pointer drew for 0.8 s, fading, at most 100 points', () => {
  const trail = new LaserTrail();
  trail.add(0, 0, 0, 1);
  trail.add(10, 0, 400, 1);
  // Too close to the last point: skipped.
  trail.add(10.5, 0, 410, 1);
  let points = trail.points(400);
  assert.deepEqual(points.map((p) => [p.x, p.life]), [[0, 0.5], [10, 1]]);
  points = trail.points(900);
  assert.deepEqual(points.map((p) => p.x), [10]);
  assert.equal(trail.alive(400 + LASER_FADE_MS + 1), false);
  for (let i = 0; i < 150; i++) trail.add(i * 10, 0, 1000, 1);
  assert.equal(trail.points(1000).length, 100);
});

test('the beam is smoothed into a curve through the points, its life carried along', () => {
  const smooth = smoothBeam([{ x: 0, y: 0, life: 0.2 }, { x: 30, y: 30, life: 0.6 }, { x: 60, y: 0, life: 1 }], 3);
  assert.ok(smooth.length > 10);
  assert.deepEqual(smooth[0], { x: 0, y: 0, life: 0.2 });
  assert.deepEqual(smooth.at(-1), { x: 60, y: 0, life: 1 });
  assert.ok(smooth.every((p, i) => i === 0 || p.life >= smooth[i - 1]!.life));
  // Two points or fewer are left as they are.
  assert.equal(smoothBeam([{ x: 0, y: 0, life: 1 }, { x: 5, y: 0, life: 1 }], 3).length, 2);
});
