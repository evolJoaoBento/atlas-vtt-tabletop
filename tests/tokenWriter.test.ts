import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { TokenWriter, moveTokenInText } from '../src/board/tokenWriter';

const text = readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8');
const ID = 'tok_1792170000003_kestrel-v';

test('moves one token and nothing else, in Atlas\'s compact format', () => {
  const out = moveTokenInText(text, ID, 12.5, 34);
  const before = JSON.parse(text);
  const after = JSON.parse(out);
  assert.equal(after.state.objects.tokens[ID].x, 12.5);
  assert.equal(after.state.objects.tokens[ID].y, 34);
  before.state.objects.tokens[ID].x = 12.5;
  before.state.objects.tokens[ID].y = 34;
  assert.deepEqual(after, before);
  assert.equal(out, JSON.stringify(after));
  assert.deepEqual(Object.keys(after.state.objects.tokens[ID]), Object.keys(JSON.parse(text).state.objects.tokens[ID]));
});

test('a missing token throws', () => {
  assert.throws(() => moveTokenInText(text, 'nope', 0, 0), /no token nope/);
});

const fakeView = (mapPath: string, calls: unknown[], over: Partial<AtlasSceneState> = {}): AtlasView => ({
  viewId: 'v',
  atlasStore: {
    getState: (): AtlasSceneState => ({
      mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: { t: { id: 't', x: 0, y: 0 } } },
      updateToken: (id, updates) => { calls.push([id, updates]); }, ...over,
    }),
    subscribe: () => () => {},
  },
});

test('routes to an Atlas view that has the map open', async () => {
  const calls: unknown[] = [];
  let processed = 0;
  const writer = new TokenWriter({ views: () => [fakeView('other.atlasmap', []), fakeView('m.atlasmap', calls)], process: async () => { processed++; } });
  assert.equal(await writer.move('m.atlasmap', 't', 3, 4), 'atlas');
  assert.deepEqual(calls, [['t', { x: 3, y: 4 }]]);
  assert.equal(processed, 0);
});

test('writes the file when no Atlas view has the map', async () => {
  const edits: Array<[string, string]> = [];
  const writer = new TokenWriter({ views: () => [fakeView('other.atlasmap', [])], process: async (path, edit) => { edits.push([path, edit(text)]); } });
  assert.equal(await writer.move('m.atlasmap', ID, 7, 8), 'file');
  assert.equal(edits[0]![0], 'm.atlasmap');
  assert.equal(JSON.parse(edits[0]![1]).state.objects.tokens[ID].x, 7);
});

test('a map Atlas is still loading, or a token it does not hold, is written to the file', async () => {
  for (const over of [{ isMapLoading: true }, { mapLoaded: false }, { objects: { tokens: {} } }]) {
    const calls: unknown[] = [];
    let processed = 0;
    const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, over)], process: async () => { processed++; } });
    assert.equal(await writer.move('m.atlasmap', 't', 1, 2), 'file', JSON.stringify(over));
    assert.equal(calls.length, 0);
    assert.equal(processed, 1);
  }
});
