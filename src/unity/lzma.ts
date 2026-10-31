/**
 * LZMA decompression of a block whose size is known, as Unity stores it: five property bytes, then the raw stream with
 * no size field. The output buffer doubles as the dictionary. Written from the LZMA specification.
 */
const PROB_INIT = 1024;
const TOP = 1 << 24;

class Range {
  range = 0xffffffff;
  code = 0;
  pos = 0;

  constructor(private readonly input: Uint8Array) {
    if (input.length < 5 || input[0] !== 0) throw new Error('compressed data is damaged.');
    for (let i = 1; i < 5; i++) this.code = ((this.code << 8) | input[i]) >>> 0;
    this.pos = 5;
  }

  private normalise(): void {
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0;
      // Reading past the end yields zeros; the caller's length check catches a short stream.
      this.code = ((this.code << 8) | (this.pos < this.input.length ? this.input[this.pos] : 0)) >>> 0;
      this.pos++;
    }
  }

  bit(probs: Uint16Array, index: number): number {
    const prob = probs[index];
    const bound = (this.range >>> 11) * prob;
    let result: number;
    if (this.code < bound) {
      this.range = bound >>> 0;
      probs[index] = prob + ((2048 - prob) >> 5);
      result = 0;
    } else {
      this.range = (this.range - bound) >>> 0;
      this.code = (this.code - bound) >>> 0;
      probs[index] = prob - (prob >> 5);
      result = 1;
    }
    this.normalise();
    return result;
  }

  direct(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i++) {
      this.range >>>= 1;
      let bit = 0;
      if (this.code >= this.range) {
        this.code = (this.code - this.range) >>> 0;
        bit = 1;
      }
      this.normalise();
      result = ((result << 1) | bit) >>> 0;
    }
    return result;
  }

  tree(probs: Uint16Array, base: number, bits: number): number {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, base + m);
    return m - (1 << bits);
  }

  reverse(probs: Uint16Array, base: number, bits: number): number {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(probs, base + m);
      m = (m << 1) | bit;
      symbol |= bit << i;
    }
    return symbol;
  }
}

class LengthModel {
  readonly choice = new Uint16Array(2).fill(PROB_INIT);
  readonly low = new Uint16Array(16 << 3).fill(PROB_INIT);
  readonly mid = new Uint16Array(16 << 3).fill(PROB_INIT);
  readonly high = new Uint16Array(256).fill(PROB_INIT);

  decode(rc: Range, posState: number): number {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

export function lzma(props: Uint8Array, source: Uint8Array, outputSize: number): Uint8Array {
  if (props.length < 5) throw new Error('compressed data is damaged.');
  let d = props[0];
  if (d >= 9 * 5 * 5) throw new Error('compressed data is damaged.');
  const lc = d % 9;
  d = Math.floor(d / 9);
  const lp = d % 5;
  const pb = Math.floor(d / 5);

  const out = new Uint8Array(outputSize);
  // The stream the block holds starts with a zero byte and four of code, like a standalone LZMA stream.
  const rc = new Range(source);
  const literal = new Uint16Array(0x300 << (lc + lp)).fill(PROB_INIT);
  const isMatch = new Uint16Array(12 << 4).fill(PROB_INIT);
  const isRep = new Uint16Array(12).fill(PROB_INIT);
  const isRepG0 = new Uint16Array(12).fill(PROB_INIT);
  const isRepG1 = new Uint16Array(12).fill(PROB_INIT);
  const isRepG2 = new Uint16Array(12).fill(PROB_INIT);
  const isRep0Long = new Uint16Array(12 << 4).fill(PROB_INIT);
  const posSlot = new Uint16Array(4 << 6).fill(PROB_INIT);
  const posDecoders = new Uint16Array(115).fill(PROB_INIT);
  const align = new Uint16Array(16).fill(PROB_INIT);
  const lengths = new LengthModel();
  const repLengths = new LengthModel();

  let state = 0;
  let rep0 = 0;
  let rep1 = 0;
  let rep2 = 0;
  let rep3 = 0;
  let o = 0;
  const pbMask = (1 << pb) - 1;
  const lpMask = (1 << lp) - 1;
  while (o < outputSize) {
    const posState = o & pbMask;
    if (rc.bit(isMatch, (state << 4) + posState) === 0) {
      const previous = o > 0 ? out[o - 1] : 0;
      const base = 0x300 * (((o & lpMask) << lc) + (previous >> (8 - lc)));
      let symbol = 1;
      if (state >= 7) {
        let matchByte = out[o - rep0 - 1];
        do {
          const matchBit = (matchByte >> 7) & 1;
          matchByte <<= 1;
          const bit = rc.bit(literal, base + ((1 + matchBit) << 8) + symbol);
          symbol = (symbol << 1) | bit;
          if (matchBit !== bit) break;
        } while (symbol < 0x100);
      }
      while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(literal, base + symbol);
      out[o++] = symbol & 0xff;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let length: number;
    if (rc.bit(isRep, state) === 0) {
      rep3 = rep2;
      rep2 = rep1;
      rep1 = rep0;
      length = lengths.decode(rc, posState);
      state = state < 7 ? 7 : 10;
      const lenState = length < 4 ? length : 3;
      const slot = rc.tree(posSlot, lenState << 6, 6);
      if (slot < 4) {
        rep0 = slot;
      } else {
        const direct = (slot >> 1) - 1;
        let distance = ((2 | (slot & 1)) << direct) >>> 0;
        if (slot < 14) distance += rc.reverse(posDecoders, distance - slot, direct);
        else distance += (rc.direct(direct - 4) << 4) + rc.reverse(align, 0, 4);
        rep0 = distance >>> 0;
        if (rep0 === 0xffffffff) throw new Error('compressed data is damaged.');
      }
    } else {
      if (rc.bit(isRepG0, state) === 0) {
        if (rc.bit(isRep0Long, (state << 4) + posState) === 0) {
          if (rep0 >= o) throw new Error('compressed data is damaged.');
          state = state < 7 ? 9 : 11;
          out[o] = out[o - rep0 - 1];
          o++;
          continue;
        }
      } else {
        let distance: number;
        if (rc.bit(isRepG1, state) === 0) {
          distance = rep1;
        } else {
          if (rc.bit(isRepG2, state) === 0) {
            distance = rep2;
          } else {
            distance = rep3;
            rep3 = rep2;
          }
          rep2 = rep1;
        }
        rep1 = rep0;
        rep0 = distance;
      }
      length = repLengths.decode(rc, posState);
      state = state < 7 ? 8 : 11;
    }
    length += 2;
    if (rep0 >= o || o + length > outputSize) throw new Error('compressed data is damaged.');
    for (let i = 0; i < length; i++, o++) out[o] = out[o - rep0 - 1];
  }
  // A stream cut short reads zeros past its end, and would decode to garbage of the right size.
  if (rc.pos > source.length) throw new Error('compressed data is damaged.');
  return out;
}
