import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoardData, readBoardData } from '../src/board/boardData';
import { carryOver, type CarryOverDeps } from '../src/fusionCarryOver';

const SAVED = { 'maps/a.atlasmap': { ambient: 0.5, tint: '#336699', fogHeight: 2 }, 'maps/b.atlasmap': { ambient: 0.2 } };
const saved = (data: BoardData): unknown => JSON.parse(JSON.stringify(data.toJSON()));

function setup(over: Partial<CarryOverDeps> = {}, board: BoardData = new BoardData(readBoardData(SAVED))) {
  const backups: Array<ReadonlyArray<{ name: string; text: string }>> = [];
  let atlas: { color: string; size: number } | null = { color: '#ff0059', size: 16 };
  const deps: CarryOverDeps = {
    legacyLighting: () => board.legacyLighting(),
    dropLegacyLighting: () => board.dropLegacyLighting(),
    backup: async (files) => { backups.push(files); return 'Tabletop backups/2026-11-13'; },
    ownLaser: undefined,
    atlasLaser: () => atlas,
    setAtlasLaser: (laser) => { atlas = laser; return true; },
    diceOff: false,
    ...over,
  };
  return { deps, board, backups, atlasLaser: () => atlas, setAtlas: (next: typeof atlas) => { atlas = next; } };
}

test("a map's own light level and tint are backed up first, then dropped, and the user is told where", async () => {
  const s = setup();
  // Until the backup is written they are still saved with Tabletop's data.
  assert.deepEqual(saved(s.board), SAVED);
  const result = await carryOver(s.deps);
  assert.deepEqual(result, { done: true, laserHandled: true, lines: ["The light level and tint of 2 maps are now Atlas's scene lighting; backup in Tabletop backups/2026-11-13/"] });
  assert.equal(s.backups.length, 1);
  assert.equal(s.backups[0]![0]!.name, 'board-lighting.json');
  assert.deepEqual(JSON.parse(s.backups[0]![0]!.text), { 'maps/a.atlasmap': { ambient: 0.5, tint: '#336699' }, 'maps/b.atlasmap': { ambient: 0.2 } });
  assert.deepEqual(saved(s.board), { 'maps/a.atlasmap': { fogHeight: 2 } });
  assert.deepEqual(s.board.legacyLighting(), {});
});

test('a backup that cannot be written loses nothing: the values stay saved, and it is tried again', async () => {
  const s = setup({ backup: async () => { throw new Error('disk full'); } });
  const warn = console.warn;
  console.warn = () => {};
  const result = await carryOver(s.deps).finally(() => { console.warn = warn; });
  assert.deepEqual(result, { done: false, laserHandled: true, lines: [] });
  assert.deepEqual(saved(s.board), SAVED);
  // Loaded again (the next start), the values are still there to back up.
  const next = setup({}, new BoardData(readBoardData(saved(s.board))));
  assert.equal((await carryOver(next.deps)).done, true);
  assert.equal(next.backups.length, 1);
});

test('without Atlas the lighting is still backed up; only the laser waits, and is carried over when Atlas is there', async () => {
  const s = setup({ ownLaser: { color: '#00a9ff' } });
  s.setAtlas(null);
  const first = await carryOver(s.deps);
  assert.equal(first.done, false);
  assert.equal(first.laserHandled, false);
  assert.equal(first.lines.length, 1);
  assert.equal(s.backups.length, 1);
  assert.deepEqual(saved(s.board), { 'maps/a.atlasmap': { fogHeight: 2 } });
  // Atlas arrives: nothing is backed up twice, the laser goes to Atlas, and it is done.
  s.setAtlas({ color: '#ff0059', size: 16 });
  const second = await carryOver(s.deps);
  assert.deepEqual(second, { done: true, laserHandled: true, lines: ["Your laser's colour and size are now Atlas's laser."] });
  assert.equal(s.backups.length, 1);
  assert.deepEqual(s.atlasLaser(), { color: '#00a9ff', size: 16 });
});

test("a laser the user already set in Atlas is left alone; the dice line is said once, when all is done", async () => {
  const s = setup({ ownLaser: { color: '#00a9ff' }, diceOff: true }, new BoardData());
  s.setAtlas({ color: '#22cc88', size: 20 });
  const result = await carryOver(s.deps);
  assert.deepEqual(result, { done: true, laserHandled: true, lines: ["Dice sounds now follow Atlas's dice volume."] });
  assert.deepEqual(s.atlasLaser(), { color: '#22cc88', size: 20 });
  assert.equal(s.backups.length, 0);
  // Nothing to carry at all: done, and nothing said.
  assert.deepEqual(await carryOver(setup({}, new BoardData()).deps), { done: true, laserHandled: true, lines: [] });
});
