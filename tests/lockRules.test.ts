import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inputAllowed, type CinematicRole, type LockInput } from '../src/cutscene/lockRules';

const INPUTS: LockInput[] = ['camera', 'token-drag', 'tool', 'eyes', 'ar', 'token-info', 'dice'];
const allowed = (role: CinematicRole): LockInput[] => INPUTS.filter((input) => inputAllowed(role, input));

test('a locked player may only look at token info and roll dice', () => {
  assert.deepEqual(allowed('locked'), ['token-info', 'dice']);
});

test('a running or previewing GM has no camera, eyes or AR, but still drags tokens', () => {
  const expected: LockInput[] = ['token-drag', 'tool', 'token-info', 'dice'];
  assert.deepEqual(allowed('running'), expected);
  assert.deepEqual(allowed('previewing'), expected);
});

test('authoring has the free camera but no eyes or AR', () => {
  assert.deepEqual(allowed('authoring'), ['camera', 'token-drag', 'tool', 'token-info', 'dice']);
});

test('live and none allow everything', () => {
  assert.deepEqual(allowed('live'), INPUTS);
  assert.deepEqual(allowed('none'), INPUTS);
});
