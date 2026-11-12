/** How cinematic cutscenes look and move by default: the letterbox bars, the transition and the length of a fade. */

import type { Transition } from './cutsceneData';

export type CinematicAspect = 1.85 | 2 | 2.39;

export interface CinematicSettings {
  bars: boolean;
  aspect: CinematicAspect;
  /** The transition a new shot is given when the shot before allows it. */
  transition: Transition;
  /** Each way of a fade (to black, and back), in milliseconds. */
  fadeMs: number;
}

export const CINEMATIC_ASPECTS: readonly CinematicAspect[] = [1.85, 2, 2.39];
export const MIN_FADE_MS = 100;
export const MAX_FADE_MS = 3000;

export const DEFAULT_CINEMATIC_SETTINGS: CinematicSettings = Object.freeze({ bars: true, aspect: 2.39, transition: 'fade', fadeMs: 600 });

/** Reads stored settings; a missing or bad field takes its default, and the fade length is held to 0.1..3 s. */
export function readCinematicSettings(raw: unknown): CinematicSettings {
  const source = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const aspect = CINEMATIC_ASPECTS.find((a) => a === source.aspect) ?? DEFAULT_CINEMATIC_SETTINGS.aspect;
  const transition = (['fade', 'cut', 'move'] as const).find((t) => t === source.transition) ?? DEFAULT_CINEMATIC_SETTINGS.transition;
  const fadeMs = typeof source.fadeMs === 'number' && Number.isFinite(source.fadeMs)
    ? Math.min(MAX_FADE_MS, Math.max(MIN_FADE_MS, source.fadeMs))
    : DEFAULT_CINEMATIC_SETTINGS.fadeMs;
  return { bars: typeof source.bars === 'boolean' ? source.bars : DEFAULT_CINEMATIC_SETTINGS.bars, aspect, transition, fadeMs };
}
