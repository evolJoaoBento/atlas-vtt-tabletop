import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyMeterEdit, parseMeterInput, stepMeterText } from '../src/board/meterEdit';

test('+n adds, -n subtracts, a bare number sets', () => {
  assert.equal(parseMeterInput('+5', 10), 15);
  assert.equal(parseMeterInput('-3', 10), 7);
  assert.equal(parseMeterInput('12', 10), 12);
  assert.equal(parseMeterInput(' 4 ', 10), 4);
});

test('anything else is rejected', () => {
  for (const text of ['', 'abc', '=5', '1.5', '+', '5-', '1e3']) assert.equal(parseMeterInput(text, 10), null, text);
});

test('max is read first, then current against the new max, clamped to 0..max', () => {
  assert.deepEqual(applyMeterEdit('-30', '27', { current: 20, max: 27 }), { current: 0, max: 27 });
  assert.deepEqual(applyMeterEdit('+30', '27', { current: 20, max: 27 }), { current: 27, max: 27 });
  assert.deepEqual(applyMeterEdit('20', '+5', { current: 20, max: 27 }), { current: 20, max: 32 });
  assert.deepEqual(applyMeterEdit('20', '10', { current: 20, max: 27 }), { current: 10, max: 10 });
});

test('a bad field or a max of 0 says which field is wrong', () => {
  assert.deepEqual(applyMeterEdit('x', '27', { current: 20, max: 27 }), { error: 'current' });
  assert.deepEqual(applyMeterEdit('20', '0', { current: 20, max: 27 }), { error: 'max' });
  assert.deepEqual(applyMeterEdit('20', 'nope', { current: 20, max: 27 }), { error: 'max' });
});

test('arrow keys step the number, never below 0', () => {
  assert.equal(stepMeterText('12', 1), '13');
  assert.equal(stepMeterText('12', -10), '2');
  assert.equal(stepMeterText('3', -10), '0');
  assert.equal(stepMeterText('', 1), '1');
});

test('arrow keys leave a relative edit alone, as Atlas does', () => {
  assert.equal(stepMeterText('-5', 1), '-5');
  assert.equal(stepMeterText('+3', -1), '+3');
});

test('a relative current applies to the value already held within the new max', () => {
  assert.deepEqual(applyMeterEdit('-5', '20', { current: 30, max: 40 }), { current: 15, max: 20 });
});
