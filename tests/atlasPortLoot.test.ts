import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { tablesOfNote } from '../src/atlasPort/app/randomTables/noteTables';
import { rollTable } from '../src/atlasPort/app/randomTables/tableRoller';
import { rollLoot } from '../src/atlasPort/app/loot/lootRoller';
import type { LootItem } from '../src/atlasPort/app/loot/lootItem';
import {
  mergeLootHistories, readDeviceLootHistory, serializeDeviceLootHistory, withRoll, withoutRoll, LOOT_HISTORY_FORMAT,
} from '../src/atlasPort/app/loot/deviceLootHistory';
import { LOOT_HISTORY_LIMIT, type LootRoll } from '../src/atlasPort/app/loot/lootHistory';
import { readLootRollerState } from '../src/atlasPort/app/stores/lootRollerSlice';

/** A random source giving `values` in turn, then the last one forever. */
const sequence = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

const D6 = ['## Weather', '', '| d6 | Weather |', '| --- | --- |', '| 1-2 | Rain |', '| 3-4 | Fog |', '| 5-6 | Sun |'].join('\n');

test("reads a note's d6 table as Atlas does", () => {
  const { tables } = tablesOfNote(D6, 'Tables');
  assert.equal(tables.length, 1);
  assert.equal(tables[0].name, 'Weather');
  assert.equal(tables[0].die?.label, 'd6');
});

test('rolls the row the die lands on', () => {
  const [table] = tablesOfNote(D6, 'Tables').tables;
  // 0 → 1 (Rain), 0.99 → 6 (Sun).
  const draws = rollTable(table, { count: 2, random: sequence(0, 0.99) });
  assert.deepEqual(draws.map((draw) => draw.roll?.total), [1, 6]);
  assert.deepEqual(draws.map((draw) => draw.row?.cells.at(-1)), ['Rain', 'Sun']);
});

test('noRepeats never gives a row twice', () => {
  const [table] = tablesOfNote(D6, 'Tables').tables;
  const draws = rollTable(table, { count: 5, noRepeats: true, random: sequence(0, 0, 0, 0.5, 0.99) });
  const rows = draws.map((draw) => draw.row?.index);
  assert.equal(new Set(rows).size, rows.length);
  assert.ok(rows.length <= 3);
});

const item = (id: string, rarity?: string): LootItem => ({ id, name: id, source: ['Base'], rarity, properties: [] });

test('rollLoot never draws an excluded rarity', () => {
  const items = [item('a', 'Common'), item('b', 'Rare'), item('c', 'Common')];
  const rarities = [{ name: 'Common' }, { name: 'Rare' }] as never;
  const draws = rollLoot(items, { count: 10, rarity: { rarities, excluded: new Set(['rare']) }, random: sequence(0.5) });
  assert.ok(draws.length > 0);
  assert.ok(draws.every((draw) => draw.rarity !== 'Rare'));
});

/** A roll that drew one item (Atlas drops a roll with nothing in it). */
const roll = (id: string, rolledAt: number): LootRoll => ({
  id, rolledAt, mapName: 'Map', draws: [{ id: `${id}-d`, name: 'Sword', source: ['Base'], properties: [], notePath: 'Items/Sword.md' }],
});

test('merges every device, newest first, removed rolls left out', () => {
  const atlas = { rolls: [roll('a1', 10), roll('a2', 30)], removed: [] };
  const board = { rolls: [roll('t1', 20)], removed: ['a1'] };
  assert.deepEqual(mergeLootHistories([atlas, board]).map((entry) => entry.id), ['a2', 't1']);
});

test('history keeps at most Atlas\'s limit', () => {
  let own = { rolls: [] as LootRoll[], removed: [] as string[] };
  for (let i = 0; i < LOOT_HISTORY_LIMIT + 5; i += 1) own = withRoll(own, roll(`r${i}`, i));
  assert.equal(mergeLootHistories([own]).length, LOOT_HISTORY_LIMIT);
});

test("removing another device's roll records it in our own file", () => {
  const atlas = { rolls: [roll('a1', 10)], removed: [] };
  const own = withoutRoll({ rolls: [], removed: [] }, [atlas], 'a1');
  assert.deepEqual(own.removed, ['a1']);
});

test('a malformed history file reads as empty; a good one round-trips', () => {
  assert.deepEqual(readDeviceLootHistory('garbage'), { rolls: [], removed: [] });
  const own = { rolls: [roll('r1', 5)], removed: ['x'] };
  const text = serializeDeviceLootHistory(own);
  assert.equal(JSON.parse(text).format, LOOT_HISTORY_FORMAT);
  assert.deepEqual(readDeviceLootHistory(JSON.parse(text)), own);
});

test("reads the random tables block of Atlas's map file", () => {
  const map = JSON.parse(readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8'));
  map.state.lootRoller = { open: true, disabledViews: ['Base/Items'], excludedRarities: ['Rare'], count: 3, pane: 'tables' };
  const state = readLootRollerState(map.state.lootRoller);
  assert.equal(state.open, true);
  assert.deepEqual(state.disabledViews, ['Base/Items']);
  assert.deepEqual(state.excludedRarities, ['rare']);
  assert.equal(state.count, 3);
});
