import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasSceneState, AtlasView } from '../src/atlas';
import type { StackPlan } from '../src/board/stackMove';
import { NotHeldError, TokenWriter } from '../src/board/tokenWriter';

/** A stand-in for the Atlas view holding `mapPath`: a scene's fields, Atlas's level actions and its history. */
function atlas(mapPath: string, options: { untracked?: boolean; levelActions?: boolean; past?: number; failAlign?: boolean } = {}) {
  const log: string[] = [];
  const past: unknown[] = Array.from({ length: options.past ?? 0 }, () => 1);
  let quiet = 0;
  const mark = (): string => (quiet > 0 ? ' untracked' : '');
  const step = (): void => { if (quiet === 0) past.push(1); };
  const state: Record<string, unknown> = {
    mapPath, mapLoaded: true, isMapLoading: false,
    objects: { tokens: { t1: { id: 't1', x: 1, y: 1 } } }, background: 'img/base.webp', grid: { size: 100 }, exploredMask: 'data:base', viewedLevel: null,
  };
  if (options.levelActions !== false) {
    state.applyLevelScene = (scene: Record<string, unknown>): void => { Object.assign(state, { levels: scene.levels, background: scene.background, objects: scene.objects, exploredMask: scene.exploredMask, exploredMasks: scene.exploredMasks, levelAlignments: scene.levelAlignments }); log.push(`scene ${(scene.levels as unknown[] | undefined)?.length ?? 0}${mark()}`); step(); };
    state.alignLevel = (level: string, alignment: unknown, move?: (point: { x: number; y: number }) => { x: number; y: number }): void => {
      if (options.failAlign) throw new Error('alignLevel broke');
      state.levelAlignments = { ...(state.levelAlignments as object | undefined), [level]: alignment };
      const at = move ? move({ x: 100, y: 200 }) : null;
      log.push(`align ${level} ${at ? `${at.x},${at.y}` : 'no move'}${mark()}`);
      step();
    };
    state.setViewedLevel = (id: string | null): void => { state.viewedLevel = id; log.push(`view ${id}`); };
  }
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [], undo: () => {}, redo: () => {},
      ...(options.untracked === false ? {} : { untracked: <T,>(fn: () => T): T => { quiet += 1; try { return fn(); } finally { quiet -= 1; } } }),
      clear: () => { past.length = 0; log.push('clear'); },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, state, log, past };
}

const plan = (more: Partial<StackPlan> = {}): StackPlan => ({
  scene: { levels: [{ id: 'base' }, { id: 'up' }], background: 'img/base.webp', objects: { tokens: { t1: { id: 't1', x: 1, y: 1 }, t2: { id: 't2', x: 5, y: 5, level: 'up' } } }, exploredMask: 'data:base', exploredMasks: undefined, levelAlignments: undefined, grid: { size: 100 } },
  aligns: [{ level: 'up', alignment: { offset: { x: 60, y: 160 }, scale: 0.5, stretch: { x: 1, y: 1 } }, frame: { k: 0.5, x: 60, y: 160 } }],
  baseLevel: 'base', members: [{ path: 'maps/Up.atlasmap', level: 'up', ids: {}, frame: { k: 0.5, x: 60, y: 160 } }], lost: [], ...more,
});

test("a planned stack is handed to Atlas whole: the scene, each fitted level aligned with its frame's move, the base's level shown; outside the history, which is cleared", async () => {
  const a = atlas('m.atlasmap', { past: 3 });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  let seen: AtlasSceneState | null = null;
  const written = await writer.applyStackMove('m.atlasmap', (state) => { seen = state; return plan(); });
  // Planned on the store's state at the write.
  assert.equal(seen, a.state);
  assert.deepEqual(a.log, ['scene 2 untracked', 'align up 110,260 untracked', 'view base', 'clear']);
  assert.equal(a.past.length, 0);
  assert.equal(written?.baseLevel, 'base');
  assert.deepEqual(Object.keys((a.state.objects as { tokens: object }).tokens), ['t1', 't2']);
  assert.deepEqual(a.state.levelAlignments, { up: { offset: { x: 60, y: 160 }, scale: 0.5, stretch: { x: 1, y: 1 } } });
});

test('a plan of nothing writes nothing', async () => {
  const a = atlas('m.atlasmap', { past: 2 });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  assert.equal(await writer.applyStackMove('m.atlasmap', () => null), null);
  assert.deepEqual(a.log, []);
  assert.equal(a.past.length, 2);
});

test('a write that breaks half way puts the scene back as it was, and says so', async () => {
  const a = atlas('m.atlasmap', { failAlign: true, past: 2 });
  const before = { objects: a.state.objects, background: a.state.background, exploredMask: a.state.exploredMask, levels: a.state.levels };
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await assert.rejects(writer.applyStackMove('m.atlasmap', () => plan()), /alignLevel broke/);
  assert.deepEqual(a.log, ['scene 2 untracked', 'scene 0 untracked', 'view null']);
  assert.equal(a.state.objects, before.objects);
  assert.deepEqual([a.state.background, a.state.exploredMask, a.state.levels, a.state.levelAlignments], [before.background, before.exploredMask, undefined, undefined]);
  // The GM's steps are still there: nothing was moved.
  assert.equal(a.past.length, 2);
});

test('on a map Atlas does not hold, or an Atlas without the level actions, nothing is planned or written', async () => {
  const other = atlas('other.atlasmap');
  let asked = 0;
  const ask = (): StackPlan => { asked += 1; return plan(); };
  await assert.rejects(new TokenWriter({ views: () => [other.view], held: async () => null }).applyStackMove('m.atlasmap', ask), NotHeldError);
  const old = atlas('m.atlasmap', { levelActions: false });
  await assert.rejects(new TokenWriter({ views: () => [old.view], held: async () => null }).applyStackMove('m.atlasmap', ask), /levels/);
  const tracked = atlas('m.atlasmap', { untracked: false });
  await assert.rejects(new TokenWriter({ views: () => [tracked.view], held: async () => null }).applyStackMove('m.atlasmap', ask), /untracked/);
  assert.equal(asked, 0);
  assert.deepEqual([...other.log, ...old.log, ...tracked.log], []);
});
