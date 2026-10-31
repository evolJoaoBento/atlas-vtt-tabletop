/**
 * Turns a Unity Texture2D object into RGBA pixels, at the largest mip that fits `maxSize`. Reads the uncompressed
 * formats and DXT1/DXT5 (what HeroForge writes); the others are refused with their name. Rows are bottom-first, as
 * Unity stores them, which is what an uploaded texture expects.
 */
import type { Record } from './serialized';
import type { ResourceReader } from './mesh';

export interface DecodedTexture {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  /** The Unity format the pixels came from. */
  readonly format: number;
}

const NAMES: { [format: number]: string } = {
  2: 'RGBA4444', 7: 'RGB565', 9: 'R16', 11: 'DXT3', 13: 'RGBA4444', 15: 'RHalf', 24: 'RGBAHalf', 25: 'BC7', 26: 'BC4', 27: 'BC5',
  28: 'Crunch DXT1', 29: 'Crunch DXT5', 34: 'ETC', 45: 'ETC2', 46: 'ETC2', 47: 'ETC2', 48: 'ASTC', 49: 'ASTC', 50: 'ASTC',
  51: 'ASTC', 52: 'ASTC', 53: 'ASTC', 54: 'ASTC', 55: 'ASTC', 56: 'ASTC', 57: 'ASTC', 58: 'ASTC', 59: 'ASTC',
};

const MAX_PIXELS = 16384 * 16384;

/** Bytes a mip of this format takes, or null when the format is not one this reads. */
function mipBytes(format: number, width: number, height: number): number | null {
  switch (format) {
    case 1: return width * height;
    case 3: return width * height * 3;
    case 4: case 5: case 14: return width * height * 4;
    case 10: return Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
    case 12: return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
    default: return null;
  }
}

function expand565(value: number, out: Uint8Array, at: number): void {
  const r = (value >> 11) & 31;
  const g = (value >> 5) & 63;
  const b = value & 31;
  out[at] = (r << 3) | (r >> 2);
  out[at + 1] = (g << 2) | (g >> 4);
  out[at + 2] = (b << 3) | (b >> 2);
}

/** DXT1 (8-byte blocks) and DXT5 (16-byte blocks with a smooth alpha block first). */
function decodeBlocks(data: Uint8Array, width: number, height: number, withAlpha: boolean): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blocksWide = Math.ceil(width / 4);
  const blocksHigh = Math.ceil(height / 4);
  const stride = withAlpha ? 16 : 8;
  const palette = new Uint8Array(16);
  const alpha = new Uint8Array(8);
  for (let by = 0; by < blocksHigh; by++) {
    for (let bx = 0; bx < blocksWide; bx++) {
      const block = (by * blocksWide + bx) * stride;
      const colour = block + (withAlpha ? 8 : 0);
      const c0 = view.getUint16(colour, true);
      const c1 = view.getUint16(colour + 2, true);
      expand565(c0, palette, 0);
      expand565(c1, palette, 4);
      palette[3] = 255;
      palette[7] = 255;
      if (c0 > c1 || withAlpha) {
        for (let k = 0; k < 3; k++) {
          palette[8 + k] = Math.floor((2 * palette[k] + palette[4 + k]) / 3);
          palette[12 + k] = Math.floor((palette[k] + 2 * palette[4 + k]) / 3);
        }
        palette[11] = 255;
        palette[15] = 255;
      } else {
        for (let k = 0; k < 3; k++) {
          palette[8 + k] = Math.floor((palette[k] + palette[4 + k]) / 2);
          palette[12 + k] = 0;
        }
        palette[11] = 255;
        palette[15] = 0;
      }
      let alphaLow = 0;
      let alphaHigh = 0;
      if (withAlpha) {
        const a0 = view.getUint8(block);
        const a1 = view.getUint8(block + 1);
        alpha[0] = a0;
        alpha[1] = a1;
        if (a0 > a1) {
          for (let k = 1; k <= 6; k++) alpha[1 + k] = Math.floor(((7 - k) * a0 + k * a1) / 7);
        } else {
          for (let k = 1; k <= 4; k++) alpha[1 + k] = Math.floor(((5 - k) * a0 + k * a1) / 5);
          alpha[6] = 0;
          alpha[7] = 255;
        }
        // Sixteen 3-bit indices in six bytes: the first eight in the first three bytes, the rest in the others.
        alphaLow = view.getUint8(block + 2) | (view.getUint8(block + 3) << 8) | (view.getUint8(block + 4) << 16);
        alphaHigh = view.getUint8(block + 5) | (view.getUint8(block + 6) << 8) | (view.getUint8(block + 7) << 16);
      }
      const indices = view.getUint32(colour + 4, true);
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py;
        if (y >= height) continue;
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          if (x >= width) continue;
          const slot = py * 4 + px;
          const colourIndex = (indices >>> (2 * slot)) & 3;
          const at = (y * width + x) * 4;
          out[at] = palette[colourIndex * 4];
          out[at + 1] = palette[colourIndex * 4 + 1];
          out[at + 2] = palette[colourIndex * 4 + 2];
          out[at + 3] = withAlpha ? alpha[((slot < 8 ? alphaLow >> (3 * slot) : alphaHigh >> (3 * (slot - 8))) & 7)] : palette[colourIndex * 4 + 3];
        }
      }
    }
  }
  return out;
}

function toRgba(format: number, data: Uint8Array, width: number, height: number): Uint8Array {
  const pixels = width * height;
  if (format === 10 || format === 12) return decodeBlocks(data, width, height, format === 12);
  const out = new Uint8Array(pixels * 4);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    switch (format) {
      case 1: out[o] = out[o + 1] = out[o + 2] = 255; out[o + 3] = data[i]; break;
      case 3: out[o] = data[i * 3]; out[o + 1] = data[i * 3 + 1]; out[o + 2] = data[i * 3 + 2]; out[o + 3] = 255; break;
      case 4: out.set(data.subarray(i * 4, i * 4 + 4), o); break;
      case 5: out[o] = data[i * 4 + 1]; out[o + 1] = data[i * 4 + 2]; out[o + 2] = data[i * 4 + 3]; out[o + 3] = data[i * 4]; break;
      default: out[o] = data[i * 4 + 2]; out[o + 1] = data[i * 4 + 1]; out[o + 2] = data[i * 4]; out[o + 3] = data[i * 4 + 3];
    }
  }
  return out;
}

/** Bytes of a whole texture (every mip) in a format this reads, or null for other formats. */
export function textureBytes(format: number, width: number, height: number, mips: number): number | null {
  let total = 0;
  for (let level = 0; level < mips; level++) {
    const size = mipBytes(format, Math.max(1, width >> level), Math.max(1, height >> level));
    if (size === null) return null;
    total += size;
  }
  return total;
}

export function decodeTexture(texture: Record, resource: ResourceReader, maxSize: number): DecodedTexture {
  const format = texture.m_TextureFormat;
  const width = texture.m_Width;
  const height = texture.m_Height;
  const mips = typeof texture.m_MipCount === 'number' && texture.m_MipCount > 0 ? texture.m_MipCount : 1;
  if (typeof format !== 'number' || typeof width !== 'number' || typeof height !== 'number') throw new Error('a texture is missing its size or format.');
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new Error('a texture has an unusable size.');
  if (mipBytes(format, 1, 1) === null) throw new Error(`a texture uses the ${NAMES[format] ?? `format ${format}`} format, which Tabletop does not read.`);
  let bytes = texture['image data'] instanceof Uint8Array ? texture['image data'] : new Uint8Array(0);
  if (bytes.length === 0) {
    const stream = texture.m_StreamData;
    if (typeof stream !== 'object' || stream === null || Array.isArray(stream) || stream instanceof Uint8Array) throw new Error('a texture has no pixels.');
    if (typeof stream.size === 'number' && stream.size > 0) bytes = resource(String(stream.path ?? ''), Number(stream.offset), stream.size);
  }
  let offset = 0;
  let w = width;
  let h = height;
  for (let level = 0; level < mips; level++) {
    const size = mipBytes(format, w, h)!;
    if (offset + size > bytes.length) throw new Error('a texture is cut short.');
    if (w <= maxSize && h <= maxSize || level === mips - 1) {
      return { width: w, height: h, rgba: toRgba(format, bytes.subarray(offset, offset + size), w, h), format };
    }
    offset += size;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  throw new Error('a texture has no pixels.');
}
