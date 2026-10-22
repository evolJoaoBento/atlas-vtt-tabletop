import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_PACK, DEFAULT_PACK_CONFIG, defaultPackFiles } from '../src/dice/defaultPack';
import { choosePack } from '../src/dice/dicePack';
import { dieFaceNormals, dieGeometry } from '../src/dice/kit/dieShapes';
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
  const pack = await choosePack(fakeFs({ [`${FOLDER}/Bone/pack.json`]: JSON.stringify(manifest) }), FOLDER, 'Bone');
  assert.equal(pack.name, 'Bone');
  assert.deepEqual(pack.config, manifest);
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
