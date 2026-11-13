import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { fakeAtlas } from './fakeAtlasStore';

test("addTokensNow goes through Atlas's store when Atlas holds the map (one undo step)", async () => {
  const atlas = fakeAtlas('a.atlasmap');
  const writer = new TokenWriter(atlas.deps());
  const { ids, done } = writer.addTokensNow('a.atlasmap', [{ x: 0, y: 0, imagePath: 'a.png' }, { x: 70, y: 0, imagePath: 'a.png' }]);
  await done;
  assert.deepEqual(ids, ['atlas1', 'atlas2']);
  assert.equal(atlas.calls.filter(([name]) => name === 'addTokens').length, 1);
});

test('addTokensNow gives the new ids at once while Atlas comes to the map, and hands them to its store', async () => {
  const atlas = fakeAtlas('a.atlasmap');
  let holding = false;
  const writer = new TokenWriter({ views: () => (holding ? [atlas.view] : []), held: async () => { holding = true; return atlas.state as never; } });
  const { ids, done } = writer.addTokensNow('a.atlasmap', [{ x: 0, y: 0, imagePath: 'a.png' }]);
  assert.equal(ids.length, 1);
  assert.match(ids[0]!, /^tok_/);
  await done;
  assert.ok(atlas.state.objects.tokens[ids[0]!], 'Atlas keeps the id it is handed');
});

test('addTokensNow adds nothing to a map Atlas does not come to hold: no file is written', async () => {
  const atlas = fakeAtlas('a.atlasmap');
  const writer = new TokenWriter(atlas.deps(false));
  const { done } = writer.addTokensNow('a.atlasmap', [{ x: 0, y: 0, imagePath: 'a.png' }]);
  await assert.rejects(done, NotHeldError);
  assert.deepEqual(atlas.calls, []);
});
