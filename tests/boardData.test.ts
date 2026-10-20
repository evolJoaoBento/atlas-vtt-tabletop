import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData, readBoardData } from '../src/board/boardData';

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
