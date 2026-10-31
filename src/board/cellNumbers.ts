/**
 * Atlas's cell numbers (`cellNumbers`, `hexNumbers` in older Atlas): which cells of the map get one and what it reads.
 * A cell counts when its centre lies at least 0.4 of a cell inside the map on every side, so half cells at the edge
 * get none. Hex rows (pointy) or columns (flat) each count from their own first whole hex, which absorbs the stagger.
 * Labels are `column-row` ("0304"), `letter-number` ("C4") or `sequential` (reading order). Pure.
 * A cell's number is worked out when it is asked for: Atlas 0.11's maps hold up to 20 million squares, too many to list.
 */
import { axialCenter, hexAxial } from './geometry';
import type { BoardGrid } from './mapModel';

const EDGE_MARGIN = 0.4;
const EPSILON = 1e-6;
const SQRT3 = Math.sqrt(3);

export interface NumberedCell {
  label: string;
  center: { x: number; y: number };
}

export interface CellNumbers {
  /** The numbered cell under a point of the map, or null. */
  at(x: number, y: number): NumberedCell | null;
}

/** A, B … Z, AA, AB …: base 26 with no zero. */
export function columnLetters(n: number): string {
  let out = '';
  let rest = n;
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    out = String.fromCharCode(65 + digit) + out;
    rest = Math.floor((rest - 1) / 26);
  }
  return out;
}

interface Cell {
  col: number;
  row: number;
  /** Its place in reading order, from 0. */
  order: number;
  center: { x: number; y: number };
}

function label(numbering: NonNullable<BoardGrid['numbers']>, cell: Cell, cols: number, rows: number): string {
  if (numbering === 'sequential') return String(cell.order + 1);
  if (numbering === 'letter-number') return `${columnLetters(cell.col + 1)}${cell.row + 1}`;
  const pad = (value: number, count: number): string => String(value).padStart(Math.max(2, String(count).length), '0');
  return `${pad(cell.col + 1, cols)}${pad(cell.row + 1, rows)}`;
}

/** The numbered cells of a grid as `at` finds them: the cell under a point, or null; and how many columns and rows there are. */
interface CellFinder {
  cols: number;
  rows: number;
  at(x: number, y: number): Cell | null;
}

const NONE: CellFinder = { cols: 0, rows: 0, at: () => null };

function squareCells(grid: BoardGrid, width: number, height: number): CellFinder {
  const margin = grid.size * EDGE_MARGIN;
  const offX = ((grid.offsetX % grid.size) + grid.size) % grid.size;
  const offY = ((grid.offsetY % grid.size) + grid.size) % grid.size;
  const first = (off: number): number => Math.ceil((margin - off) / grid.size - 0.5 - EPSILON);
  const last = (extent: number, off: number): number => Math.floor((extent - margin - off) / grid.size - 0.5 + EPSILON);
  const [c0, c1, r0, r1] = [first(offX), last(width, offX), first(offY), last(height, offY)];
  if (c1 < c0 || r1 < r0) return NONE;
  const cols = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  return {
    cols,
    rows,
    at: (x, y) => {
      const col = Math.floor((x - offX) / grid.size);
      const row = Math.floor((y - offY) / grid.size);
      if (!(col >= c0 && col <= c1 && row >= r0 && row <= r1)) return null;
      return { col: col - c0, row: row - r0, order: (row - r0) * cols + (col - c0), center: { x: offX + (col + 0.5) * grid.size, y: offY + (row + 0.5) * grid.size } };
    },
  };
}

/** The most lines of hexes worked out: a grid finer than this on the largest map Atlas allows is not numbered. */
const MAX_LINES = 1_000_000;

function hexCells(grid: BoardGrid, width: number, height: number): CellFinder {
  const margin = grid.size * EDGE_MARGIN;
  const radius = grid.size / SQRT3;
  const pointy = grid.type === 'hex-vertical';
  const origin = axialCenter(grid, 0, 0);
  // Pointy hexes stack in rows (across = y, along = x); flat hexes in columns (across = x, along = y).
  const across = pointy ? { origin: origin.y, extent: height } : { origin: origin.x, extent: width };
  const along = pointy ? { origin: origin.x, extent: width } : { origin: origin.y, extent: height };
  const spacing = 1.5 * radius;
  const firstLine = Math.ceil((margin - across.origin) / spacing - EPSILON);
  const lastLine = Math.floor((across.extent - margin - across.origin) / spacing + EPSILON);
  const lines = lastLine - firstLine + 1;
  if (!(lines >= 1) || lines > MAX_LINES) return NONE;
  // Each line's first and last whole hex; a line with none has first > last.
  const firstOf = new Float64Array(lines);
  const lastOf = new Float64Array(lines);
  let widest = 0;
  let lastFilled = -1;
  for (let n = 0; n < lines; n++) {
    const phase = (firstLine + n) / 2;
    firstOf[n] = Math.ceil((margin - along.origin) / grid.size - phase - EPSILON);
    lastOf[n] = Math.floor((along.extent - margin - along.origin) / grid.size - phase + EPSILON);
    const count = lastOf[n]! - firstOf[n]! + 1;
    if (count > 0) {
      widest = Math.max(widest, count);
      lastFilled = n;
    }
  }
  if (lastFilled < 0) return NONE;
  const count = (n: number): number => Math.max(0, lastOf[n]! - firstOf[n]! + 1);
  // Pointy: a line is a row, and the cells before it are those of the rows above. Flat: a line is a column, and a cell
  // reads after every cell of the rows above it, in any column, then after those of its row in the columns before it.
  const before = new Float64Array(lines + 1);
  if (pointy) for (let n = 0; n < lines; n++) before[n + 1] = before[n]! + count(n);
  const order = (n: number, inLine: number): number => {
    if (pointy) return before[n]! + inLine;
    let sum = 0;
    for (let m = 0; m < lines; m++) sum += Math.min(count(m), inLine) + (m < n && count(m) > inLine ? 1 : 0);
    return sum;
  };
  const filled = lastFilled + 1;
  return {
    cols: pointy ? widest : filled,
    rows: pointy ? filled : widest,
    at: (x, y) => {
      const { q, r } = hexAxial(grid, x, y);
      const [line, index] = pointy ? [r, q] : [q, r];
      const n = line - firstLine;
      if (!(n >= 0 && n < lines) || !(index >= firstOf[n]! && index <= lastOf[n]!)) return null;
      const inLine = index - firstOf[n]!;
      return { col: pointy ? inLine : n, row: pointy ? n : inLine, order: order(n, inLine), center: axialCenter(grid, q, r) };
    },
  };
}

/** The numbered cells of a `width` × `height` map, by the grid's numbering. */
export function numberCells(grid: BoardGrid, width: number, height: number): CellNumbers {
  const numbering = grid.numbers;
  if (!numbering || !grid.enabled) return { at: () => null };
  const finder = grid.type === 'square' ? squareCells(grid, width, height) : hexCells(grid, width, height);
  return {
    at: (x, y) => {
      const cell = finder.at(x, y);
      return cell ? { label: label(numbering, cell, finder.cols, finder.rows), center: cell.center } : null;
    },
  };
}
