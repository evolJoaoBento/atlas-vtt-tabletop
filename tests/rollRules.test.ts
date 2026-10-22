import assert from 'node:assert/strict';
import { test } from 'node:test';
import { critOf, DEFAULT_RULES, defaultDie, explosion, parseFormula, total, type DiceRules, type RolledDie } from '../src/dice/rollRules';

const d = (die: RolledDie['die'], value: number, max: number, extra: Partial<RolledDie> = {}): RolledDie => ({ die, value, max, ...extra });

test('parseFormula reads dice groups and a flat modifier', () => {
  assert.deepEqual(parseFormula('2d6+3'), { dice: { d6: 2 }, modifier: 3 });
  assert.deepEqual(parseFormula('1d8 + 2d6 - 1'), { dice: { d8: 1, d6: 2 }, modifier: -1 });
  assert.deepEqual(parseFormula('d20+1d20'), { dice: { d20: 2 }, modifier: 0 });
  assert.deepEqual(parseFormula('1d100'), { dice: { d100: 1 }, modifier: 0 });
});

test('parseFormula rolls the default roll under a bare modifier', () => {
  assert.deepEqual(parseFormula('+3', DEFAULT_RULES), { dice: { d20: 1 }, modifier: 3 });
  assert.deepEqual(parseFormula('-2', { defaultRoll: '2d12', crit: 'doubles' }), { dice: { d12: 2 }, modifier: -2 });
});

test('parseFormula refuses unknown dice, more than 20 dice and nonsense', () => {
  assert.equal(parseFormula('1d7'), null);
  assert.equal(parseFormula('21d6'), null);
  assert.equal(parseFormula('12d6+9d8'), null);
  assert.equal(parseFormula('0d6'), null);
  assert.equal(parseFormula('2d6-1d4'), null);
  assert.equal(parseFormula(''), null);
  assert.equal(parseFormula('2d6+'), null);
  assert.equal(parseFormula('fireball'), null);
  assert.equal(parseFormula('+3', { defaultRoll: '1d7', crit: 'none' }), null);
});

test('defaultDie is the die of the default roll', () => {
  assert.equal(defaultDie(DEFAULT_RULES), 'd20');
  assert.equal(defaultDie({ defaultRoll: '2d10', crit: 'high-total' }), 'd10');
  assert.equal(defaultDie({ defaultRoll: 'oops', crit: 'none' }), null);
});

test('explosion: highest faces up, lowest faces down, within scope and repeats', () => {
  const rules: DiceRules = { defaultRoll: '1d10', crit: 'none', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 1 } };
  assert.equal(explosion(rules, 'd10', 10, true, false), 'up');
  assert.equal(explosion(rules, 'd10', 1, true, false), 'down');
  assert.equal(explosion(rules, 'd10', 5, true, false), null);
  assert.equal(explosion(rules, 'd6', 6, false, false), null);
  assert.equal(explosion(rules, 'd10', 10, true, true), null);
  const repeating: DiceRules = { ...rules, explode: { dice: 'all', repeats: true, highFaces: 2, lowFaces: 0 } };
  assert.equal(explosion(repeating, 'd6', 5, false, true), 'up');
  assert.equal(explosion(repeating, 'd6', 1, false, true), null);
  assert.equal(explosion(DEFAULT_RULES, 'd20', 20, true, false), null);
});

test('critOf natural: highest face success, 1 failure', () => {
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 20, 20)]), 'success');
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 1, 20)]), 'failure');
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 12, 20)]), undefined);
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 12, 20), d('d6', 6, 6)]), undefined, 'only default dice count');
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 20, 20, { dropped: true }), d('d20', 5, 20)]), undefined, 'dropped dice do not count');
  assert.equal(critOf(DEFAULT_RULES, [d('d20', 5, 20), d('d20', 20, 20, { exploded: true })]), undefined, 'explosion dice do not count');
});

test('critOf roll-under, doubles, high-total and none', () => {
  const under: DiceRules = { defaultRoll: '1d100', crit: 'roll-under' };
  assert.equal(critOf(under, [d('d100', 1, 100)]), 'success');
  assert.equal(critOf(under, [d('d100', 100, 100)]), 'failure');
  const doubles: DiceRules = { defaultRoll: '2d12', crit: 'doubles' };
  assert.equal(critOf(doubles, [d('d12', 7, 12), d('d12', 7, 12)]), 'success');
  assert.equal(critOf(doubles, [d('d12', 7, 12), d('d12', 8, 12)]), undefined);
  const high: DiceRules = { defaultRoll: '2d10', crit: 'high-total' };
  assert.equal(critOf(high, [d('d10', 10, 10), d('d10', 9, 10)]), 'success');
  assert.equal(critOf(high, [d('d10', 9, 10), d('d10', 9, 10)]), undefined);
  assert.equal(critOf({ defaultRoll: '1d20', crit: 'none' }, [d('d20', 20, 20)]), undefined);
});

test('total subtracts negative dice and skips dropped ones', () => {
  const rolls = [d('d6', 6, 6), d('d6', 2, 6, { exploded: true, negative: true }), d('d6', 5, 6, { dropped: true })];
  assert.equal(total(rolls, 3), 7);
});
