/**
 * Cinematic cutscenes as the map remembers them: a list of shots, each a camera pose on some map at a moment of the
 * run, and the transition into it. A cutscene lives in the board data of the map it was made in; a shot on another
 * map holds that map's vault path. Pure, so it is tested without Obsidian.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Transition = 'fade' | 'cut' | 'move';

export interface Shot {
  id: string;
  /** Milliseconds from the start of the run. */
  at: number;
  /** Vault path of the map the camera looks at. */
  mapPath: string;
  /** The level of that scene the camera looks at (Atlas levels); unset is the first, and all of a scene without levels. */
  level?: string;
  eye: Vec3;
  target: Vec3;
  /** A keyframe shapes the camera path but the run does not rest on it. */
  keyframe: boolean;
  /** How the run gets into this shot; the first shot's is ignored. */
  transition: Transition;
}

export interface Cutscene {
  id: string;
  name: string;
  /** Sorted by `at`. */
  shots: Shot[];
}

/** The least time between two shots, in milliseconds. */
export const MIN_SHOT_GAP_MS = 100;

const TRANSITIONS: readonly Transition[] = ['fade', 'cut', 'move'];

/** Whether two shots look at the same scene and the same level of it. */
export function sameScene(a: Pick<Shot, 'mapPath' | 'level'>, b: Pick<Shot, 'mapPath' | 'level'>): boolean {
  return a.mapPath === b.mapPath && (a.level ?? null) === (b.level ?? null);
}

/** The transitions that may lead from one shot into the next: a move only stays on one map, and on one level of it. */
export function allowedTransitions(from: Shot, to: Shot): Transition[] {
  return sameScene(from, to) ? ['fade', 'cut', 'move'] : ['fade', 'cut'];
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readVec(raw: unknown): Vec3 | null {
  if (!isObj(raw)) return null;
  const { x, y, z } = raw;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z };
}

const sameVec = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

function readShot(raw: unknown): Shot | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  if (typeof raw.mapPath !== 'string' || raw.mapPath === '') return null;
  const eye = readVec(raw.eye);
  const target = readVec(raw.target);
  if (!eye || !target || sameVec(eye, target)) return null;
  const transition = TRANSITIONS.find((t) => t === raw.transition) ?? 'fade';
  return { id: raw.id, at: raw.at, mapPath: raw.mapPath, ...(typeof raw.level === 'string' && raw.level !== '' ? { level: raw.level } : {}), eye, target, keyframe: raw.keyframe === true, transition };
}

/** Turns every transition that its two shots do not allow (a move across maps) into a fade. */
function fixTransitions(shots: readonly Shot[]): Shot[] {
  return shots.map((shot, i) => (i > 0 && !allowedTransitions(shots[i - 1], shot).includes(shot.transition) ? { ...shot, transition: 'fade' as const } : shot));
}

/** Reads saved cutscenes, dropping what is broken and mending what can be mended. */
export function readCutscenes(raw: unknown): Cutscene[] {
  if (!Array.isArray(raw)) return [];
  const out: Cutscene[] = [];
  for (const item of raw) {
    if (!isObj(item) || typeof item.id !== 'string' || item.id === '') continue;
    const seen = new Set<string>();
    const read: Shot[] = [];
    if (Array.isArray(item.shots)) {
      for (const entry of item.shots) {
        const shot = readShot(entry);
        if (!shot || seen.has(shot.id)) continue;
        seen.add(shot.id);
        read.push(shot);
      }
    }
    // Array.prototype.sort is stable, so shots at the same moment keep their order.
    read.sort((a, b) => a.at - b.at);
    const spaced = read.map((shot) => ({ ...shot }));
    spaced.forEach((shot, i) => {
      shot.at = i === 0 ? Math.max(0, shot.at) : Math.max(shot.at, spaced[i - 1].at + MIN_SHOT_GAP_MS);
    });
    const name = typeof item.name === 'string' && item.name.trim() !== '' ? item.name : 'Cutscene';
    out.push({ id: item.id, name, shots: fixTransitions(spaced) });
  }
  return out;
}

type Pose = Pick<Shot, 'mapPath' | 'eye' | 'target'>;

/** The limits a cutscene shown to players keeps (Connect checks the same ones; see `BoardCutscene`). */
export const MAX_SHOTS = 200;
export const MAX_AT_MS = 3_600_000;
export const MAX_COORDINATE = 1e7;

const inRange = (v: Vec3): boolean => Math.abs(v.x) <= MAX_COORDINATE && Math.abs(v.y) <= MAX_COORDINATE && Math.abs(v.z) <= MAX_COORDINATE;

const validPose = (pose: Pose): boolean => pose.mapPath !== '' && Number.isFinite(pose.eye.x + pose.eye.y + pose.eye.z + pose.target.x + pose.target.y + pose.target.z) && !sameVec(pose.eye, pose.target) && inRange(pose.eye) && inRange(pose.target);

/** Why `c` cannot be shown to players (it breaks a limit both sides check), or null. */
export function limitProblem(c: Cutscene): string | null {
  if (c.shots.length > MAX_SHOTS) return `a cutscene holds at most ${MAX_SHOTS} shots`;
  if (c.shots.some((shot) => !(shot.at >= 0 && shot.at <= MAX_AT_MS))) return 'a cutscene lasts at most 1 hour';
  if (c.shots.some((shot) => !inRange(shot.eye) || !inRange(shot.target))) return 'a camera is too far from the map';
  return null;
}

/** Adds a shot at its moment. Refused (unchanged) when it is too close to another shot, repeats an id, has a bad pose, or the cutscene is full or too long. */
export function addShot(c: Cutscene, shot: Pick<Shot, 'id' | 'at' | 'mapPath' | 'eye' | 'target'> & { level?: string | null }, preferred: Transition): Cutscene {
  if (!Number.isFinite(shot.at) || shot.at < 0 || shot.at > MAX_AT_MS || c.shots.length >= MAX_SHOTS || !validPose(shot)) return c;
  if (c.shots.some((other) => other.id === shot.id || Math.abs(other.at - shot.at) < MIN_SHOT_GAP_MS)) return c;
  const index = c.shots.findIndex((other) => other.at > shot.at);
  const at = index < 0 ? c.shots.length : index;
  const before = c.shots[at - 1];
  const added: Shot = { id: shot.id, at: shot.at, mapPath: shot.mapPath, ...(shot.level ? { level: shot.level } : {}), eye: shot.eye, target: shot.target, keyframe: false, transition: preferred };
  if (before && !allowedTransitions(before, added).includes(preferred)) added.transition = 'fade';
  return { ...c, shots: fixTransitions([...c.shots.slice(0, at), added, ...c.shots.slice(at)]) };
}

function replaceShot(c: Cutscene, shotId: string, change: (shot: Shot) => Shot): Cutscene {
  const i = c.shots.findIndex((shot) => shot.id === shotId);
  if (i < 0) return c;
  const shots = c.shots.slice();
  shots[i] = change(shots[i]);
  return { ...c, shots };
}

/** Moves a shot in time, kept `MIN_SHOT_GAP_MS` from both neighbours; the order never changes. */
export function retime(c: Cutscene, shotId: string, at: number): Cutscene {
  const i = c.shots.findIndex((shot) => shot.id === shotId);
  if (i < 0 || !Number.isFinite(at)) return c;
  const low = i === 0 ? 0 : c.shots[i - 1].at + MIN_SHOT_GAP_MS;
  const high = i === c.shots.length - 1 ? Infinity : c.shots[i + 1].at - MIN_SHOT_GAP_MS;
  if (low > MAX_AT_MS) return c;
  const clamped = Math.min(high, MAX_AT_MS, Math.max(low, at));
  if (clamped === c.shots[i].at) return c;
  return replaceShot(c, shotId, (shot) => ({ ...shot, at: clamped }));
}

/** Sets how the run gets into a shot; refused when the shot before does not allow it. */
export function setTransition(c: Cutscene, shotId: string, t: Transition): Cutscene {
  const i = c.shots.findIndex((shot) => shot.id === shotId);
  if (i < 0 || c.shots[i].transition === t) return c;
  if (i > 0 && !allowedTransitions(c.shots[i - 1], c.shots[i]).includes(t)) return c;
  return replaceShot(c, shotId, (shot) => ({ ...shot, transition: t }));
}

export function setKeyframe(c: Cutscene, shotId: string, keyframe: boolean): Cutscene {
  if (c.shots.find((shot) => shot.id === shotId)?.keyframe === keyframe || !c.shots.some((shot) => shot.id === shotId)) return c;
  return replaceShot(c, shotId, (shot) => ({ ...shot, keyframe }));
}

/** Gives a shot a new pose, and mends the transitions into it and out of it that the new map no longer allows. */
export function updateShot(c: Cutscene, shotId: string, pose: { mapPath: string; level?: string | null; eye: Vec3; target: Vec3 }): Cutscene {
  if (!validPose(pose)) return c;
  const moved = replaceShot(c, shotId, (shot) => {
    // A pose that says nothing of the level keeps the shot's; one that names none takes it off.
    const { level: was, ...rest } = shot;
    const level = pose.level === undefined ? was : pose.level;
    return { ...rest, mapPath: pose.mapPath, ...(level ? { level } : {}), eye: pose.eye, target: pose.target };
  });
  return moved === c ? c : { ...moved, shots: fixTransitions(moved.shots) };
}

export function removeShot(c: Cutscene, shotId: string): Cutscene {
  if (!c.shots.some((shot) => shot.id === shotId)) return c;
  return { ...c, shots: fixTransitions(c.shots.filter((shot) => shot.id !== shotId)) };
}

/** The cutscene with its shots' maps renamed by `to` (null: unchanged); the same cutscene when none moved. */
export function renameShotMaps(c: Cutscene, to: (path: string) => string | null): Cutscene {
  let touched = false;
  const shots = c.shots.map((shot) => {
    const mapPath = to(shot.mapPath);
    if (mapPath === null) return shot;
    touched = true;
    return { ...shot, mapPath };
  });
  return touched ? { ...c, shots } : c;
}

/** The cutscene without the shots on maps for which `gone` holds; the same cutscene when none were. */
export function dropShotMaps(c: Cutscene, gone: (path: string) => boolean): Cutscene {
  const shots = c.shots.filter((shot) => !gone(shot.mapPath));
  return shots.length === c.shots.length ? c : { ...c, shots: fixTransitions(shots) };
}
