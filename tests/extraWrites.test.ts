import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordAtlasWrites } from '../src/board/undoRecorders';

type Rec = Record<string, Record<string, unknown>>;

/** A stand-in for the Atlas view holding `mapPath`: its walls, lights and tokens, Atlas's update actions and its history's transaction. */
function atlas(mapPath: string, objects: { walls?: Rec; lights?: Rec; tokens?: Rec } = {}) {
  const walls = objects.walls ?? {};
  const lights = objects.lights ?? {};
  const tokens = objects.tokens ?? {};
  const log: string[] = [];
  const past: unknown[] = [];
  let depth = 0;
  const update = (record: Rec, what: string) => (id: string, changes: Record<string, unknown>): void => {
    Object.assign(record[id]!, changes);
    for (const [key, value] of Object.entries(changes)) if (value === undefined) delete record[id]![key];
    log.push(`${what} ${id}${depth > 0 ? ' in transaction' : ''}`);
    if (depth === 0) past.push(1);
  };
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens, walls, lights },
    updateWall: update(walls, 'updateWall'), updateLight: update(lights, 'updateLight'), updateToken: update(tokens, 'updateToken'),
  };
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [], undo: () => { past.pop(); }, redo: () => {},
      transaction: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; past.push(1); log.push('transaction'); } },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, walls, lights, tokens, log, past };
}

const wall = (id: string, more: Record<string, unknown> = {}) => ({ id, kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, ...more });

test("a wall's 3D extras are written to Atlas's own records: several walls in one step, other keys of the field kept, a key given as null gone", async () => {
  const a = atlas('m.atlasmap', { walls: { w1: wall('w1'), w2: wall('w2', { tabletop: { v: 1, height: 2, material: 'Stone' } }), w3: wall('w3') } });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.setWallExtras('m.atlasmap', ['w1', 'w2', 'gone'], { height: 3 });
  assert.deepEqual([a.walls.w1!.tabletop, a.walls.w2!.tabletop, a.walls.w3!.tabletop], [{ v: 1, height: 3 }, { v: 1, height: 3, material: 'Stone' }, undefined]);
  assert.deepEqual(a.log, ['updateWall w1 in transaction', 'updateWall w2 in transaction', 'transaction']);
  assert.equal(a.past.length, 1);
  // Back to the default: the key goes, and a field with nothing left goes whole.
  await writer.setWallExtras('m.atlasmap', ['w1', 'w2'], { height: null });
  assert.equal('tabletop' in a.walls.w1!, false);
  assert.deepEqual(a.walls.w2!.tabletop, { v: 1, material: 'Stone' });
  // Nothing of it on this map: Atlas's history gains no step.
  const steps = a.past.length;
  await writer.setWallExtras('m.atlasmap', ['gone'], { height: 1 });
  assert.equal(a.past.length, steps);
});

test("a light's height is written to the light's record, a carried light's to its token", async () => {
  const a = atlas('m.atlasmap', { lights: { l1: { id: 'l1', x: 0, y: 0 } }, tokens: { t1: { id: 't1', x: 0, y: 0, light: {}, tabletop: { v: 1, other: true } } } });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.setLightHeight('m.atlasmap', 'l1', 2.5);
  await writer.setLightHeight('m.atlasmap', 't1', 1);
  assert.deepEqual([a.lights.l1!.tabletop, a.tokens.t1!.tabletop], [{ v: 1, height: 2.5 }, { v: 1, other: true, lightHeight: 1 }]);
  await writer.setLightHeight('m.atlasmap', 'l1', null);
  await writer.setLightHeight('m.atlasmap', 't1', null);
  assert.equal('tabletop' in a.lights.l1!, false);
  assert.deepEqual(a.tokens.t1!.tabletop, { v: 1, other: true });
  assert.deepEqual(a.log.filter((line) => line !== 'transaction'), ['updateLight l1 in transaction', 'updateToken t1 in transaction', 'updateLight l1 in transaction', 'updateToken t1 in transaction']);
  // Neither a light nor a token of this map: nothing.
  await writer.setLightHeight('m.atlasmap', 'none', 3);
  assert.equal(a.log.filter((line) => line !== 'transaction').length, 4);
});

test('on a map Atlas does not hold the extras are refused, and nothing is written', async () => {
  const a = atlas('other.atlasmap', { walls: { w1: wall('w1') }, lights: { l1: { id: 'l1' } } });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.setWallExtras('m.atlasmap', ['w1'], { height: 3 }), NotHeldError);
  await assert.rejects(writer.setLightHeight('m.atlasmap', 'l1', 3), NotHeldError);
  assert.deepEqual(a.log, []);
});

test("a wall's extras set from the board are steps of the board's undo, taken back through Atlas's history", async () => {
  const a = atlas('m.atlasmap', { walls: { w1: wall('w1') } });
  const history = new UndoHistory();
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  recordAtlasWrites(history, writer);
  await writer.setWallExtras('m.atlasmap', ['w1'], { material: 'Stone' });
  assert.equal(history.canUndo(['m.atlasmap']), true);
  assert.equal((await history.undo(['m.atlasmap']))?.done, true);
  assert.equal(a.past.length, 0);
});
