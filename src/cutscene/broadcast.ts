/**
 * A run as it is told to players: the shots with run-local map keys in place of vault paths, and, kept on the GM's side
 * only, which path each key stands for. Pure, so it is tested without a board.
 */

import type { BoardCutscene, GmCutscene } from '../connectContract';
import type { CinematicSettings } from './cinematicSettings';
import { levelOfPlace, mapOfPlace, placeAt, placeOf, type Cutscene } from './cutsceneData';

export interface BroadcastInput {
  runId: string;
  mode: 'prepared' | 'live';
  /** The prepared cutscene; null in live. */
  cutscene: Cutscene | null;
  step: { shot: number; seq: number };
  /** The place shown now (`placeAt`: a map, or a level of one): the step's shot's, or the GM's own in live. */
  mapPath: string;
  settings: CinematicSettings;
  /**
   * Places that already hold a key earlier in the same run, in order (`earlier[0]` is `k1`): such a place keeps its key,
   * and one not among them takes the next number. Omitted, keys count from `k1`.
   */
  earlier?: readonly string[];
}

/**
 * The run for Connect. Keys are `k1…` by the first appearance of each place (the shots in order, then `mapPath`): a
 * map, or a level of one, so two levels of a scene are two keys, of the same map in `maps` and each with its level in
 * `levels`. Nothing in `cutscene` holds a vault path or a level's id.
 */
export function broadcastOf(input: BroadcastInput): GmCutscene {
  const keyed = new Map<string, string>((input.earlier ?? []).map((path, i) => [path, `k${i + 1}`]));
  const maps: Record<string, string> = {};
  const levels: Record<string, string> = {};
  const keyOf = (path: string): string => {
    let key = keyed.get(path);
    if (key === undefined) {
      key = `k${keyed.size + 1}`;
      keyed.set(path, key);
    }
    maps[key] = mapOfPlace(path);
    const level = levelOfPlace(path);
    if (level) levels[key] = level;
    return key;
  };
  const shots = input.mode === 'prepared' && input.cutscene
    ? input.cutscene.shots.map((shot) => ({
      key: keyOf(placeOf(shot)),
      eye: { x: shot.eye.x, y: shot.eye.y, z: shot.eye.z },
      target: { x: shot.target.x, y: shot.target.y, z: shot.target.z },
      at: shot.at,
      keyframe: shot.keyframe,
      transition: shot.transition,
    }))
    : [];
  const key = keyOf(input.mapPath);
  const cutscene: BoardCutscene = {
    runId: input.runId,
    mode: input.mode,
    // `transition`: how players reach a shot the GM skips to (the timeline, Previous): the GM's default.
    look: { bars: input.settings.bars ? input.settings.aspect : null, fadeMs: input.settings.fadeMs, transition: input.settings.transition },
    shots,
    step: { shot: input.step.shot, seq: input.step.seq },
    key,
  };
  return { cutscene, maps, ...(Object.keys(levels).length > 0 ? { levels } : {}) };
}

/** The places a publication keyed, in key order (`k1` first): what the next publication of the same run is given as `earlier`. */
export function keyedPlaces(told: Pick<GmCutscene, 'maps' | 'levels'>): string[] {
  const number = (key: string): number => Number(key.slice(1));
  return Object.keys(told.maps).sort((a, b) => number(a) - number(b)).map((key) => placeAt(told.maps[key]!, told.levels?.[key]));
}

const KEY = /^k[0-9]{1,4}$/;
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BARS = [1.85, 2, 2.39];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const inside = (n: unknown, low: number, high: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;

function readPoint(raw: unknown): { x: number; y: number; z: number } | null {
  if (!isObject(raw) || !inside(raw.x, -1e7, 1e7) || !inside(raw.y, -1e7, 1e7) || !inside(raw.z, -1e7, 1e7)) return null;
  return { x: raw.x, y: raw.y, z: raw.z };
}

/**
 * A cutscene as a player's board takes it from Connect, checked against the limits Connect checks too (at most 200 shots;
 * run-local keys; times in 0..3 600 000; coordinates within 1e7; the step on a shot the run rests on). Null for anything else.
 * A copy: nothing of `raw` is kept.
 */
export function readBoardCutscene(raw: unknown): BoardCutscene | null {
  if (!isObject(raw) || typeof raw.runId !== 'string' || !RUN_ID.test(raw.runId)) return null;
  if (raw.mode !== 'prepared' && raw.mode !== 'live') return null;
  if (typeof raw.key !== 'string' || !KEY.test(raw.key)) return null;
  const look = raw.look;
  if (!isObject(look) || !inside(look.fadeMs, 100, 3000)) return null;
  if (look.bars !== null && !(typeof look.bars === 'number' && BARS.includes(look.bars))) return null;
  if (look.transition !== undefined && look.transition !== 'fade' && look.transition !== 'cut' && look.transition !== 'move') return null;
  const step = raw.step;
  if (!isObject(step) || typeof step.shot !== 'number' || !Number.isInteger(step.shot) || step.shot < 0) return null;
  if (typeof step.seq !== 'number' || !Number.isInteger(step.seq) || step.seq < 0 || step.seq > Number.MAX_SAFE_INTEGER) return null;
  if (!Array.isArray(raw.shots) || raw.shots.length > 200) return null;
  const shots: BoardCutscene['shots'] = [];
  for (const entry of raw.shots) {
    if (!isObject(entry) || typeof entry.key !== 'string' || !KEY.test(entry.key) || !inside(entry.at, 0, 3_600_000)) return null;
    if (typeof entry.keyframe !== 'boolean' || (entry.transition !== 'fade' && entry.transition !== 'cut' && entry.transition !== 'move')) return null;
    const eye = readPoint(entry.eye);
    const target = readPoint(entry.target);
    if (!eye || !target) return null;
    shots.push({ key: entry.key, eye, target, at: entry.at, keyframe: entry.keyframe, transition: entry.transition });
  }
  if (raw.mode === 'prepared') {
    const last = shots.length - 1;
    // The run rests on a shot that is not a keyframe, or on the first or the last.
    if (shots.length === 0 || step.shot > last || !(step.shot === 0 || step.shot === last || !shots[step.shot].keyframe)) return null;
  } else if (shots.length !== 0 || step.shot !== 0) return null;
  return {
    runId: raw.runId, mode: raw.mode, look: { bars: look.bars as number | null, fadeMs: look.fadeMs, ...(look.transition ? { transition: look.transition as 'fade' | 'cut' | 'move' } : {}) }, shots, step: { shot: step.shot, seq: step.seq }, key: raw.key,
  };
}
