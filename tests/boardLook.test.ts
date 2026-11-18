import { FOG_MIN } from '../src/board/ground';
import { DEFAULT_BACKGROUND } from '../src/background/backgroundData';
import { LIQUID_DEFAULTS } from '../src/board/water';
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

test('a painted ground tells players where its layers are, its settings and its materials; without settings it says nothing of them', () => {
  const board = data();
  board.setGround('m.atlasmap', { mode: 'painted', background: 'atlas-vtt/assets/backgrounds/Moor', noise: 'dunes', strength: 0.4, fog: 60, margin: 8, tile: 3 } as never);
  const settings = { ...DEFAULT_BACKGROUND, name: 'Moor', materials: ['mat/wood', 'mat/gone'], props: [{ name: 'Pines', props: ['props/tree.glb'], density: 10, scale: 1 }] };
  const known = (folder: string) => (folder === 'atlas-vtt/assets/backgrounds/Moor' ? settings : null);
  const look = boardLookFor(board, materials, 'm.atlasmap', [], undefined, null, extras(), undefined, known);
  assert.deepEqual(look.ground?.painted, {
    terrain: 'atlas-vtt/assets/backgrounds/Moor/terrain.png', material: 'atlas-vtt/assets/backgrounds/Moor/material.png', height: 'atlas-vtt/assets/backgrounds/Moor/height.png',
    props: 'atlas-vtt/assets/backgrounds/Moor/props.png',
    settings, materials: ['mat/wood', ''],
  });
  // With no brush there is nothing to scatter: the props picture is not sent, so players do not wait for it.
  const bare = { ...settings, props: [] };
  const without = boardLookFor(board, materials, 'm.atlasmap', [], undefined, null, extras(), undefined, (folder) => (folder === 'atlas-vtt/assets/backgrounds/Moor' ? bare : null));
  assert.equal('props' in (without.ground?.painted ?? {}), false);
  assert.equal(without.ground?.painted?.terrain, 'atlas-vtt/assets/backgrounds/Moor/terrain.png');
  assert.ok(look.materials.some((material) => material.id === 'mat/wood'));
  assert.equal(look.ground?.mode, 'painted');
  const unread = lookOf(board);
  assert.equal(unread.ground?.mode, 'painted');
  assert.equal('painted' in (unread.ground ?? {}), false);
});

test("the raised shapes of the level shown go to players with their materials; the ground goes always", () => {
  const board = data();
  board.saveShape('m.atlasmap', { id: 'hill', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 0 }], inner: [{ x: 35, y: 30, h: 1.5 }], material: 'mat/unused' });
  board.saveShape('m.atlasmap', { id: 'up', level: 'b', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 0 }], inner: [] });
  board.setGround('m.atlasmap', { mode: 'horizon', material: 'mat/wood', noise: 'dunes', strength: 0.4, fog: 60, margin: 8, tile: 3, water: { kind: 'waves', amount: 0.3, direction: 45, tint: '#336699', clarity: 0.5 } });
  const levels = [{ id: 'a', name: 'Ground', elevation: { bottom: 0, top: 10 }, background: null }, { id: 'b', name: 'Up', elevation: { bottom: 10, top: 20 }, background: null }] as never;
  const look = boardLookFor(board, materials, 'm.atlasmap', [], { levels, level: 'a' }, null, extras());
  assert.deepEqual(look.shapes, [{ id: 'hill', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 0 }], inner: [{ x: 35, y: 30, h: 1.5 }], material: 'mat/unused' }]);
  // A fog thinner than the thinnest there is reads as the thinnest; the lava and acid go as they start.
  assert.deepEqual(look.ground, { mode: 'horizon', material: 'mat/wood', noise: 'dunes', strength: 0.4, fog: FOG_MIN, margin: 8, tile: 3, water: { kind: 'waves', amount: 0.3, direction: 45, tint: '#336699', clarity: 0.5 }, lava: LIQUID_DEFAULTS.lava, acid: LIQUID_DEFAULTS.acid });
  // The shape's and the ground's materials are listed with the walls'.
  assert.deepEqual(look.materials.map((material) => material.id).sort(), ['mat/brick', 'mat/unused', 'mat/wood']);
  // A map with none has no shapes key, and the ground as it is by default.
  const plain = lookOf(new BoardData());
  assert.equal('shapes' in plain, false);
  assert.equal(plain.ground?.mode, 'board');
});
