import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pointInOutline, pointOf, readShapes, shapeGeometry, shapeHeightAt, shapeTriangles, withAdded, withoutPoint, withPoint, type TerrainShape } from '../src/board/terrainShapes';

const square = (h = 0) => [{ x: 0, y: 0, h }, { x: 100, y: 0, h }, { x: 100, y: 100, h }, { x: 0, y: 100, h }];

test('a square outline is two triangles, every corner used', () => {
  const tris = shapeTriangles({ id: 's', outline: square(), inner: [] });
  assert.equal(tris.length, 2);
  assert.deepEqual([...new Set(tris.flat())].sort(), [0, 1, 2, 3]);
});

test('a gable: a square outline and a ridge of two inner points, all of it covered', () => {
  const shape: TerrainShape = { id: 'g', outline: square(), inner: [{ x: 20, y: 50, h: 2 }, { x: 80, y: 50, h: 2 }] };
  const tris = shapeTriangles(shape);
  // 4 outline + 2 inner points in a convex outline: 2 * 6 - 2 - 4 = 6 triangles
  assert.equal(tris.length, 6);
  const area = tris.reduce((sum, [a, b, c]) => {
    const p = [...shape.outline, ...shape.inner];
    return sum + Math.abs((p[b].x - p[a].x) * (p[c].y - p[a].y) - (p[c].x - p[a].x) * (p[b].y - p[a].y)) / 2;
  }, 0);
  assert.ok(Math.abs(area - 10000) < 1e-6, `area ${area}`);
});

test('a concave (L-shaped) outline leaves its notch open', () => {
  const outline = [{ x: 0, y: 0, h: 0 }, { x: 100, y: 0, h: 0 }, { x: 100, y: 50, h: 0 }, { x: 50, y: 50, h: 0 }, { x: 50, y: 100, h: 0 }, { x: 0, y: 100, h: 0 }];
  const tris = shapeTriangles({ id: 'l', outline, inner: [] });
  for (const [a, b, c] of tris) {
    const cx = (outline[a].x + outline[b].x + outline[c].x) / 3, cy = (outline[a].y + outline[b].y + outline[c].y) / 3;
    assert.ok(pointInOutline(outline, cx, cy), `triangle centre (${cx}, ${cy}) is outside`);
  }
  const area = tris.reduce((sum, [a, b, c]) => sum + Math.abs((outline[b].x - outline[a].x) * (outline[c].y - outline[a].y) - (outline[c].x - outline[a].x) * (outline[b].y - outline[a].y)) / 2, 0);
  assert.ok(Math.abs(area - 7500) < 1e-6, `area ${area}`);
});

test('fewer than three outline corners make no surface', () => {
  assert.deepEqual(shapeTriangles({ id: 'x', outline: square().slice(0, 2), inner: [] }), []);
});

test('the height inside a triangle is spread between its corners', () => {
  const shape: TerrainShape = { id: 'g', outline: square(), inner: [{ x: 50, y: 50, h: 4 }] };
  assert.equal(shapeHeightAt(shape, 50, 50), 4);
  assert.ok(Math.abs(shapeHeightAt(shape, 25, 50)! - 2) < 1e-9);
  assert.equal(shapeHeightAt(shape, 150, 50), null);
});

test('saved shapes are read tolerantly: bad points and empty shapes dropped', () => {
  const read = readShapes([
    { id: 'a', level: 'L2', outline: [[0, 0, 1], [10, 0, 1], [10, 10, 2]], inner: [[5, 5, 3], ['x', 1, 1]], material: 'atlas-vtt/assets/materials/slate' },
    { id: 'b', outline: [[0, 0, 0], [1, 1]] },
    'junk',
    { outline: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] },
    { id: 'c', outline: [{ x: 0, y: 0, h: 0 }, { x: 4, y: 0 }, { x: 4, y: 4, h: 1 }], inner: [] },
  ]);
  assert.equal(read.length, 2);
  assert.deepEqual(read[1].outline, [{ x: 0, y: 0, h: 0 }, { x: 4, y: 0, h: 0 }, { x: 4, y: 4, h: 1 }]);
  assert.deepEqual(read[0], { id: 'a', level: 'L2', outline: [{ x: 0, y: 0, h: 1 }, { x: 10, y: 0, h: 1 }, { x: 10, y: 10, h: 2 }], inner: [{ x: 5, y: 5, h: 3 }], material: 'atlas-vtt/assets/materials/slate' });
});

test('corners are moved, raised, added and taken out by reference', () => {
  const shape: TerrainShape = { id: 's', outline: square(), inner: [] };
  const raised = withPoint(shape, { list: 'outline', index: 2 }, { h: 3 });
  assert.equal(pointOf(raised, { list: 'outline', index: 2 })?.h, 3);
  assert.equal(pointOf(shape, { list: 'outline', index: 2 })?.h, 0);
  const peaked = withAdded(raised, 'inner', { x: 50, y: 50, h: 5 });
  assert.equal(peaked.inner.length, 1);
  const cut = withoutPoint(peaked, { list: 'outline', index: 0 });
  assert.equal(cut.outline.length, 3);
  assert.equal(cut.outline[0].x, 100);
  assert.equal(withPoint(shape, { list: 'inner', index: 0 }, { h: 1 }), shape);
});

test('closed sides: a raised outline edge gets a wall down to the floor; an edge on the floor gets none', () => {
  // A gable half: eave on the floor, ridge raised; its two gable edges and the ridge edge stand walls.
  const shape: TerrainShape = { id: 'g', outline: [{ x: 0, y: 0, h: 0 }, { x: 100, y: 0, h: 2 }, { x: 100, y: 200, h: 2 }, { x: 0, y: 200, h: 0 }], inner: [], sides: true };
  const geometry = shapeGeometry(shape, 50, 1000, 1000);
  const top = geometry.groups.find((g) => g.materialIndex === 0)!;
  const side = geometry.groups.find((g) => g.materialIndex === 1)!;
  assert.equal(top.count, 2 * 3);
  // gable edges: one triangle each (one end on the floor); ridge edge: a quad (two triangles); the eave: none
  assert.equal(side.count, (1 + 2 + 1) * 3);
  const pos = geometry.getAttribute('position');
  let low = Infinity;
  for (let i = side.start; i < side.start + side.count; i++) low = Math.min(low, pos.getY(i));
  assert.equal(low, 0);
  const open = shapeGeometry({ ...shape, sides: undefined }, 50, 1000, 1000);
  assert.equal(open.groups.length, 1);
});

test('saved sides are read: true, or a material folder', () => {
  const [a, b, c] = readShapes([
    { id: 'a', outline: [[0, 0], [1, 0], [1, 1]], sides: true },
    { id: 'b', outline: [[0, 0], [1, 0], [1, 1]], sides: 'atlas-vtt/assets/materials/plank' },
    { id: 'c', outline: [[0, 0], [1, 0], [1, 1]], sides: 3 },
  ]);
  assert.equal(a.sides, true);
  assert.equal(b.sides, 'atlas-vtt/assets/materials/plank');
  assert.equal(c.sides, undefined);
});

test('closed sides face out of the shape, whichever way its outline was drawn', () => {
  for (const outline of [
    [{ x: 0, y: 0, h: 1 }, { x: 100, y: 0, h: 1 }, { x: 100, y: 100, h: 1 }, { x: 0, y: 100, h: 1 }],
    [{ x: 0, y: 0, h: 1 }, { x: 0, y: 100, h: 1 }, { x: 100, y: 100, h: 1 }, { x: 100, y: 0, h: 1 }],
  ]) {
    const geometry = shapeGeometry({ id: 's', outline, inner: [], sides: true }, 50, 1000, 1000);
    const side = geometry.groups.find((g) => g.materialIndex === 1)!;
    const pos = geometry.getAttribute('position');
    for (let i = side.start; i < side.start + side.count; i += 3) {
      const v = [0, 1, 2].map((k) => [pos.getX(i + k), pos.getY(i + k), pos.getZ(i + k)]);
      const e1 = v[1].map((c, k) => c - v[0][k]), e2 = v[2].map((c, k) => c - v[0][k]);
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const mid = [(v[0][0] + v[1][0] + v[2][0]) / 3 - 50, (v[0][2] + v[1][2] + v[2][2]) / 3 - 50];
      assert.ok(n[0] * mid[0] + n[2] * mid[1] > 0, `face ${i / 3} points in`);
    }
  }
});

test('the surface faces up, whichever way its outline was drawn', () => {
  for (const outline of [square(), [...square()].reverse()]) {
    const geometry = shapeGeometry({ id: 's', outline, inner: [{ x: 50, y: 50, h: 2 }] }, 50, 1000, 1000);
    const normal = geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i++) assert.ok(normal.getY(i) > 0, `vertex ${i} faces down`);
  }
});
