import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionChange, conditionStep, initiativeEntryFor, resetChange } from '../src/board/tokenEdits';
import { HP_RESOURCE, STRESS_RESOURCE, restedResources } from '../src/board/resources';

test('a condition is added at the end, or taken off with its number; the last one leaves no lists behind', () => {
  assert.deepEqual(conditionChange({ conditions: ['a'] }, 'b', true), { conditions: ['a', 'b'] });
  assert.deepEqual(conditionChange({ conditions: ['a'] }, 'a', true), null);
  assert.deepEqual(conditionChange({ conditions: ['a', 'b'], conditionValues: { b: 3 } }, 'b', false), { conditions: ['a'], conditionValues: undefined });
  assert.deepEqual(conditionChange({ conditions: ['a'] }, 'a', false), { conditions: undefined, conditionValues: undefined });
  assert.deepEqual(conditionChange({}, 'a', false), null);
});

test('a valued condition steps as Atlas steps it: gained at the step, lost at 0', () => {
  // Not held: − does nothing in Atlas's menu (it is disabled); + gains it at 1.
  assert.deepEqual(conditionStep({}, 'ex', 1), { conditions: ['ex'], conditionValues: { ex: 1 } });
  // Held without a number counts as 1.
  assert.deepEqual(conditionStep({ conditions: ['ex'] }, 'ex', 1), { conditions: ['ex'], conditionValues: { ex: 2 } });
  assert.deepEqual(conditionStep({ conditions: ['ex', 'p'], conditionValues: { ex: 2 } }, 'ex', -1), { conditions: ['ex', 'p'], conditionValues: { ex: 1 } });
  assert.deepEqual(conditionStep({ conditions: ['ex'], conditionValues: { ex: 1 } }, 'ex', -1), { conditions: undefined, conditionValues: undefined });
});

test('Reset restores every defined resource and clears every condition', () => {
  const defs = [HP_RESOURCE, STRESS_RESOURCE];
  const token = { resources: { hp: { current: 2, max: 9 }, stress: { current: 4, max: 6 }, other: { current: 1, max: 3 } }, conditions: ['a'], conditionValues: { a: 2 } };
  assert.deepEqual(restedResources(token, defs), { hp: { current: 9, max: 9 }, stress: { current: 0, max: 6 }, other: { current: 1, max: 3 } });
  assert.deepEqual(resetChange(token, defs), { resources: { hp: { current: 9, max: 9 }, stress: { current: 0, max: 6 }, other: { current: 1, max: 3 } }, conditions: undefined, conditionValues: undefined });
});

test("a token's entry is what Atlas's tracker adds for it (its store's addToInitiative places it)", () => {
  const entry = initiativeEntryFor({ id: 't', kind: 'character', name: 'Kestrel', imagePath: 'k.png', statblockPath: 'K.md' });
  assert.deepEqual(entry, { tokenId: 't', name: 'Kestrel', initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: 'k.png', isNPC: true, statblockPath: 'K.md' });
  assert.deepEqual(initiativeEntryFor({ id: 'p', kind: 'token', imagePath: 'p.png' }).name, 'Token');
});
