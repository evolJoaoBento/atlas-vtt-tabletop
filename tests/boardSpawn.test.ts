import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import { TokenWriter } from '../src/board/tokenWriter';
import { fakeAtlas } from './fakeAtlasStore';
import { setSpawnBoard, type BoardSpawnHost } from '../src/assets/boardTarget';
import { spawnEncounterTokens, spawnTokenAsset } from '../src/atlasPort/app/packages/components/asset-manager/utils/tokenSpawnService';
import type { BoardGrid } from '../src/board/mapModel';

// Atlas's notices and debounces time with `window`, as in Obsidian.
(globalThis as { window?: unknown }).window ??= globalThis;
(globalThis as { document?: unknown }).document ??= { body: { createDiv: () => ({}) }, createElement: () => ({ style: {} }) };

const MAP = readFileSync('tests/fixtures/dungeon.atlasmap', 'utf8');
const GRID: BoardGrid = { enabled: true, visible: true, snap: true, type: 'square', size: 70, offsetX: 0, offsetY: 0 } as BoardGrid;

function board(centre = { x: 350, y: 350 }) {
  // Atlas holds the map: the spawn goes to its store (`addTokens`).
  const atlas = fakeAtlas('maps/dungeon.atlasmap', structuredClone(JSON.parse(MAP).state.objects.tokens));
  const selected: string[][] = [];
  const joined: string[][] = [];
  const writer = new TokenWriter(atlas.deps());
  const host: BoardSpawnHost = {
    leaf: {} as never, writer,
    mapPath: () => 'maps/dungeon.atlasmap',
    centre: () => centre,
    grid: () => GRID,
    tokens: () => atlas.state.objects.tokens as never,
    select: (ids) => selected.push([...ids]),
    joinInitiative: async (ids) => { joined.push([...ids]); },
    openMap: async () => {},
  };
  setSpawnBoard(host);
  return { host, selected, joined, tokens: () => atlas.state.objects.tokens as Record<string, Record<string, number | string>> };
}

afterEach(() => setSpawnBoard(null));

const app = { workspace: { revealLeaf: async () => {}, setActiveLeaf: () => {}, getLeavesOfType: () => [] }, vault: { getAbstractFileByPath: () => ({}) }, metadataCache: {}, plugins: { plugins: {} } };
const ctx = { app, view: null, assetService: null, random: () => 0.5 } as never;
const goblin = { id: 'tok-goblin', type: 'tokens', name: 'Goblin', imagePath: 'art/goblin.png', size: 1 } as never;

test("Atlas's spawn puts a token at the board camera's centre, snapped to the grid", async () => {
  const { tokens, selected } = board({ x: 350, y: 350 });
  const ids = await spawnTokenAsset(ctx, goblin, 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(ids.length, 1);
  const added = tokens()[ids[0]!];
  assert.ok(added, 'written to the map');
  assert.equal(added.x, 385);
  assert.equal(added.y, 385);
  assert.equal(added.name, 'Goblin');
  assert.deepEqual(selected, [ids]);
});

test('several copies are laid out around the centre without overlapping', async () => {
  const { tokens } = board({ x: 700, y: 700 });
  const ids = await spawnTokenAsset(ctx, goblin, 4);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const places = ids.map((id) => `${tokens()[id]!.x},${tokens()[id]!.y}`);
  assert.equal(new Set(places).size, 4);
});

test('a fight puts the encounter into the initiative tracker', async () => {
  const { joined } = board();
  const encounter = { id: 'enc', type: 'encounters', name: 'Ambush', tokens: [{ imagePath: 'art/goblin.png', name: 'Goblin', size: 1 }] } as never;
  const ids = await spawnEncounterTokens(ctx, encounter, 'fight');
  assert.equal(ids.length, 1);
  assert.deepEqual(joined, [ids]);
});
