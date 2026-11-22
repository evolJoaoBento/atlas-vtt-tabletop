import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDiceShelf, MAX_ROW, withRowDie, withRowSlotMoved } from '../src/atlasPort/app/react/components/dice/diceShelf';
import { dragOffsets, dragTarget, pinEntry, placeKey, rowColumns, rowPlaces } from '../src/dice/diceRow';

const presets = [
  { id: 'fire', name: 'Fireball', formula: '+2', look: { dice: [{ count: 2, sides: 6 }], crit: 'none' } },
  { id: 'stats', name: 'Stats', formula: '4d6kh3' },
];

test('without a row of the collection\'s own the tray shows the seven standard dice', () => {
  const places = rowPlaces(null);
  assert.deepEqual(places.map((place) => place.caption), ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  assert.ok(places.every((place) => place.kind === 'die' && place.die !== null && place.problem === null));
  assert.deepEqual(rowPlaces(readDiceShelf({ dicePresets: presets })).map((place) => place.caption), places.map((place) => place.caption));
});

test('the collection\'s row shows its dice and saved rolls in its own order', () => {
  const shelf = readDiceShelf({ dicePresets: presets, diceRow: [{ kind: 'preset', id: 'stats' }, { kind: 'die', sides: 20 }, { kind: 'preset', id: 'gone' }, { kind: 'die', sides: 6 }] });
  const places = rowPlaces(shelf);
  assert.deepEqual(places.map((place) => place.caption), ['Stats', 'd20', 'd6']);
  assert.equal(places[0]!.kind, 'preset');
  assert.equal(places[0]!.preset?.formula, '4d6kh3');
  assert.equal(places[1]!.die, 'd20');
});

test('a die the board has no body for stays in the row and says why it cannot be thrown', () => {
  const places = rowPlaces(readDiceShelf({ diceRow: [{ kind: 'die', sides: 3 }, { kind: 'die', sides: 12 }] }));
  assert.equal(places[0]!.die, null);
  assert.match(places[0]!.problem ?? '', /no d3/);
  assert.equal(places[1]!.die, 'd12');
});

test('a place has the number key Atlas gives it: 1 to 9, then 0', () => {
  assert.deepEqual([0, 1, 8, 9].map(placeKey), ['1', '2', '9', '0']);
});

test('pinning a saved roll puts it at the row\'s end; pinning again takes it out', () => {
  const shelf = readDiceShelf({ dicePresets: presets, diceRow: [{ kind: 'die', sides: 20 }] });
  const pin = pinEntry(shelf, 'fire');
  assert.equal(pin.pinned, false);
  assert.equal(pin.disabled, false);
  assert.deepEqual(pin.change, { diceRow: [{ kind: 'die', sides: 20 }, { kind: 'preset', id: 'fire' }] });
  const pinned = readDiceShelf({ dicePresets: presets, diceRow: pin.change!.diceRow });
  const unpin = pinEntry(pinned, 'fire');
  assert.equal(unpin.pinned, true);
  assert.deepEqual(unpin.change, { diceRow: [{ kind: 'die', sides: 20 }] });
});

test('pinning on the standard row starts the collection\'s own row from the standard dice', () => {
  const shelf = readDiceShelf({ dicePresets: presets });
  const pin = pinEntry(shelf, 'stats');
  assert.equal(pin.change?.diceRow?.length, 8);
  assert.deepEqual(pin.change?.diceRow?.at(-1), { kind: 'preset', id: 'stats' });
});

test('a full row cannot take another saved roll, and says so in Atlas\'s words', () => {
  const row = Array.from({ length: MAX_ROW }, (_, index) => ({ kind: 'die' as const, sides: index + 2 }));
  const shelf = readDiceShelf({ dicePresets: presets, diceRow: row });
  const pin = pinEntry(shelf, 'fire');
  assert.equal(pin.disabled, true);
  assert.equal(pin.change, null);
  assert.equal(pin.description, 'The dice row holds 10; take one out first');
  // A pinned roll can always be taken out.
  const full = readDiceShelf({ dicePresets: presets, diceRow: [...row.slice(0, MAX_ROW - 1), { kind: 'preset', id: 'fire' }] });
  assert.equal(pinEntry(full, 'fire').disabled, false);
});

test('a die typed for the row joins at its end, and the row moves by Atlas\'s own rules', () => {
  const shelf = readDiceShelf({ diceRow: [{ kind: 'die', sides: 6 }, { kind: 'die', sides: 20 }] });
  assert.deepEqual(withRowDie(shelf, 3)?.diceRow, [{ kind: 'die', sides: 6 }, { kind: 'die', sides: 20 }, { kind: 'die', sides: 3 }]);
  assert.deepEqual(withRowSlotMoved(shelf, 1, 0)?.diceRow, [{ kind: 'die', sides: 20 }, { kind: 'die', sides: 6 }]);
});

// Four places in one line, 100 px apart, centres at x = 50, 150, 250, 350.
const centres = [50, 150, 250, 350].map((x) => ({ x, y: 20 }));

test('a held place lands on the place whose centre is nearest where it was let go', () => {
  assert.equal(dragTarget(centres, 0, { x: 190, y: 0 }), 2);
  assert.equal(dragTarget(centres, 3, { x: -290, y: 5 }), 0);
  assert.equal(dragTarget(centres, 1, { x: 10, y: 0 }), 1);
});

test('the places a drag passes slide one step towards where the held one came from', () => {
  // Place 0 dragged to place 2: places 1 and 2 each step back one place; place 3 stays.
  assert.deepEqual(dragOffsets(centres, 0, 2, { x: 200, y: 0 }), ['200px 0px', '-100px 0px', '-100px 0px', '0 0']);
  // Place 3 dragged to place 1: places 1 and 2 each step forward one.
  assert.deepEqual(dragOffsets(centres, 3, 1, { x: -200, y: 0 }), ['0 0', '100px 0px', '100px 0px', '-200px 0px']);
});

test('the row is as many columns wide as it has places, eight at most', () => {
  assert.deepEqual([0, 1, 7, 8, 10].map(rowColumns), [1, 1, 7, 8, 8]);
});
