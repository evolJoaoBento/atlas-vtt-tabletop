import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerDiceResult } from '../src/connectContract';
import type { FaceReading } from '../src/dice/kit/faces';
import { PlayerDice, type PlayerDiceDeps } from '../src/dice/playerDice';
import type { DiceRules } from '../src/dice/rollRules';
import type { RollSession } from '../src/dice/rollSession';
import type { Flick } from '../src/dice/throwInput';

const explodingD10: DiceRules = { defaultRoll: '1d10', crit: 'natural', explode: { dice: 'default', repeats: false, highFaces: 1, lowFaces: 0 } };
const FLICK: Flick = { dx: 0, dy: -200, ms: 100 };
const face = (value: number): FaceReading => ({ caught: false, face: value, confidence: 1 });
const CAUGHT: FaceReading = { caught: true, face: null, confidence: 0 };

/** A table that throws nothing: it records what it is asked, and the test settles the dice by hand. */
class FakeTable {
  busy = false;
  onSettled: (id: number, reading: FaceReading) => void = () => {};
  onLoosened: (id: number) => void = () => {};
  session: RollSession | null = null;
  thrown: number[] = [];
  clears = 0;
  disposed = false;
  placeRoll(session: RollSession): void { this.session = session; }
  placeMissing(): void {}
  throwDie(id: number): void { this.thrown.push(id); }
  remove(): void {}
  clear(): void { this.clears++; this.session = null; }
  ids(): number[] { return (this.session as RollSession).dice.map((state) => state.id); }
  idOf(die: string): number { return (this.session as RollSession).dice.find((state) => state.die === die)!.id; }
}

function playerDice(host: PlayerDiceDeps['host']) {
  const tables: FakeTable[] = [];
  const prompts: Array<{ text: string | null; notice: boolean; result: boolean }> = [];
  let outdated = false;
  const dice = new PlayerDice({
    host,
    makeTable: () => {
      const table = new FakeTable();
      tables.push(table);
      return { table, hold: () => {}, outdated: () => outdated, dispose: () => { table.disposed = true; } };
    },
    prompt: (text, kind) => { prompts.push({ text, notice: kind === 'notice', result: kind === 'result' }); },
  });
  return { dice, tables, prompts, outdate: () => { outdated = true; } };
}

function sender(rules: DiceRules | null = null, sent = true) {
  const results: PlayerDiceResult[] = [];
  return { results, host: { sendDiceResult: (result: PlayerDiceResult) => { results.push(result); return sent; }, diceRules: () => rules } };
}

test('without sendDiceResult there are no dice: throw returns false and makes no table', () => {
  const { dice, tables } = playerDice({ diceRules: () => explodingD10 });
  assert.equal(dice.throw({ dice: { d20: 1 }, modifier: 0 }), false);
  assert.equal(tables.length, 0);
});

test('a throw that settles sends one result: rolls, modifier, label and the sheet back unchanged', () => {
  const { host, results } = sender();
  const { dice, tables, prompts } = playerDice(host);
  const sheet = { tokenId: 'tok-1', roll: { ability: 'Longsword', formula: '1d20+5', nested: { a: [1, 2] } } };
  assert.equal(dice.throw({ dice: { d20: 1, d6: 1 }, modifier: 5, label: 'Longsword', sheet }), true);
  const d20 = tables[0].idOf('d20');
  const d6 = tables[0].idOf('d6');
  tables[0].onSettled(d20, face(12));
  assert.equal(results.length, 0, 'one die still rolling');
  tables[0].onSettled(d6, face(4));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { rolls: tables[0].ids().map((id) => (id === d20 ? { die: 'd20', value: 12, max: 20 } : { die: 'd6', value: 4, max: 6 })), modifier: 5, label: 'Longsword', sheet });
  assert.equal(results[0].sheet, sheet, 'the sheet is handed back as it came');
  assert.ok(prompts.at(-1)?.result && /Sent to the GM: 21/.test(prompts.at(-1)?.text ?? ''), 'what was sent stays on the line while the dice lie there');
});

test('the rules from diceRules apply: an exploding d10 asks for another die before sending', () => {
  const { host, results } = sender(explodingD10);
  const { dice, tables, prompts } = playerDice(host);
  dice.throw({ dice: { d10: 1 }, modifier: 0 });
  const table = tables[0];
  const [first] = table.ids();
  table.onSettled(first, face(10));
  assert.equal(results.length, 0, 'the explosion is still to throw');
  assert.match(prompts.at(-1)?.text ?? '', /d10 exploded/);
  dice.throwPending(FLICK);
  const extra = table.ids().find((id) => id !== first) as number;
  assert.deepEqual(table.thrown, [extra]);
  table.onSettled(extra, face(3));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].rolls, [{ die: 'd10', value: 10, max: 10 }, { die: 'd10', value: 3, max: 10, exploded: true }]);
});

test('no rules from the GM: the default rules, so a d20 on 20 does not explode', () => {
  const { host, results } = sender(null);
  const { dice, tables } = playerDice(host);
  dice.throw({ dice: { d20: 1 }, modifier: 1 });
  tables[0].onSettled(tables[0].ids()[0], face(20));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].rolls, [{ die: 'd20', value: 20, max: 20 }]);
});

test('a caught die is never sent: clicked, it is thrown again, and only its clean reading goes', () => {
  const { host, results } = sender();
  const { dice, tables, prompts } = playerDice(host);
  dice.throw({ dice: { d20: 1 }, modifier: 0 });
  const table = tables[0];
  const [d20] = table.ids();
  table.onSettled(d20, CAUGHT);
  assert.equal(results.length, 0);
  assert.equal(dice.waitsOn(d20), true);
  assert.match(prompts.at(-1)?.text ?? '', /d20/);
  const pickedUp = dice.pickUp(d20);
  assert.ok(pickedUp, 'a press on the caught die is the dice\'s');
  pickedUp.release(FLICK, false);
  assert.deepEqual(table.thrown, [d20]);
  table.onSettled(d20, face(7));
  assert.deepEqual(results.map((result) => result.rolls), [[{ die: 'd20', value: 7, max: 20 }]]);
});

test('a new throw while one settles replaces it, unsent; the new sheet goes with the new roll', () => {
  const { host, results } = sender();
  const { dice, tables } = playerDice(host);
  dice.throw({ dice: { d6: 1 }, modifier: 0, sheet: { tokenId: 'a', roll: 1 } });
  const table = tables[0];
  const old = table.session as RollSession;
  dice.throw({ dice: { d8: 1 }, modifier: 0, sheet: { tokenId: 'b', roll: 2 } });
  assert.equal(tables.length, 1, 'the same table');
  assert.notEqual(table.session, old, 'the new roll is thrown in its place');
  assert.equal(results.length, 0, 'the replaced roll is never sent');
  table.onSettled(table.idOf('d8'), face(5));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { rolls: [{ die: 'd8', value: 5, max: 8 }], modifier: 0, sheet: { tokenId: 'b', roll: 2 } });
});

test('a scene change clears the dice and sends nothing; so does dispose', () => {
  const { host, results } = sender();
  const { dice, tables } = playerDice(host);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  const table = tables[0];
  const [id] = table.ids();
  dice.sceneChanged();
  assert.equal(table.clears, 1);
  table.onSettled(id, face(2));
  assert.equal(results.length, 0);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  dice.dispose();
  assert.equal(table.disposed, true);
  assert.equal(dice.throw({ dice: { d6: 1 }, modifier: 0 }), false, 'a disposed board throws nothing');
  assert.equal(results.length, 0);
});

test('a roll Connect could not send shows a short notice, without a Throw, and is not sent again', () => {
  const { host, results } = sender(null, false);
  const { dice, tables, prompts } = playerDice(host);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  tables[0].onSettled(tables[0].ids()[0], face(3));
  assert.equal(results.length, 1);
  const last = prompts.at(-1);
  assert.ok(last && last.notice && /send/i.test(last.text ?? ''), JSON.stringify(last));
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  assert.equal(results.length, 1, 'no retry');
  assert.equal(prompts.at(-1)?.notice, false, 'the next roll takes the notice away');
});

test('a throw Connect should not ask for is refused: no dice, an unknown die, more than 20, a fraction', () => {
  const { host } = sender();
  const { dice, tables } = playerDice(host);
  assert.equal(dice.throw({ dice: {}, modifier: 3 }), false);
  assert.equal(dice.throw({ dice: { d7: 1 } as never, modifier: 0 }), false);
  assert.equal(dice.throw({ dice: { d6: 21 }, modifier: 0 }), false);
  assert.equal(dice.throw({ dice: { d6: 1.5 }, modifier: 0 }), false);
  assert.equal(dice.throw({ dice: { d6: 1 }, modifier: 1.5 }), false, 'a modifier is a whole number');
  assert.equal(tables.length, 0);
});

test('the pack or settings changed: the next throw makes a new table, the old one goes', () => {
  const { host } = sender();
  const { dice, tables, outdate } = playerDice(host);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  outdate();
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  assert.equal(tables.length, 2);
  assert.equal(tables[0].disposed, true);
});

test('a die in the air, or no roll at all, is not picked up; a die at rest is, and thrown again it is sent again', () => {
  const { host, results } = sender();
  const { dice, tables } = playerDice(host);
  assert.equal(dice.pickUp(0), null);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  const [id] = tables[0].ids();
  const grab = dice.pickUp(id);
  assert.ok(grab, 'a die laid on the table is picked up');
  grab.release(FLICK, false);
  assert.equal(dice.pickUp(id), null, 'in the air');
  tables[0].onSettled(id, face(4));
  assert.equal(results.length, 1);
  dice.pickUp(id)?.release(FLICK, false);
  tables[0].onSettled(id, face(6));
  assert.equal(results.length, 2);
  assert.equal(results[1].rolls[0].value, 6);
});

/** A caught die picked up, then something happens before it is let go: the new roll's die with the same id stays put. */
function pickedUpThen(happen: (dice: PlayerDice, outdate: () => void) => void) {
  const { host, results } = sender();
  const { dice, tables, outdate } = playerDice(host);
  dice.throw({ dice: { d20: 1 }, modifier: 0 });
  const [id] = tables[0].ids();
  tables[0].onSettled(id, CAUGHT);
  const release = dice.pickUp(id);
  assert.ok(release);
  happen(dice, outdate);
  const table = tables.at(-1) as FakeTable;
  // The roll now on the table has a die with the old id, caught too: the old press must not throw it.
  if (table.session) table.onSettled(table.ids()[0], CAUGHT);
  const thrownBefore = tables.map((t) => t.thrown.length);
  release.release(FLICK, false);
  assert.deepEqual(tables.map((t) => t.thrown.length), thrownBefore, 'the old press throws nothing');
  assert.equal(results.length, 0);
}

test('a press that spans a new throw from Connect throws nothing into the new roll', () => {
  pickedUpThen((dice) => { dice.throw({ dice: { d20: 1 }, modifier: 0 }); });
});

test('a press that spans a scene change throws nothing', () => {
  pickedUpThen((dice) => { dice.sceneChanged(); dice.throw({ dice: { d20: 1 }, modifier: 0 }); });
});

test('a press that spans a new table (the pack or settings changed) throws nothing', () => {
  pickedUpThen((dice, outdate) => { outdate(); dice.throw({ dice: { d20: 1 }, modifier: 0 }); });
});

test('the notice of an unsent roll goes before a new table is made: it never shows again', () => {
  const { host } = sender(null, false);
  const { dice, tables, prompts, outdate } = playerDice(host);
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  tables[0].onSettled(tables[0].ids()[0], face(3));
  assert.equal(prompts.at(-1)?.notice, true);
  const before = prompts.length;
  outdate();
  dice.throw({ dice: { d6: 1 }, modifier: 0 });
  assert.equal(tables.length, 2);
  assert.deepEqual(prompts.slice(before).filter((prompt) => prompt.notice), []);
  assert.match(prompts.at(-1)?.text ?? '', /Drag a die/);
});
