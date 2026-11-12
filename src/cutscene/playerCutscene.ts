/**
 * A cutscene as one player's board lives it: the fade in, the picture of the run (with the pause that a map still being
 * loaded puts on it), the fade out and the moment the player's own scene and camera must come back. Pure, so it is
 * tested without a board: time comes in as arguments, and the board tells it when a scene has been drawn.
 */

import type { BoardCutscene } from '../connectContract';
import { CutscenePlayback } from './playback';
import { enterLeave, type CameraAt } from './timeline';
import type { Cutscene } from './cutsceneData';

/** What the board shows at a moment of the run. */
export interface PlayerCutsceneView {
  /** `'own'`: the player's own scene; else the key of the cutscene scene to show. */
  show: 'own' | string;
  /** The player's camera and tokens are not theirs to move: from the start of the run until the fade out is done. */
  locked: boolean;
  /** How black the picture is, 0 clear to 1 black. */
  black: number;
  /** Prepared runs: the camera of the run (its `mapPath` is the key of the scene it looks at); null in a live run and while the own scene shows. */
  camera: CameraAt | null;
  /** True once, at the leave fade's black: the own scene and camera must come back now. */
  restore: boolean;
}

const IDLE: PlayerCutsceneView = { show: 'own', locked: false, black: 0, camera: null, restore: false };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** The prepared shots as the playback takes them, with each map key standing where a vault path stands. */
function playableOf(c: BoardCutscene): Cutscene {
  return {
    id: c.runId,
    name: '',
    shots: c.shots.map((shot, i) => ({ id: `s${i}`, at: shot.at, mapPath: shot.key, eye: { ...shot.eye }, target: { ...shot.target }, keyframe: shot.keyframe, transition: shot.transition })),
  };
}

export class PlayerCutsceneState {
  private phase: 'idle' | 'in' | 'run' | 'out' = 'idle';
  private c: BoardCutscene | null = null;
  private playback: CutscenePlayback | null = null;
  private startMs = 0;
  /** The fade in cannot begin before this moment (the first half of the enter fade, when there is one). */
  private floor = 0;
  /** The scene the board has drawn, and when it said so; null while it has drawn none of this run's. */
  private arrived: string | null = null;
  private arrivedAt = 0;
  /** The time the run has spent waiting for a scene: the playback's clock is the board's less this. */
  private lag = 0;
  private holding = false;
  private lastNow: number | null = null;
  private lastShow: 'own' | string = 'own';
  private lastBlack = 0;
  private outMs = 0;
  private outFrom = 0;
  private restored = false;

  /** Whether a run has the player's board (until the leave fade is done). */
  get active(): boolean {
    return this.phase !== 'idle';
  }

  /** Whether the run is being left (the leave fade is under way). */
  get leaving(): boolean {
    return this.phase === 'out';
  }

  /**
   * News of the run: it starts, takes a step, changes scene (live), or (null) ends. `startBlack`: the board is already
   * away from the player's own scene (Connect made it for the run), or never showed it: no fade from it.
   */
  cutscene(c: BoardCutscene | null, nowMs: number, startBlack = false): void {
    if (c === null) {
      this.leave(nowMs);
      return;
    }
    if (this.phase === 'out') return;
    if (this.phase === 'idle' || c.runId !== this.c?.runId) {
      this.begin(c, nowMs, startBlack || this.phase !== 'idle');
      return;
    }
    this.c = c;
    this.playback?.follow(c.step.shot, c.step.seq, nowMs - this.lag);
  }

  /** The board has drawn the scene of `key` (its map image in place). */
  sceneArrived(key: string): void {
    if (this.arrived === key) return;
    this.arrived = key;
    this.arrivedAt = this.lastNow ?? 0;
  }

  /** The connection is gone: the run ends as if the GM had ended it. */
  disconnected(nowMs: number): void {
    this.leave(nowMs);
  }

  private begin(c: BoardCutscene, nowMs: number, black: boolean): void {
    this.c = c;
    this.phase = black ? 'run' : 'in';
    this.startMs = nowMs;
    this.floor = black ? 0 : nowMs + c.look.fadeMs;
    this.arrived = null;
    this.arrivedAt = 0;
    this.lag = 0;
    this.holding = false;
    this.restored = false;
    this.lastNow = nowMs;
    this.lastShow = black ? c.key : 'own';
    this.lastBlack = black ? 1 : 0;
    this.playback = null;
    if (c.mode === 'prepared' && c.shots.length > 0) {
      this.playback = new CutscenePlayback(playableOf(c), c.step.shot);
      this.playback.seek(c.step.shot, c.step.seq);
    }
  }

  private leave(nowMs: number): void {
    if (this.phase === 'idle' || this.phase === 'out') return;
    this.phase = 'out';
    this.outMs = nowMs;
    this.outFrom = this.lastBlack;
    this.restored = false;
  }

  /** The picture of the run now: the camera, the scene it wants and how black it is. */
  private running(nowMs: number): { show: string; camera: CameraAt | null; black: number } {
    const c = this.c!;
    const frame = this.playback ? this.playback.frame(nowMs - this.lag) : null;
    const show = frame ? frame.mapPath : c.key;
    // The scene is not drawn yet: black, and a prepared run waits for it rather than playing on unseen.
    const held = this.arrived !== show;
    this.holding = held && this.playback !== null;
    const ramp = held ? 1 : clamp01(1 - (nowMs - Math.max(this.arrivedAt, this.floor)) / c.look.fadeMs);
    const black = Math.max(ramp, frame?.black ?? 0);
    return { show, camera: frame ? { eye: frame.eye, target: frame.target, mapPath: frame.mapPath, black } : null, black };
  }

  view(nowMs: number): PlayerCutsceneView {
    const c = this.c;
    if (this.phase === 'idle' || !c) return IDLE;
    if (this.holding) this.lag += Math.max(0, nowMs - (this.lastNow ?? nowMs));
    this.lastNow = nowMs;
    const fade = c.look.fadeMs;
    if (this.phase === 'out') {
      const e = Math.max(0, nowMs - this.outMs);
      const swapped = e >= fade;
      const restore = swapped && !this.restored;
      if (restore) this.restored = true;
      if (e >= 2 * fade) {
        this.phase = 'idle';
        this.c = null;
        this.playback = null;
        return { ...IDLE, restore };
      }
      if (swapped) {
        this.lastShow = 'own';
        return { show: 'own', locked: true, black: enterLeave(e, fade).black, camera: null, restore };
      }
      const run = this.lastShow === 'own' ? null : this.running(nowMs);
      return { show: run?.show ?? 'own', locked: true, black: this.outFrom + (1 - this.outFrom) * (e / fade), camera: run?.camera ?? null, restore: false };
    }
    if (this.phase === 'in') {
      const e = nowMs - this.startMs;
      if (e < fade) {
        this.lastShow = 'own';
        this.lastBlack = enterLeave(e, fade).black;
        return { show: 'own', locked: true, black: this.lastBlack, camera: null, restore: false };
      }
      this.phase = 'run';
    }
    const run = this.running(nowMs);
    this.lastShow = run.show;
    this.lastBlack = run.black;
    return { show: run.show, locked: true, black: run.black, camera: run.camera, restore: false };
  }
}
