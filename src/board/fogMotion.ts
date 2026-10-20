/**
 * What makes the 3D fog move like fog, cheaply: a small tiling noise the fog's surfaces sample twice, drifting two
 * ways (`fogVolume.ts` scrolls it in their shader), and a sparse scatter of soft wisps drifting over the fog's top.
 * How much of it shows is the GM's choice (`FogMotion`), defaulting to what the quality setting can afford. Pure, so
 * it is tested without a browser.
 */
import type { FogArea } from './fog';
import { insideFog } from './playerView';
import type { Quality } from './quality';

/** Off: the fog stands still. Subtle: its surfaces roll. Full: wisps drift over it too. */
export type FogMotion = 'off' | 'subtle' | 'full';

export function readFogMotion(value: unknown): FogMotion | null {
  return value === 'off' || value === 'subtle' || value === 'full' ? value : null;
}

export function defaultFogMotion(quality: Quality): FogMotion {
  return quality === 'low' ? 'off' : quality === 'medium' ? 'subtle' : 'full';
}

/** A small seeded random number generator (mulberry32), so the fog looks the same every time. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A square of soft value noise, `size` texels across, that tiles (its opposite edges meet), as bytes 0–255: two
 * octaves of smoothly blended random lattices, stretched to the full range.
 */
export function fogNoise(size: number, seed: number): Uint8Array {
  const next = random(seed);
  const octaves = [{ cells: 4, weight: 0.65 }, { cells: 8, weight: 0.35 }].map(({ cells, weight }) => ({
    cells, weight, lattice: Array.from({ length: cells * cells }, () => next()),
  }));
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const values = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      for (const { cells, weight, lattice } of octaves) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const at = (ix: number, iy: number): number => lattice[(iy % cells) * cells + (ix % cells)]!;
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        value += (top + (bottom - top) * ty) * weight;
      }
      values[y * size + x] = value;
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
  const span = max - min || 1;
  return Uint8Array.from(values, (value) => Math.round(((value - min) / span) * 255));
}

/** Where wisps drift over the fog: about one per grid square of fog, at most `max`, all over fog. */
export function scatterWisps(areas: readonly FogArea[], cellSize: number, seed: number, max: number): Array<{ x: number; y: number }> {
  if (areas.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { outer } of areas) {
    for (const point of outer) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
  }
  const next = random(seed);
  const boxArea = (maxX - minX) * (maxY - minY);
  // The share of the box under fog, from samples, gives the fog's area without summing rings and holes.
  const samples = 400;
  let under = 0;
  for (let i = 0; i < samples; i++) if (insideFog(areas, { x: minX + next() * (maxX - minX), y: minY + next() * (maxY - minY) })) under++;
  const fogArea = boxArea * (under / samples);
  const wanted = Math.min(max, Math.round(fogArea / (cellSize * cellSize)));
  const wisps: Array<{ x: number; y: number }> = [];
  for (let tries = 0; wisps.length < wanted && tries < wanted * 50; tries++) {
    const point = { x: minX + next() * (maxX - minX), y: minY + next() * (maxY - minY) };
    if (insideFog(areas, point)) wisps.push(point);
  }
  return wisps;
}
