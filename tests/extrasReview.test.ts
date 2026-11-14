import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assignments } from '../src/assignments';
import type { AtlasView } from '../src/atlas';
import { BoardData } from '../src/board/boardData';
import { planExtrasMove } from '../src/board/extrasMigration';
import { MovedPaths } from '../src/board/movedPaths';
import { extrasOf, followMovedPaths } from '../src/board/recordExtras';
import { roomsAwaitAtlas } from '../src/board/roomWallMigration';
import { TokenWriter } from '../src/board/tokenWriter';
import { UndoHistory } from '../src/board/undoHistory';
import { recordTabletopData } from '../src/board/undoRecorders';
import { readWalls } from '../src/board/walls';
import { LayerIndex } from '../src/boardLayers';
import { lookMaps } from '../src/boardLook';

const wall = (id: string, more: Record<string, unknown> = {}) => ({ id, kind: 'wall', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, ...more });
const scene = (walls: Record<string, unknown>) => JSON.stringify({ state: { mapPath: 'm.atlasmap', backgroundImage: 'bg.png', grid: { size: 70 }, objects: { tokens: {}, walls } } });
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("a scene whose file changed is still answered for, as it was, until it is read again: players' looks never go blank between a save and its reading", async () => {
  let text = scene({ w1: wall('w1', { tabletop: { v: 1, height: 3 } }) });
  let changes = 0;
  const vault = { getAbstractFileByPath: (path: string) => (path === 'm.atlasmap' ? { path } : null), read: async () => text };
  const index = new LayerIndex(vault as never, () => { changes += 1; });
  assert.equal(index.map('m.atlasmap'), null);
  await tick();
  assert.equal(index.map('m.atlasmap')?.walls[0]?.extra?.height, 3);
  const before = changes;
  // Atlas saved the map: the old reading stands until the new one is in.
  text = scene({ w1: wall('w1', { tabletop: { v: 1, height: 5 } }) });
  index.forget('m.atlasmap');
  assert.equal(index.map('m.atlasmap')?.walls[0]?.extra?.height, 3);
  assert.equal(index.has('m.atlasmap'), true);
  await tick();
  assert.equal(index.map('m.atlasmap')?.walls[0]?.extra?.height, 5);
  assert.equal(changes, before + 1);
  // A scene whose file is gone is forgotten once that is known.
  vault.getAbstractFileByPath = () => null;
  index.forget('m.atlasmap');
  await tick();
  assert.equal(index.map('m.atlasmap'), null);
});

test("the look of a map Atlas holds is read from Atlas's store, at once and whatever the file says; of any other map, from its file as read", () => {
  const state = { mapPath: 'm.atlasmap', backgroundImage: null, grid: { size: 70 }, objects: { tokens: {}, walls: { w1: wall('w1', { tabletop: { v: 1, height: 9 } }) } } };
  const fromFile = readWalls({ w1: wall('w1', { tabletop: { v: 1, height: 3 } }) });
  const scenes = { map: () => ({ walls: fromFile, lights: [], levels: [], level: null }) as never, mapAt: () => null };
  const held = lookMaps('m.atlasmap', null, scenes, state);
  assert.equal(held.own?.walls[0]?.extra?.height, 9);
  assert.equal(lookMaps('m.atlasmap', null, scenes, null).own?.walls[0]?.extra?.height, 3);
  // A store that is no map (still loading, junk): the file's reading.
  assert.equal(lookMaps('m.atlasmap', null, scenes, { objects: null }).own?.walls[0]?.extra?.height, 3);
  // With levels, the walls of the level shown come from the store too.
  const levels = [{ id: 'a', name: 'A', elevation: { bottom: 0 } }, { id: 'b', name: 'B', elevation: { bottom: 10 } }];
  const levelled = { ...state, levels, objects: { tokens: {}, walls: { up: wall('up', { levels: ['b'], tabletop: { v: 1, material: 'Stone' } }) } } };
  assert.deepEqual(lookMaps('m.atlasmap', 'b', scenes, levelled).levelMap?.walls.map((each) => [each.id, each.extra?.material]), [['up', 'Stone']]);
});

test('a material folder or a door prop renamed after it was put on a record is still found: the rename is remembered and followed, through several', () => {
  const moved = new MovedPaths({ 'Old/stone': 'Materials/stone' });
  assert.equal(moved.note('Materials', 'Assets/Materials', true), true);
  assert.equal(moved.note('Props/door.glb', 'Props/gate.glb', false), true);
  // A note or an image renamed says nothing of a wall's material or a door's prop.
  assert.equal(moved.note('Notes/a.md', 'Notes/b.md', false), false);
  assert.equal(moved.resolve('Old/stone'), 'Assets/Materials/stone');
  assert.equal(moved.resolve('Materials/stone/sub'), 'Assets/Materials/stone/sub');
  assert.equal(moved.resolve('Props/door.glb'), 'Props/gate.glb');
  assert.equal(moved.resolve('Elsewhere/wood'), 'Elsewhere/wood');
  // Renamed back and forth: no endless chase.
  moved.note('Assets/Materials', 'Materials', true);
  assert.equal(moved.resolve('Materials/stone'), 'Materials/stone');
  assert.deepEqual(new MovedPaths(JSON.parse(JSON.stringify(moved.toJSON()))).resolve('Props/door.glb'), 'Props/gate.glb');
  assert.deepEqual(new MovedPaths('junk' as never).toJSON(), {});
  // The board's one read of a wall's extras follows them.
  followMovedPaths((path) => (path === 'Materials/stone' ? 'Assets/Materials/stone' : path === 'Props/door.glb' ? 'Props/gate.glb' : path));
  try {
    const extras = extrasOf({ walls: readWalls({ w1: wall('w1', { tabletop: { v: 1, material: 'Materials/stone' } }), d1: wall('d1', { type: 'door', tabletop: { v: 1, prop: 'Props/door.glb' } }) }), lights: [] }, { wallMaterials: { old: 'Materials/stone' } });
    assert.deepEqual([extras.wallMaterial('w1'), extras.doorProp('d1'), extras.wallMaterial('old'), extras.usedMaterials()], ['Assets/Materials/stone', 'Props/gate.glb', 'Assets/Materials/stone', ['Assets/Materials/stone']]);
  } finally {
    followMovedPaths(null);
  }
});

test('the move tells what went nowhere apart: a value whose record Atlas no longer has, from one the record already had or that no wall may have', () => {
  const plan = planExtrasMove(
    { wallHeights: { w1: 3, w2: 0, bad: -1, gone: 2 }, lightHeights: { l9: 4 } },
    { walls: { w1: wall('w1'), w2: wall('w2', { tabletop: { v: 1, height: 5 } }), bad: wall('bad') } },
  );
  assert.deepEqual([plan.moved, plan.orphaned, plan.dropped], [1, 2, 4]);
});

test("once a map's 3D settings moved, an undo of something older on the board does not bring them back into Tabletop's data; migration 1's re-keying is no step either", async () => {
  const history = new UndoHistory();
  const boardData = new BoardData({ m: { wallHeights: { room_0_0_80_0: 2 }, fogHeight: 1.5 } });
  recordTabletopData(history, boardData, new Assignments());
  boardData.setFogHeight('m', 2);
  boardData.moveWallKeys('m', [{ from: 'room_0_0_80_0', to: 'room__0_0_80_0' }]);
  boardData.clearLegacyExtras('m');
  // One step only: the fog's height. Taking it back leaves the move as it is.
  assert.equal((await history.undo(['m']))?.done, true);
  assert.deepEqual(boardData.toJSON().m, { fogHeight: 1.5, roomWallsMoved: true, extrasMoved: true });
  assert.equal(history.canUndo(['m']), false);
  assert.equal(boardData.legacyExtras('m'), null);
});

test("old room-wall names wait for Atlas only while Atlas still holds rooms it has not made walls of", () => {
  const rooms = { r: { id: 'r', kind: 'room' } };
  assert.equal(roomsAwaitAtlas({ objects: { rooms, walls: {} } }), true);
  assert.equal(roomsAwaitAtlas({ objects: { rooms, walls: { w: { id: 'w', chainId: 'rooms_', p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } } } } }), false);
  // No rooms left (deleted in 0.14, or converted and removed): nothing will ever be re-keyed, so nothing waits.
  assert.equal(roomsAwaitAtlas({ objects: { walls: {} } }), false);
  assert.equal(roomsAwaitAtlas({ objects: { rooms: {}, walls: {} } }), false);
  assert.equal(roomsAwaitAtlas(null), false);
});

/** A stand-in for the Atlas view holding `mapPath`; `actions` says which of Atlas's it has. */
function atlas(mapPath: string, walls: Record<string, Record<string, unknown>>, history: { untracked?: boolean; past?: number } = {}) {
  const log: string[] = [];
  const past: unknown[] = Array.from({ length: history.past ?? 0 }, () => 1);
  let depth = 0;
  const state: Record<string, unknown> = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { tokens: {}, walls, lights: { l1: { id: 'l1' } } },
    updateWall: (id: string, changes: Record<string, unknown>) => { Object.assign(walls[id]!, changes); for (const [key, value] of Object.entries(changes)) if (value === undefined) delete walls[id]![key]; log.push(`updateWall ${id}`); if (depth === 0) past.push(1); },
  };
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [], undo: () => {}, redo: () => {},
      transaction: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; past.push(1); log.push('transaction'); } },
      ...(history.untracked === false ? {} : { untracked: <T,>(fn: () => T): T => { depth += 1; try { return fn(); } finally { depth -= 1; } } }),
      clear: () => { past.length = 0; log.push('clear'); },
    }),
  };
  const view = { viewId: 'v', atlasStore: Object.assign({ getState: () => state, subscribe: () => () => {} }, { temporal }) } as unknown as AtlasView;
  return { view, walls, log, past, state };
}

test("setting what a wall already has is no step of anyone's undo; the walls that change still go in one", async () => {
  const a = atlas('m.atlasmap', { w1: wall('w1', { tabletop: { v: 1, height: 3 } }), w2: wall('w2') });
  const writer = new TokenWriter({ views: () => [a.view], held: async () => null });
  await writer.setWallExtras('m.atlasmap', ['w1'], { height: 3 });
  await writer.setWallExtras('m.atlasmap', ['w2'], { height: null });
  assert.deepEqual([a.log, a.past.length], [[], 0]);
  await writer.setWallExtras('m.atlasmap', ['w1', 'w2'], { height: 3 });
  assert.deepEqual(a.log, ['updateWall w2', 'transaction']);
});

test("the move is written outside Atlas's undo or not at all, and Atlas's older steps, which could take a moved value away with them, are let go", async () => {
  const move = { walls: [{ id: 'w1', change: { height: 3 } }], lights: [{ id: 'l1', height: 2 }], tokens: [], moved: 2, orphaned: 0, dropped: 0 };
  // No way to write outside the history: nothing is moved.
  const old = atlas('m.atlasmap', { w1: wall('w1') }, { untracked: false });
  await assert.rejects(new TokenWriter({ views: () => [old.view], held: async () => null }).applyExtrasMove('m.atlasmap', move), /untracked/);
  assert.deepEqual(old.log, []);
  // An action the move needs is missing (a placed light's update): nothing is moved, so nothing is cleared for it.
  const partial = atlas('m.atlasmap', { w1: wall('w1') });
  await assert.rejects(new TokenWriter({ views: () => [partial.view], held: async () => null }).applyExtrasMove('m.atlasmap', move), /light update/);
  assert.deepEqual(partial.log, []);
  // Steps Atlas held from before the move: undoing one would restore its records as they were, without what was moved.
  const worked = atlas('m.atlasmap', { w1: wall('w1') }, { past: 3 });
  (worked.state as { updateLight?: unknown }).updateLight = () => { worked.log.push('updateLight l1'); };
  await new TokenWriter({ views: () => [worked.view], held: async () => null }).applyExtrasMove('m.atlasmap', move);
  assert.deepEqual(worked.log, ['updateWall w1', 'updateLight l1', 'clear']);
  assert.equal(worked.past.length, 0);
  // Nothing to write: Atlas's steps stay.
  const idle = atlas('m.atlasmap', {}, { past: 2 });
  await new TokenWriter({ views: () => [idle.view], held: async () => null }).applyExtrasMove('m.atlasmap', { walls: [], lights: [], tokens: [], moved: 0, orphaned: 0, dropped: 0 });
  assert.equal(idle.past.length, 2);
});
