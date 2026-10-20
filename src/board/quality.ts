/**
 * How hard the board works to look good, set in Tabletop's settings: the resolution it draws at (and how far it may
 * drop it when the frame rate falls), antialiasing, how sharp the shadows are, and whether minis cast real shadows
 * or a soft blob under them. Pure.
 */

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** The drawing resolution, as a share of the screen's pixels: the best it starts at, and the least it drops to. */
  maxPixelRatio: number;
  minPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  /** A real shadow drawn from the model, or a soft blob under it (much cheaper for a heavy model). */
  miniShadows: 'real' | 'blob';
}

export const QUALITY: Readonly<Record<Quality, QualityPreset>> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.6, antialias: false, shadowMapSize: 1024, miniShadows: 'blob' },
  medium: { maxPixelRatio: 1.5, minPixelRatio: 0.75, antialias: true, shadowMapSize: 2048, miniShadows: 'blob' },
  high: { maxPixelRatio: 2, minPixelRatio: 1, antialias: true, shadowMapSize: 4096, miniShadows: 'real' },
};

export const DEFAULT_QUALITY: Quality = 'medium';

export function readQuality(value: unknown): Quality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : DEFAULT_QUALITY;
}

/** Below this the board is falling behind (40 fps); above this it has room to spare (55 fps). */
const SLOW_FRAME = 1 / 40;
const FAST_FRAME = 1 / 55;
/** How long it must fall behind before the resolution drops, and have room before it rises again, in seconds. */
const SLOW_FOR = 0.5;
const FAST_FOR = 3;
/** A longer gap is the board resting between frames, not a slow frame. */
const GAP = 0.25;
const STEP = 0.25;
const SMOOTHING = 0.1;

/**
 * Adaptive resolution: fed the time between frames drawn one after another, it lowers the drawing resolution a step
 * when the board falls behind and raises it again once there is room, within the preset's range.
 */
export class ResolutionGovernor {
  ratio: number;
  private readonly best: number;
  private average = 0;
  private slow = 0;
  private fast = 0;

  constructor(private readonly preset: QualityPreset, deviceRatio: number) {
    this.best = Math.max(preset.minPixelRatio, Math.min(preset.maxPixelRatio, deviceRatio));
    this.ratio = this.best;
  }

  /** One frame took `dt` seconds after the last; returns the new ratio when it changes. */
  sample(dt: number): number | null {
    if (!(dt > 0) || dt > GAP) return null;
    this.average = this.average === 0 ? dt : this.average + (dt - this.average) * SMOOTHING;
    if (this.average > SLOW_FRAME) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.average < FAST_FRAME) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    let next = this.ratio;
    if (this.slow >= SLOW_FOR) next = Math.max(this.preset.minPixelRatio, this.ratio - STEP);
    else if (this.fast >= FAST_FOR) next = Math.min(this.best, this.ratio + STEP);
    else return null;
    this.slow = 0;
    this.fast = 0;
    next = Math.round(next * 100) / 100;
    if (next === this.ratio) return null;
    this.ratio = next;
    return next;
  }
}
