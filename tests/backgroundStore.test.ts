import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_SIZE, DEFAULT_BACKGROUND, emptyLayers, type BackgroundLayers } from '../src/background/backgroundData';
import { BackgroundStore, DEFAULT_BACKGROUNDS_FOLDER, type BackgroundFiles, type LayerCodec } from '../src/background/backgroundStore';

/** A vault in memory: file paths to bytes or text. */
class MemoryFiles implements BackgroundFiles {
  files = new Map<string, ArrayBuffer | string>();
  async read(path: string): Promise<ArrayBuffer | null> {
    const f = this.files.get(path);
    return f instanceof ArrayBuffer ? f : null;
  }
  async readText(path: string): Promise<string | null> {
    const f = this.files.get(path);
    return typeof f === 'string' ? f : null;
  }
  async write(path: string, data: ArrayBuffer | string): Promise<void> { this.files.set(path, data); }
  async folders(root: string): Promise<string[]> {
    const found = new Set<string>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(root + '/')) continue;
      found.add(root + '/' + path.slice(root.length + 1).split('/')[0]);
    }
    return [...found];
  }
  async remove(folder: string): Promise<void> {
    for (const path of [...this.files.keys()]) if (path.startsWith(folder + '/')) this.files.delete(path);
  }
  async rename(from: string, to: string): Promise<void> {
    for (const [path, data] of [...this.files]) {
      if (!path.startsWith(from + '/')) continue;
      this.files.delete(path);
      this.files.set(to + path.slice(from.length), data);
    }
  }
}

/** Encode copies the bytes; a first byte of 255 with size 1 is not used, so decode only returns null for a marker. */
const NULL_MARKER = 77;
class CopyCodec implements LayerCodec {
  nullFor: number | null = null;
  async encode(layer: Uint8Array): Promise<ArrayBuffer> { return layer.slice().buffer as ArrayBuffer; }
  async decode(bytes: ArrayBuffer): Promise<Uint8Array | null> {
    const out = new Uint8Array(bytes.slice(0));
    return out.length > 0 && out[0] === this.nullFor ? null : out;
  }
  async thumbnail(_layers: BackgroundLayers): Promise<ArrayBuffer> { return new Uint8Array([1, 2, 3]).buffer as ArrayBuffer; }
}

const ROOT = DEFAULT_BACKGROUNDS_FOLDER;

function setup(): { files: MemoryFiles; codec: CopyCodec; store: BackgroundStore } {
  const files = new MemoryFiles();
  const codec = new CopyCodec();
  return { files, codec, store: new BackgroundStore(files, codec) };
}

test('a created background shows in the list with its thumbnail path', async () => {
  const { store } = setup();
  const folder = await store.create('Caves');
  assert.equal(folder, `${ROOT}/Caves`);
  assert.deepEqual(await store.list(), [{ folder, name: 'Caves', thumb: `${folder}/thumb.png` }]);
});

test('the list is sorted by name and skips folders without background.json', async () => {
  const { store, files } = setup();
  await store.create('Zeta');
  await store.create('Alpha');
  await files.write(`${ROOT}/Stray/readme.txt`, 'x');
  assert.deepEqual((await store.list()).map((b) => b.name), ['Alpha', 'Zeta']);
});

test('saved settings and layers load back the same', async () => {
  const { store } = setup();
  const folder = await store.create('Hills');
  const layers = emptyLayers();
  layers.terrain[5] = 4;
  layers.material[9] = 2;
  layers.height[100] = 7;
  const settings = { ...DEFAULT_BACKGROUND, name: 'Hills', materials: ['m/a'], height: { low: -1, high: 9 } };
  await store.save(folder, settings, layers);
  const loaded = await store.load(folder);
  assert.ok(loaded);
  assert.deepEqual(loaded.settings, settings);
  assert.equal(loaded.layers.size, BACKGROUND_SIZE);
  assert.deepEqual(loaded.layers.terrain, layers.terrain);
  assert.deepEqual(loaded.layers.material, layers.material);
  assert.deepEqual(loaded.layers.height, layers.height);
});

test('save writes the thumbnail and tells listeners', async () => {
  const { store, files } = setup();
  const folder = await store.create('Thumb');
  let calls = 0;
  const off = store.onChange(() => { calls++; });
  await store.save(folder, DEFAULT_BACKGROUND, emptyLayers());
  assert.equal(calls, 1);
  assert.ok(files.files.get(`${folder}/thumb.png`) instanceof ArrayBuffer);
  off();
  await store.save(folder, DEFAULT_BACKGROUND, emptyLayers());
  assert.equal(calls, 1);
});

test('a folder without background.json does not load', async () => {
  const { store } = setup();
  assert.equal(await store.load(`${ROOT}/Nothing`), null);
});

test('a missing layer loads as its empty value and warns once', async () => {
  const { store, files } = setup();
  const folder = await store.create('Gappy');
  files.files.delete(`${folder}/material.png`);
  files.files.delete(`${folder}/height.png`);
  const warns: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warns.push(args); };
  try {
    const loaded = await store.load(folder);
    assert.ok(loaded);
    assert.ok(loaded.layers.material.every((v) => v === 0));
    assert.ok(loaded.layers.height.every((v) => v === 128));
  } finally { console.warn = original; }
  assert.equal(warns.length, 1);
  const text = warns[0].join(' ');
  assert.ok(text.includes('Gappy') && text.includes('material') && text.includes('height'));
});

test('a layer that cannot be decoded loads as empty', async () => {
  const { store, codec } = setup();
  const folder = await store.create('Bad');
  const layers = emptyLayers();
  layers.terrain.fill(NULL_MARKER);
  await store.save(folder, DEFAULT_BACKGROUND, layers);
  codec.nullFor = NULL_MARKER;
  const original = console.warn;
  console.warn = () => {};
  try {
    const loaded = await store.load(folder);
    assert.ok(loaded);
    assert.ok(loaded.layers.terrain.every((v) => v === 0));
  } finally { console.warn = original; }
});

test('names become safe folder names', async () => {
  const { store } = setup();
  assert.equal(await store.create('a/b:c'), `${ROOT}/a b c`);
  assert.equal(await store.create('  ??  '), `${ROOT}/Background`);
});

test('duplicate names get a number', async () => {
  const { store } = setup();
  const a = await store.create('Keep');
  const b = await store.create('Keep');
  const c = await store.duplicate(a, 'Keep');
  assert.deepEqual([a, b, c], [`${ROOT}/Keep`, `${ROOT}/Keep 2`, `${ROOT}/Keep 3`]);
});

test('a duplicate holds the same layers and its own name', async () => {
  const { store } = setup();
  const a = await store.create('Orig');
  const layers = emptyLayers();
  layers.terrain[3] = 9;
  await store.save(a, { ...DEFAULT_BACKGROUND, name: 'Orig' }, layers);
  const b = await store.duplicate(a, 'Copy');
  const loaded = await store.load(b);
  assert.ok(loaded);
  assert.equal(loaded.settings.name, 'Copy');
  assert.equal(loaded.layers.terrain[3], 9);
  assert.equal((await store.list()).length, 2);
});

test('rename moves the folder and keeps the name in step', async () => {
  const { store } = setup();
  const a = await store.create('Old');
  await store.create('New');
  const moved = await store.rename(a, 'New');
  assert.equal(moved, `${ROOT}/New 2`);
  const loaded = await store.load(moved);
  assert.equal(loaded?.settings.name, 'New 2');
  assert.equal(await store.load(a), null);
  assert.equal(await store.rename(moved, 'New 2'), moved);
});

test('remove drops it from the list', async () => {
  const { store } = setup();
  const a = await store.create('Gone');
  await store.create('Stay');
  let calls = 0;
  store.onChange(() => { calls++; });
  await store.remove(a);
  assert.deepEqual((await store.list()).map((b) => b.name), ['Stay']);
  assert.equal(calls, 1);
});
