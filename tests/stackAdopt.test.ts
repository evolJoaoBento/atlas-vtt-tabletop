import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Assignments } from '../src/assignments';
import { BoardData, readBoardData, type StackJournal } from '../src/board/boardData';
import { UndoHistory } from '../src/board/undoHistory';
import { recordTabletopData } from '../src/board/undoRecorders';
import { allowedTransitions, readCutscenes, addShot, type Cutscene, type Shot } from '../src/cutscene/cutsceneData';

const BASE = 'maps/Keep.atlasmap', UP = 'maps/Tower.atlasmap', LOW = 'maps/Cellar.atlasmap', ELSE = 'maps/Road.atlasmap';
const shot = (id: string, at: number, mapPath: string, more: Partial<Shot> = {}): Shot => ({ id, at, mapPath, eye: { x: 100, y: 400, z: 200 }, target: { x: 300, y: 0, z: 400 }, keyframe: false, transition: 'fade', ...more });
const scene = (id: string, shots: Shot[]): Cutscene => ({ id, name: id, shots });

function data(): BoardData {
  return new BoardData(readBoardData({
    [BASE]: { styles: { own: 'standee' }, props: [{ id: 'p0', glb: 'Props/a.glb', x: 10, y: 10, rotation: 0, scale: 1 }], cutscenes: [scene('intro', [shot('s1', 0, BASE), shot('s2', 1000, UP, { transition: 'cut' }), shot('s3', 2000, UP, { transition: 'move' })])] },
    [UP]: {
      layer: { base: BASE, elevation: 3, x: 70, y: 140 }, hidden: true, styles: { tok: 'standee', other: 'standee' },
      props: [{ id: 'p1', glb: 'Props/b.glb', x: 100, y: 200, rotation: 45, scale: 2, solid: true }],
      cutscenes: [scene('upstairs', [shot('u1', 0, UP)])],
    },
    [LOW]: { layer: { base: BASE, elevation: -2 } },
    [ELSE]: { cutscenes: [scene('road', [shot('r1', 0, ELSE), shot('r2', 500, LOW)])] },
  }));
}
const journal: StackJournal = {
  baseLevel: 'level_base',
  members: [
    { path: UP, level: 'level_up', ids: { tokens: { tok: 'tok_s2' } }, frame: { k: 0.5, x: 60, y: 160 } },
    { path: LOW, level: 'level_low', ids: {}, frame: { k: 1, x: 0, y: 0 } },
  ],
};

test('the stacks in Tabletop\'s data: each base with the scenes stacked on it', () => {
  const stacks = data().stacks();
  assert.deepEqual(stacks.map(({ base, members }) => [base, members.map((member) => [member.path, member.elevation])]), [[BASE, [[LOW, -2], [UP, 3]]]]);
  assert.deepEqual(new BoardData().stacks(), []);
});

test('a journal of a move under way is kept with the base, read back from saved data, and is no step of the undo', () => {
  const board = data();
  const history = new UndoHistory();
  recordTabletopData(history, board, new Assignments());
  board.setStackJournal(BASE, journal);
  assert.deepEqual(board.stackJournal(BASE), journal);
  assert.deepEqual(new BoardData(readBoardData(JSON.parse(JSON.stringify(board.toJSON())))).stackJournal(BASE), journal);
  board.setStackJournal(BASE, null);
  assert.equal(board.stackJournal(BASE), null);
  assert.equal(history.canUndo([BASE]), false);
  // Junk in its place is no journal.
  assert.equal(new BoardData(readBoardData({ [BASE]: { stackJournal: { members: 'x' } } })).stackJournal(BASE), null);
});

test("a moved stack's styles, props, hidden floors and shots are the base's; its scenes are stacked no more; nothing of it is an undo step", () => {
  const board = data();
  const minis = new Assignments({ [UP]: { tok: { mini: 'Minis/a.glb', scale: 1, turn: 0 }, other: { mini: 'Minis/b.glb', scale: 2, turn: 90 } }, [BASE]: { own: { mini: 'Minis/c.glb', scale: 1, turn: 0 } } });
  const history = new UndoHistory();
  recordTabletopData(history, board, minis);
  board.setStackJournal(BASE, journal);
  const touched = board.adoptStack(BASE, journal);
  minis.adopt(UP, BASE, journal.members[0]!.ids.tokens ?? {});
  // Every map whose data changed is named: the undo's older steps of them are let go by the move.
  assert.deepEqual([...touched].sort(), [BASE, LOW, ELSE, UP].sort());
  // Token styles and minis under the ids the tokens have on the base.
  assert.deepEqual([board.style(BASE, 'own'), board.style(BASE, 'tok_s2'), board.style(BASE, 'other'), board.style(BASE, 'tok')], ['standee', 'standee', 'standee', 'disc']);
  assert.deepEqual(Object.keys(minis.forMap(BASE)).sort(), ['other', 'own', 'tok_s2']);
  assert.equal(minis.get(BASE, 'tok_s2')?.mini, 'Minis/a.glb');
  // The member keeps its own: it is still a scene.
  assert.equal(board.style(UP, 'tok'), 'standee');
  assert.equal(minis.get(UP, 'tok')?.mini, 'Minis/a.glb');
  // Its props stand on its level, where the level's image now lies; the base's own name the base's level (whichever
  // level is the scene's first, they stay on the base's floor).
  assert.deepEqual(board.props(BASE), [
    { id: 'p0', glb: 'Props/a.glb', x: 10, y: 10, rotation: 0, scale: 1, level: 'level_base' },
    { id: 'p1@level_up', glb: 'Props/b.glb', x: 110, y: 260, rotation: 45, scale: 2, solid: true, level: 'level_up' },
  ]);
  assert.equal(board.props(UP).length, 1);
  // A hidden layer is a hidden level.
  assert.equal(board.layerHidden(`${BASE}#atlas-level:level_up`), true);
  assert.equal(board.layerHidden(`${BASE}#atlas-level:level_low`), false);
  // Shots that looked at a member look at the base's level, from where the camera now is; in every map's cutscenes.
  const intro = board.cutscenesOf(BASE)[0]!;
  assert.deepEqual(intro.shots.map((each) => [each.id, each.mapPath, each.level ?? null, each.transition]), [['s1', BASE, 'level_base', 'fade'], ['s2', BASE, 'level_up', 'cut'], ['s3', BASE, 'level_up', 'move']]);
  assert.deepEqual([intro.shots[1]!.eye, intro.shots[1]!.target], [{ x: 110, y: 200, z: 260 }, { x: 210, y: 0, z: 360 }]);
  assert.deepEqual(board.cutscenesOf(ELSE)[0]!.shots.map((each) => [each.mapPath, each.level ?? null]), [[ELSE, null], [BASE, 'level_low']]);
  // A cutscene kept under the member's own path stays there, looking at the base's level too.
  assert.deepEqual(board.cutscenesOf(UP)[0]!.shots.map((each) => [each.mapPath, each.level]), [[BASE, 'level_up']]);
  // No stack any more, no journal.
  assert.deepEqual(board.stacks(), []);
  assert.equal(board.layerOf(UP), null);
  assert.equal(board.layerHidden(UP), false);
  assert.equal(board.stackJournal(BASE), null);
  for (const path of [BASE, UP, LOW, ELSE]) assert.equal(history.canUndo([path]), false, path);
  // Done again (a rerun after a crash): the same data.
  const once = JSON.stringify([board.toJSON(), minis.toJSON()]);
  board.adoptStack(BASE, journal);
  minis.adopt(UP, BASE, journal.members[0]!.ids.tokens ?? {});
  assert.equal(JSON.stringify([board.toJSON(), minis.toJSON()]), once);
});

test('a shot may name the level it looks at: kept when read, and a move only joins shots of one map and one level', () => {
  const read = readCutscenes([{ id: 'c', name: 'c', shots: [{ ...shot('a', 0, BASE), level: 'level_up' }, { ...shot('b', 500, BASE), level: '' }, { ...shot('c', 1000, BASE), level: 7 }, { ...shot('d', 1500, BASE), level: 'level_up', transition: 'move' }] }])[0]!;
  assert.deepEqual(read.shots.map((each) => [each.id, each.level ?? null, each.transition]), [['a', 'level_up', 'fade'], ['b', null, 'fade'], ['c', null, 'fade'], ['d', 'level_up', 'fade']]);
  const up = shot('x', 0, BASE, { level: 'level_up' });
  assert.deepEqual(allowedTransitions(up, shot('y', 1, BASE, { level: 'level_up' })), ['fade', 'cut', 'move']);
  assert.deepEqual(allowedTransitions(up, shot('y', 1, BASE)), ['fade', 'cut']);
  assert.deepEqual(allowedTransitions(up, shot('y', 1, UP, { level: 'level_up' })), ['fade', 'cut']);
  // A shot added on a level keeps it.
  const added = addShot(scene('n', []), { id: 'z', at: 0, mapPath: BASE, level: 'level_up', eye: { x: 0, y: 1, z: 0 }, target: { x: 1, y: 0, z: 1 } }, 'fade');
  assert.equal(added.shots[0]!.level, 'level_up');
  assert.equal('level' in addShot(scene('n', []), { id: 'z', at: 0, mapPath: BASE, eye: { x: 0, y: 1, z: 0 }, target: { x: 1, y: 0, z: 1 } }, 'fade').shots[0]!, false);
});

test("where the whole scene was set aside by whole squares, the base's own props and shots go with it, once", () => {
  const board = data();
  const raised: StackJournal = { ...journal, baseFrame: { k: 1, x: 300, y: 100 }, members: [{ path: UP, level: 'level_up', ids: {}, frame: { k: 0.5, x: 360, y: 260 } }] };
  board.adoptStack(BASE, raised);
  const [own, theirs] = board.props(BASE);
  assert.deepEqual([own!.x, own!.y, own!.level], [310, 110, 'level_base']);
  assert.deepEqual([theirs!.x, theirs!.y, theirs!.level], [410, 360, 'level_up']);
  const s1 = board.cutscenesOf(BASE)[0]!.shots[0]!;
  assert.deepEqual([s1.level, s1.eye, s1.target], ['level_base', { x: 400, y: 400, z: 300 }, { x: 600, y: 0, z: 500 }]);
  const once = JSON.stringify(board.toJSON());
  board.adoptStack(BASE, raised);
  assert.equal(JSON.stringify(board.toJSON()), once);
  // The journal's frame of the base is read back from saved data; junk in its place is no frame.
  const saved = data();
  saved.setStackJournal(BASE, raised);
  assert.deepEqual(new BoardData(readBoardData(JSON.parse(JSON.stringify(saved.toJSON())))).stackJournal(BASE)?.baseFrame, { k: 1, x: 300, y: 100 });
  assert.equal(new BoardData(readBoardData({ [BASE]: { stackJournal: { ...raised, baseFrame: { k: 'x' } } } })).stackJournal(BASE)?.baseFrame, undefined);
});
