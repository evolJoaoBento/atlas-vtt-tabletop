import assert from 'node:assert/strict';
import { test } from 'node:test';
import { areaOf, readRooms, roomWalls, type Room } from '../src/board/atlasRooms/rooms';
import { readMap } from '../src/board/mapModel';

const square = (x: number, y: number, size: number) => [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }];
const room = (id: string, area: Room['area'], over: Partial<Room> = {}): Room => ({ id, kind: 'room', name: id, order: 0, area, ...over });
const rooms = (...list: Room[]): Record<string, Room> => Object.fromEntries(list.map((one) => [one.id, one]));

/** Whether any wall runs along the line x = `x` between y = `from` and y = `to`. */
const wallAlongX = (walls: ReturnType<typeof roomWalls>, x: number, from: number, to: number) => walls.some((wall) =>
  wall.p1.x === x && wall.p2.x === x && Math.min(wall.p1.y, wall.p2.y) <= from && Math.max(wall.p1.y, wall.p2.y) >= to);

test('one room makes its four edges solid walls, in map pixels', () => {
  const walls = roomWalls(readRooms(rooms(room('a', areaOf([square(100, 100, 200)])))));
  assert.equal(walls.length, 4);
  for (const wall of walls) {
    assert.equal(wall.type, 'solid');
    assert.equal(wall.chainId, 'rooms');
    for (const p of [wall.p1, wall.p2]) assert.ok([100, 300].includes(p.x) && [100, 300].includes(p.y), JSON.stringify(p));
  }
});

test('two rooms that touch or overlap make one outline: no wall between them', () => {
  const walls = roomWalls(readRooms(rooms(room('a', areaOf([square(0, 0, 200)])), room('b', areaOf([square(150, 0, 200)]), { order: 1 }))));
  assert.equal(wallAlongX(walls, 200, 0, 200), false);
  assert.equal(wallAlongX(walls, 150, 0, 200), false);
  assert.equal(wallAlongX(walls, 0, 0, 200), true);
  assert.equal(wallAlongX(walls, 350, 0, 200), true);
});

test('a hidden room is rock again: it makes no walls', () => {
  assert.equal(roomWalls(readRooms(rooms(room('a', areaOf([square(0, 0, 100)]), { hidden: true })))).length, 0);
});

test('what is no room (a hand edit, a newer shape) is passed over', () => {
  assert.equal(readRooms({ a: { id: 'b', kind: 'room', name: 'x', order: 0, area: [] } }).length, 0);
  assert.equal(readRooms({ a: { id: 'a', kind: 'room', name: 'x', order: 0, area: [[1, 2]] } }).length, 0);
  assert.equal(readRooms('nope').length, 0);
});

const scene = (objects: Record<string, unknown>, levels?: unknown) => JSON.stringify({
  state: { objects: { tokens: {}, walls: {}, ...objects }, ...(levels ? { levels } : {}), grid: { size: 50 } },
});

test('a map with rooms gets their outline as walls next to its drawn ones; a map without has only its own', () => {
  const drawn = { w1: { id: 'w1', kind: 'wall', type: 'door', p1: { x: 0, y: 0 }, p2: { x: 0, y: 50 } } };
  const carved = readMap('m.atlasmap', scene({ walls: drawn, rooms: rooms(room('a', areaOf([square(0, 0, 100)]))) }));
  assert.equal(carved.walls.length, 5);
  assert.equal(carved.walls.filter((wall) => wall.chain === 'rooms').length, 4);
  assert.equal(carved.walls.find((wall) => wall.id === 'w1')?.type, 'door');
  const plain = readMap('m.atlasmap', scene({ walls: drawn }));
  assert.deepEqual(plain.walls.map((wall) => wall.id), ['w1']);
});

test('each level has its own rooms: only the viewed level\'s make walls', () => {
  const levels = [{ id: 'g', name: 'Ground' }, { id: 'u', name: 'Upper' }];
  const text = scene({ rooms: rooms(room('a', areaOf([square(0, 0, 100)]), { level: 'g' }), room('b', areaOf([square(0, 0, 300)]), { level: 'u' })) }, levels);
  const ground = readMap('m.atlasmap', text, 'g').walls;
  const upper = readMap('m.atlasmap', text, 'u').walls;
  assert.equal(ground.length, 4);
  assert.ok(ground.every((wall) => Math.max(wall.p1.x, wall.p2.x) <= 100));
  assert.equal(upper.length, 4);
  assert.ok(upper.some((wall) => Math.max(wall.p1.x, wall.p2.x) === 300));
});
