import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultsUsed, materialKindOf, materialWith, readMaterialDefaults } from '../src/materialDefaults';
import type { BoardWall } from '../src/board/walls';

const wall = (over: Partial<BoardWall> = {}): BoardWall => ({ id: 'w', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, direction: null, closed: true, locked: false, blocks: null, limited: false, chain: null, ...over });

test('each kind of wall is told apart for its default; glass takes none', () => {
  assert.equal(materialKindOf(wall()), 'wall');
  assert.equal(materialKindOf(wall({ type: 'door' })), 'door');
  assert.equal(materialKindOf(wall({ type: 'secret-door' })), 'secretDoor');
  assert.equal(materialKindOf(wall({ blocks: 'movement' })), 'window');
  assert.equal(materialKindOf(wall({ limited: true })), 'lowWall');
  assert.equal(materialKindOf(wall({ blocks: 'sight' })), 'curtain');
  assert.equal(materialKindOf(wall({ blocks: 'light' })), null);
});

test('a painted wall keeps its own; else its kind default; a secret door with none wears the walls; none set is none', () => {
  const defaults = { wall: 'mats/stone', door: 'mats/oak' };
  assert.equal(materialWith('mats/brick', wall(), defaults), 'mats/brick');
  assert.equal(materialWith(null, wall(), defaults), 'mats/stone');
  assert.equal(materialWith(null, wall({ type: 'door' }), defaults), 'mats/oak');
  assert.equal(materialWith(null, wall({ type: 'secret-door' }), defaults), 'mats/stone');
  assert.equal(materialWith(null, wall({ type: 'secret-door' }), { ...defaults, secretDoor: 'mats/plaster' }), 'mats/plaster');
  assert.equal(materialWith(null, wall({ limited: true }), defaults), null);
  assert.equal(materialWith(null, wall({ blocks: 'light' }), { wall: 'x' }), null);
  assert.equal(materialWith(null, wall(), {}), null);
  assert.equal(materialWith(null, wall(), null), null);
});

test('defaults saved are read back, those well formed; those a map uses are listed once', () => {
  assert.deepEqual(readMaterialDefaults({ wall: 'a', door: '', window: 3, junk: 'x' }), { wall: 'a' });
  assert.deepEqual(readMaterialDefaults(null), {});
  const walls = [wall({ id: 'a' }), wall({ id: 'b' }), wall({ id: 'c', type: 'door' }), wall({ id: 'd' })];
  const painted = ['mats/brick', null, null, null];
  assert.deepEqual(defaultsUsed(walls, (index) => painted[index]!, { wall: 'mats/stone', door: 'mats/oak' }).sort(), ['mats/oak', 'mats/stone']);
  assert.deepEqual(defaultsUsed(walls, () => null, {}), []);
});
