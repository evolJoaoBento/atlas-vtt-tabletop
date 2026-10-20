import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { TokenWriter, copyTokenInText, moveTokenInText, setMeterInText } from '../src/board/tokenWriter';

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

const KESTREL = 'tok_1792170000003_kestrel-v';
const BUGBEAR = 'tok_1792170000006_bugbear00';

test('a copy is the token with a new id and place, and the lowest free copy number for its art', () => {
  const out = JSON.parse(copyTokenInText(text, BUGBEAR, 'tok_new', 10, 20));
  const source = JSON.parse(text).state.objects.tokens[BUGBEAR];
  const copy = out.state.objects.tokens.tok_new;
  // The two bugbears share their art and hold 1 and 2: the copy is 3.
  assert.deepEqual(copy, { ...source, id: 'tok_new', x: 10, y: 20, instanceNumber: 3 });
  assert.deepEqual(out.state.objects.tokens[BUGBEAR], source);
});

test('editing a meter sets it, and marks a changed maximum as overridden like Atlas', () => {
  const same = JSON.parse(setMeterInText(text, KESTREL, 'hp', { current: 5, max: 44 }));
  assert.deepEqual(same.state.objects.tokens[KESTREL].hp, { current: 5, max: 44 });
  assert.equal(same.state.objects.tokens[KESTREL].maxHpOverridden, undefined);
  const raised = JSON.parse(setMeterInText(text, KESTREL, 'hp', { current: 5, max: 50 }));
  assert.equal(raised.state.objects.tokens[KESTREL].maxHpOverridden, true);
  const stress = JSON.parse(setMeterInText(text, KESTREL, 'stress', { current: 2, max: 6 }));
  assert.equal(stress.state.objects.tokens[KESTREL].stress, 2);
  assert.equal(stress.state.objects.tokens[KESTREL].maxStress, 6);
  assert.equal(stress.state.objects.tokens[KESTREL].maxStressOverridden, true);
});

test('copies and meter edits go through Atlas when it has the map', async () => {
  const calls: unknown[] = [];
  const added: unknown[] = [];
  const view = fakeView('m.atlasmap', calls, { addToken: (data: unknown) => { added.push(data); return 'x'; }, objects: { tokens: { t: { id: 't', x: 0, y: 0, imagePath: 'a.png', instanceNumber: 1, hp: { current: 3, max: 9 } } as never } } });
  const writer = new TokenWriter({ views: () => [view], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.copy('m.atlasmap', 't', 'tok_c', 5, 6), 'atlas');
  assert.deepEqual(added, [{ id: 'tok_c', x: 5, y: 6, imagePath: 'a.png', hp: { current: 3, max: 9 } }]);
  assert.equal(await writer.meter('m.atlasmap', 't', 'hp', { current: 1, max: 9 }), 'atlas');
  assert.deepEqual(calls.at(-1), ['t', { hp: { current: 1, max: 9 } }]);
});
