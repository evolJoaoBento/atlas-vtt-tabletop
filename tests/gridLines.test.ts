import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { dashes, gridEdges, gridEdgeCount, gridLines, MAX_GRID_EDGES, styledGrid } from '../src/board/gridLines';

const grid = (over: Partial<BoardGrid> = {}): BoardGrid => ({
  enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.7, lineWidth: 1, color: null,
  lineType: 'solid', numbers: null, numberOpacity: 0.8, ...over,
});
const close = (a: number[], b: number[]): void => {
  assert.equal(a.length, b.length, `${a} vs ${b}`);
  a.forEach((value, i) => assert.ok(Math.abs(value - b[i]!) < 1e-3, `${a} vs ${b}`));
};

test('square edges: every cell side, clipped to the map', () => {
  // 2 × 2 cells: 3 vertical lines of 2 sides and 3 horizontal lines of 2 sides.
  assert.equal(gridEdges(grid(), 140, 140).length / 4, 12);
});

test('a dashed edge has two centred dashes (Atlas: gap 4, shortened to 0.8)', () => {
  close(dashes(0, 0, 70, 0), [7.8667, 0, 31.0667, 0, 38.9333, 0, 62.1333, 0]);
});

test('a short edge falls back to one dash, and a tiny one to none', () => {
  assert.equal(dashes(0, 0, 14, 0).length, 4);
  assert.equal(dashes(0, 0, 5, 0).length, 0);
});

test('solid draws the edges, dashed their dashes, dotted a mark at each corner', () => {
  const edges = gridEdges(grid(), 140, 140);
  // A solid square grid is whole lines across the map: the same ground covered, three each way instead of twelve edges.
  assert.equal(styledGrid(grid(), 140, 140).segments.length / 4, 6);
  assert.equal(styledGrid(grid({ lineType: 'dashed' }), 140, 140).segments.length, edges.length * 2);
  const dotted = styledGrid(grid({ lineType: 'dotted' }), 140, 140);
  assert.equal(dotted.segments.length, edges.length * 2);
  // Every arm starts at a grid corner and is max(3, 70 × 0.08) = 5.6 long.
  for (let i = 0; i < dotted.segments.length; i += 4) {
    const [x1, y1, x2, y2] = dotted.segments.slice(i, i + 4) as [number, number, number, number];
    assert.ok(Math.abs(x1 % 70) < 1e-6 && Math.abs(y1 % 70) < 1e-6);
    assert.ok(Math.abs(Math.hypot(x2 - x1, y2 - y1) - 5.6) < 1e-6);
  }
});

test('hex grids give each hex edge once', () => {
  const edges = gridEdges(grid({ type: 'hex-vertical' }), 300, 300);
  const keys = new Set<string>();
  for (let i = 0; i < edges.length; i += 4) {
    const a = `${edges[i]!.toFixed(1)},${edges[i + 1]!.toFixed(1)}`;
    const b = `${edges[i + 2]!.toFixed(1)},${edges[i + 3]!.toFixed(1)}`;
    keys.add([a, b].sort().join('|'));
  }
  assert.equal(keys.size, edges.length / 4);
  assert.ok(keys.size > 20);
});

const length = (segments: readonly number[]): number => {
  let sum = 0;
  for (let i = 0; i < segments.length; i += 4) sum += Math.hypot(segments[i + 2]! - segments[i]!, segments[i + 3]! - segments[i + 1]!);
  return sum;
};

test('whole lines cover what the cell edges do, with an offset too', () => {
  for (const over of [{}, { offsetX: 25, offsetY: -30 }, { size: 33 }]) {
    assert.ok(Math.abs(length(gridLines(grid(over), 410, 300)) - length(gridEdges(grid(over), 410, 300))) < 1e-6, JSON.stringify(over));
  }
});

test('a map of 20 million squares draws a few thousand lines at once, not 40 million edges', () => {
  // 65,535 pixels a side, 14 pixel cells: 4,681 cells a side.
  const fine = grid({ size: 14 });
  assert.ok(gridEdgeCount(fine, 65535, 65535) > MAX_GRID_EDGES);
  const started = Date.now();
  const solid = styledGrid(fine, 65535, 65535).segments;
  assert.ok(solid.length / 4 < 10_000);
  // Dashes cannot be merged: the lines stand in for them.
  assert.deepEqual(styledGrid(grid({ size: 14, lineType: 'dashed' }), 65535, 65535).segments, solid);
  // Hexes cannot either: none are drawn, and it takes no time to say so.
  assert.deepEqual(styledGrid(grid({ size: 14, type: 'hex-vertical' }), 65535, 65535).segments, []);
  assert.ok(Date.now() - started < 1000);
});

test('an ordinary map still draws its dashes and hexes cell by cell', () => {
  assert.ok(gridEdgeCount(grid({ type: 'hex-vertical' }), 2000, 2000) < MAX_GRID_EDGES);
  assert.ok(styledGrid(grid({ type: 'hex-vertical' }), 300, 300).segments.length > 0);
});
