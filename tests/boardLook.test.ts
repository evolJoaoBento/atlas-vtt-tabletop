import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData } from '../src/board/boardData';
import { boardLookFor, type MaterialInfo } from '../src/boardLook';
import { extrasOf } from '../src/board/recordExtras';
import { readLights, readWalls } from '../src/board/walls';

const infos: Record<string, MaterialInfo> = {
  'mat/brick': { scale: 2, maps: { color: 'mat/brick/brick_diff.jpg', normal: 'mat/brick/brick_nor_gl.jpg' } },
  'mat/wood': { scale: 1, maps: { color: 'mat/wood/wood_diff.jpg' } },
  'mat/unused': { scale: 1, maps: { color: 'mat/unused/u_diff.jpg' } },
};
const materials = { info: (folder: string): MaterialInfo | null => infos[folder] ?? null };

function data(): BoardData {
  const board = new BoardData();
  board.setFogHeight('m.atlasmap', 2);
  board.addProp('m.atlasmap', { glb: 'minis/barrel.glb', x: 10, y: 20, rotation: 90, scale: 1.5 });
  board.addProp('other.atlasmap', { glb: 'minis/crate.glb', x: 1, y: 1, rotation: 0, scale: 1 });
  return board;
}

// What the GM set in 3D, on Atlas's own records of the map.
const segment = (id: string, tabletop: object, type = 'solid') => ({ id, kind: 'wall', type, p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, tabletop });
const extras = () => extrasOf({
  walls: readWalls({ w1: segment('w1', { v: 1, material: 'mat/brick', height: 3 }), w2: segment('w2', { v: 1, material: 'mat/brick' }), d1: segment('d1', { v: 1, material: 'mat/wood', prop: 'minis/door.glb' }, 'door') }),
  lights: readLights({ l1: { id: 'l1', x: 0, y: 0, emission: { bright: 1, dim: 2, color: '#ffffff', intensity: 1, animation: 'none' }, tabletop: { v: 1, height: 1.5 } } }, {}),
});
const lookOf = (board: BoardData, known: { info(folder: string): MaterialInfo | null } = materials) => boardLookFor(board, known, 'm.atlasmap', [], undefined, null, extras());

test('a map\'s look: wall heights, materials and door props by wall id, light heights and fog height; the light is Atlas\'s', () => {
  const look = lookOf(data());
  assert.equal(look.wallHeight('w1'), 3);
  assert.equal(look.wallHeight('w2'), null);
  assert.equal(look.wallMaterial('w2'), 'mat/brick');
  assert.equal(look.doorProp('d1'), 'minis/door.glb');
  assert.equal(look.lightHeight('l1'), 1.5);
  assert.equal(look.lightHeight('l2'), null);
  assert.equal(look.fogHeight, 2);
  // The board keeps no light level or tint of its own: players read Atlas's scene lighting.
  assert.equal('ambient' in look, false);
  assert.equal('tint' in look, false);
  assert.equal(look.wallThickness, 0.12);
});

test('only the materials this map\'s walls use are listed, with their scale and maps by role', () => {
  const look = lookOf(data());
  assert.deepEqual(look.materials, [
    { id: 'mat/brick', scale: 2, maps: { color: 'mat/brick/brick_diff.jpg', normal: 'mat/brick/brick_nor_gl.jpg' } },
    { id: 'mat/wood', scale: 1, maps: { color: 'mat/wood/wood_diff.jpg' } },
  ]);
});

test('a material not read yet is left out, not guessed', () => {
  const look = lookOf(data(), { info: (folder) => (folder === 'mat/wood' ? infos[folder]! : null) });
  assert.deepEqual(look.materials.map((material) => material.id), ['mat/wood']);
});

test('the props are this map\'s only, their rotation as the turn', () => {
  const look = lookOf(data());
  assert.equal(look.props.length, 1);
  assert.deepEqual({ ...look.props[0], id: 'x' }, { id: 'x', path: 'minis/barrel.glb', x: 10, y: 20, scale: 1.5, turn: 90 });
});

test('a material with its texture strengthened tells Connect how; one left as made says nothing', () => {
  const look = lookOf(data(), { info: (folder) => (folder === 'mat/brick' ? { ...infos[folder]!, tuning: { relief: 2, occlusion: 1, shine: 0.3, depth: 0, displace: 0, outward: 0 } } : folder === 'mat/wood' ? { ...infos[folder]!, tuning: { relief: 1, occlusion: 1, shine: 0, depth: 0, displace: 0, outward: 0 } } : null) });
  assert.deepEqual(look.materials.find((material) => material.id === 'mat/brick')?.tuning, { relief: 2, occlusion: 1, shine: 0.3, depth: 0, displace: 0, outward: 0 });
  assert.equal('tuning' in look.materials.find((material) => material.id === 'mat/wood')!, false);
});
