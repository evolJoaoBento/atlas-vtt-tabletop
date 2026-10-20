/**
 * Atlas's cell numbers (`cellNumbers`, `hexNumbers` in older Atlas): which cells of the map get one and what it reads.
 * A cell counts when its centre lies at least 0.4 of a cell inside the map on every side, so half cells at the edge
 * get none. Hex rows (pointy) or columns (flat) each count from their own first whole hex, which absorbs the stagger.
 * Labels are `column-row` ("0304"), `letter-number` ("C4") or `sequential` (reading order). Pure.
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
  key: string;
  col: number;
  row: number;
  center: { x: number; y: number };
}

function label(numbering: NonNullable<BoardGrid['numbers']>, cell: Cell, cols: number, rows: number, order: number): string {
  if (numbering === 'sequential') return String(order + 1);
  if (numbering === 'letter-number') return `${columnLetters(cell.col + 1)}${cell.row + 1}`;
  const pad = (value: number, count: number): string => String(value).padStart(Math.max(2, String(count).length), '0');
  return `${pad(cell.col + 1, cols)}${pad(cell.row + 1, rows)}`;
}

function squareCells(grid: BoardGrid, width: number, height: number): Cell[] {
  const margin = grid.size * EDGE_MARGIN;
  const offX = ((grid.offsetX % grid.size) + grid.size) % grid.size;
  const offY = ((grid.offsetY % grid.size) + grid.size) % grid.size;
  const first = (off: number): number => Math.ceil((margin - off) / grid.size - 0.5 - EPSILON);
  const last = (extent: number, off: number): number => Math.floor((extent - margin - off) / grid.size - 0.5 + EPSILON);
  const [c0, c1, r0, r1] = [first(offX), last(width, offX), first(offY), last(height, offY)];
  const cells: Cell[] = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      cells.push({ key: `${col},${row}`, col: col - c0, row: row - r0, center: { x: offX + (col + 0.5) * grid.size, y: offY + (row + 0.5) * grid.size } });
    }
  }
  return cells;
}

function hexCells(grid: BoardGrid, width: number, height: number): Cell[] {
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
  const cells: Cell[] = [];
  for (let line = firstLine; line <= lastLine; line++) {
    const phase = line / 2;
    const firstHex = Math.ceil((margin - along.origin) / grid.size - phase - EPSILON);
    const lastHex = Math.floor((along.extent - margin - along.origin) / grid.size - phase + EPSILON);
    for (let index = firstHex; index <= lastHex; index++) {
      const [q, r] = pointy ? [index, line] : [line, index];
      const inLine = index - firstHex;
      const lineNumber = line - firstLine;
      cells.push({
        key: `${q},${r}`,
        col: pointy ? inLine : lineNumber,
        row: pointy ? lineNumber : inLine,
        center: axialCenter(grid, q, r),
      });
    }
  }
  return cells;
}

/** The numbered cells of a `width` × `height` map, by the grid's numbering. */
export function numberCells(grid: BoardGrid, width: number, height: number): CellNumbers {
  const numbering = grid.numbers;
  if (!numbering || !grid.enabled) return { at: () => null };
  const square = grid.type === 'square';
  const cells = square ? squareCells(grid, width, height) : hexCells(grid, width, height);
  const cols = Math.max(0, ...cells.map((cell) => cell.col + 1));
  const rows = Math.max(0, ...cells.map((cell) => cell.row + 1));
  const ordered = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const byKey = new Map<string, NumberedCell>();
  ordered.forEach((cell, order) => byKey.set(cell.key, { label: label(numbering, cell, cols, rows, order), center: cell.center }));
  return {
    at: (x, y) => {
      if (square) {
        const offX = ((grid.offsetX % grid.size) + grid.size) % grid.size;
        const offY = ((grid.offsetY % grid.size) + grid.size) % grid.size;
        return byKey.get(`${Math.floor((x - offX) / grid.size)},${Math.floor((y - offY) / grid.size)}`) ?? null;
      }
      const { q, r } = hexAxial(grid, x, y);
      return byKey.get(`${q},${r}`) ?? null;
    },
  };
}
