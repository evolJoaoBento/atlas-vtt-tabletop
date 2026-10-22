import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyPick, pickedRequest, stepDie, stepModifier } from '../src/dice/dicePicker';
import { DEFAULT_RULES, MAX_DICE } from '../src/dice/rollRules';

test('counts add and cap at 20 in total', () => {
  let pick = emptyPick();
  pick = stepDie(pick, 'd6', 1);
  pick = stepDie(pick, 'd6', 1);
  pick = stepDie(pick, 'd20', 1);
  assert.deepEqual(pick.counts, { d6: 2, d20: 1 });
  for (let i = 0; i < 30; i++) pick = stepDie(pick, 'd8', 1);
  assert.equal(Object.values(pick.counts).reduce((sum, count) => sum + (count ?? 0), 0), MAX_DICE);
  assert.equal(pick.counts.d8, MAX_DICE - 3);
  // Taking one off frees a place; a count never goes below none.
  pick = stepDie(pick, 'd6', -1);
  pick = stepDie(pick, 'd6', -1);
  pick = stepDie(pick, 'd6', -1);
  assert.equal(pick.counts.d6, undefined);
  pick = stepDie(pick, 'd100', 1);
  assert.equal(pick.counts.d100, 1);
});

test('modifier steps by 1 within −99..99', () => {
  let pick = emptyPick();
  pick = stepModifier(pick, 1);
  pick = stepModifier(pick, 1);
  assert.equal(pick.modifier, 2);
  for (let i = 0; i < 200; i++) pick = stepModifier(pick, -1);
  assert.equal(pick.modifier, -99);
  for (let i = 0; i < 300; i++) pick = stepModifier(pick, 1);
  assert.equal(pick.modifier, 99);
});

test('Roll with nothing picked rolls the default die', () => {
  assert.deepEqual(pickedRequest(stepModifier(emptyPick(), 3), DEFAULT_RULES), { dice: { d20: 1 }, modifier: 3 });
  assert.deepEqual(pickedRequest(emptyPick(), { defaultRoll: '2d6', crit: 'none' }).dice, { d6: 1 });
  // A default roll Tabletop has no die for still throws a die.
  assert.deepEqual(pickedRequest(emptyPick(), { defaultRoll: 'nonsense', crit: 'none' }).dice, { d20: 1 });
});

test('the request carries the picked dice, the modifier and each die\'s colour', () => {
  let pick = stepDie(stepDie(emptyPick(), 'd6', 1), 'd6', 1);
  pick = { ...pick, colors: { d6: '#d64545' } };
  assert.deepEqual(pickedRequest(stepModifier(pick, -1), DEFAULT_RULES), { dice: { d6: 2 }, modifier: -1, colors: { d6: '#d64545' } });
});
