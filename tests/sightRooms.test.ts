import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRooms, insidePolygon, roomAt, roomTolerance, seenRooms, type Rooms } from '../src/board/sightRooms';
import type { BoardWall } from '../src/board/walls';

let made = 0;
const wall = (x1: number, y1: number, x2: number, y2: number, over: Partial<BoardWall> = {}): BoardWall => ({
  id: `w${made++}`, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over,
});
const at = (x: number, y: number) => ({ x, y });
/** A closed outline through the points, as walls; `door` makes the edge after point `doorAt` a door. */
const loop = (pts: Array<[number, number]>, door?: { at: number; closed: boolean }): BoardWall[] => pts.map(([x, y], index) => {
  const [nx, ny] = pts[(index + 1) % pts.length]!;
  return wall(x, y, nx, ny, door && door.at === index ? { type: 'door', closed: door.closed } : {});
});
const tol = roomTolerance(70);
const rooms = (walls: BoardWall[], w = 1400, h = 1000): Rooms => {
  const built = buildRooms(walls, w, h, tol);
  assert.ok(built, 'rooms are built');
  return built;
};
/** Whether `point` is seen from `viewer`. */
const sees = (walls: BoardWall[], viewer: [number, number], point: [number, number], w = 1400, h = 1000): boolean => {
  const built = rooms(walls, w, h);
  const seen = seenRooms(built, [at(...viewer)], walls);
  assert.ok(seen, 'the viewer stands in a room');
  const room = roomAt(built, at(...point));
  return room !== -1 && seen[room] === 1;
};

test('rooms: a viewer in a sealed room sees all of it and nothing outside', () => {
  const walls = loop([[100, 100], [400, 100], [400, 400], [100, 400]]);
  assert.equal(sees(walls, [120, 120], [390, 390]), true);
  assert.equal(sees(walls, [120, 120], [600, 600]), false);
  assert.equal(sees(walls, [600, 600], [200, 200]), false);
  assert.equal(sees(walls, [600, 600], [1300, 900]), true);
});

test('rooms: an open door joins the room to the outside; shut, it does not', () => {
  const shut = loop([[100, 100], [400, 100], [400, 400], [100, 400]], { at: 1, closed: true });
  const open = loop([[100, 100], [400, 100], [400, 400], [100, 400]], { at: 1, closed: false });
  assert.equal(sees(shut, [200, 200], [700, 700]), false);
  assert.equal(sees(open, [200, 200], [700, 700]), true);
  assert.equal(sees(open, [700, 700], [200, 200]), true);
});

test('rooms: a room at an angle is hidden along its own walls, not the squares', () => {
  // A diamond round (500, 500): a point just inside an edge is in it, a point just outside is not.
  const walls = loop([[500, 300], [700, 500], [500, 700], [300, 500]]);
  assert.equal(sees(walls, [500, 500], [595, 405]), true);
  assert.equal(sees(walls, [500, 500], [610, 390]), false);
  assert.equal(sees(walls, [100, 100], [595, 405]), false);
  assert.equal(sees(walls, [100, 100], [610, 390]), true);
});

test('rooms: a room off the grid by half a square, and one smaller than a square, are rooms of their own', () => {
  const half = loop([[135, 135], [345, 135], [345, 345], [135, 345]]);
  assert.equal(sees(half, [140, 140], [340, 340]), true);
  assert.equal(sees(half, [140, 140], [130, 130]), false);
  const tiny = loop([[500, 500], [540, 500], [540, 540], [500, 540]]);
  assert.equal(sees(tiny, [520, 520], [530, 530]), true);
  assert.equal(sees(tiny, [520, 520], [560, 560]), false);
});

test('rooms: a building in a building is a hole in it; its inside stays hidden from the room round it', () => {
  const outer = loop([[100, 100], [900, 100], [900, 900], [100, 900]], { at: 0, closed: false });
  const inner = loop([[400, 400], [600, 400], [600, 600], [400, 600]]);
  const walls = [...outer, ...inner];
  assert.equal(sees(walls, [200, 200], [800, 800]), true);
  assert.equal(sees(walls, [200, 200], [500, 500]), false);
  assert.equal(sees(walls, [1200, 50], [200, 200]), true);
  assert.equal(sees(walls, [500, 500], [200, 200]), false);
  const built = rooms(walls);
  const ring = built.rooms[roomAt(built, at(200, 200))]!;
  assert.equal(ring.holes.length, 1);
});

test('rooms: a T-junction makes two rooms; a wall that ends in a room (a stub) splits nothing', () => {
  const box = loop([[100, 100], [700, 100], [700, 500], [100, 500]]);
  const split = [...box, wall(400, 100, 400, 500)];
  assert.equal(sees(split, [200, 300], [600, 300]), false);
  const stub = [...box, wall(400, 100, 400, 300)];
  assert.equal(sees(stub, [200, 300], [600, 300]), true);
});

test('rooms: walls whose ends miss by a few pixels still seal the room; an overshoot does too', () => {
  const gaps = [wall(100, 100, 398, 100), wall(400, 102, 400, 400), wall(403, 400, 100, 401), wall(100, 398, 101, 103)];
  assert.equal(sees(gaps, [200, 200], [600, 600]), false);
  const over = [wall(80, 100, 420, 100), wall(400, 80, 400, 420), wall(420, 400, 80, 400), wall(100, 420, 100, 80)];
  assert.equal(sees(over, [200, 200], [600, 600]), false);
  assert.equal(sees(over, [200, 200], [300, 300]), true);
});

test('rooms: a door drawn over its wall, and a wall drawn twice, count as the walls there', () => {
  const walls = [...loop([[100, 100], [400, 100], [400, 400], [100, 400]]), wall(400, 200, 400, 300, { type: 'door', closed: false })];
  // The solid wall under the open door still stops sight.
  assert.equal(sees(walls, [200, 200], [700, 250]), false);
  const twice = [...loop([[100, 100], [400, 100], [400, 400], [100, 400]]), wall(100, 100, 400, 100)];
  assert.equal(sees(twice, [200, 200], [200, 50]), false);
});

test('rooms: a one-way wall lets sight through from its open side only; glass and a limited wall let it through', () => {
  const box = (over: Partial<BoardWall>) => [wall(0, 0, 0, 0), wall(700, 0, 700, 1000, over)];
  // p1 -> p2 runs down; its left (-x side) is stopped.
  assert.equal(sees(box({ direction: 'left' }), [300, 500], [1000, 500]), false);
  assert.equal(sees(box({ direction: 'left' }), [1000, 500], [300, 500]), true);
  assert.equal(sees(box({ blocks: 'light' }), [300, 500], [1000, 500]), true);
  assert.equal(sees(box({ limited: true }), [300, 500], [1000, 500]), true);
});

test('rooms: another sealed building stays hidden from outside until a door of its own opens', () => {
  const one = loop([[100, 100], [300, 100], [300, 300], [100, 300]]);
  const shut = loop([[800, 300], [1000, 300], [1000, 500], [800, 500]], { at: 1, closed: true });
  const open = loop([[800, 300], [1000, 300], [1000, 500], [800, 500]], { at: 1, closed: false });
  assert.equal(sees([...one, ...shut], [50, 50], [900, 400]), false);
  assert.equal(sees([...one, ...open], [50, 50], [900, 400]), true);
  assert.equal(sees([...one, ...open], [50, 50], [200, 200]), false);
});

test('rooms: a map of many rooms is cut quickly', () => {
  const walls: BoardWall[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) walls.push(...loop([[i * 100 + 10, j * 100 + 10], [i * 100 + 90, j * 100 + 10], [i * 100 + 90, j * 100 + 90], [i * 100 + 10, j * 100 + 90]], { at: 1, closed: (i + j) % 2 === 0 }));
  const start = performance.now();
  const built = buildRooms(walls, 2000, 2000, tol);
  assert.ok(built);
  assert.ok(seenRooms(built, [at(5, 5)], walls));
  assert.ok(performance.now() - start < 3000, `took ${performance.now() - start} ms`);
});

import { unseenAreas } from '../src/board/sightRooms';
import { visibilityPolygon } from '../src/board/lineOfSight';

test('rays: the unseen is the map less the sight polygons, along the lines of sight, with a hole where a viewer sees', () => {
  const bounds = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
  // A wall at an angle between the viewer and the far corner.
  const walls = [wall(400, 600, 600, 400)];
  const polygon = visibilityPolygon(at(200, 200), walls, bounds);
  const unseen = unseenAreas([polygon], 1000, 1000);
  assert.ok(unseen.length >= 1);
  const inUnseen = (x: number, y: number): boolean => unseen.some((area) => insideArea(area, x, y));
  assert.equal(inUnseen(900, 900), true, 'behind the wall');
  assert.equal(inUnseen(100, 100), false, 'by the viewer');
  assert.equal(inUnseen(900, 100), false, 'off to the side');
  // Nothing seen: the whole map; two viewers: their sight joined.
  assert.equal(unseenAreas([], 1000, 1000).length, 1);
  const two = unseenAreas([polygon, visibilityPolygon(at(900, 900), walls, bounds)], 1000, 1000);
  assert.equal(two.some((area) => insideArea(area, 900, 900)), false);
});

function insideArea(area: { outer: readonly { x: number; y: number }[]; holes: readonly (readonly { x: number; y: number }[])[] }, x: number, y: number): boolean {
  return insidePolygon({ x, y }, area.outer) && !area.holes.some((hole) => insidePolygon({ x, y }, hole));
}
