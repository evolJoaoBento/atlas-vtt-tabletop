import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillTriangles, inkTriangles, underBox } from '../src/board/ink';
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
    b: { id: 'b', kind: 'drawing', type: 'pen', timestamp: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1, closed: false, fill: null, holes: [], hidden: false },
    a: { id: 'a', kind: 'drawing', type: 'rectangle', timestamp: 1, points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], color: '#00ff00', width: 2, opacity: 0.5, closed: false, fill: null, holes: [], hidden: false },
    c: { id: 'c', kind: 'drawing', type: 'icon', icon: 'gem', points: [{ x: 1, y: 1 }] },
    d: { id: 'd', kind: 'drawing', type: 'pen', points: [] },
  } } } }));
  assert.deepEqual(map.inks, [
    { id: 'b', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#ff0000', width: 4, opacity: 1, closed: false, fill: null, holes: [], hidden: false, rank: 0, layer: 'above' },
    { id: 'a', points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], color: '#00ff00', width: 2, opacity: 0.5, closed: false, fill: null, holes: [], hidden: false, rank: 1, layer: 'above' },
  ]);
});

test("a closed drawing's fill covers its inside and none of its holes (Atlas 0.16)", () => {
  const square = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 0 }];
  const hole = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }];
  assert.ok(Math.abs(covered(fillTriangles(square, []), -5, 45, -5, 45) - 1600) < 25);
  assert.ok(Math.abs(covered(fillTriangles(square, [hole]), -5, 45, -5, 45) - 1500) < 25);
  // Wound the other way, the same.
  assert.ok(Math.abs(covered(fillTriangles([...square].reverse(), [hole]), -5, 45, -5, 45) - 1500) < 25);
  // Fewer than three corners: nothing.
  assert.equal(fillTriangles([{ x: 0, y: 0 }, { x: 1, y: 1 }], []).length, 0);
});

test("a fill is Atlas's: a self-crossing outline filled by the nonzero rule, a hole cut only inside the outline", () => {
  // A bow tie: two triangles meeting at (50, 50), each filled.
  const bow = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
  const tie = covered(fillTriangles(bow, []), -5, 105, -5, 105);
  assert.ok(Math.abs(tie - 5000) < 250, String(tie));
  // Nothing of the empty wedges between them.
  assert.ok(covered(fillTriangles(bow, []), 40, 60, 0, 30) < 40);
  // A hole reaching past the outline paints nothing outside it.
  const square = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, { x: 0, y: 0 }];
  const out = [{ x: 30, y: 10 }, { x: 60, y: 10 }, { x: 60, y: 30 }, { x: 30, y: 30 }];
  assert.ok(covered(fillTriangles(square, [out]), 40.5, 70, 0, 40) < 5);
  assert.ok(Math.abs(covered(fillTriangles(square, [out]), -5, 45, -5, 45) - (1600 - 200)) < 60);
});

test("what an opaque box above the tokens covers is out of the players' sight: a point inside it, not in its hole, not under a soft or see-through or map-layer fill", () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }, { x: 0, y: 0 }];
  const hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
  const box = { id: 'b', points: square, color: '#000000', width: 0, opacity: 1, closed: true, fill: 'solid' as const, holes: [hole], hidden: false, layer: 'above' as const };
  assert.equal(underBox([box], { x: 20, y: 20 }), true);
  assert.equal(underBox([box], { x: 50, y: 50 }), false);
  assert.equal(underBox([box], { x: 150, y: 20 }), false);
  for (const other of [{ fill: 'soft' as const }, { opacity: 0.6 }, { layer: 'map' as const }]) assert.equal(underBox([{ ...box, ...other }], { x: 20, y: 20 }), false, JSON.stringify(other));
});
