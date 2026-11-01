import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canSee, inSight, readSightMode } from '../src/board/lineOfSight';
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

test('a piece is in sight when any viewer sees it; with no viewer everything is', () => {
  const walls = [wall(50, -100, 50, 100)];
  const pieces = [{ key: 'near', at: at(20, 0) }, { key: 'far', at: at(100, 0) }];
  assert.deepEqual([...inSight([at(0, 0)], pieces, walls)], ['near']);
  assert.deepEqual([...inSight([at(0, 0), at(150, 0)], pieces, walls)].sort(), ['far', 'near'].sort());
  assert.deepEqual([...inSight([], pieces, walls)].sort(), ['far', 'near'].sort());
});

test('the setting reads back as stored, and anything else is off', () => {
  for (const mode of ['off', 'players', 'everyone'] as const) assert.equal(readSightMode(mode), mode);
  for (const bad of [undefined, true, 'on', 3]) assert.equal(readSightMode(bad), 'off');
});

test('many walls and pieces are judged quickly', () => {
  const walls: BoardWall[] = [];
  for (let i = 0; i < 600; i++) walls.push(wall((i % 30) * 70, Math.floor(i / 30) * 70, (i % 30) * 70 + 70, Math.floor(i / 30) * 70));
  const pieces = Array.from({ length: 80 }, (_, i) => ({ key: String(i), at: at((i % 20) * 100, Math.floor(i / 20) * 100 + 35) }));
  const start = performance.now();
  inSight([at(35, 35), at(900, 700), at(1500, 300), at(300, 1200)], pieces, walls);
  assert.ok(performance.now() - start < 250, `took ${performance.now() - start} ms`);
});

import { seenTiles, tilesFor, visibilityPolygon } from '../src/board/lineOfSight';

const bounds = { x0: 0, y0: 0, x1: 700, y1: 700 };

test('the sight polygon of an open map is the whole map', () => {
  const polygon = visibilityPolygon(at(350, 350), [], bounds);
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const seen = seenTiles([polygon], [at(350, 350)], tiles);
  assert.equal(seen.length, 100);
  assert.ok(seen.every((value) => value === 1));
});

test('a wall across the map hides the squares behind it and keeps the ones before it', () => {
  // A wall along x = 350 from the top to the bottom of the map, with the viewer to its left.
  const polygon = visibilityPolygon(at(105, 350), [wall(350, 0, 350, 700)], bounds);
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const seen = seenTiles([polygon], [at(105, 350)], tiles);
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) assert.equal(seen[row * 10 + col], col < 5 ? 1 : 0, `col ${col} row ${row}`);
});

test('a shut door hides the room behind it, and an open one shows a cone of it', () => {
  // A wall along x = 350 with a door in its middle (y 280 to 420).
  const frame = [wall(350, 0, 350, 280), wall(350, 420, 350, 700)];
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const view = (door: BoardWall): Uint8Array => seenTiles([visibilityPolygon(at(105, 350), [...frame, door], bounds)], [at(105, 350)], tiles);
  const shut = view(wall(350, 280, 350, 420, { type: 'door' }));
  const open = view(wall(350, 280, 350, 420, { type: 'door', closed: false }));
  const behind = (seen: Uint8Array): number => { let count = 0; for (let row = 0; row < 10; row++) for (let col = 5; col < 10; col++) count += seen[row * 10 + col]!; return count; };
  assert.equal(behind(shut), 0);
  assert.ok(behind(open) > 5);
  // Straight through the door is seen, the corner of the room beside the wall is not.
  assert.equal(open[5 * 10 + 8], 1);
  assert.equal(open[0 * 10 + 9], 0);
});

test('tiles start at the grid lines whatever the offset, and cover the map', () => {
  const tiles = tilesFor(1400, 1000, 70, 25, 10);
  assert.ok(tiles.startX <= 0 && tiles.startX > -70);
  assert.ok(tiles.startX + tiles.cols * 70 >= 1400);
  assert.ok(tiles.startY + tiles.rows * 70 >= 1000);
  assert.ok((tiles.startX - 25) % 70 === 0);
});

test('a big map is swept quickly', () => {
  const walls: BoardWall[] = [];
  for (let i = 0; i < 600; i++) walls.push(wall((i % 30) * 70, Math.floor(i / 30) * 70, (i % 30) * 70 + 70, Math.floor(i / 30) * 70));
  const start = performance.now();
  for (const viewer of [at(35, 35), at(900, 700), at(1500, 300), at(300, 1200)]) {
    const polygon = visibilityPolygon(viewer, walls, { x0: 0, y0: 0, x1: 2100, y1: 1400 });
    seenTiles([polygon], [viewer], tilesFor(2100, 1400, 70, 0, 0));
  }
  assert.ok(performance.now() - start < 1500, `took ${performance.now() - start} ms`);
});

import { connectedTiles, readSightStyle } from '../src/board/lineOfSight';

/** A building of two by two squares at (x, y), its walls whole, with a door one square wide in its east wall. */
function building(x: number, y: number, door: 'shut' | 'open' | 'none'): BoardWall[] {
  const w = 140;
  // The east wall is a solid square and a door one square wide, on the squares' own lines.
  const parts = [wall(x, y, x + w, y), wall(x + w, y, x + w, y + 70), wall(x + w, y + w, x, y + w), wall(x, y + w, x, y)];
  if (door !== 'none') parts.push(wall(x + w, y + 70, x + w, y + w, { type: 'door', closed: door === 'shut' }));
  else parts.push(wall(x + w, y + 70, x + w, y + w));
  return parts;
}

test('cinematic: a viewer in a sealed building sees all of it and nothing outside', () => {
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const seen = connectedTiles([at(105, 105)], building(70, 70, 'shut'), tiles);
  const at2 = (col: number, row: number): number => seen[row * 10 + col]!;
  for (const [col, row] of [[1, 1], [2, 1], [1, 2], [2, 2]]) assert.equal(at2(col, row), 1, `inside ${col},${row}`);
  assert.equal(at2(5, 5), 0);
  assert.equal(at2(0, 0), 0);
  assert.equal(seen.reduce((sum, value) => sum + value, 0), 4);
});

test('cinematic: with a door open the viewer sees the whole outside as well', () => {
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const seen = connectedTiles([at(105, 105)], building(70, 70, 'open'), tiles);
  assert.equal(seen[5 * 10 + 5], 1);
  assert.equal(seen[9 * 10 + 9], 1);
  assert.equal(seen[0], 1);
});

test('cinematic: outside, every other sealed building is black as a whole, until a door of its own opens', () => {
  const tiles = tilesFor(1400, 700, 70, 0, 0);
  const cols = tiles.cols;
  const shut = connectedTiles([at(35, 35)], [...building(70, 70, 'shut'), ...building(700, 280, 'shut')], tiles);
  for (const [col, row] of [[1, 1], [2, 2], [10, 4], [11, 5]]) assert.equal(shut[row * cols + col], 0, `shut building ${col},${row}`);
  assert.equal(shut[0], 1);
  assert.equal(shut[4 * cols + 4], 1);
  const opened = connectedTiles([at(35, 35)], [...building(70, 70, 'shut'), ...building(700, 280, 'open')], tiles);
  assert.equal(opened[4 * cols + 10], 1);
  assert.equal(opened[5 * cols + 11], 1);
  assert.equal(opened[1 * cols + 1], 0);
});

test('cinematic: a one-way wall lets a viewer through on the open side only', () => {
  const tiles = tilesFor(700, 700, 70, 0, 0);
  const oneWay = [wall(350, 0, 350, 700, { direction: 'left' })];
  // p1 -> p2 runs down; its left is the -x side, which is stopped. The right side sees across.
  assert.equal(connectedTiles([at(105, 350)], oneWay, tiles)[5 * 10 + 8], 0);
  assert.equal(connectedTiles([at(595, 350)], oneWay, tiles)[5 * 10 + 1], 1);
});

test('the sight style reads back as stored, and anything else is rays', () => {
  assert.equal(readSightStyle('cinematic'), 'cinematic');
  for (const bad of [undefined, 'rays', 'x', 1]) assert.equal(readSightStyle(bad), 'rays');
});
