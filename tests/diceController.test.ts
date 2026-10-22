import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DiceController } from '../src/dice/diceController';
import type { FaceReading } from '../src/dice/kit/faces';
import { DEFAULT_RULES, type DiceRules } from '../src/dice/rollRules';
import type { RollSession } from '../src/dice/rollSession';
import type { Flick } from '../src/dice/throwInput';

const explodeAll: DiceRules = { defaultRoll: '1d20', crit: 'natural', explode: { dice: 'all', repeats: false, highFaces: 1, lowFaces: 0 } };
const FLICK: Flick = { dx: 0, dy: -200, ms: 100 };
const face = (value: number): FaceReading => ({ caught: false, face: value, confidence: 1 });
const CAUGHT: FaceReading = { caught: true, face: null, confidence: 0 };

/** A table that throws nothing: it records what it is asked, and the test settles the dice by hand. */
class FakeTable {
  busy = false;
  onSettled: (id: number, reading: FaceReading) => void = () => {};
  onLoosened: (id: number) => void = () => {};
  session: RollSession | null = null;
  rolls = 0;
  thrown: number[] = [];
  clears = 0;
  removed: number[] = [];
  /** Which die rests on which: throwing the one below knocks the one on top loose, as the real table does. */
  restsOn = new Map<number, number>();
  placeRoll(session: RollSession): void { this.session = session; this.rolls++; }
  placeMissing(): void {}
  throwDie(id: number): void {
    this.thrown.push(id);
    for (const [top, below] of this.restsOn) if (below === id) this.onLoosened(top);
  }
  remove(id: number): void { this.removed.push(id); }
  marked: number[][] = [];
  mark(waiting: readonly number[]): void { this.marked.push([...waiting]); }
  clear(): void { this.clears++; this.session = null; }
  ids(): number[] { return (this.session as RollSession).dice.map((state) => state.id); }
}

function controller(rules: DiceRules = DEFAULT_RULES) {
  const table = new FakeTable();
  const published: Array<NonNullable<ReturnType<RollSession['result']>>> = [];
  const prompts: Array<string | null> = [];
  const dice = new DiceController({ table, rules: () => rules, publish: (result) => { published.push(result); }, prompt: (text) => { prompts.push(text); } });
  return { dice, table, published, prompts };
}

test('publishes once when every die settles', () => {
  const { dice, table, published, prompts } = controller();
  dice.start({ dice: { d6: 2 }, modifier: 1 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  assert.equal(table.rolls, 1);
  const [a, b] = table.ids();
  table.onSettled(a, face(3));
  assert.equal(published.length, 0, 'one die still rolling');
  table.onSettled(b, face(5));
  assert.equal(published.length, 1);
  assert.equal(published[0].total, 9);
  assert.deepEqual(published[0].rolls.map((roll) => roll.value), [3, 5]);
  assert.equal(prompts.at(-1), null);
  table.onSettled(b, face(2));
  assert.equal(published.length, 1, 'a die read again after the roll is published publishes nothing');
});

test('caught die prompts and publishes after reroll', () => {
  const { dice, table, published, prompts } = controller();
  dice.start({ dice: { d20: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [d20] = table.ids();
  table.onSettled(d20, CAUGHT);
  assert.equal(published.length, 0);
  assert.match(prompts.at(-1) ?? '', /d20/);
  dice.clickDie(d20, FLICK);
  assert.deepEqual(table.thrown, [d20], 'clicking the caught die throws it again');
  table.onSettled(d20, face(17));
  assert.equal(published.length, 1);
  assert.equal(published[0].total, 17);
  assert.equal(prompts.at(-1), null);
});

test('a die in the air, or none of the roll, is not thrown; a die at rest is thrown again', () => {
  const { dice, table } = controller();
  dice.start({ dice: { d6: 2 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [a, b] = table.ids();
  table.onSettled(a, face(4));
  dice.clickDie(b, FLICK);
  dice.clickDie(999, FLICK);
  assert.deepEqual(table.thrown, [], 'a rolling die is in the air; an unknown die is none of the roll');
  dice.clickDie(a, FLICK);
  assert.deepEqual(table.thrown, [a], 'a die with its number is thrown again');
});

test('a roll is laid on the table: nothing is thrown until the thrower throws, one die or all', () => {
  const { dice, table, published, prompts } = controller();
  dice.start({ dice: { d6: 3 }, modifier: 0 });
  assert.equal(table.rolls, 1);
  assert.deepEqual(table.thrown, [], 'laid, not thrown');
  assert.match(prompts.at(-1) ?? '', /Drag a die/);
  const [a, b, c] = table.ids();
  dice.clickDie(a, FLICK);
  assert.deepEqual(table.thrown, [a]);
  table.onSettled(a, face(2));
  assert.equal(published.length, 0, 'two dice still lie unthrown');
  dice.throwPending(FLICK);
  assert.deepEqual(table.thrown, [a, b, c], 'throw all throws only the dice still waiting');
  table.onSettled(b, face(3));
  table.onSettled(c, face(4));
  assert.equal(published.length, 1);
  assert.equal(published[0].total, 9);
});

test('a die thrown again after the roll is published publishes the roll again once it lands', () => {
  const { dice, table, published } = controller();
  dice.start({ dice: { d6: 2 }, modifier: 1 });
  dice.throwPending(FLICK);
  const [a, b] = table.ids();
  table.onSettled(a, face(3));
  table.onSettled(b, face(5));
  assert.equal(published.length, 1);
  dice.clickDie(a, FLICK);
  assert.equal(published.length, 1, 'in the air: nothing new yet');
  table.onSettled(a, face(6));
  assert.equal(published.length, 2);
  assert.equal(published[1].total, 12);
});

test('a die picked up with all thrown throws every die still waiting with it', () => {
  const { dice, table } = controller();
  dice.start({ dice: { d6: 3 }, modifier: 0 });
  const [a, b, c] = table.ids();
  const grab = dice.pickUp(b);
  assert.ok(grab);
  grab.release(FLICK, true);
  assert.deepEqual(table.thrown, [b, a, c], 'the die in hand first, then the rest');
});

test('clear drops the roll: nothing is published, the table is cleared', () => {
  const { dice, table, published } = controller();
  dice.start({ dice: { d6: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  const [a] = table.ids();
  dice.clear();
  assert.equal(table.clears, 1);
  table.onSettled(a, face(4));
  assert.equal(published.length, 0);
});

test('throwPending throws every caught die once', () => {
  const { dice, table, published } = controller();
  dice.start({ dice: { d8: 2 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [a, b] = table.ids();
  table.onSettled(a, CAUGHT);
  table.onSettled(b, CAUGHT);
  dice.throwPending(FLICK);
  dice.throwPending(FLICK);
  assert.deepEqual(table.thrown, [a, b], 'thrown dice are no longer pending');
  table.onSettled(a, face(1));
  table.onSettled(b, face(8));
  assert.equal(published[0].total, 9);
});

test('scene change drops the roll', () => {
  const { dice, table, published, prompts } = controller();
  dice.start({ dice: { d6: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [d6] = table.ids();
  dice.sceneChanged();
  assert.equal(table.clears, 1);
  assert.equal(prompts.at(-1), null);
  table.onSettled(d6, face(6));
  assert.equal(published.length, 0);
  dice.throwPending(FLICK);
  assert.deepEqual(table.thrown, []);
});

test('dispose clears the table and stops listening', () => {
  const { dice, table, published } = controller();
  dice.start({ dice: { d6: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [d6] = table.ids();
  dice.dispose();
  assert.equal(table.clears, 1);
  table.onSettled(d6, face(2));
  assert.equal(published.length, 0);
});

test('explosion prompt then publish with the extra die', () => {
  const { dice, table, published, prompts } = controller(explodeAll);
  dice.start({ dice: { d6: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const session = table.session as RollSession;
  const [d6] = table.ids();
  table.onSettled(d6, face(6));
  assert.equal(published.length, 0);
  assert.equal(prompts.at(-1), 'd6 exploded: throw another d6');
  dice.throwPending(FLICK);
  const extra = session.dice[1].id;
  assert.deepEqual(table.thrown, [extra]);
  table.onSettled(extra, face(2));
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].rolls.map((roll) => [roll.value, roll.exploded ?? false]), [[6, false], [2, true]]);
  assert.equal(published[0].total, 8);
  assert.equal(prompts.at(-1), null);
});


test('a die knocked loose holds the roll until it lands, and its landing decides', () => {
  const { dice, table, published, prompts } = controller();
  dice.start({ dice: { d6: 3 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [a, b, c] = table.ids();
  table.onSettled(a, face(1));
  table.onSettled(b, CAUGHT);
  assert.match(prompts.at(-1) ?? '', /d6/);
  dice.clickDie(b, FLICK);
  // b is thrown again, and a, which lay on it, is knocked loose.
  table.onLoosened(a);
  table.onSettled(c, face(2));
  table.onSettled(b, face(3));
  assert.equal(published.length, 0, 'the loose die has not landed');
  table.onSettled(a, CAUGHT);
  assert.equal(published.length, 0);
  assert.match(prompts.at(-1) ?? '', /d6 caught/);
  dice.throwPending(FLICK);
  assert.deepEqual(table.thrown, [b, a]);
  table.onSettled(a, face(6));
  assert.deepEqual(published[0].rolls.map((roll) => roll.value), [6, 3, 2]);
});

test('a die knocked loose by a pending throw takes its explosion back before it can be thrown', () => {
  const { dice, table, published, prompts } = controller(explodeAll);
  dice.start({ dice: { d6: 1, d8: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const session = table.session as RollSession;
  const [a, b] = table.ids();
  table.onSettled(a, face(6));
  table.onSettled(b, CAUGHT);
  const extra = session.dice[2].id;
  assert.deepEqual(session.pendingThrows().map((pending) => pending.id), [b, extra]);
  // The exploded d6 rests on the caught d8: throwing the d8 knocks it loose.
  table.restsOn.set(a, b);
  dice.throwPending(FLICK);
  assert.deepEqual(table.thrown, [b], 'the explosion its parent no longer holds is not thrown');
  assert.deepEqual(table.removed, [extra]);
  assert.equal(prompts.at(-1), null, 'nothing asks for the withdrawn explosion');
  table.onSettled(b, face(5));
  assert.equal(published.length, 0, 'the loose d6 has not landed');
  table.onSettled(a, face(1));
  assert.deepEqual(published[0].rolls.map((roll) => [roll.die, roll.value, roll.exploded ?? false]), [['d6', 1, false], ['d8', 5, false]]);
  assert.equal(published[0].total, 6);
});

test('a publish that fails still clears the prompt and publishes nothing more', () => {
  const table = new FakeTable();
  const prompts: Array<string | null> = [];
  let publishes = 0;
  const dice = new DiceController({ table, rules: () => DEFAULT_RULES, publish: () => { publishes++; throw new Error('no route'); }, prompt: (text) => { prompts.push(text); } });
  dice.start({ dice: { d20: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [d20] = table.ids();
  table.onSettled(d20, CAUGHT);
  dice.clickDie(d20, FLICK);
  const before = prompts.length;
  assert.throws(() => table.onSettled(d20, face(12)), /no route/);
  assert.deepEqual(prompts.slice(before), [null], 'the prompt is cleared all the same');
  table.onSettled(d20, face(3));
  assert.equal(publishes, 1);
});

test('the roll waits on a caught die and on an explosion, not on a die with its number', () => {
  const { dice, table } = controller(explodeAll);
  assert.equal(dice.waiting, false);
  dice.start({ dice: { d6: 2 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [a, b] = table.ids();
  table.onSettled(a, CAUGHT);
  table.onSettled(b, face(3));
  assert.equal(dice.waitsOn(a), true);
  assert.equal(dice.waitsOn(b), false);
  assert.equal(dice.waiting, true);
  dice.clickDie(a, FLICK);
  assert.equal(dice.waitsOn(a), false, 'thrown again, it is in the air');
  table.onSettled(a, face(6));
  assert.equal(dice.waiting, true, 'a six explodes: another d6 to throw');
  dice.sceneChanged();
  assert.equal(dice.waiting, false);
  assert.equal(dice.waitsOn(a), false);
});

test('a die picked up is thrown into its own roll only: a new roll meanwhile, or a dropped one, throws nothing', () => {
  const { dice, table } = controller();
  dice.start({ dice: { d20: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  const [first] = table.ids();
  table.onSettled(first, CAUGHT);
  const release = dice.pickUp(first);
  assert.ok(release);
  dice.start({ dice: { d20: 1 }, modifier: 0 });
  dice.throwPending(FLICK);
  table.thrown.length = 0;
  table.onSettled(table.ids()[0], CAUGHT);
  release.release(FLICK);
  assert.deepEqual(table.thrown, [], 'the new roll is not the one the die was picked up from');
  const again = dice.pickUp(table.ids()[0]);
  dice.sceneChanged();
  again?.release(FLICK);
  assert.deepEqual(table.thrown, []);
  assert.equal(dice.pickUp(0), null, 'no roll, nothing to pick up');
});

test('the table is told which dice the roll waits on: all laid, none thrown, a caught one again', () => {
  const { dice, table } = controller();
  dice.start({ dice: { d6: 2 }, modifier: 0 });
  const [a, b] = table.ids();
  assert.deepEqual(table.marked.at(-1), [a, b], 'laid: both');
  dice.clickDie(a, FLICK);
  assert.deepEqual(table.marked.at(-1), [b], 'thrown: only the other');
  table.onSettled(a, CAUGHT);
  assert.deepEqual(table.marked.at(-1), [a, b], 'caught: it waits again');
  dice.throwPending(FLICK);
  assert.deepEqual(table.marked.at(-1), [], 'all in the air');
});
