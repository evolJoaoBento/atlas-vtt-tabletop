import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compareIds, extractAtlasIds } from '../scripts/atlasIds.mjs';
import { MIN_ATLAS_VERSION } from '../packages/atlas-host/src/index';
import { ATLAS_ASSET_TABS, ATLAS_CHECKED_VERSION, ATLAS_PALETTE, ATLAS_TOOLBAR, PARITY_STATUSES } from '../src/parity';

const fixture = readFileSync('tests/fixtures/atlas-0.14.0-ids.txt', 'utf8');

test('extracts Atlas 0.14.0 ids', () => {
  const ids = extractAtlasIds(fixture);
  assert.deepEqual(ids.toolbar, ATLAS_TOOLBAR.map((row) => row.id));
  assert.deepEqual(ids.palette, ATLAS_PALETTE.filter((row) => !row.addedIn).map((row) => row.id));
  assert.deepEqual(ids.assetTabs, ['scenes', 'maps', 'encounters', 'tokens', 'party']);
});

test('the toolbar table holds Atlas 0.14.0 catalog in order', () => {
  assert.deepEqual(ATLAS_TOOLBAR.map((row) => row.id),
    ['move', 'fog', 'draw', 'text', 'measure', 'wall', 'pin', 'audio', 'dice', 'loot', 'assets', 'palette', 'undo']);
  const status = Object.fromEntries(ATLAS_TOOLBAR.map((row) => [row.id, row.status]));
  assert.equal(status.loot, 'native');
  assert.equal(status.assets, 'native');
  assert.equal(status.palette, 'native');
  assert.equal(status.fog, 'native');
  // The Atlas the tables were checked against is the Atlas Tabletop needs.
  // Tabletop supports Atlas from the floor up; the tables are checked against the newest one it knows (0.19.0).
  assert.equal(ATLAS_CHECKED_VERSION, '0.19.0');
  assert.ok(MIN_ATLAS_VERSION <= ATLAS_CHECKED_VERSION);
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

test('extraction reads the Atlas 0.18 template-literal catalogs, and single quotes, as it reads double quotes', () => {
  const build = (q: string): string => [
    `{id:${q}loot${q},label:${q}Random tables${q},hotkey:${q}lootRoller${q},dmOnly:!0,hideable:!0}`,
    `{id:${q}move-tool${q},icon:(0,q.jsx)(Pan,{}),label:z(${q}palette.moveTool${q})}`,
    `{id:${q}position-floor${q},icon:x}`, `{id:${q}table-mode${q},icon:y}`, 'palette.tab.all',
    `{id:${q}customize-toolbar${q},icon:z}`,
    `var rU=[${q}scenes${q},${q}maps${q},${q}party${q}],LHn={scenes:z(${q}am.tab.scenes${q}),maps:1}`,
  ].join(';');
  for (const q of ['"', "'", '`']) {
    const ids = extractAtlasIds(build(q));
    assert.deepEqual(ids.toolbar, ['loot']);
    assert.deepEqual(ids.palette, ['move-tool', 'position-floor', 'table-mode', 'customize-toolbar']);
    assert.deepEqual(ids.assetTabs, ['scenes', 'maps', 'party']);
  }
  // A long bundle without the catalogs is read at once (no backtracking blow-up).
  const started = Date.now();
  extractAtlasIds(`{id:\`a\`,label:${'x,'.repeat(200000)}`);
  assert.ok(Date.now() - started < 2000);
});
