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
  session: RollSession | null = null;
  rolls = 0;
  thrown: number[] = [];
  clears = 0;
  throwRoll(session: RollSession): void { this.session = session; this.rolls++; }
  throwDie(id: number): void { this.thrown.push(id); }
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
  dice.start({ dice: { d6: 2 }, modifier: 1 }, FLICK);
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
  dice.start({ dice: { d20: 1 }, modifier: 0 }, FLICK);
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

test('clicking a die with nothing to throw throws nothing', () => {
  const { dice, table } = controller();
  dice.start({ dice: { d6: 2 }, modifier: 0 }, FLICK);
  const [a, b] = table.ids();
  table.onSettled(a, face(4));
  dice.clickDie(a, FLICK);
  dice.clickDie(b, FLICK);
  dice.clickDie(999, FLICK);
  assert.deepEqual(table.thrown, [], 'a settled die keeps its number; a rolling die is in the air');
});

test('throwPending throws every caught die once', () => {
  const { dice, table, published } = controller();
  dice.start({ dice: { d8: 2 }, modifier: 0 }, FLICK);
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
  dice.start({ dice: { d6: 1 }, modifier: 0 }, FLICK);
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
  dice.start({ dice: { d6: 1 }, modifier: 0 }, FLICK);
  const [d6] = table.ids();
  dice.dispose();
  assert.equal(table.clears, 1);
  table.onSettled(d6, face(2));
  assert.equal(published.length, 0);
});

test('explosion prompt then publish with the extra die', () => {
  const { dice, table, published, prompts } = controller(explodeAll);
  dice.start({ dice: { d6: 1 }, modifier: 0 }, FLICK);
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

