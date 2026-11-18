import { FOG_MIN } from '../src/board/ground';
import { LIQUID_DEFAULTS } from '../src/board/water';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData, readBoardData } from '../src/board/boardData';
import type { BoardMap } from '../src/board/mapModel';
import { layersFor } from '../src/boardLayers';
import type { MaterialInfo } from '../src/boardLook';
import { backgroundSettingsFromWire, groundFromWire, layersFromExtras, paintedFromWire, paintedRef, shapesFromWire } from '../src/board/sceneAdapter';
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
  // A level Atlas fitted to the scene's grid is laid by its fit.
  const [fitted] = layersFromExtras(extras([{ id: 'layer-2', elevation: 3, stands: { x: 0, y: 0, turn: 0 }, image: 'IMG', grid: { size: 70, offsetX: 0, offsetY: 0, mapStretch: { x: 0.7, y: 0.7, offset: { x: 200, y: 100 } } }, walls: [], lights: [], props: [], fogHeight: null, wallThickness: null }]));
  assert.deepEqual(fitted!.map.grid.mapStretch, { x: 0.7, y: 0.7, offset: { x: 200, y: 100 } });
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

test("a player's board reads the GM's shapes and ground from the wire: corners from x, y, h lists, the ground the map board where none came", () => {
  const sent = { ...extras([{ id: 'layer-1', elevation: 3, stands: { x: 0, y: 0, turn: 0 }, image: 'IMG', grid: { size: 70, offsetX: 0, offsetY: 0 }, walls: [], lights: [], props: [], fogHeight: null, wallThickness: null, shapes: [{ id: 'r', outline: [0, 0, 0, 70, 0, 0, 35, 70, 2], sides: true }] }]),
    shapes: [{ id: 'hill', outline: [0, 0, 0, 70, 0, 0, 35, 70, 0], inner: [35, 30, 1.5], material: 'MAT' }, { id: 'broken', outline: [0, 0, 0, 1, 1, 1] }],
    ground: { mode: 'water' as const, noise: 'flat', strength: 0, fog: 20, margin: 5, tile: 2, water: { kind: 'waves', amount: 0.3, direction: 45, tint: '#336699', clarity: 0.5 } } };
  const [layer] = layersFromExtras(sent);
  assert.deepEqual(layer.shapes, [{ id: 'r', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 2 }], inner: [], sides: true }]);
  assert.deepEqual(shapesFromWire(sent.shapes), [{ id: 'hill', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 0 }], inner: [{ x: 35, y: 30, h: 1.5 }], material: 'MAT' }]);
  assert.deepEqual(groundFromWire(sent.ground), { mode: 'water', noise: 'flat', strength: 0, fog: FOG_MIN, margin: 5, tile: 2, water: { kind: 'waves', amount: 0.3, direction: 45, tint: '#336699', clarity: 0.5 }, lava: LIQUID_DEFAULTS.lava, acid: LIQUID_DEFAULTS.acid });
  // Lava to the horizon, with its own motion (an older GM's board sends none: it starts as lava does).
  const lava = groundFromWire({ ...sent.ground, mode: 'lava', lava: { kind: 'waves', amount: 0.2, direction: 10, tint: '#c2240f', clarity: 0 } });
  assert.deepEqual([lava.mode, lava.lava.tint, lava.acid], ['lava', '#c2240f', LIQUID_DEFAULTS.acid]);
  assert.equal(groundFromWire(undefined).mode, 'board');
});

test("a painted ground from the wire reads as the painted mode, its background the terrain picture's id", () => {
  const liquid = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };
  const painted = { terrain: 'TERRAIN', material: 'MATERIAL', height: 'HEIGHT', materials: ['MAT', ''], settings: { patterns: [], height: { low: -2, high: 6 }, liquids: { water: liquid, lava: liquid, acid: liquid } } };
  const ground = { mode: 'painted' as const, noise: 'rolling', strength: 0.5, fog: 40, margin: 0, tile: 2, water: liquid, painted };
  const read = groundFromWire(ground);
  assert.equal(read.mode, 'painted');
  assert.equal(read.background, paintedRef(painted));
  assert.ok(read.background!.startsWith('TERRAIN|MATERIAL|HEIGHT|'));
  assert.equal(paintedFromWire(ground), painted);
  assert.equal(paintedFromWire(undefined), null);
  assert.equal(paintedFromWire({ ...ground, mode: 'horizon' }), null);
});

test('two painted backgrounds that share a terrain picture, or differ only in settings or another picture, have different refs', () => {
  const liquid = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };
  const settings = { patterns: [], height: { low: -2, high: 6 }, liquids: { water: liquid, lava: liquid, acid: liquid } };
  const painted = { terrain: 'TERRAIN', material: 'MATERIAL', height: 'HEIGHT', materials: ['MAT', ''], settings };
  const same = paintedRef({ ...painted, settings: { ...settings } });
  assert.equal(paintedRef(painted), same, 'the same background keeps its ref');
  const other = [
    { ...painted, settings: { ...settings, height: { low: -2, high: 7 } } },
    { ...painted, material: 'MATERIAL2' },
    { ...painted, height: 'HEIGHT2' },
    { ...painted, materials: ['MAT2', ''] },
  ].map(paintedRef);
  assert.equal(new Set([paintedRef(painted), ...other]).size, 5);
});

test('a props picture or a brush change alone gives a painted background a new ref', () => {
  const liquid = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };
  const settings = { patterns: [], height: { low: -2, high: 6 }, liquids: { water: liquid, lava: liquid, acid: liquid } };
  const painted = { terrain: 'TERRAIN', material: 'MATERIAL', height: 'HEIGHT', props: 'PROPS', materials: [], settings: { ...settings, props: [{ name: 'Pines', props: ['PINE'], density: 10, scale: 1 }] } };
  const other = [
    { ...painted, props: 'PROPS2' },
    { ...painted, props: undefined },
    { ...painted, settings: { ...painted.settings, props: [{ name: 'Pines', props: ['PINE', 'OAK'], density: 10, scale: 1 }] } },
    { ...painted, settings: { ...painted.settings, props: [{ name: 'Pines', props: ['PINE'], density: 11, scale: 1 }] } },
  ].map(paintedRef);
  assert.equal(new Set([paintedRef(painted), ...other]).size, 5);
});

test('a painted background from the wire reads its brushes with their models as asset ids, clamped', () => {
  const liquid = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };
  const brushes = [{ name: 'Pines', props: ['A'.repeat(43), 'B'.repeat(43)], density: 10, scale: 1 }, { name: 'None', props: [], density: 5, scale: 2 }];
  const settings = backgroundSettingsFromWire({ terrain: 'T', material: 'M', height: 'H', materials: ['MAT'], settings: { patterns: [], height: { low: -2, high: 6 }, liquids: { water: liquid, lava: liquid, acid: liquid }, props: brushes } });
  assert.deepEqual(settings.props, brushes);
  assert.deepEqual(settings.materials, []);
  const old = backgroundSettingsFromWire({ terrain: 'T', material: 'M', height: 'H', materials: [], settings: { patterns: [], height: { low: -2, high: 6 }, liquids: { water: liquid, lava: liquid, acid: liquid } } });
  assert.deepEqual(old.props, []);
});
