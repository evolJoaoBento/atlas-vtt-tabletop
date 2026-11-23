import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cutArea, reachWithin, ringsOf, wallSlack } from '../src/board/areaCuts';
import { templateArea } from '../src/board/playerTools';
import type { BoardWall } from '../src/board/walls';

const wall = (x1: number, y1: number, x2: number, y2: number, over: Partial<BoardWall> = {}): BoardWall =>
  ({ id: `w${x1},${y1}`, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over });
const circle = (radius: number) => templateArea({ shape: 'circle', start: { x: 0, y: 0 }, end: { x: radius, y: 0 } }, Math.PI / 2)!;

test('a circle with no wall in its reach is the circle itself', () => {
  const shaped = circle(140);
  assert.equal(cutArea(shaped, [], {}), shaped);
  assert.equal(cutArea(shaped, [wall(5000, -100, 5000, 100)], {}), shaped);
});

test('a wall stops an area at the wall, as Atlas stops its kept areas', () => {
  const shaped = circle(140);
  const cut = cutArea(shaped, [wall(70, -400, 70, 400)], { cell: 70 });
  assert.notEqual(cut, shaped);
  assert.ok(cut.contains({ x: 30, y: 0 }));
  assert.ok(!cut.contains({ x: 100, y: 0 }), 'behind the wall');
  assert.ok(cut.contains({ x: -100, y: 0 }), 'the other way is whole');
  const xs = ringsOf(cut).flat().map((point) => point.x);
  assert.ok(Math.max(...xs) <= 70.5, 'the outline stops at the wall');
  assert.ok(Math.min(...xs) <= -139);
});

test('a closed door stops it, an open one and glass-free passages do not', () => {
  const shaped = circle(140);
  assert.ok(!cutArea(shaped, [wall(70, -400, 70, 400, { type: 'door', closed: true })], { cell: 70 }).contains({ x: 100, y: 0 }));
  assert.equal(cutArea(shaped, [wall(70, -400, 70, 400, { type: 'door', closed: false })], { cell: 70 }), shaped);
  assert.equal(cutArea(shaped, [wall(70, -400, 70, 400, { blocks: 'movement' })], { cell: 70 }), shaped, 'a window stops only a token');
  assert.ok(!cutArea(shaped, [wall(70, -400, 70, 400, { blocks: 'light' })], { cell: 70 }).contains({ x: 100, y: 0 }), 'glass stops light, and so an area');
});

test('a reach swept from an origin on the far side of a wall leaves that side only', () => {
  const walls = [wall(70, -400, 70, 400)];
  const reach = reachWithin({ x: 0, y: 0 }, { x: 1, y: 0 }, 200, walls, { cell: 70 })!;
  assert.ok(reach.contains({ x: 50, y: 40 }));
  assert.ok(!reach.contains({ x: 120, y: 0 }));
  assert.equal(reachWithin({ x: 0, y: 0 }, { x: 1, y: 0 }, 200, [], {}), null);
  assert.equal(reachWithin({ x: 0, y: 0 }, { x: 1, y: 0 }, 200, [wall(9000, -1, 9000, 1)], {}), null);
});

test('the slack is a twelfth of a cell, four pixels at least', () => {
  assert.equal(wallSlack(undefined), 4);
  assert.equal(wallSlack(30), 4);
  assert.equal(wallSlack(120), 10);
});
