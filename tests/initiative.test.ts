import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyInitiative, collectionInitiativeRules, initiativeEdit, listedBySides, modifierText, parseInitiativeRules, readInitiative,
  rollInitiativeDice, sideOf, sortedEntries, statblockModifier, type InitiativeEntry, type InitiativeState,
} from '../src/board/initiative';

const entry = (id: string, order: number, fields: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id, tokenId: `t-${id}`, name: id, initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order, ...fields,
});
const fight = (fields: Partial<InitiativeState> = {}): InitiativeState => ({
  entries: [entry('a', 0), entry('b', 1), entry('c', 2)], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true }, ...fields,
});
const ids = (state: InitiativeState): string => sortedEntries(state).map((one) => one.id).join('');
const active = (state: InitiativeState): string | undefined => state.entries.find((one) => one.isActive)?.id;
/** A die that always lands on `faces[i]` (1-based), in turn. */
const dice = (sides: number, ...faces: number[]): (() => number) => { let i = 0; return () => (faces[i++ % faces.length]! - 1) / sides; };

test('the tracker is read as Atlas defaults it, keeping fields Tabletop does not know', () => {
  const state = readInitiative({ entries: [{ id: 'x', tokenId: 't', extra: 1 }, { id: 'bad' }], round: 2, isActive: true, config: {}, sides: { first: 'players', active: 'opponents' }, other: 'kept' });
  assert.equal(state.entries.length, 1);
  assert.deepEqual({ ...state.entries[0] }, { id: 'x', tokenId: 't', extra: 1, name: 'Token', initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order: 0 });
  assert.equal(state.round, 2);
  assert.equal(state.config.autoSort, true);
  assert.deepEqual(state.sides, { first: 'players', active: 'opponents' });
  assert.equal(state.other, 'kept');
  assert.deepEqual(readInitiative(undefined), { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } });
});

test('a fight starts on the first combatant in round 1; turns wrap into the next round and back', () => {
  let state = applyInitiative(fight(), { type: 'start', rules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' } });
  assert.equal(state.isActive, true);
  assert.equal(state.round, 1);
  assert.equal(active(state), 'a');
  state = applyInitiative(state, { type: 'next' });
  state = applyInitiative(state, { type: 'next' });
  assert.equal(active(state), 'c');
  state = applyInitiative(state, { type: 'next' });
  assert.equal(active(state), 'a');
  assert.equal(state.round, 2);
  state = applyInitiative(state, { type: 'previous' });
  assert.equal(active(state), 'c');
  assert.equal(state.round, 1);
  // Round 1 never goes below 1.
  state = applyInitiative(applyInitiative(applyInitiative(state, { type: 'previous' }), { type: 'previous' }), { type: 'previous' });
  assert.equal(active(state), 'c');
  assert.equal(state.round, 1);
  state = applyInitiative(state, { type: 'end' });
  assert.deepEqual([state.isActive, state.round, state.currentIndex, active(state)], [false, 0, -1, undefined]);
});

test('by sides the turn belongs to a side; the second side ends the round and the round clears who sat out', () => {
  let state = applyInitiative(fight({ entries: [entry('a', 0, { sitsOut: true })] }), { type: 'start', rules: { mode: 'sides', roll: '1d20', firstSide: 'opponents' } });
  assert.deepEqual(state.sides, { first: 'opponents', active: 'opponents' });
  assert.equal(state.currentIndex, -1);
  assert.equal(active(state), undefined);
  assert.equal(state.entries[0]!.sitsOut, undefined, 'a new fight clears sitting out');
  state = applyInitiative(state, { type: 'sitsOut', id: 'a', sitsOut: true });
  state = applyInitiative(state, { type: 'next' });
  assert.deepEqual([state.sides!.active, state.round, state.entries[0]!.sitsOut], ['players', 1, true]);
  state = applyInitiative(state, { type: 'next' });
  assert.deepEqual([state.sides!.active, state.round, state.entries[0]!.sitsOut], ['opponents', 2, undefined]);
  state = applyInitiative(state, { type: 'previous' });
  assert.deepEqual([state.sides!.active, state.round], ['players', 1]);
  assert.equal(listedBySides(state, { mode: 'turn-order', roll: '1d20', firstSide: 'players' }), true, 'a running fight keeps its mode');
  assert.equal(listedBySides(applyInitiative(state, { type: 'end' }), { mode: 'turn-order', roll: '1d20', firstSide: 'players' }), false);
});

test('rolling everyone adds each one\'s own modifier, else its statblock\'s, and sorts highest first', () => {
  const state = fight({ entries: [entry('a', 0, { initiativeModifier: 2 }), entry('b', 1, { initiativeModifier: 0, modifierByHand: true }), entry('c', 2)] });
  const rolled = applyInitiative(state, { type: 'roll', roll: '1d20', statblockModifiers: { a: 10, b: 10, c: 5 } }, dice(20, 3, 10, 4));
  assert.deepEqual(rolled.entries.map((one) => [one.id, one.initiative, one.order]), [['b', 10, 0], ['c', 9, 1], ['a', 5, 2]]);
  // One combatant rolls alone and keeps its place.
  const one = applyInitiative(rolled, { type: 'roll', entryId: 'a', roll: '2d6', statblockModifiers: {} }, dice(6, 6, 6));
  assert.equal(one.entries.find((e) => e.id === 'a')!.initiative, 14);
  assert.equal(ids(one), 'bca');
  assert.equal(rollInitiativeDice('bad', dice(20, 7)), 7, 'a d20 where the roll is none');
});

test('reordering, front and back renumber the order and follow the turn', () => {
  let state = applyInitiative(fight(), { type: 'start', rules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' } });
  state = applyInitiative(state, { type: 'reorder', from: 0, to: 2 });
  assert.equal(ids(state), 'bca');
  assert.equal(state.currentIndex, 2);
  state = applyInitiative(state, { type: 'front', id: 'c' });
  assert.equal(ids(state), 'cba');
  state = applyInitiative(state, { type: 'back', id: 'c' });
  assert.equal(ids(state), 'bac');
  // As in Atlas, only moving the combatant whose turn it is moves the turn's index.
  assert.equal(state.currentIndex, 2);
});

test('removing the combatant whose turn it is passes the turn on; Clear empties the tracker and ends the fight', () => {
  let state = applyInitiative(fight(), { type: 'start', rules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' } });
  state = applyInitiative(state, { type: 'remove', id: 'a' });
  assert.equal(ids(state), 'bc');
  assert.equal(active(state), 'b');
  state = applyInitiative(state, { type: 'reset' });
  assert.deepEqual([state.entries.length, state.isActive, state.round, state.currentIndex], [0, false, 0, -1]);
});

test('the edit popup sets the total (re-sorting) and the GM\'s modifier, which an emptied field clears', () => {
  assert.deepEqual(initiativeEdit('15', '3'), { initiative: 15, initiativeModifier: 3, modifierByHand: true });
  assert.deepEqual(initiativeEdit('x', ''), { initiativeModifier: 0, modifierByHand: undefined });
  assert.deepEqual(initiativeEdit('−2', '0'), { initiative: -2, initiativeModifier: 0, modifierByHand: true });
  assert.equal(modifierText({ initiativeModifier: 0 }), '');
  assert.equal(modifierText({ initiativeModifier: 0, modifierByHand: true }), '0');
  const state = applyInitiative(fight({ entries: [entry('a', 0, { initiative: 5 }), entry('b', 1, { initiative: 3, modifierByHand: true })] }), { type: 'edit', id: 'b', changes: { initiative: 9, initiativeModifier: 0, modifierByHand: undefined } });
  assert.equal(ids(state), 'ba');
  assert.equal('modifierByHand' in state.entries[0]!, false);
});

test('a collection\'s rules: its own, else its game system\'s, else a d20 in turn order', () => {
  assert.deepEqual(collectionInitiativeRules(null), { mode: 'turn-order', roll: '1d20', firstSide: 'players' });
  assert.equal(collectionInitiativeRules({ systemPresetId: 'builtin:cairn' }).mode, 'sides');
  assert.equal(collectionInitiativeRules({ systemPresetId: 'builtin:cyberpunkred' }).roll, '1d10');
  assert.deepEqual(collectionInitiativeRules({ systemPresetId: 'builtin:cairn', initiative: { mode: 'turn-order', roll: ' 2d6 ', firstSide: 'players' } }), { mode: 'turn-order', roll: '2d6', firstSide: 'players' });
  assert.equal(parseInitiativeRules({ mode: 'sides', roll: 'oops', firstSide: 'players' }), undefined);
});

test('a statblock\'s modifier: the rules\' field, else the fallback read as an ability score', () => {
  const dnd = collectionInitiativeRules({ systemPresetId: 'builtin:dnd5e' });
  assert.equal(statblockModifier({ Initiative: '+4' }, dnd), 4);
  assert.equal(statblockModifier({ stats: [10, 16, 12] }, dnd), 3);
  assert.equal(statblockModifier({ name: 'x' }, dnd), null);
});

test('a token fights on the side given it, else the players\' when it sees', () => {
  assert.equal(sideOf({ side: 'opponents', sees: true }), 'opponents');
  assert.equal(sideOf({ side: null, sees: true }), 'players');
  assert.equal(sideOf({ side: null, sees: false }), 'opponents');
  assert.equal(sideOf(undefined), 'opponents');
});
