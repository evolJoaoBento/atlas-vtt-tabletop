import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advantageApplies, emptyPick, pickedRequest, pickFormula, stepDie, stepModifier } from '../src/dice/dicePicker';
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

test("modifier steps by 1 within −20..20, as in Atlas's tray", () => {
  let pick = emptyPick();
  pick = stepModifier(pick, 1);
  pick = stepModifier(pick, 1);
  assert.equal(pick.modifier, 2);
  for (let i = 0; i < 200; i++) pick = stepModifier(pick, -1);
  assert.equal(pick.modifier, -20);
  for (let i = 0; i < 300; i++) pick = stepModifier(pick, 1);
  assert.equal(pick.modifier, 20);
});

test("with no dice picked there is nothing to roll, as in Atlas's tray", () => {
  assert.equal(pickedRequest(stepModifier(emptyPick(), 3), DEFAULT_RULES), null);
  assert.equal(pickFormula(stepModifier(emptyPick(), 3)), '');
});

test("the formula reads as Atlas's tray writes it", () => {
  let pick = stepDie(stepDie(stepDie(emptyPick(), 'd20', 1), 'd6', 1), 'd6', 1);
  assert.equal(pickFormula(pick), '2d6 + 1d20');
  pick = stepModifier(stepModifier(stepModifier(pick, -1), -1), -1);
  assert.equal(pickFormula(pick), '2d6 + 1d20 - 3');
});

test('advantage applies to one of the default die only, and goes with the request then', () => {
  const one = { ...stepDie(emptyPick(), 'd20', 1), advantage: 'advantage' as const };
  assert.equal(advantageApplies(one, DEFAULT_RULES), true);
  assert.equal(pickedRequest(one, DEFAULT_RULES)?.advantage, 'advantage');
  const two = stepDie(one, 'd20', 1);
  assert.equal(advantageApplies(two, DEFAULT_RULES), false);
  assert.equal(pickedRequest(two, DEFAULT_RULES)?.advantage, undefined, 'two d20s: no advantage');
  assert.equal(advantageApplies(one, { defaultRoll: '2d6', crit: 'none' }), false, "not the collection's default die");
});

test('at most 20 of one die', () => {
  let pick = emptyPick();
  for (let i = 0; i < 25; i++) pick = stepDie(pick, 'd6', 1);
  assert.equal(pick.counts.d6, 20);
});

test("the request carries the picked dice, the modifier and each die\'s colour", () => {
  let pick = stepDie(stepDie(emptyPick(), 'd6', 1), 'd6', 1);
  pick = { ...pick, colors: { d6: '#d64545' } };
  assert.deepEqual(pickedRequest(stepModifier(pick, -1), DEFAULT_RULES), { dice: { d6: 2 }, modifier: -1, colors: { d6: '#d64545' } });
});
