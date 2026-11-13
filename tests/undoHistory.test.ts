import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UndoHistory, type UndoStep } from '../src/board/undoHistory';
import { recordAtlasWrites, recordTabletopData } from '../src/board/undoRecorders';
import { BoardData } from '../src/board/boardData';
import { Assignments } from '../src/assignments';
import { TokenWriter } from '../src/board/tokenWriter';

const counter = (paths: string[], log: string[], name: string): UndoStep => ({
  paths, label: name,
  undo: () => { log.push(`undo ${name}`); return true; },
  redo: () => { log.push(`redo ${name}`); return true; },
});

test('undo takes back the latest step of the board\'s maps, redo brings it back', async () => {
  const history = new UndoHistory();
  const log: string[] = [];
  history.push(counter(['a.atlasmap'], log, 'one'));
  history.push(counter(['b.atlasmap'], log, 'other map'));
  history.push(counter(['a.atlasmap'], log, 'two'));
  assert.equal((await history.undo(['a.atlasmap']))?.label, 'two');
  assert.equal((await history.undo(['a.atlasmap']))?.label, 'one');
  assert.equal(await history.undo(['a.atlasmap']), null);
  assert.equal(history.canUndo(['b.atlasmap']), true);
  assert.equal((await history.redo(['a.atlasmap']))?.label, 'one');
  assert.deepEqual(log, ['undo two', 'undo one', 'redo one']);
});

test('a new step clears what could be redone on its map only', async () => {
  const history = new UndoHistory();
  const log: string[] = [];
  history.push(counter(['a'], log, 'a1'));
  history.push(counter(['b'], log, 'b1'));
  await history.undo(['a']);
  await history.undo(['b']);
  history.push(counter(['a'], log, 'a2'));
  assert.equal(history.canRedo(['a']), false);
  assert.equal(history.canRedo(['b']), true);
});

test('a step that cannot be taken back is dropped', async () => {
  const history = new UndoHistory();
  history.push({ paths: ['a'], label: 'gone', undo: () => false, redo: () => true });
  assert.deepEqual(await history.undo(['a']), { label: 'gone', done: false });
  assert.equal(history.canUndo(['a']), false);
  assert.equal(history.canRedo(['a']), false);
});

test('Tabletop\'s own data is recorded, and a slider\'s many changes are one step', async () => {
  let now = 0;
  const history = new UndoHistory(() => now);
  const boardData = new BoardData();
  const assignments = new Assignments();
  recordTabletopData(history, boardData, assignments);
  boardData.addProp('m', { glb: 'tree.glb', x: 10, y: 10, rotation: 0, scale: 1 });
  const untouched = boardData.fogHeight('m');
  for (const level of [0.2, 0.3, 0.4]) { now += 50; boardData.setFogHeight('m', level); }
  assert.equal(boardData.fogHeight('m'), 0.4);
  await history.undo(['m']);
  assert.equal(boardData.fogHeight('m'), untouched);
  assert.equal(boardData.props('m').length, 1);
  await history.undo(['m']);
  assert.equal(boardData.props('m').length, 0);
  await history.redo(['m']);
  assert.equal(boardData.props('m').length, 1);
  assignments.set('m', 't1', { mini: 'orc.glb', scale: 1, turn: 0 });
  await history.undo(['m']);
  assert.equal(assignments.get('m', 't1'), null);
});

test('painted water is undone and redone with the board data', async () => {
  const history = new UndoHistory();
  const boardData = new BoardData();
  recordTabletopData(history, boardData, new Assignments());
  boardData.setWater('m', { width: 4, height: 4, data: 'AQ==' });
  boardData.setWater('m', { width: 4, height: 4, data: 'Ag==' });
  await history.undo(['m']);
  assert.equal(boardData.water('m')?.mask.data, 'AQ==');
  await history.undo(['m']);
  assert.equal(boardData.water('m'), null);
  await history.redo(['m']);
  assert.equal(boardData.water('m')?.mask.data, 'AQ==');
});

test("a change Atlas took is undone in Atlas's own history", async () => {
  const history = new UndoHistory();
  const past: number[] = [];
  const future: number[] = [];
  const tokens: Record<string, { x: number; y: number }> = { t: { x: 0, y: 0 } };
  const temporal = {
    getState: () => ({
      pastStates: [...past], futureStates: [...future],
      undo: () => { future.push(past.pop()!); tokens.t = { x: 0, y: 0 }; },
      redo: () => { past.push(future.pop()!); tokens.t = { x: 70, y: 0 }; },
    }),
  };
  const state = { mapPath: 'm', mapLoaded: true, objects: { tokens }, updateToken: (id: string, change: { x: number; y: number }) => { tokens[id] = change; past.push(1); future.length = 0; } };
  const view = { atlasStore: Object.assign({ getState: () => state }, { temporal }) };
  const writer = new TokenWriter({ views: () => [view as never], held: async () => null });
  recordAtlasWrites(history, writer);
  await writer.move('m', 't', 70, 0);
  assert.equal(history.canUndo(['m']), true);
  await history.undo(['m']);
  assert.deepEqual(tokens.t, { x: 0, y: 0 });
  await history.redo(['m']);
  assert.deepEqual(tokens.t, { x: 70, y: 0 });
  // Something else was done in Atlas since: Tabletop's step no longer is Atlas's latest.
  past.push(2);
  assert.equal((await history.undo(['m']))?.done, false);
});
