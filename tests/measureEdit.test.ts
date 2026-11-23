import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spellToMeasure, type SpellLike } from '../packages/atlas-host/src/index';
import type { AtlasView } from '../src/atlas';
import { deleteTargetOf, dragPoints, editableMeasures, handleSpots, hitHandle, mayEditMeasures, turnSpot, type Handle } from '../src/board/measureEdit';
import type { BoardMeasure } from '../src/board/boardMeasures';
import { TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordAtlasWrites } from '../src/board/undoRecorders';

const grid = { type: 'square' as const, size: 70, offsetX: 0, offsetY: 0, snap: true };
const area = (id: string, shape: 'circle' | 'cone' | 'ruler' | 'line', points: Array<{ x: number; y: number }>, extra: Record<string, unknown> = {}): BoardMeasure =>
  ({ id, record: { shape, points, ...extra } as never });
const spell: SpellLike = { shape: 'sphere', from: 'point', at: { x: 700, y: 420, h: 70 }, yaw: 0, pitch: 0, roll: 0, size: 140, length: 0, angle: 1, effect: 'fire' };

test('every kept area, ruler and template has a handle; a cast spell, which has its own, has none', () => {
  const list = [
    area('a', 'cone', [{ x: 0, y: 0 }, { x: 140, y: 0 }]),
    area('b', 'ruler', [{ x: 0, y: 0 }, { x: 70, y: 70 }]),
    area('t', 'circle', [{ x: 0, y: 0 }, { x: 70, y: 0 }], { tabletop: { v: 1, kind: 'template', owner: 'gm' } }),
    { id: 's', record: JSON.parse(JSON.stringify(spellToMeasure(spell))) },
  ];
  assert.deepEqual(editableMeasures(list).map(({ id }) => id), ['a', 'b', 't']);
});

test('handles stand at the origin and, on an area, at its far end; a ruler has one; an aura only its badge', () => {
  const cone = area('a', 'cone', [{ x: 100, y: 100 }, { x: 240, y: 100 }]);
  const ruler = area('b', 'ruler', [{ x: 10, y: 10 }, { x: 80, y: 80 }]);
  const aura = area('c', 'circle', [{ x: 300, y: 300 }, { x: 440, y: 300 }], { follows: 't1', aura: 2 });
  const spots = handleSpots([cone, ruler, aura], [{ id: 't1', x: 300, y: 300, size: 1 }], 70);
  assert.deepEqual(spots.get('a'), { origin: { x: 100, y: 100 }, end: { x: 240, y: 100 }, drags: true });
  assert.deepEqual(spots.get('b'), { origin: { x: 10, y: 10 }, end: null, drags: true });
  const badge = spots.get('c');
  // Beside its token, on its rim, not in its middle; it cannot be moved.
  assert.ok(badge && Math.hypot(badge.origin.x - 300, badge.origin.y - 300) > 30);
  assert.equal(badge?.drags, false);
  assert.equal(badge?.end, null);
});

test('a measurement that starts on a token has its badge on the rim of the token, so the token keeps its middle', () => {
  const ruler = area('b', 'ruler', [{ x: 300, y: 300 }, { x: 440, y: 300 }]);
  const spot = handleSpots([ruler], [{ id: 't1', x: 300, y: 300, size: 1 }], 70).get('b');
  assert.ok(spot);
  assert.ok(Math.abs(Math.hypot(spot.origin.x - 300, spot.origin.y - 300) - 35) < 0.01);
  assert.equal(spot.drags, true);
});

test('the handle under a press: the nearest within its reach, the later of two as near, none when away', () => {
  const handles: Handle[] = [
    { id: 'a', part: 'origin', x: 100, y: 100 },
    { id: 'b', part: 'origin', x: 100, y: 100 },
    { id: 'a', part: 'end', x: 200, y: 100 },
  ];
  assert.deepEqual(hitHandle(handles, 104, 100), { id: 'b', part: 'origin' });
  assert.deepEqual(hitHandle(handles, 205, 100), { id: 'a', part: 'end' });
  assert.equal(hitHandle(handles, 150, 100), null);
  // The end dot's reach is smaller than the badge's.
  assert.equal(hitHandle(handles, 100 + 11, 100)?.part, 'origin');
  assert.equal(hitHandle(handles, 200 + 11, 100), null);
});

test('a drag moves the whole measurement snapped, resizes an area by its far end, or turns it by its turn handle', () => {
  const cone = area('a', 'cone', [{ x: 100, y: 100 }, { x: 240, y: 100 }]).record as never;
  const moved = dragPoints(cone, 'origin', { x: 33, y: 5 }, grid, false, null);
  assert.ok(moved);
  // The first point snaps to the half cell (35); the far end keeps its distance.
  assert.equal(moved[0].x % 35, 0);
  assert.equal(moved[0].y % 35, 0);
  assert.equal(moved[1].x - moved[0].x, 140);
  const resized = dragPoints(cone, 'end', { x: 70, y: 0 }, grid, false, null);
  assert.deepEqual(resized?.[0], { x: 100, y: 100 });
  assert.ok(resized![1].x > 240);
  // Free (Alt) places where the pointer is.
  assert.deepEqual(dragPoints(cone, 'origin', { x: 3, y: 4 }, grid, true, null), [{ x: 103, y: 104 }, { x: 243, y: 104 }]);
  const turned = dragPoints(cone, 'turn', { x: 0, y: -16 }, grid, false, { x: 240, y: 116 });
  assert.ok(turned);
  assert.ok(Math.abs(Math.hypot(turned[1].x - 100, turned[1].y - 100) - 140) < 1e-6);
  // An aura stays with its token: nothing to drag.
  assert.equal(dragPoints({ shape: 'circle', points: [{ x: 100, y: 100 }, { x: 240, y: 100 }], follows: 't', aura: 2 } as never, 'origin', { x: 5, y: 5 }, grid, false, null), null);
});

test('the turn handle stands beside the far end, square to the way the area points, and a circle and a ruler have none', () => {
  const cone = { shape: 'cone', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  assert.deepEqual(turnSpot(cone as never, 0.5), { x: 100, y: 8 });
  assert.equal(turnSpot({ shape: 'circle', points: cone.points } as never, 0.5), null);
  assert.equal(turnSpot({ shape: 'ruler', points: cone.points } as never, 0.5), null);
});

test('Delete takes the measurement under the pointer, else the one whose popover is open, and none when it cannot be edited', () => {
  assert.equal(deleteTargetOf({ hovered: 'a', open: 'b', editable: ['a', 'b'] }), 'a');
  assert.equal(deleteTargetOf({ hovered: null, open: 'b', editable: ['a', 'b'] }), 'b');
  assert.equal(deleteTargetOf({ hovered: 'x', open: null, editable: ['a'] }), null);
  assert.equal(deleteTargetOf({ hovered: null, open: null, editable: ['a'] }), null);
});

test('measurements are edited on the GM board of a loaded map, in GM view, and nowhere else', () => {
  const ok = { gm: true, gmView: true, loaded: true, eye: false, cinematic: false, writes: true };
  assert.equal(mayEditMeasures(ok), true);
  for (const bad of [{ gm: false }, { gmView: false }, { loaded: false }, { eye: true }, { cinematic: true }, { writes: false }]) assert.equal(mayEditMeasures({ ...ok, ...bad }), false);
});

/** A stand-in for the Atlas view with updateMeasure, history and its transaction. */
function atlas(mapPath: string, withUpdate = true) {
  const measures: Record<string, Record<string, unknown>> = { m1: { id: 'm1', shape: 'cone', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] } };
  const log: string[] = [];
  const past: unknown[] = [];
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: {}, measures },
    ...(withUpdate && {
      updateMeasure: (id: string, changes: Record<string, unknown>) => {
        const next = { ...measures[id], ...changes };
        for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
        measures[id] = next;
        log.push(`update ${id}`);
        past.push(1);
      },
    }),
    deleteMeasure: (id: string) => { delete measures[id]; log.push(`delete ${id}`); past.push(1); },
  };
  const temporal = { getState: () => ({ pastStates: [...past], futureStates: [], undo: () => { past.pop(); }, redo: () => undefined, transaction: <T,>(fn: () => T): T => fn() }) };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => undefined }, { temporal }) } as unknown as AtlasView;
  return { view, measures, log, past };
}

test("a measurement's change goes to Atlas's updateMeasure and is one step of Tabletop's undo", async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  const history = new UndoHistory();
  recordAtlasWrites(history, writer);
  await writer.updateMeasure('m.atlasmap', 'm1', { points: [{ x: 35, y: 0 }, { x: 105, y: 0 }], hidden: true });
  assert.deepEqual(a.measures.m1.points, [{ x: 35, y: 0 }, { x: 105, y: 0 }]);
  assert.equal(a.measures.m1.hidden, true);
  assert.equal(history.canUndo(['m.atlasmap']), true);
  // A field set to undefined goes (the Players switch back on).
  await writer.updateMeasure('m.atlasmap', 'm1', { hidden: undefined });
  assert.equal('hidden' in a.measures.m1, false);
});

test('an update of a measurement Atlas no longer has is passed over, and an Atlas without updateMeasure is said so', async () => {
  const a = atlas('m.atlasmap');
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.updateMeasure('m.atlasmap', 'gone', { hidden: true });
  assert.deepEqual(a.log, []);
  const old = atlas('o.atlasmap', false);
  const oldWriter = new TokenWriter({ views: () => [old.view], held: async () => null });
  await assert.rejects(oldWriter.updateMeasure('o.atlasmap', 'm1', { hidden: true }), /measures/);
});
