import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupDay, writeBackup } from '../src/backups';
import { migrationWalls, roomWallMoves, type MigrationWall } from '../src/board/roomWallMigration';

const wall = (id: string, chainId: string | null, p1: [number, number], p2: [number, number]): MigrationWall => ({ id, chainId, p1: { x: p1[0], y: p1[1] }, p2: { x: p2[0], y: p2[1] } });

test('a converted room wall takes the settings of the 0.14 edge it stands on, whatever its level is called', () => {
  // The level's id holds underscores: nothing is read out of the wall's id.
  assert.deepEqual(roomWallMoves([wall('room_L_a_x_0_0_80_0', 'rooms_L_a_x', [0, 0], [10, 0])], new Set(['room_0_0_80_0'])),
    [{ from: 'room_0_0_80_0', to: 'room_L_a_x_0_0_80_0' }]);
  // A scene without levels: the empty level.
  assert.deepEqual(roomWallMoves([wall('room__0_0_80_0', 'rooms_', [0, 0], [10, 0])], new Set(['room_0_0_80_0'])),
    [{ from: 'room_0_0_80_0', to: 'room__0_0_80_0' }]);
});

test('negative coordinates and an edge stored the other way round', () => {
  assert.deepEqual(roomWallMoves([wall('room_L_-40_-20_80_0', 'rooms_L', [-5, -2.5], [10, 0])], new Set(['room_-40_-20_80_0'])),
    [{ from: 'room_-40_-20_80_0', to: 'room_L_-40_-20_80_0' }]);
  assert.deepEqual(roomWallMoves([wall('room_L_0_0_80_0', 'rooms_L', [0, 0], [10, 0])], new Set(['room_80_0_0_0'])),
    [{ from: 'room_80_0_0_0', to: 'room_L_0_0_80_0' }]);
});

test('two levels sharing an edge both take its settings; a wall of another chain never does', () => {
  const walls = [wall('room_L1_0_0_80_0', 'rooms_L1', [0, 0], [10, 0]), wall('room_L2_0_0_80_0', 'rooms_L2', [0, 0], [10, 0]), wall('kept', 'kept', [0, 0], [10, 0]), wall('lone', null, [0, 0], [10, 0])];
  assert.deepEqual(roomWallMoves(walls, new Set(['room_0_0_80_0'])), [{ from: 'room_0_0_80_0', to: 'room_L1_0_0_80_0' }, { from: 'room_0_0_80_0', to: 'room_L2_0_0_80_0' }]);
  assert.deepEqual(roomWallMoves(walls, new Set(['room_9_9_9_9'])), []);
  assert.deepEqual(roomWallMoves(walls, new Set()), []);
});

test('every level\'s walls are read from the store, not only the level shown', () => {
  const state = {
    viewedLevel: 'L1',
    levels: [{ id: 'L1' }, { id: 'L2' }],
    objects: {
      walls: {
        room_L1_0_0_80_0: { id: 'room_L1_0_0_80_0', kind: 'wall', chainId: 'rooms_L1', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, levels: ['L1'] },
        room_L2_0_80_80_80: { id: 'room_L2_0_80_80_80', kind: 'wall', chainId: 'rooms_L2', p1: { x: 0, y: 10 }, p2: { x: 10, y: 10 }, levels: ['L2'] },
        drawn: { id: 'drawn', kind: 'wall', p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } },
        broken: { id: 'broken', p1: { x: 'a' } },
      },
    },
  };
  const walls = migrationWalls(state);
  assert.deepEqual(walls.map((each) => each.id), ['room_L1_0_0_80_0', 'room_L2_0_80_80_80', 'drawn']);
  assert.equal(walls[2]!.chainId, null);
  assert.deepEqual(roomWallMoves(walls, new Set(['room_0_80_80_80'])), [{ from: 'room_0_80_80_80', to: 'room_L2_0_80_80_80' }]);
  assert.deepEqual(migrationWalls(null), []);
  assert.deepEqual(migrationWalls({ objects: {} }), []);
});

test('a backup goes under the day, never over a file that is there', async () => {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const adapter = {
    exists: async (path: string) => folders.has(path) || files.has(path),
    mkdir: async (path: string) => { folders.add(path); },
    list: async (folder: string) => ({ files: [...files.keys()].filter((path) => path.startsWith(`${folder}/`)), folders: [] }),
    write: async (path: string, text: string) => { files.set(path, text); },
  };
  const app = { vault: { adapter } } as never;
  const day = new Date(2026, 10, 13, 9, 30);
  assert.equal(backupDay(day), '2026-11-13');
  const folder = await writeBackup(app, day, [{ name: 'Cellar.atlasmap', text: 'map' }, { name: 'Cellar.tabletop.json', text: 'data' }]);
  assert.equal(folder, 'Tabletop backups/2026-11-13');
  assert.equal(files.get('Tabletop backups/2026-11-13/Cellar.atlasmap'), 'map');
  await writeBackup(app, day, [{ name: 'Cellar.atlasmap', text: 'again' }, { name: 'a/b:c.json', text: 'x' }]);
  assert.equal(files.get('Tabletop backups/2026-11-13/Cellar.atlasmap'), 'map');
  assert.equal(files.get('Tabletop backups/2026-11-13/Cellar-2.atlasmap'), 'again');
  assert.equal(files.get('Tabletop backups/2026-11-13/a-b-c.json'), 'x');
});
