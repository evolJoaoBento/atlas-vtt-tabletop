import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { App } from 'obsidian';
import { TAbstractFile, TFile, TFolder } from 'obsidian';
import { vaultBackgroundFiles } from '../src/background/vaultBackgroundFiles';

/** A small vault of folders and files that keeps `children` in step, as Obsidian's does; renames refuse a name that exists in another case, like Windows. */
function fakeApp() {
  const items = new Map<string, TAbstractFile>();
  const data = new Map<string, ArrayBuffer>();
  const log: string[] = [];
  const failRename: { to: string | null } = { to: null };
  const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));
  const attach = (item: TAbstractFile): void => {
    items.set(item.path, item);
    const parent = items.get(parentOf(item.path));
    if (parent instanceof TFolder) parent.children.push(item);
  };
  const detach = (item: TAbstractFile): void => {
    items.delete(item.path);
    const parent = items.get(parentOf(item.path));
    if (parent instanceof TFolder) parent.children = parent.children.filter((child) => child !== item);
  };
  const encode = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;
  const vault = {
    getAbstractFileByPath: (path: string) => items.get(path) ?? null,
    createFolder: async (path: string) => {
      if (!(items.get(parentOf(path)) instanceof TFolder) && parentOf(path)) throw new Error('no parent');
      if (items.has(path)) throw new Error('Folder already exists.');
      log.push(`folder ${path}`);
      attach(new TFolder(path));
    },
    createBinary: async (path: string, bytes: ArrayBuffer) => { if (items.has(path)) throw new Error('File already exists.'); data.set(path, bytes); attach(new TFile(path)); },
    create: async (path: string, text: string) => { if (items.has(path)) throw new Error('File already exists.'); data.set(path, encode(text)); attach(new TFile(path)); },
    modifyBinary: async (file: TFile, bytes: ArrayBuffer) => { log.push(`modify ${file.path}`); data.set(file.path, bytes); },
    modify: async (file: TFile, text: string) => { log.push(`modify ${file.path}`); data.set(file.path, encode(text)); },
    readBinary: async (file: TFile) => data.get(file.path)!,
    read: async (file: TFile) => new TextDecoder().decode(data.get(file.path)!),
  };
  const move = (item: TAbstractFile, to: string): void => {
    const from = item.path;
    const below = [...items.values()].filter((entry) => entry.path === from || entry.path.startsWith(`${from}/`));
    for (const entry of below) detach(entry);
    for (const entry of below) {
      const old = entry.path;
      entry.path = to + old.slice(from.length);
      if (data.has(old)) { data.set(entry.path, data.get(old)!); data.delete(old); }
    }
    for (const entry of below) { if (entry instanceof TFolder) entry.children = []; }
    for (const entry of below) attach(entry);
  };
  const fileManager = {
    renameFile: async (item: TAbstractFile, to: string) => {
      log.push(`rename ${item.path} -> ${to}`);
      if (failRename.to === to) throw new Error('rename refused');
      if ([...items.keys()].some((path) => path.toLowerCase() === to.toLowerCase())) throw new Error('Destination file already exists!');
      move(item, to);
    },
    trashFile: async (item: TAbstractFile) => { log.push(`trash ${item.path}`); for (const entry of [...items.values()]) if (entry.path === item.path || entry.path.startsWith(`${item.path}/`)) { detach(entry); data.delete(entry.path); } },
  };
  return { app: { vault, fileManager } as unknown as App, items, data, log, failRename };
}

const bytes = (...values: number[]): ArrayBuffer => new Uint8Array(values).buffer as ArrayBuffer;

test('writes text and bytes, creating folders, and reads them back', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('a/b/background.json', '{"name":"x"}');
  await files.write('a/b/terrain.png', bytes(1, 2, 3));
  assert.equal(await files.readText('a/b/background.json'), '{"name":"x"}');
  assert.deepEqual([...new Uint8Array((await files.read('a/b/terrain.png'))!)], [1, 2, 3]);
  assert.equal(await files.read('a/b/missing.png'), null);
  assert.equal(await files.readText('a/b/missing.json'), null);
});

test('writing again replaces the file', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('r/f/terrain.png', bytes(1));
  await files.write('r/f/terrain.png', bytes(9, 9));
  assert.deepEqual([...new Uint8Array((await files.read('r/f/terrain.png'))!)], [9, 9]);
  assert.ok(world.log.includes('modify r/f/terrain.png'));
});

test('folders lists only the folders holding background.json, with full paths', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/Forest/background.json', '{}');
  await files.write('root/Cave/background.json', '{}');
  await files.write('root/Stray/notes.md', 'x');
  await files.write('root/loose.json', '{}');
  assert.deepEqual((await files.folders('root')).sort(), ['root/Cave', 'root/Forest']);
  assert.deepEqual(await files.folders('nowhere'), []);
});

test('rename moves every file of the folder', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/Old/background.json', '{}');
  await files.write('root/Old/terrain.png', bytes(5));
  await files.rename('root/Old', 'root/New');
  assert.equal(await files.readText('root/Old/background.json'), null);
  assert.equal(await files.readText('root/New/background.json'), '{}');
  assert.deepEqual([...new Uint8Array((await files.read('root/New/terrain.png'))!)], [5]);
});

test('a rename that only changes capitals goes through a temporary name', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/forest/background.json', '{}');
  await files.write('root/forest/height.png', bytes(7));
  await files.rename('root/forest', 'root/Forest');
  assert.deepEqual(await files.folders('root'), ['root/Forest']);
  assert.deepEqual([...new Uint8Array((await files.read('root/Forest/height.png'))!)], [7]);
  assert.ok(world.log.includes('rename root/forest -> root/forest-renaming'));
});

test('a case-only rename picks another detour name when the first is taken', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/forest/background.json', '{}');
  await files.write('root/forest-renaming/other.txt', 'x');
  await files.rename('root/forest', 'root/Forest');
  assert.deepEqual(await files.folders('root'), ['root/Forest']);
  assert.ok(world.log.includes('rename root/forest -> root/forest-renaming-2'));
  assert.equal(await files.readText('root/forest-renaming/other.txt'), 'x');
});

test('a case-only rename that fails halfway puts the folder back and rethrows', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/forest/background.json', '{}');
  world.failRename.to = 'root/Forest';
  await assert.rejects(files.rename('root/forest', 'root/Forest'), /rename refused/);
  assert.deepEqual(await files.folders('root'), ['root/forest']);
});

test('remove trashes the whole folder', async () => {
  const world = fakeApp();
  const files = vaultBackgroundFiles(world.app);
  await files.write('root/Gone/background.json', '{}');
  await files.remove('root/Gone');
  assert.deepEqual(await files.folders('root'), []);
  assert.deepEqual(world.log.filter((line) => line.startsWith('trash')), ['trash root/Gone']);
  await files.remove('root/Never');
});
