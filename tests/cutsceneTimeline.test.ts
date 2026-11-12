import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cutscene, Shot } from '../src/cutscene/cutsceneData';
import { enterLeave, legsBetween, sampleLegs, smoothFollow, smoothFollowTwice, stopsOf } from '../src/cutscene/timeline';

const shot = (id: string, at: number, mapPath: string, n: number, extra: Partial<Shot> = {}): Shot => ({
  id, at, mapPath, eye: { x: n * 3, y: 5 + n * n, z: n * 0.5 }, target: { x: n, y: 0, z: n * 2 }, keyframe: false, transition: 'fade', ...extra,
});
const fixture = (): Cutscene => ({
  id: 'c', name: 'n',
  shots: [
    shot('A', 0, 'a', 0),
    shot('B', 1000, 'a', 1, { keyframe: true, transition: 'move' }),
    shot('C', 2000, 'a', 2, { transition: 'move' }),
    shot('D', 3000, 'b', 3, { transition: 'fade' }),
    shot('E', 3600, 'b', 4, { transition: 'cut' }),
  ],
});
const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('stopsOf: non-keyframes plus the first and last', () => {
  const c = fixture();
  assert.deepEqual(stopsOf(c), [0, 2, 3, 4]);
  c.shots[4].keyframe = true;
  assert.deepEqual(stopsOf(c), [0, 2, 3, 4]);
  c.shots[0].keyframe = true;
  assert.deepEqual(stopsOf(c), [0, 2, 3, 4]);
});

test('legsBetween: one leg per pair, a cut takes no time', () => {
  const c = fixture();
  assert.deepEqual(legsBetween(c, 0, 2).map((l) => l.ms), [1000, 1000]);
  assert.deepEqual(legsBetween(c, 3, 4), [{ from: 3, to: 4, transition: 'cut', ms: 0 }]);
});

test('sampleLegs: a move run is one path through the keyframes', () => {
  const c = fixture();
  const legs = legsBetween(c, 0, 2);
  const start = sampleLegs(c, legs, 0);
  assert.deepEqual(start.at.eye, c.shots[0].eye);
  assert.equal(start.done, false);
  const mid = sampleLegs(c, legs, 1000);
  near(mid.at.eye.x, c.shots[1].eye.x);
  near(mid.at.eye.y, c.shots[1].eye.y);
  near(mid.at.eye.z, c.shots[1].eye.z);
  near(mid.at.target.x, c.shots[1].target.x);
  const end = sampleLegs(c, legs, 2000);
  assert.deepEqual(end.at.eye, c.shots[2].eye);
  assert.equal(end.done, true);
  assert.equal(end.at.black, 0);
  const quarter = sampleLegs(c, legs, 500);
  assert.ok(quarter.at.eye.x > 0 && quarter.at.eye.x < c.shots[1].eye.x + 1e-9);
});

test('sampleLegs: a fade goes black, jumps at the middle and clears', () => {
  const c = fixture();
  const legs = legsBetween(c, 2, 3);
  const first = sampleLegs(c, legs, 250);
  near(first.at.black, 0.5);
  assert.equal(first.at.mapPath, 'a');
  const second = sampleLegs(c, legs, 750);
  near(second.at.black, 0.5);
  assert.equal(second.at.mapPath, 'b');
  assert.equal(sampleLegs(c, legs, 500).at.black, 1);
  const end = sampleLegs(c, legs, 1000);
  assert.equal(end.at.black, 0);
  assert.equal(end.done, true);
  assert.equal(end.at.mapPath, 'b');
});

test('sampleLegs: a cut is at once, and the legs after a move still play', () => {
  const c = fixture();
  const cut = sampleLegs(c, legsBetween(c, 3, 4), 0);
  assert.equal(cut.done, true);
  assert.deepEqual(cut.at.eye, c.shots[4].eye);
  const long = legsBetween(c, 0, 4);
  assert.equal(sampleLegs(c, long, 2000 + 250).at.black, 0.5);
  assert.equal(sampleLegs(c, long, 3600).done, true);
});

test('sampleLegs copes with shots that share a pose', () => {
  const c = fixture();
  c.shots[1].eye = c.shots[0].eye;
  const at = sampleLegs(c, legsBetween(c, 0, 2), 300).at;
  assert.ok(Number.isFinite(at.eye.x) && Number.isFinite(at.target.y));
});

test('enterLeave ramps up, swaps, ramps down', () => {
  assert.deepEqual(enterLeave(300, 600), { black: 0.5, swapped: false, done: false });
  assert.deepEqual(enterLeave(600, 600), { black: 1, swapped: true, done: false });
  assert.deepEqual(enterLeave(1200, 600), { black: 0, swapped: true, done: true });
});

test('smoothFollow covers 63.2% in one tau', () => {
  const out = smoothFollow({ eye: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }, { eye: { x: 10, y: 0, z: 0 }, target: { x: 0, y: 20, z: 0 } }, 150, 150);
  near(out.eye.x, 6.32, 0.01);
  near(out.target.y, 12.64, 0.02);
  const same = smoothFollow({ eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } }, { eye: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } }, 0);
  assert.deepEqual(same.eye, { x: 1, y: 2, z: 3 });
});

test('smoothFollowTwice keeps the speed even when the goal arrives ten times a second, and settles on the goal without overshoot', () => {
  const at = (x: number): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } => ({ eye: { x, y: 0, z: 0 }, target: { x, y: 0, z: 0 } });
  const speeds = (follow: (state: { mid: ReturnType<typeof at>; current: ReturnType<typeof at> }, goal: ReturnType<typeof at>, dt: number) => { mid: ReturnType<typeof at>; current: ReturnType<typeof at> }): number[] => {
    let state = { mid: at(0), current: at(0) };
    let goal = at(0);
    let lastX = 0;
    const out: number[] = [];
    for (let t = 0; t < 4000; t += 16) {
      if (t % 96 < 16) goal = at(40 * (t / 1000));
      state = follow(state, goal, 16);
      if (t > 1500) out.push((state.current.eye.x - lastX) / 0.016);
      lastX = state.current.eye.x;
    }
    return out;
  };
  const twice = speeds((s, g, dt) => smoothFollowTwice(s, g, dt));
  const once = speeds((s, g, dt) => ({ mid: s.mid, current: smoothFollow(s.current, g, dt) }));
  const ratio = (v: number[]): number => Math.max(...v) / Math.min(...v);
  assert.ok(ratio(twice) < 1.3, `two eases: ${ratio(twice)}`);
  assert.ok(ratio(once) > 1.5, `one ease: ${ratio(once)}`);
  // A goal that stops: the camera arrives and never goes past it.
  let state = { mid: at(0), current: at(0) };
  let peak = 0;
  for (let t = 0; t < 3000; t += 16) {
    state = smoothFollowTwice(state, at(10), 16);
    peak = Math.max(peak, state.current.eye.x);
  }
  near(state.current.eye.x, 10, 1e-3);
  assert.ok(peak <= 10 + 1e-9);
});

test('a zero-ms fade leg acts as a cut', () => {
  const c = fixture();
  const out = sampleLegs(c, [{ from: 0, to: 1, transition: 'fade', ms: 0 }], 0);
  assert.equal(out.done, true);
  assert.equal(out.at.black, 0);
  assert.deepEqual(out.at.eye, c.shots[1].eye);
  assert.deepEqual(out.at.target, c.shots[1].target);
});

test('shots that share a pose give the exact pose along the path', () => {
  const c = fixture();
  c.shots[1].eye = { ...c.shots[0].eye };
  c.shots[1].target = { ...c.shots[0].target };
  const legs = legsBetween(c, 0, 2);
  const mid = sampleLegs(c, legs, 300).at;
  assert.deepEqual(mid.eye, c.shots[0].eye);
  assert.deepEqual(mid.target, c.shots[0].target);
  const atB = sampleLegs(c, legs, 1000).at;
  near(atB.eye.x, c.shots[1].eye.x);
  near(atB.eye.y, c.shots[1].eye.y);
  near(atB.target.z, c.shots[1].target.z);
  const end = sampleLegs(c, legs, 2000);
  assert.equal(end.done, true);
  assert.deepEqual(end.at.eye, c.shots[2].eye);
});
