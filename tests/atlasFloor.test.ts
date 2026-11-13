import assert from 'node:assert/strict';
import { test } from 'node:test';
import { floorState, NO_ATLAS_TEXT, sessionPairs } from '../src/atlasFloorGate';
import { FUSION_PROTOCOL } from '../src/connectWire';

test('Atlas 0.15 or later: the API is published and boards draw', () => {
  assert.deepEqual(floorState({ state: 'ok', version: '0.15.0' }), { publish: true, boardText: null, notice: null, follow: true });
});

test('an older Atlas: nothing is published, and the notice and the board both say what is needed', () => {
  const text = 'Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)';
  assert.deepEqual(floorState({ state: 'old', version: '0.14.0' }), { publish: false, boardText: text, notice: text, follow: false }, 'an old Atlas is never asked to switch map');
  assert.equal(floorState({ state: 'old', version: 'unknown' }).notice, 'Tabletop needs Atlas VTT 0.15 or later (found unknown)');
});

test('no Atlas: boards open to look at, with no notice', () => {
  assert.deepEqual(floorState({ state: 'missing' }), { publish: true, boardText: 'Atlas VTT is not enabled. View only.', notice: null, follow: true }, 'the host answers no-atlas, which the bar shows');
  assert.equal(NO_ATLAS_TEXT, 'Atlas VTT is not enabled. View only.');
});

test("a session is taken only from a Connect of Tabletop's own fusion step", () => {
  assert.equal(sessionPairs({ fusion: FUSION_PROTOCOL }), true);
  assert.equal(sessionPairs({}), false);
  assert.equal(sessionPairs({ fusion: FUSION_PROTOCOL + 1 }), false);
  assert.equal(sessionPairs({ fusion: '1' }), false);
  assert.equal(sessionPairs(null), false);
});
