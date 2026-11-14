import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AtlasSceneState } from '../src/atlas';
import { Assignments } from '../src/assignments';
import { BoardData, readBoardData } from '../src/board/boardData';
import type { StackPlan } from '../src/board/stackMove';
import { StackMigration, type StackMigrationDeps } from '../src/stackMigration';

const KEEP = 'maps/Keep.atlasmap', TOWER = 'maps/Tower.atlasmap', CELLAR = 'maps/Cellar.atlasmap', INN = 'maps/Inn.atlasmap', LOFT = 'maps/Loft.atlasmap', ROAD = 'maps/Road.atlasmap';
type Scene = Record<string, unknown>;
const scene = (path: string, tokens: Record<string, unknown> = {}, more: Scene = {}): Scene => ({
  mapPath: path, mapLoaded: true, background: `img/${path}.webp`, grid: { size: 100, offsetX: 0, offsetY: 0, unitDistance: 5 }, objects: { tokens }, initiative: { entries: [] }, ...more,
});

/** A vault of scenes, Atlas's one view over it, Tabletop's data, and a log of what the move did, in order. */
function world(options: { scenes?: Record<string, Scene>; busy?: string | null; saves?: boolean; unit?: number; onSave?: (w: { states: Map<string, Scene> }) => void } = {}) {
  const states = new Map<string, Scene>(Object.entries({ [ROAD]: scene(ROAD), ...(options.scenes ?? { [KEEP]: scene(KEEP, { hero: { id: 'hero', x: 1, y: 1 } }), [TOWER]: scene(TOWER, { hero: { id: 'hero', x: 5, y: 5 } }) }) }));
  const files = new Map<string, string>([...states].map(([path, state]) => [path, JSON.stringify({ state })]));
  const boardData = new BoardData(readBoardData({
    [KEEP]: { styles: { hero: 'standee' } },
    [TOWER]: { layer: { base: KEEP, elevation: 3 }, styles: { hero: 'standee' }, props: [{ id: 'p1', glb: 'Props/b.glb', x: 100, y: 200, rotation: 0, scale: 1 }] },
  }));
  const assignments = new Assignments({ [TOWER]: { hero: { mini: 'Minis/a.glb', scale: 1, turn: 0 } } });
  const log: string[] = [];
  const name = (path: string): string => path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
  let held: string | null = ROAD;
  let level = 0;
  const backups: Array<Array<{ name: string; text: string }>> = [];
  const journalAtWrite: unknown[] = [];
  const deps: StackMigrationDeps = {
    boardData, assignments,
    writer: {
      applyStackMove: async (path: string, plan: (state: AtlasSceneState) => StackPlan | null) => {
        const state = states.get(path)!;
        const planned = held === path ? plan(state as unknown as AtlasSceneState) : null;
        if (!planned) { log.push('write refused'); return null; }
        journalAtWrite.push(boardData.stackJournal(path));
        Object.assign(state, { levels: planned.scene.levels, objects: planned.scene.objects, background: planned.scene.background, levelAlignments: planned.scene.levelAlignments });
        if (options.saves !== false) files.set(path, JSON.stringify({ state }));
        log.push(`write ${name(path)}`);
        return planned;
      },
    },
    follow: async (path) => { if (!states.has(path)) { log.push(`no ${name(path)}`); return false; } held = path; log.push(`hold ${name(path)}`); return true; },
    heldState: (path) => (held === path ? (states.get(path) as unknown as AtlasSceneState) : null),
    shownMap: () => held,
    read: async (path) => files.get(path) ?? null,
    backup: async (kept) => { backups.push(kept); log.push(`backup ${kept.length}`); return 'Tabletop backups/2026-11-14'; },
    worldSize: async () => ({ width: 2000, height: 1000 }),
    unitDistance: async () => options.unit ?? null,
    present: (path, level) => { log.push(`present ${name(path)} ${level}`); },
    forget: (paths) => { log.push(`forget ${[...paths].map(name).sort().join(',')}`); },
    save: async () => { log.push('save'); options.onSave?.({ states }); },
    busy: () => options.busy ?? null,
    newLevelId: () => `level_${++level}`,
    wait: async () => { log.push('wait'); },
  };
  return { migration: new StackMigration(deps), boardData, assignments, states, files, log, backups, journalAtWrite, held: () => held };
}

test('a stack is moved in this order: backup, members read as Atlas holds them, the base held, the journal saved, the write, the file seen, Tabletop\'s data adopted; Atlas goes back to its map', async () => {
  const w = world();
  assert.deepEqual(w.migration.pending().map((stack) => [stack.base, stack.members.map((member) => member.path)]), [[KEEP, [TOWER]]]);
  const { outcomes, backup, refused } = await w.migration.move();
  assert.equal(refused, null);
  assert.equal(backup, 'Tabletop backups/2026-11-14');
  assert.deepEqual(w.log, ['backup 6', 'hold Tower', 'hold Keep', 'save', 'write Keep', 'present Keep level_1', 'save', 'forget Keep,Tower', 'hold Road', 'backup 1']);
  // The journal was in Tabletop's data, saved, when Atlas was written.
  assert.deepEqual((w.journalAtWrite[0] as { members: Array<{ path: string; level: string }> }).members.map((member) => [member.path, member.level]), [[TOWER, 'level_2']]);
  assert.deepEqual(outcomes, [{ base: KEEP, moved: true, levels: ['Keep', 'Tower'], lost: [], skipped: null }]);
  // Atlas has the levels and the member's token under an id of its own; Tabletop's data follows.
  const kept = w.states.get(KEEP) as { levels: Array<{ id: string }>; objects: { tokens: Record<string, { level?: string }> } };
  assert.deepEqual(kept.levels.map((each) => each.id), ['level_1', 'level_2']);
  assert.deepEqual(Object.keys(kept.objects.tokens), ['hero', 'hero_s2']);
  assert.equal(w.boardData.style(KEEP, 'hero_s2'), 'standee');
  assert.equal(w.assignments.get(KEEP, 'hero_s2')?.mini, 'Minis/a.glb');
  assert.deepEqual(w.boardData.props(KEEP).map((prop) => [prop.id, prop.level]), [['p1@level_2', 'level_2']]);
  assert.deepEqual(w.boardData.stacks(), []);
  assert.equal(w.boardData.stackJournal(KEEP), null);
  assert.equal(w.held(), ROAD);
  // The backup: each scene's file, Tabletop's data for it and its minis; then what was done, in words.
  assert.deepEqual(w.backups[0]!.map((file) => file.name).sort(), ['Keep.atlasmap', 'Keep.minis.json', 'Keep.tabletop.json', 'Tower.atlasmap', 'Tower.minis.json', 'Tower.tabletop.json']);
  assert.match(w.backups[0]!.find((file) => file.name === 'Tower.tabletop.json')!.text, /"layer"/);
  assert.equal(w.backups[1]![0]!.name, 'Stacks moved.md');
  assert.match(w.backups[1]![0]!.text, /Keep[\s\S]*Tower/);
  // Asked again: nothing is left to move, and nothing is done.
  const again = await w.migration.move();
  assert.deepEqual([again.outcomes, again.backup], [[], null]);
});

test('nothing is moved while a session is hosted or a cutscene runs', async () => {
  const w = world({ busy: 'a session is hosted in Connect' });
  const { outcomes, refused } = await w.migration.move();
  assert.deepEqual([outcomes, refused, w.log], [[], 'a session is hosted in Connect', []]);
  assert.equal(w.boardData.stacks().length, 1);
});

test('a member Atlas does not come to hold skips its whole stack: nothing is written, the stack stays as it was', async () => {
  const w = world({ scenes: { [KEEP]: scene(KEEP) } });
  const { outcomes } = await w.migration.move();
  assert.equal(outcomes[0]!.moved, false);
  assert.match(outcomes[0]!.skipped!, /Tower could not be read/);
  assert.equal(w.log.some((line) => line.startsWith('write')), false);
  assert.equal(w.boardData.stacks().length, 1);
  assert.equal(w.boardData.stackJournal(KEEP), null);
});

test('the scene changing between the plan and the write is planned again, on what Atlas has then', async () => {
  let changed = false;
  const w = world({ onSave: ({ states }) => {
    if (changed) return;
    changed = true;
    // The GM (or Atlas) added a token while the journal was being saved: the store's records are another object now.
    const keep = states.get(KEEP) as { objects: { tokens: Record<string, unknown> } };
    keep.objects = { tokens: { ...keep.objects.tokens, late: { id: 'late', x: 9, y: 9 } } };
  } });
  const { outcomes } = await w.migration.move();
  assert.equal(outcomes[0]!.moved, true);
  assert.deepEqual(Object.keys((w.states.get(KEEP) as { objects: { tokens: object } }).objects.tokens), ['hero', 'late', 'hero_s2']);
  assert.equal(w.log.filter((line) => line === 'write Keep').length, 1);
});

test('a write Atlas has not saved is not adopted: the journal stays for the next start, the stack stays', async () => {
  const w = world({ saves: false });
  const { outcomes } = await w.migration.move();
  assert.equal(outcomes[0]!.moved, false);
  assert.match(outcomes[0]!.skipped!, /not saved/);
  assert.notEqual(w.boardData.stackJournal(KEEP), null);
  assert.equal(w.boardData.stacks().length, 1);
  assert.equal(w.boardData.style(KEEP, 'hero_s2'), 'disc');
  // At the next start the file has the levels: Tabletop's side is finished, and no level is added again.
  w.files.set(KEEP, JSON.stringify({ state: w.states.get(KEEP) }));
  w.log.length = 0;
  await w.migration.finishJournals();
  assert.equal(w.boardData.stackJournal(KEEP), null);
  assert.deepEqual(w.boardData.stacks(), []);
  assert.equal(w.boardData.style(KEEP, 'hero_s2'), 'standee');
  assert.equal(w.assignments.get(KEEP, 'hero_s2')?.mini, 'Minis/a.glb');
  assert.equal(w.log.some((line) => line.startsWith('write') || line.startsWith('hold')), false);
});

test('a journal whose write never landed is dropped at the next start: the stack is as it was, to be moved again', async () => {
  const w = world();
  w.boardData.setStackJournal(KEEP, { baseLevel: 'level_9', members: [{ path: TOWER, level: 'level_8', ids: {}, frame: { k: 1, x: 0, y: 0 } }] });
  await w.migration.finishJournals();
  assert.equal(w.boardData.stackJournal(KEEP), null);
  assert.equal(w.boardData.stacks().length, 1);
  assert.equal(w.boardData.style(KEEP, 'hero_s2'), 'disc');
});

test('of two stacks, one that cannot become levels is skipped and said; the other moves', async () => {
  const w = world({ scenes: {
    [KEEP]: scene(KEEP), [TOWER]: scene(TOWER), [CELLAR]: scene(CELLAR),
    [INN]: scene(INN, {}, { levels: [{ id: 'a' }, { id: 'b' }] }), [LOFT]: scene(LOFT),
  } });
  w.boardData.restore(LOFT, { layer: { base: INN, elevation: 2 } });
  w.boardData.restore(CELLAR, { layer: { base: KEEP, elevation: -2 } });
  const { outcomes } = await w.migration.move();
  assert.deepEqual(outcomes.map((outcome) => [outcome.base, outcome.moved, outcome.levels]), [[INN, false, []], [KEEP, true, ['Cellar', 'Keep', 'Tower']]]);
  assert.match(outcomes[0]!.skipped!, /already has Atlas levels/);
  assert.deepEqual(w.boardData.stacks().map((stack) => stack.base), [INN]);
});

test('what a move would do is told beforehand from the files, without holding or writing anything', async () => {
  const w = world();
  w.boardData.restore(TOWER, { layer: { base: KEEP, elevation: 3, x: 0, y: 0, turn: 90 } });
  const told = await w.migration.preview();
  assert.deepEqual(told.map((outcome) => [outcome.base, outcome.moved, outcome.levels, outcome.skipped]), [[KEEP, false, ['Keep', 'Tower'], null]]);
  assert.equal(told[0]!.lost.some((line) => /Tower: its turn of 90/.test(line)), true);
  assert.deepEqual(w.log, []);
  assert.equal(w.boardData.stacks().length, 1);
});

test("the base's old painted water, still a mask in Tabletop's data, keeps a stack with a floor under it from moving; heights are in the base's units as the board reads them; the base's own fit is kept", async () => {
  const fit = { offset: { x: 10, y: 0 }, scale: 2, stretch: { x: 1, y: 1 } };
  const w = world({ unit: 1.5, scenes: { [KEEP]: scene(KEEP, {}, { levels: [{ id: 'own', name: 'Tavern' }], levelAlignments: { own: fit } }), [TOWER]: scene(TOWER), [CELLAR]: scene(CELLAR) } });
  w.boardData.restore(CELLAR, { layer: { base: KEEP, elevation: -2 } });
  const water = { mask: { width: 1, height: 1, data: 'AQ==' } };
  w.boardData.restore(KEEP, { ...(w.boardData.snapshot(KEEP) ?? {}), water } as never);
  const stuck = await w.migration.move();
  assert.match(stuck.outcomes[0]!.skipped!, /painted water/);
  assert.equal(w.log.some((line) => line.startsWith('write')), false);
  // Once that water has moved (the mask is gone), the stack moves.
  const { water: _water, ...rest } = w.boardData.snapshot(KEEP) as Record<string, unknown>;
  w.boardData.restore(KEEP, rest as never);
  const moved = await w.migration.move();
  assert.equal(moved.outcomes[0]!.moved, true);
  const kept = w.states.get(KEEP) as { levels: Array<{ id: string; elevation: { bottom: number } }>; levelAlignments: unknown };
  assert.deepEqual(kept.levels.map((level) => [level.id, level.elevation.bottom]), [['level_1', -3], ['own', 0], ['level_2', 4.5]]);
  assert.deepEqual(kept.levelAlignments, { own: fit });
});

test('a move pressed again after Atlas had not saved in time finishes that stack first, and adds no level twice', async () => {
  const w = world({ saves: false });
  await w.migration.move();
  assert.notEqual(w.boardData.stackJournal(KEEP), null);
  w.files.set(KEEP, JSON.stringify({ state: w.states.get(KEEP) }));
  const again = await w.migration.move();
  assert.equal(w.boardData.stackJournal(KEEP), null);
  assert.deepEqual(w.boardData.stacks(), []);
  assert.deepEqual(again.outcomes, []);
  assert.equal((w.states.get(KEEP) as { levels: unknown[] }).levels.length, 2);
});
