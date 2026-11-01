import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planJoins } from '../src/board/wallPieces';

const wall = (id: string, x1: number, y1: number, x2: number, y2: number) => ({ id, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

test('a wall that meets none runs half its thickness past each end, at level 0', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0)], 8);
  assert.deepEqual(joins.get('a'), { extend: [4, 4], level: 0 });
});

test('walls in line stop at their join instead of running into each other', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 200, 0)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 0]);
  assert.deepEqual(joins.get('b')!.extend, [0, 4]);
  // Nothing overlaps, so nothing needs a level.
  assert.equal(joins.get('a')!.level, 0);
  assert.equal(joins.get('b')!.level, 0);
});

test('walls in line count as in line whichever way each is drawn', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 200, 0, 100, 0)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 0]);
  assert.deepEqual(joins.get('b')!.extend, [4, 0]);
});

test('a square corner: one wall takes the corner square and the other stops at its face, so nothing overlaps', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 100, 100)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 4]);
  assert.deepEqual(joins.get('b')!.extend, [-4, 4]);
  assert.equal(joins.get('a')!.level, joins.get('b')!.level);
});

test('walls that meet at a slant keep their length and stand at different levels', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 170, 70)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 4]);
  assert.notEqual(joins.get('a')!.level, joins.get('b')!.level);
});

test('a short wall between square corners is not cut away', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 100, 10)], 8);
  assert.deepEqual(joins.get('b')!.extend, [4, 4]);
});

test('a room of four walls has no wall running into another', () => {
  const walls = [wall('n', 0, 0, 100, 0), wall('e', 100, 0, 100, 100), wall('s', 100, 100, 0, 100), wall('w', 0, 100, 0, 0)];
  const joins = planJoins(walls, 8);
  // At every corner exactly one of the two walls runs into the corner square.
  const corners: Array<[string, 0 | 1, string, 0 | 1]> = [['n', 1, 'e', 0], ['e', 1, 's', 0], ['s', 1, 'w', 0], ['w', 1, 'n', 0]];
  for (const [a, ea, b, eb] of corners) assert.equal([joins.get(a)!.extend[ea], joins.get(b)!.extend[eb]].filter((value) => value > 0).length, 1, `${a} and ${b}`);
});

test('a T: the walls in line meet flush and the wall across stops at their face, with no levels needed', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 200, 0), wall('c', 100, 0, 100, 100)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 0]);
  assert.deepEqual(joins.get('b')!.extend, [0, 4]);
  assert.deepEqual(joins.get('c')!.extend, [-4, 4]);
  assert.deepEqual([...joins.values()].map((join) => join.level), [0, 0, 0]);
});

test('a crossing: one line runs through flush, the other stops at its faces', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 200, 0), wall('c', 100, -100, 100, 0), wall('d', 100, 0, 100, 100)], 8);
  assert.deepEqual(joins.get('a')!.extend, [4, 0]);
  assert.deepEqual(joins.get('c')!.extend, [4, -4]);
  assert.deepEqual(joins.get('d')!.extend, [-4, 4]);
});

test('a slanted T keeps the levels', () => {
  const joins = planJoins([wall('a', 0, 0, 100, 0), wall('b', 100, 0, 200, 0), wall('c', 100, 0, 150, 40)], 8);
  assert.deepEqual(joins.get('c')!.extend, [4, 4]);
  assert.ok(joins.get('c')!.level !== joins.get('a')!.level);
});
