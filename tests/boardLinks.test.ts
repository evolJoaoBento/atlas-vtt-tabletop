import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardLink, latestSnapshot, parseBoardBlock, readBoardLink, snapshotPath } from '../src/boardLinks';

test('a board link names the vault and the map, and reads back to the map', () => {
  const link = boardLink('My Vault', 'Maps/Cave & Lair.atlasmap');
  assert.equal(link, 'obsidian://tabletop-board?vault=My%20Vault&map=Maps%2FCave%20%26%20Lair.atlasmap');
  const params = Object.fromEntries(new URL(link).searchParams);
  assert.equal(readBoardLink(params), 'Maps/Cave & Lair.atlasmap');
});

test('a link naming no Atlas map, or reaching out of the vault, opens nothing', () => {
  assert.equal(readBoardLink({}), null);
  assert.equal(readBoardLink({ map: 'Notes/Plan.md' }), null);
  assert.equal(readBoardLink({ map: '../secret.atlasmap' }), null);
  assert.equal(readBoardLink({ map: 'a/../../b.atlasmap' }), null);
  assert.equal(readBoardLink({ map: '  Maps/Cave.ATLASMAP ' }), 'Maps/Cave.ATLASMAP');
});

test('a tabletop block takes a path, a link or a link with a caption, and nothing else', () => {
  assert.deepEqual(parseBoardBlock('Maps/Cave.atlasmap'), { map: 'Maps/Cave.atlasmap', caption: null });
  assert.deepEqual(parseBoardBlock('\n  [[Maps/Cave.atlasmap]]\n'), { map: 'Maps/Cave.atlasmap', caption: null });
  assert.deepEqual(parseBoardBlock('![[Cave.atlasmap|The goblin cave]]'), { map: 'Cave.atlasmap', caption: 'The goblin cave' });
  assert.equal(parseBoardBlock(''), null);
  assert.equal(parseBoardBlock('Notes/Plan.md'), null);
  assert.equal(parseBoardBlock('[[Plan]]'), null);
});

test('snapshots are stamped so the newest sorts last, in the snapshots folder', () => {
  const early = snapshotPath('Tabletop snapshots', 'Maps/Cave.atlasmap', new Date(2026, 9, 30, 9, 5, 7));
  const late = snapshotPath('/Tabletop snapshots/', 'Maps/Cave.atlasmap', new Date(2026, 9, 30, 14, 30, 5));
  assert.equal(early, 'Tabletop snapshots/Cave 2026-10-30 090507.png');
  assert.equal(late, 'Tabletop snapshots/Cave 2026-10-30 143005.png');
  assert.equal(snapshotPath('', 'Cave.atlasmap', new Date(2026, 0, 2, 3, 4, 5)), 'Cave 2026-01-02 030405.png');
  const files = [early, late, 'Tabletop snapshots/Cave notes.png', 'Tabletop snapshots/Cavern 2026-10-31 000000.png', 'Other/Cave 2027-01-01 000000.png'];
  assert.equal(latestSnapshot(files, 'Tabletop snapshots', 'Maps/Cave.atlasmap'), late);
  assert.equal(latestSnapshot([], 'Tabletop snapshots', 'Maps/Cave.atlasmap'), null);
});
