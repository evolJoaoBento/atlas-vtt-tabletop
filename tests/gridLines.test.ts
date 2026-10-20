import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BoardGrid } from '../src/board/mapModel';
import { dashes, gridEdges, styledGrid } from '../src/board/gridLines';

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
  assert.equal(styledGrid(grid(), 140, 140).segments.length, edges.length);
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
