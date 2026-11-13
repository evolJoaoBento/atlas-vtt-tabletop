import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { HP_RESOURCE, STRESS_RESOURCE } from '../src/board/resources';
import { NotHeldError, TokenWriter, addTokenInText, readTokenInText, copyTokenInText, deleteTokenInText, initiativeActionInText, initiativeInText, lockDoorInText, toggleDoorInText, killTokenInText, moveTokenInText, moveTokensInText, setResourceInText } from '../src/board/tokenWriter';
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
  assert.deepEqual(joined.entries, [{ tokenId: 't', name: 'Kestrel', initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: 'k.png', isNPC: true, hp: { current: 0, max: 9 }, isDefeated: true, id: 'init_1', order: 0, isActive: true }]);
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
  assert.deepEqual(added, [{ tokenId: 't', name: 'K', initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: 'k.png', isNPC: true }]);
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

test('a door opens and shuts in the file as Atlas toggles it; a locked one stays shut, and locking shuts it', async () => {
  const map = JSON.stringify({ state: { objects: { tokens: {}, walls: {
    d: { id: 'd', kind: 'wall', type: 'door', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } },
    w: { id: 'w', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } },
  } } } });
  let file = toggleDoorInText(map, 'd');
  assert.equal(JSON.parse(file).state.objects.walls.d.closed, false);
  file = lockDoorInText(file, 'd', true);
  assert.deepEqual([JSON.parse(file).state.objects.walls.d.closed, JSON.parse(file).state.objects.walls.d.locked], [true, true]);
  assert.equal(toggleDoorInText(file, 'd'), file);
  file = lockDoorInText(file, 'd', false);
  assert.equal('locked' in JSON.parse(file).state.objects.walls.d, false);
  assert.throws(() => toggleDoorInText(map, 'w'), /no door w/);
  const calls: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { toggleDoor: (id) => calls.push(['toggle', id]), setDoorLocked: (id, locked) => calls.push(['lock', id, locked]) })], process: async () => { throw new Error('no file write'); } });
  await writer.toggleDoor('m.atlasmap', 'd');
  await writer.lockDoor('m.atlasmap', 'd', true);
  assert.deepEqual(calls, [['toggle', 'd'], ['lock', 'd', true]]);
});

test('Atlas 0.9: removing a combatant kept beside the map, or Clear, takes its token too; the turn actions get the defeated', async () => {
  const map = JSON.stringify({ state: { objects: { tokens: { side: { id: 'side', offMap: true }, on: { id: 'on' }, side2: { id: 'side2', offMap: true } } }, initiative: { entries: [
    { id: 'e1', tokenId: 'side', order: 0 }, { id: 'e2', tokenId: 'on', order: 1 }, { id: 'e3', tokenId: 'side2', order: 2 },
  ] } } });
  const removed = JSON.parse(initiativeActionInText(map, { type: 'remove', id: 'e1' }));
  assert.deepEqual(Object.keys(removed.state.objects.tokens), ['on', 'side2']);
  const cleared = JSON.parse(initiativeActionInText(map, { type: 'reset' }));
  assert.deepEqual(Object.keys(cleared.state.objects.tokens), ['on']);
  assert.throws(() => initiativeActionInText(map, { type: 'start', rules: { mode: 'cards', roll: '1d20', firstSide: 'players' } }), /runs only in Atlas/);
  const calls: unknown[][] = [];
  const view = fakeView('m.atlasmap', [], {
    objects: { tokens: { side: { id: 'side', x: 0, y: 0, offMap: true } as never, on: { id: 'on', x: 0, y: 0 } } },
    initiative: { entries: [{ id: 'e1', tokenId: 'side' }] },
    removeFromInitiative: (id, defeated) => calls.push(['remove', id, [...(defeated ?? [])]]),
    deleteTokens: (ids) => calls.push(['delete', ids]),
    nextTurn: (defeated) => calls.push(['next', [...(defeated ?? [])]]),
    resetInitiative: () => calls.push(['reset']),
  });
  const writer = new TokenWriter({ views: () => [view], process: async () => { throw new Error('no file write'); } });
  await writer.initiativeAction('m.atlasmap', { type: 'remove', id: 'e1', defeated: ['e9'] });
  await writer.initiativeAction('m.atlasmap', { type: 'next', defeated: ['e9'] });
  await writer.initiativeAction('m.atlasmap', { type: 'reset' });
  assert.deepEqual(calls, [['remove', 'e1', ['e9']], ['delete', ['side']], ['next', ['e9']], ['reset'], ['delete', ['side']]]);
});

test('moves several tokens as one Atlas change when it offers one, else one by one', async () => {
  const batches: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { updateTokens: (updates) => { batches.push(updates); } })], process: async () => {} });
  assert.equal(await writer.moveMany('m.atlasmap', [{ id: 't', x: 1, y: 2 }, { id: 't', x: 3, y: 4 }]), 'atlas');
  assert.deepEqual(batches, [[{ id: 't', changes: { x: 1, y: 2 } }, { id: 't', changes: { x: 3, y: 4 } }]]);
  const calls: unknown[] = [];
  const old = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls)], process: async () => {} });
  await old.moveMany('m.atlasmap', [{ id: 't', x: 1, y: 2 }]);
  assert.deepEqual(calls, [['t', { x: 1, y: 2 }]]);
});

test('moveTokensInText moves each named token and nothing else', () => {
  const out = JSON.parse(moveTokensInText(text, [{ id: ID, x: 9, y: 8 }]));
  assert.equal(out.state.objects.tokens[ID].x, 9);
  assert.equal(out.state.objects.tokens[ID].y, 8);
  assert.throws(() => moveTokensInText(text, [{ id: 'nope', x: 0, y: 0 }]), /no token nope/);
});

test('a token that comes from another scene keeps its fields, is renumbered there, and loses the floor it stood on', () => {
  const source = { ...readTokenInText(text, BUGBEAR), level: 'upper', levels: ['a'], levelId: 'upper', offLevel: true };
  const out = JSON.parse(addTokenInText(text, source, 'tok_arrived', 15, 25));
  const arrived = out.state.objects.tokens.tok_arrived;
  const original = JSON.parse(text).state.objects.tokens[BUGBEAR];
  assert.deepEqual(arrived, { ...original, id: 'tok_arrived', x: 15, y: 25, instanceNumber: 3 });
  for (const gone of ['level', 'levels', 'levelId', 'offLevel']) assert.ok(!(gone in arrived), gone);
  assert.deepEqual(out.state.objects.tokens[BUGBEAR], original);
});

test('taking a token to another scene adds it there first, then removes it here (files on both sides)', async () => {
  const edits: Array<[string, string]> = [];
  const writer = new TokenWriter({ views: () => [], process: async (path, edit) => { edits.push([path, edit(text)]); } });
  await writer.transfer('from.atlasmap', BUGBEAR, 'to.atlasmap', 'tok_new', { x: 100, y: 200 });
  assert.deepEqual(edits.map(([path]) => path), ['from.atlasmap', 'to.atlasmap', 'from.atlasmap']);
  const added = JSON.parse(edits[1]![1]).state.objects.tokens.tok_new;
  assert.equal(added.x, 100);
  assert.equal(added.y, 200);
  assert.equal(added.imagePath, readTokenInText(text, BUGBEAR).imagePath);
  assert.ok(!(BUGBEAR in JSON.parse(edits[2]![1]).state.objects.tokens));
});

test('taking a token to a scene Atlas holds goes through that store, and a failure there leaves the token where it was', async () => {
  const calls: unknown[] = [];
  const edits: string[] = [];
  const view = fakeView('to.atlasmap', calls, { addToken: ((data: Record<string, unknown>) => { calls.push(['add', data]); return 'id'; }) as never });
  const writer = new TokenWriter({ views: () => [view], process: async (path, edit) => { edits.push(path); edit(text); } });
  await writer.transfer('from.atlasmap', BUGBEAR, 'to.atlasmap', 'tok_new', { x: 5, y: 6 });
  const added = (calls[0] as [string, Record<string, unknown>])[1];
  assert.equal(added.id, 'tok_new');
  assert.equal(added.x, 5);
  assert.ok(!('instanceNumber' in added));
  // Its own scene's file is where it is taken from and removed.
  assert.deepEqual(edits, ['from.atlasmap', 'from.atlasmap']);
  const failing = new TokenWriter({ views: () => [fakeView('to.atlasmap', [], { addToken: undefined })], process: async (path, edit) => { edits.push(`failing:${path}`); edit(text); } });
  await assert.rejects(failing.transfer('from.atlasmap', BUGBEAR, 'to.atlasmap', 'tok_x', { x: 1, y: 1 }), /offers no way to add a token/);
  // Only the read of the token happened: nothing was removed.
  assert.deepEqual(edits.filter((entry) => entry.startsWith('failing:')), ['failing:from.atlasmap']);
});

// ── With a host: Atlas's one store, or nothing ─────────────────────────────

/** A store whose state the test changes, as Atlas's does when it loads a map. */
function liveView(initial: Partial<AtlasSceneState>, calls: unknown[]): { view: AtlasView; set(next: Partial<AtlasSceneState>): void } {
  let state: AtlasSceneState = {
    mapPath: null, mapLoaded: false, isMapLoading: true, objects: { tokens: { t: { id: 't', x: 0, y: 0 } } },
    updateToken: (id, updates) => { calls.push(['update', id, updates]); },
    addToken: (data) => { calls.push(['add', state.mapPath, data.id]); return String(data.id); },
    deleteTokens: (ids) => { calls.push(['delete', state.mapPath, ids]); },
    ...initial,
  };
  return { view: { viewId: 'v', atlasStore: { getState: () => state, subscribe: () => () => {} } }, set: (next) => { state = { ...state, ...next }; } };
}
const refused = async (): Promise<never> => { throw new NotHeldError(); };

test('a move waits for the host and goes to its store', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  let release: (state: AtlasSceneState | null) => void = () => {};
  let processed = 0;
  const writer = new TokenWriter({
    views: () => [live.view], process: async () => { processed++; },
    held: () => new Promise((resolve) => { release = resolve; }),
  });
  const moving = writer.move('m.atlasmap', 't', 3, 4);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  release(live.view.atlasStore.getState());
  assert.equal(await moving, 'atlas');
  assert.deepEqual(calls, [['update', 't', { x: 3, y: 4 }]]);
  assert.equal(processed, 0);
});

test('queued moves keep their order', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  const waiting: Array<(state: AtlasSceneState | null) => void> = [];
  const writer = new TokenWriter({ views: () => [live.view], process: refused, held: () => new Promise((resolve) => { waiting.push(resolve); }) });
  const moves = [writer.move('m.atlasmap', 't', 1, 1), writer.move('m.atlasmap', 't', 2, 2), writer.move('m.atlasmap', 't', 3, 3)];
  await Promise.resolve();
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  // The host answers its waiters in call order.
  for (const resolve of waiting) resolve(live.view.atlasStore.getState());
  assert.deepEqual(await Promise.all(moves), ['atlas', 'atlas', 'atlas']);
  assert.deepEqual(calls.map((call) => (call as [string, string, { x: number }])[2].x), [1, 2, 3]);
});

test('a queued move is refused when the host moves on', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  let processed = 0;
  const writer = new TokenWriter({
    views: () => [live.view],
    process: async () => { processed++; throw new NotHeldError(); },
    held: async () => { live.set({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false }); return null; },
  });
  await assert.rejects(writer.move('m.atlasmap', 't', 3, 4), (error: unknown) => error instanceof NotHeldError && error.message === 'Atlas holds another map: click Edit here first.');
  // Never applied to the store that now holds another map.
  assert.deepEqual(calls, []);
  assert.equal(processed, 1);
  await assert.rejects(writer.toggleDoor('m.atlasmap', 'door'), NotHeldError);
  await assert.rejects(writer.initiativeAction('m.atlasmap', { kind: 'next' }), NotHeldError);
  await assert.rejects(writer.remove('m.atlasmap', 't'), NotHeldError);
  assert.deepEqual(calls, []);
});

test('with a host, a token goes to another scene in two held steps, and stops before the delete when a map is not held', async () => {
  const calls: unknown[] = [];
  const live = liveView({ mapPath: 'from.atlasmap', mapLoaded: true, isMapLoading: false }, calls);
  const reach = new Set(['from.atlasmap', 'to.atlasmap']);
  const follow = async (path: string): Promise<boolean> => {
    if (!reach.has(path)) return false;
    live.set({ mapPath: path, objects: { tokens: path === 'from.atlasmap' ? { t: { id: 't', x: 0, y: 0 } } : {} } });
    return true;
  };
  const writer = new TokenWriter({ views: () => [live.view], process: refused, held: async () => null, follow });
  await writer.transfer('from.atlasmap', 't', 'to.atlasmap', 'n', { x: 5, y: 6 });
  assert.deepEqual(calls, [['add', 'to.atlasmap', 'n'], ['delete', 'from.atlasmap', ['t']]]);

  // The target does not come to be held: nothing is added, nothing deleted.
  calls.length = 0;
  reach.delete('to.atlasmap');
  await follow('from.atlasmap');
  await assert.rejects(writer.transfer('from.atlasmap', 't', 'to.atlasmap', 'n', { x: 5, y: 6 }), NotHeldError);
  assert.deepEqual(calls, []);

  // The way back fails: the token was added there, and is not deleted here.
  reach.add('to.atlasmap');
  let trips = 0;
  const oneWay = new TokenWriter({ views: () => [live.view], process: refused, held: async () => null, follow: async (path) => (trips++ === 0 ? follow(path) : false) });
  await assert.rejects(oneWay.transfer('from.atlasmap', 't', 'to.atlasmap', 'n', { x: 5, y: 6 }), NotHeldError);
  assert.deepEqual(calls, [['add', 'to.atlasmap', 'n']]);
});

test('tokens added while Atlas is on its way to the map wait for it, under the ids given at once; refused when it moves on', async () => {
  const calls: unknown[] = [];
  const live = liveView({ addTokens: (inputs: ReadonlyArray<Record<string, unknown>>) => { calls.push(['addTokens', inputs.map((input) => input.id)]); return inputs.map((input) => String(input.id)); } } as never, calls);
  let release: (state: AtlasSceneState | null) => void = () => {};
  let processed = 0;
  const writer = new TokenWriter({ views: () => [live.view], process: async () => { processed++; throw new NotHeldError(); }, held: () => new Promise((resolve) => { release = resolve; }) });
  const adding = writer.addTokensNow('m.atlasmap', [{ name: 'Goblin', x: 1, y: 2 }, { name: 'Orc', x: 3, y: 4 }]);
  assert.equal(adding.ids.length, 2);
  assert.ok(adding.ids.every((id) => typeof id === 'string' && id !== ''));
  assert.deepEqual(calls, []);
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  release(live.view.atlasStore.getState());
  await adding.done;
  // Atlas's own store got them, under the very ids handed back; no file was touched.
  assert.deepEqual(calls, [['addTokens', adding.ids]]);
  assert.equal(adding.via, 'atlas');
  assert.equal(processed, 0);

  // Atlas ends on another map: nothing is added anywhere, and the caller hears why.
  calls.length = 0;
  const away = new TokenWriter({ views: () => [liveView({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false }, calls).view], process: async () => { processed++; throw new NotHeldError(); }, held: async () => null });
  const refusedAdd = away.addTokensNow('m.atlasmap', [{ name: 'Goblin', x: 1, y: 2 }]);
  await assert.rejects(Promise.resolve(refusedAdd.done), NotHeldError);
  assert.deepEqual(calls, []);
  assert.equal(processed, 0);
});

test("the light level and its colour are set through Atlas's scene lighting, never in a file", async () => {
  const calls: unknown[] = [];
  const live = liveView({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false, setSceneLighting: (changes) => { calls.push(changes); } }, calls);
  const writer = new TokenWriter({ views: () => [live.view], process: refused, held: async () => null });
  assert.equal(await writer.setSceneLighting('m.atlasmap', { ambient: 0.4 }), 'atlas');
  assert.equal(await writer.setSceneLighting('m.atlasmap', { ambient: 7 }), 'atlas');
  assert.equal(await writer.setSceneLighting('m.atlasmap', { ambientColor: '#336699' }), 'atlas');
  assert.equal(await writer.setSceneLighting('m.atlasmap', { ambientColor: undefined }), 'atlas');
  assert.deepEqual(calls, [{ ambient: 0.4 }, { ambient: 1 }, { ambientColor: '#336699' }, { ambientColor: undefined }]);
  assert.ok(Object.hasOwn(calls[3] as object, 'ambientColor'));
  await assert.rejects(writer.setSceneLighting('other.atlasmap', { ambient: 0.4 }), NotHeldError);
  const old = new TokenWriter({ views: () => [liveView({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false }, []).view], process: refused });
  await assert.rejects(old.setSceneLighting('m.atlasmap', { ambient: 0.4 }), /offers no scene lighting/);
});

test("whenHeld waits for Atlas to finish reading the map, or switch its tab to it; loading says it is on its way", () => {
  let state: Partial<AtlasSceneState> = { mapPath: 'm.atlasmap', mapLoaded: false, isMapLoading: true };
  const listeners = new Set<() => void>();
  const view: AtlasView = { viewId: 'v', atlasStore: { getState: () => state as AtlasSceneState, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } } };
  const writer = new TokenWriter({ views: () => [view], process: async () => {} });
  const change = (next: Partial<AtlasSceneState>): void => { state = next; for (const listener of [...listeners]) listener(); };
  assert.equal(writer.holder('m.atlasmap'), null);
  assert.equal(writer.loading('m.atlasmap'), true);
  let held = 0;
  writer.whenHeld('m.atlasmap', () => { held++; });
  change({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  assert.equal(held, 1);
  assert.equal(listeners.size, 0, 'it stops following once held');
  // Another tab shown: not held, not loading; switching back to the map's tab is heard.
  change({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false });
  assert.equal(writer.loading('m.atlasmap'), false);
  const stop = writer.whenHeld('m.atlasmap', () => { held++; });
  change({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false });
  assert.equal(held, 1);
  change({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  assert.equal(held, 2);
  stop();
});
