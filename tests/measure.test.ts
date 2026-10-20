import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { formatDistance, pathLengthInCells, readMeasurement } from '../src/board/measure';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null, ...over,
});
const at = (cx: number, cy: number): { x: number; y: number } => ({ x: 35 + cx * 70, y: 35 + cy * 70 });

test('square paths: equidistant, alternating and exact diagonals', () => {
  const path = [at(0, 0), at(3, 3), at(5, 3)];
  assert.equal(pathLengthInCells(path, grid(), 'equidistant'), 5);
  // 3 diagonals: 3 + floor(3 / 2) = 4, plus 2 straight.
  assert.equal(pathLengthInCells(path, grid(), 'alternating'), 6);
  assert.ok(Math.abs(pathLengthInCells(path, grid(), 'euclidean') - (Math.hypot(3, 3) + 2)) < 1e-9);
});

test('alternating counts diagonals over the whole path, not per segment', () => {
  assert.equal(pathLengthInCells([at(0, 0), at(1, 1), at(2, 2)], grid(), 'alternating'), 3);
});

test('hex paths count hex steps', () => {
  const hex = grid({ type: 'hex-vertical' });
  const r = 70 / Math.sqrt(3);
  // Hex (0,0) centre and hex (q=2, r=0) two steps to the right.
  assert.equal(pathLengthInCells([{ x: 35, y: r }, { x: 175, y: r }], hex, 'equidistant'), 2);
});

test('measurement settings come from the collection, else from the grid', () => {
  assert.deepEqual(readMeasurement({ unitType: 'meters', unitDistance: 1.5, measurementMode: 'metric', diagonalRule: 'alternating' }, {}),
    { mode: 'metric', unitType: 'meters', unitDistance: 1.5, diagonalRule: 'alternating', bands: [] });
  assert.deepEqual(readMeasurement(null, { unitType: 'yards', unitDistance: 10, measurementType: 'units' }),
    { mode: 'metric', unitType: 'yards', unitDistance: 10, diagonalRule: 'equidistant', bands: [] });
  assert.deepEqual(readMeasurement(null, {}), { mode: 'abstract', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', bands: [] });
  const bands = readMeasurement({ measurementMode: 'abstract', abstractRangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }, { name: '', maxSquares: 0.5 }] }, {});
  assert.deepEqual(bands.bands, [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }]);
});

test('labels: metric with Atlas\'s suffixes, abstract squares or bands', () => {
  const metric = readMeasurement({ measurementMode: 'metric', unitType: 'feet', unitDistance: 5 }, {});
  assert.equal(formatDistance(6, metric), '30ft');
  assert.equal(formatDistance(1.4142, { ...metric, unitType: 'meters', unitDistance: 1.5 }), '2m');
  assert.equal(formatDistance(3, { ...metric, unitType: 'custom' }), '15');
  const abstract = readMeasurement({ measurementMode: 'abstract' }, {});
  assert.equal(formatDistance(3.4, abstract), '3 sq');
  const banded = readMeasurement({ measurementMode: 'abstract', abstractRangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }] }, {});
  assert.equal(formatDistance(1, banded), 'Close');
  assert.equal(formatDistance(4, banded), 'Far');
  assert.equal(formatDistance(9, banded), 'Far');
});
