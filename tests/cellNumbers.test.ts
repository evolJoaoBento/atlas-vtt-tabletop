import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { columnLetters, numberCells } from '../src/board/cellNumbers';
import { eagerNumberCells } from './cellNumbersEager';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null,
  lineType: 'solid', numbers: 'column-row', numberOpacity: 0.8, ...over,
});
const R = 70 / Math.sqrt(3);

test('letters run A..Z, then AA', () => {
  assert.deepEqual([1, 2, 26, 27, 28, 52, 53].map(columnLetters), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
});

test('square cells: column-row, letter-number and sequential labels', () => {
  const cells = numberCells(grid(), 700, 700);
  assert.equal(cells.at(2 * 70 + 35, 3 * 70 + 35)?.label, '0304');
  assert.deepEqual(cells.at(2 * 70 + 10, 3 * 70 + 60)?.center, { x: 175, y: 245 });
  assert.equal(numberCells(grid({ numbers: 'letter-number' }), 700, 700).at(35, 35)?.label, 'A1');
  assert.equal(numberCells(grid({ numbers: 'letter-number' }), 700, 700).at(9 * 70 + 35, 35)?.label, 'J1');
  assert.equal(numberCells(grid({ numbers: 'sequential' }), 700, 700).at(2 * 70 + 35, 3 * 70 + 35)?.label, '33');
});

test('a cell cut by the map\'s edge has no number', () => {
  const cells = numberCells(grid(), 680, 700);
  assert.equal(cells.at(670, 35), null);
  assert.equal(cells.at(8 * 70 + 35, 35)?.label, '0901');
});

test('pointy hexes count each row from its first whole hex', () => {
  const cells = numberCells(grid({ type: 'hex-vertical' }), 700, 700);
  assert.equal(cells.at(35, R)?.label, '0101');
  assert.equal(cells.at(70, R + 1.5 * R)?.label, '0102');
  // Row 2 starts half a hex further left: its first whole hex is back at x = 35.
  assert.equal(cells.at(35, R + 3 * R)?.label, '0103');
  assert.equal(cells.at(105, R)?.label, '0201');
});

test('flat hexes count each column from its first whole hex', () => {
  const cells = numberCells(grid({ type: 'hex-horizontal' }), 700, 700);
  assert.equal(cells.at(R, 35)?.label, '0101');
  assert.equal(cells.at(R, 105)?.label, '0102');
  assert.equal(cells.at(R + 1.5 * R, 70)?.label, '0201');
});

test('no numbering, no numbers', () => {
  assert.equal(numberCells(grid({ numbers: null }), 700, 700).at(35, 35), null);
});

test('worked out on demand, the numbers are those of listing every cell', () => {
  let compared = 0;
  for (const type of ['square', 'hex-vertical', 'hex-horizontal'] as const) {
    for (const numbers of ['column-row', 'letter-number', 'sequential'] as const) {
      for (const [size, offsetX, offsetY, width, height] of [[70, 0, 0, 700, 700], [64, 20, -13, 905, 611], [33, 7, 5, 410, 520], [100, 250, 90, 330, 280], [70, 0, 0, 60, 900]] as const) {
        const g = grid({ type, numbers, size, offsetX, offsetY });
        const fast = numberCells(g, width, height);
        const slow = eagerNumberCells(g, width, height);
        for (let y = -20; y < height + 20; y += size / 3) {
          for (let x = -20; x < width + 20; x += size / 3) {
            assert.deepEqual(fast.at(x, y), slow.at(x, y), `${type} ${numbers} ${size} ${offsetX},${offsetY} ${width}x${height} at ${x},${y}`);
            compared++;
          }
        }
      }
    }
  }
  assert.ok(compared > 5000);
});

test('a map of 20 million squares is numbered without listing them', () => {
  const started = Date.now();
  const cells = numberCells(grid({ size: 14, numbers: 'sequential' }), 65535, 65535);
  assert.equal(cells.at(14 * 4000 + 7, 14 * 3000 + 7)?.label, String(3000 * 4681 + 4000 + 1));
  assert.equal(numberCells(grid({ size: 14, numbers: 'letter-number' }), 65535, 65535).at(7, 7)?.label, 'A1');
  const hex = numberCells(grid({ size: 14, numbers: 'sequential', type: 'hex-horizontal' }), 65535, 65535);
  assert.ok(hex.at(30000, 30000)?.label);
  assert.ok(Date.now() - started < 1500, `took ${Date.now() - started} ms`);
});
