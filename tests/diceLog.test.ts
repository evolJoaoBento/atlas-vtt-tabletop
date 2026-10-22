import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOG_LIMIT, logEntryOf, withEntry, type LogEntry } from '../src/board/diceLog';

const roll = (extra: object = {}) => ({
  id: 'r1',
  timestamp: 1700000000000,
  formula: '2d6+3',
  rolls: [
    { die: 'd6', value: 4, max: 6, min: 1, colour: '#ff0000', name: 'Red' },
    { die: 'd6', value: 2, max: 6, min: 1, dropped: true },
  ],
  modifiers: 3,
  total: 7,
  player: 'Tabletop for Atlas VTT',
  source: { type: 'toolbar' },
  ...extra,
});

test('logEntryOf reads a toolbar roll: the GM, no label, the dice with their colour and set-aside flag', () => {
  assert.deepEqual(logEntryOf(roll()), {
    id: 'r1',
    who: 'GM',
    formula: '2d6+3',
    dice: [{ die: 'd6', value: 4, colour: '#ff0000' }, { die: 'd6', value: 2, dropped: true }],
    total: 7,
    time: 1700000000000,
  });
});

test('logEntryOf reads who rolled and the statblock ability as the label', () => {
  const entry = logEntryOf(roll({ rolledBy: 'Anna', source: { type: 'statblock', abilityName: 'Longsword', tokenId: 't1' } }));
  assert.equal(entry?.who, 'Anna');
  assert.equal(entry?.label, 'Longsword');
});

test('logEntryOf reads a critical as Atlas logs it, and tolerates success and failure', () => {
  assert.equal(logEntryOf(roll({ crit: 'high' }))?.crit, 'success');
  assert.equal(logEntryOf(roll({ crit: 'low' }))?.crit, 'failure');
  assert.equal(logEntryOf(roll({ crit: 'success' }))?.crit, 'success');
  assert.equal(logEntryOf(roll({ crit: 'failure' }))?.crit, 'failure');
  assert.equal(logEntryOf(roll({ crit: 'maybe' }))?.crit, undefined);
  assert.equal(logEntryOf(roll())?.crit, undefined);
});

test('logEntryOf gives a roll without an id or a time one of its own, and a blank roller the GM', () => {
  const entry = logEntryOf(roll({ id: undefined, timestamp: undefined, rolledBy: '  ' }));
  assert.ok(entry && entry.id !== '' && Number.isFinite(entry.time));
  assert.equal(entry.who, 'GM');
});

test('logEntryOf returns null for garbage', () => {
  for (const bad of [null, undefined, 5, 'roll', [], {}, roll({ total: 'x' }), roll({ total: NaN }), roll({ formula: 3 }), roll({ rolls: [] }), roll({ rolls: 'd6' }), roll({ rolls: [{ die: 'd6' }] }), roll({ rolls: [null] }), roll({ rolls: [{ die: 6, value: 1 }] })]) {
    assert.equal(logEntryOf(bad), null, JSON.stringify(bad));
  }
});

test('withEntry puts the newest first and keeps the 50 newest', () => {
  let list: readonly LogEntry[] = [];
  for (let i = 0; i < LOG_LIMIT + 5; i++) list = withEntry(list, { id: `r${i}`, who: 'GM', formula: 'd20', dice: [], total: i, time: i });
  assert.equal(list.length, 50);
  assert.equal(list[0].id, `r${LOG_LIMIT + 4}`);
  assert.equal(list[49].id, 'r5');
});

test('withEntry ignores a roll it already has', () => {
  const entry: LogEntry = { id: 'r1', who: 'GM', formula: 'd20', dice: [], total: 1, time: 1 };
  const list = withEntry([], entry);
  assert.equal(withEntry(list, entry), list);
});
