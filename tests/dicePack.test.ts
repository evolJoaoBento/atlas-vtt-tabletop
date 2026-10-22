import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PACK, DEFAULT_PACK_CONFIG, defaultPackFiles, defaultPackSheets, releaseDefaultPackSheets } from '../src/dice/defaultPack';
import { choosePack } from '../src/dice/dicePack';
import { buildDie } from '../src/dice/dieBuild';
import { dieFaceNormals, dieGeometry, type DicePack } from '../src/dice/kit/dieShapes';
import type { DieType } from '../src/dice/kit/faces';
import type { PackFs } from '../src/dice/kit/packs';

const FOLDER = '.obsidian/atlas-dice-packs';

/** A packs folder holding `files` (path → text). */
function fakeFs(files: Record<string, string>): PackFs {
  return {
    exists: async (path) => path in files,
    list: async () => ({ files: [], folders: [] }),
    read: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path]!;
    },
    readBinary: async () => new ArrayBuffer(0),
    writeBinary: async () => undefined,
    mkdir: async () => undefined,
    getResourcePath: (path) => `app://vault/${path}`,
  };
}

/** Runs `body` with console.warn kept quiet. */
async function quietly<T>(body: () => Promise<T>): Promise<T> {
  const warn = console.warn;
  console.warn = () => undefined;
  try { return await body(); } finally { console.warn = warn; }
}

const facesOf = (config: Parameters<typeof dieGeometry>[2]): number => dieFaceNormals('d100', dieGeometry('d100', 0.5, config)).normals.length;

test('the chosen pack is read from the shared folder, its sheets as resource URLs', async () => {
  const manifest = { name: 'Bone', dice: { d6: { texture: 'six.png' }, d100: { geometry: 'd10', texture: 'pct.png' } } };
  const pack = await choosePack(fakeFs({ [`${FOLDER}/Bone/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Bone/six.png`]: '', [`${FOLDER}/Bone/pct.png`]: '' }), FOLDER, 'Bone');
  assert.equal(pack.name, 'Bone');
  assert.equal(pack.config.name, 'Bone');
  assert.deepEqual(pack.config.dice?.d6, manifest.dice.d6);
  assert.deepEqual(pack.config.dice?.d100, manifest.dice.d100);
  assert.equal(pack.textures.d6, `app://vault/${FOLDER}/Bone/six.png`);
  assert.equal(pack.textures.d100, `app://vault/${FOLDER}/Bone/pct.png`);
});

test('a pack that cannot be read falls back to the default pack Tabletop carries, never an empty pack', async () => {
  const fs = fakeFs({ [`${FOLDER}/Broken/pack.json`]: '{ not json', [`${FOLDER}/Bare/pack.json`]: '{"name":"Bare"}' });
  for (const name of ['Missing', 'Broken', 'Bare', '']) {
    const pack = await quietly(() => choosePack(fs, FOLDER, name));
    assert.equal(pack.name, DEFAULT_PACK, name);
    assert.equal(pack.config, DEFAULT_PACK_CONFIG, name);
    for (const type of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'] as const) assert.ok(pack.textures[type], `${name}: ${type} has a sheet`);
  }
  // Why it matters: a d100 from an empty pack is not built as a ten-sided die and never reads; from the default pack it is.
  assert.notEqual(facesOf({}), 10);
  assert.equal(facesOf(DEFAULT_PACK_CONFIG), 10);
});

test("the default pack's files go to the shared folder under its own name, the manifest among them", () => {
  const files = defaultPackFiles();
  assert.deepEqual(Object.keys(files).sort(), ['d10_Numbers.png', 'd10_Percent_Numbers.png', 'd12_Numbers.png', 'd20_Numbers.png', 'd4_Numbers.png', 'd6_Numbers.png', 'd8_Numbers.png', 'pack.json'].map((name) => `${DEFAULT_PACK}/${name}`).sort());
  assert.deepEqual(JSON.parse(new TextDecoder().decode(files[`${DEFAULT_PACK}/pack.json`])), DEFAULT_PACK_CONFIG);
  // A PNG's signature: the bytes went in as they are.
  assert.deepEqual([...new Uint8Array(files[`${DEFAULT_PACK}/d20_Numbers.png`]!).slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('a pack that leaves a die out takes that die from the default pack, its sheet too', async () => {
  const manifest = { name: 'Sixes', dice: { d6: { texture: 'six.png' } } };
  const pack = await choosePack(fakeFs({ [`${FOLDER}/Sixes/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Sixes/six.png`]: '' }), FOLDER, 'Sixes');
  assert.equal(pack.name, 'Sixes');
  assert.deepEqual(pack.config.dice?.d6, manifest.dice.d6);
  assert.equal(pack.textures.d6, `app://vault/${FOLDER}/Sixes/six.png`);
  for (const type of ['d4', 'd8', 'd10', 'd12', 'd20', 'd100'] as const) {
    assert.deepEqual(pack.config.dice?.[type], DEFAULT_PACK_CONFIG.dice?.[type], type);
    assert.match(pack.textures[type] ?? '', /^blob:/, `${type} wears the default sheet`);
  }
  assert.equal(facesOf(pack.config), 10);
});

test('the default sheets are let go of when the plugin unloads, and made again when asked', () => {
  const first = defaultPackSheets().d20;
  const revoked: string[] = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url: string) => { revoked.push(url); revoke(url); };
  try { releaseDefaultPackSheets(); } finally { URL.revokeObjectURL = revoke; }
  assert.ok(first && revoked.includes(first));
  assert.equal(revoked.length, 7);
  assert.notEqual(defaultPackSheets().d20, first);
});

test("a die that is no entry, or has no sheet to wear, takes the default pack's die", async () => {
  const manifest = { name: 'Thin', dice: { d4: 'd4', d8: {}, d20: { texture: 'twenty.png' }, d12: { texture: 'twelve.png' }, d10: {} } };
  const fs = fakeFs({ [`${FOLDER}/Thin/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Thin/twelve.png`]: '', [`${FOLDER}/Thin/d10_Numbers.png`]: '' });
  const pack = await quietly(() => choosePack(fs, FOLDER, 'Thin'));
  for (const type of ['d4', 'd8', 'd20'] as const) {
    assert.deepEqual(pack.config.dice?.[type], DEFAULT_PACK_CONFIG.dice?.[type], type);
    assert.match(pack.textures[type] ?? '', /^blob:/, `${type} wears the default sheet`);
  }
  // A sheet that is there keeps the pack's art, named or by its die's name.
  assert.equal(pack.textures.d12, `app://vault/${FOLDER}/Thin/twelve.png`);
  assert.deepEqual(pack.config.dice?.d12, { texture: 'twelve.png' });
  assert.equal(pack.textures.d10, `app://vault/${FOLDER}/Thin/d10_Numbers.png`);
});

/** The pack's dice as the table builds them: how many faces each reads, and the numbers on them, in order. */
const built = (type: DieType, config: DicePack): { faces: number; numbers: number[] } => {
  const { normals, numbers } = buildDie(type, 0.5, config);
  return { faces: normals.length, numbers: [...numbers].sort((a, b) => a - b) };
};

test("a die with only its sheet is built with the kit's own numbering and layout", async () => {
  const manifest = { dice: { d6: { texture: 'six.png' }, d20: { texture: 'twenty.png' }, d10: { texture: 'ten.png' } } };
  const files = { [`${FOLDER}/Art/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Art/six.png`]: '', [`${FOLDER}/Art/twenty.png`]: '', [`${FOLDER}/Art/ten.png`]: '' };
  const pack = await choosePack(fakeFs(files), FOLDER, 'Art');
  assert.equal(pack.textures.d20, `app://vault/${FOLDER}/Art/twenty.png`);
  assert.deepEqual(built('d6', pack.config), { faces: 6, numbers: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(built('d20', pack.config), { faces: 20, numbers: Array.from({ length: 20 }, (_, i) => i + 1) });
  assert.deepEqual(built('d10', pack.config), { faces: 10, numbers: Array.from({ length: 10 }, (_, i) => i) });
});

test('a d100 that names no solid is built on the d10 hull, numbered in tens', async () => {
  const manifest = { dice: { d100: { texture: 'pct.png' } } };
  const pack = await choosePack(fakeFs({ [`${FOLDER}/Pct/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Pct/pct.png`]: '' }), FOLDER, 'Pct');
  assert.equal(pack.textures.d100, `app://vault/${FOLDER}/Pct/pct.png`);
  assert.deepEqual(built('d100', pack.config), { faces: 10, numbers: Array.from({ length: 10 }, (_, i) => i * 10) });
  // The default pack's d100, laid out on its sheet, still reads its own numbers.
  assert.deepEqual(built('d100', DEFAULT_PACK_CONFIG), { faces: 10, numbers: Array.from({ length: 10 }, (_, i) => i * 10) });
});

test('numbers that do not fit the die are set aside; its sheet stays', async () => {
  const manifest = { dice: { d6: { texture: 'six.png', numbers: [1, 2, 3] }, d8: { texture: 'eight.png', numbers: [8, 7, 6, 5, 4, 3, 2, 1] } } };
  const files = { [`${FOLDER}/Odd/pack.json`]: JSON.stringify(manifest), [`${FOLDER}/Odd/six.png`]: '', [`${FOLDER}/Odd/eight.png`]: '' };
  const pack = await choosePack(fakeFs(files), FOLDER, 'Odd');
  assert.equal(pack.textures.d6, `app://vault/${FOLDER}/Odd/six.png`);
  assert.equal(pack.config.dice?.d6?.numbers, undefined);
  assert.deepEqual(built('d6', pack.config), { faces: 6, numbers: [1, 2, 3, 4, 5, 6] });
  assert.deepEqual(pack.config.dice?.d8?.numbers, [8, 7, 6, 5, 4, 3, 2, 1], 'numbers that fit are kept');
});
