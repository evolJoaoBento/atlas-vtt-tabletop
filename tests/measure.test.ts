import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { feetPerSquare, formatDistance, pathLengthInCells, readMeasurement } from '../src/board/measure';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null, ...over,
});
const at = (cx: number, cy: number): { x: number; y: number } => ({ x: 35 + cx * 70, y: 35 + cy * 70 });

test('square paths: equidistant, alternating, exact and Manhattan diagonals', () => {
  const path = [at(0, 0), at(3, 3), at(5, 3)];
  assert.equal(pathLengthInCells(path, grid(), 'equidistant'), 5);
  // 3 diagonals: 3 + floor(3 / 2) = 4, plus 2 straight.
  assert.equal(pathLengthInCells(path, grid(), 'alternating'), 6);
  assert.ok(Math.abs(pathLengthInCells(path, grid(), 'euclidean') - (Math.hypot(3, 3) + 2)) < 1e-9);
  // Atlas 0.15: every diagonal counts 2.
  assert.equal(pathLengthInCells(path, grid(), 'manhattan'), 8);
  assert.equal(pathLengthInCells([at(0, 0)], grid(), 'manhattan'), 0);
});

test('alternating counts diagonals over the whole path, not per segment', () => {
  assert.equal(pathLengthInCells([at(0, 0), at(1, 1), at(2, 2)], grid(), 'alternating'), 3);
});

test('the height between the ends counts as a third axis under the same rule', () => {
  const leg = [at(0, 0), at(2, 0)];
  assert.equal(pathLengthInCells(leg, grid(), 'equidistant', 3), 3);
  assert.equal(pathLengthInCells(leg, grid(), 'manhattan', 3), 5);
  assert.equal(pathLengthInCells(leg, grid(), 'alternating', 3), 4);
  assert.ok(Math.abs(pathLengthInCells(leg, grid(), 'euclidean', 3) - Math.hypot(2, 3)) < 1e-9);
});

test('hex paths count hex steps', () => {
  const hex = grid({ type: 'hex-vertical' });
  const r = 70 / Math.sqrt(3);
  // Hex (0,0) centre and hex (q=2, r=0) two steps to the right.
  assert.equal(pathLengthInCells([{ x: 35, y: r }, { x: 175, y: r }], hex, 'equidistant'), 2);
});

test('measurement settings come from the collection, else from the grid', () => {
  assert.partialDeepStrictEqual(readMeasurement({ unitType: 'meters', unitDistance: 1.5, measurementMode: 'metric', diagonalRule: 'alternating' }, {}),
    { mode: 'metric', unitType: 'meters', unitDistance: 1.5, ruleDistance: 1.5, diagonalRule: 'alternating', rangeBands: [] });
  assert.partialDeepStrictEqual(readMeasurement(null, { unitType: 'yards', unitDistance: 10, measurementType: 'units' }),
    { mode: 'metric', unitType: 'yards', unitDistance: 10, diagonalRule: 'equidistant', rangeBands: [] });
  assert.partialDeepStrictEqual(readMeasurement(null, {}), { mode: 'abstract', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', rangeBands: [] });
  const bands = readMeasurement({ measurementMode: 'abstract', abstractRangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }, { name: '', maxSquares: 0.5 }] }, {});
  assert.deepEqual(bands.rangeBands, [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }]);
  // What cannot be read takes Atlas's default.
  assert.equal(readMeasurement({ measurementMode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'taxicab' }, {}).diagonalRule, 'equidistant');
  assert.equal(readMeasurement({ measurementMode: 'metric', unitType: 'miles', unitDistance: -1 }, {}).unitDistance, 5);
});

test("Manhattan and a custom unit's name, as Atlas 0.15 saves them", () => {
  const miles = readMeasurement({ measurementMode: 'metric', unitType: 'custom', unitName: ' mi ', unitDistance: 1, diagonalRule: 'manhattan' }, {});
  assert.equal(miles.diagonalRule, 'manhattan');
  assert.equal(miles.unitName, 'mi');
  assert.equal(formatDistance(6, miles), '6 mi');
  // A name is only a custom unit's.
  assert.equal(readMeasurement({ measurementMode: 'metric', unitType: 'feet', unitName: 'mi', unitDistance: 5 }, {}).unitName, undefined);
});

test("a scene's own unit name and distance per cell come first", () => {
  assert.equal(formatDistance(6, readMeasurement(null, { measurementType: 'units', unitType: 'feet', unitDistance: 5, unitNameOverride: 'ly' })), '30 ly');
  const collection = { measurementMode: 'metric', unitType: 'feet', unitDistance: 5 };
  const scene = readMeasurement(collection, { unitDistanceOverride: 10 });
  assert.equal(scene.unitDistance, 10);
  assert.equal(scene.ruleDistance, 5);
  assert.equal(formatDistance(6, scene), '60ft');
  // A spell's feet are rules squares: the collection's 5 ft, whatever the scene's cell spans.
  assert.equal(feetPerSquare(scene), 5);
  assert.equal(feetPerSquare(readMeasurement({ measurementMode: 'metric', unitType: 'meters', unitDistance: 1.5 }, {})), 5);
  assert.equal(feetPerSquare(readMeasurement({ measurementMode: 'abstract' }, {})), 5);
});

test("labels: metric with Atlas's suffixes and one decimal, abstract squares or bands", () => {
  const metric = readMeasurement({ measurementMode: 'metric', unitType: 'feet', unitDistance: 5 }, {});
  assert.equal(formatDistance(6, metric), '30ft');
  assert.equal(formatDistance(1.4142, readMeasurement({ measurementMode: 'metric', unitType: 'meters', unitDistance: 1.5 }, {})), '2.1m');
  assert.equal(formatDistance(3, { ...metric, unitType: 'custom' }), '15');
  const abstract = readMeasurement({ measurementMode: 'abstract' }, {});
  assert.equal(formatDistance(3.4, abstract), '3 sq');
  const banded = readMeasurement({ measurementMode: 'abstract', abstractRangeBands: [{ name: 'Close', maxSquares: 1 }, { name: 'Far', maxSquares: 6 }] }, {});
  assert.equal(formatDistance(1, banded), 'Close');
  assert.equal(formatDistance(4, banded), 'Far');
  assert.equal(formatDistance(9, banded), 'Far');
});
