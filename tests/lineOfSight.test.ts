import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSee, visibilityPolygon } from '../src/board/lineOfSight';
import type { BoardWall } from '../src/board/walls';

const wall = (x1: number, y1: number, x2: number, y2: number, over: Partial<BoardWall> = {}): BoardWall => ({
  id: `${x1},${y1}-${x2},${y2}`, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over,
});
const at = (x: number, y: number) => ({ x, y });

test('a solid wall stops sight, and open ground does not', () => {
  const walls = [wall(50, -100, 50, 100)];
  assert.equal(canSee(at(0, 0), at(100, 0), walls), false);
  assert.equal(canSee(at(0, 0), at(40, 20), walls), true);
  assert.equal(canSee(at(0, 0), at(100, 250), walls), true);
});

test('a shut door stops sight and an open one lets it through; a secret door shut stops it too', () => {
  assert.equal(canSee(at(0, 0), at(100, 0), [wall(50, -10, 50, 10, { type: 'door' })]), false);
  assert.equal(canSee(at(0, 0), at(100, 0), [wall(50, -10, 50, 10, { type: 'door', closed: false })]), true);
  assert.equal(canSee(at(0, 0), at(100, 0), [wall(50, -10, 50, 10, { type: 'secret-door' })]), false);
});

test('glass (stops only light) lets sight through, a curtain (stops sight) does not', () => {
  assert.equal(canSee(at(0, 0), at(100, 0), [wall(50, -10, 50, 10, { blocks: 'light' })]), true);
  assert.equal(canSee(at(0, 0), at(100, 0), [wall(50, -10, 50, 10, { blocks: 'sight' })]), false);
});

test('a one-way wall stops sight from its marked side only', () => {
  // p1 -> p2 runs down (+y); its left, by the normal (-dy, dx), is the -x side.
  const left = [wall(50, -10, 50, 10, { direction: 'left' })];
  assert.equal(canSee(at(0, 0), at(100, 0), left), false);
  assert.equal(canSee(at(100, 0), at(0, 0), left), true);
  const right = [wall(50, -10, 50, 10, { direction: 'right' })];
  assert.equal(canSee(at(0, 0), at(100, 0), right), true);
  assert.equal(canSee(at(100, 0), at(0, 0), right), false);
});

test('a limited wall lets sight through, and the second one stops it', () => {
  const one = [wall(40, -10, 40, 10, { limited: true })];
  assert.equal(canSee(at(0, 0), at(100, 0), one), true);
  const two = [...one, wall(60, -10, 60, 10, { limited: true })];
  assert.equal(canSee(at(0, 0), at(100, 0), two), false);
  assert.equal(canSee(at(0, 0), at(100, 0), [...one, wall(60, -10, 60, 10)]), false);
});

test('a line that grazes the corner where two walls join does not slip between them', () => {
  const corner = [wall(50, -100, 50, 0), wall(50, 0, 50, 100)];
  assert.equal(canSee(at(0, 0), at(100, 0), corner), false);
});

test("a viewer's polygon of sight ends at a wall that stops sight, and not at an open door", () => {
  const bounds = { x0: 0, y0: 0, x1: 400, y1: 400 };
  const wall = (closed: boolean): BoardWall => ({ id: 'd', type: 'door', p1: { x: 200, y: 0 }, p2: { x: 200, y: 400 }, direction: null, closed, locked: false, blocks: null, limited: false, chain: null } as BoardWall);
  const far = (points: Array<{ x: number; y: number }>): number => Math.max(...points.map((p) => p.x));
  assert.ok(far(visibilityPolygon({ x: 100, y: 200 }, [wall(true)], bounds)) <= 200 + 1e-6);
  assert.equal(far(visibilityPolygon({ x: 100, y: 200 }, [wall(false)], bounds)), 400);
});
