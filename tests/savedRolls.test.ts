import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDiceShelf, MAX_PRESETS } from '../src/atlasPort/app/react/components/dice/diceShelf';
import { lookOfFormula } from '../src/atlasPort/app/react/components/dice/presetLook';
import { savedRollPlan, savedRollsOffered, saveRoll, savedRollEdited } from '../src/dice/savedRolls';
import { DEFAULT_RULES } from '../src/dice/rollRules';
import { RollSession } from '../src/dice/rollSession';

const empty = readDiceShelf({});

test('saved rolls are offered from Atlas 0.18, which keeps them in its collections', () => {
  assert.equal(savedRollsOffered('0.18.0'), true);
  assert.equal(savedRollsOffered('0.19.2'), true);
  assert.equal(savedRollsOffered('0.17.9'), false);
  assert.equal(savedRollsOffered('0.15.0'), false);
  assert.equal(savedRollsOffered(null), false);
});

test("a roll of plain dice is saved as Atlas saves it: dice to dress, with the bonus beside them", () => {
  const saved = saveRoll(empty, 'Longsword', '1d8[slashing] + 3', DEFAULT_RULES, 'a');
  assert.ok('change' in saved);
  assert.deepEqual(saved.change, {
    dicePresets: [{ id: 'a', name: 'Longsword', formula: '+3', look: { dice: [{ count: 1, sides: 8, name: 'slashing' }], crit: 'natural' } }],
  });
  // What Atlas reads back from its own settings is what was written.
  assert.deepEqual(readDiceShelf(saved.change).presets, saved.change.dicePresets);
});

test('a roll of more than dice and numbers keeps its formula', () => {
  const saved = saveRoll(empty, ' Stats ', '4d6kh3', DEFAULT_RULES, 'b');
  assert.ok('change' in saved);
  assert.deepEqual(saved.change.dicePresets, [{ id: 'b', name: 'Stats', formula: '4d6kh3' }]);
});

test('a saved roll asks for a name and a formula the dice can throw, in Atlas\'s words', () => {
  assert.deepEqual(saveRoll(empty, '  ', '1d8', DEFAULT_RULES), { problem: 'Give the roll a name', field: 'name' });
  assert.deepEqual(saveRoll(empty, 'x', '   ', DEFAULT_RULES), { problem: 'Write the roll to save', field: 'formula' });
  const bad = saveRoll(empty, 'x', '2d7', DEFAULT_RULES);
  assert.ok('problem' in bad && bad.field === 'formula' && /d7/.test(bad.problem));
});

test('a shelf holding as many as it may takes no more', () => {
  let shelf = empty;
  for (let i = 0; i < MAX_PRESETS; i++) {
    const saved = saveRoll(shelf, `Roll ${i}`, '1d6', DEFAULT_RULES, `id${i}`);
    assert.ok('change' in saved);
    shelf = readDiceShelf(saved.change);
  }
  assert.equal(shelf.presets.length, MAX_PRESETS);
  assert.deepEqual(saveRoll(shelf, 'One more', '1d6', DEFAULT_RULES), { full: true });
});

test('a designed roll throws its own dice, in their colours and names, with its bonus', () => {
  const preset = { id: 'a', name: 'Fireball', formula: '+2', look: { dice: [{ count: 2, sides: 6, colour: '#ff0000', name: 'Fire' }, { count: 1, sides: 8 }], crit: 'none' } };
  const plan = savedRollPlan(preset, DEFAULT_RULES);
  assert.ok('request' in plan);
  assert.deepEqual(plan.request.dice, { d6: 2, d8: 1 });
  assert.equal(plan.request.modifier, 2);
  assert.deepEqual(plan.request.dieColors, { d6: ['#ff0000', '#ff0000'], d8: [null] });
  // Its rules are the set's own, not the collection's: no critical, the set's names.
  assert.equal(plan.rules.crit, 'none');
  assert.equal(plan.rules.groups?.[0]?.name, 'Fire');
  const session = new RollSession(plan.request, plan.rules);
  assert.equal(session.pendingThrows().length, 3);
});

test('a designed roll with no bonus throws just its dice', () => {
  const plan = savedRollPlan({ id: 'a', name: 'd20', formula: '', look: { dice: [{ count: 1, sides: 20 }], crit: 'natural' } }, { defaultRoll: '2d6', crit: 'none' });
  assert.ok('request' in plan);
  assert.deepEqual(plan.request.dice, { d20: 1 });
  assert.equal(plan.request.modifier, 0);
  assert.equal(plan.rules.crit, 'natural');
});

test('a roll with a die the board has none of says so, instead of rolling another', () => {
  const plan = savedRollPlan({ id: 'a', name: 'Coin', formula: '', look: { dice: [{ count: 1, sides: 3 }], crit: 'natural' } }, DEFAULT_RULES);
  assert.ok('problem' in plan);
  assert.match(plan.problem, /d3/);
});

test('a roll written as a formula is thrown by the collection\'s rules', () => {
  const rules = { defaultRoll: '1d20', crit: 'roll-under' as const };
  const plan = savedRollPlan({ id: 'a', name: 'Stats', formula: '4d6kh3 + 1' }, rules);
  assert.ok('request' in plan);
  assert.deepEqual(plan.request.dice, { d6: 4 });
  assert.equal(plan.request.keep?.d6?.count, 3);
  assert.equal(plan.request.modifier, 1);
  assert.equal(plan.rules, rules);
  const bad = savedRollPlan({ id: 'b', name: 'Odd', formula: '2d7' }, rules);
  assert.ok('problem' in bad);
});

test('a side of advantage goes with a designed roll only where its set has a rule for it', () => {
  const look = { dice: [{ count: 1, sides: 20 }], crit: 'natural', advantage: { kind: 'keep' } };
  const preset = { id: 'a', name: 'Check', formula: '+5', look };
  const withRule = savedRollPlan(preset, DEFAULT_RULES, 'advantage');
  assert.ok('request' in withRule);
  assert.equal(withRule.request.advantage, 'advantage');
  const without = savedRollPlan(preset, DEFAULT_RULES, 'disadvantage');
  assert.ok('request' in without);
  assert.equal(without.request.advantage, undefined);
});

test('Atlas 0.19: a side a saved roll writes (`+5 adv`) is thrown with it, and the side asked for beside it cancels it', () => {
  const written = savedRollPlan({ id: 'a', name: 'Check', formula: '+5 adv' }, DEFAULT_RULES);
  assert.ok('request' in written);
  assert.equal(written.request.advantage, 'advantage');
  assert.equal(written.request.modifier, 5);
  const look = { dice: [{ count: 1, sides: 20 }], crit: 'natural', advantage: { kind: 'keep' }, disadvantage: { kind: 'keep' } };
  const designed = { id: 'b', name: 'Check', formula: '+5 adv', look };
  const same = savedRollPlan(designed, DEFAULT_RULES, 'advantage');
  assert.ok('request' in same);
  assert.equal(same.request.advantage, 'advantage');
  const opposite = savedRollPlan(designed, DEFAULT_RULES, 'disadvantage');
  assert.ok('request' in opposite);
  assert.equal(opposite.request.advantage, undefined, 'opposite sides cancel');
});

test('a saved roll is renamed, and a formula roll rewritten, in its place', () => {
  const saved = saveRoll(empty, 'Stats', '4d6kh3', DEFAULT_RULES, 'b');
  assert.ok('change' in saved);
  const shelf = readDiceShelf(saved.change);
  const renamed = savedRollEdited(shelf, 'b', 'Ability scores', '4d6dl1', DEFAULT_RULES);
  assert.ok('change' in renamed);
  assert.deepEqual(renamed.change.dicePresets, [{ id: 'b', name: 'Ability scores', formula: '4d6dl1' }]);
  assert.deepEqual(savedRollEdited(shelf, 'b', '', '4d6dl1', DEFAULT_RULES), { problem: 'Give the roll a name', field: 'name' });
  // A designed roll keeps its dice whatever is typed for it; only its name changes.
  const sword = saveRoll(empty, 'Sword', '1d8 + 3', DEFAULT_RULES, 'c');
  assert.ok('change' in sword);
  const designed = readDiceShelf(sword.change);
  const kept = savedRollEdited(designed, 'c', 'Blade', 'ignored', DEFAULT_RULES);
  assert.ok('change' in kept);
  assert.deepEqual(kept.change.dicePresets?.[0], { ...designed.presets[0], name: 'Blade' });
});

test('the look of a roll of dice and numbers', () => {
  assert.deepEqual(lookOfFormula('2d6 + 1d4 - 1')?.bonus, '-1');
  assert.equal(lookOfFormula('4d6kh3'), null);
});
