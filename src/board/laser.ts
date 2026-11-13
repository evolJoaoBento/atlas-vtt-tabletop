/**
 * Atlas's laser pointer, as the 3D board uses it. Its colours, size limits and default are Atlas's own
 * (`packages/atlas-shared`, `tools/laserPointerSettings.ts`); the beam and the trail are ported from `pixi/laser/`: its eight colours and its size (the glow's radius in screen pixels, at any zoom), the beam's width
 * from that size (a solid body and a glow that stops growing so wide beams stay crisp), the trail the pointer leaves
 * while pressed (each point fading over 0.8 s, at most 100), and the curve smoothed through it. Pure, so it is tested
 * without a browser.
 */

import { DEFAULT_LASER_POINTER_SETTINGS, LASER_COLORS as ATLAS_LASER_COLORS, LASER_SIZE_MAX, LASER_SIZE_MIN, resolveLaserPointerSettings } from '../../packages/atlas-shared/src/index';

export interface LaserSettings {
  color: string;
  /** Radius of the glow around the pointer, in screen pixels at any zoom. */
  size: number;
}

/** Atlas's laser colours: the Okabe-Ito hue families, brightened, kept apart for every kind of colour blindness. */
const LASER_COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Mint', 'Sky blue', 'Blue', 'Pink', 'White'];
/** Atlas's colours, in its order, each with its English name (Atlas's own names are its texts, not carried here). */
export const LASER_COLORS: ReadonlyArray<{ value: string; label: string }> = ATLAS_LASER_COLORS.map((value, index) => ({ value, label: LASER_COLOR_NAMES[index] ?? value }));

/** Shown with the swatches, since colour-blind players cannot tell which ones work for them. */
export const LASER_COLOR_HINT = 'Sky blue, blue and white stay clear for colour-blind players.';
export { LASER_SIZE_MAX, LASER_SIZE_MIN };
export const DEFAULT_LASER: LaserSettings = { color: DEFAULT_LASER_POINTER_SETTINGS.color, size: DEFAULT_LASER_POINTER_SETTINGS.size };
/** How long a point of the trail stays visible, in milliseconds. */
export const LASER_FADE_MS = 800;
/** Most pointer samples a trail keeps. */
const MAX_TRAIL_SAMPLES = 100;
/** Smoothing adds at most this many points between two samples. */
const MAX_SUBDIVISIONS = 8;

/** Stored settings, anything unusable replaced by the default: Atlas's own reading (`resolveLaserPointerSettings`). */
export function resolveLaser(raw: Partial<LaserSettings> | undefined): LaserSettings {
  const { color, size } = resolveLaserPointerSettings(raw ?? {});
  return { color, size };
}

/** The beam's half width (glow included) and the share of it the solid body takes, in screen pixels. */
export function beamWidth(size: number): { halfWidth: number; bodyShare: number } {
  const body = size * 0.35;
  const radius = body + Math.min(40, size * 1.15);
  return { halfWidth: radius, bodyShare: body / radius };
}

/** A point of the beam: where it is on the map and how much of its life is left (1 fresh, 0 gone). */
export interface BeamPoint {
  x: number;
  y: number;
  life: number;
}

/** What the pointer drew while pressed: points with the time they were drawn. */
export class LaserTrail {
  private samples: Array<{ x: number; y: number; time: number }> = [];

  /** Adds where the pointer is at `time` (ms), unless it is within `minGap` of the last point. */
  add(x: number, y: number, time: number, minGap: number): void {
    const last = this.samples[this.samples.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < minGap) return;
    this.samples.push({ x, y, time });
    if (this.samples.length > MAX_TRAIL_SAMPLES) this.samples.splice(0, this.samples.length - MAX_TRAIL_SAMPLES);
  }

  /** The living points at `now`, oldest first. */
  points(now: number): BeamPoint[] {
    this.samples = this.samples.filter((sample) => now - sample.time < LASER_FADE_MS);
    return this.samples.map((sample) => ({ x: sample.x, y: sample.y, life: 1 - (now - sample.time) / LASER_FADE_MS }));
  }

  alive(now: number): boolean {
    return this.samples.some((sample) => now - sample.time < LASER_FADE_MS);
  }

  clear(): void {
    this.samples = [];
  }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t2 * t);
}

/** A Catmull-Rom curve through the points, steps no longer than `spacing`, life carried along (Atlas's `smoothBeam`). */
export function smoothBeam(points: readonly BeamPoint[], spacing: number): BeamPoint[] {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const smoothed: BeamPoint[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const steps = Math.min(MAX_SUBDIVISIONS, Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing)));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      smoothed.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t),
        life: p1.life + (p2.life - p1.life) * t,
      });
    }
  }
  smoothed.push({ ...points[points.length - 1] });
  return smoothed;
}
