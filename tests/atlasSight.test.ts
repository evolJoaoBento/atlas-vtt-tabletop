import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardSightOf } from '../src/board/atlasSight';

const ready = (shown: number[], cols: number, tokens: Record<string, 'seen' | 'sensed' | 'unseen'>) => ({
  status: 'ready' as const, tokens, showsExplored: false,
  darkness: { cellSize: 10, cols, rows: shown.length / cols, shown: Uint8Array.from(shown) },
});

test("Atlas's answer for players: only a token Atlas shows them is seen (not one it only senses)", () => {
  const sight = boardSightOf(ready([1, 0, 0, 1], 2, { a: 'seen', b: 'sensed', c: 'unseen' }));
  assert.equal(sight.kind, 'ready');
  if (sight.kind !== 'ready') return;
  assert.deepEqual([...sight.seen], ['a']);
});

test('a place is seen where its cell of the raster is shown, and nowhere off the raster', () => {
  const sight = boardSightOf(ready([1, 0, 0, 1], 2, {}));
  if (sight.kind !== 'ready') throw new Error('not ready');
  assert.equal(sight.seenAt(5, 5), true);
  assert.equal(sight.seenAt(15, 5), false);
  assert.equal(sight.seenAt(5, 15), false);
  assert.equal(sight.seenAt(15, 15), true);
  assert.equal(sight.seenAt(-1, 5), false);
  assert.equal(sight.seenAt(25, 5), false);
  assert.equal(sight.seenAt(5, 20), false);
  assert.equal(sight.seenAt(Number.NaN, 5), false);
});

test('unlit and pending pass through (pending: players are shown nothing)', () => {
  assert.deepEqual(boardSightOf({ status: 'unlit' }), { kind: 'unlit' });
  assert.deepEqual(boardSightOf({ status: 'pending' }), { kind: 'pending' });
});
