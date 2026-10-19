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
