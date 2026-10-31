import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isUnityBundle, readBundle } from '../src/unity/bundle';
import { lz4Block } from '../src/unity/lz4';
import { lzma } from '../src/unity/lzma';
import { decodeMesh } from '../src/unity/mesh';
import { readUnityModel } from '../src/unity/model';
import { decodeTexture } from '../src/unity/texture';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const noResource = (): Uint8Array => { throw new Error('no streaming file'); };

// ── LZ4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('lz4 copies literals and repeats a match, including one that overlaps itself', () => {
  assert.deepEqual([...lz4Block(bytes(0x32, 97, 98, 99, 3, 0), 9)], [...text('abcabcabc')]);
  assert.deepEqual([...lz4Block(bytes(0x14, 120, 1, 0), 9)], [...text('xxxxxxxxx')]);
});

test('lz4 reads a literal run longer than fifteen from its extra length bytes', () => {
  const literals = Array.from({ length: 20 }, (_, i) => 65 + i);
  assert.deepEqual([...lz4Block(bytes(0xf0, 5, ...literals), 20)], literals);
});

test('lz4 refuses damaged data: a match that reaches before the start, a short result, an overrun', () => {
  assert.throws(() => lz4Block(bytes(0x32, 97, 98, 99, 9, 0), 9), /damaged/);
  assert.throws(() => lz4Block(bytes(0x30, 97, 98, 99), 9), /damaged/);
  assert.throws(() => lz4Block(bytes(0x32, 97, 98, 99, 3, 0), 5), /damaged/);
});

// ── LZMA ────────────────────────────────────────────────────────────────────────────────────────────────────────
const LZMA_SIZE = 3107;
const LZMA_SHA1 = 'd6bc7c3ca572aca63677f68f87e8f9008146a609';
const LZMA_STREAM = Uint8Array.from(Buffer.from('5d0000010000399a09662dd86a3ab1126f5647c437498e8f377da2f61a2ee2d1bb72fcbb7e792a071539a947b68c75ca7be8f87d34bbfa648837d733cf21865970838ab70ea9024c26effafa6d1b4e157cda90c1223a1f9a351387a2f4bf696f7570a2a20592a21ab5c207adf4dcd8c59f163fa2a1f738aff3ddbf1ec53eb46401452fe2c842eac64be943c5c5c1832b3381fba80a30d1cd454dbcf5ffb6c7cfe690afccaf800f34ef54acae481377645f4d429e37424f5eb73c556a9e8f2eeb544f1df7dd8ef6b18bfd6be205bd1b8fc436989ecd3a9872603ad8abfe1cd315cea4e2708941fe9873d77c517d6593e310bc6734e712a9b86600b852f0355de7b97260500b67b0f94ba0c420705201f5dc40cd62eedab131248fe4246b307a07935efb8e2b4df025f3896054a0d0978efd6fd77d8f8d69231502b57ede89b0a9048355c68ac6e264c1da10fc00b337cb24170181a479daa5cafb71c3b22d95500801dee2b00d313e5f400d39ce3a51550d5edb1728c0e34096e9c8c8aa09d325f4dfe7427ff477cf6091bec1462313adfa873c60fa471bc5706413f53e1f49698dcbb7d8f90b8664fc5c4160bb795e04aa8128041a0aabc1dd5624a7a88a6588da12454ca07cbe05ae4af8e59c31e0ddb0e7b45634232a5df0e54433ec8119f450c7d8da1dd4c88d3a00159d9ef89dc4d32a8d36ed3339f42cce9ad8c552bdda99febe7c1e6c3c07f6b936467904eac8a0cea83fe8dfffd3e66a44', 'hex'));

test('lzma unpacks a block as Unity stores it (five property bytes, then the stream)', () => {
  const out = lzma(LZMA_STREAM.subarray(0, 5), LZMA_STREAM.subarray(5), LZMA_SIZE);
  assert.equal(out.length, LZMA_SIZE);
  assert.equal(createHash('sha1').update(out).digest('hex'), LZMA_SHA1);
});

test('lzma refuses a stream that does not start as one, and one cut short', () => {
  const broken = LZMA_STREAM.slice(5);
  broken[0] = 1;
  assert.throws(() => lzma(LZMA_STREAM.subarray(0, 5), broken, LZMA_SIZE), /damaged/);
  assert.throws(() => lzma(LZMA_STREAM.subarray(0, 5), LZMA_STREAM.subarray(5, 60), LZMA_SIZE), /damaged/);
  assert.throws(() => lzma(bytes(255, 0, 0, 1, 0), LZMA_STREAM.subarray(5), LZMA_SIZE), /damaged/);
});

// ── The bundle ──────────────────────────────────────────────────────────────────────────────────────────────────
function be32(value: number): number[] {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

/** A UnityFS bundle holding one file, its single block stored with `kind` (0 plain, 2 LZ4, 1 LZMA). */
function bundle(content: Uint8Array, kind: number, packed: Uint8Array, name = 'CAB-test'): Uint8Array {
  const info: number[] = [...new Array(16).fill(0), ...be32(1), ...be32(content.length), ...be32(packed.length), 0, kind, ...be32(1),
    0, 0, 0, 0, 0, 0, 0, 0, ...[0, 0, 0, 0, ...be32(content.length)], ...be32(4), ...text(name), 0];
  const header: number[] = [...text('UnityFS'), 0, ...be32(6), ...text('5.x.x'), 0, ...text('2019.1.0f2'), 0];
  const total = header.length + 8 + 12 + info.length + packed.length;
  return Uint8Array.from([...header, 0, 0, 0, 0, ...be32(total), ...be32(info.length), ...be32(info.length), ...be32(0x40), ...info, ...packed]);
}

test('a bundle is told by its signature', () => {
  assert.equal(isUnityBundle(bundle(text('x'), 0, text('x'))), true);
  assert.equal(isUnityBundle(text('glTF....')), false);
  assert.equal(isUnityBundle(bytes(1, 2, 3)), false);
});

test('readBundle returns the files of a plain block', () => {
  const files = readBundle(bundle(text('hello'), 0, text('hello')));
  assert.equal(files.length, 1);
  assert.equal(files[0].path, 'CAB-test');
  assert.equal(new TextDecoder().decode(files[0].data), 'hello');
});

test('readBundle unpacks LZ4 and LZMA blocks', () => {
  assert.equal(new TextDecoder().decode(readBundle(bundle(text('abcabcabc'), 2, bytes(0x32, 97, 98, 99, 3, 0)))[0].data), 'abcabcabc');
  const original = lzma(LZMA_STREAM.subarray(0, 5), LZMA_STREAM.subarray(5), LZMA_SIZE);
  const files = readBundle(bundle(original, 1, LZMA_STREAM));
  assert.equal(createHash('sha1').update(files[0].data).digest('hex'), LZMA_SHA1);
});

test('readBundle explains what it cannot read', () => {
  assert.throws(() => readBundle(text('not a bundle at all')), /not a Unity asset bundle/);
  const cut = bundle(text('hello'), 0, text('hello'));
  assert.throws(() => readBundle(cut.slice(0, cut.length - 8)), /cut short|ends too soon|damaged/);
  assert.throws(() => readBundle(bundle(text('hello'), 4, text('hello'))), /compression/);
});

// ── Textures ────────────────────────────────────────────────────────────────────────────────────────────────────
const rgba = (data: Uint8Array, at: number): number[] => [...data.subarray(at * 4, at * 4 + 4)];

test('a DXT1 texture decodes its four colours and the transparent one', () => {
  // Colour 0 red, colour 1 blue, so four colours; each pixel picks its own index (0 red, 1 blue, 2 and 3 between).
  const four = bytes(0x00, 0xf8, 0x1f, 0x00, 0xe4, 0xe4, 0xe4, 0xe4);
  const a = decodeTexture({ m_TextureFormat: 10, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': four }, noResource, 1024);
  assert.deepEqual([a.width, a.height], [4, 4]);
  assert.deepEqual(rgba(a.rgba, 0), [255, 0, 0, 255]);
  assert.deepEqual(rgba(a.rgba, 1), [0, 0, 255, 255]);
  assert.deepEqual(rgba(a.rgba, 2), [170, 0, 85, 255]);
  assert.deepEqual(rgba(a.rgba, 3), [85, 0, 170, 255]);
  // Colour 0 not above colour 1: three colours and a transparent fourth.
  const three = bytes(0x1f, 0x00, 0x00, 0xf8, 0xe4, 0xe4, 0xe4, 0xe4);
  const b = decodeTexture({ m_TextureFormat: 10, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': three }, noResource, 1024);
  assert.deepEqual(rgba(b.rgba, 0), [0, 0, 255, 255]);
  assert.deepEqual(rgba(b.rgba, 2), [127, 0, 127, 255]);
  assert.deepEqual(rgba(b.rgba, 3), [0, 0, 0, 0]);
});

test('a DXT5 texture takes its alpha from the alpha block', () => {
  // Alpha 255 and 0; every pixel picks index 1 (alpha 0) except the first, which picks index 0 (alpha 255).
  const block = bytes(255, 0, 0x48, 0x92, 0x24, 0x49, 0x92, 0x24, 0x00, 0xf8, 0x00, 0xf8, 0, 0, 0, 0);
  const t = decodeTexture({ m_TextureFormat: 12, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': block }, noResource, 1024);
  assert.deepEqual(rgba(t.rgba, 0), [255, 0, 0, 255]);
  assert.equal(rgba(t.rgba, 1)[3], 0);
  assert.equal(rgba(t.rgba, 15)[3], 0);
});

test('a texture is read at the largest mip that fits the limit, from its own data or the streaming file', () => {
  const mip0 = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
  const mip1 = [50, 60, 70, 255];
  const data = Uint8Array.from([...mip0, ...mip1]);
  const whole = decodeTexture({ m_TextureFormat: 4, m_Width: 2, m_Height: 2, m_MipCount: 2, 'image data': data }, noResource, 2);
  assert.deepEqual([whole.width, whole.height, ...rgba(whole.rgba, 3)], [2, 2, 10, 11, 12, 255]);
  const small = decodeTexture({ m_TextureFormat: 4, m_Width: 2, m_Height: 2, m_MipCount: 2, 'image data': data }, noResource, 1);
  assert.deepEqual([small.width, small.height, ...rgba(small.rgba, 0)], [1, 1, 50, 60, 70, 255]);
  let asked = '';
  const streamed = decodeTexture({ m_TextureFormat: 4, m_Width: 2, m_Height: 2, m_MipCount: 2, 'image data': new Uint8Array(0), m_StreamData: { offset: 3, size: 20, path: 'archive:/CAB/CAB.resS' } },
    (path, offset, size) => { asked = `${path}@${offset}+${size}`; return data; }, 2);
  assert.equal(asked, 'archive:/CAB/CAB.resS@3+20');
  assert.equal(streamed.width, 2);
});

test('a texture in a format this does not read is refused by name; a cut-short one is refused too', () => {
  assert.throws(() => decodeTexture({ m_TextureFormat: 25, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': new Uint8Array(16) }, noResource, 1024), /BC7/);
  assert.throws(() => decodeTexture({ m_TextureFormat: 28, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': new Uint8Array(16) }, noResource, 1024), /Crunch/);
  assert.throws(() => decodeTexture({ m_TextureFormat: 4, m_Width: 4, m_Height: 4, m_MipCount: 1, 'image data': new Uint8Array(10) }, noResource, 1024), /cut short/);
});

// ── Meshes ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** A triangle: float positions, half-float normals (4 wide) and half-float UVs, interleaved in one stream of 24 bytes. */
function triangleMesh(overrides: { [key: string]: unknown } = {}) {
  const buffer = new ArrayBuffer(3 * 24);
  const view = new DataView(buffer);
  const corners = [[0, 0, 0, 0, 0], [1, 0, 0, 1, 0], [0, 1, 0, 0, 1]];
  corners.forEach(([x, y, z, u, v], i) => {
    view.setFloat32(i * 24, x, true);
    view.setFloat32(i * 24 + 4, y, true);
    view.setFloat32(i * 24 + 8, z, true);
    view.setUint16(i * 24 + 12 + 2, 0x3c00, true); // normal y = 1.0
    view.setUint16(i * 24 + 20, u === 1 ? 0x3c00 : 0, true);
    view.setUint16(i * 24 + 22, v === 1 ? 0x3800 : 0, true); // 0.5
  });
  const channel = (offset: number, format: number, dimension: number) => ({ stream: 0, offset, format, dimension });
  const none = channel(0, 0, 0);
  return {
    m_MeshCompression: 0, m_IndexFormat: 0,
    m_VertexData: { m_VertexCount: 3, m_Channels: [channel(0, 0, 3), channel(12, 1, 4), none, none, channel(20, 1, 2)], m_DataSize: new Uint8Array(buffer) },
    m_StreamData: { offset: 0, size: 0, path: '' },
    m_IndexBuffer: Uint8Array.from([0, 0, 1, 0, 2, 0]),
    m_SubMeshes: [{ firstByte: 0, indexCount: 3, topology: 0, baseVertex: 0 }],
    ...overrides,
  };
}

test('a mesh is read: float positions, half-float normals and UVs, 16-bit triangles', () => {
  const mesh = decodeMesh(triangleMesh(), noResource, 19);
  assert.deepEqual([...mesh.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual([...mesh.normals!.slice(0, 3)], [0, 1, 0]);
  assert.deepEqual([...mesh.uvs!], [0, 0, 1, 0, 0, 0.5]);
  assert.deepEqual([...mesh.indices], [0, 1, 2]);
  assert.deepEqual(mesh.groups, [{ start: 0, count: 3, submesh: 0 }]);
});

test('a mesh adds its base vertex, and reads 32-bit indices', () => {
  const wide = triangleMesh({ m_IndexFormat: 1, m_IndexBuffer: Uint8Array.from([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0]) });
  assert.deepEqual([...decodeMesh(wide, noResource, 19).indices], [0, 1, 2]);
  const based = triangleMesh({ m_SubMeshes: [{ firstByte: 0, indexCount: 3, topology: 0, baseVertex: 1 }], m_IndexBuffer: Uint8Array.from([0, 0, 0, 0, 1, 0]) });
  assert.deepEqual([...decodeMesh(based, noResource, 19).indices], [1, 1, 2]);
});

test('a mesh whose vertices live in the streaming file is read from there', () => {
  const inline = triangleMesh();
  const data = (inline.m_VertexData as { m_DataSize: Uint8Array }).m_DataSize;
  const streamed = triangleMesh({
    m_VertexData: { ...(inline.m_VertexData as object), m_DataSize: new Uint8Array(0) },
    m_StreamData: { offset: 4, size: data.length, path: 'archive:/CAB/CAB.resS' },
  });
  const mesh = decodeMesh(streamed, (_path, offset, size) => { assert.equal(offset, 4); assert.equal(size, 72); return data; }, 19);
  assert.equal(mesh.positions.length, 9);
});

test('a mesh Tabletop cannot read is refused with the reason', () => {
  assert.throws(() => decodeMesh(triangleMesh({ m_MeshCompression: 2 }), noResource, 19), /compressed/);
  assert.throws(() => decodeMesh(triangleMesh(), noResource, 17), /older than 2019/);
  assert.throws(() => decodeMesh(triangleMesh({ m_IndexBuffer: Uint8Array.from([0, 0, 1, 0, 9, 0]) }), noResource, 19), /damaged triangles/);
  assert.throws(() => decodeMesh(triangleMesh({ m_SubMeshes: [{ firstByte: 0, indexCount: 3, topology: 3, baseVertex: 0 }] }), noResource, 19), /no triangles/);
  const short = triangleMesh();
  (short.m_VertexData as { m_DataSize: Uint8Array }).m_DataSize = new Uint8Array(30);
  assert.throws(() => decodeMesh(short, noResource, 19), /cut short/);
});

// ── A real HeroForge export, when one is given ──────────────────────────────────────────────────────────────────
// Set TABLETOP_UNITY_BUNDLE to the path of a .unity3d file (HeroForge's Unity3D export, unzipped). It is not kept in
// the repository: HeroForge's terms decide where their files may go.
const sample = process.env.TABLETOP_UNITY_BUNDLE;
test('a HeroForge Unity3D export is read to its mesh and pictures', { skip: sample ? false : 'set TABLETOP_UNITY_BUNDLE to a .unity3d file to run this' }, () => {
  const model = readUnityModel(new Uint8Array(readFileSync(sample!)));
  assert.ok(model.parts.length >= 1);
  const part = model.parts[0];
  assert.ok(part.mesh.positions.length / 3 > 1000);
  assert.equal(part.mesh.indices.length % 3, 0);
  assert.ok(part.mesh.normals && part.mesh.uvs);
  const material = part.materials[0];
  assert.ok(material?.diffuse && material.diffuse.width <= 1024);
  assert.equal(material.diffuse.rgba.length, material.diffuse.width * material.diffuse.height * 4);
});
