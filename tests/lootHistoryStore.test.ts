import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TFile, TFolder, type TAbstractFile } from 'obsidian';
import { boardLootHistory } from '../src/loot/historyStore';
import { serializeDeviceLootHistory } from '../src/atlasPort/app/loot/deviceLootHistory';
import type { LootRoll } from '../src/atlasPort/app/loot/lootHistory';

// Atlas's debounce times with `window.setTimeout`, as in Obsidian.
(globalThis as { window?: unknown }).window ??= globalThis;

const ATLAS_ID ='11111111-2222-4333-8444-555555555555';
const FOLDER = 'atlas-vtt/collections/col1/loot-history';
const ATLAS_FILE = `${FOLDER}/${ATLAS_ID}.json`;
const OWN_FILE = `${FOLDER}/${ATLAS_ID}-tabletop.json`;

const roll = (id: string, rolledAt: number): LootRoll => ({
  id, rolledAt, mapName: 'Map', draws: [{ id: `${id}-d`, name: 'Sword', source: ['Base'], properties: [], notePath: 'Items/Sword.md' }],
});

/** A vault of text files with Obsidian's events, and a record of every write. */
function fakeApp(initial: Record<string, string>) {
  const texts = new Map(Object.entries(initial));
  const writes: string[] = [];
  const handlers = new Map<string, Array<(file: TAbstractFile, old?: string) => void>>();
  const folder = (path: string) => {
    const found = new TFolder(path);
    found.children = [...texts.keys()].filter((key) => key.startsWith(`${path}/`)).map((key) => new TFile(key));
    return found;
  };
  const storage = new Map<string, unknown>([['atlas-vtt-device-id', ATLAS_ID]]);
  const app = {
    loadLocalStorage: (key: string) => storage.get(key) ?? null,
    saveLocalStorage: (key: string, value: unknown) => { storage.set(key, value); },
    vault: {
      on: (name: string, handler: (file: TAbstractFile, old?: string) => void) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
        return { name, handler };
      },
      offref: () => {},
      getFileByPath: (path: string) => (texts.has(path) ? new TFile(path) : null),
      getFolderByPath: (path: string) => folder(path),
      getAbstractFileByPath: (path: string) => (texts.has(path) ? new TFile(path) : folder(path)),
      createFolder: async () => {},
      read: async (file: TFile) => texts.get(file.path) ?? '',
      process: async (file: TFile, change: (text: string) => string) => { texts.set(file.path, change(texts.get(file.path) ?? '')); writes.push(file.path); },
      create: async (path: string, text: string) => { texts.set(path, text); writes.push(path); return new TFile(path); },
      adapter: { exists: async () => false, read: async () => '' },
    },
  };
  /** Another device (Atlas) writes its file, as sync or Atlas itself would. */
  const external = (path: string, text: string) => {
    texts.set(path, text);
    for (const handler of handlers.get('modify') ?? []) handler(new TFile(path));
  };
  return { app, texts, writes, external };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("merges Atlas's rolls and the board's", async () => {
  const { app } = fakeApp({ [ATLAS_FILE]: serializeDeviceLootHistory({ rolls: [roll('a1', 10)], removed: [] }) });
  const history = boardLootHistory(app as never);
  const rolls = await history.load('col1');
  assert.deepEqual(rolls.map((entry) => entry.id), ['a1']);
  history.add('col1', roll('t1', 20));
  await settle();
  const after = await history.load('col1');
  assert.deepEqual(after.map((entry) => entry.id), ['t1', 'a1']);
});

test("writes only the board's own file, never Atlas's", async () => {
  const { app, writes, texts } = fakeApp({ [ATLAS_FILE]: serializeDeviceLootHistory({ rolls: [roll('a1', 10)], removed: [] }) });
  const before = texts.get(ATLAS_FILE);
  const history = boardLootHistory(app as never);
  await history.load('col1');
  history.add('col1', roll('t1', 20));
  history.remove('col1', 'a1');
  history.clear('col1');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.ok(writes.length > 0, 'the board saved its file');
  assert.deepEqual([...new Set(writes)], [OWN_FILE]);
  assert.equal(texts.get(ATLAS_FILE), before);
});

test("removing Atlas's roll records it in the board's own file", async () => {
  const { app, texts } = fakeApp({ [ATLAS_FILE]: serializeDeviceLootHistory({ rolls: [roll('a1', 10)], removed: [] }) });
  const history = boardLootHistory(app as never);
  await history.load('col1');
  history.remove('col1', 'a1');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.deepEqual(JSON.parse(texts.get(OWN_FILE) ?? '{}').removed, ['a1']);
  assert.deepEqual(await history.load('col1'), []);
});

test("picks up Atlas's new roll when its file changes", async () => {
  const { app, external } = fakeApp({ [ATLAS_FILE]: serializeDeviceLootHistory({ rolls: [], removed: [] }) });
  const history = boardLootHistory(app as never);
  await history.load('col1');
  const seen: string[][] = [];
  history.subscribe('col1', (rolls) => seen.push(rolls.map((entry) => entry.id)));
  external(ATLAS_FILE, serializeDeviceLootHistory({ rolls: [roll('a2', 30)], removed: [] }));
  await settle();
  assert.deepEqual(seen.at(-1), ['a2']);
});

test('ignores a malformed history file', async () => {
  const { app } = fakeApp({ [ATLAS_FILE]: '{ not json', [`${FOLDER}/other.json`]: serializeDeviceLootHistory({ rolls: [roll('o1', 5)], removed: [] }) });
  const rolls = await boardLootHistory(app as never).load('col1');
  assert.deepEqual(rolls.map((entry) => entry.id), ['o1']);
});
