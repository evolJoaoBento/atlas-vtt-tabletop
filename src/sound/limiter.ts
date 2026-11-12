/**
 * The settings of the peak limiter before the speakers: a hard knee, so a sound under the threshold is not touched.
 * `compressorMakeupGain` below (and so `LIMITER_POST_GAIN`, 0.8212) is exact only for a knee of 0: change the knee and
 * the formula has to change with it (a unit test and the browser check "limiter" in the harness fail until it does).
 */
export const LIMITER = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });

/**
 * The make-up gain Chromium's DynamicsCompressorNode adds on its own, as a factor. It takes the level a full-scale
 * (0 dB) input would come out at, undoes that loss, and applies 0.6 of it as "perceptual tuning". For a hard knee
 * (knee 0) that level is `threshold * (1 - 1 / ratio)` dB, so the make-up is `-0.6 * threshold * (1 - 1 / ratio)` dB.
 */
export function compressorMakeupGain(thresholdDb: number, ratio: number): number {
  const fullScaleOutDb = thresholdDb * (1 - 1 / ratio);
  return Math.pow(10, (-0.6 * fullScaleOutDb) / 20);
}

/** The gain placed after the limiter to take that make-up gain back out, so a quiet sound leaves at the level it came in. */
export const LIMITER_POST_GAIN = 1 / compressorMakeupGain(LIMITER.threshold, LIMITER.ratio);
