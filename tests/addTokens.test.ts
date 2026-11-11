import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { TokenWriter, addTokensInText } from '../src/board/tokenWriter';

const MAP = readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8');
const tokensIn = (text: string) => JSON.parse(text).state.objects.tokens as Record<string, Record<string, unknown>>;

test('addTokensInText adds spawned tokens and keeps the rest of the file', () => {
  const text = addTokensInText(MAP, [{ id: 'tok_a', x: 70, y: 70, imagePath: 'art/goblin.png', size: 1 }]);
  const added = tokensIn(text).tok_a;
  assert.equal(added.x, 70);
  assert.equal(added.kind, 'token');
  assert.equal(added.imagePath, 'art/goblin.png');
  const after = JSON.parse(text);
  delete after.state.objects.tokens.tok_a;
  assert.deepEqual(after, JSON.parse(MAP));
});

test('copies of one art are numbered as Atlas numbers them', () => {
  const text = addTokensInText(MAP, [
    { id: 'tok_a', x: 0, y: 0, imagePath: 'art/goblin.png' },
    { id: 'tok_b', x: 70, y: 0, imagePath: 'art/goblin.png' },
  ]);
  const tokens = tokensIn(text);
  assert.notEqual(tokens.tok_a.instanceNumber, tokens.tok_b.instanceNumber);
});

test("addTokensNow goes through Atlas's store when Atlas holds the map (one undo step)", async () => {
  const calls: unknown[] = [];
  const view = {
    viewId: 'v',
    atlasStore: { getState: () => ({ mapPath: 'a.atlasmap', addTokens: (inputs: unknown[]) => { calls.push(inputs); return ['atlas1', 'atlas2']; } }), subscribe: () => () => {} },
  } as unknown as AtlasView;
  const writer = new TokenWriter({ views: () => [view], process: async () => { throw new Error('no file write'); } });
  const { ids, via, done } = writer.addTokensNow('a.atlasmap', [{ x: 0, y: 0, imagePath: 'a.png' }, { x: 70, y: 0, imagePath: 'a.png' }]);
  await done;
  assert.deepEqual(ids, ['atlas1', 'atlas2']);
  assert.equal(via, 'atlas');
  assert.equal(calls.length, 1);
});

test('addTokensNow writes the file without Atlas and gives the new ids at once', async () => {
  let text = MAP;
  const writer = new TokenWriter({ views: () => [], process: async (_path, edit) => { text = edit(text); } });
  const { ids, via, done } = writer.addTokensNow('a.atlasmap', [{ x: 0, y: 0, imagePath: 'a.png' }]);
  assert.equal(via, 'file');
  assert.equal(ids.length, 1);
  assert.match(ids[0]!, /^tok_/);
  await done;
  assert.ok(tokensIn(text)[ids[0]!]);
});
