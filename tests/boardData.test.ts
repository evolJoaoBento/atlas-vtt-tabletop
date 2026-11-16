import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrasOf } from '../src/board/recordExtras';
import { mirroredDoor, rotatedDoor } from '../src/board/walls';
import { BoardData, DEFAULT_WALL_THICKNESS, lookOf, readBoardData, readVariants } from '../src/board/boardData';

/** What a map's data still holds of the 3D settings, read as the board reads it. */
const legacy = (data: BoardData, path: string) => extrasOf(null, data.legacyExtras(path));

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

test("a 0.14 room wall's height, width, material and window move to Atlas 0.15's room wall, once", () => {
  const path = 'maps/a.atlasmap';
  const data = new BoardData({ [path]: {
    wallHeights: { room_0_0_80_0: 3, drawn: 1 }, wallWidths: { room_0_0_80_0: 0.2 }, wallMaterials: { room_0_0_80_0: 'Materials/stone' },
    windows: { room_0_0_80_0: { bottom: 1, top: 2 } },
  } });
  assert.deepEqual([...data.wallKeys(path)].sort(), ['drawn', 'room_0_0_80_0']);
  assert.equal(data.roomWallsMoved(path), false);
  const moved = data.moveWallKeys(path, [{ from: 'room_0_0_80_0', to: 'room_L1_0_0_80_0' }, { from: 'room_0_0_80_0', to: 'room_L2_0_0_80_0' }, { from: 'absent', to: 'x' }]);
  assert.equal(moved, 4);
  assert.equal(data.roomWallsMoved(path), true);
  for (const id of ['room_L1_0_0_80_0', 'room_L2_0_0_80_0']) {
    assert.equal(legacy(data, path).wallHeight(id), 3);
    assert.equal(legacy(data, path).wallWidth(id), 0.2);
    assert.equal(legacy(data, path).wallMaterial(id), 'Materials/stone');
    assert.deepEqual(legacy(data, path).windowOf(id), { bottom: 1, top: 2 });
  }
  assert.equal(legacy(data, path).wallHeight('room_0_0_80_0'), null);
  assert.equal(legacy(data, path).wallHeight('drawn'), 1);
  assert.equal(legacy(data, path).wallHeight('x'), null);
  // Kept across a save and a load, also for a map with nothing else.
  assert.equal(new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON())))).roomWallsMoved(path), true);
  const bare = new BoardData();
  assert.equal(bare.moveWallKeys('maps/b.atlasmap', []), 0);
  assert.equal(new BoardData(readBoardData(JSON.parse(JSON.stringify(bare.toJSON())))).roomWallsMoved('maps/b.atlasmap'), true);
});

test("a map's own light level and tint are no longer used, and are kept only until they are backed up", () => {
  const data = new BoardData(readBoardData({ 'maps/a.atlasmap': { ambient: 0.5, tint: '#336699', fogHeight: 2 }, 'maps/b.atlasmap': { ambient: 0.2 }, 'maps/c.atlasmap': { fogHeight: 3 } }));
  assert.deepEqual(data.legacyLighting(), { 'maps/a.atlasmap': { ambient: 0.5, tint: '#336699' }, 'maps/b.atlasmap': { ambient: 0.2 } });
  // Until they are backed up they are saved as they were, so a save in between loses nothing.
  assert.deepEqual(JSON.parse(JSON.stringify(data.toJSON())), { 'maps/a.atlasmap': { ambient: 0.5, tint: '#336699', fogHeight: 2 }, 'maps/b.atlasmap': { ambient: 0.2 }, 'maps/c.atlasmap': { fogHeight: 3 } });
  data.setFogHeight('maps/a.atlasmap', 4);
  assert.deepEqual(JSON.parse(JSON.stringify(data.toJSON()))['maps/a.atlasmap'], { ambient: 0.5, tint: '#336699', fogHeight: 4 });
  data.dropLegacyLighting();
  assert.deepEqual(data.legacyLighting(), {});
  assert.deepEqual(JSON.parse(JSON.stringify(data.toJSON())), { 'maps/a.atlasmap': { fogHeight: 4 }, 'maps/c.atlasmap': { fogHeight: 3 } });
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

test("what a map kept of the GM's 3D settings before they moved to Atlas's records is read as it was, and goes once it has moved", () => {
  const data = new BoardData({
    m: { wallMaterials: { w1: 'Bricks' }, doorProps: { d1: 'props/door.glb' }, wallHeights: { w1: 2 }, wallWidths: { w1: 0.3 }, lightHeights: { l1: 1.5 }, windows: { w1: { bottom: 1, top: 2 } }, doorFlips: { d1: { side: true } }, fogHeight: 2 },
    plain: { fogHeight: 3 },
  });
  const old = legacy(data, 'm');
  assert.deepEqual([old.wallMaterial('w1'), old.doorProp('d1'), old.wallHeight('w1'), old.wallWidth('w1'), old.lightHeight('l1'), old.windowOf('w1'), old.doorFlip('d1')],
    ['Bricks', 'props/door.glb', 2, 0.3, 1.5, { bottom: 1, top: 2 }, { hinge: false, side: true }]);
  // The same object until the map's data changes: what reads it need not work it out again.
  assert.equal(data.legacyExtras('m'), data.legacyExtras('m'));
  assert.equal(data.legacyExtras('plain'), null);
  assert.equal(data.legacyExtras('none'), null);
  let changes = 0;
  data.onChange(() => { changes += 1; });
  data.clearLegacyExtras('m');
  assert.equal(data.legacyExtras('m'), null);
  assert.deepEqual(data.toJSON().m, { fogHeight: 2, extrasMoved: true });
  assert.equal(changes, 1);
  // Done once: a second call changes nothing.
  data.clearLegacyExtras('m');
  data.clearLegacyExtras('none');
  assert.equal(changes, 1);
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

test("a stack kept by an older Tabletop is read as it was saved (each layer's base, height and place), for its move to Atlas levels; a scene can still leave it", () => {
  const data = new BoardData(readBoardData({ upper: { layer: { base: 'ground', elevation: 2, x: 35, y: -70, turn: 15 } }, roof: { layer: { base: 'ground', elevation: 3.5 } }, cellar: { layer: { base: 'keep', elevation: -1 } } }));
  assert.deepEqual(data.layerOf('upper'), { base: 'ground', elevation: 2, x: 35, y: -70, turn: 15 });
  assert.equal(data.layerOf('ground'), null);
  assert.deepEqual(data.stacks(), [
    { base: 'ground', members: [{ path: 'upper', elevation: 2, placement: { x: 35, y: -70, turn: 15 } }, { path: 'roof', elevation: 3.5, placement: { x: 0, y: 0, turn: 0 } }] },
    { base: 'keep', members: [{ path: 'cellar', elevation: -1, placement: { x: 0, y: 0, turn: 0 } }] },
  ]);
  assert.deepEqual(data.layersOf('alone'), []);
  for (const path of ['upper', 'roof', 'cellar']) data.clearLayer(path);
  assert.deepEqual(data.stacks(), []);
  assert.deepEqual(data.toJSON(), {});
});

test('layers survive a save and load, and follow a renamed or deleted base', () => {
  const data = new BoardData(readBoardData({ upper: { layer: { base: 'ground', elevation: 2, x: 35, y: -70, turn: 15 } } }));
  const loaded = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(loaded.layerOf('upper'), { base: 'ground', elevation: 2, x: 35, y: -70, turn: 15 });
  assert.equal(readBoardData({ upper: { layer: { base: 'ground', elevation: 'high' } } }).upper, undefined);
  loaded.rename('ground', 'floor/ground');
  assert.deepEqual(loaded.layerOf('upper'), { base: 'floor/ground', elevation: 2, x: 35, y: -70, turn: 15 });
  loaded.rename('upper', 'floor/upper');
  assert.deepEqual(loaded.layerOf('floor/upper'), { base: 'floor/ground', elevation: 2, x: 35, y: -70, turn: 15 });
  loaded.deleted('floor/ground');
  assert.equal(loaded.layerOf('floor/upper'), null);
});

test('a door can be rotated half a turn or mirrored, which only moves its hinge; both undo themselves', () => {
  const none = { hinge: false, side: false };
  assert.deepEqual(rotatedDoor(none), { hinge: true, side: true });
  assert.deepEqual(mirroredDoor(rotatedDoor(none)), { hinge: false, side: true });
  assert.deepEqual(rotatedDoor(rotatedDoor(none)), none);
  assert.deepEqual(mirroredDoor(mirroredDoor(none)), none);
});

test('a solid prop and a raised one keep that when saved and read back; a moved prop goes last', () => {
  const data = new BoardData();
  const a = data.addProp('m', { glb: 'a.glb', x: 0, y: 0, rotation: 0, scale: 1 });
  const b = data.addProp('m', { glb: 'b.glb', x: 0, y: 0, rotation: 0, scale: 1 });
  data.setPropSolid('m', a.id, true);
  data.setPropLift('m', b.id, 1.5);
  const read = readBoardData(JSON.parse(JSON.stringify(data.toJSON())));
  assert.equal(read.m?.props?.[0]?.solid, true);
  assert.equal(read.m?.props?.[1]?.lift, 1.5);
  data.setPropLift('m', b.id, 0);
  assert.equal('lift' in data.props('m')[1]!, false);
  data.moveProp('m', a.id, 5, 5);
  assert.deepEqual(data.props('m').map((prop) => prop.id), [b.id, a.id]);
});

test('variants read back whole, the broken ones left out; a look gives scale, and solid and height only when set', () => {
  assert.deepEqual(readVariants([{ id: 'v', name: 'Big crate', glb: 'c.glb', scale: 2, solid: true, lift: 1 }, { id: 'w', name: 'x' }, 5]), [{ id: 'v', name: 'Big crate', glb: 'c.glb', scale: 2, solid: true, lift: 1 }]);
  assert.deepEqual(readVariants(null), []);
  assert.deepEqual(lookOf({ scale: 1.5, solid: false, lift: 0 }), { scale: 1.5 });
  assert.deepEqual(lookOf(undefined), { scale: 1 });
});

const cutPose = { eye: { x: 0, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 } };
const cutShot = (id: string, at: number, mapPath: string) => ({ id, at, mapPath, ...cutPose, keyframe: false, transition: 'fade' as const });
const cutscene = (id: string, shots: ReturnType<typeof cutShot>[]) => ({ id, name: id, shots });

test('cutscenes are put by id, replaced and removed', () => {
  const data = new BoardData();
  assert.deepEqual(data.cutscenesOf('maps/a.atlasmap'), []);
  data.putCutscene('maps/a.atlasmap', cutscene('c1', [cutShot('s', 0, 'maps/a.atlasmap')]));
  assert.equal(data.cutscenesOf('maps/a.atlasmap').length, 1);
  data.putCutscene('maps/a.atlasmap', cutscene('c1', [cutShot('s', 0, 'maps/a.atlasmap'), cutShot('t', 1000, 'maps/a.atlasmap')]));
  data.putCutscene('maps/a.atlasmap', cutscene('c2', []));
  assert.deepEqual(data.cutscenesOf('maps/a.atlasmap').map((c) => [c.id, c.shots.length]), [['c1', 2], ['c2', 0]]);
  data.removeCutscene('maps/a.atlasmap', 'c1');
  data.removeCutscene('maps/a.atlasmap', 'c2');
  assert.deepEqual(data.toJSON(), {});
});

test('cutscene shots follow a map rename and a map deletion', () => {
  const make = () => new BoardData({ 'maps/a.atlasmap': { cutscenes: [cutscene('c', [cutShot('s0', 0, 'maps/a.atlasmap'), cutShot('s1', 1000, 'maps/b.atlasmap'), cutShot('s2', 2000, 'maps/a.atlasmap')])] } });
  const renamed = make();
  renamed.rename('maps/b.atlasmap', 'maps/c.atlasmap');
  assert.deepEqual(renamed.cutscenesOf('maps/a.atlasmap')[0].shots.map((s) => s.mapPath), ['maps/a.atlasmap', 'maps/c.atlasmap', 'maps/a.atlasmap']);
  const gone = make();
  gone.deleted('maps/b.atlasmap');
  assert.deepEqual(gone.cutscenesOf('maps/a.atlasmap')[0].shots.map((s) => s.id), ['s0', 's2']);
  gone.deleted('maps/a.atlasmap');
  assert.deepEqual(gone.toJSON(), {});
});

test('readBoardData round-trips cutscenes', () => {
  const data = new BoardData();
  data.putCutscene('m', cutscene('c', [cutShot('s0', 0, 'm'), cutShot('s1', 1000, 'm')]));
  const read = readBoardData(JSON.parse(JSON.stringify(data.toJSON())));
  assert.deepEqual(read, data.toJSON());
  assert.equal(read.m?.cutscenes?.[0].shots.length, 2);
});

test("what a map kept of painted water before it moved to Atlas's liquids is read as it was, and goes once it has moved", () => {
  const water = { mask: { width: 4, height: 4, data: 'AQ==' }, motion: { kind: 'flow' as const, amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 } };
  const data = new BoardData(readBoardData(JSON.parse(JSON.stringify({ m: { water, fogHeight: 2 }, plain: { fogHeight: 3 } }))));
  assert.deepEqual(data.legacyWater('m'), water);
  assert.equal(data.legacyWater('plain'), null);
  assert.equal(data.legacyWater('none'), null);
  let changes = 0;
  data.onChange(() => { changes += 1; });
  data.clearLegacyWater('m');
  assert.equal(data.legacyWater('m'), null);
  assert.deepEqual(data.toJSON().m, { fogHeight: 2, waterMoved: true });
  // Kept through a save, and done once.
  assert.deepEqual(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))).m, { fogHeight: 2, waterMoved: true });
  data.clearLegacyWater('m');
  data.clearLegacyWater('none');
  assert.equal(changes, 1);
});

test('raised shapes: saved per map, replaced by id, removed, and read back from saved data', () => {
  const data = new BoardData();
  const seen: Array<string | null> = [];
  data.onChange((map) => seen.push(map));
  const roof = { id: 'r1', level: 'L2', outline: [{ x: 0, y: 0, h: 1 }, { x: 10, y: 0, h: 1 }, { x: 10, y: 10, h: 1 }], inner: [{ x: 5, y: 5, h: 3 }] };
  data.saveShape('m', roof);
  data.saveShape('m', { ...roof, inner: [] });
  assert.deepEqual(data.shapes('m'), [{ ...roof, inner: [] }]);
  assert.deepEqual(seen, ['m', 'm']);
  const read = new BoardData(readBoardData(JSON.parse(JSON.stringify(data.toJSON()))));
  assert.deepEqual(read.shapes('m'), [{ ...roof, inner: [] }]);
  data.removeShape('m', 'r1');
  assert.deepEqual(data.shapes('m'), []);
  assert.equal(data.toJSON().m, undefined);
});
