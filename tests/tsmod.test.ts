import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { isTsMod, readTsMod } from '../src/unity/tsmod';
import { readZip } from '../src/unity/zip';

const u32 = (...values: number[]): number[] => values.flatMap((value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
const u16 = (...values: number[]): number[] => values.flatMap((value) => [value & 255, (value >>> 8) & 255]);
const utf16 = (text: string): number[] => u16(...[...text].map((c) => c.charCodeAt(0)));

/** A square of four vertices (stride 48: position, normal, tangent, uv) and its two triangles. */
function squareBuffers(normalLength = 1): { vertices: Buffer; indices: Buffer } {
  const vertices = Buffer.alloc(4 * 48);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([x, y], i) => {
    const at = i * 48;
    vertices.writeFloatLE(x, at);
    vertices.writeFloatLE(y, at + 4);
    vertices.writeFloatLE(normalLength, at + 20); // the normal is (0, 0, normalLength)
    vertices.writeFloatLE(1, at + 24); // the tangent
    vertices.writeFloatLE(x, at + 40);
    vertices.writeFloatLE(y, at + 44);
  });
  return { vertices, indices: Buffer.from(u16(0, 1, 2, 0, 2, 3)) };
}

/** A .tsMod: the header with the name, then zlib streams, the pictures each after their width, height and mip count. */
function tsMod(options: { name?: string; version?: number; normalLength?: number; pictures?: Array<{ w: number; h: number; mips: number; data: Buffer }>; author?: string } = {}): Uint8Array {
  const { vertices, indices } = squareBuffers(options.normalLength);
  const name = options.name ?? 'Test Creature';
  const head: number[] = [...u32(0xd1ced1ce, options.version ?? 1, 52, 4), ...new Array(16).fill(7), ...new Array(0).fill(0)];
  head.push(...utf16(name));
  if (options.author) head.push(...utf16(options.author), ...u16(0xffff), ...u32(name.length));
  head.push(...new Array(48).fill(0));
  const parts: number[][] = [head, [...deflateSync(vertices)], [...deflateSync(indices)]];
  for (const picture of options.pictures ?? []) {
    const packed = deflateSync(picture.data);
    parts.push(u32(picture.w, picture.h, picture.mips, 65543, 8, packed.length), [...packed]);
  }
  parts.push(new Array(40).fill(1));
  return Uint8Array.from(parts.flat());
}

const dxt1 = (w: number, h: number, mips: number): Buffer => {
  let size = 0;
  for (let level = 0; level < mips; level++) size += Math.ceil(Math.max(1, w >> level) / 4) * Math.ceil(Math.max(1, h >> level) / 4) * 8;
  const out = Buffer.alloc(size);
  for (let at = 0; at < size; at += 8) out.writeUInt16LE(0xf800, at); // every block red
  return out;
};

test('a .tsMod is told by its signature', () => {
  assert.equal(isTsMod(tsMod()), true);
  assert.equal(isTsMod(Uint8Array.from(new Array(100).fill(1))), false);
});

test('a creature is read: its mesh, its colour map and its name', () => {
  const model = readTsMod(tsMod({ pictures: [{ w: 4, h: 4, mips: 3, data: dxt1(4, 4, 3) }] }));
  assert.equal(model.name, 'Test Creature');
  const [part] = model.parts;
  assert.equal(part.mesh.positions.length / 3, 4);
  assert.deepEqual([...part.mesh.indices], [0, 1, 2, 0, 2, 3]);
  assert.deepEqual([...part.mesh.uvs!.slice(2, 4)], [1, 0]);
  assert.deepEqual([...part.mesh.normals!.slice(0, 3)], [0, 0, 1]);
  const material = part.materials[0]!;
  assert.deepEqual([material.diffuse?.width, material.diffuse?.height], [4, 4]);
  assert.deepEqual([...material.diffuse!.rgba.slice(0, 4)], [255, 0, 0, 255]);
});

test('the name is cut where the header says it ends, before the author that follows it', () => {
  assert.equal(readTsMod(tsMod({ name: 'Dragon', author: 'Bob' })).name, 'Dragon');
});

test('a flat second picture is the mask: its red is the metal and its alpha the smoothness', () => {
  // A DXT5 mask: alpha 128 everywhere, colour (0, 255, 0): metal 0, occlusion 1, smoothness 128/255.
  const mask = Buffer.alloc(128 * 128 * 16);
  for (let at = 0; at < mask.length; at += 16) {
    mask[at] = 128;
    mask[at + 1] = 128;
    mask.writeUInt16LE(0x07e0, at + 8);
    mask.writeUInt16LE(0x07e0, at + 10);
  }
  const model = readTsMod(tsMod({ pictures: [{ w: 512, h: 512, mips: 1, data: dxt1(512, 512, 1) }, { w: 512, h: 512, mips: 1, data: mask }] }));
  const material = model.parts[0].materials[0]!;
  assert.equal(material.diffuse?.width, 512);
  assert.equal(material.metallic, 0);
  assert.ok(Math.abs(material.glossiness - 128 / 255) < 1e-6);
  assert.equal(material.metallicGloss, null);
});

test('a second picture of "straight out" colours is the normal map, packed in alpha and green (DXT5) or as plain RGB (DXT1)', () => {
  // DXT5: alpha 128 everywhere, colour (255, 130, 0): red 255, green and alpha near 128, as a DXT5nm map is.
  const packed = Buffer.alloc(128 * 128 * 16);
  for (let at = 0; at < packed.length; at += 16) {
    packed[at] = 128;
    packed[at + 1] = 128;
    packed.writeUInt16LE(0xfc00, at + 8);
    packed.writeUInt16LE(0xfc00, at + 10);
  }
  const five = readTsMod(tsMod({ pictures: [{ w: 512, h: 512, mips: 1, data: dxt1(512, 512, 1) }, { w: 512, h: 512, mips: 1, data: packed }] })).parts[0].materials[0]!;
  assert.ok(five.normal, 'the DXT5 picture is the normal map');
  assert.equal(five.normal.format, 12);
  assert.equal(five.metallicGloss, null);
  // DXT1: colour (132, 130, 255), a plain RGB normal map.
  const plain = Buffer.alloc(512 * 512 / 2);
  for (let at = 0; at < plain.length; at += 8) {
    plain.writeUInt16LE(0x841f, at);
    plain.writeUInt16LE(0x841f, at + 2);
  }
  const rgb = readTsMod(tsMod({ pictures: [{ w: 512, h: 512, mips: 1, data: dxt1(512, 512, 1) }, { w: 512, h: 512, mips: 1, data: plain }] })).parts[0].materials[0]!;
  assert.ok(rgb.normal, 'the DXT1 picture is the normal map');
  assert.equal(rgb.metallicGloss, null);
});

test('a normal map and a mask together are each told apart', () => {
  const mask = Buffer.alloc(128 * 128 * 16);
  for (let at = 0; at < mask.length; at += 16) {
    mask[at] = 128;
    mask[at + 1] = 128;
    mask.writeUInt16LE(0x07e0, at + 8);
    mask.writeUInt16LE(0x07e0, at + 10);
  }
  const plain = Buffer.alloc(512 * 512 / 2);
  for (let at = 0; at < plain.length; at += 8) {
    plain.writeUInt16LE(0x841f, at);
    plain.writeUInt16LE(0x841f, at + 2);
  }
  const model = readTsMod(tsMod({ pictures: [{ w: 512, h: 512, mips: 1, data: dxt1(512, 512, 1) }, { w: 512, h: 512, mips: 1, data: mask }, { w: 512, h: 512, mips: 1, data: plain }] }));
  const material = model.parts[0].materials[0]!;
  assert.ok(material.normal);
  assert.equal(material.metallic, 0);
  assert.ok(Math.abs(material.glossiness - 128 / 255) < 1e-6);
});

test('a small square picture beside the colour map is the icon and is not used', () => {
  const model = readTsMod(tsMod({ pictures: [{ w: 512, h: 512, mips: 1, data: dxt1(512, 512, 1) }, { w: 4, h: 4, mips: 1, data: dxt1(4, 4, 1) }] }));
  const material = model.parts[0].materials[0]!;
  assert.equal(material.diffuse?.width, 512);
  assert.equal(material.metallicGloss, null);
});

test('a .tsMod Tabletop cannot read is refused with the reason', () => {
  assert.throws(() => readTsMod(Uint8Array.from(new Array(100).fill(1))), /not a TaleSpire creature/);
  assert.throws(() => readTsMod(tsMod({ version: 2 })), /format 2/);
  assert.throws(() => readTsMod(tsMod({ normalLength: 5 })), /do not recognise|does not recognise|laid out/);
  const empty = Uint8Array.from([...u32(0xd1ced1ce, 1, 52, 4), ...new Array(200).fill(0)]);
  assert.throws(() => readTsMod(empty), /no mesh/);
});

// ── The zip reader ──────────────────────────────────────────────────────────────────────────────────────────────
/** A zip of one entry; with `zip64` its sizes are in a Zip64 extra field and the archive does not say it is Zip64. */
function zip(name: string, content: Buffer, options: { method?: 0 | 8; zip64?: boolean } = {}): Uint8Array {
  const method = options.method ?? 8;
  const body = method === 8 ? deflateRawSync(content) : content;
  const nameBytes = [...Buffer.from(name)];
  const local = [...u32(0x04034b50), ...u16(20, 0, method, 0, 0), ...u32(0, body.length, content.length), ...u16(nameBytes.length, 0), ...nameBytes, ...body];
  const extra = options.zip64 ? [...u16(1, 16), ...u32(content.length, 0), ...u32(body.length, 0)] : [];
  const sentinel = options.zip64 ? 0xffffffff : 0;
  const central = [...u32(0x02014b50), ...u16(20, 20, 0, method, 0, 0), ...u32(0, options.zip64 ? sentinel : body.length, options.zip64 ? sentinel : content.length),
    ...u16(nameBytes.length, extra.length, 0, 0, 0), ...u32(0, 0), ...nameBytes, ...extra];
  const end = [...u32(0x06054b50), ...u16(0, 0, 1, 1), ...u32(central.length, local.length), ...u16(0)];
  return Uint8Array.from([...local, ...central, ...end]);
}

test('a zip entry is read, deflated or stored, and Zip64 sizes in the entry are understood', () => {
  const text = Buffer.from('hello tabletop '.repeat(40));
  for (const method of [0, 8] as const) {
    for (const zip64 of [false, true]) {
      const out = readZip(zip('root.tsMod', text, { method, zip64 }), () => true);
      assert.deepEqual(Object.keys(out), ['root.tsMod']);
      assert.equal(Buffer.from(out['root.tsMod']).toString(), text.toString());
    }
  }
});

test('a zip is asked before an entry is unpacked, and a bad zip is explained', () => {
  const text = Buffer.from('abc');
  let asked: { name: string; size: number } | null = null;
  const out = readZip(zip('a.tsMod', text, { zip64: true }), (entry) => { asked = entry; return false; });
  assert.deepEqual(out, {});
  assert.deepEqual(asked, { name: 'a.tsMod', size: 3 });
  assert.throws(() => readZip(Uint8Array.from(new Array(100).fill(3)), () => true), /not a zip/);
  const good = zip('a.tsMod', text);
  assert.throws(() => readZip(good.slice(0, good.length - 30), () => true), /not a zip|damaged/);
});

// ── A real TaleSpire creature, when one is given ────────────────────────────────────────────────────────────────
// Set TABLETOP_TSMOD to the path of a root.tsMod (unzipped from a mod.io download). It is not kept in the repository.
const sample = process.env.TABLETOP_TSMOD;
test('a TaleSpire creature is read to its mesh and colour map', { skip: sample ? false : 'set TABLETOP_TSMOD to a .tsMod file to run this' }, () => {
  const model = readTsMod(new Uint8Array(readFileSync(sample!)));
  assert.ok(model.name.length > 0);
  const [part] = model.parts;
  assert.ok(part.mesh.positions.length / 3 > 1000);
  assert.equal(part.mesh.indices.length % 3, 0);
  assert.ok(part.materials[0]?.diffuse);
});
