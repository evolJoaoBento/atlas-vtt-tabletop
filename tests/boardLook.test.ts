import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData } from '../src/board/boardData';
import { boardLookFor, type MaterialInfo } from '../src/boardLook';

const infos: Record<string, MaterialInfo> = {
  'mat/brick': { scale: 2, maps: { color: 'mat/brick/brick_diff.jpg', normal: 'mat/brick/brick_nor_gl.jpg' } },
  'mat/wood': { scale: 1, maps: { color: 'mat/wood/wood_diff.jpg' } },
  'mat/unused': { scale: 1, maps: { color: 'mat/unused/u_diff.jpg' } },
};
const materials = { info: (folder: string): MaterialInfo | null => infos[folder] ?? null };

function data(): BoardData {
  const board = new BoardData();
  board.setWallMaterial('m.atlasmap', ['w1', 'w2'], 'mat/brick');
  board.setWallMaterial('m.atlasmap', ['d1'], 'mat/wood');
  board.setWallMaterial('other.atlasmap', ['x'], 'mat/unused');
  board.setWallHeight('m.atlasmap', ['w1'], 3);
  board.setDoorProp('m.atlasmap', 'd1', 'minis/door.glb');
  board.setLightHeight('m.atlasmap', 'l1', 1.5);
  board.setFogHeight('m.atlasmap', 2);
  board.setAmbient('m.atlasmap', 0.3);
  board.addProp('m.atlasmap', { glb: 'minis/barrel.glb', x: 10, y: 20, rotation: 90, scale: 1.5 });
  board.addProp('other.atlasmap', { glb: 'minis/crate.glb', x: 1, y: 1, rotation: 0, scale: 1 });
  return board;
}

test('a map\'s look: wall heights, materials and door props by wall id, light heights, fog height and ambient', () => {
  const look = boardLookFor(data(), materials, 'm.atlasmap');
  assert.equal(look.wallHeight('w1'), 3);
  assert.equal(look.wallHeight('w2'), null);
  assert.equal(look.wallMaterial('w2'), 'mat/brick');
  assert.equal(look.doorProp('d1'), 'minis/door.glb');
  assert.equal(look.lightHeight('l1'), 1.5);
  assert.equal(look.lightHeight('l2'), null);
  assert.equal(look.fogHeight, 2);
  assert.equal(look.ambient, 0.3);
  assert.equal(look.wallThickness, 0.12);
});

test('only the materials this map\'s walls use are listed, with their scale and maps by role', () => {
  const look = boardLookFor(data(), materials, 'm.atlasmap');
  assert.deepEqual(look.materials, [
    { id: 'mat/brick', scale: 2, maps: { color: 'mat/brick/brick_diff.jpg', normal: 'mat/brick/brick_nor_gl.jpg' } },
    { id: 'mat/wood', scale: 1, maps: { color: 'mat/wood/wood_diff.jpg' } },
  ]);
});

test('a material not read yet is left out, not guessed', () => {
  const look = boardLookFor(data(), { info: (folder) => (folder === 'mat/wood' ? infos[folder]! : null) }, 'm.atlasmap');
  assert.deepEqual(look.materials.map((material) => material.id), ['mat/wood']);
});

test('the props are this map\'s only, their rotation as the turn', () => {
  const look = boardLookFor(data(), materials, 'm.atlasmap');
  assert.equal(look.props.length, 1);
  assert.deepEqual({ ...look.props[0], id: 'x' }, { id: 'x', path: 'minis/barrel.glb', x: 10, y: 20, scale: 1.5, turn: 90 });
});
