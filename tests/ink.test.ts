import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inkTriangles } from '../src/board/ink';
import { readMap } from '../src/board/mapModel';

/** The triangles' covered area, overlaps counted once, by sampling a grid of points. */
function covered(triangles: Float32Array, minX: number, maxX: number, minY: number, maxY: number): number {
  const inside = (px: number, py: number): boolean => {
    for (let i = 0; i < triangles.length; i += 6) {
      const [ax, ay, bx, by, cx, cy] = Array.from(triangles.subarray(i, i + 6));
      const d1 = (px - bx!) * (ay! - by!) - (ax! - bx!) * (py - by!);
      const d2 = (px - cx!) * (by! - cy!) - (bx! - cx!) * (py - cy!);
      const d3 = (px - ax!) * (cy! - ay!) - (cx! - ax!) * (py - ay!);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  };
  let hits = 0;
  for (let x = minX; x < maxX; x += 0.5) for (let y = minY; y < maxY; y += 0.5) if (inside(x + 0.25, y + 0.25)) hits++;
  return hits * 0.25;
}

test('a stroke is its path, as wide as the pen, with round ends', () => {
  const triangles = inkTriangles([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
  const area = covered(triangles, -10, 110, -10, 10);
  // A 100 × 10 band and a disc of radius 5 (two half discs at its ends).
  assert.ok(Math.abs(area - (1000 + Math.PI * 25)) < 15, String(area));
});

test('a corner is rounded, not notched', () => {
  const triangles = inkTriangles([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }], 10);
  // The outside of the corner, where two plain bands would leave a notch.
  const corner = covered(triangles, 50, 55, -5, 0);
  assert.ok(corner > 15, String(corner));
});

test('a single point is a dot as wide as the pen; no points draw nothing', () => {
  const dot = covered(inkTriangles([{ x: 0, y: 0 }], 10), -6, 6, -6, 6);
  assert.ok(Math.abs(dot - Math.PI * 25) < 6, String(dot));
  assert.equal(inkTriangles([], 10).length, 0);
});

test('pen strokes are read from the map\'s drawings, in its order; icon stamps are not ink', () => {
  const map = readMap('m', JSON.stringify({ state: { objects: { tokens: {}, pins: {}, drawings: {
    b: { id: 'b', kind: 'drawing', type: 'pen', timestamp: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1 },
    a: { id: 'a', kind: 'drawing', type: 'rectangle', timestamp: 1, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], color: '#00ff00', width: 2, opacity: 0.5 },
    c: { id: 'c', kind: 'drawing', type: 'icon', icon: 'gem', points: [{ x: 1, y: 1 }] },
    d: { id: 'd', kind: 'drawing', type: 'pen', points: [] },
  } } } }));
  assert.deepEqual(map.inks, [
    { id: 'b', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1 },
    { id: 'a', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], color: '#00ff00', width: 2, opacity: 0.5 },
  ]);
});
