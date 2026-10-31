/**
 * The board's measures, the way Atlas takes them: how big a token is, where a dropped token snaps on a square or hex
 * grid, and where a token's labels go around it. Hex grids follow Atlas's convention: `size` is the flat-to-flat width,
 * the circumradius is `size / √3`, and `(offsetX, offsetY)` is the top-left of hex (0, 0)'s bounding box. Pure.
 */
import type { BoardGrid } from './mapModel';

interface Point {
  x: number;
  y: number;
}

const SQRT3 = Math.sqrt(3);

/** The ring's stroke Atlas leaves around a token's art. */
const ringStroke = (grid: BoardGrid): number => Math.max(1, Math.round((grid.size * 4) / 70));

/** A token's art diameter in world pixels: a size-1 token is one cell less its ring. */
export function tokenDiameter(grid: BoardGrid, size: number): number {
  return (grid.size - 2 * ringStroke(grid)) * (2 * size - 1);
}

/** The ring's outer diameter: a size-1 token's is exactly one cell. */
export function ringDiameter(grid: BoardGrid, size: number): number {
  return tokenDiameter(grid, size) + 2 * ringStroke(grid);
}

interface HexFrame {
  radius: number;
  pointy: boolean;
  origin: Point;
}

function hexFrame(grid: BoardGrid): HexFrame {
  const radius = grid.size / SQRT3;
  const pointy = grid.type !== 'hex-horizontal';
  const origin = pointy
    ? { x: grid.offsetX + grid.size / 2, y: grid.offsetY + radius }
    : { x: grid.offsetX + radius, y: grid.offsetY + grid.size / 2 };
  return { radius, pointy, origin };
}

/** The axial coordinates of the hex holding a point (cube rounding, as Atlas does). */
export function hexAxial(grid: BoardGrid, x: number, y: number): { q: number; r: number } {
  const { radius, pointy, origin } = hexFrame(grid);
  const dx = x - origin.x;
  const dy = y - origin.y;
  const fq = pointy ? ((SQRT3 / 3) * dx - dy / 3) / radius : ((2 / 3) * dx) / radius;
  const fr = pointy ? ((2 / 3) * dy) / radius : (-dx / 3 + (SQRT3 / 3) * dy) / radius;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const qDiff = Math.abs(q - fq);
  const rDiff = Math.abs(r - fr);
  const sDiff = Math.abs(s - fs);
  if (qDiff > rDiff && qDiff > sDiff) q = -r - s;
  else if (rDiff > sDiff) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

/** The centre of a hex given by its axial coordinates. */
export function axialCenter(grid: BoardGrid, q: number, r: number): Point {
  const { radius, pointy, origin } = hexFrame(grid);
  return pointy
    ? { x: origin.x + grid.size * (q + r / 2), y: origin.y + 1.5 * radius * r }
    : { x: origin.x + 1.5 * radius * q, y: origin.y + grid.size * (r + q / 2) };
}

/** The centre of the hex holding a point. */
export function hexCenter(grid: BoardGrid, x: number, y: number): Point {
  const { q, r } = hexAxial(grid, x, y);
  return axialCenter(grid, q, r);
}

/**
 * How far from a cell's centre a token of `size` stands when snapped, as Atlas works it (`snapTokenCenter`): a token
 * covering an odd number of cells across (`2 * size - 1`) is centred on a cell; one covering an even number (Large,
 * Gargantuan) stands on the meeting of its cells, half a cell off, so it covers whole cells.
 */
function snapShift(grid: BoardGrid, size: number): Point {
  if ((2 * size - 1) % 2 !== 0) return { x: 0, y: 0 };
  if (grid.type === 'square') return { x: grid.size / 2, y: grid.size / 2 };
  const radius = grid.size / SQRT3;
  return grid.type === 'hex-horizontal' ? { x: radius / 2, y: grid.size / 2 } : { x: grid.size / 2, y: radius / 2 };
}

/**
 * Where a token of `size` dropped at (x, y) lands: its cell's centre (the meeting of its cells when it covers an even
 * number across), or where it was dropped when the map does not snap.
 */
export function snapPoint(grid: BoardGrid, x: number, y: number, size = 1): Point {
  if (!grid.enabled || !grid.snap) return { x, y };
  const shift = snapShift(grid, size);
  const at = { x: x - shift.x, y: y - shift.y };
  const cell = (value: number, offset: number): number => Math.floor((value - offset) / grid.size) * grid.size + offset + grid.size / 2;
  const centre = grid.type !== 'square' ? hexCenter(grid, at.x, at.y) : { x: cell(at.x, grid.offsetX), y: cell(at.y, grid.offsetY) };
  return { x: centre.x + shift.x, y: centre.y + shift.y };
}

/** Beside the figure, the stat badges go left, right, left, right, a new row every two. */
export function sideBadgeSlots(count: number): Array<{ side: -1 | 1; row: number }> {
  return Array.from({ length: count }, (_, index) => ({ side: index % 2 === 0 ? -1 : 1, row: Math.floor(index / 2) }));
}

/** The radii of a token's condition rings on its base: one per condition, each wider than the last so none overlap. */
export function conditionRingRadii(baseRadius: number, count: number, width: number, gap: number): number[] {
  return Array.from({ length: count }, (_, index) => baseRadius + gap + width / 2 + index * (width + gap));
}
