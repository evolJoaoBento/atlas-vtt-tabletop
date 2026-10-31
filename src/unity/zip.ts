/**
 * A small zip reader for the models zips Tabletop imports. It reads the central directory itself, including the Zip64
 * sizes a writer may put in one entry (TaleSpire's mod.io zips do) without marking the whole archive Zip64, which the
 * general reader bundled with three.js does not take. Only stored and deflated entries are read; each entry is checked
 * against `accept` (by name and unpacked size) before it is unpacked.
 */
import { inflateSync } from 'three/examples/jsm/libs/fflate.module.js';

export interface ZipEntryInfo {
  readonly name: string;
  readonly size: number;
}

const END = 0x06054b50;
const END64_LOCATOR = 0x07064b50;
const END64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const SENTINEL = 0xffffffff;

const exact = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('a size in the zip is too large.');
  return Number(value);
};

/** The files of the zip that `accept` takes, by name. Throws, with a reason, when the zip cannot be read. */
export function readZip(data: Uint8Array, accept: (entry: ZipEntryInfo) => boolean): { [name: string]: Uint8Array } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 65535); at--) {
    if (view.getUint32(at, true) === END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Error('it is not a zip file.');
  let count = view.getUint16(end + 10, true);
  let directory = view.getUint32(end + 16, true);
  if ((count === 0xffff || directory === SENTINEL) && end >= 20 && view.getUint32(end - 20, true) === END64_LOCATOR) {
    const at = exact(view.getBigUint64(end - 20 + 8, true));
    if (at + 56 <= data.length && view.getUint32(at, true) === END64) {
      count = exact(view.getBigUint64(at + 32, true));
      directory = exact(view.getBigUint64(at + 48, true));
    }
  }
  const out: { [name: string]: Uint8Array } = {};
  let at = directory;
  for (let i = 0; i < count; i++) {
    if (at + 46 > data.length || view.getUint32(at, true) !== CENTRAL) throw new Error('the zip is damaged.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    let packed = view.getUint32(at + 20, true);
    let size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let local = view.getUint32(at + 42, true);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(data.subarray(at + 46, at + 46 + nameLength));
    // A Zip64 extra field holds, in this order, just the values that were 0xFFFFFFFF here.
    if (packed === SENTINEL || size === SENTINEL || local === SENTINEL) {
      const extraStart = at + 46 + nameLength;
      for (let field = extraStart; field + 4 <= extraStart + extraLength;) {
        const id = view.getUint16(field, true);
        const length = view.getUint16(field + 2, true);
        if (id === 1) {
          let cursor = field + 4;
          const next = (): number => {
            if (cursor + 8 > field + 4 + length) throw new Error('the zip is damaged.');
            const value = exact(view.getBigUint64(cursor, true));
            cursor += 8;
            return value;
          };
          if (size === SENTINEL) size = next();
          if (packed === SENTINEL) packed = next();
          if (local === SENTINEL) local = next();
          break;
        }
        field += 4 + length;
      }
    }
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || !accept({ name, size })) continue;
    if (flags & 1) throw new Error('the zip is encrypted.');
    if (local + 30 > data.length || view.getUint32(local, true) !== LOCAL) throw new Error('the zip is damaged.');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packed > data.length) throw new Error('the zip is damaged.');
    const body = data.subarray(start, start + packed);
    if (method === 0) out[name] = body.slice();
    else if (method === 8) out[name] = inflateSync(body, { out: new Uint8Array(size) });
    else throw new Error('the zip uses a compression Tabletop does not read.');
  }
  return out;
}
