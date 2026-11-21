import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordAtlasWrites } from '../src/board/undoRecorders';

const RECT = { x: 0, y: 0, width: 700, height: 500 };

/** A stand-in for the Atlas view holding `mapPath`: its fog, the fog actions it has (`has`) and its history. */
function atlas(mapPath: string, options: { has?: ReadonlyArray<'addFogOperations' | 'addFogOperation' | 'clearFog' | 'coverAllFog' | 'hideRooms' | 'revealFogGround' | 'hideFogArea' | 'forgetFogArea'>; levels?: string[]; viewed?: string | null } = {}) {
  const has = new Set(options.has ?? ['addFogOperations', 'addFogOperation', 'clearFog', 'coverAllFog', 'hideRooms', 'revealFogGround', 'hideFogArea', 'forgetFogArea']);
  const fog: Record<string, Record<string, unknown>> = {};
  const log: string[] = [];
  const past: unknown[] = [];
  let depth = 0;
  let next = 0;
  const step = (): void => { if (depth === 0) past.push(1); };
  const put = (data: Record<string, unknown>): string => { const id = `fog_${++next}`; fog[id] = { id, kind: 'fog', ...data }; step(); return id; };
  const actions: Record<string, unknown> = {
    addFogOperation: (data: Record<string, unknown>): string => { log.push('add one'); return put(data); },
    addFogOperations: (data: ReadonlyArray<Record<string, unknown>>): string[] => {
      log.push(`add ${data.length}`);
      depth += 1; const ids = data.map(put); depth -= 1; step();
      return ids;
    },
    clearFog: (): void => { log.push('clear'); for (const id of Object.keys(fog)) delete fog[id]; step(); },
    coverAllFog: (rect: unknown): boolean => { log.push(`cover ${JSON.stringify(rect)}`); if (!rect) return false; put({ type: 'rectangle', isErasing: false, ...(rect as object) }); return true; },
    revealFogGround: (outlines: ReadonlyArray<unknown>): void => { log.push(`reveal ${outlines.length}`); put({ type: 'lasso', isErasing: true, area: {} }); },
    hideFogArea: (id: string): boolean => { log.push(`hide ${id}`); if (!fog[id]) return false; fog[id] = { ...fog[id], isErasing: false }; step(); return true; },
    forgetFogArea: (id: string): boolean => { log.push(`forget ${id}`); if (!fog[id]) return false; delete fog[id]!.area; step(); return true; },
    hideRooms: (rect: unknown, coverage: unknown): { rooms: number; hidden: number } => { log.push(`rooms ${JSON.stringify(rect)} ${String(coverage)}`); return { rooms: 3, hidden: 2 }; },
  };
  const state: Record<string, unknown> = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: {}, fog },
    ...(options.levels ? { levels: options.levels.map((id) => ({ id })), viewedLevel: options.viewed ?? null } : {}),
    ...Object.fromEntries([...has].map((name) => [name, actions[name]])),
  };
  const view = {
    viewId: 'v',
    atlasStore: {
      getState: () => state,
      subscribe: () => () => {},
      temporal: { getState: () => ({ pastStates: past, futureStates: [], undo: () => { past.pop(); }, redo: () => {}, transaction: <T>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; step(); } } }) },
    },
  } as unknown as AtlasView;
  return { view, fog, log, past };
}

const brush = { type: 'brush', points: [{ x: 5, y: 5 }, { x: 9, y: 9 }], brushRadius: 50, isErasing: false };

test('fog operations are added together in one step, through Atlas\'s addFogOperations', async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  const ids = await writer.addFog('m.atlasmap', [brush, { ...brush, isErasing: true }]);
  assert.deepEqual(ids, ['fog_1', 'fog_2']);
  assert.deepEqual(a.log, ['add 2']);
  assert.equal(a.past.length, 1);
  assert.equal(a.fog.fog_2!.isErasing, true);
});

test('Atlas 0.15 has one operation at a time: they are added one by one, still as one step', async () => {
  const a = atlas('m.atlasmap', { has: ['addFogOperation', 'clearFog'] });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  assert.deepEqual(writer.fogOffers('m.atlasmap'), { add: true, clear: true, cover: false, hideRooms: false, reveal: false, hide: false, forget: false });
  await writer.addFog('m.atlasmap', [brush, brush]);
  assert.deepEqual(a.log, ['add one', 'add one']);
  assert.equal(a.past.length, 1);
  await assert.rejects(writer.coverAllFog('m.atlasmap', RECT), /no way to cover the map/);
  await assert.rejects(writer.hideRooms('m.atlasmap', RECT), /no way to hide rooms/);
  await assert.rejects(writer.revealFogGround('m.atlasmap', []), /no way to reveal fog/);
  await assert.rejects(writer.hideFogArea('m.atlasmap', 'x'), /no way to hide revealed fog/);
  await assert.rejects(writer.forgetFogArea('m.atlasmap', 'x'), /no way to forget revealed fog/);
  assert.deepEqual(a.log, ['add one', 'add one']);
});

test('an Atlas with no fog actions at all is told so, never crashed on', async () => {
  const a = atlas('m.atlasmap', { has: [] });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  assert.deepEqual(writer.fogOffers('m.atlasmap'), { add: false, clear: false, cover: false, hideRooms: false, reveal: false, hide: false, forget: false });
  await assert.rejects(writer.addFog('m.atlasmap', [brush]), /offers no fog tool/);
  await assert.rejects(writer.clearFog('m.atlasmap'), /no way to delete fog/);
});

test('Delete all fog, Cover all and Hide all rooms call the matching store action, with the map as the board draws it', async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  assert.equal(await writer.coverAllFog('m.atlasmap', RECT), true);
  assert.equal(await writer.coverAllFog('m.atlasmap', null), false);
  assert.deepEqual(await writer.hideRooms('m.atlasmap', RECT), { rooms: 3, hidden: 2 });
  await writer.clearFog('m.atlasmap');
  assert.deepEqual(a.log, [`cover ${JSON.stringify(RECT)}`, 'cover null', `rooms ${JSON.stringify(RECT)} undefined`, 'clear']);
  assert.deepEqual(Object.keys(a.fog), []);
});

test('on a map Atlas does not hold the fog is refused, and nothing is written', async () => {
  const a = atlas('other.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.addFog('m.atlasmap', [brush]), NotHeldError);
  await assert.rejects(writer.clearFog('m.atlasmap'), NotHeldError);
  await assert.rejects(writer.coverAllFog('m.atlasmap', RECT), NotHeldError);
  await assert.rejects(writer.hideRooms('m.atlasmap', RECT), NotHeldError);
  await assert.rejects(writer.revealFogGround('m.atlasmap', []), NotHeldError);
  await assert.rejects(writer.hideFogArea('m.atlasmap', 'x'), NotHeldError);
  await assert.rejects(writer.forgetFogArea('m.atlasmap', 'x'), NotHeldError);
  assert.deepEqual(a.log, []);
});

test('fog goes to the level the board shows: while Atlas shows another one nothing is written', async () => {
  const a = atlas('m.atlasmap', { levels: ['ground', 'upper'], viewed: 'ground' });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.addFog('m.atlasmap', [brush], 'upper'), /another level/);
  await assert.rejects(writer.clearFog('m.atlasmap', 'upper'), /another level/);
  await assert.rejects(writer.revealFogGround('m.atlasmap', [], 'upper'), /another level/);
  await assert.rejects(writer.hideFogArea('m.atlasmap', 'x', 'upper'), /another level/);
  await assert.rejects(writer.forgetFogArea('m.atlasmap', 'x', 'upper'), /another level/);
  assert.deepEqual(a.log, []);
  await writer.addFog('m.atlasmap', [brush], 'ground');
  // An unset level is the scene's first, as Atlas reads it.
  const first = atlas('m.atlasmap', { levels: ['ground', 'upper'], viewed: null });
  await new TokenWriter({ views: () => [first.view], held: async () => null }).addFog('m.atlasmap', [brush], 'ground');
  assert.deepEqual(first.log, ['add 1']);
});

test("each fog write is one step of the board's undo, taken back through Atlas's history", async () => {
  const a = atlas('m.atlasmap');
  const history = new UndoHistory();
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  recordAtlasWrites(history, writer);
  await writer.addFog('m.atlasmap', [brush, brush]);
  assert.equal(history.canUndo(['m.atlasmap']), true);
  await writer.clearFog('m.atlasmap');
  await writer.coverAllFog('m.atlasmap', RECT);
  assert.equal(a.past.length, 3);
  assert.equal((await history.undo(['m.atlasmap']))?.done, true);
  assert.equal(a.past.length, 2);
});

test("the fog menu's Reveal, Hide and Delete call Atlas's store actions on the level shown, each one step of the board's undo", async () => {
  const a = atlas('m.atlasmap', { levels: ['ground', 'upper'], viewed: 'ground' });
  const history = new UndoHistory();
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  recordAtlasWrites(history, writer);
  assert.deepEqual(writer.fogOffers('m.atlasmap'), { add: true, clear: true, cover: true, hideRooms: true, reveal: true, hide: true, forget: true });
  const body = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  await writer.revealFogGround('m.atlasmap', [body], 'ground');
  assert.deepEqual(a.fog.fog_1, { id: 'fog_1', kind: 'fog', type: 'lasso', isErasing: true, area: {} });
  assert.equal(await writer.hideFogArea('m.atlasmap', 'fog_1', 'ground'), true);
  assert.equal(a.fog.fog_1!.isErasing, false);
  assert.equal(await writer.hideFogArea('m.atlasmap', 'nope', 'ground'), false);
  assert.equal(await writer.forgetFogArea('m.atlasmap', 'fog_1', 'ground'), true);
  assert.equal('area' in a.fog.fog_1!, false);
  assert.deepEqual(a.log, ['reveal 1', 'hide fog_1', 'hide nope', 'forget fog_1']);
  // Three steps were taken (the id that is none changed nothing).
  assert.equal(a.past.length, 3);
  assert.equal((await history.undo(['m.atlasmap']))?.done, true);
  assert.equal(a.past.length, 2);
  // Another level is refused before anything is written.
  await assert.rejects(writer.revealFogGround('m.atlasmap', [body], 'upper'), /another level/);
});
