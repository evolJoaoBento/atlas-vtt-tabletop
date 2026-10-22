import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advantageApplies, countOf, emptyPick, pickedRequest, pickFormula, stepDie, stepModifier } from '../src/dice/dicePicker';
import { DIE_TYPES } from '../src/dice/kit/faces';
import { DEFAULT_RULES, MAX_DICE } from '../src/dice/rollRules';

test('counts add and cap at 20 in total', () => {
  let pick = emptyPick();
  pick = stepDie(pick, 'd6', 1);
  pick = stepDie(pick, 'd6', 1);
  pick = stepDie(pick, 'd20', 1);
  assert.deepEqual({ d6: countOf(pick, 'd6'), d20: countOf(pick, 'd20') }, { d6: 2, d20: 1 });
  for (let i = 0; i < 30; i++) pick = stepDie(pick, 'd8', 1);
  assert.equal(DIE_TYPES.reduce((sum, die) => sum + countOf(pick, die), 0), MAX_DICE);
  assert.equal(countOf(pick, 'd8'), MAX_DICE - 3);
  // Taking one off frees a place; a count never goes below none.
  pick = stepDie(pick, 'd6', -1);
  pick = stepDie(pick, 'd6', -1);
  pick = stepDie(pick, 'd6', -1);
  assert.equal(pick.dice.d6, undefined);
  pick = stepDie(pick, 'd100', 1);
  assert.equal(countOf(pick, 'd100'), 1);
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
  assert.equal(countOf(pick, 'd6'), 20);
});

test('the same die in several colours: counted by colour, each taken back on its own, each die thrown in its own', () => {
  let pick = stepDie(emptyPick(), 'd6', 1, '#d64545');
  pick = stepDie(pick, 'd6', 1, '#3b82f6');
  pick = stepDie(pick, 'd6', 1, '#d64545');
  pick = stepDie(pick, 'd6', 1);
  assert.equal(countOf(pick, 'd6'), 4);
  assert.equal(countOf(pick, 'd6', '#d64545'), 2);
  assert.equal(countOf(pick, 'd6', '#3b82f6'), 1);
  assert.equal(countOf(pick, 'd6', null), 1, "one in the pack's colour");
  assert.deepEqual(pickedRequest(stepModifier(pick, -1), DEFAULT_RULES), { dice: { d6: 4 }, modifier: -1, dieColors: { d6: ['#d64545', '#3b82f6', '#d64545', null] } });
  pick = stepDie(pick, 'd6', -1, '#d64545');
  assert.deepEqual(pick.dice.d6, ['#d64545', '#3b82f6', null], 'the last red one goes');
  assert.equal(stepDie(pick, 'd6', -1, '#00ff00'), pick, 'none in that colour: nothing changes');
  assert.equal(pickedRequest(stepDie(emptyPick(), 'd8', 1), DEFAULT_RULES)?.dieColors, undefined, "all in the pack's colour: no colours sent");
});
