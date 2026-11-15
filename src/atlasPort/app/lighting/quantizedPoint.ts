// Atlas source: src/app/lighting/quantizedPoint.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { MAX_Q, Q_SCALE, type Q } from '../types/shapeTypes';

/** Rejects invalid geometry instead of clipping it to a different shape. */
export function assertQ(value: number): void {
  if (!Number.isInteger(value) || Math.abs(value) > MAX_Q) {
    throw new RangeError('Shape coordinates must be bounded eighth-pixel integers');
  }
}

/** Apply world-space offsets before calling this conversion. Half ties round toward positive infinity. */
export function quantizeCoordinate(value: number): Q {
  const quantized = Math.round(value * Q_SCALE);
  assertQ(quantized);
  return quantized === 0 ? 0 : quantized;
}
