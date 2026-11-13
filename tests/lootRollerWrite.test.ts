import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { createBoardStore } from '../src/loot/boardStore';

const MAP = readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8');

test("TokenWriter.lootRoller goes through Atlas's store when Atlas holds the map", async () => {
  const calls: unknown[] = [];
  const view = {
    viewId: 'v', atlasStore: { getState: () => ({ mapPath: 'a.atlasmap', updateLootRoller: (s: unknown) => calls.push(s) }), subscribe: () => () => {} },
  } as unknown as AtlasView;
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await writer.lootRoller('a.atlasmap', { count: 2 });
  assert.deepEqual(calls, [{ count: 2 }]);
});

test('TokenWriter.lootRoller saves nothing on a map Atlas does not come to hold: no file is written', async () => {
  const writer = new TokenWriter({ views: () => [], held: async () => null });
  await assert.rejects(writer.lootRoller('a.atlasmap', { selected: 'Notes/T.md#0' }), NotHeldError);
});

test("the board's store runs Atlas's loot roller actions and reports changes", () => {
  const changes: unknown[] = [];
  const store = createBoardStore((before, after) => changes.push([before.count, after.count]));
  let told = 0;
  store.subscribe(() => { told += 1; });
  store.getState().updateLootRoller({ count: 99 });
  // Atlas clamps the count (at most 10).
  assert.equal(store.getState().lootRoller.count, 10);
  assert.equal(told, 1);
  assert.deepEqual(changes, [[1, 10]]);
  store.getState().setLootRollerOpen(true);
  assert.equal(store.getState().lootRoller.open, true);
});
