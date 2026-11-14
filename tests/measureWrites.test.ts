import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { MeasureFullError, NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordAtlasWrites } from '../src/board/undoRecorders';

/** A stand-in for the Atlas view holding `mapPath`: its measures, Atlas's actions on them and its history's transaction. */
function atlas(mapPath: string, cap = 256) {
  const measures: Record<string, Record<string, unknown>> = {};
  const log: string[] = [];
  const past: unknown[] = [];
  let depth = 0;
  let next = 0;
  const step = (): void => { if (depth === 0) past.push(1); };
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: {}, measures },
    addMeasure: (data: Record<string, unknown>): string | null => {
      if (Object.keys(measures).length >= cap) return null;
      const id = `measure_${++next}`;
      measures[id] = { ...data, id, kind: 'measure' };
      log.push(`add ${id}${depth > 0 ? ' in transaction' : ''}`);
      step();
      return id;
    },
    deleteMeasure: (id: string): void => { delete measures[id]; log.push(`delete ${id}${depth > 0 ? ' in transaction' : ''}`); step(); },
  };
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [],
      undo: () => { past.pop(); }, redo: () => {},
      transaction: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; past.push(1); log.push('transaction'); } },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, measures, log, past };
}

const circle = { shape: 'circle' as const, points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], tabletop: { v: 1, kind: 'spell' } };

test("a cast on a map Atlas holds is one measure of Atlas's, written in one step of its history", async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  const id = await writer.addMeasure('m.atlasmap', circle);
  assert.equal(id, 'measure_1');
  assert.deepEqual(a.measures.measure_1, { ...circle, id: 'measure_1', kind: 'measure' });
  assert.deepEqual(a.log, ['add measure_1 in transaction', 'transaction']);
  assert.equal(a.past.length, 1);
});

test('on a map Atlas does not hold the cast is refused, and nothing is written', async () => {
  const a = atlas('other.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.addMeasure('m.atlasmap', circle), NotHeldError);
  await assert.rejects(writer.removeMeasures('m.atlasmap', ['measure_1']), NotHeldError);
  assert.deepEqual(a.log, []);
});

test("when Atlas's level holds no more measures the cast is refused as full", async () => {
  const a = atlas('m.atlasmap', 1);
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.addMeasure('m.atlasmap', circle);
  await assert.rejects(writer.addMeasure('m.atlasmap', circle), MeasureFullError);
  assert.equal(Object.keys(a.measures).length, 1);
});

test('measures are removed together in one step; one Atlas no longer has is passed over', async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.addMeasure('m.atlasmap', circle);
  await writer.addMeasure('m.atlasmap', circle);
  a.log.length = 0;
  a.past.length = 0;
  await writer.removeMeasures('m.atlasmap', ['measure_1', 'gone', 'measure_2']);
  assert.deepEqual(a.log, ['delete measure_1 in transaction', 'delete measure_2 in transaction', 'transaction']);
  assert.equal(a.past.length, 1);
  // Nothing to remove: Atlas's history gains no step.
  await writer.removeMeasures('m.atlasmap', ['gone']);
  assert.equal(a.past.length, 1);
});

test("a cast and its removal are steps of the board's undo, taken back through Atlas's history", async () => {
  const a = atlas('m.atlasmap');
  const history = new UndoHistory();
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  recordAtlasWrites(history, writer);
  await writer.addMeasure('m.atlasmap', circle);
  assert.equal(history.canUndo(['m.atlasmap']), true);
  assert.equal((await history.undo(['m.atlasmap']))?.done, true);
  assert.equal(a.past.length, 0);
});
