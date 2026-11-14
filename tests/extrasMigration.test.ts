import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasView } from '../src/atlas';
import { planExtrasMove } from '../src/board/extrasMigration';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';

const wall = (id: string, more: Record<string, unknown> = {}) => ({ id, kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, ...more });
const LEGACY = {
  wallMaterials: { w1: 'Stone', gone: 'Brick' },
  wallHeights: { w1: 3, w2: 0, bad: -1 },
  wallWidths: { w1: 0.3 },
  windows: { w2: { bottom: 1, top: 2 } },
  doorProps: { d1: 'props/door.glb' },
  doorFlips: { d1: { hinge: true as const } },
  lightHeights: { l1: 2, t1: 1.5, l9: 4 },
};
const objects = () => ({
  walls: { w1: wall('w1'), w2: wall('w2', { tabletop: { v: 1, height: 5 } }), d1: wall('d1', { type: 'door' }), bad: wall('bad') },
  lights: { l1: { id: 'l1', x: 0, y: 0 } },
  tokens: { t1: { id: 't1', x: 0, y: 0, light: {} } },
});

test("what data.json kept by Atlas's ids goes to the record of that id: a wall's settings, a placed light's height, a carried light's to its token", () => {
  const plan = planExtrasMove(LEGACY, objects());
  assert.deepEqual(plan.walls, [
    { id: 'w1', change: { material: 'Stone', height: 3, width: 0.3 } },
    // What the record already says stays: only what it lacks is moved.
    { id: 'w2', change: { window: { bottom: 1, top: 2 } } },
    { id: 'd1', change: { prop: 'props/door.glb', hinge: true } },
  ]);
  assert.deepEqual(plan.lights, [{ id: 'l1', height: 2 }]);
  assert.deepEqual(plan.tokens, [{ id: 't1', height: 1.5 }]);
  // Moved: 3 + 1 + 2 + 1 + 1. Dropped: a material and a light whose records Atlas no longer has, a height no wall may have,
  // and a height the record already had.
  assert.deepEqual([plan.moved, plan.dropped], [8, 4]);
});

test('a map with nothing kept, or whose records Atlas does not have, moves nothing', () => {
  assert.deepEqual(planExtrasMove({}, objects()), { walls: [], lights: [], tokens: [], moved: 0, dropped: 0, orphaned: 0 });
  const none = planExtrasMove(LEGACY, {});
  assert.deepEqual([none.walls, none.lights, none.tokens, none.moved], [[], [], [], 0]);
  assert.equal(none.dropped, 12);
  // Junk where a record should be is no record.
  assert.equal(planExtrasMove({ wallHeights: { w1: 2 } }, { walls: { w1: 'x' } } as never).moved, 0);
});

/** A stand-in for the Atlas view holding `mapPath`, with a history that tells tracked writes from untracked ones. */
function atlas(mapPath: string, state: ReturnType<typeof objects>) {
  const log: string[] = [];
  let depth = 0;
  const update = (record: Record<string, Record<string, unknown>>, what: string) => (id: string, changes: Record<string, unknown>): void => {
    Object.assign(record[id]!, changes);
    log.push(`${what} ${id}${depth > 0 ? '' : ' TRACKED'}`);
  };
  const store = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: state,
    updateWall: update(state.walls, 'updateWall'), updateLight: update(state.lights, 'updateLight'), updateToken: update(state.tokens, 'updateToken'),
  };
  const temporal = { getState: () => ({ pastStates: [], futureStates: [], undo: () => {}, redo: () => {}, untracked: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; } } }) };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => store, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, state, log };
}

test("the move writes each value onto Atlas's record outside its undo, and a second move finds nothing left to do", async () => {
  const a = atlas('m.atlasmap', objects());
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.applyExtrasMove('m.atlasmap', planExtrasMove(LEGACY, a.state));
  assert.deepEqual(a.state.walls.w1.tabletop, { v: 1, material: 'Stone', height: 3, width: 0.3 });
  assert.deepEqual(a.state.walls.w2.tabletop, { v: 1, height: 5, window: { bottom: 1, top: 2 } });
  assert.deepEqual(a.state.walls.d1.tabletop, { v: 1, prop: 'props/door.glb', hinge: true });
  assert.deepEqual([(a.state.lights.l1 as { tabletop?: unknown }).tabletop, (a.state.tokens.t1 as { tabletop?: unknown }).tabletop], [{ v: 1, height: 2 }, { v: 1, lightHeight: 1.5 }]);
  assert.ok(a.log.length === 5 && a.log.every((line) => !line.endsWith('TRACKED')), a.log.join('; '));
  // Run again (interrupted before data.json was cleared): everything is on the records already.
  const again = planExtrasMove(LEGACY, a.state);
  assert.deepEqual([again.walls, again.lights, again.tokens, again.moved], [[], [], [], 0]);
});

test('on a map Atlas does not hold nothing is moved', async () => {
  const a = atlas('other.atlasmap', objects());
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.applyExtrasMove('m.atlasmap', planExtrasMove(LEGACY, a.state)), NotHeldError);
  assert.deepEqual(a.log, []);
});
