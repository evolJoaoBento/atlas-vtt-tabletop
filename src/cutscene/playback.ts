/**
 * The state of one run of a cutscene: where it rests, the transition under way, and the counter that lets a player's
 * copy follow the GM's. Time comes in as arguments, so it is tested without a clock.
 */

import type { Cutscene } from './cutsceneData';
import { legsBetween, sampleLegs, stopsOf, type CameraAt, type Leg } from './timeline';

export class CutscenePlayback {
  readonly cutscene: Cutscene;
  private readonly stops: number[];
  /** The shot the run rests on (or last rested on, while a transition is under way). */
  private rest: number;
  private active: { legs: Leg[]; startMs: number; to: number } | null = null;
  private counter = 0;

  /** Rests on `startShot`, keyframe or not (a preview from there). */
  constructor(c: Cutscene, startShot = 0) {
    if (c.shots.length === 0) throw new Error('A cutscene with no shots cannot be played.');
    this.cutscene = c;
    this.stops = stopsOf(c);
    this.rest = Math.min(c.shots.length - 1, Math.max(0, startShot));
  }

  /** The shot rested on, or headed to. */
  get shot(): number {
    return this.active ? this.active.to : this.rest;
  }

  /** +1 on every next, previous or seek: how a copy of this run tells which state is newer. */
  get seq(): number {
    return this.counter;
  }

  /** Whether a transition is under way (as of the last `frame`). */
  get playing(): boolean {
    return this.active !== null;
  }

  private nextStop(): number | undefined {
    return this.stops.find((stop) => stop > this.shot);
  }

  /** Finishes the transition under way at once. */
  private settle(): void {
    if (!this.active) return;
    this.rest = this.active.to;
    this.active = null;
  }

  /** Plays on to the next stop, finishing any transition still under way first; `'ended'` from the last shot. */
  next(nowMs: number): 'playing' | 'ended' {
    this.settle();
    const to = this.nextStop();
    if (to === undefined) return 'ended';
    this.active = { legs: legsBetween(this.cutscene, this.rest, to), startMs: nowMs, to };
    this.counter++;
    return 'playing';
  }

  /** A cut to the previous stop; false at the first. */
  previous(_nowMs: number): boolean {
    const here = this.shot;
    const to = [...this.stops].reverse().find((stop) => stop < here);
    if (to === undefined) return false;
    this.active = null;
    this.rest = to;
    this.counter++;
    return true;
  }

  /** Rests on a shot with no transition (joining a run part-way), and takes the sequence number given. */
  seek(shot: number, seq: number): void {
    this.active = null;
    this.rest = Math.min(this.cutscene.shots.length - 1, Math.max(0, shot));
    this.counter = seq;
  }

  /** The player's copy following the GM's: the next stop plays like `next`, anything else seeks; stale news is ignored. */
  follow(shot: number, seq: number, nowMs: number): void {
    if (seq <= this.counter) return;
    if (this.nextStop() === shot) {
      this.next(nowMs);
      this.counter = seq;
    } else this.seek(shot, seq);
  }

  /** The camera at `nowMs`, and whether it rests (no transition under way). */
  frame(nowMs: number): CameraAt & { resting: boolean } {
    const active = this.active;
    if (active) {
      const { at, done } = sampleLegs(this.cutscene, active.legs, nowMs - active.startMs);
      if (!done) return { ...at, resting: false };
      this.settle();
    }
    const shot = this.cutscene.shots[this.rest];
    return { eye: shot.eye, target: shot.target, mapPath: shot.mapPath, black: 0, resting: true };
  }
}
