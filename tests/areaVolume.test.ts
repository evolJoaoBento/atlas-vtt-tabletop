import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { AreaVolumes, areaVolumeOf, markShape } from '../src/board/areaVolume';
import type { TemplateMark } from '../src/board/playerTools';
import type { BoardWall } from '../src/board/walls';

const wall = (x1: number, y1: number, x2: number, y2: number, over: Partial<BoardWall> = {}): BoardWall =>
  ({ id: `w${x1},${y1}`, type: 'solid', p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over });
const mark = (over: Partial<TemplateMark>): TemplateMark => ({ id: 'a', owner: 'gm', shape: 'circle', start: { x: 0, y: 0 }, end: { x: 140, y: 0 }, color: '#ec7500', kind: 'area', effect: 'fire', ...over });
const QUARTER = Math.PI / 2;
const HEIGHT = 210;

test('an area with an effect stands as that damage\'s look, from the floor up to the wall height', () => {
  const circle = areaVolumeOf(mark({}), null, HEIGHT, QUARTER)!;
  assert.equal(circle.footprint.look.effect, 'fire');
  assert.equal(circle.footprint.height, HEIGHT);
  // A column: a cylinder at a point, stood up with its middle half way.
  assert.deepEqual([circle.footprint.look.shape, circle.footprint.look.size, circle.footprint.look.length, circle.footprint.look.at.h], ['cylinder', 140, HEIGHT, HEIGHT / 2]);
  const xs = circle.footprint.rings.flat().map((point) => point.x);
  assert.ok(Math.min(...xs) <= -139.9 && Math.max(...xs) >= 139.9);
  const square = areaVolumeOf(mark({ shape: 'square', effect: 'frost' }), null, HEIGHT, QUARTER)!;
  assert.deepEqual([square.footprint.look.shape, square.footprint.look.effect, square.footprint.look.size, square.footprint.look.length, square.footprint.look.at.h], ['wall', 'cold', 140, HEIGHT, 0]);
  const line = areaVolumeOf(mark({ shape: 'line', width: 35, effect: 'lightning' }), null, HEIGHT, QUARTER)!;
  assert.deepEqual([line.footprint.look.shape, line.footprint.look.size, line.footprint.look.effect], ['wall', 35, 'lightning']);
  const cone = areaVolumeOf(mark({ shape: 'cone', effect: 'radiance' }), null, HEIGHT, QUARTER)!;
  assert.equal(cone.footprint.look.effect, 'radiant');
  assert.ok(Math.abs(cone.footprint.look.size - 280) < 1e-6, 'as wide as the cone opens at its end');
});

test('mist has no damage look: a plain volume in the area\'s colour', () => {
  const mist = areaVolumeOf(mark({ effect: 'mist', color: '#ffffff' }), null, HEIGHT, QUARTER)!;
  assert.equal(mist.footprint.look.effect, undefined);
  assert.equal(mist.color, '#ffffff');
  assert.equal(areaVolumeOf(mark({ effect: 'shadow' }), null, HEIGHT, QUARTER)!.footprint.look.effect, 'necrotic');
});

test('no volume for a mark with no effect, a ruler, a thin line, or an area without a size', () => {
  assert.equal(areaVolumeOf(mark({ effect: undefined }), null, HEIGHT, QUARTER), null);
  assert.equal(areaVolumeOf(mark({ shape: 'line', ruler: true }), null, HEIGHT, QUARTER), null);
  assert.equal(areaVolumeOf(mark({ shape: 'line' }), null, HEIGHT, QUARTER), null);
  assert.equal(areaVolumeOf(mark({ end: { x: 0, y: 0 } }), null, HEIGHT, QUARTER), null);
});

test('the footprint is what the walls leave of the area', () => {
  const walls = [wall(70, -400, 70, 400)];
  const m = mark({});
  const { cut } = markShape(m, QUARTER, walls, { cell: 70 })!;
  assert.ok(cut, 'the wall cuts the circle');
  const volume = areaVolumeOf(m, cut, HEIGHT, QUARTER)!;
  const xs = volume.footprint.rings.flat().map((point) => point.x);
  assert.ok(Math.max(...xs) <= 70.5 && Math.min(...xs) <= -139);
  // A measure that passes walls is whole.
  assert.equal(markShape({ ...m, uncut: true }, QUARTER, walls, { cell: 70 })!.cut, null);
  assert.equal(markShape(m, QUARTER, [wall(7000, -1, 7000, 1)], { cell: 70 })!.cut, null);
  assert.equal(markShape(mark({ ruler: true, shape: 'line' }), QUARTER, walls, { cell: 70 }), null);
});

test('the board draws one view per area, standing from the floor, and takes it away with the area', () => {
  const volumes = new AreaVolumes();
  const circle = areaVolumeOf(mark({}), null, HEIGHT, QUARTER)!;
  const hidden = areaVolumeOf(mark({ id: 'b', shape: 'square', start: { x: 400, y: 400 }, end: { x: 540, y: 400 }, gmOnly: true }), null, HEIGHT, QUARTER)!;
  volumes.set([circle, hidden], 70);
  assert.equal(volumes.count, 2);
  const standing = volumes.state();
  assert.deepEqual(standing.map((entry) => [entry.id, entry.effect, entry.height]), [['a', 'fire', HEIGHT], ['b', 'fire', HEIGHT]]);
  volumes.object3d.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(volumes.object3d.children[0]!.children[0]!);
  assert.ok(Math.abs(box.min.y) < 1e-6 && Math.abs(box.max.y - HEIGHT) < 1e-6, 'from the floor to the wall height');
  volumes.show('player');
  assert.deepEqual(volumes.state().map((entry) => entry.visible), [true, false], 'what Atlas keeps from players is the GM\'s alone');
  volumes.show('gm');
  assert.deepEqual(volumes.state().map((entry) => entry.visible), [true, true]);
  assert.ok(volumes.animated, 'a damage\'s look moves by itself');
  volumes.set([circle], 70);
  assert.deepEqual(volumes.state().map((entry) => entry.id), ['a']);
  volumes.dispose();
  assert.equal(volumes.count, 0);
});
