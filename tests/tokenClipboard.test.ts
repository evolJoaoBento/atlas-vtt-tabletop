import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyTokens, cutTokens, duplicateTokens, holdsTokenClipboard, pasteTokens } from '../src/board/tokenClipboard';
import { TokenWriter } from '../src/board/tokenWriter';
import { fakeAtlas } from './fakeAtlasStore';

const GRID = { type: 'square', size: 50, offsetX: 0, offsetY: 0, snapToGrid: true };

/** An Atlas store with the actions copy, cut and paste reach for, as Atlas 0.15's map objects slice does them. */
function atlasWithClipboard(extra: Record<string, unknown> = {}) {
  const tokens: Record<string, Record<string, unknown>> = {
    a: { id: 'a', kind: 'character', name: 'Aria', imagePath: 'a.png', x: 125, y: 125, size: 1, instanceNumber: 1 },
    b: { id: 'b', kind: 'character', name: 'Bo', imagePath: 'b.png', x: 225, y: 125, size: 1, instanceNumber: 1 },
    c: { id: 'c', kind: 'character', name: 'Cy', imagePath: 'c.png', x: 475, y: 475, size: 1, instanceNumber: 1 },
  };
  let next = 0;
  const atlas = fakeAtlas('m.atlasmap', tokens, {
    grid: GRID,
    insertMapObjects: (content: { tokens: Array<Record<string, unknown>> }): string[] => {
      atlas.calls.push(['insertMapObjects', content]);
      return content.tokens.map((token) => { const id = `tok_${++next}`; tokens[id] = { ...token, id }; return id; });
    },
    removeMapObjects: (ids: string[]): void => { atlas.calls.push(['removeMapObjects', ids]); for (const id of ids) delete tokens[id]; },
    ...extra,
  });
  return { atlas, tokens, writer: new TokenWriter(atlas.deps()) };
}

test('paste with nothing copied does nothing', async () => {
  const { atlas, writer } = atlasWithClipboard();
  assert.equal(holdsTokenClipboard(), false);
  assert.deepEqual(await pasteTokens(writer, 'm.atlasmap', { x: 0, y: 0 }), []);
  assert.deepEqual(atlas.calls, []);
});

test('copy puts the tokens on the clipboard without touching the map', async () => {
  const { atlas, writer } = atlasWithClipboard();
  assert.equal(await copyTokens(writer, 'm.atlasmap', ['a', 'b']), true);
  assert.equal(holdsTokenClipboard(), true);
  assert.deepEqual(atlas.calls, []);
});

test('copy with nothing copyable (no ids, an id that is no token) does nothing', async () => {
  const { writer } = atlasWithClipboard();
  assert.equal(await copyTokens(writer, 'm.atlasmap', []), false);
  assert.equal(await copyTokens(writer, 'm.atlasmap', ['nope']), false);
});

test('paste puts the copies centred on the target, snapped to the grid, as new tokens', async () => {
  const { atlas, tokens, writer } = atlasWithClipboard();
  await copyTokens(writer, 'm.atlasmap', ['a', 'b']);
  const ids = await pasteTokens(writer, 'm.atlasmap', { x: 1025, y: 1025 });
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => !['a', 'b', 'c'].includes(id)), 'fresh ids');
  // The two stood at 125 and 225 (centre 175); centred on 1025 the first lands at 975, the second at 1075.
  assert.deepEqual(ids.map((id) => [tokens[id]!.x, tokens[id]!.y]), [[975, 1025], [1075, 1025]]);
  assert.equal(atlas.calls.filter(([name]) => name === 'insertMapObjects').length, 1, 'one write, so one undo step');
  assert.equal(Object.keys(tokens).length, 5, 'the originals stay');
});

test('a second paste at the same place fans out one cell instead of stacking', async () => {
  const { tokens, writer } = atlasWithClipboard();
  await copyTokens(writer, 'm.atlasmap', ['a']);
  const first = await pasteTokens(writer, 'm.atlasmap', { x: 1025, y: 1025 });
  const second = await pasteTokens(writer, 'm.atlasmap', { x: 1025, y: 1025 });
  const at = (id: string): number[] => [tokens[id]!.x as number, tokens[id]!.y as number];
  assert.notDeepEqual(at(first[0]!), at(second[0]!));
});

test('cut copies, then removes the tokens in one write; paste brings them back', async () => {
  const { atlas, tokens, writer } = atlasWithClipboard();
  assert.equal(await cutTokens(writer, 'm.atlasmap', ['a']), true);
  assert.deepEqual(atlas.calls, [['removeMapObjects', ['a']]]);
  assert.equal(tokens.a, undefined);
  const ids = await pasteTokens(writer, 'm.atlasmap', { x: 625, y: 625 });
  assert.equal(ids.length, 1);
  assert.equal(tokens[ids[0]!]!.name, 'Aria');
});

test('the clipboard is shared between maps', async () => {
  const one = atlasWithClipboard();
  await copyTokens(one.writer, 'm.atlasmap', ['c']);
  const other = atlasWithClipboard();
  const ids = await pasteTokens(other.writer, 'm.atlasmap', { x: 325, y: 325 });
  assert.equal(ids.length, 1);
});

test('an Atlas without the paste action refuses it with a reason, and writes nothing', async () => {
  const { atlas, writer } = atlasWithClipboard({ insertMapObjects: undefined });
  await copyTokens(writer, 'm.atlasmap', ['a']);
  await assert.rejects(pasteTokens(writer, 'm.atlasmap', { x: 0, y: 0 }), /paste/);
  assert.deepEqual(atlas.calls, []);
});

test('an Atlas without the remove action refuses a cut before copying anything', async () => {
  const { writer } = atlasWithClipboard({ removeMapObjects: undefined });
  await assert.rejects(cutTokens(writer, 'm.atlasmap', ['a']), /cut/);
});

test('duplicate steps the copies one diagonal cell aside, with fresh ids, in one write, and leaves the clipboard alone', async () => {
  const { atlas, tokens, writer } = atlasWithClipboard();
  const ids = await duplicateTokens(writer, 'm.atlasmap', ['a', 'b']);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => !['a', 'b', 'c'].includes(id)), 'fresh ids');
  assert.deepEqual(ids.map((id) => [tokens[id]!.x, tokens[id]!.y]), [[175, 175], [275, 175]]);
  assert.equal(atlas.calls.filter(([name]) => name === 'insertMapObjects').length, 1, 'one write, so one undo step');
  assert.equal(Object.keys(tokens).length, 5, 'the originals stay');
});

test('duplicating again fans out instead of stacking', async () => {
  const { tokens, writer } = atlasWithClipboard();
  const once = await duplicateTokens(writer, 'm.atlasmap', ['a']);
  const twice = await duplicateTokens(writer, 'm.atlasmap', ['a']);
  assert.notDeepEqual([tokens[once[0]!]!.x, tokens[once[0]!]!.y], [tokens[twice[0]!]!.x, tokens[twice[0]!]!.y]);
});

test('duplicate ignores ids that are no token, and does nothing with none', async () => {
  const { atlas, writer } = atlasWithClipboard();
  assert.deepEqual(await duplicateTokens(writer, 'm.atlasmap', ['nope']), []);
  assert.deepEqual(await duplicateTokens(writer, 'm.atlasmap', []), []);
  assert.deepEqual(atlas.calls, []);
});

test("duplicate uses Atlas's own action when the store has one", async () => {
  const seen: string[][] = [];
  const { atlas, writer } = atlasWithClipboard({ duplicateMapObjects: (ids: string[]): string[] => { seen.push(ids); return ['n1']; } });
  assert.deepEqual(await duplicateTokens(writer, 'm.atlasmap', ['a', 'zzz']), ['n1']);
  assert.deepEqual(seen, [['a']]);
  assert.deepEqual(atlas.calls, []);
});

test('an Atlas with neither duplicate nor insert action refuses with a reason', async () => {
  const { atlas, writer } = atlasWithClipboard({ insertMapObjects: undefined });
  await assert.rejects(duplicateTokens(writer, 'm.atlasmap', ['a']), /duplicate/);
  assert.deepEqual(atlas.calls, []);
});
