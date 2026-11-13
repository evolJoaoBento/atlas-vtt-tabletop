import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import { HP_RESOURCE, STRESS_RESOURCE } from '../src/board/resources';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { conditionChange, resetChange } from '../src/board/tokenEdits';

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

const DEFS = [HP_RESOURCE, STRESS_RESOURCE, { key: 'spell-slots', name: 'Spell Slots', field: 'spell_slots', direction: 'drains' as const, color: '#6366f1', visibleToPlayers: true }];

test('a map Atlas does not come to hold is not changed: the edit is refused, and no file is written', async () => {
  const calls: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('other.atlasmap', calls)], held: async () => null });
  await assert.rejects(writer.move('m.atlasmap', 't', 7, 8), NotHeldError);
  await assert.rejects(writer.resource('m.atlasmap', 't', 'hp', (v) => v, false), NotHeldError);
  await assert.rejects(writer.initiative('m.atlasmap', 't', true), NotHeldError);
  assert.deepEqual(calls, []);
  // Still reading the map: it waits, then is refused when Atlas does not come to hold it.
  const loading = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { isMapLoading: true })], held: async () => null });
  await assert.rejects(loading.move('m.atlasmap', 't', 1, 2), NotHeldError);
  assert.deepEqual(calls, []);
});

test('a token Atlas does not hold is not invented, nor a resource it does not have', async () => {
  const calls: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls)], held: async () => null });
  await assert.rejects(writer.move('m.atlasmap', 'nope', 0, 0), /no token nope/);
  await assert.rejects(writer.resource('m.atlasmap', 't', 'nope', (v) => v, false), /has no nope/);
  assert.deepEqual(calls, []);
});

test("a condition change and Reset go to Atlas's store as the fields Atlas sets", async () => {
  const calls: unknown[] = [];
  const live = { id: 't', x: 0, y: 0, conditions: ['a'], resources: { hp: { current: 1, max: 9 } } };
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { objects: { tokens: { t: live } } })], held: async () => null });
  await writer.update('m.atlasmap', 't', (token) => conditionChange(token, 'a', false));
  assert.deepEqual(calls.at(-1), ['t', { conditions: undefined, conditionValues: undefined }]);
  await writer.update('m.atlasmap', 't', (token) => ({ ...resetChange(token, DEFS) }));
  assert.deepEqual((calls.at(-1) as [string, { resources: unknown }])[1].resources, { hp: { current: 9, max: 9 } });
});

test('routes to an Atlas view that has the map open', async () => {
  const calls: unknown[] = [];
  let processed = 0;
  const writer = new TokenWriter({ views: () => [fakeView('other.atlasmap', []), fakeView('m.atlasmap', calls)], held: async () => null });
  await writer.move('m.atlasmap', 't', 3, 4);
  assert.deepEqual(calls, [['t', { x: 3, y: 4 }]]);
  assert.equal(processed, 0);
});

test('with Atlas 0.8 holding the map, resource edits go through its store in its memory form', async () => {
  const calls: unknown[] = [];
  const live = { id: 't', x: 0, y: 0, resources: { hp: { current: 3, max: 9 }, stress: { current: 1, max: 6 } } };
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls, { objects: { tokens: { t: live } } })], held: async () => null });
  await writer.resource('m.atlasmap', 't', 'hp', (v) => ({ ...v, current: v.current - 1 }), false);
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 2, max: 9 }, stress: { current: 1, max: 6 } } }]);
  await writer.resource('m.atlasmap', 't', 'hp', () => ({ current: 3, max: 12 }), true);
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 3, max: 12 }, stress: { current: 1, max: 6 } }, overriddenMax: ['hp'] }]);
  await writer.kill('m.atlasmap', 't', DEFS);
  assert.deepEqual(calls.at(-1), ['t', { resources: { hp: { current: 0, max: 9 }, stress: { current: 1, max: 6 } } }]);
});

test('Delete goes through Atlas when it has the map', async () => {
  const deleted: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { deleteTokens: (ids: string[]) => { deleted.push(ids); } })], held: async () => null });
  await writer.remove('m.atlasmap', 't');
  assert.deepEqual(deleted, [['t']]);
});

test('copies go through Atlas when it has the map', async () => {
  const calls: unknown[] = [];
  const added: unknown[] = [];
  const view = fakeView('m.atlasmap', calls, { addToken: (data: unknown) => { added.push(data); return 'x'; }, objects: { tokens: { t: { id: 't', x: 0, y: 0, imagePath: 'a.png', instanceNumber: 1, resources: { hp: { current: 3, max: 9 } } } as never } } });
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await writer.copy('m.atlasmap', 't', 'tok_c', 5, 6);
  assert.deepEqual(added, [{ id: 'tok_c', x: 5, y: 6, imagePath: 'a.png', resources: { hp: { current: 3, max: 9 } } }]);
});

test('when Atlas holds the map but lacks the action, nothing is written behind its back', async () => {
  let processed = 0;
  const view = fakeView('m.atlasmap', [], { updateToken: undefined, addToken: undefined });
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await assert.rejects(writer.move('m.atlasmap', 't', 1, 2), /Atlas/);
  await assert.rejects(writer.copy('m.atlasmap', 't', 'n', 1, 2), /Atlas/);
  await assert.rejects(writer.resource('m.atlasmap', 't', 'hp', (v) => v, false), /Atlas/);
  await assert.rejects(writer.remove('m.atlasmap', 't'), /Atlas/);
  assert.equal(processed, 0);
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
  let writer = new TokenWriter({ views: () => [state([])], held: async () => null });
  await writer.initiative('m.atlasmap', 't', true);
  assert.deepEqual(added, [{ tokenId: 't', name: 'K', initiative: 0, awaitingInitiative: true, initiativeModifier: 0, imagePath: 'k.png', isNPC: true }]);
  assert.equal(opened, true);
  writer = new TokenWriter({ views: () => [state([{ id: 'init_9', tokenId: 't' }])], held: async () => null });
  await writer.initiative('m.atlasmap', 't', false);
  assert.deepEqual(removed, ['init_9']);
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
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await writer.initiativeAction('m.atlasmap', { type: 'next' });
  await writer.initiativeAction('m.atlasmap', { type: 'roll', roll: '1d10', statblockModifiers: { a: 3 } });
  await writer.initiativeAction('m.atlasmap', { type: 'roll', entryId: 'a', roll: '1d10', statblockModifiers: {} });
  await writer.initiativeAction('m.atlasmap', { type: 'edit', id: 'a', changes: { initiative: 4 } });
  assert.deepEqual(calls, [['next'], ['rollAll', '1d10', [['a', 3]]], ['rollOne', 'a', '1d10', null], ['edit', 'a', { initiative: 4 }]]);
  // An older Atlas without the action: nothing is written behind its back.
  await assert.rejects(writer.initiativeAction('m.atlasmap', { type: 'reset' }), /offers no such initiative action/);
  assert.equal(writer.offers('m.atlasmap', 'reset'), false);
  assert.equal(writer.offers('other.atlasmap', 'reset'), true);
});

test("a door opens, shuts and locks through Atlas's own door actions", async () => {
  const calls: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { toggleDoor: (id) => calls.push(['toggle', id]), setDoorLocked: (id, locked) => calls.push(['lock', id, locked]) })], held: async () => null });
  await writer.toggleDoor('m.atlasmap', 'd');
  await writer.lockDoor('m.atlasmap', 'd', true);
  assert.deepEqual(calls, [['toggle', 'd'], ['lock', 'd', true]]);
});

test('Atlas 0.9: removing a combatant kept beside the map, or Clear, takes its token too; the turn actions get the defeated', async () => {
  const calls: unknown[][] = [];
  const view = fakeView('m.atlasmap', [], {
    objects: { tokens: { side: { id: 'side', x: 0, y: 0, offMap: true } as never, on: { id: 'on', x: 0, y: 0 } } },
    initiative: { entries: [{ id: 'e1', tokenId: 'side' }] },
    removeFromInitiative: (id, defeated) => calls.push(['remove', id, [...(defeated ?? [])]]),
    deleteTokens: (ids) => calls.push(['delete', ids]),
    nextTurn: (defeated) => calls.push(['next', [...(defeated ?? [])]]),
    resetInitiative: () => calls.push(['reset']),
  });
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await writer.initiativeAction('m.atlasmap', { type: 'remove', id: 'e1', defeated: ['e9'] });
  await writer.initiativeAction('m.atlasmap', { type: 'next', defeated: ['e9'] });
  await writer.initiativeAction('m.atlasmap', { type: 'reset' });
  assert.deepEqual(calls, [['remove', 'e1', ['e9']], ['delete', ['side']], ['next', ['e9']], ['reset'], ['delete', ['side']]]);
});

test('moves several tokens as one Atlas change when it offers one, else one by one', async () => {
  const batches: unknown[] = [];
  const writer = new TokenWriter({ views: () => [fakeView('m.atlasmap', [], { updateTokens: (updates) => { batches.push(updates); } })], held: async () => null });
  await writer.moveMany('m.atlasmap', [{ id: 't', x: 1, y: 2 }, { id: 't', x: 3, y: 4 }]);
  assert.deepEqual(batches, [[{ id: 't', changes: { x: 1, y: 2 } }, { id: 't', changes: { x: 3, y: 4 } }]]);
  const calls: unknown[] = [];
  const old = new TokenWriter({ views: () => [fakeView('m.atlasmap', calls)], held: async () => null });
  await old.moveMany('m.atlasmap', [{ id: 't', x: 1, y: 2 }]);
  assert.deepEqual(calls, [['t', { x: 1, y: 2 }]]);
});

test('without a host to follow, a token never changes scene: it stays where it is', async () => {
  const calls: unknown[] = [];
  const view = fakeView('from.atlasmap', calls, { addToken: ((data: Record<string, unknown>) => { calls.push(['add', data]); return 'id'; }) as never, deleteTokens: (ids) => { calls.push(['delete', ids]); } });
  const writer = new TokenWriter({ views: () => [view], held: async () => null });
  await assert.rejects(writer.transfer('from.atlasmap', 't', 'to.atlasmap', 'tok_new', { x: 5, y: 6 }), NotHeldError);
  assert.deepEqual(calls, []);
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

test('a move waits for the host and goes to its store', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  let release: (state: AtlasSceneState | null) => void = () => {};
  const writer = new TokenWriter({ views: () => [live.view], held: () => new Promise((resolve) => { release = resolve; }) });
  const moving = writer.move('m.atlasmap', 't', 3, 4);
  await Promise.resolve();
  assert.deepEqual(calls, []);
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  release(live.view.atlasStore.getState());
  await moving;
  assert.deepEqual(calls, [['update', 't', { x: 3, y: 4 }]]);
});

test('queued moves keep their order', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  const waiting: Array<(state: AtlasSceneState | null) => void> = [];
  const writer = new TokenWriter({ views: () => [live.view], held: () => new Promise((resolve) => { waiting.push(resolve); }) });
  const moves = [writer.move('m.atlasmap', 't', 1, 1), writer.move('m.atlasmap', 't', 2, 2), writer.move('m.atlasmap', 't', 3, 3)];
  await Promise.resolve();
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  // The host answers its waiters in call order.
  for (const resolve of waiting) resolve(live.view.atlasStore.getState());
  await Promise.all(moves);
  assert.deepEqual(calls.map((call) => (call as [string, string, { x: number }])[2].x), [1, 2, 3]);
});

test('a queued move is refused when the host moves on', async () => {
  const calls: unknown[] = [];
  const live = liveView({}, calls);
  const writer = new TokenWriter({
    views: () => [live.view],
    held: async () => { live.set({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false }); return null; },
  });
  await assert.rejects(writer.move('m.atlasmap', 't', 3, 4), (error: unknown) => error instanceof NotHeldError && error.message === 'Atlas holds another map: click Edit here first.');
  // Never applied to the store that now holds another map.
  assert.deepEqual(calls, []);
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
  const writer = new TokenWriter({ views: () => [live.view], held: async () => null, follow });
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
  const oneWay = new TokenWriter({ views: () => [live.view], held: async () => null, follow: async (path) => (trips++ === 0 ? follow(path) : false) });
  await assert.rejects(oneWay.transfer('from.atlasmap', 't', 'to.atlasmap', 'n', { x: 5, y: 6 }), NotHeldError);
  assert.deepEqual(calls, [['add', 'to.atlasmap', 'n']]);
});

test('tokens added while Atlas is on its way to the map wait for it, under the ids given at once; refused when it moves on', async () => {
  const calls: unknown[] = [];
  const live = liveView({ addTokens: (inputs: ReadonlyArray<Record<string, unknown>>) => { calls.push(['addTokens', inputs.map((input) => input.id)]); return inputs.map((input) => String(input.id)); } } as never, calls);
  let release: (state: AtlasSceneState | null) => void = () => {};
  const writer = new TokenWriter({ views: () => [live.view], held: () => new Promise((resolve) => { release = resolve; }) });
  const adding = writer.addTokensNow('m.atlasmap', [{ name: 'Goblin', x: 1, y: 2 }, { name: 'Orc', x: 3, y: 4 }]);
  assert.equal(adding.ids.length, 2);
  assert.ok(adding.ids.every((id) => typeof id === 'string' && id !== ''));
  assert.deepEqual(calls, []);
  live.set({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false });
  release(live.view.atlasStore.getState());
  await adding.done;
  // Atlas's own store got them, under the very ids handed back.
  assert.deepEqual(calls, [['addTokens', adding.ids]]);

  // Atlas ends on another map: nothing is added anywhere, and the caller hears why.
  calls.length = 0;
  const away = new TokenWriter({ views: () => [liveView({ mapPath: 'other.atlasmap', mapLoaded: true, isMapLoading: false }, calls).view], held: async () => null });
  const refusedAdd = away.addTokensNow('m.atlasmap', [{ name: 'Goblin', x: 1, y: 2 }]);
  await assert.rejects(Promise.resolve(refusedAdd.done), NotHeldError);
  assert.deepEqual(calls, []);
});

test("the light level and its colour are set through Atlas's scene lighting, never in a file", async () => {
  const calls: unknown[] = [];
  const live = liveView({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false, setSceneLighting: (changes) => { calls.push(changes); } }, calls);
  const writer = new TokenWriter({ views: () => [live.view], held: async () => null });
  await writer.setSceneLighting('m.atlasmap', { ambient: 0.4 });
  await writer.setSceneLighting('m.atlasmap', { ambient: 7 });
  await writer.setSceneLighting('m.atlasmap', { ambientColor: '#336699' });
  await writer.setSceneLighting('m.atlasmap', { ambientColor: undefined });
  assert.deepEqual(calls, [{ ambient: 0.4 }, { ambient: 1 }, { ambientColor: '#336699' }, { ambientColor: undefined }]);
  assert.ok(Object.hasOwn(calls[3] as object, 'ambientColor'));
  await assert.rejects(writer.setSceneLighting('other.atlasmap', { ambient: 0.4 }), NotHeldError);
  const old = new TokenWriter({ views: () => [liveView({ mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false }, []).view], held: async () => null });
  await assert.rejects(old.setSceneLighting('m.atlasmap', { ambient: 0.4 }), /offers no scene lighting/);
});

