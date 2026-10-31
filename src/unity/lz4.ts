/** LZ4 block decompression (the format Unity uses for bundle blocks): no frame, the output size is known up front. */
export function lz4Block(source: Uint8Array, outputSize: number): Uint8Array {
  const out = new Uint8Array(outputSize);
  let s = 0;
  let o = 0;
  while (s < source.length) {
    const token = source[s++];
    let literals = token >> 4;
    if (literals === 15) {
      let more: number;
      do {
        if (s >= source.length) throw new Error('compressed data is damaged.');
        more = source[s++];
        literals += more;
      } while (more === 255);
    }
    if (s + literals > source.length || o + literals > outputSize) throw new Error('compressed data is damaged.');
    out.set(source.subarray(s, s + literals), o);
    s += literals;
    o += literals;
    if (s >= source.length) break;
    if (s + 2 > source.length) throw new Error('compressed data is damaged.');
    const offset = source[s] | (source[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > o) throw new Error('compressed data is damaged.');
    let length = token & 15;
    if (length === 15) {
      let more: number;
      do {
        if (s >= source.length) throw new Error('compressed data is damaged.');
        more = source[s++];
        length += more;
      } while (more === 255);
    }
    length += 4;
    if (o + length > outputSize) throw new Error('compressed data is damaged.');
    // Overlapping copies repeat the pattern, so they go byte by byte.
    for (let i = 0; i < length; i++, o++) out[o] = out[o - offset];
  }
  if (o !== outputSize) throw new Error('compressed data is damaged.');
  return out;
}
