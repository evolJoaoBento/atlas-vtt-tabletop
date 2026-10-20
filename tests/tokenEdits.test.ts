import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addToInitiative, conditionChange, conditionStep, initiativeEntryFor, removeFromInitiative, resetChange } from '../src/board/tokenEdits';
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

test('a token joins the initiative as Atlas adds it: last, active when it is the first', () => {
  const entry = initiativeEntryFor({ id: 't', kind: 'character', name: 'Kestrel', imagePath: 'k.png', statblockPath: 'K.md' });
  assert.deepEqual(entry, { tokenId: 't', name: 'Kestrel', initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: 'k.png', isNPC: true, statblockPath: 'K.md' });
  assert.deepEqual(initiativeEntryFor({ id: 'p', kind: 'token', imagePath: 'p.png' }).name, 'Token');
  const first = addToInitiative(undefined, entry, 'init_1');
  assert.deepEqual(first.entries, [{ ...entry, id: 'init_1', order: 0, isActive: true }]);
  assert.equal(first.currentIndex, -1);
  assert.deepEqual(first.config, { autoSort: true });
  const second = addToInitiative(first, { ...entry, tokenId: 'u' }, 'init_2');
  assert.deepEqual(second.entries.map((e) => [e.id, e.order, e.isActive]), [['init_1', 0, true], ['init_2', 1, false]]);
  // Already in it: nothing changes.
  assert.equal(addToInitiative(second, entry, 'init_3'), second);
});

test('a token leaves the initiative as Atlas removes it: orders closed up, the turn passed on', () => {
  const state = {
    entries: [
      { id: 'a', tokenId: 'ta', order: 0, isActive: false },
      { id: 'b', tokenId: 'tb', order: 1, isActive: true },
      { id: 'c', tokenId: 'tc', order: 2, isActive: false },
    ],
    currentIndex: 1, round: 2, isActive: true, config: { autoSort: true },
  };
  const out = removeFromInitiative(state, 'tb');
  assert.deepEqual(out.entries.map((e) => [e.id, e.order, e.isActive]), [['a', 0, false], ['c', 1, true]]);
  assert.equal(out.currentIndex, 1);
  assert.equal(removeFromInitiative(state, 'nobody'), state);
});
