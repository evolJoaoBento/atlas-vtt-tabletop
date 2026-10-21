import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardFromScene, DARKNESS_FOG_ID, type PlayerSceneLike } from '../src/board/sceneAdapter';
import type { BoardExtras } from '../src/connectContract';

const scene = (overrides: Partial<PlayerSceneLike> = {}): PlayerSceneLike => ({
  sceneId: 's1',
  map: { asset: 'MAP', width: 1400, height: 900, cellSize: 70 },
  grid: { type: 'square', size: 70, offsetX: 5, offsetY: 0, color: '#000000', opacity: 0.5, lineType: 'dashed', lineWidth: 1, hexNumbers: null, hexNumberOpacity: null, cellNumbers: 'letter-number', cellNumberOpacity: 0.6 },
  tokens: {
    t1: { x: 105, y: 105, size: 1, rotation: 90, layer: 0, image: 'ART', ring: '#ff0000', conditions: [{ id: 'prone', value: null, name: 'Prone', color: '#123456' }, { id: 'exh', value: 2 }], name: 'Anna', hp: { current: 5, max: 10 }, stress: null, resources: [{ color: '#00ff00', share: 0.5, spent: false, current: 3, max: 6 }], instance: 2, side: 'players', mini: { asset: 'GLB', scale: 1.5, turn: 45 } },
    t2: { x: 0, y: 0, size: 2, rotation: 0, layer: 0, image: null, ring: null, conditions: [], name: null, hp: null, stress: null, downed: true },
  },
  fog: {
    f1: { type: 'rectangle', erase: false, order: 1, x: 0, y: 0, width: 100, height: 100 },
    [DARKNESS_FOG_ID]: { type: 'lasso', erase: false, order: Number.MAX_SAFE_INTEGER, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
  },
  texts: { x1: { x: 10, y: 20, text: 'Hall', fontSize: 24, fontFamily: 'Arial', color: '#fff', backgroundColor: null, padding: 8, borderRadius: 0, opacity: 1, width: null, height: null, align: 'center', bold: false, italic: false, rotation: 0, scale: 1 } },
  drawings: {
    d1: { type: 'pen', order: 2, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#f00', width: 3, opacity: 1, icon: null },
    d2: { type: 'icon', order: 1, points: [{ x: 50, y: 60 }], color: '#fff', width: 70, opacity: 0.8, icon: 'skull' },
    d3: { type: 'eraser', order: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#000', width: 9, opacity: 1, icon: null },
  },
  initiative: { round: 2, active: true, entries: [{ id: 'e1', tokenId: 't1', initiative: 15, name: 'Anna', hp: null, isActive: true }] },
  measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], snapToGrid: true, coneAngle: 53 },
  pins: [{ id: 'p1', x: 300, y: 400, label: '3', title: 'Crypt', icon: 'number' }],
  ...overrides,
});

const extras: BoardExtras = {
  sceneId: 's1',
  walls: [
    { id: 'w1', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, height: 2, material: 'MAT', blocks: 'light' },
    { id: 'd1', type: 'door', p1: { x: 70, y: 0 }, p2: { x: 140, y: 0 }, height: null, material: null, door: { open: true, swing: 'right', prop: 'DOORGLB', chainId: 'c1' } },
  ],
  lights: [
    { id: 'l1', x: 30, y: 40, height: 1.5, color: '#ffaa00', bright: 10, dim: 20, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null },
    { id: 't1', x: 105, y: 105, height: null, color: '#ffffff', bright: 5, dim: 10, intensity: 1, animation: null, angle: 60, rotation: 90, darkness: false, activeBelowAmbient: 0.5 },
  ],
  props: [], materials: [], ambient: 0.3, fogHeight: 2, wallThickness: 0.2,
  lighting: { enabled: true, ambient: 0.2, ambientColor: '#223344' },
};

test('the map, grid and tokens of a Connect scene, by asset id', () => {
  const { map } = boardFromScene(scene(), null);
  assert.equal(map.path, 's1');
  assert.equal(map.background, 'MAP');
  assert.deepEqual([map.grid.type, map.grid.size, map.grid.offsetX, map.grid.visible, map.grid.snap, map.grid.lineType, map.grid.numbers, map.grid.numberOpacity], ['square', 70, 5, true, true, 'dashed', 'letter-number', 0.6]);
  const anna = map.tokens.find((token) => token.id === 't1')!;
  assert.deepEqual([anna.x, anna.y, anna.rotation, anna.imagePath, anna.name, anna.showRing, anna.ringColor, anna.instanceNumber, anna.side, anna.statblockPath], [105, 105, 90, 'ART', 'Anna', true, '#ff0000', 2, 'players', null]);
  assert.deepEqual(anna.conditions, ['prone', 'exh']);
  assert.deepEqual(anna.conditionValues, { exh: 2 });
  assert.deepEqual(anna.resources.hp, { current: 5, max: 10 });
  assert.deepEqual(anna.resources.r0, { current: 3, max: 6 });
});

test('the scene\'s rules: its conditions named and coloured, its bars as resources, a downed token defeated', () => {
  const { rules, map } = boardFromScene(scene(), null);
  assert.deepEqual(rules.conditions.get('prone'), { name: 'Prone', color: '#123456', valued: false });
  assert.equal(rules.definitions.find((definition) => definition.key === 'r0')?.color, '#00ff00');
  const downed = map.tokens.find((token) => token.id === 't2')!;
  const defeating = rules.definitions.filter((definition) => definition.defeatedWhenSpent);
  assert.ok(defeating.some((definition) => downed.resources[definition.key]?.current === 0));
  assert.ok(!defeating.some((definition) => map.tokens[0]!.resources[definition.key]?.current === 0));
});

test('minis by token, pins as readable pins, texts, ink and icon stamps; erasers left out', () => {
  const { map, minis } = boardFromScene(scene(), null);
  assert.deepEqual(minis, { t1: { glb: 'GLB', scale: 1.5, turn: 45 } });
  assert.deepEqual(map.pins.map((pin) => [pin.id, pin.x, pin.y, pin.label, pin.icon]), [['p1', 300, 400, '3', 'number']]);
  assert.equal(map.texts[0]!.text, 'Hall');
  assert.deepEqual(map.inks.map((ink) => ink.id), ['d1']);
  assert.deepEqual(map.icons.map((icon) => [icon.icon, icon.x, icon.y, icon.size, icon.opacity]), [['skull', 50, 60, 70, 0.8]]);
  assert.deepEqual([map.initiative.round, map.initiative.isActive, map.initiative.entries[0]?.tokenId], [2, true, 't1']);
});

test('the darkness goes to its own layer, the GM\'s fog stays fog', () => {
  const { map } = boardFromScene(scene(), null);
  assert.deepEqual(map.fog.map((op) => [op.id, op.type, op.isErasing]), [['f1', 'rectangle', false]]);
  assert.deepEqual(map.darkness.map((op) => op.id), [DARKNESS_FOG_ID]);
});

test('the board extras become walls, doors and lights; a token\'s light follows its token', () => {
  const { map, look } = boardFromScene(scene(), extras);
  assert.deepEqual(map.walls.map((wall) => [wall.id, wall.type, wall.closed, wall.blocks, wall.chain]), [['w1', 'solid', true, 'light', null], ['d1', 'door', false, null, 'c1']]);
  assert.deepEqual(map.lights.map((light) => [light.id, light.tokenId, light.animation, light.angle, light.activeBelowAmbient]), [['l1', null, 'torch', null, null], ['t1', 't1', 'none', 60, 0.5]]);
  assert.deepEqual(map.lighting, { enabled: true, ambient: 0.2, ambientColor: '#223344' });
  assert.deepEqual([look.wallHeight('w1'), look.wallMaterial('w1'), look.doorProp('d1'), look.lightHeight('l1'), look.fogHeight, look.ambient, look.wallThickness], [2, 'MAT', 'DOORGLB', 1.5, 2, 0.3, 0.2]);
  const bare = boardFromScene(scene(), null);
  assert.deepEqual([bare.map.walls, bare.map.lights], [[], []]);
});

test('board extras of another scene are not this scene\'s: none of their walls or lights are used', () => {
  const { map } = boardFromScene(scene(), { ...extras, sceneId: 'other' });
  assert.deepEqual([map.walls, map.lights], [[], []]);
});

test('each token\'s bars keep the colour Connect worked out for it (yellow, then red as it runs low)', () => {
  const low = scene();
  low.tokens.t2 = { ...low.tokens.t2!, resources: [{ color: '#ef4444', share: 0.2, spent: false, current: 2, max: 10 }] };
  low.tokens.t1 = { ...low.tokens.t1!, resources: [{ color: '#22c55e', share: 0.9, spent: false, current: 9, max: 10 }] };
  const { map, rules } = boardFromScene(low, null);
  assert.equal(map.tokens.find((token) => token.id === 't1')!.resourceColors?.r0, '#22c55e');
  assert.equal(map.tokens.find((token) => token.id === 't2')!.resourceColors?.r0, '#ef4444');
  // An older GM's plain HP bar: coloured as Atlas colours a defeating resource.
  assert.equal(rules.definitions.find((definition) => definition.key === 'hp')?.defeatedWhenSpent, true);
});
