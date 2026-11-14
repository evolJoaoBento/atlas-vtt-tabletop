import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spellToMeasure, type SpellLike } from '../packages/atlas-host/src/spellMeasure';
import type { AtlasView } from '../src/atlas';
import { planReconcile, reconcileSpells } from '../src/board/spellReconciler';
import { SpellUpkeep } from '../src/board/spellUpkeep';

const SCALE = { unitsPerFoot: 1, pxPerUnit: 70 / 5 };
const ball: SpellLike = { shape: 'sphere', from: 'point', at: { x: 500, y: 500, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1 };
const wallSpell: SpellLike = { shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 300, y: 0 }, yaw: 0, pitch: 0, roll: 0, size: 10, length: 100, angle: 1 };
const kept = (id: string, spell: SpellLike, rules: object, extra: object = {}): Record<string, unknown> => ({ id, kind: 'measure', ...JSON.parse(JSON.stringify(spellToMeasure(spell, { rules }))), ...extra });

/** A stand-in for the Atlas view holding a map: its records, Atlas's actions on them and its history. */
function atlas(measures: Record<string, Record<string, unknown>>, walls: Record<string, Record<string, unknown>> = {}, mapFeatures: Record<string, Record<string, unknown>> = {}) {
  const log: string[] = [];
  let next = 0;
  let depth = 0;
  let travelling = false;
  const note = (what: string): void => { log.push(depth > 0 ? what : `${what} TRACKED`); };
  const state = {
    mapPath: 'm.atlasmap', mapLoaded: true, isMapLoading: false,
    objects: { tokens: {} as Record<string, Record<string, unknown>>, measures, walls, mapFeatures },
    addWall: (data: Record<string, unknown>): string => { const id = `wall_${++next}`; walls[id] = { id, kind: 'wall', ...data }; note('addWall'); return id; },
    deleteWalls: (ids: string[]): void => { for (const id of ids) delete walls[id]; note(`deleteWalls ${ids.length}`); },
    addMapFeatures: (data: ReadonlyArray<Record<string, unknown>>): string[] => data.map((one) => { const id = `feature_${++next}`; mapFeatures[id] = { id, kind: 'map-feature', ...one }; note('addMapFeature'); return id; }),
    deleteMapFeature: (id: string): void => { delete mapFeatures[id]; note('deleteMapFeature'); },
    updateMeasure: (id: string, changes: Record<string, unknown>): void => { Object.assign(measures[id]!, changes); note(`updateMeasure ${Object.keys(changes).join()}`); },
  };
  const temporal = {
    getState: () => ({
      pastStates: [], futureStates: [], undo: () => {}, redo: () => {},
      isTravelling: () => travelling,
      untracked: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; } },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, state, measures, walls, mapFeatures, log, travel: (on: boolean) => { travelling = on; } };
}

test("a kept spell with rules and none of Atlas's records for them gets them: its walls, its difficult ground, its light, all untracked", () => {
  const a = atlas({
    stone: kept('stone', wallSpell, { wall: { look: 'stone', blocks: 'both' } }, { level: 'upper' }),
    web: kept('web', ball, { name: 'Web', difficult: true }),
    day: kept('day', ball, { light: { bright: 20, dim: 20 } }),
  });
  assert.equal(reconcileSpells(a.view, SCALE), 3);
  assert.deepEqual(Object.values(a.walls).map((wall) => [wall.chainId, wall.levels]), [['spell:stone', ['upper']]]);
  assert.deepEqual(Object.values(a.mapFeatures).map((feature) => [feature.name, feature.terrain, feature.tabletop]), [['Web', { difficult: true }, { spell: 'web' }]]);
  assert.deepEqual((a.measures.day!.light as { bright: number; dim: number }).dim, 40);
  assert.ok(a.log.length === 3 && a.log.every((line) => !line.endsWith('TRACKED')), a.log.join('; '));
  // All is in order now: a second pass writes nothing.
  a.log.length = 0;
  assert.equal(reconcileSpells(a.view, SCALE), 0);
  assert.deepEqual(a.log, []);
});

test('walls and ground whose spell is gone are taken away; walls drawn in Atlas and features made there are never touched', () => {
  const a = atlas({}, {
    orphan: { id: 'orphan', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'spell:gone' },
    drawn: { id: 'drawn', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'chain_123' },
    plain: { id: 'plain', kind: 'wall', type: 'door', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 } },
  }, {
    stale: { id: 'stale', kind: 'map-feature', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], name: 'Web', terrain: { difficult: true }, tabletop: { spell: 'gone' } },
    rubble: { id: 'rubble', kind: 'map-feature', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], name: 'Rubble', terrain: { difficult: true } },
    junk: { id: 'junk', kind: 'map-feature', polygon: [], name: 'x', tabletop: 'spell' },
  });
  assert.equal(reconcileSpells(a.view, SCALE), 2);
  assert.deepEqual([Object.keys(a.walls), Object.keys(a.mapFeatures)], [['drawn', 'plain'], ['rubble', 'junk']]);
});

test('a spell moved in Atlas has its walls and ground made again where it lies now; one whose rules no longer read loses them', () => {
  const a = atlas({ fog: kept('fog', ball, { obscure: true, difficult: true }) });
  reconcileSpells(a.view, SCALE);
  assert.equal(Object.keys(a.walls).length, 32);
  // Dragged in Atlas: its two points move, its 3D shape with them.
  const points = a.measures.fog!.points as Array<{ x: number; y: number }>;
  a.measures.fog = { ...a.measures.fog!, points: points.map((point) => ({ x: point.x + 700, y: point.y })) };
  a.log.length = 0;
  assert.equal(reconcileSpells(a.view, SCALE) > 0, true);
  const walls = Object.values(a.walls);
  assert.equal(walls.length, 32);
  assert.ok(walls.every((wall) => Math.abs(Math.hypot((wall.p1 as { x: number }).x - 1200, (wall.p1 as { y: number }).y - 500) - 140) < 3));
  assert.equal(Object.keys(a.mapFeatures).length, 1);
  assert.ok(a.log.every((line) => !line.endsWith('TRACKED')));
  // Junk in the measure's own field (edited by hand): no spell is read from it, and what it stood goes.
  a.measures.fog = { ...a.measures.fog!, tabletop: { v: 1, kind: 'spell', rules: 'all of them' } };
  reconcileSpells(a.view, SCALE);
  assert.deepEqual([Object.keys(a.walls).length, Object.keys(a.mapFeatures).length], [0, 0]);
});

test("a spell on a level not shown keeps its records: every level's measures are asked, not the shown level's", () => {
  const a = atlas({ low: kept('low', wallSpell, { wall: { look: 'stone', blocks: 'both' } }), high: kept('high', wallSpell, { wall: { look: 'ice', blocks: 'both' } }, { level: 'upper' }) });
  reconcileSpells(a.view, SCALE);
  assert.deepEqual(planReconcile(a.state.objects, SCALE), { deleteWalls: [], addWalls: [], deleteFeatures: [], addFeatures: [], lights: [] });
  assert.deepEqual(Object.values(a.walls).map((wall) => wall.levels), [undefined, ['upper']]);
});

test('a light the GM changed or a darkness Atlas cannot make is left alone; nothing is written while Atlas loads a map or travels its history', () => {
  const edited = { bright: 5, dim: 5, color: '#00ff00', intensity: 1, animation: 'none' };
  const a = atlas({ day: kept('day', ball, { light: { bright: 20, dim: 20 } }, { light: edited }), cube: kept('cube', { ...ball, shape: 'cube' }, { dark: true }) });
  assert.equal(reconcileSpells(a.view, SCALE), 0);
  assert.equal(a.measures.day!.light, edited);
  const b = atlas({ web: kept('web', ball, { difficult: true }) });
  b.state.isMapLoading = true;
  assert.equal(reconcileSpells(b.view, SCALE), 0);
  b.state.isMapLoading = false;
  b.travel(true);
  assert.equal(reconcileSpells(b.view, SCALE), 0);
  b.travel(false);
  assert.equal(reconcileSpells(b.view, SCALE), 1);
});

test('with nothing to shape by, a pass only takes away what stands for a spell that is gone: nothing is made, nothing that still has its spell is touched', () => {
  const a = atlas({ stone: kept('stone', wallSpell, { wall: { look: 'stone', blocks: 'both' } }), web: kept('web', ball, { difficult: true }) }, {
    orphan: { id: 'orphan', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'spell:gone' },
    moved: { id: 'moved', kind: 'wall', type: 'solid', p1: { x: 5, y: 5 }, p2: { x: 10, y: 5 }, chainId: 'spell:stone' },
    drawn: { id: 'drawn', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'chain_1' },
  }, {
    stale: { id: 'stale', kind: 'map-feature', polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], name: 'Web', terrain: { difficult: true }, tabletop: { spell: 'gone' } },
  });
  assert.deepEqual(planReconcile(a.state.objects, null), { deleteWalls: ['orphan'], addWalls: [], deleteFeatures: ['stale'], addFeatures: [], lights: [] });
  assert.equal(reconcileSpells(a.view, null), 2);
  assert.deepEqual([Object.keys(a.walls), Object.keys(a.mapFeatures)], [['moved', 'drawn'], []]);
  assert.ok(a.log.every((line) => !line.endsWith('TRACKED')));
});

test("a spell that follows a token stands its walls and ground round the token, and a measure is known by its place in Atlas's record", () => {
  const a = atlas({ fog: { ...kept('other-id', ball, { obscure: true }), follows: 't1', aura: 10 } });
  a.state.objects.tokens.t1 = { id: 't1', x: 2000, y: 1000 };
  reconcileSpells(a.view, SCALE);
  const walls = Object.values(a.walls);
  assert.equal(walls.length, 32);
  assert.ok(walls.every((wall) => wall.chainId === 'spell:fog' && Math.abs(Math.hypot((wall.p1 as { x: number }).x - 2000, (wall.p1 as { y: number }).y - 1000) - 140) < 3));
  // Its token gone from the map: it stands nothing.
  delete a.state.objects.tokens.t1;
  reconcileSpells(a.view, SCALE);
  assert.equal(Object.keys(a.walls).length, 0);
});

test('the upkeep of every open Atlas map takes a gone spell\'s walls away with no board open, once the store has been still', () => {
  const a = atlas({}, { orphan: { id: 'orphan', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'spell:gone' } });
  const timers: Array<() => void> = [];
  let listener: (() => void) | null = null;
  let stopped = 0;
  (a.view.atlasStore as { subscribe: unknown }).subscribe = (fn: () => void) => { listener = fn; return () => { stopped += 1; listener = null; }; };
  let open = [a.view];
  const upkeep = new SpellUpkeep(() => open, { setTimeout: ((fn: () => void) => { timers.push(fn); return timers.length; }) as never, clearTimeout: (() => {}) as never });
  upkeep.sync();
  assert.equal(Object.keys(a.walls).length, 1);
  timers.pop()!();
  assert.deepEqual(Object.keys(a.walls), []);
  // A spell removed later (a player's, through Connect) leaves its wall for the next pass.
  a.walls.late = { id: 'late', kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, chainId: 'spell:gone-too' };
  // Atlas hands out new records when one changes: here the measures, with the spell gone.
  a.state.objects = { ...a.state.objects, measures: {} };
  listener!();
  timers.pop()!();
  assert.deepEqual(Object.keys(a.walls), []);
  // The view closed: it is followed no more.
  open = [];
  upkeep.sync();
  assert.equal(stopped, 1);
  upkeep.dispose();
});
