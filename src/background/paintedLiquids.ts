/**
 * The liquids of a painted background: where each one is wet, as a mask a liquid sheet (`waterSurface.ts`) draws.
 * Pure, so it is tested without a board.
 */

import { TERRAINS, type BackgroundLayers } from './backgroundData';
import type { BackgroundFrame } from './terrainHeight';
import { WaterMask, type LiquidKind } from '../board/water';

/**
 * Where `liquid` is wet, over the picture's whole square (`extent` squares of `cell` units each, so the sheet that
 * wears it is laid with its middle on the picture's): wet where that liquid is painted, and nowhere inside `flat`, the
 * usable board, which stays dry. Null when there is none of it to draw.
 */
export function liquidMask(
  layers: BackgroundLayers, frame: BackgroundFrame, cell: number, liquid: LiquidKind, flat: { x0: number; y0: number; x1: number; y1: number },
): WaterMask | null {
  const index = TERRAINS.find((t) => t.id === liquid)?.index;
  if (index === undefined || !layers.terrain.includes(index)) return null;
  const side = frame.extent * cell;
  const mask = WaterMask.forMap(side, side, cell);
  const { size } = frame;
  const left = frame.cx - frame.extent / 2, top = frame.cy - frame.extent / 2;
  // The sheet stretches the mask over the square, so a texel's middle is a fraction of the way across. The picture's
  // cell it falls in, and its square, are the same on every row, so they are worked out once.
  const cellAt = (t: number, of: number): number => Math.min(size - 1, Math.max(0, Math.floor((t + 0.5) / of * size)));
  const squareAt = (t: number, of: number, from: number): number => from + (t + 0.5) / of * frame.extent;
  const column = new Int32Array(mask.width), across = new Float64Array(mask.width);
  for (let t = 0; t < mask.width; t++) { column[t] = cellAt(t, mask.width); across[t] = squareAt(t, mask.width, left); }
  let any = false;
  for (let ty = 0; ty < mask.height; ty++) {
    const row = cellAt(ty, mask.height) * size, y = squareAt(ty, mask.height, top);
    const insideY = y >= flat.y0 && y <= flat.y1;
    for (let tx = 0; tx < mask.width; tx++) {
      if (layers.terrain[row + column[tx]] !== index) continue;
      if (insideY && across[tx] >= flat.x0 && across[tx] <= flat.x1) continue;
      mask.data[ty * mask.width + tx] = 255;
      any = true;
    }
  }
  return any ? mask : null;
}
