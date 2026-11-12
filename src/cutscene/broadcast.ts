/**
 * A run as it is told to players: the shots with run-local map keys in place of vault paths, and, kept on the GM's side
 * only, which path each key stands for. Pure, so it is tested without a board.
 */

import type { BoardCutscene, GmCutscene } from '../connectContract';
import type { CinematicSettings } from './cinematicSettings';
import type { Cutscene } from './cutsceneData';

export interface BroadcastInput {
  runId: string;
  mode: 'prepared' | 'live';
  /** The prepared cutscene; null in live. */
  cutscene: Cutscene | null;
  step: { shot: number; seq: number };
  /** The map shown now: the step's shot's, or the GM's own in live. */
  mapPath: string;
  settings: CinematicSettings;
  /**
   * Maps that already hold a key earlier in the same run, in order (`earlier[0]` is `k1`): a map takes a new number
   * rather than an old one, so a live run's key changes with its scene. Omitted, keys count from `k1`.
   */
  earlier?: readonly string[];
}

/**
 * The run for Connect. Keys are `k1…` by the first appearance of each map (the shots in order, then `mapPath`); nothing
 * in `cutscene` holds a vault path.
 */
export function broadcastOf(input: BroadcastInput): GmCutscene {
  const keyed = new Map<string, string>((input.earlier ?? []).map((path, i) => [path, `k${i + 1}`]));
  const maps: Record<string, string> = {};
  const keyOf = (path: string): string => {
    let key = keyed.get(path);
    if (key === undefined) {
      key = `k${keyed.size + 1}`;
      keyed.set(path, key);
    }
    maps[key] = path;
    return key;
  };
  const shots = input.mode === 'prepared' && input.cutscene
    ? input.cutscene.shots.map((shot) => ({
      key: keyOf(shot.mapPath),
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
    look: { bars: input.settings.bars ? input.settings.aspect : null, fadeMs: input.settings.fadeMs },
    shots,
    step: { shot: input.step.shot, seq: input.step.seq },
    key,
  };
  return { cutscene, maps };
}
