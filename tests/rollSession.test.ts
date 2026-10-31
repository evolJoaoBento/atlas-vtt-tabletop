import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FaceReading } from '../src/dice/kit/faces';
import { DEFAULT_RULES, parseFormula, type DiceRules } from '../src/dice/rollRules';
import { RollSession, THROW_PROMPT } from '../src/dice/rollSession';

const face = (n: number): FaceReading => ({ caught: false, face: n, confidence: 1 });
const CAUGHT: FaceReading = { caught: true, face: null, confidence: 0.4 };
const explodeAll: DiceRules = { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
const pending = (session: RollSession) => session.pendingThrows().map(({ die, reason }) => ({ die, reason }));

test('reroll keeps settled dice', () => {
  const session = new RollSession({ dice: { d20: 1, d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  const [d6a, d6b, d20] = session.dice;
  assert.deepEqual(session.dice.map((die) => die.die), ['d6', 'd6', 'd20']);
  session.settle(d6a.id, face(4));
  session.settle(d6b.id, face(2));
  session.settle(d20.id, CAUGHT);
  assert.equal(session.result(), null);
  assert.equal(session.prompt(), 'd20 caught: roll it again');
  assert.deepEqual(session.pendingThrows(), [{ id: d20.id, die: 'd20', reason: 'caught' }]);
  session.reroll(d20.id);
  assert.deepEqual(session.pendingThrows(), [], 'a die being thrown is no longer pending');
  assert.equal(session.prompt(), null);
  session.settle(d20.id, face(11));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls.map((roll) => roll.value), [4, 2, 11]);
  assert.equal(result.total, 17);
  assert.equal(result.crit, undefined);
});

test('a settled die keeps its value when read again; thrown again, it waits for its new landing', () => {
  const session = new RollSession({ dice: { d6: 1 }, modifier: 1, label: 'Dagger' }, DEFAULT_RULES);
  const id = session.dice[0].id;
  session.settle(id, face(3));
  session.settle(id, face(5));
  assert.deepEqual(session.result(), { rolls: [{ die: 'd6', value: 3, max: 6 }], modifier: 1, total: 4, label: 'Dagger' });
  session.reroll(id);
  assert.equal(session.result(), null, 'thrown again: no result while it rolls');
  session.settle(id, face(5));
  assert.equal(session.result()?.total, 6);
});

test('a roll starts laid on the table: every die waits to be thrown, and the line says so', () => {
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  assert.deepEqual(session.dice.map((state) => state.status), ['waiting', 'waiting']);
  assert.deepEqual(session.pendingThrows().map((pending) => pending.reason), ['placed', 'placed']);
  assert.equal(session.prompt(), THROW_PROMPT);
  session.reroll(session.dice[0].id);
  assert.equal(session.dice[0].status, 'rolling');
  assert.equal(session.prompt(), THROW_PROMPT, 'one still waits');
  session.reroll(session.dice[1].id);
  assert.equal(session.prompt(), null, 'all in the air');
});

test('a die thrown again takes back the explosion its old face earned', () => {
  const rules: DiceRules = { defaultRoll: '1d6', crit: 'none', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, rules);
  const [d6] = session.dice;
  session.settle(d6.id, face(6));
  assert.equal(session.dice.length, 2, 'the 6 earned another d6');
  const removed = session.reroll(d6.id);
  assert.equal(removed.length, 1);
  assert.equal(session.dice.length, 1);
  session.settle(d6.id, face(2));
  assert.equal(session.result()?.total, 2);
});

test('an impossible face is caught, never a number', () => {
  const session = new RollSession({ dice: { d6: 1, d10: 1 }, modifier: 0 }, DEFAULT_RULES);
  const [d6, d10] = session.dice;
  session.settle(d6.id, face(0));
  session.settle(d10.id, { caught: false, face: null, confidence: 1 });
  assert.equal(session.prompt(), 'd6 and d10 caught: roll them again');
  session.reroll(d6.id);
  session.reroll(d10.id);
  session.settle(d6.id, face(6));
  session.settle(d10.id, face(0));
  assert.deepEqual(session.result()?.rolls.map((roll) => roll.value), [6, 10], 'a d10 numbered 0-9 reads 0 as 10');
});

test('colours follow the die type', () => {
  const session = new RollSession({ dice: { d6: 1, d8: 1 }, modifier: 0, colors: { d8: '#ff0000' } }, DEFAULT_RULES);
  assert.equal(session.dice[0].color, undefined);
  assert.equal(session.dice[1].color, '#ff0000');
  session.settle(session.dice[0].id, face(2));
  session.settle(session.dice[1].id, face(8));
  assert.deepEqual(session.result()?.rolls, [{ die: 'd6', value: 2, max: 6 }, { die: 'd8', value: 8, max: 8, color: '#ff0000' }]);
});

test('explosion asks for another die and adds it', () => {
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0, colors: { d6: '#00ff00' } }, explodeAll);
  session.settle(session.dice[0].id, face(6));
  assert.deepEqual(pending(session), [{ die: 'd6', reason: 'explode-up' }]);
  assert.equal(session.result(), null);
  assert.equal(session.prompt(), 'd6 exploded: throw another d6');
  const extra = session.dice[1];
  assert.equal(extra.exploded, true);
  assert.equal(extra.isDefault, false);
  assert.equal(extra.color, '#00ff00');
  session.reroll(extra.id);
  assert.equal(session.prompt(), null);
  assert.deepEqual(session.pendingThrows(), []);
  session.settle(extra.id, face(3));
  const result = session.result();
  assert.ok(result);
  assert.equal(result.total, 9);
  assert.deepEqual(result.rolls[1], { die: 'd6', value: 3, max: 6, exploded: true, color: '#00ff00' });
});

test('caught dice take precedence over explosions in the prompt', () => {
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, explodeAll);
  session.settle(session.dice[0].id, face(6));
  session.settle(session.dice[1].id, CAUGHT);
  assert.equal(session.prompt(), 'd6 caught: roll it again');
  assert.deepEqual(pending(session), [{ die: 'd6', reason: 'caught' }, { die: 'd6', reason: 'explode-up' }]);
});

test('explosion dice explode again only when the rule repeats', () => {
  const once = new RollSession({ dice: { d6: 1 }, modifier: 0 }, explodeAll);
  once.settle(once.dice[0].id, face(6));
  once.settle(once.dice[1].id, face(6));
  assert.equal(once.result()?.total, 12);
  const repeating: DiceRules = { ...explodeAll, explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } };
  const again = new RollSession({ dice: { d6: 1 }, modifier: 0 }, repeating);
  again.settle(again.dice[0].id, face(6));
  again.settle(again.dice[1].id, face(6));
  assert.equal(again.result(), null);
  again.settle(again.dice[2].id, face(2));
  assert.equal(again.result()?.total, 14);
});

test('explode down subtracts', () => {
  const rules: DiceRules = { defaultRoll: '1d10', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 1 } };
  const session = new RollSession({ dice: { d10: 1 }, modifier: 5 }, rules);
  session.settle(session.dice[0].id, face(1));
  assert.deepEqual(pending(session), [{ die: 'd10', reason: 'explode-down' }]);
  assert.equal(session.prompt(), 'd10 exploded: throw another d10');
  const extra = session.dice[1];
  assert.equal(extra.negative, true);
  session.settle(extra.id, face(4));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls[1], { die: 'd10', value: 4, max: 10, exploded: true, negative: true });
  assert.equal(result.total, 2);
  assert.equal(result.crit, 'failure', 'the first die decides the critical, not its explosion');
});

test('explosions stop at 20 dice', () => {
  const rules: DiceRules = { defaultRoll: '1d20', crit: 'none', explode: { dice: 'all', repeats: true, highFaces: 6, lowFaces: 0 } };
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, rules);
  for (let i = 0; i < 30 && session.result() === null; i++) {
    const next = session.dice.find((die) => die.status !== 'settled');
    assert.ok(next);
    session.settle(next.id, face(3));
  }
  assert.equal(session.result()?.rolls.length, 20);
});

test('advantage drops the lower d20', () => {
  const session = new RollSession({ dice: { d20: 1 }, modifier: 2, advantage: 'advantage' }, DEFAULT_RULES);
  assert.equal(session.dice.length, 2);
  assert.ok(session.dice.every((die) => die.die === 'd20' && die.isDefault));
  session.settle(session.dice[0].id, face(5));
  session.settle(session.dice[1].id, face(20));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls, [{ die: 'd20', value: 5, max: 20, dropped: true }, { die: 'd20', value: 20, max: 20 }]);
  assert.equal(result.total, 22);
  assert.equal(result.crit, 'success');
});

test('disadvantage drops the higher', () => {
  const session = new RollSession({ dice: { d20: 1 }, modifier: 0, advantage: 'disadvantage' }, DEFAULT_RULES);
  session.settle(session.dice[0].id, face(20));
  session.settle(session.dice[1].id, face(1));
  const result = session.result();
  assert.ok(result);
  assert.equal(result.rolls[0].dropped, true);
  assert.equal(result.rolls[1].dropped, undefined);
  assert.equal(result.total, 1);
  assert.equal(result.crit, 'failure');
});

test('a dropped die takes its explosions with it: they leave the roll, as Atlas explodes kept dice only', () => {
  const rules: DiceRules = { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession({ dice: { d20: 1 }, modifier: 0, advantage: 'disadvantage' }, rules);
  session.settle(session.dice[0].id, face(20));
  session.settle(session.dice[1].id, face(7));
  session.settle(session.dice[2].id, face(9));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls, [{ die: 'd20', value: 20, max: 20, dropped: true }, { die: 'd20', value: 7, max: 20 }]);
  assert.equal(result.total, 7);
});

test('advantage needs exactly one default die', () => {
  const session = new RollSession({ dice: { d20: 2 }, modifier: 0, advantage: 'advantage' }, DEFAULT_RULES);
  assert.equal(session.dice.length, 2);
  const none = new RollSession({ dice: { d6: 1 }, modifier: 0, advantage: 'advantage' }, DEFAULT_RULES);
  assert.equal(none.dice.length, 1);
});

test('d100 pair: tens and ones make one roll', () => {
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0 }, DEFAULT_RULES);
  assert.deepEqual(session.dice.map((die) => die.die), ['d100', 'd10']);
  session.settle(session.dice[0].id, face(30));
  session.settle(session.dice[1].id, face(7));
  assert.deepEqual(session.result()?.rolls, [{ die: 'd100', value: 37, max: 100 }]);
});

test('d100 pair: 00 and 0 is 100, and the d10 reads 10 as 0', () => {
  const zeroes = new RollSession({ dice: { d100: 1 }, modifier: 0 }, DEFAULT_RULES);
  zeroes.settle(zeroes.dice[0].id, face(0));
  zeroes.settle(zeroes.dice[1].id, face(0));
  assert.equal(zeroes.result()?.rolls[0].value, 100);
  const ten = new RollSession({ dice: { d100: 1 }, modifier: 0 }, DEFAULT_RULES);
  ten.settle(ten.dice[0].id, face(90));
  ten.settle(ten.dice[1].id, face(10));
  assert.equal(ten.result()?.rolls[0].value, 90);
});

test('d100 pair: tens caught, only tens pending', () => {
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0, colors: { d100: '#123456' } }, DEFAULT_RULES);
  const [tens, ones] = session.dice;
  assert.equal(ones.color, '#123456');
  session.settle(tens.id, CAUGHT);
  session.settle(ones.id, face(4));
  assert.deepEqual(session.pendingThrows(), [{ id: tens.id, die: 'd100', reason: 'caught', color: '#123456' }]);
  assert.equal(session.prompt(), 'd100 caught: roll it again');
  session.reroll(tens.id);
  session.settle(tens.id, face(25));
  assert.equal(session.dice[0].status, 'caught', 'tens read only 00-90');
  session.reroll(tens.id);
  session.settle(tens.id, face(20));
  assert.equal(session.result()?.rolls[0].value, 24);
});

test('d100 pair: the ones die is no d10 of the roll', () => {
  const rules: DiceRules = { defaultRoll: '1d10', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 1 } };
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0 }, rules);
  assert.equal(session.dice[1].isDefault, false);
  session.settle(session.dice[0].id, face(50));
  session.settle(session.dice[1].id, face(10));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls, [{ die: 'd100', value: 50, max: 100 }]);
  assert.equal(result.crit, undefined);
});

test('d100 pair explodes on its combined value, once per pair', () => {
  const rules: DiceRules = { defaultRoll: '1d100', crit: 'roll-under', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0 }, rules);
  session.settle(session.dice[0].id, face(0));
  assert.deepEqual(session.pendingThrows().filter((pending) => pending.reason !== 'placed'), [], 'no explosion before both halves settle');
  session.settle(session.dice[1].id, face(0));
  assert.deepEqual(pending(session), [{ die: 'd100', reason: 'explode-up' }, { die: 'd10', reason: 'explode-up' }]);
  assert.equal(session.prompt(), 'd100 exploded: throw another d100');
  session.settle(session.dice[2].id, face(40));
  session.settle(session.dice[3].id, face(2));
  const result = session.result();
  assert.ok(result);
  assert.deepEqual(result.rolls, [{ die: 'd100', value: 100, max: 100 }, { die: 'd100', value: 42, max: 100, exploded: true }]);
  assert.equal(result.total, 142);
  assert.equal(result.crit, 'failure');
});

test('a settled die knocked loose is read again where it lands: the landing decides', () => {
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  const [a, b] = session.dice;
  session.settle(a.id, face(4));
  session.settle(b.id, face(2));
  assert.equal(session.result()?.total, 6);
  session.loosen(b.id);
  assert.equal(session.result(), null, 'no result while it moves');
  assert.equal(b.status, 'rolling');
  assert.deepEqual(session.pendingThrows(), [], 'it is moving, not waiting to be thrown');
  session.settle(b.id, face(5));
  assert.deepEqual(session.result()?.rolls.map((roll) => roll.value), [4, 5]);
  session.loosen(a.id);
  session.settle(a.id, CAUGHT);
  assert.equal(a.status, 'caught');
  assert.equal(a.value, undefined);
  assert.equal(session.prompt(), 'd6 caught: roll it again');
  assert.equal(session.result(), null);
});

test('a caught die knocked onto a clean face takes it', () => {
  const session = new RollSession({ dice: { d8: 1 }, modifier: 0 }, DEFAULT_RULES);
  const [d8] = session.dice;
  session.settle(d8.id, CAUGHT);
  session.loosen(d8.id);
  assert.equal(session.prompt(), null);
  session.settle(d8.id, face(7));
  assert.equal(session.result()?.total, 7);
});

test('a die knocked loose off an explosion face takes back the explosion not yet thrown', () => {
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, explodeAll);
  const [d6] = session.dice;
  session.settle(d6.id, face(6));
  assert.equal(session.dice.length, 2);
  session.loosen(d6.id);
  session.settle(d6.id, face(6));
  assert.equal(session.dice.length, 2, 'landing on 6 again earns the explosion again, once');
  session.loosen(d6.id);
  session.settle(d6.id, face(3));
  assert.equal(session.dice.length, 1, 'the explosion it no longer earns is gone');
  assert.deepEqual(session.pendingThrows(), []);
  assert.equal(session.result()?.total, 3);
});

test('a die knocked loose withdraws its explosion at once, thrown or not; its landing alone decides another', () => {
  const repeating: DiceRules = { ...explodeAll, explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, repeating);
  const [d6] = session.dice;
  session.settle(d6.id, face(6));
  const waiting = session.dice[1];
  assert.deepEqual(session.loosen(d6.id), [waiting.id], 'the explosion not yet thrown is taken back');
  assert.equal(session.dice.length, 1);
  assert.deepEqual(session.pendingThrows(), [], 'nothing to throw while it moves');
  assert.equal(session.prompt(), null);
  session.settle(d6.id, face(6));
  const extra = session.dice[1];
  assert.notEqual(extra.id, waiting.id, 'landing on 6 again earns a fresh explosion');
  session.reroll(extra.id);
  session.settle(extra.id, face(6));
  const chained = session.dice[2];
  session.reroll(chained.id);
  session.settle(chained.id, face(2));
  assert.deepEqual(session.loosen(d6.id), [extra.id, chained.id], 'thrown explosions go too, with the chain from them');
  assert.equal(session.result(), null);
  session.settle(d6.id, face(1));
  const result = session.result();
  assert.deepEqual(result?.rolls.map((roll) => [roll.value, roll.exploded ?? false]), [[1, false]]);
  assert.equal(result?.total, 1);
});

test('a d100 half knocked loose withdraws the explosion of the pair', () => {
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0 }, explodeAll);
  const [tens, ones] = session.dice;
  session.settle(tens.id, face(0));
  session.settle(ones.id, face(10));
  assert.equal(session.dice.length, 4, '100 explodes: another tens and ones');
  const [, , extraTens, extraOnes] = session.dice;
  assert.deepEqual(session.loosen(ones.id), [extraTens.id, extraOnes.id]);
  assert.equal(session.dice.length, 2);
});

test('a d100 half knocked loose is read again', () => {
  const session = new RollSession({ dice: { d100: 1 }, modifier: 0 }, DEFAULT_RULES);
  const [tens, ones] = session.dice;
  session.settle(tens.id, face(30));
  session.settle(ones.id, face(4));
  assert.equal(session.result()?.total, 34);
  session.loosen(ones.id);
  assert.equal(session.result(), null);
  session.settle(ones.id, face(10));
  assert.equal(session.result()?.total, 30);
});

test('each die of a type is thrown in its own colour; null is the pack\'s, and wins over the type\'s colour', () => {
  const session = new RollSession({ dice: { d6: 3 }, modifier: 0, colors: { d6: '#000000' }, dieColors: { d6: ['#d64545', null] } }, DEFAULT_RULES);
  assert.deepEqual(session.dice.map((state) => state.color), ['#d64545', undefined, '#000000']);
});

const duality: DiceRules = {
  defaultRoll: '2d12', crit: 'natural', advantage: null, disadvantage: null,
  groups: [{ die: 'd12', count: 1, color: '#7e22ce' }, { die: 'd12', count: 1, color: '#4d7c0f' }],
};
const settleAll = (session: RollSession, faces: number[]) => session.dice.forEach((die, index) => session.settle(die.id, face(faces[index] ?? 1)));

test("a bare bonus rolls every group of the dice set, each die in the set's colour", () => {
  const request = parseFormula('+3', duality)!;
  assert.deepEqual(request.dice, { d12: 2 });
  assert.deepEqual(request.dieColors, { d12: ['#7e22ce', '#4d7c0f'] });
  const session = new RollSession(request, duality);
  settleAll(session, [7, 4]);
  assert.deepEqual(session.result()?.rolls.map((roll) => [roll.value, roll.color]), [[7, '#7e22ce'], [4, '#4d7c0f']]);
  // Mixed kinds of die, and a set with no colours at all.
  const mixed: DiceRules = { defaultRoll: '1d20', crit: 'none', groups: [{ die: 'd20', count: 1 }, { die: 'd6', count: 2 }] };
  assert.deepEqual(parseFormula('+1', mixed), { dice: { d20: 1, d6: 2 }, modifier: 1 });
  // Dice written into the roll are rolled as written.
  assert.deepEqual(parseFormula('1d8+2', duality), { dice: { d8: 1 }, modifier: 2 });
});

test('a set that gives advantage no effect rolls as any other', () => {
  const session = new RollSession({ dice: { d12: 2 }, modifier: 0, advantage: 'advantage' }, duality);
  assert.equal(session.dice.length, 2);
  settleAll(session, [3, 5]);
  assert.equal(session.result()?.total, 8);
});

test("a set's advantage and disadvantage that add a number or a die of their own do so", () => {
  const rules: DiceRules = {
    defaultRoll: '2d10', crit: 'none', groups: [{ die: 'd10', count: 2 }],
    advantage: { kind: 'number', value: 2 }, disadvantage: { kind: 'die', die: 'd6', color: '#ff0000' },
  };
  const up = new RollSession({ dice: { d10: 2 }, modifier: 1, advantage: 'advantage' }, rules);
  settleAll(up, [4, 5]);
  assert.deepEqual([up.result()?.modifier, up.result()?.total], [3, 12]);
  const down = new RollSession({ dice: { d10: 2 }, modifier: 0, advantage: 'disadvantage' }, rules);
  assert.deepEqual(down.dice.map((die) => [die.die, die.negative === true]), [['d10', false], ['d10', false], ['d6', true]]);
  settleAll(down, [4, 5, 3]);
  const result = down.result()!;
  assert.equal(result.total, 6, 'the extra die is taken off');
  assert.deepEqual(result.rolls.at(-1), { die: 'd6', value: 3, max: 6, negative: true, color: '#ff0000' });
  // A roll with none of the set's dice is not changed.
  const other = new RollSession({ dice: { d6: 1 }, modifier: 0, advantage: 'advantage' }, rules);
  assert.equal(other.dice.length, 1);
  settleAll(other, [2]);
  assert.equal(other.result()?.modifier, 0);
});

test('advantage keeps the lowest where a low roll is the good one', () => {
  const rules: DiceRules = { defaultRoll: '1d20', crit: 'roll-under' };
  const session = new RollSession({ dice: { d20: 1 }, modifier: 0, advantage: 'advantage' }, rules);
  settleAll(session, [5, 15]);
  assert.equal(session.result()?.total, 5);
});

test('keep highest: the lowest die is set aside and does not count', () => {
  const session = new RollSession(parseFormula('4d6kh3+1')!, DEFAULT_RULES);
  [3, 6, 1, 4].forEach((value, i) => session.settle(session.dice[i].id, face(value)));
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => [roll.value, roll.dropped === true]), [[3, false], [6, false], [1, true], [4, false]]);
  assert.equal(result.total, 14);
});

test('drop lowest on advantage-style 2d20dl1, with the explosion of a dropped die leaving the roll', () => {
  const rules: DiceRules = { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession(parseFormula('2d20dl1', rules)!, rules);
  const [a, b] = session.dice;
  session.settle(a.id, face(20));
  session.settle(b.id, face(13));
  const [exploded] = session.dice.filter((die) => die.exploded);
  assert.ok(exploded);
  session.settle(exploded.id, face(5));
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => [roll.value, roll.dropped === true]), [[20, false], [13, true], [5, false]]);
  assert.equal(result.total, 25);
});

test('a success count totals the dice that meet it and drops the critical', () => {
  const session = new RollSession(parseFormula('5d10>=8+1')!, DEFAULT_RULES);
  [10, 8, 7, 1, 9].forEach((value, i) => session.settle(session.dice[i].id, face(value)));
  const result = session.result()!;
  assert.equal(result.successes, 3);
  assert.equal(result.total, 4);
  assert.equal(result.crit, undefined);
});

test('a die under a reroll rule is thrown again: it stays in the roll, struck out, and the new die counts', () => {
  const session = new RollSession(parseFormula('2d6r<2+1')!, DEFAULT_RULES);
  const [a, b] = session.dice;
  session.settle(a.id, face(1));
  session.settle(b.id, face(5));
  assert.deepEqual(pending(session), [{ die: 'd6', reason: 'reroll' }]);
  assert.equal(session.prompt(), 'd6 rerolled: throw another d6');
  assert.equal(session.result(), null);
  const [again] = session.dice.filter((die) => !die.value && die.status === 'waiting');
  session.settle(again.id, face(4));
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => [roll.value, roll.rerolled === true]), [[1, true], [4, false], [5, false]]);
  assert.equal(result.total, 10);
});

test('ro rerolls once even when the new die meets the rule; rr goes on until a die stands', () => {
  const once = new RollSession(parseFormula('1d6ro1')!, DEFAULT_RULES);
  once.settle(once.dice[0].id, face(1));
  once.settle(once.dice[1].id, face(1));
  assert.equal(once.dice.length, 2);
  assert.deepEqual(once.result()!.rolls.map((roll) => roll.rerolled === true), [true, false]);
  assert.equal(once.result()!.total, 1);

  const many = new RollSession(parseFormula('1d6rr<3')!, DEFAULT_RULES);
  many.settle(many.dice[0].id, face(1));
  many.settle(many.dice[1].id, face(2));
  many.settle(many.dice[2].id, face(5));
  assert.deepEqual(many.result()!.rolls.map((roll) => roll.rerolled === true), [true, true, false]);
  assert.equal(many.result()!.total, 5);
});

test('a rerolled die earns no explosion; the die that replaces it can', () => {
  const rules: DiceRules = { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
  const session = new RollSession(parseFormula('1d6r>=6', rules)!, rules);
  session.settle(session.dice[0].id, face(6));
  assert.deepEqual(pending(session), [{ die: 'd6', reason: 'reroll' }], 'only the reroll waits, no explosion');
  session.settle(session.dice[1].id, face(6));
  assert.deepEqual(pending(session), [{ die: 'd6', reason: 'explode-up' }]);
});

test('throwing a rerolled die again takes its replacement back and it stands on its new face', () => {
  const session = new RollSession(parseFormula('1d6ro1')!, DEFAULT_RULES);
  const [first] = session.dice;
  session.settle(first.id, face(1));
  assert.equal(session.dice.length, 2);
  const removed = session.reroll(first.id);
  assert.equal(removed.length, 1);
  assert.equal(session.dice.length, 1);
  assert.equal(session.dice[0].rerolled, undefined);
  session.settle(first.id, face(4));
  assert.equal(session.result()!.total, 4);
});

test('keep and advantage read the slot, not the die thrown away', () => {
  const session = new RollSession(parseFormula('3d6ro1kh2')!, DEFAULT_RULES);
  const [a, b, c] = session.dice;
  session.settle(a.id, face(1));
  session.settle(b.id, face(3));
  session.settle(c.id, face(4));
  session.settle(session.dice[3].id, face(6));
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => [roll.value, roll.rerolled === true, roll.dropped === true]), [
    [1, true, false], [6, false, false], [3, false, true], [4, false, false],
  ]);
  assert.equal(result.total, 10);
});

test('Fate dice are thrown as d6s and read minus, blank or plus, two faces each', () => {
  const request = parseFormula('4dF+1')!;
  assert.equal(request.fate, 4);
  assert.deepEqual(request.dice, {}, 'no ordinary die is asked for');
  const session = new RollSession(request, DEFAULT_RULES);
  assert.deepEqual(session.dice.map((die) => die.die), ['d6', 'd6', 'd6', 'd6']);
  settleAll(session, [1, 2, 3, 6]);
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => roll.value), [-1, -1, 0, 1]);
  assert.ok(result.rolls.every((roll) => roll.fate === true && roll.max === 1));
  assert.equal(result.total, -1 - 1 + 0 + 1 + 1, 'the sum of the dice, and the modifier');
  assert.equal(result.crit, undefined, 'a Fate die is no critical');
  // Every face of the d6 reads one of the three.
  const faces = [1, 2, 3, 4, 5, 6].map((n) => { const one = new RollSession(parseFormula('1dF')!, DEFAULT_RULES); settleAll(one, [n]); return one.result()!.rolls[0].value; });
  assert.deepEqual(faces, [-1, -1, 0, 0, 1, 1]);
});

test('a Fate die never explodes, even under a rule that explodes every die, and mixes with ordinary dice', () => {
  const session = new RollSession(parseFormula('2dF+1d6')!, explodeAll);
  assert.deepEqual(session.dice.map((die) => die.die), ['d6', 'd6', 'd6']);
  // The ordinary d6 sits first; a 6 on a Fate die (plus) must not throw another die.
  settleAll(session, [6, 6, 6]);
  assert.deepEqual(pending(session).map((one) => one.reason), ['explode-up'], 'only the ordinary d6 that showed its top face explodes');
});

test('labels name the dice of their group and ride with them through the result', () => {
  const request = parseFormula('2d6[fire] + 1d6 [cold snap] + 1d4')!;
  assert.deepEqual(request.dice, { d6: 3, d4: 1 });
  assert.deepEqual(request.dieLabels, { d6: ['fire', 'fire', 'cold snap'] });
  const session = new RollSession(request, DEFAULT_RULES);
  settleAll(session, [1, 2, 3, 4]);
  const result = session.result()!;
  assert.deepEqual(result.rolls.map((roll) => [roll.die, roll.label ?? null]), [['d4', null], ['d6', 'fire'], ['d6', 'fire'], ['d6', 'cold snap']]);
  const split = parseFormula('1d6[a]+1d6+1d6[b]')!;
  assert.deepEqual(split.dieLabels, { d6: ['a', null, 'b'] }, 'a group without a label keeps its place');
});

test('the dice a finished roll sets aside are named for the table: dropped by a keep rule, thrown again by a reroll', () => {
  const keep = new RollSession(parseFormula('4d6kh3')!, DEFAULT_RULES);
  assert.deepEqual(keep.setAside(), [], 'nothing before the roll is complete');
  settleAll(keep, [5, 1, 6, 3]);
  assert.deepEqual(keep.setAside(), [keep.dice[1].id], 'the lowest die is set aside');
  const reroll = new RollSession(parseFormula('2d6r<3')!, DEFAULT_RULES);
  settleAll(reroll, [2, 5]);
  const [first] = reroll.dice;
  assert.deepEqual(reroll.setAside(), [], 'the roll waits for the die it threw again');
  const replacement = reroll.dice.find((die) => die.id !== reroll.dice[0].id && die.id !== reroll.dice[1].id)!;
  reroll.settle(replacement.id, face(6));
  assert.deepEqual(reroll.setAside(), [first.id]);
  const plain = new RollSession(parseFormula('2d6')!, DEFAULT_RULES);
  settleAll(plain, [1, 2]);
  assert.deepEqual(plain.setAside(), []);
});
