import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageToWorld, readMapStretch, stretchPlacement, worldSize } from '../src/board/mapStretch';

const near = (actual: number, expected: number, message?: string): void => assert.ok(Math.abs(actual - expected) < 1e-6, `${message ?? ''} ${actual} vs ${expected}`);
const IMAGE = { width: 1000, height: 600 };

test('readMapStretch takes what Atlas takes and nothing else', () => {
  assert.equal(readMapStretch(undefined), null);
  assert.equal(readMapStretch({ x: 1, y: 1 }), null);
  assert.equal(readMapStretch({ x: 0.9, y: 1 }), null);
  assert.equal(readMapStretch({ x: 1.6, y: 1 }), null);
  assert.equal(readMapStretch({ x: 1.1, y: 1, rotation: 6 }), null);
  assert.deepEqual(readMapStretch({ x: 1.1, y: 1.2 }), { x: 1.1, y: 1.2 });
  assert.deepEqual(readMapStretch({ x: 1, y: 1, rotation: -2 }), { x: 1, y: 1, rotation: -2 });
});

test('a stretch without a turn only widens the world', () => {
  assert.deepEqual(worldSize(IMAGE, { x: 1.2, y: 1.1 }), { width: 1200, height: 660 });
  assert.deepEqual(imageToWorld({ x: 500, y: 300 }, IMAGE, { x: 1.2, y: 1.1 }), { x: 600, y: 330 });
  assert.deepEqual(imageToWorld({ x: 0, y: 0 }, IMAGE, { x: 1.2, y: 1.1 }), { x: 0, y: 0 });
});

test('a turned image sits in a bigger box, and its plane placement agrees with Atlas mapping', () => {
  const stretch = { x: 1.1, y: 1.2, rotation: 3, offset: { x: 20, y: 10 } };
  const world = worldSize(IMAGE, stretch);
  assert.ok(world.width > 1000 * 1.1 && world.height > 600 * 1.2);
  const placement = stretchPlacement(IMAGE, stretch);
  const centre = imageToWorld({ x: 500, y: 300 }, IMAGE, stretch);
  near(placement.centre.x * placement.scale.x, centre.x, 'centre x');
  near(placement.centre.y * placement.scale.y, centre.y, 'centre y');
  // Every corner: the plane turned about its centre (Y rotation in x/z), then the group's scale, lands where Atlas puts it.
  for (const [px, py] of [[0, 0], [1000, 0], [1000, 600], [0, 600]] as const) {
    const r = px - 500;
    const a = py - 300;
    const cos = Math.cos(placement.rotation);
    const sin = Math.sin(placement.rotation);
    const x = (placement.centre.x + cos * r + sin * a) * placement.scale.x;
    const y = (placement.centre.y - sin * r + cos * a) * placement.scale.y;
    const expected = imageToWorld({ x: px, y: py }, IMAGE, stretch);
    near(x, expected.x, `corner ${px},${py} x`);
    near(y, expected.y, `corner ${px},${py} y`);
  }
});

test("a level's own alignment multiplies its stretch by its scale, keeps the turn and pads by the offset (Atlas's Uf)", async () => {
  const { readLevelAlignment } = await import('../src/board/mapStretch');
  assert.equal(readLevelAlignment(undefined), undefined);
  assert.equal(readLevelAlignment('x'), undefined);
  assert.deepEqual(readLevelAlignment({ scale: 1.1, stretch: { x: 1.2, y: 1.1, rotation: 2 }, offset: { x: 30, y: 0 } }), { x: 1.2 * 1.1, y: 1.1 * 1.1, rotation: 2, offset: { x: 30, y: 0 } });
  assert.deepEqual(readLevelAlignment({ stretch: { x: 1.5, y: 1 } }), { x: 1.5, y: 1 });
  assert.deepEqual(readLevelAlignment({ scale: 2 }), { x: 2, y: 2 });
  assert.equal(readLevelAlignment({}), null, 'an alignment that changes nothing');
  assert.equal(readLevelAlignment({ stretch: { x: -3, y: 'a', rotation: 90 } }), null, 'nonsense reads as nothing');
});

test("the shown level's alignment replaces the scene's stretch, and a level without one keeps it", async () => {
  const { readMap } = await import('../src/board/mapModel');
  const file = (level: string | undefined): ReturnType<typeof readMap> => readMap('m', JSON.stringify({ state: {
    grid: { mapStretch: { x: 1.1, y: 1.1 } }, levels: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    levelAlignments: { b: { stretch: { x: 1.3, y: 1.2 } }, c: {} }, objects: { tokens: {}, pins: {} },
  } }), level);
  assert.deepEqual(file('a').grid.mapStretch, { x: 1.1, y: 1.1 }, 'no alignment of its own: the scene stretch');
  assert.deepEqual(file('b').grid.mapStretch, { x: 1.3, y: 1.2 });
  assert.equal(file('c').grid.mapStretch, undefined, 'an alignment of no change still replaces the scene stretch');
});
