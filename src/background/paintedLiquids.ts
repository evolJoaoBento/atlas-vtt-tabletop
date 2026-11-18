/**
 * The liquids of a painted background: where each one is wet, as a mask a liquid sheet (`waterSurface.ts`) draws.
 * Pure, so it is tested without a board.
 */

import { TERRAINS, type BackgroundLayers } from './backgroundData';
import { BANK_REACH, type BackgroundFrame } from './terrainHeight';
import { WaterMask, type LiquidKind } from '../board/water';

/**
 * Where `liquid` is wet, over the picture's whole square (`extent` squares of `cell` units each, so the sheet that
 * wears it is laid with its middle on the picture's): wet where that liquid is painted, and nowhere inside `flat`, the
 * usable board, which stays dry. `reach` (world units from the map's middle) is how far the plane runs: when that is
 * past the picture, the mask covers the plane's whole square, and the picture's edge cells go on outward (as the
 * ground does), so a liquid at the edge does not stop short of the ground's end. Null when there is none of it to draw.
 */
export function liquidMask(
  layers: BackgroundLayers, frame: BackgroundFrame, cell: number, liquid: LiquidKind, flat: { x0: number; y0: number; x1: number; y1: number },
  reach = 0,
): WaterMask | null {
  const index = TERRAINS.find((t) => t.id === liquid)?.index;
  if (index === undefined || !layers.terrain.includes(index)) return null;
  // The sheet's side, in squares and in world units (never less than the picture's square).
  const squares = Math.max(frame.extent, 2 * reach / cell);
  const side = squares * cell;
  const mask = WaterMask.forMap(side, side, cell);
  const { size } = frame;
  const left = frame.cx - squares / 2, top = frame.cy - squares / 2;
  // The sheet stretches the mask over its square, so a texel's middle is a fraction of the way across. The picture's
  // cell it falls in, and its square, are the same on every row, so they are worked out once.
  const squareAt = (t: number, of: number, from: number): number => from + (t + 0.5) / of * squares;
  const cellAt = (t: number, of: number, from: number, centre: number): number => {
    const picture = Math.floor((squareAt(t, of, from) - (centre - frame.extent / 2)) / frame.extent * size);
    return Math.min(size - 1, Math.max(0, picture));
  };
  // The sheet runs `BANK_REACH` squares under the bank round it, so the shore shows no gap and no floating edge: the
  // cells of this liquid, grown by that many squares (a square's worth of cells along a row, then down a column).
  const grow = Math.max(1, Math.round(BANK_REACH * size / frame.extent));
  const wet = new Uint8Array(size * size), rows = new Uint8Array(size * size);
  for (let k = 0; k < wet.length; k++) if (layers.terrain[k] === index) wet[k] = 1;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!wet[j * size + i]) continue;
      for (let d = Math.max(0, i - grow); d <= Math.min(size - 1, i + grow); d++) rows[j * size + d] = 1;
    }
  }
  wet.fill(0);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!rows[j * size + i]) continue;
      for (let d = Math.max(0, j - grow); d <= Math.min(size - 1, j + grow); d++) wet[d * size + i] = 1;
    }
  }
  const column = new Int32Array(mask.width), across = new Float64Array(mask.width);
  for (let t = 0; t < mask.width; t++) { column[t] = cellAt(t, mask.width, left, frame.cx); across[t] = squareAt(t, mask.width, left); }
  let any = false;
  for (let ty = 0; ty < mask.height; ty++) {
    const row = cellAt(ty, mask.height, top, frame.cy) * size, y = squareAt(ty, mask.height, top);
    const insideY = y >= flat.y0 && y <= flat.y1;
    for (let tx = 0; tx < mask.width; tx++) {
      if (!wet[row + column[tx]]) continue;
      if (insideY && across[tx] >= flat.x0 && across[tx] <= flat.x1) continue;
      mask.data[ty * mask.width + tx] = 255;
      any = true;
    }
  }
  return any ? mask : null;
}
