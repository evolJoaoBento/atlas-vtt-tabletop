/**
 * The numbers behind the fog's look as a black cloud (`fogVolume.ts` draws it): the frame the cloud is drawn in (the
 * fog with room for its soft edge, and the size of the texture its shape is painted into) and a small tiling noise
 * that roughens the edge so it billows instead of blurring evenly. Pure, so it is tested without a browser.
 */
import type { FogArea } from './fog';

/** Room around the fog for its soft edge, in grid squares. */
export const CLOUD_MARGIN = 2;
/** How finely the cloud's shape is painted: texels per grid square. */
const TEXELS_PER_SQUARE = 8;
const MAX_TEXELS = 1024;

export interface CloudFrame {
  /** The frame on the map, in map pixels. */
  minX: number;
  minY: number;
  width: number;
  height: number;
  /** The shape texture's size. */
  texWidth: number;
  texHeight: number;
}

/** Where the cloud of these areas is drawn, and how big its shape texture is; null without fog. */
export function cloudFrame(areas: readonly FogArea[], cellSize: number): CloudFrame | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { outer } of areas) {
    for (const point of outer) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  const margin = CLOUD_MARGIN * cellSize;
  const frame = { minX: minX - margin, minY: minY - margin, width: maxX - minX + margin * 2, height: maxY - minY + margin * 2 };
  const perPixel = TEXELS_PER_SQUARE / cellSize;
  const scale = Math.min(1, MAX_TEXELS / (frame.width * perPixel), MAX_TEXELS / (frame.height * perPixel));
  return {
    ...frame,
    texWidth: Math.max(2, Math.round(frame.width * perPixel * scale)),
    texHeight: Math.max(2, Math.round(frame.height * perPixel * scale)),
  };
}

/** A small seeded random number generator (mulberry32), so the cloud looks the same every time. */
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

/** A square of soft value noise, `size` texels across, that tiles, as bytes 0–255: two octaves, stretched to the full range. */
export function cloudNoise(size: number, seed: number): Uint8Array {
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
        const at = (ix: number, iy: number): number => lattice[(iy % cells) * cells + (ix % cells)];
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
