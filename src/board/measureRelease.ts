/**
 * What becomes of a measurement when the pointer lets go, as Atlas 0.19 does it (`LiveMeasuring.finished`, `fade`,
 * `app/pixi/measure/measurePresence.ts`): kept when Keep and Shift differ, else it stays `MEASURE_FADE_MS` with a pin
 * beside its label (a press on the pin keeps it) and dissolves over the last `LIVE_DISSOLVE_MS`. Pure.
 */

/** How long a released measurement that is not kept stays, with its pin; it dissolves over the last `LIVE_DISSOLVE_MS`. */
export const MEASURE_FADE_MS = 2000;
/** The last part of a released measurement's time on the map, over which it dissolves. */
export const LIVE_DISSOLVE_MS = 360;

/** Whether a released measurement is kept: Keep says so, or Shift says the other thing. The held measure key's ruler counts as Keep off. */
export function releaseKeeps(keep: boolean, held: boolean, shift: boolean): boolean {
  return (held ? false : keep) !== shift;
}

/** How much of a released measurement shows `elapsed` ms after the release: whole, then dissolving to nothing. */
export function releasedAlpha(elapsed: number): number {
  const start = MEASURE_FADE_MS - LIVE_DISSOLVE_MS;
  if (elapsed <= start) return 1;
  return Math.max(0, 1 - (elapsed - start) / LIVE_DISSOLVE_MS);
}
