/**
 * A cutscene run for players, from the GM's board: prepared (the shots play on the GM's board and Connect is told each
 * step) or live (the players follow the GM's own camera). It owns the board's role, driver, bars and reveal for its
 * length, switches the GM board's map for shots on other maps, and tells `publish` what players are to see. The channel
 * below is what `api.cutscene` is made of: it holds the one run Connect reads.
 */

import type { Board } from '../board/board';
import type { CameraKeep } from '../board/camera';
import type { CutsceneSource, GmCutscene } from '../connectContract';
import { broadcastOf } from './broadcast';
import type { CinematicSettings } from './cinematicSettings';
import { limitProblem, mapOfPlace, placed, placeOf, type Cutscene, type Vec3 } from './cutsceneData';
import type { CinematicDriver } from './drivenView';
import { CutscenePlayback } from './playback';
import type { StudioHost } from './studio';
import { enterLeave } from './timeline';
import { mapLabel } from './timelineView';

/** Where a run is: fading in, resting or moving between shots, or fading out. */
type Phase = 'entering' | 'playing' | 'leaving';

interface Pose { eye: Vec3; target: Vec3 }

/** One run under way. */
interface Active {
  mode: 'prepared' | 'live';
  runId: string;
  /** The place the GM board was on (the cutscene's own map, at the level shown): the run ends back on it. */
  home: string;
  keep: CameraKeep;
  /** The settings at the start: a change while it runs does not alter it. */
  settings: CinematicSettings;
  cutscene: Cutscene | null;
  playback: CutscenePlayback | null;
  driver: CinematicDriver | null;
  phase: Phase;
  /** The run's own clock, in milliseconds; it stands still while a map is being loaded. */
  clock: number;
  lastNow: number | null;
  phaseStart: number;
  /** A map is being switched to: the clock waits and the picture stays black. */
  switching: boolean;
  /** Maps that could not be shown; the run goes on over the map at hand. */
  failed: Set<string>;
  /** The GM's camera when the run began: what the fade in starts from and the fade out ends on. */
  startPose: Pose;
  /** The last picture before the fade out. */
  frozen: Pose;
  leaveSwap: boolean;
  /** The step counter players see: 1 at the start, +1 for each news. */
  seq: number;
  /** The places keyed so far, in key order: a place keeps its key for the whole run (live: one not seen before takes the next). */
  keyed: string[];
  /** The place the last live publish named. */
  livePath: string;
}

const newRunId = (): string => `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class CutsceneRun {
  private active: Active | null = null;

  /**
   * `publish` hears the run for players (null when it is over); `changed` hears every change the controls show (it
   * started, took a step, is fading out, is over).
   */
  constructor(private readonly host: StudioHost, private readonly publish: (run: GmCutscene | null) => void, private readonly changed: () => void = () => {}) {}

  /** Whether a run is under way (a fade out still counts: nothing else may start until the board is the GM's again). */
  get running(): boolean {
    return this.active !== null;
  }

  get mode(): 'prepared' | 'live' | null {
    return this.active?.mode ?? null;
  }

  /** Live and not ended: for the toolbar's toggle. */
  get live(): boolean {
    return this.active?.mode === 'live';
  }

  /** The step's shot (prepared; 0 in live) and how many shots there are. */
  get position(): { shot: number; total: number } | null {
    const a = this.active;
    return a ? { shot: a.playback?.shot ?? 0, total: a.cutscene?.shots.length ?? 0 } : null;
  }

  /** True once End was asked and the board is fading back to the GM's own camera. */
  get ending(): boolean {
    return this.active?.phase === 'leaving';
  }

  private get board(): Board | null {
    return (this.host.board as Board | null) ?? null;
  }

  /** Why a run cannot start now, or null. */
  private refusal(): string | null {
    const session = this.host.session();
    if (!session?.hosting()) return 'Tabletop: start a session in Connect first.';
    if (session.cutscenes !== true) return 'Tabletop: this Connect cannot show cutscenes; update it.';
    return null;
  }

  // ── Starting ─────────────────────────────────────────────────────────────

  /** Plays `cutscene` (made in `home`) for players; false, with a notice, when it cannot. */
  async startPrepared(cutscene: Cutscene, home: string): Promise<boolean> {
    if (this.active) return false;
    if (cutscene.shots.length === 0) {
      this.host.notice('Tabletop: add a shot first.');
      return false;
    }
    const refused = this.refusal();
    if (refused) {
      this.host.notice(refused);
      return false;
    }
    const tooMuch = limitProblem(cutscene);
    if (tooMuch) {
      this.host.notice(`Tabletop: this cutscene cannot be shown to players: ${tooMuch}.`);
      return false;
    }
    const tabs = this.host.mapTabs();
    const missing = [...new Set(cutscene.shots.map((shot) => shot.mapPath))].filter((path) => !tabs.includes(path));
    if (missing.length > 0) {
      this.host.notice(`Tabletop: open these maps as tabs in Atlas first: ${missing.map(mapLabel).join(', ')}.`);
      return false;
    }
    // The run begins on the cutscene's own map, where the GM pressed Play.
    if (this.host.mapPath() !== home && !(await this.host.showPlace(home).catch(() => false))) return false;
    if (this.active || !this.board) return false;
    const board = this.board;
    // The level the GM is on, of the cutscene's own map: where the run ends.
    const start = this.host.place() ?? home;
    const a: Active = {
      mode: 'prepared', runId: newRunId(), home: start, keep: board.keepCamera(), settings: { ...this.host.settings() }, cutscene,
      playback: new CutscenePlayback(placed(cutscene), 0), driver: null, phase: 'entering', clock: 0, lastNow: null, phaseStart: 0,
      switching: false, failed: new Set(), startPose: board.cameraPose(), frozen: board.cameraPose(), leaveSwap: false, seq: 1, keyed: [], livePath: start,
    };
    a.driver = { pose: (now) => this.pose(a, now) };
    this.active = a;
    this.host.lendPlayers(true);
    this.applyBoard();
    this.announce(a);
    this.changed();
    return true;
  }

  /** The toolbar toggle: the players follow the GM's own camera. */
  startLive(): void {
    if (this.active) return;
    const refused = this.refusal();
    if (refused) {
      this.host.notice(refused);
      return;
    }
    const board = this.board;
    const home = this.host.place();
    if (!board || !home) return;
    const pose = board.cameraPose();
    const a: Active = {
      mode: 'live', runId: newRunId(), home, keep: board.keepCamera(), settings: { ...this.host.settings() }, cutscene: null,
      playback: null, driver: null, phase: 'playing', clock: 0, lastNow: null, phaseStart: 0, switching: false, failed: new Set(),
      startPose: pose, frozen: pose, leaveSwap: false, seq: 1, keyed: [], livePath: home,
    };
    this.active = a;
    this.host.lendPlayers(true);
    // The local players' window fades in as a player's board does: the reveal comes on at its black, with its bars.
    this.applyBoard(false);
    board.fadePlayers(a.settings.fadeMs, () => { if (this.active === a && this.board === board) board.setReveal(true); });
    this.announce(a);
    this.changed();
  }

  // ── Telling players ──────────────────────────────────────────────────────

  /** Publishes the run as it stands now. */
  private announce(a: Active): void {
    const shot = a.playback?.shot ?? 0;
    const mapPath = a.mode === 'prepared' ? placeOf(a.cutscene!.shots[shot]) : (this.host.place() ?? a.home);
    a.livePath = mapPath;
    const told = broadcastOf({ runId: a.runId, mode: a.mode, cutscene: a.cutscene, step: { shot, seq: a.seq }, mapPath, settings: a.settings, earlier: a.keyed });
    for (const path of Object.values(told.maps)) if (!a.keyed.includes(path)) a.keyed.push(path);
    this.publish(told);
  }

  // ── The board ────────────────────────────────────────────────────────────

  /** Puts the run's role, driver, bars and reveal on the board at hand; `reveal` false leaves the reveal off for now (a live run's start, which turns it on at the players' window's black). */
  private applyBoard(reveal = true): void {
    const a = this.active;
    const board = this.board;
    if (!a || !board) return;
    board.setCinematicRole(a.mode === 'live' ? 'live' : 'running');
    board.setCinematic(a.driver);
    board.cinema.setBars(a.settings.bars ? a.settings.aspect : null);
    // The local players' window draws as remote players do: everything, whatever the GM's fog and sight hide.
    board.setPlayersCinematic(true);
    board.setReveal(reveal);
    board.refreshToolbar();
  }

  /** The board was replaced (a scene switch): the new one gets the run, and a live run names the new scene. */
  mapChanged(): void {
    const a = this.active;
    if (!a) return;
    a.switching = false;
    a.lastNow = null;
    this.applyBoard();
    if (a.mode === 'live' && this.host.place() !== a.livePath && a.phase === 'playing') {
      a.seq++;
      this.announce(a);
    }
    this.changed();
  }

  /** The camera for this frame (prepared). */
  private pose(a: Active, nowMs: number): { eye: Vec3; target: Vec3; black: number } {
    if (a.lastNow !== null && !a.switching) a.clock += nowMs - a.lastNow;
    a.lastNow = nowMs;
    const playback = a.playback!;
    const fade = a.settings.fadeMs;
    if (a.phase === 'leaving') return this.leavingPose(a, fade);
    const at = playback.frame(a.clock);
    if (a.phase === 'entering') {
      const e = enterLeave(a.clock - a.phaseStart, fade);
      if (!e.swapped) return { ...a.startPose, black: e.black };
      if (e.done) a.phase = 'playing';
      else {
        this.followMap(a, at.mapPath);
        return { eye: at.eye, target: at.target, black: a.switching ? 1 : Math.max(e.black, at.black) };
      }
    }
    this.followMap(a, at.mapPath);
    return { eye: at.eye, target: at.target, black: a.switching ? 1 : at.black };
  }

  /** The fade out: black ramps up over the last picture, the GM's map and camera come back at the black, and it ramps down. */
  private leavingPose(a: Active, fade: number): { eye: Vec3; target: Vec3; black: number } {
    const e = enterLeave(a.clock - a.phaseStart, fade);
    if (!e.swapped) return { ...a.frozen, black: a.switching ? 1 : e.black };
    if (!a.leaveSwap) {
      a.leaveSwap = true;
      if (!this.host.at(a.home)) {
        a.switching = true;
        const done = (): void => { a.switching = false; a.lastNow = null; };
        this.host.showPlace(a.home).then(done, done);
      }
    }
    if (e.done && !a.switching) {
      // Out of the frame: the driver is taken away after this one is drawn.
      void Promise.resolve().then(() => { if (this.active === a) this.teardown(a); });
    }
    return { ...a.startPose, black: a.switching ? 1 : e.black };
  }

  /** The shot the run is at looks at another place (a map, or a level of this one): show it (at the black midpoint of a fade, or at once for a cut). */
  private followMap(a: Active, path: string): void {
    if (a.switching || this.host.at(path) || a.failed.has(path)) return;
    if (!this.host.mapTabs().includes(mapOfPlace(path))) {
      a.failed.add(path);
      this.host.notice(`Tabletop: ${mapLabel(path)} is not open in an Atlas tab, so the cutscene stays on this map.`);
      return;
    }
    a.switching = true;
    const done = (ok: boolean): void => {
      if (!ok) a.failed.add(path);
      a.switching = false;
      a.lastNow = null;
    };
    this.host.showPlace(path).then(done, () => done(false));
  }

  // ── The GM's controls ────────────────────────────────────────────────────

  /** On to the next ordinary shot (through any keyframe shots); on the last shot it is the end. */
  next(): void {
    const a = this.active;
    if (!a?.playback || a.phase === 'leaving' || a.switching) return;
    if (a.playback.next(a.clock) === 'ended') {
      this.end();
      return;
    }
    a.seq++;
    this.announce(a);
    this.changed();
  }

  /** A cut back to the previous ordinary shot. */
  previous(): void {
    const a = this.active;
    if (!a?.playback || a.phase === 'leaving' || a.switching) return;
    if (!a.playback.previous(a.clock)) return;
    a.seq++;
    this.announce(a);
    this.changed();
  }

  /** Ends the run: players are told at once; the GM's board fades out and goes back to its map and camera (live: ends at once). */
  end(): void {
    const a = this.active;
    if (!a || a.phase === 'leaving') return;
    this.publish(null);
    const board = this.board;
    if (a.mode === 'live' || !board || !a.playback) {
      this.teardown(a, true);
      return;
    }
    const last = a.playback.frame(a.clock);
    a.frozen = { eye: last.eye, target: last.target };
    a.phase = 'leaving';
    a.phaseStart = a.clock;
    this.changed();
  }

  /** Ends the run with no fade: the board, the tab or Tabletop is going. Players are told. */
  dispose(): void {
    const a = this.active;
    if (!a) return;
    if (a.phase !== 'leaving') this.publish(null);
    this.teardown(a);
  }

  /**
   * Gives the board back: no driver, role or bars, the camera and the players' window as they were. A live run ended
   * by the GM (`fade`) fades the local players' window out as a player's board does: the GM's board is theirs at once,
   * and the window's reveal and bars go at its black.
   */
  private teardown(a: Active, fade = false): void {
    if (this.active !== a) return;
    this.active = null;
    const board = this.board;
    if (board) {
      board.setCinematic(null);
      board.setCinematicRole('none');
      board.cinema.setBars(null);
      if (fade && a.mode === 'live') {
        board.fadePlayers(a.settings.fadeMs, () => { if (!this.active) board.setReveal(false); }, () => { if (!this.active) board.setPlayersCinematic(false); });
      } else {
        board.setPlayersCinematic(false);
        board.setReveal(false);
      }
      if (a.mode === 'prepared' && this.host.at(a.home)) board.restoreCamera(a.keep);
      board.refreshToolbar();
    }
    this.host.lendPlayers(false);
    this.changed();
  }

  /** The GM board's own camera in a live run; null otherwise. Never the players' window's. */
  liveCamera(): Pose | null {
    if (this.active?.mode !== 'live') return null;
    return this.board?.cameraPose() ?? null;
  }
}

// ── api.cutscene ─────────────────────────────────────────────────────────────

/** What owns the run Connect reads: ended on request, and asked for its camera while live. */
export interface CutsceneOwner {
  end(): void;
  /** Ends it at once, with no fade (Tabletop is unloading). */
  dispose(): void;
  liveCamera(): Pose | null;
}

/**
 * The one run at a time, as `api.cutscene` hands it to Connect. Owners publish into it; a new owner's run ends the old
 * one's, and only the owner of the run can clear it.
 */
export class CutsceneChannel implements CutsceneSource {
  private held: { owner: CutsceneOwner; run: GmCutscene } | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly cameraListeners = new Set<() => void>();

  current(): GmCutscene | null {
    return this.held?.run ?? null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  camera(): Pose | null {
    const held = this.held;
    return held && held.run.cutscene.mode === 'live' ? held.owner.liveCamera() : null;
  }

  onCamera(listener: () => void): () => void {
    this.cameraListeners.add(listener);
    return () => { this.cameraListeners.delete(listener); };
  }

  /** `owner` publishes its run, or null when it has none. */
  publish(owner: CutsceneOwner, run: GmCutscene | null): void {
    const held = this.held;
    if (run === null) {
      if (held?.owner !== owner) return;
      this.held = null;
      this.tell(this.listeners);
      return;
    }
    if (held && held.owner !== owner) {
      held.owner.end();
      this.held = null;
    }
    this.held = { owner, run };
    this.tell(this.listeners);
  }

  /** The owner's board camera moved: listeners hear it while its run is live. */
  cameraMoved(owner: CutsceneOwner): void {
    if (this.held?.owner === owner && this.held.run.cutscene.mode === 'live') this.tell(this.cameraListeners);
  }

  /** Ends the run, whoever owns it (the session was released, Tabletop is unloading). */
  endRun(): void {
    this.held?.owner.end();
  }

  /** Tabletop unloads: the run ends and nobody is listening any more. */
  dispose(): void {
    const held = this.held;
    this.held = null;
    held?.owner.dispose();
    if (held) this.tell(this.listeners);
    this.listeners.clear();
    this.cameraListeners.clear();
  }

  private tell(listeners: Set<() => void>): void {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[Tabletop] A cutscene listener failed:', error);
      }
    }
  }
}
