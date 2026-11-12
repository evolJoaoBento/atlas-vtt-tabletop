import assert from 'node:assert/strict';
import { test } from 'node:test';
import { doorChanges, RecentDrops, remoteMoves, sceneKey } from '../src/sound/miniSounds';

const at = (x: number, y: number) => ({ x, y });
const NONE: ReadonlySet<string> = new Set();

test('a token moved by 2 cells is listed', () => {
  assert.deepEqual(remoteMoves(new Map([['a', at(0, 0)]]), new Map([['a', at(140, 0)]]), 70, NONE), ['a']);
});

test('one moved by 0.1 cell is not, and the line is a quarter of a cell', () => {
  assert.deepEqual(remoteMoves(new Map([['a', at(0, 0)]]), new Map([['a', at(7, 0)]]), 70, NONE), []);
  assert.deepEqual(remoteMoves(new Map([['a', at(0, 0)]]), new Map([['a', at(17, 0)]]), 70, NONE), []);
  assert.deepEqual(remoteMoves(new Map([['a', at(0, 0)]]), new Map([['a', at(18, 0)]]), 70, NONE), ['a']);
});

test('an id in ignore is not listed', () => {
  assert.deepEqual(remoteMoves(new Map([['a', at(0, 0)], ['b', at(0, 0)]]), new Map([['a', at(140, 0)], ['b', at(0, 140)]]), 70, new Set(['a'])), ['b']);
});

test('a token that is new or gone is not listed', () => {
  assert.deepEqual(remoteMoves(new Map([['gone', at(0, 0)]]), new Map([['new', at(500, 500)]]), 70, NONE), []);
});

test('doors that changed between two syncs are listed, new and gone ones are not', () => {
  const before = new Map([['a', true], ['b', false], ['c', true]]);
  const after = new Map([['a', false], ['b', false], ['d', false]]);
  assert.deepEqual(doorChanges(before, after), [{ id: 'a', closed: false }]);
});

test('a drop is remembered for 2 seconds', () => {
  let now = 1000;
  const drops = new RecentDrops(() => now);
  drops.mark(['a', 'b']);
  now = 2999;
  assert.deepEqual([...drops.active()].sort(), ['a', 'b']);
  now = 3000;
  assert.deepEqual([...drops.active()], []);
});

test('a later drop of the same token is remembered from then on', () => {
  let now = 0;
  const drops = new RecentDrops(() => now);
  drops.mark(['a']);
  now = 1500;
  drops.mark(['a']);
  now = 3000;
  assert.deepEqual([...drops.active()], ['a']);
});

test('a scene is named by its map and level', () => {
  assert.notEqual(sceneKey({ path: 'a.atlasmap', level: null }), sceneKey({ path: 'b.atlasmap', level: null }));
  assert.notEqual(sceneKey({ path: 'a.atlasmap', level: 'up' }), sceneKey({ path: 'a.atlasmap', level: null }));
  assert.equal(sceneKey({ path: 'a.atlasmap', level: 'up' }), sceneKey({ path: 'a.atlasmap', level: 'up' }));
});
