import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hitSound, rollGain, wireDiceSounds } from '../src/sound/diceSounds';

test('a hit below speed 0.4 makes no sound; gain rises from 0.15 at 0.4 to 1 at 8 and stays', () => {
  assert.equal(hitSound('d6', 0.39), null);
  assert.ok(Math.abs((hitSound('d10', 0.4) as { gain: number }).gain - 0.15) < 1e-9);
  assert.ok(Math.abs((hitSound('d10', 8) as { gain: number }).gain - 1) < 1e-9);
  assert.equal((hitSound('d10', 20) as { gain: number }).gain, 1);
  const mid = (hitSound('d10', 4.2) as { gain: number }).gain;
  assert.ok(Math.abs(mid - 0.575) < 1e-9, `${mid}`);
});

test('each die has its own pitch', () => {
  const rates = { d4: 1.15, d6: 1.05, d8: 1.08, d10: 1.0, d12: 0.96, d20: 0.92, d100: 1.0 };
  for (const [type, rate] of Object.entries(rates)) assert.equal((hitSound(type, 3) as { rate: number }).rate, rate, type);
  assert.equal((hitSound('dF', 3) as { rate: number }).rate, 1);
});

test('the rolling layer: silent below 0.5, 0.35 from 6, linear between', () => {
  assert.equal(rollGain(0), 0);
  assert.equal(rollGain(0.49), 0);
  assert.equal(rollGain(6), 0.35);
  assert.equal(rollGain(30), 0.35);
  assert.ok(Math.abs(rollGain(3.25) - 0.175) < 1e-9, `${rollGain(3.25)}`);
});

test('wired to a table: hits are thinned to 6 in 50 ms on the injected clock, rolling follows the fastest die, rest stops the loop', () => {
  const plays: Array<[string, unknown]> = [];
  const loops: Array<[string, string | null, number]> = [];
  let now = 0;
  const table = {
    onHit: (() => {}) as (type: string, speed: number, at: { x: number; y: number; z: number }) => void,
    onRolling: (() => {}) as (fastest: number) => void,
    onCaught: (() => {}) as (at: { x: number; y: number; z: number }) => void,
  };
  wireDiceSounds(table, { sound: (id, options) => plays.push([id, options]), soundLoop: (key, id, gain) => loops.push([key, id, gain]) }, () => now);
  const at = { x: 1, y: 2, z: 3 };
  for (let i = 0; i < 10; i++) table.onHit('d6', 5, at);
  assert.equal(plays.length, 6);
  assert.equal(plays[0][0], 'dice.hit');
  assert.deepEqual((plays[0][1] as { at: unknown }).at, at);
  table.onHit('d6', 0.1, at);
  now = 60;
  table.onHit('d6', 5, at);
  assert.equal(plays.length, 7, 'a quiet hit neither plays nor uses a slot; a later one plays');
  table.onRolling(6);
  assert.deepEqual(loops.at(-1), ['dice', 'dice.roll', 0.35]);
  table.onRolling(0);
  assert.deepEqual(loops.at(-1), ['dice', null, 0]);
  table.onCaught(at);
  assert.deepEqual(plays.at(-1), ['dice.caught', { at }]);
});
