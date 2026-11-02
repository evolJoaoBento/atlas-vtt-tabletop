import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData } from '../src/board/boardData';
import type { BoardMap } from '../src/board/mapModel';
import { layersFor } from '../src/boardLayers';
import type { MaterialInfo } from '../src/boardLook';
import { layersFromExtras } from '../src/board/sceneAdapter';
import type { BoardExtras } from '../src/connectContract';

const materials = { info: (folder: string): MaterialInfo | null => (folder === 'mat/brick' ? { scale: 2, maps: { color: 'mat/brick/c.jpg' } } : null) };

const wall = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over });
const light = (id: string, over: Record<string, unknown> = {}) => ({ id, x: 5, y: 6, bright: 10, dim: 20, color: '#ffaa00', intensity: 1, animation: 'torch', angle: null, rotation: 0, hidden: false, darkness: false, activeBelowAmbient: null, tokenId: null, ...over });
const sceneMap = (over: Record<string, unknown> = {}): BoardMap => ({
  background: 'maps/up.png', grid: { size: 70, offsetX: 5, offsetY: 6 },
  walls: [wall('w1'), wall('d1', { type: 'door', closed: false })],
  lights: [light('l1'), light('l2', { hidden: true }), light('carried', { tokenId: 't1' })],
  ...over,
} as unknown as BoardMap);

function stacked(): BoardData {
  const data = new BoardData();
  data.setLayer('up.atlasmap', 'ground.atlasmap', 3);
  data.setWallHeight('up.atlasmap', ['w1'], 2);
  data.setWallMaterial('up.atlasmap', ['w1'], 'mat/brick');
  data.setDoorProp('up.atlasmap', 'd1', 'minis/door.glb');
  data.rotateDoor('up.atlasmap', 'd1');
  data.setLightHeight('up.atlasmap', 'l1', 1.5);
  data.addProp('up.atlasmap', { glb: 'minis/barrel.glb', x: 1, y: 2, rotation: 90, scale: 1.5 });
  return data;
}

test('the other scenes of a stack come with their floor, walls, doors, lights and props, at their height from the one asked about', () => {
  const scenes = { map: (path: string) => (path === 'up.atlasmap' ? sceneMap() : null) };
  const [layer, ...rest] = layersFor(stacked(), materials, scenes, 'ground.atlasmap');
  assert.equal(rest.length, 0);
  assert.equal(layer.elevation, 3);
  assert.equal(layer.image, 'maps/up.png');
  assert.deepEqual(layer.grid, { size: 70, offsetX: 5, offsetY: 6 });
  assert.deepEqual(layer.walls.map((entry) => [entry.id, entry.height, entry.material, entry.doorProp, entry.flip]), [
    ['w1', 2, 'mat/brick', null, { hinge: false, side: false }],
    ['d1', null, null, 'minis/door.glb', { hinge: true, side: true }],
  ]);
  assert.deepEqual(layer.lights.map((entry) => [entry.id, entry.height]), [['l1', 1.5]], 'a switched-off light and a token\'s light stay out');
  assert.deepEqual(layer.props, [{ id: layer.props[0].id, path: 'minis/barrel.glb', x: 1, y: 2, scale: 1.5, turn: 90 }]);
  assert.deepEqual(layer.materials.map((entry) => entry.id), ['mat/brick']);
});

test('asked from the upper scene, the ground is below it, and the upper scene is not its own layer', () => {
  const scenes = { map: (path: string) => (path === 'ground.atlasmap' ? sceneMap({ background: 'maps/ground.png' }) : null) };
  const layers = layersFor(stacked(), materials, scenes, 'up.atlasmap');
  assert.deepEqual(layers.map((entry) => [entry.elevation, entry.image]), [[-3, 'maps/ground.png']]);
});

test('a scene not read yet, one without a floor, and a map on its own give no layer', () => {
  assert.deepEqual(layersFor(stacked(), materials, { map: () => null }, 'ground.atlasmap'), []);
  assert.deepEqual(layersFor(stacked(), materials, { map: () => sceneMap({ background: null }) }, 'ground.atlasmap'), []);
  assert.deepEqual(layersFor(stacked(), materials, { map: () => sceneMap() }, 'alone.atlasmap'), []);
});

const extras = (layers: BoardExtras['layers']): BoardExtras => ({
  sceneId: 's1', walls: [], lights: [], props: [], materials: [], ambient: null, fogHeight: null, wallThickness: null, lighting: { enabled: false, ambient: 1, ambientColor: null }, layers,
});

test('a player\'s board makes a layer of each stacked scene sent: floor, grid, height, place, walls with their turned doors, props', () => {
  const [layer] = layersFromExtras(extras([{
    id: 'layer-1', elevation: 3, stands: { x: 10, y: 20, turn: 90 }, image: 'IMG', grid: { size: 70, offsetX: 5, offsetY: 6 },
    walls: [
      { id: 'w1', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, height: 2, material: 'MAT' },
      { id: 'd1', type: 'door', p1: { x: 70, y: 0 }, p2: { x: 140, y: 0 }, height: null, material: null, door: { open: true, swing: 'left', prop: 'DOOR', hinge: true } },
    ],
    lights: [{ id: 'l1', x: 5, y: 6, height: 1.5, color: '#ffaa00', bright: 10, dim: 20, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null }],
    props: [{ id: 'p', asset: 'GLB', x: 1, y: 2, scale: 1, turn: 0 }], fogHeight: null, wallThickness: null,
  }]));
  assert.equal(layer.path, 'layer-1');
  assert.equal(layer.elevation, 3);
  assert.deepEqual(layer.stands, { x: 10, y: 20, turn: 90 });
  assert.equal(layer.map.background, 'IMG');
  assert.deepEqual([layer.map.grid.size, layer.map.grid.offsetX, layer.map.grid.offsetY], [70, 5, 6]);
  assert.deepEqual(layer.map.tokens, []);
  assert.deepEqual(layer.map.walls.map((entry) => [entry.id, entry.closed]), [['w1', true], ['d1', false]]);
  assert.equal(layer.wallHeight('w1'), 2);
  assert.equal(layer.wallMaterial('w1'), 'MAT');
  assert.equal(layer.doorProp('d1'), 'DOOR');
  assert.deepEqual(layer.doorFlip?.('d1'), { hinge: true, side: false });
  assert.deepEqual(layer.doorFlip?.('w1'), { hinge: false, side: false });
  assert.equal(layer.lightHeight('l1'), 1.5);
  assert.deepEqual(layer.props, [{ id: 'p', glb: 'GLB', x: 1, y: 2, rotation: 0, scale: 1 }]);
  assert.deepEqual(layersFromExtras(extras(undefined)), []);
  assert.deepEqual(layersFromExtras(null), []);
});
