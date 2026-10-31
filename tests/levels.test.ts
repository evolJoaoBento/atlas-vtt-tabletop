import test from 'node:test';
import assert from 'node:assert/strict';
import { instanceBadgeNumbers, levelBackground, onLevel, readLevels, resolveLevel } from '../src/board/levels';
import { readMap } from '../src/board/mapModel';

const levels = readLevels([{ id: 'a', name: 'Cellar', background: null }, { id: 'b', background: 'up.png' }]);

test('a scene needs two levels to have any', () => {
  assert.equal(readLevels(undefined).length, 0);
  assert.equal(readLevels([{ id: 'a' }]).length, 0);
  assert.deepEqual(levels.map((level) => level.id), ['a', 'b']);
});

test('objects stand on the first level unless they say otherwise, as Atlas places them', () => {
  assert.equal(onLevel({}, 'a', levels), true);
  assert.equal(onLevel({}, 'b', levels), false);
  assert.equal(onLevel({ level: 'b' }, 'b', levels), true);
  assert.equal(onLevel({ level: 'gone' }, 'a', levels), true);
  assert.equal(onLevel({ levels: 'all' }, 'b', levels), true);
  assert.equal(onLevel({ levels: ['b'] }, 'a', levels), false);
  assert.equal(onLevel({}, null, []), true);
});

test('the shown level is the one asked for, else the first', () => {
  assert.equal(resolveLevel(levels, 'b'), 'b');
  assert.equal(resolveLevel(levels, 'zzz'), 'a');
  assert.equal(resolveLevel([], 'b'), null);
  assert.equal(levelBackground('ground.png', levels, 'a'), 'ground.png');
  assert.equal(levelBackground('ground.png', levels, 'b'), 'up.png');
});

const file = JSON.stringify({ state: {
  background: 'ground.png',
  levels: [{ id: 'a' }, { id: 'b', background: 'up.png' }],
  objects: {
    tokens: { t1: { id: 't1', x: 1, y: 1 }, t2: { id: 't2', x: 2, y: 2, level: 'b' } },
    walls: { w1: { id: 'w1', p1: { x: 0, y: 0 }, p2: { x: 5, y: 0 } }, w2: { id: 'w2', levels: ['b'], p1: { x: 0, y: 1 }, p2: { x: 5, y: 1 } } },
    pins: { p: { id: 'p', x: 1, y: 1, level: 'b' } },
  },
} });

test('a map shows one level: its image, walls and pins, with the other level\'s tokens kept aside', () => {
  const first = readMap('m', file);
  assert.equal(first.level, 'a');
  assert.equal(first.background, 'ground.png');
  assert.deepEqual(first.tokens.map((token) => [token.id, token.offLevel]), [['t1', false], ['t2', true]]);
  assert.equal(first.walls.length, 1);
  assert.equal(first.pins.length, 0);
  const upstairs = readMap('m', file, 'b');
  assert.equal(upstairs.background, 'up.png');
  assert.deepEqual(upstairs.tokens.map((token) => [token.id, token.offLevel]), [['t1', true], ['t2', false]]);
  assert.equal(upstairs.walls.length, 1);
  assert.equal(upstairs.pins.length, 1);
});

test('a map of one level reads as it did before levels', () => {
  const map = readMap('m', JSON.stringify({ state: { background: 'x.png', objects: { tokens: { t: { id: 't', x: 0, y: 0 } } } } }));
  assert.equal(map.level, null);
  assert.equal(map.tokens[0].offLevel, false);
  assert.equal(map.background, 'x.png');
});

test('copy numbers are Atlas 0.10\'s: counted per level, hidden copies included', () => {
  const token = (imagePath: string, instanceNumber: number | null, levelId: string | null) => ({ imagePath, instanceNumber, levelId });
  const tokens = new Map([
    ['g1', token('gob', 1, 'a')], ['g2', token('gob', null, 'a')], ['g3', token('gob', 3, 'b')], ['orc', token('orc', 1, 'a')],
  ]);
  const numbers = instanceBadgeNumbers(tokens, true);
  assert.equal(numbers.get('g1'), 1);
  assert.equal(numbers.get('g2'), 1);
  assert.equal(numbers.has('g3'), false);
  assert.equal(numbers.has('orc'), false);
  assert.equal(instanceBadgeNumbers(tokens, false).size, 0);
});
