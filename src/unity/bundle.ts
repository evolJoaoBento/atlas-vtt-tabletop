/**
 * Reads a Unity asset bundle (`UnityFS`, what HeroForge's Unity3D export is): its header, its block table and its files.
 * Blocks may be stored plain or LZ4 compressed; LZMA is refused with a reason. Nothing here touches the network or runs code
 * from the file: it is data only.
 */
import { ByteReader } from './byteReader';
import { lz4Block } from './lz4';
import { lzma } from './lzma';

export interface BundleFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/** Limits that keep a damaged or hostile file from using up the memory. */
const MAX_BLOCKS = 100_000;
const MAX_UNPACKED = 512 * 1024 * 1024;

const COMPRESSION = { none: 0, lzma: 1, lz4: 2, lz4hc: 3 } as const;

function unpack(data: Uint8Array, kind: number, size: number): Uint8Array {
  if (size > MAX_UNPACKED) throw new Error('the bundle is too large to read.');
  if (kind === COMPRESSION.none) {
    if (data.length !== size) throw new Error('the bundle is damaged.');
    return data;
  }
  if (kind === COMPRESSION.lz4 || kind === COMPRESSION.lz4hc) return lz4Block(data, size);
  if (kind === COMPRESSION.lzma) {
    if (data.length < 5) throw new Error('the bundle is damaged.');
    return lzma(data.subarray(0, 5), data.subarray(5), size);
  }
  throw new Error('the bundle uses a compression this version does not know.');
}

export function isUnityBundle(data: Uint8Array): boolean {
  return data.length > 8 && new TextDecoder().decode(data.subarray(0, 7)) === 'UnityFS' && data[7] === 0;
}

/** The files inside a UnityFS bundle. Throws, with a reason in plain words, when it cannot be read. */
export function readBundle(data: Uint8Array): BundleFile[] {
  if (!isUnityBundle(data)) throw new Error('it is not a Unity asset bundle.');
  const reader = new ByteReader(data, 8);
  reader.littleEndian = false;
  const version = reader.u32();
  reader.cString(); // the player version, "5.x.x"
  reader.cString(); // the engine version
  const totalSize = reader.i64();
  const compressedInfo = reader.u32();
  const uncompressedInfo = reader.u32();
  const flags = reader.u32();
  if (version < 6 || version > 8) throw new Error(`the bundle is format ${version}, which Tabletop does not read.`);
  if (totalSize > data.length) throw new Error('the bundle is cut short.');
  if (version >= 7) reader.align(16);
  if (flags & 0x80) throw new Error('this bundle keeps its block table at the end, which Tabletop does not read yet.');
  if (flags & 0x200) reader.align(16);
  const infoBytes = unpack(reader.take(compressedInfo), flags & 0x3f, uncompressedInfo);
  const info = new ByteReader(infoBytes);
  info.take(16); // a hash of the data
  const blockCount = info.i32();
  if (blockCount < 0 || blockCount > MAX_BLOCKS) throw new Error('the bundle is damaged.');
  const blocks: Array<{ size: number; packed: number; flags: number }> = [];
  for (let i = 0; i < blockCount; i++) blocks.push({ size: info.u32(), packed: info.u32(), flags: info.u16() });
  const nodeCount = info.i32();
  if (nodeCount < 0 || nodeCount > MAX_BLOCKS) throw new Error('the bundle is damaged.');
  const nodes: Array<{ offset: number; size: number; path: string }> = [];
  for (let i = 0; i < nodeCount; i++) {
    const offset = info.i64();
    const size = info.i64();
    info.u32(); // flags
    nodes.push({ offset, size, path: info.cString() });
  }

  const total = blocks.reduce((sum, block) => sum + block.size, 0);
  if (total > MAX_UNPACKED) throw new Error('the bundle is too large to read.');
  const all = new Uint8Array(total);
  let at = 0;
  for (const block of blocks) {
    all.set(unpack(reader.take(block.packed), block.flags & 0x3f, block.size), at);
    at += block.size;
  }
  return nodes.map((node) => {
    if (node.offset < 0 || node.size < 0 || node.offset + node.size > all.length) throw new Error('the bundle is damaged.');
    return { path: node.path, data: all.subarray(node.offset, node.offset + node.size) };
  });
}
