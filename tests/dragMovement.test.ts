import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMovementRules } from '../packages/atlas-shared/src/index';
import { rulerLook } from '../src/board/dragMovement';
import type { Measurement } from '../src/board/measure';

const feet: Measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [] } as unknown as Measurement;
const rules = parseMovementRules({ steps: [{ name: 'Move', multiple: 1, color: '#22c55e' }, { name: 'Dash', multiple: 2, color: '#eab308' }], countPerTurn: false })!;

test("a drag reads against the token's speed in its step's colour, as Atlas's drag ruler words it", () => {
  assert.deepEqual(rulerLook(4, 30, rules, feet), { label: '20 / 30ft', color: '#22c55e' });
  assert.deepEqual(rulerLook(8, 30, rules, feet), { label: '40 / 60ft', color: '#eab308' });
  assert.deepEqual(rulerLook(13, 30, rules, feet), { label: '65 / 60ft', color: 'beyond' });
});

test('a drag reads as a plain distance without a speed, without steps, or with rules that are none', () => {
  assert.deepEqual(rulerLook(4, null, rules, feet), { label: '20ft', color: null });
  assert.deepEqual(rulerLook(4, 30, undefined, feet), { label: '20ft', color: null });
  assert.deepEqual(rulerLook(4, 30, parseMovementRules({ steps: [{ name: 'Move', multiple: 0, color: 'red' }] }), feet), { label: '20ft', color: null });
});
