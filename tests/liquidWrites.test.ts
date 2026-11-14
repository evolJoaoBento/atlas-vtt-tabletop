import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { readMapState } from '../src/board/mapModel';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordAtlasWrites } from '../src/board/undoRecorders';

const triangle = [{ x: 0, y: 0 }, { x: 0, y: 70 }, { x: 70, y: 70 }];
const liquid = (id: string, more: Record<string, unknown> = {}) => ({ id, kind: 'liquid', liquid: 'water', polygon: triangle, colors: { surface: '#3b82f6', deep: '#1e3a8a', glint: '#93c5fd' }, ...more });

/** A stand-in for the Atlas view holding `mapPath`: its liquids, Atlas's two actions on them and its history. */
function atlas(mapPath: string, liquids: Record<string, Record<string, unknown>> = {}, options: { untracked?: boolean; past?: number; cap?: number } = {}) {
  const log: string[] = [];
  const past: unknown[] = Array.from({ length: options.past ?? 0 }, () => 1);
  let depth = 0;
  let quiet = 0;
  let next = 0;
  const step = (): void => { if (depth === 0 && quiet === 0) past.push(1); };
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: {}, liquids },
    addLiquids: (data: ReadonlyArray<Record<string, unknown>>): string[] => {
      const ids: string[] = [];
      for (const input of data) {
        if (Object.keys(liquids).length >= (options.cap ?? 256)) continue;
        const id = `liquid_${++next}`;
        liquids[id] = { id, kind: 'liquid', ...input };
        ids.push(id);
      }
      log.push(`add ${ids.length}${quiet > 0 ? ' untracked' : depth > 0 ? ' in transaction' : ''}`);
      step();
      return ids;
    },
    deleteLiquid: (id: string): void => { delete liquids[id]; log.push(`delete ${id}${quiet > 0 ? ' untracked' : depth > 0 ? ' in transaction' : ''}`); step(); },
  };
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [], undo: () => { past.pop(); }, redo: () => {},
      transaction: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; past.push(1); log.push('transaction'); } },
      ...(options.untracked === false ? {} : { untracked: <T,>(fn: () => T): T => { quiet += 1; try { return fn(); } finally { quiet -= 1; } } }),
      clear: () => { past.length = 0; log.push('clear'); },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, liquids, log, past };
}

test("the map's liquids are read from Atlas's store, those of the level shown", () => {
  const state = (liquids: unknown, extra: Record<string, unknown> = {}) => ({ mapPath: 'm.atlasmap', backgroundImage: null, grid: { size: 70 }, objects: { tokens: {}, liquids }, ...extra });
  const raw = { a: liquid('a', { tabletop: { v: 1, brush: true, motion: { kind: 'flow' } } }), b: liquid('b', { liquid: 'lava' }), junk: 'x' };
  assert.deepEqual(readMapState('m.atlasmap', state(raw)).liquids.map((each) => [each.id, each.liquid, each.brush]), [['a', 'water', true], ['b', 'lava', false]]);
  assert.deepEqual(readMapState('m.atlasmap', state(undefined)).liquids, []);
  const levels = [{ id: 'ground', name: 'Ground', elevation: { bottom: 0 } }, { id: 'upper', name: 'Upper', elevation: { bottom: 10 } }];
  const split = { low: liquid('low'), high: liquid('high', { level: 'upper' }) };
  assert.deepEqual(readMapState('m.atlasmap', state(split, { levels }), 'upper').liquids.map((each) => each.id), ['high']);
  assert.deepEqual(readMapState('m.atlasmap', state(split, { levels }), 'ground').liquids.map((each) => each.id), ['low']);
});

test("a finished stroke replaces the brush's liquids with its outlines in one step of Atlas's undo; one Atlas no longer has is passed over", async () => {
  const a = atlas('m.atlasmap', { old1: liquid('old1'), old2: liquid('old2'), atlasOwn: liquid('atlasOwn', { liquid: 'lava' }) });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  const ids = await writer.replaceLiquids('m.atlasmap', ['old1', 'gone', 'old2'], [{ liquid: 'water', polygon: triangle }, { liquid: 'water', polygon: triangle }]);
  assert.deepEqual(ids, ['liquid_1', 'liquid_2']);
  assert.deepEqual(Object.keys(a.liquids), ['atlasOwn', 'liquid_1', 'liquid_2']);
  assert.deepEqual(a.log, ['delete old1 in transaction', 'delete old2 in transaction', 'add 2 in transaction', 'transaction']);
  assert.equal(a.past.length, 1);
  // Nothing to take off and nothing to add: no step.
  assert.deepEqual(await writer.replaceLiquids('m.atlasmap', ['gone'], []), []);
  assert.equal(a.past.length, 1);
  // The last water erased: only a removal.
  await writer.replaceLiquids('m.atlasmap', ['liquid_1', 'liquid_2'], []);
  assert.deepEqual(Object.keys(a.liquids), ['atlasOwn']);
});

test('on a map Atlas does not hold the water is refused, and nothing is written', async () => {
  const a = atlas('other.atlasmap', { old: liquid('old') });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.replaceLiquids('m.atlasmap', ['old'], [{ liquid: 'water', polygon: triangle }]), NotHeldError);
  await assert.rejects(writer.applyWaterMove('m.atlasmap', [{ liquid: 'water', polygon: triangle }]), NotHeldError);
  assert.deepEqual(a.log, []);
});

test("a stroke is a step of the board's undo, taken back through Atlas's history", async () => {
  const a = atlas('m.atlasmap');
  const history = new UndoHistory();
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  recordAtlasWrites(history, writer);
  await writer.replaceLiquids('m.atlasmap', [], [{ liquid: 'water', polygon: triangle }]);
  assert.equal(history.canUndo(['m.atlasmap']), true);
  assert.equal((await history.undo(['m.atlasmap']))?.done, true);
  assert.equal(a.past.length, 0);
});

test("the move of a map's painted water is written outside Atlas's undo, whole or not at all, and lets Atlas's older steps go", async () => {
  const add = [{ liquid: 'water', polygon: triangle }, { liquid: 'water', polygon: triangle }];
  const a = atlas('m.atlasmap', { atlasOwn: liquid('atlasOwn') }, { past: 2 });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  assert.deepEqual(await writer.applyWaterMove('m.atlasmap', add), ['liquid_1', 'liquid_2']);
  assert.deepEqual(a.log, ['add 2 untracked', 'clear']);
  assert.deepEqual(Object.keys(a.liquids), ['atlasOwn', 'liquid_1', 'liquid_2']);
  // No way to write outside the history: nothing is moved.
  const old = atlas('m.atlasmap', {}, { untracked: false });
  await assert.rejects(new TokenWriter({ views: () => [old.view], held: async () => null }).applyWaterMove('m.atlasmap', add), /untracked/);
  assert.deepEqual(old.log, []);
  // The level takes no more: what was added is taken off again, and the move says so.
  const full = atlas('m.atlasmap', { atlasOwn: liquid('atlasOwn') }, { cap: 2 });
  await assert.rejects(new TokenWriter({ views: () => [full.view], held: async () => null }).applyWaterMove('m.atlasmap', add), /holds no more/);
  assert.deepEqual(Object.keys(full.liquids), ['atlasOwn']);
  // Nothing to move: nothing is written, and Atlas's steps stay.
  const idle = atlas('m.atlasmap', {}, { past: 3 });
  assert.deepEqual(await new TokenWriter({ views: () => [idle.view], held: async () => null }).applyWaterMove('m.atlasmap', []), []);
  assert.equal(idle.past.length, 3);
});
