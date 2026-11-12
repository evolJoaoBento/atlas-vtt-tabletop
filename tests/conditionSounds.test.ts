import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionSound } from '../src/sound/conditionSounds';

test('English names, trimmed, any case, ignoring a trailing number', () => {
  assert.equal(conditionSound('Prone'), 'condition.prone');
  assert.equal(conditionSound(' poisoned 2 '), 'condition.poisoned');
  assert.equal(conditionSound('EXHAUSTION3'), 'condition.exhaustion');
});

test('Portuguese and Spanish names', () => {
  assert.equal(conditionSound('Envenenado'), 'condition.poisoned');
  assert.equal(conditionSound('Caído'), 'condition.prone');
  assert.equal(conditionSound('enfeitiçado'), 'condition.charmed');
  assert.equal(conditionSound('Invisível'), 'condition.invisible');
  assert.equal(conditionSound('apresado'), 'condition.restrained');
  assert.equal(conditionSound('Agotamiento'), 'condition.exhaustion');
});

test('anything else gets the generic sound', () => {
  assert.equal(conditionSound('Hexed'), 'condition.applied');
  assert.equal(conditionSound(''), 'condition.applied');
});
