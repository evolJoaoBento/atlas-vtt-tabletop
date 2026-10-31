import assert from 'node:assert/strict';
import { test } from 'node:test';
import { critOf, DEFAULT_RULES, defaultDie, explainFormula, explosion, keepDropped, parseFormula, successCount, total, type DiceRules, type RolledDie } from '../src/dice/rollRules';

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

test('parseFormula reads keep and drop rules, d% and success counts', () => {
  assert.deepEqual(parseFormula('4d6kh3'), { dice: { d6: 4 }, modifier: 0, keep: { d6: { mode: 'kh', count: 3 } } });
  assert.deepEqual(parseFormula('2d20kl'), { dice: { d20: 2 }, modifier: 0, keep: { d20: { mode: 'kl', count: 1 } } });
  assert.deepEqual(parseFormula('5d8dh1+2'), { dice: { d8: 5 }, modifier: 2, keep: { d8: { mode: 'dh', count: 1 } } });
  assert.deepEqual(parseFormula('1d%'), { dice: { d100: 1 }, modifier: 0 });
  assert.deepEqual(parseFormula('5d10>=8'), { dice: { d10: 5 }, modifier: 0, success: { die: 'd10', op: '>=', target: 8 } });
  assert.deepEqual(parseFormula('6d6cs>5+1'), { dice: { d6: 6 }, modifier: 1, success: { die: 'd6', op: '>', target: 5 } });
});

test('parseFormula refuses keep and success rules it cannot honour, and explainFormula says why', () => {
  assert.equal(parseFormula('2d6kh1+1d6'), null);
  assert.equal(parseFormula('3d6dh3'), null);
  assert.equal(parseFormula('4d6kh0'), null);
  assert.equal(parseFormula('2d6>3+2d8>4'), null);
  assert.equal(explainFormula('2d6+3'), null);
  assert.match(explainFormula('')!, /Enter a formula/);
  assert.match(explainFormula('1d7')!, /no d7/);
  assert.match(explainFormula('21d6')!, /at most 20 dice/);
  assert.match(explainFormula('2d6-1d4')!, /cannot be subtracted/);
  assert.match(explainFormula('fireball')!, /Can't read "fireball"/);
  assert.match(explainFormula('3d6dh3')!, /leaves none/);
  assert.match(explainFormula('2d6>3+2d8>4')!, /one kind of die/);
});

test('keepDropped sets aside the right dice, the first thrown winning ties', () => {
  const dice = [{ id: 1, value: 4 }, { id: 2, value: 6 }, { id: 3, value: 4 }, { id: 4, value: 2 }];
  assert.deepEqual([...keepDropped({ mode: 'kh', count: 2 }, dice)].sort(), [3, 4]);
  assert.deepEqual([...keepDropped({ mode: 'kl', count: 1 }, dice)].sort(), [1, 2, 3]);
  assert.deepEqual([...keepDropped({ mode: 'dh', count: 1 }, dice)], [2]);
  assert.deepEqual([...keepDropped({ mode: 'dl', count: 2 }, dice)].sort(), [1, 4]);
  assert.equal(keepDropped({ mode: 'kh', count: 9 }, dice).size, 0);
});

test('successCount counts kept dice that meet the rule', () => {
  const rolls = [d('d10', 9, 10), d('d10', 7, 10), d('d10', 10, 10, { dropped: true }), d('d10', 8, 10, { negative: true }), d('d6', 6, 6)];
  assert.equal(successCount({ die: 'd10', op: '>=', target: 8 }, rolls), 1);
  assert.equal(successCount({ die: 'd10', op: '<', target: 8 }, rolls), 1);
  assert.equal(successCount({ die: 'd10', op: '=', target: 7 }, rolls), 1);
});

test('rerolls: r, ro and rr with a condition, as Atlas reads them', () => {
  assert.deepEqual(parseFormula('2d6r<2'), { dice: { d6: 2 }, modifier: 0, reroll: { d6: { op: '<', value: 2, limit: 1 } } });
  assert.deepEqual(parseFormula('1d20ro1'), { dice: { d20: 1 }, modifier: 0, reroll: { d20: { op: '=', value: 1, limit: 1 } } });
  assert.deepEqual(parseFormula('4d6rr<=2kh3'), { dice: { d6: 4 }, modifier: 0, reroll: { d6: { op: '<=', value: 2, limit: 10 } }, keep: { d6: { mode: 'kh', count: 3 } } });
  assert.deepEqual(parseFormula('1d8r'), { dice: { d8: 1 }, modifier: 0, reroll: { d8: { op: '=', value: 1, limit: 1 } } });
});

test('a reroll every face meets is refused, and so is one on a split kind of die', () => {
  assert.match(explainFormula('1d6r>=1') ?? '', /never stop/);
  assert.match(explainFormula('1d6r<7') ?? '', /never stop/);
  assert.match(explainFormula('1d6r<2+1d6') ?? '', /whole kind of die/);
  assert.equal(explainFormula('2d6r<2'), null);
});

test('rerolled dice count for nothing in the total, successes or critical', () => {
  const rolls = [{ die: 'd20' as const, value: 1, max: 20, rerolled: true as const }, { die: 'd20' as const, value: 14, max: 20 }];
  assert.equal(total(rolls, 2), 16);
  assert.equal(critOf(DEFAULT_RULES, rolls), undefined);
  assert.equal(successCount({ die: 'd20', op: '>=', target: 1 }, rolls), 1);
});

test('Fate dice and labels are read, and refused where they cannot work', async () => {
  const { explainFormula, parseFormula: parse, DEFAULT_RULES: rules } = await import('../src/dice/rollRules');
  assert.deepEqual(parse('4dF', rules), { dice: {}, modifier: 0, fate: 4 });
  assert.equal(parse('dF-2', rules)?.fate, 1);
  assert.equal(parse('4DF+1d20[Attack]', rules)?.fate, 4);
  assert.equal(parse('2d6[fire]', rules)?.dieLabels?.d6?.length, 2);
  assert.equal(parse('2d6[fire]', rules)?.label, undefined, 'a label names dice, not the roll');
  for (const [formula, said] of [
    ['4dFkh2', 'Fate dice take no keep'],
    ['4dFr1', 'Fate dice take no keep'],
    ['-2dF', 'cannot be subtracted'],
    ['1d6kh1+2dF', 'cannot be mixed'],
    ['2d6[]', 'A label is 1 to 24'],
    ['2d6[this label is far too long to keep]', 'A label is 1 to 24'],
    ['2d6[<b>]', 'A label is 1 to 24'],
    ['3[fire]', "Can't read"],
  ] as const) assert.match(explainFormula(formula, rules) ?? '', new RegExp(said), formula);
  assert.equal(parse('2d6[Fogo]+1d4[Gelo]', rules)?.modifier, 0);
  assert.equal(parse('2d6[ação do goblin]', rules)?.dieLabels?.d6?.[0], 'ação do goblin', 'letters of any language');
  assert.equal(parse('21dF', rules), null, 'more than 20 dice');
});
