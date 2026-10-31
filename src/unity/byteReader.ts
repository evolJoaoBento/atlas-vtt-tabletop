/** A cursor over bytes, with the integer widths Unity's files use. Reads past the end throw instead of returning garbage. */
export class ByteReader {
  private readonly view: DataView;
  pos = 0;
  littleEndian = false;

  constructor(readonly bytes: Uint8Array, start = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  private need(count: number): void {
    if (count < 0 || this.pos + count > this.bytes.byteLength) throw new Error('the file ends too soon.');
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.pos++);
  }

  u16(): number {
    this.need(2);
    const value = this.view.getUint16(this.pos, this.littleEndian);
    this.pos += 2;
    return value;
  }

  i16(): number {
    this.need(2);
    const value = this.view.getInt16(this.pos, this.littleEndian);
    this.pos += 2;
    return value;
  }

  u32(): number {
    this.need(4);
    const value = this.view.getUint32(this.pos, this.littleEndian);
    this.pos += 4;
    return value;
  }

  i32(): number {
    this.need(4);
    const value = this.view.getInt32(this.pos, this.littleEndian);
    this.pos += 4;
    return value;
  }

  /** A 64-bit integer as a number; the sizes and ids in these files stay well under 2^53. */
  i64(): number {
    this.need(8);
    const value = this.view.getBigInt64(this.pos, this.littleEndian);
    this.pos += 8;
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('a number in the file is too large.');
    return Number(value);
  }

  /** A 64-bit id kept exact as text: Unity's object ids are often larger than a number holds. */
  id64(): string {
    this.need(8);
    const value = this.view.getBigInt64(this.pos, this.littleEndian);
    this.pos += 8;
    return value.toString();
  }

  f32(): number {
    this.need(4);
    const value = this.view.getFloat32(this.pos, this.littleEndian);
    this.pos += 4;
    return value;
  }

  f64(): number {
    this.need(8);
    const value = this.view.getFloat64(this.pos, this.littleEndian);
    this.pos += 8;
    return value;
  }

  take(count: number): Uint8Array {
    this.need(count);
    const slice = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  /** A zero-terminated UTF-8 string. */
  cString(): string {
    let end = this.pos;
    while (end < this.bytes.byteLength && this.bytes[end] !== 0) end++;
    if (end >= this.bytes.byteLength) throw new Error('the file ends too soon.');
    const text = new TextDecoder().decode(this.bytes.subarray(this.pos, end));
    this.pos = end + 1;
    return text;
  }

  align(to: number): void {
    this.pos = Math.ceil(this.pos / to) * to;
  }
}
