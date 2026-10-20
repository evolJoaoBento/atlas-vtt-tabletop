import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { HP_RESOURCE, STRESS_RESOURCE } from '../src/board/resources';
import { TokenWriter, copyTokenInText, deleteTokenInText, initiativeActionInText, initiativeInText, killTokenInText, moveTokenInText, setResourceInText } from '../src/board/tokenWriter';
import { conditionChange, resetChange } from '../src/board/tokenEdits';

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

const DEFS = [HP_RESOURCE, STRESS_RESOURCE, { key: 'spell-slots', name: 'Spell Slots', field: 'spell_slots', direction: 'drains' as const, color: '#6366f1', visibleToPlayers: true }];

test('a resource edit is written in the file fields Atlas keeps, a changed maximum marked overridden', () => {
  const same = JSON.parse(setResourceInText(text, KESTREL, 'hp', () => ({ current: 5, max: 44 }), false));
  assert.deepEqual(same.state.objects.tokens[KESTREL].hp, { current: 5, max: 44 });
  assert.equal(same.state.objects.tokens[KESTREL].maxHpOverridden, undefined);
  assert.equal(same.state.objects.tokens[KESTREL].resources, undefined);
  const raised = JSON.parse(setResourceInText(text, KESTREL, 'hp', () => ({ current: 5, max: 50 }), true));
  assert.equal(raised.state.objects.tokens[KESTREL].maxHpOverridden, true);
});

test('a step is applied to the value in the file, clamped', () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', stress: 2, maxStress: 6, statblockResources: { 'spell-slots': { current: 1, max: 3 } } } } } } });
  const stressed = JSON.parse(setResourceInText(file, 't', 'stress', (v) => ({ ...v, current: v.current + 1 }), false));
  assert.deepEqual(stressed.state.objects.tokens.t.stress, { current: 3, max: 6 });
  assert.equal(stressed.state.objects.tokens.t.maxStress, 6);
  const slots = JSON.parse(setResourceInText(file, 't', 'spell-slots', (v) => ({ ...v, current: v.current - 5 }), false));
  assert.deepEqual(slots.state.objects.tokens.t.statblockResources['spell-slots'], { current: 0, max: 3 });
});

test('a resource the token does not hold is not invented', () => {
  assert.throws(() => setResourceInText(text, KESTREL, 'nope', (v) => v, false), /has no nope/);
});

test('the initiative entry of the token gets its new vitals, as Atlas writes them', () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', hp: { current: 4, max: 9 } } } }, initiative: { entries: [{ tokenId: 't', hp: { current: 4, max: 9 }, isDefeated: false }, { tokenId: 'o', hp: 1 }] } } });
  const out = JSON.parse(setResourceInText(file, 't', 'hp', () => ({ current: 0, max: 9 }), false));
  assert.deepEqual(out.state.initiative.entries[0], { tokenId: 't', hp: { current: 0, max: 9 }, isDefeated: true });
  assert.deepEqual(out.state.initiative.entries[1], { tokenId: 'o', hp: 1 });
});

test('Kill spends every defeating resource in the file', () => {
  const out = JSON.parse(killTokenInText(text, KESTREL, DEFS));
  assert.deepEqual(out.state.objects.tokens[KESTREL].hp, { current: 0, max: 44 });
});

test('Delete takes the token off the map and nothing else', () => {
  const out = JSON.parse(deleteTokenInText(text, KESTREL));
  const before = JSON.parse(text);
  delete before.state.objects.tokens[KESTREL];
  assert.deepEqual(out, before);
});

test('with Atlas 0.8 holding the map, resource edits go through its store in its memory form', async () => {
  const calls: unknown[] = [];
  const live = { id: 't', x: 0, y: 0, resources: { hp: { current: 3, max: 9 }, stress: { current: 1, max: 6 } } };
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { objects: { tokens: { t: live } } })], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.resource('m.atlasmap', 't', 'hp', (v) => ({ ...v, current: v.current - 1 }), false), 'atlas');
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 2, max: 9 }, stress: { current: 1, max: 6 } } }]);
  assert.equal(await writer.resource('m.atlasmap', 't', 'hp', () => ({ current: 3, max: 12 }), true), 'atlas');
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 3, max: 12 }, stress: { current: 1, max: 6 } }, overriddenMax: ['hp'] }]);
  assert.equal(await writer.kill('m.atlasmap', 't', DEFS), 'atlas');
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 0, max: 9 }, stress: { current: 1, max: 6 } } }]);
});

test('an older Atlas holding the map in its file form gets the file fields', async () => {
  const calls: unknown[] = [];
  const live = { id: 't', x: 0, y: 0, hp: { current: 3, max: 9 }, stress: 1, maxStress: 6 };
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { objects: { tokens: { t: live } } })], process: async () => { throw new Error('no file write'); } });
  await writer.resource('m.atlasmap', 't', 'stress', (v) => ({ ...v, current: v.current + 1 }), false);
  assert.deepEqual(calls.at(-1), ['t', { hp: { current: 3, max: 9 }, stress: { current: 2, max: 6 }, maxStress: 6 }]);
});

test('Delete goes through Atlas when it has the map', async () => {
  const deleted: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { deleteTokens: (ids: string[]) => { deleted.push(ids); } })], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.remove('m.atlasmap', 't'), 'atlas');
  assert.deepEqual(deleted, [['t']]);
});

test('copies go through Atlas when it has the map', async () => {
  const calls: unknown[] = [];
  const added: unknown[] = [];
  const view = fakeView('m.atlasmap', calls, { addToken: (data: unknown) => { added.push(data); return 'x'; }, objects: { tokens: { t: { id: 't', x: 0, y: 0, imagePath: 'a.png', instanceNumber: 1, resources: { hp: { current: 3, max: 9 } } } as never } } });
  const writer = new TokenWriter({ views: () => [view], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.copy('m.atlasmap', 't', 'tok_c', 5, 6), 'atlas');
  assert.deepEqual(added, [{ id: 'tok_c', x: 5, y: 6, imagePath: 'a.png', resources: { hp: { current: 3, max: 9 } } }]);
});

test('when Atlas holds the map but lacks the action, nothing is written behind its back', async () => {
  let processed = 0;
  const view = fakeView('m.atlasmap', [], { updateToken: undefined, addToken: undefined });
  const writer = new TokenWriter({ views: () => [view], process: async () => { processed++; } });
  await assert.rejects(writer.move('m.atlasmap', 't', 1, 2), /Atlas/);
  await assert.rejects(writer.copy('m.atlasmap', 't', 'n', 1, 2), /Atlas/);
  await assert.rejects(writer.resource('m.atlasmap', 't', 'hp', (v) => v, false), /Atlas/);
  await assert.rejects(writer.remove('m.atlasmap', 't'), /Atlas/);
  assert.equal(processed, 0);
});

test('stress with a max of 0 counts as 10, as Atlas reads it', () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', stress: 2, maxStress: 0 } } } } });
  const out = JSON.parse(setResourceInText(file, 't', 'stress', (v) => ({ ...v, current: 3 }), false));
  assert.deepEqual(out.state.objects.tokens.t.stress, { current: 3, max: 10 });
  assert.equal(out.state.objects.tokens.t.maxStressOverridden, undefined);
});

test('a condition change in the file deletes the lists it empties', async () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', conditions: ['a'], conditionValues: { a: 2 }, hp: { current: 3, max: 9 } } } } } });
  let out = '';
  const writer = new TokenWriter({ views: () => [], process: async (_path, edit) => { out = edit(file); } });
  assert.equal(await writer.update('m', 't', (token) => conditionChange(token, 'a', false)), 'file');
  const token = JSON.parse(out).state.objects.tokens.t;
  assert.equal('conditions' in token, false);
  assert.equal('conditionValues' in token, false);
  assert.deepEqual(token.hp, { current: 3, max: 9 });
});

test('Reset in the file restores the old fields and clears conditions', async () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', hp: { current: 0, max: 9 }, stress: 4, maxStress: 6, conditions: ['a'] } } } } });
  let out = '';
  const writer = new TokenWriter({ views: () => [], process: async (_path, edit) => { out = edit(file); } });
  await writer.update('m', 't', (token) => resetChange(token, [HP_RESOURCE, STRESS_RESOURCE]));
  const token = JSON.parse(out).state.objects.tokens.t;
  assert.deepEqual([token.hp, token.stress, token.maxStress, 'conditions' in token, 'resources' in token], [{ current: 9, max: 9 }, { current: 0, max: 6 }, 6, false, false]);
});

test('an older Atlas gets Reset as the file fields plus the cleared conditions', async () => {
  const calls: unknown[] = [];
  const live = { id: 't', x: 0, y: 0, hp: { current: 0, max: 9 }, conditions: ['a'] };
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { objects: { tokens: { t: live } } })], process: async () => { throw new Error('no file write'); } });
  await writer.update('m.atlasmap', 't', (token) => resetChange(token, [HP_RESOURCE]));
  assert.deepEqual(calls.at(-1), ['t', { conditions: undefined, conditionValues: undefined, hp: { current: 9, max: 9 } }]);
});

test('joining the initiative in the file: Atlas\'s entry with the token\'s vitals, the tracker made when there was none', () => {
  const file = JSON.stringify({ state: { objects: { tokens: { t: { id: 't', kind: 'character', name: 'Kestrel', imagePath: 'k.png', hp: { current: 0, max: 9 } } } } } });
  const joined = JSON.parse(initiativeInText(file, 't', true, 'init_1')).state.initiative;
  assert.deepEqual(joined.entries, [{ tokenId: 't', name: 'Kestrel', initiative: 0, initiativeModifier: 0, imagePath: 'k.png', isNPC: true, hp: { current: 0, max: 9 }, isDefeated: true, id: 'init_1', order: 0, isActive: true }]);
  assert.equal(joined.currentIndex, -1);
  const left = JSON.parse(initiativeInText(JSON.stringify({ state: { ...JSON.parse(file).state, initiative: joined } }), 't', false, 'x')).state.initiative;
  assert.deepEqual(left.entries, []);
});

test('with Atlas holding the map, initiative goes through its tracker, which opens', async () => {
  const added: unknown[] = [];
  const removed: unknown[] = [];
  let opened = false;
  const state = (entries: Array<{ id: string; tokenId: string }>) => fakeView('m.atlasmap', [], {
    objects: { tokens: { t: { id: 't', x: 0, y: 0, kind: 'character', name: 'K', imagePath: 'k.png' } as never } },
    initiative: { entries }, initiativeTrackerOpen: false, setInitiativeTrackerOpen: () => { opened = true; },
    addToInitiative: (entry) => { added.push(entry); return 'x'; }, removeFromInitiative: (id) => { removed.push(id); },
  });
  let writer = new TokenWriter({ views: () => [state([])], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.initiative('m.atlasmap', 't', true), 'atlas');
  assert.deepEqual(added, [{ tokenId: 't', name: 'K', initiative: 0, initiativeModifier: 0, imagePath: 'k.png', isNPC: true }]);
  assert.equal(opened, true);
  writer = new TokenWriter({ views: () => [state([{ id: 'init_9', tokenId: 't' }])], process: async () => { throw new Error('no file write'); } });
  await writer.initiative('m.atlasmap', 't', false);
  assert.deepEqual(removed, ['init_9']);
});

test('a tracker change is written to the file as Atlas makes it; a deleted token leaves the tracker too', () => {
  let file = initiativeInText(text, KESTREL, true, 'init_1');
  file = initiativeInText(file, BUGBEAR, true, 'init_2');
  file = initiativeActionInText(file, { type: 'start', rules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' } });
  file = initiativeActionInText(file, { type: 'next' });
  let initiative = JSON.parse(file).state.initiative;
  assert.deepEqual([initiative.isActive, initiative.round, initiative.currentIndex], [true, 1, 1]);
  assert.deepEqual(initiative.entries.map((entry: { tokenId: string; isActive: boolean }) => [entry.tokenId, entry.isActive]), [[KESTREL, false], [BUGBEAR, true]]);
  file = initiativeActionInText(file, { type: 'roll', roll: '1d20', statblockModifiers: {} }, () => 0.5);
  assert.deepEqual(JSON.parse(file).state.initiative.entries.map((entry: { initiative: number }) => entry.initiative), [11, 11]);
  file = deleteTokenInText(file, BUGBEAR);
  initiative = JSON.parse(file).state.initiative;
  assert.deepEqual(initiative.entries.map((entry: { tokenId: string; isActive: boolean }) => [entry.tokenId, entry.isActive]), [[KESTREL, true]]);
});

test('with Atlas holding the map, a tracker change goes to its own tracker action', async () => {
  const calls: unknown[][] = [];
  const view = fakeView('m.atlasmap', [], {
    objects: { tokens: {} },
    nextTurn: () => calls.push(['next']),
    rollAllInitiative: (roll, from) => calls.push(['rollAll', roll, [...(from ?? new Map())]]),
    rollEntryInitiative: (id, roll, from) => calls.push(['rollOne', id, roll, from]),
    updateInitiativeEntry: (id, changes) => calls.push(['edit', id, changes]),
  });
  const writer = new TokenWriter({ views: () => [view], process: async () => { throw new Error('no file write'); } });
  assert.equal(await writer.initiativeAction('m.atlasmap', { type: 'next' }), 'atlas');
  await writer.initiativeAction('m.atlasmap', { type: 'roll', roll: '1d10', statblockModifiers: { a: 3 } });
  await writer.initiativeAction('m.atlasmap', { type: 'roll', entryId: 'a', roll: '1d10', statblockModifiers: {} });
  await writer.initiativeAction('m.atlasmap', { type: 'edit', id: 'a', changes: { initiative: 4 } });
  assert.deepEqual(calls, [['next'], ['rollAll', '1d10', [['a', 3]]], ['rollOne', 'a', '1d10', null], ['edit', 'a', { initiative: 4 }]]);
  // An older Atlas without the action: nothing is written behind its back.
  await assert.rejects(writer.initiativeAction('m.atlasmap', { type: 'reset' }), /offers no such initiative action/);
  assert.equal(writer.offers('m.atlasmap', 'reset'), false);
  assert.equal(writer.offers('other.atlasmap', 'reset'), true);
});
