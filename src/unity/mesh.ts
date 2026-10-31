/**
 * Turns a Unity Mesh object into plain arrays. Only what a mini needs is read: positions, normals, the first UV set and
 * the triangles of each sub-mesh. Everything stays in Unity's own space (left-handed); the caller converts. A mesh with
 * compressed vertices, or one written by a Unity older than 2019, is refused with a reason.
 */
import type { Record, Value } from './serialized';

/** Reads `size` bytes at `offset` of the streaming file named `path`. */
export type ResourceReader = (path: string, offset: number, size: number) => Uint8Array;

export interface DecodedMesh {
  readonly positions: Float32Array;
  readonly normals: Float32Array | null;
  readonly uvs: Float32Array | null;
  /** Triangle corners; every index is below the vertex count. */
  readonly indices: Uint32Array;
  /** One range of `indices` for each sub-mesh that holds triangles, with that sub-mesh's index in the mesh. */
  readonly groups: ReadonlyArray<{ start: number; count: number; submesh: number }>;
}

const MAX_VERTICES = 4_000_000;
const MAX_INDICES = 12_000_000;

/** Bytes of each vertex format (Unity 2019 and later): float, half, unorm8, snorm8, unorm16, snorm16, then integers. */
const FORMAT_SIZE = [4, 2, 1, 1, 2, 2, 1, 1, 2, 2, 4, 4];

const num = (value: Value | undefined, what: string): number => {
  if (typeof value !== 'number') throw new Error(`the mesh is missing its ${what}.`);
  return value;
};
const list = (value: Value | undefined, what: string): Value[] => {
  if (!Array.isArray(value)) throw new Error(`the mesh is missing its ${what}.`);
  return value;
};
const rec = (value: Value | undefined, what: string): Record => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Uint8Array) throw new Error(`the mesh is missing its ${what}.`);
  return value;
};

function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 31) return fraction ? NaN : sign * Infinity;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function readComponent(view: DataView, at: number, format: number): number {
  switch (format) {
    case 0: return view.getFloat32(at, true);
    case 1: return half(view.getUint16(at, true));
    case 2: return view.getUint8(at) / 255;
    case 3: return Math.max(view.getInt8(at) / 127, -1);
    case 4: return view.getUint16(at, true) / 65535;
    case 5: return Math.max(view.getInt16(at, true) / 32767, -1);
    case 6: return view.getUint8(at);
    case 7: return view.getInt8(at);
    case 8: return view.getUint16(at, true);
    case 9: return view.getInt16(at, true);
    case 10: return view.getUint32(at, true);
    default: return view.getInt32(at, true);
  }
}

export function decodeMesh(mesh: Record, resource: ResourceReader, serializedVersion: number): DecodedMesh {
  if (serializedVersion < 19) throw new Error('the bundle was made by a Unity older than 2019, which Tabletop does not read.');
  if (num(mesh.m_MeshCompression, 'compression flag') !== 0) throw new Error('the mesh is compressed, which Tabletop does not read.');
  const vertexData = rec(mesh.m_VertexData, 'vertex data');
  const count = num(vertexData.m_VertexCount, 'vertex count');
  if (count <= 0 || count > MAX_VERTICES) throw new Error('the mesh has no vertices, or too many.');
  const channels = list(vertexData.m_Channels, 'vertex channels').map((channel) => {
    const c = rec(channel, 'vertex channel');
    return { stream: num(c.stream, 'stream'), offset: num(c.offset, 'offset'), format: num(c.format, 'format'), dimension: num(c.dimension, 'dimension') & 0xf };
  });

  let bytes = vertexData.m_DataSize instanceof Uint8Array ? vertexData.m_DataSize : new Uint8Array(0);
  if (bytes.length === 0) {
    const stream = rec(mesh.m_StreamData, 'stream data');
    const size = num(stream.size, 'stream size');
    if (size > 0) bytes = resource(String(stream.path ?? ''), num(stream.offset, 'stream offset'), size);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The streams follow each other, each starting on a 16-byte boundary; a stream's stride is what its channels span.
  const strides = new Map<number, number>();
  for (const channel of channels) {
    if (channel.dimension === 0) continue;
    const size = FORMAT_SIZE[channel.format];
    if (size === undefined) throw new Error('the mesh uses a vertex format this version does not know.');
    strides.set(channel.stream, Math.max(strides.get(channel.stream) ?? 0, channel.offset + channel.dimension * size));
  }
  const streamStart = new Map<number, number>();
  let cursor = 0;
  for (const stream of [...strides.keys()].sort((a, b) => a - b)) {
    streamStart.set(stream, cursor);
    cursor = Math.ceil((cursor + count * strides.get(stream)!) / 16) * 16;
  }
  const lastEnd = Math.max(0, ...[...strides.keys()].map((s) => streamStart.get(s)! + count * strides.get(s)!));
  if (lastEnd > bytes.length) throw new Error('the mesh is cut short.');

  const read = (index: number, wanted: number): Float32Array | null => {
    const channel = channels[index];
    if (!channel || channel.dimension === 0) return null;
    const stride = strides.get(channel.stream)!;
    const start = streamStart.get(channel.stream)!;
    const size = FORMAT_SIZE[channel.format];
    const out = new Float32Array(count * wanted);
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < wanted && k < channel.dimension; k++) out[i * wanted + k] = readComponent(view, start + i * stride + channel.offset + k * size, channel.format);
    }
    return out;
  };
  const positions = read(0, 3);
  if (!positions) throw new Error('the mesh has no positions.');
  const normals = read(1, 3);
  const uvs = read(4, 2);

  const indexBytes = mesh.m_IndexBuffer instanceof Uint8Array ? mesh.m_IndexBuffer : new Uint8Array(0);
  const wide = num(mesh.m_IndexFormat, 'index format') === 1;
  const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
  const step = wide ? 4 : 2;
  const indices: number[] = [];
  const groups: Array<{ start: number; count: number; submesh: number }> = [];
  list(mesh.m_SubMeshes, 'sub-meshes').forEach((entry, submesh) => {
    const sub = rec(entry, 'sub-mesh');
    if (num(sub.topology, 'topology') !== 0) return;
    const first = num(sub.firstByte, 'first index');
    const total = num(sub.indexCount, 'index count');
    const base = num(sub.baseVertex, 'base vertex');
    if (total % 3 !== 0 || first + total * step > indexBytes.length || indices.length + total > MAX_INDICES) throw new Error('the mesh has damaged triangles.');
    const start = indices.length;
    for (let i = 0; i < total; i++) {
      const at = first + i * step;
      const vertex = (wide ? indexView.getUint32(at, true) : indexView.getUint16(at, true)) + base;
      if (vertex < 0 || vertex >= count) throw new Error('the mesh has damaged triangles.');
      indices.push(vertex);
    }
    if (total > 0) groups.push({ start, count: total, submesh });
  });
  if (indices.length === 0) throw new Error('the mesh has no triangles.');
  return { positions, normals, uvs, indices: Uint32Array.from(indices), groups };
}
