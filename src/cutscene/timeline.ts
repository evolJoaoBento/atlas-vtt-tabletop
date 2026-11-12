/**
 * The maths of a cutscene run: which shots it rests on, the legs between them, and where the camera is (and how black
 * the picture is) at a moment of a leg. Pure, so it is tested without a board.
 */

import { smoother } from '../board/camera';
import type { Cutscene, Transition, Vec3 } from './cutsceneData';

/** The shots the run rests on: every one that is not a keyframe, and always the first and the last. */
export function stopsOf(c: Cutscene): number[] {
  const last = c.shots.length - 1;
  return c.shots.map((shot, i) => i).filter((i) => i === 0 || i === last || !c.shots[i].keyframe);
}

/** One step of a run, from a shot to the next. */
export interface Leg {
  from: number;
  to: number;
  transition: Transition;
  /** Time between the two shots; a cut takes none. */
  ms: number;
}

/** One leg per consecutive pair of shots from `from` up to `to`. */
export function legsBetween(c: Cutscene, from: number, to: number): Leg[] {
  const legs: Leg[] = [];
  for (let i = from; i < to; i++) {
    const transition = c.shots[i + 1].transition;
    legs.push({ from: i, to: i + 1, transition, ms: transition === 'cut' ? 0 : c.shots[i + 1].at - c.shots[i].at });
  }
  return legs;
}

/** Where the camera is, which map it looks at, and how black the picture is (0 clear, 1 black). */
export interface CameraAt {
  eye: Vec3;
  target: Vec3;
  mapPath: string;
  black: number;
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** Linear blend of `a` at time `ta` and `b` at `tb`, read at `t`; a span of no length is just `a`. */
function blend(a: Vec3, b: Vec3, ta: number, tb: number, t: number): Vec3 {
  return tb === ta ? a : lerp3(a, b, (t - ta) / (tb - ta));
}

/**
 * A centripetal Catmull-Rom segment between p1 and p2 (p0 and p3 are their neighbours), at `u` from 0 to 1 along it.
 * Centripetal keeps the path from looping or overshooting where the points are unevenly spread.
 */
function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, u: number): Vec3 {
  const step = (a: Vec3, b: Vec3): number => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  const t0 = 0;
  const t1 = t0 + step(p0, p1);
  const t2 = t1 + step(p1, p2);
  const t3 = t2 + step(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = blend(p0, p1, t0, t1, t);
  const a2 = blend(p1, p2, t1, t2, t);
  const a3 = blend(p2, p3, t2, t3, t);
  const b1 = blend(a1, a2, t0, t2, t);
  const b2 = blend(a2, a3, t1, t3, t);
  return blend(b1, b2, t1, t2, t);
}

/** A path through points with the end points doubled, read at `index` (the segment) and `u` along it. */
function pathAt(points: Vec3[], index: number, u: number): Vec3 {
  const padded = [points[0], ...points, points[points.length - 1]];
  return catmullRom(padded[index], padded[index + 1], padded[index + 2], padded[index + 3], u);
}

/**
 * The camera `elapsedMs` into a run of legs. A run of consecutive moves is one eased path through every shot of it;
 * a fade goes to black, jumps at the middle and comes back; a cut jumps at once. `done` once every leg has played.
 */
export function sampleLegs(c: Cutscene, legs: Leg[], elapsedMs: number): { at: CameraAt; done: boolean } {
  const poseOf = (shot: number, black = 0): CameraAt => ({ eye: c.shots[shot].eye, target: c.shots[shot].target, mapPath: c.shots[shot].mapPath, black });
  if (legs.length === 0) return { at: poseOf(0), done: true };
  const elapsed = Math.max(0, elapsedMs);
  let current = poseOf(legs[0].from);
  let start = 0;
  let i = 0;
  while (i < legs.length) {
    const leg = legs[i];
    if (leg.transition === 'move') {
      let end = i;
      while (end + 1 < legs.length && legs[end + 1].transition === 'move') end++;
      const run = legs.slice(i, end + 1);
      const total = run.reduce((sum, l) => sum + l.ms, 0);
      if (elapsed < start + total) {
        const s = smoother((elapsed - start) / total) * total;
        let into = 0;
        let before = 0;
        while (into < run.length - 1 && s >= before + run[into].ms) before += run[into++].ms;
        const u = run[into].ms === 0 ? 0 : Math.min(1, (s - before) / run[into].ms);
        const shots = [run[0].from, ...run.map((l) => l.to)].map((n) => c.shots[n]);
        return { at: { eye: pathAt(shots.map((s2) => s2.eye), into, u), target: pathAt(shots.map((s2) => s2.target), into, u), mapPath: c.shots[run[0].from].mapPath, black: 0 }, done: false };
      }
      start += total;
      current = poseOf(run[run.length - 1].to);
      i = end + 1;
      continue;
    }
    if (leg.transition === 'fade' && leg.ms > 0) {
      if (elapsed < start + leg.ms) {
        const u = (elapsed - start) / leg.ms;
        return { at: poseOf(u < 0.5 ? leg.from : leg.to, 1 - Math.abs(1 - 2 * u)), done: false };
      }
      start += leg.ms;
    }
    current = poseOf(leg.to);
    i++;
  }
  return { at: current, done: true };
}

/** A fade into a cutscene (or out of it): black ramps up over `fadeMs`, the view swaps, then black ramps down. */
export function enterLeave(elapsedMs: number, fadeMs: number): { black: number; swapped: boolean; done: boolean } {
  const e = Math.max(0, elapsedMs);
  if (e < fadeMs) return { black: e / fadeMs, swapped: false, done: false };
  if (e < 2 * fadeMs) return { black: 1 - (e - fadeMs) / fadeMs, swapped: true, done: false };
  return { black: 0, swapped: true, done: true };
}

/** One frame of a camera that eases towards a goal: `tauMs` is the time it takes to cover 63% of the way. */
export function smoothFollow(current: { eye: Vec3; target: Vec3 }, goal: { eye: Vec3; target: Vec3 }, dtMs: number, tauMs = 150): { eye: Vec3; target: Vec3 } {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return { eye: lerp3(current.eye, goal.eye, k), target: lerp3(current.target, goal.target, k) };
}
