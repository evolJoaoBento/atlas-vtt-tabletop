import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostBar, mapName, type HostBarInput } from '../src/board/hostBar';

const CELLAR = 'maps/Cellar.atlasmap';
const COVE = 'maps/Cove.atlasmap';
const input = (over: Partial<HostBarInput>): HostBarInput => ({ mapPath: CELLAR, status: { kind: 'none' }, closedByUser: false, failed: null, nameOf: mapName, ...over });

test('no bar while Atlas holds the board\'s map, or is loading it (edits wait)', () => {
  assert.equal(hostBar(input({ status: { kind: 'held', mapPath: CELLAR } })), null);
  assert.equal(hostBar(input({ status: { kind: 'loading', mapPath: CELLAR } })), null);
  // Held again after the tab was closed, or after a try that timed out: nothing to say.
  assert.equal(hostBar(input({ status: { kind: 'held', mapPath: CELLAR }, closedByUser: true, failed: 'timeout' })), null);
});

test('Atlas holds another map: view only, with Edit here', () => {
  assert.deepEqual(hostBar(input({ status: { kind: 'held', mapPath: COVE } })), { text: 'View only. Atlas holds Cove.', action: 'edit-here' });
  assert.deepEqual(hostBar(input({ status: { kind: 'loading', mapPath: COVE } })), { text: 'View only. Atlas holds Cove.', action: 'edit-here' });
});

test('the user closed Atlas\'s tab: editing is paused, with Reopen', () => {
  assert.deepEqual(hostBar(input({ closedByUser: true })), { text: 'Atlas closed this map. Editing is paused.', action: 'reopen' });
});

test('Atlas did not load the map in time: view only, with a retry', () => {
  assert.deepEqual(hostBar(input({ failed: 'timeout' })), { text: 'Atlas did not open this map. View only.', action: 'retry' });
  assert.deepEqual(hostBar(input({ status: { kind: 'loading', mapPath: null }, failed: 'timeout' })), { text: 'Atlas did not open this map. View only.', action: 'retry' });
});

test('Atlas is not enabled: view only, and nothing to click', () => {
  assert.deepEqual(hostBar(input({ failed: 'no-atlas' })), { text: 'Atlas VTT is not enabled. View only.', action: null });
});

test('no Atlas tab yet and nothing failed: no bar, the board is about to open one', () => {
  assert.equal(hostBar(input({})), null);
});

test('a map is named without its folder and extension', () => {
  assert.equal(mapName('atlas-vtt/collections/Main/scenes/The Cove.atlasmap'), 'The Cove');
  assert.equal(mapName('Cove'), 'Cove');
});
