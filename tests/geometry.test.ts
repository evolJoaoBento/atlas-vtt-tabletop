import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { axialCenter, conditionRingRadii, hexCenter, nearestFootprint, ringDiameter, sideBadgeSlots, snapPoint, tokenDiameter } from '../src/board/geometry';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null, ...over,
});
const near = (actual: { x: number; y: number }, x: number, y: number): void => {
  assert.ok(Math.abs(actual.x - x) < 1e-3 && Math.abs(actual.y - y) < 1e-3, `got (${actual.x}, ${actual.y}), want (${x}, ${y})`);
};

test('token diameter follows Atlas: 62, 186, 310 on a 70px grid', () => {
  assert.equal(tokenDiameter(grid(), 1), 62);
  assert.equal(tokenDiameter(grid(), 2), 186);
  assert.equal(tokenDiameter(grid(), 3), 310);
  assert.equal(ringDiameter(grid(), 1), 70);
});

test('square snapping goes to the cell centre, with offsets', () => {
  near(snapPoint(grid({ size: 26.033, offsetX: 15.82, offsetY: 13.79 }), 100, 100), 106.9355, 104.9055);
});

test('pointy-top hex snapping', () => {
  const hex = grid({ type: 'hex-vertical' });
  near(snapPoint(hex, 36, 42), 35, 70 / Math.sqrt(3));
  near(snapPoint(hex, 141, 100), 140, 70 / Math.sqrt(3) * 2.5);
});

test('flat-top hex snapping', () => {
  near(snapPoint(grid({ type: 'hex-horizontal' }), 100, 71), 70 / Math.sqrt(3) * 2.5, 70);
});

test('a token covering an even number of cells snaps to the meeting of its cells', () => {
  near(snapPoint(grid(), 100, 100, 1.5), 70, 70);
  near(snapPoint(grid(), 100, 100, 2.5), 70, 70);
  near(snapPoint(grid(), 100, 100, 2), 105, 105);
  near(snapPoint(grid(), 100, 100, 1), 105, 105);
  near(snapPoint(grid({ offsetX: 10, offsetY: 20 }), 100, 100, 1.5), 80, 90);
});

test('even-sized tokens on hex grids stand half a hex off a centre', () => {
  const hex = grid({ type: 'hex-vertical' });
  const c = axialCenter(hex, 1, 1);
  near(snapPoint(hex, c.x + 36, c.y + 70 / Math.sqrt(3) / 2 + 1, 1.5), c.x + 35, c.y + 70 / Math.sqrt(3) / 2);
  near(snapPoint(hex, c.x + 1, c.y + 1, 2), c.x, c.y);
});

test('no snapping when the map turns it off or has no grid', () => {
  near(snapPoint(grid({ snap: false }), 12.3, 45.6), 12.3, 45.6);
  near(snapPoint(grid({ enabled: false }), 12.3, 45.6), 12.3, 45.6);
});

test('hexCenter is the snapped hex even when snapping is off', () => {
  near(hexCenter(grid({ type: 'hex-vertical', snap: false }), 36, 42), 35, 70 / Math.sqrt(3));
});

test('side badges alternate left and right, two to a row', () => {
  assert.deepEqual(sideBadgeSlots(5), [{ side: -1, row: 0 }, { side: 1, row: 0 }, { side: -1, row: 1 }, { side: 1, row: 1 }, { side: -1, row: 2 }]);
  assert.deepEqual(sideBadgeSlots(0), []);
});

test('condition rings widen one after another', () => {
  assert.deepEqual(conditionRingRadii(10, 3, 2, 1), [12, 15, 18]);
});

test('nearestFootprint grabs the nearest token whose widened ground holds the point, none beyond', () => {
  const tokens = [{ id: 'a', x: 0, y: 0, radius: 35 }, { id: 'b', x: 100, y: 0, radius: 35 }];
  assert.equal(nearestFootprint({ x: 10, y: 0 }, tokens)?.id, 'a');
  assert.equal(nearestFootprint({ x: 45, y: 0 }, tokens), null);
  assert.equal(nearestFootprint({ x: 45, y: 0 }, tokens, 1.5)?.id, 'a');
  assert.equal(nearestFootprint({ x: 60, y: 0 }, tokens, 1.5)?.id, 'b');
  assert.equal(nearestFootprint({ x: 50, y: 200 }, tokens, 1.5), null);
});

test('Atlas 0.18: a Tiny token (0.75) snaps to the quarter of the square cell nearest the pointer', () => {
  near(snapPoint(grid(), 90, 100, 0.75), 87.5, 87.5);
  near(snapPoint(grid(), 130, 120, 0.75), 122.5, 122.5);
  near(snapPoint(grid(), 130, 90, 0.75), 122.5, 87.5);
  near(snapPoint(grid({ offsetX: 10, offsetY: 20 }), 100, 100, 0.75), 97.5, 107.5);
  // The centre itself counts as the lower-left quarter, as in Atlas (`<=`).
  near(snapPoint(grid(), 105, 105, 0.75), 87.5, 87.5);
});

test('Atlas 0.18: a Small token (0.875) stands at the cell centre; hex grids and an unsnapped map are unchanged', () => {
  near(snapPoint(grid(), 90, 100, 0.875), 105, 105);
  near(snapPoint(grid({ type: 'hex-horizontal' }), 100, 71, 0.75), 70 / Math.sqrt(3) * 2.5, 70);
  near(snapPoint(grid({ snap: false }), 90, 100, 0.75), 90, 100);
});

test('Atlas 0.18 in the ported sizing: Tiny 0.75 and Small 0.875 in the menu and the statblock map; the ported snap takes the quarter', async () => {
  const { TOKEN_SIZE_OPTIONS, tokenSizeFromCreatureSize } = await import('../src/atlasPort/app/pixi/token-renderer/tokenSizing');
  const { snapTokenCenter } = await import('../src/atlasPort/app/grid/gridPlacement');
  assert.deepEqual(TOKEN_SIZE_OPTIONS.map((option: { size: number }) => option.size), [0.75, 0.875, 1, 1.5, 2, 2.5]);
  assert.equal(tokenSizeFromCreatureSize('Tiny'), 0.75);
  assert.equal(tokenSizeFromCreatureSize('Small'), 0.875);
  const toCell = (p: { x: number; y: number }): { x: number; y: number } => ({ x: Math.floor(p.x / 70) * 70 + 35, y: Math.floor(p.y / 70) * 70 + 35 });
  near(snapTokenCenter({ x: 100, y: 120 }, 0.75, 'square', 70, toCell), 87.5, 122.5);
  near(snapTokenCenter({ x: 100, y: 120 }, 0.875, 'square', 70, toCell), 105, 105);
});
