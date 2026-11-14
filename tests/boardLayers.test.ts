import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData, readBoardData } from '../src/board/boardData';
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
  // What the GM set on them in 3D rides on the records, as the scene's file has them.
  walls: [wall('w1', { extra: { height: 2, material: 'mat/brick' } }), wall('d1', { type: 'door', closed: false, extra: { prop: 'minis/door.glb', hinge: true, side: true } })],
  lights: [light('l1', { ownHeight: 1.5 }), light('l2', { hidden: true }), light('carried', { tokenId: 't1' })],
  ...over,
} as unknown as BoardMap);

/** A scene stack as older Tabletop kept one in its data. */
function stacked(): BoardData {
  return new BoardData(readBoardData({ 'up.atlasmap': { layer: { base: 'ground.atlasmap', elevation: 3 }, props: [{ id: 'p', glb: 'minis/barrel.glb', x: 1, y: 2, rotation: 90, scale: 1.5 }] } }));
}

test('a scene stack of older Tabletop gives players no layer (floors are Atlas levels; a stack waits to be moved), and a map on its own has none', () => {
  const scenes = { map: (path: string) => (path === 'up.atlasmap' ? sceneMap() : sceneMap({ background: 'maps/ground.png' })) };
  assert.deepEqual(layersFor(stacked(), materials, scenes, 'ground.atlasmap'), []);
  assert.deepEqual(layersFor(stacked(), materials, scenes, 'up.atlasmap'), []);
  assert.deepEqual(layersFor(stacked(), materials, { map: () => null }, 'ground.atlasmap'), []);
  assert.deepEqual(layersFor(new BoardData(), materials, scenes, 'alone.atlasmap'), []);
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

test('a level can be hidden on the board and shown again; hiding one says nothing of another', () => {
  const data = new BoardData();
  const upper = 'base.atlasmap#atlas-level:upper';
  assert.equal(data.layerHidden(upper), false);
  data.setLayerHidden(upper, true);
  assert.equal(data.layerHidden(upper), true);
  assert.equal(data.layerHidden('base.atlasmap#atlas-level:cellar'), false);
  assert.equal(new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON())))).layerHidden(upper), true);
  data.setLayerHidden(upper, false);
  assert.equal(data.layerHidden(upper), false);
  assert.deepEqual(data.toJSON(), {});
});
