/**
 * Reads a TaleSpire creature (.tsMod) into the same model a Unity bundle gives. TaleSpire publishes no description of
 * the file; this reads the layout seen in a real creature, and checks every guess it makes:
 *
 *   - the file starts `CE D1 CE D1`, a version (1) and the creature's name in UTF-16;
 *   - the data is a run of zlib streams, each ending in its Adler-32 checksum: the vertex buffer, then the index
 *     buffer (16-bit, or 32-bit), then the pictures;
 *   - a picture is preceded by its width, height and mip count, and is DXT1, DXT5 or RGBA32 (told by its size);
 *   - a vertex is float32 position, normal, (tangent) and UV, with the UV in the last eight bytes.
 *
 * The first big picture is the colour map; each other big one is told by what it holds: a normal map (DXT5 with the
 * x in alpha and y in green, or plain RGB), or else a mask (metal in red, occlusion in green, smoothness in alpha); a
 * small square one is the creature's icon and is not used. A file that does not fit is refused with the
 * reason, never guessed at further.
 */
import { unzlibSync } from 'three/examples/jsm/libs/fflate.module.js';
import type { DecodedMesh } from './mesh';
import type { UnityMaterial, UnityModel } from './model';
import { MAX_TEXTURE_SIZE } from './model';
import { decodeTexture, textureBytes, type DecodedTexture } from './texture';

export const TSMOD_MAGIC = 0xd1ced1ce;

const MAX_UNPACKED = 512 * 1024 * 1024;
const STRIDES = [32, 36, 40, 44, 48, 52, 56, 60, 64];
const MAX_VERTICES = 4_000_000;

export function isTsMod(data: Uint8Array): boolean {
  return data.length > 64 && new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true) === TSMOD_MAGIC;
}

interface Stream {
  /** Offset of its zlib header. */
  readonly at: number;
  readonly data: Uint8Array;
  /** Width, height and mip count the words before it give, when they describe a picture it holds. */
  readonly picture: { width: number; height: number; mips: number; format: number } | null;
}

const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length;) {
    const stop = Math.min(data.length, i + 3800);
    for (; i < stop; i++) {
      a += data[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/**
 * The zlib streams of the file, in order. A stream is taken as one when it has a zlib header, inflates, and is followed
 * by the Adler-32 checksum of what it inflated; the checksum also says where the next stream may start.
 */
function readStreams(data: Uint8Array): Stream[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const streams: Stream[] = [];
  let total = 0;
  for (let p = 64; p + 6 < data.length;) {
    if (data[p] !== 0x78 || ((data[p] << 8) | data[p + 1]) % 31 !== 0) {
      p++;
      continue;
    }
    let unpacked: Uint8Array;
    try {
      unpacked = unzlibSync(data.subarray(p));
    } catch {
      p++;
      continue;
    }
    const check = adler32(unpacked);
    const tail = [(check >>> 24) & 255, (check >>> 16) & 255, (check >>> 8) & 255, check & 255];
    let end = -1;
    for (let q = p + 2; q + 4 <= data.length; q++) {
      if (data[q] === tail[0] && data[q + 1] === tail[1] && data[q + 2] === tail[2] && data[q + 3] === tail[3]) {
        end = q + 4;
        break;
      }
    }
    if (end < 0 || unpacked.length === 0) {
      p++;
      continue;
    }
    total += unpacked.length;
    if (total > MAX_UNPACKED) throw new Error('the creature is too large to read.');
    let picture: Stream['picture'] = null;
    if (p >= 28) {
      const width = view.getUint32(p - 24, true);
      const height = view.getUint32(p - 20, true);
      const mips = view.getUint32(p - 16, true);
      if (isPowerOfTwo(width) && isPowerOfTwo(height) && mips >= 1 && mips <= 14) {
        const format = [10, 12, 4].find((candidate) => textureBytes(candidate, width, height, mips) === unpacked.length);
        if (format !== undefined) picture = { width, height, mips, format };
      }
    }
    streams.push({ at: p, data: unpacked, picture });
    p = end;
  }
  return streams;
}

/**
 * The creature's name: the run of letters after the header's zero padding, cut at the length the header states a few
 * bytes on when there is one (the author's name follows it directly). Empty when nothing reads as a name.
 */
function readName(data: Uint8Array): string {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let start = 32;
  while (start + 1 < Math.min(data.length, 256) && view.getUint16(start, true) === 0) start += 2;
  let run = '';
  let at = start;
  for (; at + 1 < data.length && run.length < 120; at += 2) {
    const unit = view.getUint16(at, true);
    if (unit < 0x20 || unit > 0x24f) break;
    run += String.fromCharCode(unit);
  }
  for (let word = at; word + 4 <= Math.min(data.length, at + 64); word += 2) {
    const length = view.getUint32(word, true);
    if (length >= 3 && length < run.length) return run.slice(0, length).trim();
  }
  return run.trim();
}

/** A vertex buffer and the 16- or 32-bit indices that use it: the stride is the one that makes the counts agree. */
function readMesh(vertices: Uint8Array, indexBytes: Uint8Array): DecodedMesh {
  for (const wide of [false, true]) {
    const size = wide ? 4 : 2;
    if (indexBytes.length % (size * 3) !== 0) continue;
    const view = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
    const count = indexBytes.length / size;
    const indices = new Uint32Array(count);
    let largest = 0;
    for (let i = 0; i < count; i++) {
      const value = wide ? view.getUint32(i * 4, true) : view.getUint16(i * 2, true);
      indices[i] = value;
      if (value > largest) largest = value;
    }
    const needed = largest + 1;
    const stride = STRIDES.find((candidate) => vertices.length % candidate === 0 && vertices.length / candidate === needed)
      ?? STRIDES.find((candidate) => vertices.length % candidate === 0 && vertices.length / candidate > needed && vertices.length / candidate <= needed * 1.02);
    if (stride === undefined) continue;
    const vertexCount = vertices.length / stride;
    if (vertexCount > MAX_VERTICES) throw new Error('the creature has too many vertices.');
    const v = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let unit = 0;
    for (let i = 0; i < vertexCount; i++) {
      const base = i * stride;
      for (let k = 0; k < 3; k++) {
        positions[i * 3 + k] = v.getFloat32(base + k * 4, true);
        normals[i * 3 + k] = v.getFloat32(base + 12 + k * 4, true);
      }
      uvs[i * 2] = v.getFloat32(base + stride - 8, true);
      uvs[i * 2 + 1] = v.getFloat32(base + stride - 4, true);
      if (Math.abs(Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) - 1) < 0.05) unit++;
    }
    // The layout is a guess from one kind of file: it must look like positions, unit normals and UVs, or it is refused.
    const sane = positions.every(Number.isFinite) && uvs.every(Number.isFinite) && unit >= vertexCount * 0.95;
    if (!sane) continue;
    return { positions, normals, uvs, indices, groups: [{ start: 0, count: indices.length, submesh: 0 }] };
  }
  throw new Error('its vertices are laid out in a way Tabletop does not recognise.');
}

const uniform = (texture: DecodedTexture): boolean => {
  const { rgba } = texture;
  for (let i = 4; i < rgba.length; i += 4) if (rgba[i] !== rgba[0] || rgba[i + 1] !== rgba[1] || rgba[i + 2] !== rgba[2] || rgba[i + 3] !== rgba[3]) return false;
  return true;
};

/** Whether a picture holds a tangent-space normal map: its average is "straight out", not a mask's metal and gloss. */
function looksLikeNormals(texture: DecodedTexture): boolean {
  const total = [0, 0, 0, 0];
  let samples = 0;
  for (let i = 0; i < texture.rgba.length; i += 64) {
    for (let k = 0; k < 4; k++) total[k] += texture.rgba[i + k];
    samples++;
  }
  const [r, g, b, a] = total.map((sum) => sum / Math.max(1, samples));
  const near = (value: number): boolean => Math.abs(value - 128) < 28;
  return texture.format === 12 ? r > 200 && near(g) && near(a) : near(r) && near(g) && b > 200;
}

export function readTsMod(data: Uint8Array, maxTexture = MAX_TEXTURE_SIZE): UnityModel {
  if (!isTsMod(data)) throw new Error('it is not a TaleSpire creature (.tsMod).');
  const version = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4, true);
  if (version !== 1) throw new Error(`the creature is format ${version}, which Tabletop does not read.`);
  const streams = readStreams(data);
  const buffers = streams.filter((stream) => !stream.picture);
  if (buffers.length < 2) throw new Error('it holds no mesh Tabletop can find.');
  if (buffers.length > 2) throw new Error('it holds several meshes, which Tabletop does not read yet.');
  const mesh = readMesh(buffers[0].data, buffers[1].data);

  const noResource = (): Uint8Array => { throw new Error('the creature is missing a data file.'); };
  const pictures = streams.filter((stream) => stream.picture).map((stream) => {
    const { width, height, mips, format } = stream.picture!;
    return decodeTexture({ m_TextureFormat: format, m_Width: width, m_Height: height, m_MipCount: mips, 'image data': stream.data }, noResource, maxTexture);
  });
  // A small picture is the creature's icon; of the others the first is the colour map, then a normal map and a mask.
  const maps = pictures.filter((picture) => Math.max(picture.width, picture.height) > 256 || pictures.length === 1);
  const diffuse = maps[0] ?? null;
  const normal = maps.slice(1).find(looksLikeNormals) ?? null;
  const mask = maps.slice(1).find((picture) => picture !== normal) ?? null;
  const flatMask = mask && uniform(mask) ? mask : null;
  const material: UnityMaterial = {
    color: [1, 1, 1, 1],
    emissionColor: [0, 0, 0],
    metallic: flatMask ? flatMask.rgba[0] / 255 : 0,
    glossiness: flatMask ? flatMask.rgba[3] / 255 : 0.5,
    glossMapScale: 1,
    bumpScale: 1,
    occlusionStrength: 1,
    diffuse,
    normal,
    metallicGloss: mask && !flatMask ? mask : null,
    occlusion: mask && !flatMask ? { ...mask, rgba: occlusionOf(mask.rgba) } : null,
    emission: null,
  };
  return { name: readName(data), parts: [{ mesh, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], materials: [material] }] };
}

/** The mask's green channel (occlusion) in the red channel, where the glTF packing reads occlusion from. */
function occlusionOf(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 1];
    out[i + 3] = 255;
  }
  return out;
}
