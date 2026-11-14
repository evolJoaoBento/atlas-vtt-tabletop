import assert from 'node:assert/strict';
import * as THREE from 'three';
import { test } from 'node:test';
import { planJoins, WallSet, type WallLookup, type WallShape } from '../src/board/wallPieces';
import { BoardData, readBoardData } from '../src/board/boardData';
import type { BoardWall } from '../src/board/walls';

const seg = (id: string, x1: number, y1: number, x2: number, y2: number) => ({ id, p1: { x: x1, y: y1 }, p2: { x: x2, y: y2 } });

test("a square corner closes by the other wall's own width", () => {
  // a is 20 thick, b the default 8: a takes the corner by half of b; b stops at a's face, half of a back.
  const joins = planJoins([seg('a', 0, 0, 100, 0), seg('b', 100, 0, 100, 100)], (id) => (id === 'a' ? 20 : 8));
  assert.deepEqual(joins.get('a')!.extend, [10, 4]);
  assert.deepEqual(joins.get('b')!.extend, [-10, 4]);
});

test('a wall given its own width is drawn that thick; the others keep the map thickness', () => {
  const wall = (id: string, y: number): BoardWall => ({ id, type: 'solid', p1: { x: 0, y }, p2: { x: 140, y }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null });
  const lookup = (width: number | null): WallLookup => ({ look: () => new THREE.MeshStandardMaterial(), materialOf: () => null, heightOf: () => null, widthOf: (id) => (id === 'w' ? width : null), propOf: () => null, prop: async () => null });
  const shape: WallShape = { height: 140, tile: 70, thickness: 14, fogged: () => false, fogKey: '', edge: 0, cuts: 0 };
  const depth = (width: number | null): number => {
    const set = new WallSet(lookup(width));
    set.update([wall('w', 0)], shape);
    const box = new THREE.Box3().setFromObject(set.object3d);
    return Math.round(box.max.z - box.min.z);
  };
  assert.equal(depth(null), 14);
  assert.equal(depth(0.5), 35);
});

