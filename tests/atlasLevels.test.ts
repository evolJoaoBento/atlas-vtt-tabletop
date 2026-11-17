import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData } from '../src/board/boardData';
import { levelName, levelRise, onFirstLevel, propsOnLevel, readLevels } from '../src/board/levels';
import { readMap } from '../src/board/mapModel';
import { LayerIndex, layersFor } from '../src/boardLayers';
import { boardLookFor } from '../src/boardLook';
import { extrasOf } from '../src/board/recordExtras';

const materials = { info: () => null };

test('levels stand at the heights Atlas gives them, else a level apart, bottom first', () => {
  const given = readLevels([{ id: 'a', elevation: { bottom: 0, top: 10 } }, { id: 'b', elevation: { bottom: 15, top: 25 } }]);
  assert.deepEqual(given.map((level) => level.bottom), [0, 15]);
  // No heights, or the same height for all: Atlas's own default, ten units each.
  assert.deepEqual(readLevels([{ id: 'a' }, { id: 'b' }, { id: 'c' }]).map((level) => level.bottom), [0, 10, 20]);
  assert.deepEqual(readLevels([{ id: 'a', elevation: { bottom: 0 } }, { id: 'b', elevation: { bottom: 0 } }]).map((level) => level.bottom), [0, 10]);
});

test('a level rises above another by its height over the units a square spans', () => {
  const levels = readLevels([{ id: 'a', elevation: { bottom: 0 } }, { id: 'b', elevation: { bottom: 10 } }, { id: 'c', name: 'Roof', elevation: { bottom: 25 } }]);
  assert.equal(levelRise(levels, 'a', 'b', 5), 2);
  assert.equal(levelRise(levels, 'c', 'a', 5), -5);
  assert.equal(levelRise(levels, 'a', 'c', 1.5), 16.67);
  // A distance that is no distance counts as five.
  assert.equal(levelRise(levels, 'a', 'b', 0), 2);
  assert.equal(levelName(levels, 'b'), 'Level 2');
  assert.equal(levelName(levels, 'c'), 'Roof');
});

test('props stand on their level, a prop without one on the first; water only on the first', () => {
  const levels = readLevels([{ id: 'a' }, { id: 'b' }]);
  const props = [{ id: 'p1' }, { id: 'p2', level: 'b' }, { id: 'p3', level: 'gone' }];
  assert.deepEqual(propsOnLevel(props, 'a', levels).map((prop) => prop.id), ['p1', 'p3']);
  assert.deepEqual(propsOnLevel(props, 'b', levels).map((prop) => prop.id), ['p2']);
  assert.deepEqual(propsOnLevel(props, null, []).map((prop) => prop.id), ['p1', 'p2', 'p3']);
  assert.equal(onFirstLevel(levels, 'a'), true);
  assert.equal(onFirstLevel(levels, 'b'), false);
  assert.equal(onFirstLevel([], null), true);
});

test('a prop keeps the level it was put on', () => {
  const data = new BoardData();
  data.addProp('s.atlasmap', { glb: 'a.glb', x: 0, y: 0, rotation: 0, scale: 1, level: 'b' });
  const again = new BoardData(JSON.parse(JSON.stringify(data.toJSON())));
  assert.equal(again.props('s.atlasmap')[0].level, 'b');
});

const scene = JSON.stringify({ state: {
  background: 'ground.png',
  grid: { size: 70, offsetX: 0, offsetY: 0, unitDistance: 5 },
  levels: [
    { id: 'a', elevation: { bottom: 0, top: 10 }, background: 'ground.png' },
    { id: 'b', name: 'Upstairs', elevation: { bottom: 10, top: 20 }, background: 'up.png' },
    { id: 'c', elevation: { bottom: 20, top: 30 }, background: null },
  ],
  objects: {
    tokens: { t1: { id: 't1', x: 1, y: 1 }, t2: { id: 't2', x: 2, y: 2, level: 'b' } },
    walls: {
      w1: { id: 'w1', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } },
      w2: { id: 'w2', levels: ['b'], p1: { x: 0, y: 70 }, p2: { x: 70, y: 70 } },
      w3: { id: 'w3', levels: 'all', p1: { x: 0, y: 140 }, p2: { x: 70, y: 140 } },
    },
  },
} });

function index(): LayerIndex {
  const vault = { getAbstractFileByPath: () => ({ path: 's.atlasmap' }), read: async () => scene };
  return new LayerIndex(vault as never, () => {});
}

test("a scene with levels sends its other levels as players' layers, at their heights from the level shown", async () => {
  const scenes = index();
  scenes.map('s.atlasmap');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const data = new BoardData();
  data.addProp('s.atlasmap', { glb: 'ground.glb', x: 0, y: 0, rotation: 0, scale: 1 });
  data.addProp('s.atlasmap', { glb: 'up.glb', x: 0, y: 0, rotation: 0, scale: 1, level: 'b' });
  const fromGround = layersFor(data, materials, scenes, 's.atlasmap', 'a');
  // Level c has no floor image: nothing to draw.
  assert.equal(fromGround.length, 1);
  assert.equal(fromGround[0].elevation, 2);
  assert.equal(fromGround[0].image, 'up.png');
  assert.deepEqual(fromGround[0].stands, { x: 0, y: 0, turn: 0 });
  assert.deepEqual(fromGround[0].walls.map((wall) => wall.id).sort(), ['w2', 'w3']);
  assert.deepEqual(fromGround[0].props.map((prop) => prop.path), ['up.glb']);
  const fromUp = layersFor(data, materials, scenes, 's.atlasmap', 'b');
  assert.equal(fromUp.length, 1);
  assert.equal(fromUp[0].elevation, -2);
  assert.equal(fromUp[0].image, 'ground.png');
  // A level's raised shapes go with it; the level shown's are the look's, not a layer's.
  data.saveShape('s.atlasmap', { id: 'roof', level: 'b', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 2 }], inner: [], sides: 'mat/brick' });
  const shaped = layersFor(data, materials, scenes, 's.atlasmap', 'a');
  assert.deepEqual(shaped[0].shapes, [{ id: 'roof', outline: [{ x: 0, y: 0, h: 0 }, { x: 70, y: 0, h: 0 }, { x: 35, y: 70, h: 2 }], inner: [], sides: 'mat/brick' }]);
  assert.equal(layersFor(data, materials, scenes, 's.atlasmap', 'b')[0].shapes, undefined);
  data.removeShape('s.atlasmap', 'roof');
  // A level the GM hid on the boards is not sent.
  data.setLayerHidden('s.atlasmap#atlas-level:b', true);
  assert.equal(layersFor(data, materials, scenes, 's.atlasmap', 'a').length, 0);
});

test("the shown level's props and water go to players, the others' stay", () => {
  const data = new BoardData();
  data.addProp('s.atlasmap', { glb: 'ground.glb', x: 0, y: 0, rotation: 0, scale: 1 });
  data.addProp('s.atlasmap', { glb: 'up.glb', x: 0, y: 0, rotation: 0, scale: 1, level: 'b' });
  const map = readMap('s.atlasmap', scene, 'b');
  const look = boardLookFor(data, materials, 's.atlasmap', [], { levels: map.levels, level: map.level });
  assert.deepEqual(look.props.map((prop) => prop.path), ['up.glb']);
  const plain = boardLookFor(data, materials, 's.atlasmap');
  assert.equal(plain.props.length, 2);
});

test("walls with no material painted go to players wearing their kind's default; painted ones keep theirs", () => {
  const data = new BoardData();
  const map = readMap('s.atlasmap', scene, 'b');
  const [first, second] = map.walls;
  // Painted in 3D: on the wall's own record.
  const painted = extrasOf({ walls: map.walls.map((wall) => (wall.id === first!.id ? { ...wall, extra: { material: 'mats/brick' } } : wall)), lights: [] });
  const known = { info: (folder: string) => ({ scale: 1, maps: { color: `${folder}/c.jpg` } }) };
  const look = boardLookFor(data, known, 's.atlasmap', [], { levels: map.levels, level: map.level }, { walls: map.walls, chosen: { wall: 'mats/stone' } }, painted);
  assert.equal(look.wallMaterial(first!.id), 'mats/brick');
  assert.equal(look.wallMaterial(second!.id), second!.type === 'solid' && second!.blocks === null && !second!.limited ? 'mats/stone' : look.wallMaterial(second!.id));
  assert.ok(look.materials.some((material) => material.id === 'mats/stone'), JSON.stringify(look.materials));
  // Without defaults, as before.
  assert.equal(boardLookFor(data, known, 's.atlasmap').wallMaterial(second!.id), null);
});

test('the level shown reads its own objects, the walls on every level included', () => {
  const up = readMap('s.atlasmap', scene, 'b');
  assert.equal(up.background, 'up.png');
  assert.deepEqual(up.walls.map((wall) => wall.id).sort(), ['w2', 'w3']);
  assert.deepEqual(up.tokens.filter((token) => !token.offLevel).map((token) => token.id), ['t2']);
});

test('a level keeps the alignment the scene file gives it on the level itself', () => {
  const level = (alignment?: unknown) => JSON.stringify({ state: {
    background: 'bg.png', grid: { size: 70 },
    levels: [{ id: 'a' }, { id: 'b', background: 'up.png', ...(alignment ? { alignment } : {}) }],
    objects: {},
  } });
  const plain = readMap('s.atlasmap', level(), 'b').grid;
  const stretched = readMap('s.atlasmap', level({ offset: { x: 0, y: 0 }, scale: 1, stretch: { x: 1.4, y: 1.2, rotation: 0 } }), 'b').grid;
  assert.notDeepEqual(stretched, plain);
});

test('a light on every level lights the shown level only, never a layer as well', async () => {
  const text = JSON.stringify({ state: {
    background: 'g.png', grid: { size: 70 },
    levels: [{ id: 'a', background: 'g.png' }, { id: 'b', background: 'u.png' }],
    objects: { lights: {
      sun: { id: 'sun', x: 1, y: 1, emission: { bright: 10, dim: 20 }, levels: 'all' },
      lamp: { id: 'lamp', x: 2, y: 2, emission: { bright: 10, dim: 20 }, levels: ['b'] },
    } },
  } });
  const vault = { getAbstractFileByPath: () => ({ path: 'l.atlasmap' }), read: async () => text };
  const scenes = new LayerIndex(vault as never, () => {});
  scenes.map('l.atlasmap');
  await new Promise((resolve) => setTimeout(resolve, 0));
  const [layer] = layersFor(new BoardData(), materials, scenes, 'l.atlasmap', 'a');
  assert.deepEqual(layer.lights.map((light) => light.id), ['lamp']);
});
