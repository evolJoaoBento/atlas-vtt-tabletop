import type { WaterMotionKind } from '../board/water';
import type { SoundId } from './catalog';

/** The loop sound of water that moves as `kind`. */
export function waterLoop(kind: WaterMotionKind): SoundId {
  return `water.${kind}` as SoundId;
}

/** A water mask as the search reads it; `version` changes whenever its cells do (without one it is searched afresh each time). */
export interface WaterMaskLike { width: number; height: number; data: Uint8Array; version?: number }

/** The coarse side the search is made on: at most 64 by 64 blocks of the mask. */
const COARSE = 64;

interface Coarse {
  version: number | undefined;
  /** Columns and rows of blocks, and the mask's cells a block spans on each side. */
  columns: number;
  rows: number;
  blockX: number;
  blockY: number;
  /** The blocks that hold any water, as column + row * columns. */
  wet: Int32Array;
}

const cache = new WeakMap<object, Coarse>();

function coarsen(mask: WaterMaskLike): Coarse {
  const blockX = Math.max(1, Math.ceil(mask.width / COARSE));
  const blockY = Math.max(1, Math.ceil(mask.height / COARSE));
  const columns = Math.ceil(mask.width / blockX);
  const rows = Math.ceil(mask.height / blockY);
  const found = new Uint8Array(columns * rows);
  for (let y = 0; y < mask.height; y++) {
    const row = Math.floor(y / blockY) * columns;
    for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]! > 0) found[row + Math.floor(x / blockX)] = 1;
  }
  let count = 0;
  for (const value of found) count += value;
  const wet = new Int32Array(count);
  let at = 0;
  for (let i = 0; i < found.length; i++) if (found[i]) wet[at++] = i;
  return { version: mask.version, columns, rows, blockX, blockY, wet };
}

/**
 * Map pixels from `point` to the nearest water of `mask` (0 over water, Infinity for a mask with none). The mask is
 * searched on a coarse grid (at most 64 by 64 blocks, a block wet when any of its cells is), kept for as long as the
 * mask's version stays the same, so the search itself allocates nothing.
 */
export function waterDistance(mask: WaterMaskLike, mapWidth: number, mapHeight: number, point: { x: number; y: number }): number {
  let coarse = cache.get(mask);
  if (!coarse || coarse.version === undefined || coarse.version !== mask.version) {
    coarse = coarsen(mask);
    cache.set(mask, coarse);
  }
  const sizeX = (mapWidth / mask.width) * coarse.blockX;
  const sizeY = (mapHeight / mask.height) * coarse.blockY;
  let best = Infinity;
  for (let i = 0; i < coarse.wet.length; i++) {
    const block = coarse.wet[i]!;
    const left = (block % coarse.columns) * sizeX;
    const top = Math.floor(block / coarse.columns) * sizeY;
    const dx = point.x < left ? left - point.x : point.x > left + sizeX ? point.x - left - sizeX : 0;
    const dy = point.y < top ? top - point.y : point.y > top + sizeY ? point.y - top - sizeY : 0;
    const distance = Math.hypot(dx, dy);
    if (distance < best) { best = distance; if (best === 0) break; }
  }
  return best;
}
