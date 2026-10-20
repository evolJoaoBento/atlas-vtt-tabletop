import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyInitiative, collectionInitiativeRules, fightSides, fileCannotRun, initiativeEdit, listedBySides, modifierText, parseInitiativeRules,
  readInitiative, rollInitiativeDice, sideLabel, sideOf, sortedEntries, statblockModifier,
  type InitiativeEntry, type InitiativeRules, type InitiativeState,
} from '../src/board/initiative';

const entry = (id: string, order: number, fields: Partial<InitiativeEntry> = {}): InitiativeEntry => ({
  id, tokenId: `t-${id}`, name: id, initiative: 0, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order, ...fields,
});
const fight = (fields: Partial<InitiativeState> = {}): InitiativeState => ({
  entries: [entry('a', 0), entry('b', 1), entry('c', 2)], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true }, ...fields,
});
const DEFAULT: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
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

test('Atlas 0.9: turns pass defeated and delayed combatants by; a new round clears and keeps sitting out', () => {
  // A start clears delays (as Atlas's does): the first combatant that acts, past the defeated, takes the turn.
  const started = applyInitiative(fight({ entries: [entry('a', 0), entry('b', 1, { delayed: true }), entry('c', 2), entry('d', 3)] }), { type: 'start', rules: DEFAULT, defeated: ['a'] });
  assert.equal(active(started), 'b');
  // Mid-fight, b delays: its turns pass it by.
  let state = fight({ isActive: true, round: 1, currentIndex: 2, entries: [entry('a', 0), entry('b', 1, { delayed: true }), entry('c', 2, { isActive: true }), entry('d', 3)] });
  state = applyInitiative(state, { type: 'sitsOut', id: 'c', sitsOut: true });
  state = applyInitiative(state, { type: 'next', defeated: ['a'] });
  assert.equal(active(state), 'd');
  state = applyInitiative(state, { type: 'next', defeated: ['a'] });
  // Round 2: c no longer sits out; a and b are passed by.
  assert.deepEqual([active(state), state.round, state.entries.find((e) => e.id === 'c')!.sitsOut], ['c', 2, undefined]);
  assert.deepEqual(state.satOut, { 2: ['c'] });
  state = applyInitiative(state, { type: 'previous', defeated: ['a'] });
  assert.deepEqual([active(state), state.round, state.entries.find((e) => e.id === 'c')!.sitsOut, state.satOut], ['d', 1, true, undefined]);
});

test('Atlas 0.9: a roll or an edit fills the empty slot and ends the tie-break; the roll keeps its modifier for ties', () => {
  const state = fight({ entries: [entry('a', 0, { awaitingInitiative: true, tieBreak: 5 }), entry('b', 1, { awaitingInitiative: true, initiativeModifier: 3 })] });
  const rolled = applyInitiative(state, { type: 'roll', roll: '1d20', statblockModifiers: { a: 3 } }, () => 0.5);
  assert.deepEqual(rolled.entries.map((e) => [e.id, e.initiative, e.rolledModifier, 'awaitingInitiative' in e, 'tieBreak' in e]), [['a', 14, 3, false, false], ['b', 14, 3, false, false]]);
  const edited = applyInitiative(state, { type: 'edit', id: 'b', changes: { initiative: 7 } });
  assert.equal('awaitingInitiative' in edited.entries.find((e) => e.id === 'b')!, false);
});

test('Atlas 0.9: a fight leaves no cards, delays or round marks behind for the next one', () => {
  const state = fight({ isActive: true, round: 3, cards: { deck: 10 }, satOut: { 2: ['a'] }, entries: [entry('a', 0, { card: 4, delayed: true, isActive: true })] });
  for (const type of ['end', 'reset'] as const) {
    const after = applyInitiative(state, { type });
    assert.equal(after.cards, undefined);
    assert.equal(after.satOut, undefined);
  }
  const started = applyInitiative(applyInitiative(state, { type: 'end' }), { type: 'start', rules: DEFAULT });
  assert.deepEqual(['card' in started.entries[0]!, 'delayed' in started.entries[0]!, active(started)], [false, false, 'a']);
});

test('Atlas 0.9: fights only Atlas runs are refused in the file; its rules are kept whole for Atlas', () => {
  const cards = collectionInitiativeRules({ initiative: { mode: 'cards', roll: '1d20', firstSide: 'players', deck: 12, dealEachRound: true } });
  assert.deepEqual(cards, { mode: 'cards', roll: '1d20', firstSide: 'players', deck: 12, dealEachRound: true });
  assert.ok(fileCannotRun(fight(), { type: 'start', rules: cards }));
  const ose = collectionInitiativeRules({ systemPresetId: 'builtin:ose' });
  assert.equal(ose.sideRoll, '1d6');
  assert.ok(fileCannotRun(fight(), { type: 'start', rules: ose }));
  assert.ok(fileCannotRun(fight({ isActive: true, sides: { first: 'players', active: 'goblins', order: [{ id: 'players' }, { id: 'goblins', name: 'Goblins' }] } }), { type: 'next' }));
  assert.equal(fileCannotRun(fight(), { type: 'start', rules: { mode: 'sides', roll: '1d20', firstSide: 'players' } }), null);
  // A named side's turn is read, not dropped.
  assert.equal(readInitiative({ entries: [], isActive: true, sides: { first: 'players', active: 'goblins' } }).sides?.active, 'goblins');
  assert.deepEqual(fightSides({ sides: { first: 'players', active: 'goblins', order: [{ id: 'goblins', name: 'Goblins' }, { id: 'players' }] } }, DEFAULT), ['goblins', 'players']);
  assert.equal(sideLabel('goblins', [{ id: 'goblins', name: 'Goblins' }]), 'Goblins');
});

test('Atlas 0.9: removing the combatant with the turn passes it on, past the defeated', () => {
  let state = applyInitiative(fight(), { type: 'start', rules: DEFAULT });
  state = applyInitiative(state, { type: 'remove', id: 'a', defeated: ['b'] });
  assert.equal(active(state), 'c');
});

test('Atlas 0.9: a Fantasy Statblocks creature\'s own modifier counts before the fallback', () => {
  assert.equal(statblockModifier({ modifier: 2, stats: [10, 18] }, collectionInitiativeRules({ systemPresetId: 'builtin:dnd5e' })), 2);
});
