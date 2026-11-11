import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { TokenWriter, lootRollerInText } from '../src/board/tokenWriter';
import { createBoardStore } from '../src/loot/boardStore';

const MAP = readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8');

test('lootRollerInText changes only the random tables block', () => {
  const text = lootRollerInText(MAP, { count: 4, excludedRarities: ['rare'] });
  const before = JSON.parse(MAP);
  const after = JSON.parse(text);
  assert.equal(after.state.lootRoller.count, 4);
  assert.deepEqual(after.state.lootRoller.excludedRarities, ['rare']);
  delete after.state.lootRoller;
  assert.deepEqual(after, before);
});

test('lootRollerInText keeps what the GM chose before', () => {
  const once = lootRollerInText(MAP, { count: 4 });
  const twice = lootRollerInText(once, { pane: 'history' });
  const block = JSON.parse(twice).state.lootRoller;
  assert.equal(block.count, 4);
  assert.equal(block.pane, 'history');
});

test("TokenWriter.lootRoller goes through Atlas's store when Atlas holds the map", async () => {
  const calls: unknown[] = [];
  const view = {
    viewId: 'v', atlasStore: { getState: () => ({ mapPath: 'a.atlasmap', updateLootRoller: (s: unknown) => calls.push(s) }), subscribe: () => () => {} },
  } as unknown as AtlasView;
  const writes: string[] = [];
  const writer = new TokenWriter({ views: () => [view], process: async (path) => { writes.push(path); } });
  assert.equal(await writer.lootRoller('a.atlasmap', { count: 2 }), 'atlas');
  assert.deepEqual(calls, [{ count: 2 }]);
  assert.deepEqual(writes, []);
});

test('TokenWriter.lootRoller writes the file without Atlas', async () => {
  let text = MAP;
  const writer = new TokenWriter({ views: () => [], process: async (_path, edit) => { text = edit(text); } });
  assert.equal(await writer.lootRoller('a.atlasmap', { selected: 'Notes/T.md#0' }), 'file');
  assert.equal(JSON.parse(text).state.lootRoller.selected, 'Notes/T.md#0');
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
