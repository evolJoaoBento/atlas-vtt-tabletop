import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData, DEFAULT_WALL_THICKNESS, readBoardData } from '../src/board/boardData';

test('tokens are discs by default; standee round-trips; disc deletes the entry', () => {
  const data = new BoardData();
  const seen: Array<string | null> = [];
  data.onChange((map) => seen.push(map));
  assert.equal(data.style('m', 't'), 'disc');
  data.setStyle('m', 't', 'standee');
  assert.equal(data.style('m', 't'), 'standee');
  data.setStyle('m', 't', 'disc');
  assert.deepEqual(data.toJSON(), {});
  assert.deepEqual(seen, ['m', 'm']);
});

test('props add, move and remove', () => {
  const data = new BoardData();
  const prop = data.addProp('m', { glb: 'props/barrel.glb', x: 1, y: 2, rotation: 0, scale: 1 });
  assert.match(prop.id, /^prop_\d+_[a-z0-9]+$/);
  data.moveProp('m', prop.id, 5, 6);
  assert.deepEqual(data.props('m'), [{ ...prop, x: 5, y: 6 }]);
  data.removeProp('m', prop.id);
  assert.deepEqual(data.props('m'), []);
  assert.deepEqual(data.toJSON(), {});
});

test('rename follows maps, GLBs and folders, prefix-safe', () => {
  const data = new BoardData({ 'maps/a.atlasmap': { styles: { t: 'standee' }, props: [{ id: 'p', glb: 'props/x.glb', x: 0, y: 0, rotation: 0, scale: 1 }] }, 'maps2/b.atlasmap': { styles: { t: 'standee' } } });
  data.rename('maps', 'scenes');
  data.rename('props', 'things');
  assert.equal(data.style('scenes/a.atlasmap', 't'), 'standee');
  assert.equal(data.props('scenes/a.atlasmap')[0]!.glb, 'things/x.glb');
  assert.equal(data.style('maps2/b.atlasmap', 't'), 'standee');
});

test('deleting a map drops its data; deleting a GLB drops its props', () => {
  const data = new BoardData({ 'a.atlasmap': { styles: { t: 'standee' } }, 'b.atlasmap': { props: [{ id: 'p', glb: 'props/x.glb', x: 0, y: 0, rotation: 0, scale: 1 }, { id: 'q', glb: 'props/xy.glb', x: 0, y: 0, rotation: 0, scale: 1 }] } });
  data.deleted('a.atlasmap');
  data.deleted('props/x.glb');
  assert.deepEqual(data.toJSON(), { 'b.atlasmap': { props: [{ id: 'q', glb: 'props/xy.glb', x: 0, y: 0, rotation: 0, scale: 1 }] } });
});

test('readBoardData drops junk', () => {
  assert.deepEqual(readBoardData({ m: { styles: { a: 'standee', b: 'cube', c: 'disc' }, props: [{ id: 'p', glb: 'x.glb', x: 1, y: 2 }, { glb: 3 }] }, n: 5 }), {
    m: { styles: { a: 'standee' }, props: [{ id: 'p', glb: 'x.glb', x: 1, y: 2, rotation: 0, scale: 1 }] },
  });
  assert.deepEqual(readBoardData(null), {});
});

test('fog height is one square by default, kept per map, and read back from saved data', () => {
  const data = new BoardData();
  assert.equal(data.fogHeight('m'), 1);
  data.setFogHeight('m', 2.5);
  assert.equal(data.fogHeight('m'), 2.5);
  assert.equal(data.fogHeight('other'), 1);
  assert.deepEqual(readBoardData(data.toJSON()), { m: { fogHeight: 2.5 } });
  data.setFogHeight('m', 1);
  assert.deepEqual(data.toJSON(), {});
  assert.deepEqual(readBoardData({ a: { fogHeight: -1 }, b: { fogHeight: 'x' }, c: { fogHeight: 0 } }), { c: { fogHeight: 0 } });
});

test('wall materials (one segment or many), door props, light heights and ambient are kept per map, and read back', () => {
  const data = new BoardData();
  data.setWallMaterial('m', ['w1', 'w2'], 'atlas-vtt/assets/materials/Bricks');
  data.setWallMaterial('m', ['w2'], 'atlas-vtt/assets/materials/Wood');
  data.setDoorProp('m', 'd1', 'props/door.glb');
  data.setLightHeight('m', 'l1', 1.5);
  data.setAmbient('m', 0.2);
  assert.equal(data.wallMaterial('m', 'w1'), 'atlas-vtt/assets/materials/Bricks');
  assert.equal(data.wallMaterial('m', 'w2'), 'atlas-vtt/assets/materials/Wood');
  assert.equal(data.wallMaterial('m', 'w3'), null);
  assert.equal(data.lightHeight('m', 'l1'), 1.5);
  assert.equal(data.lightHeight('m', 'l2'), null);
  assert.equal(data.ambient('m'), 0.2);
  assert.equal(data.ambient('other'), null);
  assert.deepEqual(readBoardData(data.toJSON()), data.toJSON());
  data.setWallMaterial('m', ['w1', 'w2'], null);
  data.setDoorProp('m', 'd1', null);
  data.setLightHeight('m', 'l1', null);
  assert.deepEqual(data.toJSON(), { m: { ambient: 0.2 } });
  assert.deepEqual(readBoardData({ m: { ambient: 2, lightHeights: { a: -1, b: 2 }, wallMaterials: { w: 5 } } }), { m: { lightHeights: { b: 2 } } });
});

test('a renamed or deleted material folder or door prop is followed', () => {
  const data = new BoardData({ m: { wallMaterials: { w: 'mats/Bricks', v: 'mats/Wood' }, doorProps: { d: 'props/door.glb' } } });
  data.rename('mats/Bricks', 'mats/Stone');
  data.rename('props', 'things');
  assert.deepEqual(data.toJSON(), { m: { wallMaterials: { w: 'mats/Stone', v: 'mats/Wood' }, doorProps: { d: 'things/door.glb' } } });
  data.deleted('mats/Wood');
  data.deleted('things/door.glb');
  assert.deepEqual(data.toJSON(), { m: { wallMaterials: { w: 'mats/Stone' } } });
});

test('a wall\'s own height is kept per segment, many at once, and cleared back to the fog\'s', () => {
  const data = new BoardData();
  data.setWallHeight('m', ['a', 'b'], 2);
  data.setWallHeight('m', ['b'], 0.5);
  assert.equal(data.wallHeight('m', 'a'), 2);
  assert.equal(data.wallHeight('m', 'b'), 0.5);
  assert.equal(data.wallHeight('m', 'c'), null);
  assert.deepEqual(readBoardData(data.toJSON()), data.toJSON());
  data.setWallHeight('m', ['a', 'b'], null);
  assert.deepEqual(data.toJSON(), {});
});

test('wall thickness: a share of a square, 0.12 by default, kept per map and read back', () => {
  const data = new BoardData();
  assert.equal(data.wallThickness('m'), DEFAULT_WALL_THICKNESS);
  assert.equal(DEFAULT_WALL_THICKNESS, 0.12);
  data.setWallThickness('m', 0.3);
  assert.equal(data.wallThickness('m'), 0.3);
  data.setWallThickness('m', -1);
  data.setWallThickness('m', 0);
  assert.equal(data.wallThickness('m'), 0.3, 'none or less is no wall thickness at all: refused');
  assert.equal(readBoardData(JSON.parse(JSON.stringify(data.toJSON())))['m']?.wallThickness, 0.3);
  data.setWallThickness('m', DEFAULT_WALL_THICKNESS);
  assert.equal(data.toJSON()['m'], undefined, 'the default is not stored');
});

test('a map stacked on another is a layer of it, and either one opens the whole stack, lowest first', () => {
  const data = new BoardData();
  assert.equal(data.setLayer('upper', 'ground', 2), true);
  assert.deepEqual(data.layerOf('upper'), { base: 'ground', elevation: 2 });
  assert.equal(data.layerOf('ground'), null);
  const none = { x: 0, y: 0, turn: 0 };
  const stack = [{ path: 'ground', elevation: 0, placement: none }, { path: 'upper', elevation: 2, placement: none }];
  assert.deepEqual(data.stackOf('ground'), stack);
  assert.deepEqual(data.stackOf('upper'), stack);
  assert.deepEqual(data.stackOf('alone'), []);
});

test('a map stacked on a layer joins that layer\'s stack, measured from the base', () => {
  const data = new BoardData();
  data.setLayer('upper', 'ground', 2);
  assert.equal(data.setLayer('roof', 'upper', 1.5), true);
  assert.deepEqual(data.layerOf('roof'), { base: 'ground', elevation: 3.5 });
  assert.deepEqual(data.stackOf('roof').map((member) => member.path), ['ground', 'upper', 'roof']);
});

test('a map cannot be its own base, nor become a layer while it has layers of its own', () => {
  const data = new BoardData();
  assert.equal(data.setLayer('a', 'a', 1), false);
  assert.equal(data.setLayer('a', 'b', Number.NaN), false);
  data.setLayer('upper', 'ground', 2);
  assert.equal(data.setLayer('ground', 'other', 1), false);
  data.clearLayer('upper');
  assert.deepEqual(data.stackOf('ground'), []);
  assert.deepEqual(data.toJSON(), {});
});

test('layers survive a save and load, and follow a renamed or deleted base', () => {
  const data = new BoardData();
  data.setLayer('upper', 'ground', 2);
  const loaded = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(loaded.layerOf('upper'), { base: 'ground', elevation: 2 });
  assert.equal(readBoardData({ upper: { layer: { base: 'ground', elevation: 'high' } } }).upper, undefined);
  loaded.rename('ground', 'floor/ground');
  assert.deepEqual(loaded.layerOf('upper'), { base: 'floor/ground', elevation: 2 });
  loaded.rename('upper', 'floor/upper');
  assert.deepEqual(loaded.layerOf('floor/upper'), { base: 'floor/ground', elevation: 2 });
  loaded.deleted('floor/ground');
  assert.equal(loaded.layerOf('floor/upper'), null);
});

test('a layer can be placed on the plane beyond its height, and that survives a change of height, a save and a rename', () => {
  const data = new BoardData();
  assert.equal(data.setPlacement('upper', { x: 1, y: 2, turn: 3 }), false);
  data.setLayer('upper', 'ground', 2);
  assert.deepEqual(data.placementOf('upper'), { x: 0, y: 0, turn: 0 });
  assert.equal(data.setPlacement('upper', { x: 35, y: -70, turn: 15 }), true);
  assert.deepEqual(data.placementOf('upper'), { x: 35, y: -70, turn: 15 });
  data.setLayer('upper', 'ground', 3);
  assert.deepEqual(data.placementOf('upper'), { x: 35, y: -70, turn: 15 });
  assert.deepEqual(data.stackOf('ground')[1]!.placement, { x: 35, y: -70, turn: 15 });
  assert.deepEqual(data.stackOf('ground')[0]!.placement, { x: 0, y: 0, turn: 0 });
  const loaded = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(loaded.placementOf('upper'), { x: 35, y: -70, turn: 15 });
  loaded.rename('upper', 'floor/upper');
  assert.deepEqual(loaded.placementOf('floor/upper'), { x: 35, y: -70, turn: 15 });
  loaded.setPlacement('floor/upper', { x: 0, y: 0, turn: 0 });
  assert.deepEqual(loaded.layerOf('floor/upper'), { base: 'ground', elevation: 3 });
  assert.deepEqual(loaded.placementOf('ground'), { x: 0, y: 0, turn: 0 });
});

test('a door can be rotated half a turn or mirrored, which only moves its hinge; both undo themselves and survive a save', () => {
  const data = new BoardData();
  assert.deepEqual(data.doorFlip('m', 'd'), { hinge: false, side: false });
  data.rotateDoor('m', 'd');
  assert.deepEqual(data.doorFlip('m', 'd'), { hinge: true, side: true });
  data.mirrorDoor('m', 'd');
  // Half a turn then a mirror: the hinge is back, the door opens to the other side.
  assert.deepEqual(data.doorFlip('m', 'd'), { hinge: false, side: true });
  const loaded = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(loaded.doorFlip('m', 'd'), { hinge: false, side: true });
  loaded.rotateDoor('m', 'd');
  assert.deepEqual(loaded.doorFlip('m', 'd'), { hinge: true, side: false });
  loaded.mirrorDoor('m', 'd');
  assert.deepEqual(loaded.doorFlip('m', 'd'), { hinge: false, side: false });
  assert.deepEqual(loaded.toJSON(), {});
});
