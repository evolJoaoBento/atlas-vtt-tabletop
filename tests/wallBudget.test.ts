import assert from 'node:assert/strict';
import * as THREE from 'three';
import { test } from 'node:test';
import { DISPLACE_TRIANGLES, WallSet, type WallLookup, type WallShape } from '../src/board/wallPieces';
import type { BoardWall } from '../src/board/walls';

const wall = (i: number): BoardWall => ({ id: `w${i}`, type: 'solid', p1: { x: 0, y: i * 140 }, p2: { x: 280, y: i * 140 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null });
const lookup = (displaces: boolean, tileScale: number): WallLookup => ({
  look: () => new THREE.MeshStandardMaterial(),
  materialOf: () => 'brick',
  heightOf: () => null,
  displaces: () => displaces,
  tileOf: () => tileScale,
  propOf: () => null,
  prop: async () => null,
});
const shape = (cuts: number): WallShape => ({ height: 140, tile: 70, thickness: 14, fogged: () => false, fogKey: '', edge: 0.025, cuts });

function triangles(walls: BoardWall[], look: WallLookup, cuts: number): number {
  const set = new WallSet(look);
  set.update(walls, shape(cuts));
  let count = 0;
  set.object3d.traverse((object) => { if (object instanceof THREE.Mesh) count += (object.geometry.getAttribute('position').count) / 3; });
  return count;
}

test('a map of many displaced walls stays within the triangle budget however fine its texture', () => {
  const walls = Array.from({ length: 300 }, (_, i) => wall(i));
  const total = triangles(walls, lookup(true, 0.25), 16);
  assert.ok(total < DISPLACE_TRIANGLES * 1.25);
});

test('a few displaced walls are cut as asked, finer for a smaller tile, and not at all when the cuts are 0', () => {
  const walls = Array.from({ length: 3 }, (_, i) => wall(i));
  const coarse = triangles(walls, lookup(true, 1), 16);
  assert.ok(triangles(walls, lookup(true, 0.5), 16) > coarse * 2);
  assert.ok(triangles(walls, lookup(false, 1), 16) < coarse / 4);
  assert.equal(triangles(walls, lookup(true, 1), 0), triangles(walls, lookup(false, 1), 16));
});
