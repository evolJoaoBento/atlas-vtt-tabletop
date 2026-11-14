import assert from 'node:assert/strict';
import * as THREE from 'three';
import { test } from 'node:test';
import { WallSet, type WallLookup, type WallShape } from '../src/board/wallPieces';
import { isWindow, readWalls, windowSpan, type BoardWall } from '../src/board/walls';
import { canSee } from '../src/board/lineOfSight';
import { BoardData, readBoardData } from '../src/board/boardData';

const wall = (blocks: BoardWall['blocks']): BoardWall => ({ id: 'w', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 140, y: 0 }, direction: null, closed: true, locked: false, blocks, limited: false, chain: null });
const lookup = (span: { bottom: number; top: number } | null): WallLookup => ({
  look: () => new THREE.MeshStandardMaterial(), materialOf: () => null, heightOf: () => null, windowOf: () => span, propOf: () => null, prop: async () => null,
});
const shape: WallShape = { height: 140, tile: 70, thickness: 14, fogged: () => false, fogKey: '', edge: 0, cuts: 0 };

/** The heights (in map pixels) the wall's faces span, from the drawn geometry. */
function heights(walls: BoardWall[], look: WallLookup): number[] {
  const set = new WallSet(look);
  set.update(walls, shape);
  const ys = new Set<number>();
  set.object3d.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) ys.add(Math.round(position.getY(i)));
  });
  return [...ys].sort((a, b) => a - b);
}

test("Atlas's window (a wall that stops only tokens) is read as one, and lets sight through both ways", () => {
  const [read] = readWalls({ w: { id: 'w', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 140, y: 0 }, blocks: 'movement' } });
  assert.equal(read!.blocks, 'movement');
  assert.ok(isWindow(read!));
  assert.ok(!isWindow({ type: 'door', blocks: 'movement' }));
  assert.ok(canSee({ x: 70, y: -50 }, { x: 70, y: 50 }, [read!]));
  assert.ok(canSee({ x: 70, y: 50 }, { x: 70, y: -50 }, [read!]));
  assert.ok(!canSee({ x: 70, y: -50 }, { x: 70, y: 50 }, [wall(null)]));
});

test('a window opens at about a third of the wall up to four fifths, and stays inside the wall', () => {
  assert.deepEqual(windowSpan(2, null), { bottom: 0.75, top: 1.5 });
  assert.deepEqual(windowSpan(2, { bottom: 0.5, top: 1.75 }), { bottom: 0.5, top: 1.75 });
  assert.deepEqual(windowSpan(2, { bottom: 3, top: 5 }), { bottom: 1.75, top: 2 });
  assert.deepEqual(windowSpan(2, { bottom: 1, top: 1 }), { bottom: 1, top: 1.25 });
});

test('a window is drawn as a sill and a lintel with an opening between', () => {
  // A plain wall: floor to its top (2 squares of 70 px).
  assert.deepEqual(heights([wall(null)], lookup(null)), [0, 140]);
  // The window as the GM set it: a sill to 35 px, a lintel from 105 px.
  assert.deepEqual(heights([wall('movement')], lookup({ bottom: 0.5, top: 1.5 })), [0, 35, 105, 140]);
  // An opening from the floor: no sill.
  assert.deepEqual(heights([wall('movement')], lookup({ bottom: 0, top: 1 })), [70, 140]);
});


test("a plain wall is made a window and back, through Atlas's store", async () => {
  const { TokenWriter } = await import('../src/board/tokenWriter');
  const calls: unknown[] = [];
  const view = { file: { path: 'm.atlasmap' }, atlasStore: { getState: () => ({ mapPath: 'm.atlasmap', updateWall: (id: string, changes: Record<string, unknown>) => calls.push([id, changes]) }) } };
  const writer = new TokenWriter({ views: () => [view as never], held: async () => null });
  await writer.setWindow('m.atlasmap', ['a', 'b'], true);
  await writer.setWindow('m.atlasmap', ['a'], false);
  assert.deepEqual(calls, [['a', { blocks: 'movement' }], ['b', { blocks: 'movement' }], ['a', { blocks: undefined }]]);
});
