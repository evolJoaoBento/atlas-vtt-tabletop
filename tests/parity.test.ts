import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareIds, extractAtlasIds } from '../scripts/atlasIds.mjs';
import { ATLAS_ASSET_TABS, ATLAS_CHECKED_VERSION, ATLAS_PALETTE, ATLAS_TOOLBAR, PARITY_STATUSES } from '../src/parity';

const fixture = readFileSync('tests/fixtures/atlas-0.14.0-ids.txt', 'utf8');

test('extracts Atlas 0.14.0 ids', () => {
  const ids = extractAtlasIds(fixture);
  assert.deepEqual(ids.toolbar, ATLAS_TOOLBAR.map((row) => row.id));
  assert.deepEqual(ids.palette, ATLAS_PALETTE.map((row) => row.id));
  assert.deepEqual(ids.assetTabs, ['scenes', 'maps', 'encounters', 'tokens', 'party']);
});

test('the toolbar table holds Atlas 0.14.0 catalog in order', () => {
  assert.deepEqual(ATLAS_TOOLBAR.map((row) => row.id),
    ['move', 'fog', 'draw', 'text', 'measure', 'wall', 'pin', 'audio', 'dice', 'loot', 'assets', 'palette', 'undo']);
  const status = Object.fromEntries(ATLAS_TOOLBAR.map((row) => [row.id, row.status]));
  assert.equal(status.loot, 'native');
  assert.equal(status.assets, 'native');
  assert.equal(status.palette, 'native');
  assert.equal(status.fog, 'not-yet');
  assert.equal(ATLAS_CHECKED_VERSION, '0.14.0');
});

test('compareIds reports new and dropped ids', () => {
  assert.deepEqual(compareIds(['a', 'b', 'new'], ['a', 'b', 'old']), { unlisted: ['new'], gone: ['old'] });
  assert.deepEqual(compareIds(['a'], ['a']), { unlisted: [], gone: [] });
});

test('extraction finds nothing in a build without the catalogs', () => {
  assert.deepEqual(extractAtlasIds('var x = 1;'), { toolbar: [], palette: [], assetTabs: [] });
});

test('every row has a note and a known status', () => {
  for (const row of [...ATLAS_TOOLBAR, ...ATLAS_PALETTE, ...ATLAS_ASSET_TABS]) {
    assert.ok(PARITY_STATUSES.includes(row.status), `${row.id}: ${row.status}`);
    assert.ok(row.note.length > 0, `${row.id} has no note`);
  }
});
