/**
 * Painting on a background's layers, and taking it back. A layer is one byte per pixel, row by row
 * (`y * size + x`); the editor paints the height layer and the index layers (materials, objects) with the same
 * tools.
 *
 * - `paintStroke`: a round brush dragged from one point to another. A hard stroke sets the value; a soft stroke
 *   (for heights) nudges each pixel toward the value, most at the middle of the brush and hardly at its rim.
 * - `floodFill`: pours a value into the patch of equal pixels the start point sits in.
 * - `LayerHistory`: undo and redo for one layer. It keeps only the bytes of the box each change touches.
 *
 * Pure.
 */

/** A box of pixels, both ends included. */
export interface PixelBox { x0: number; y0: number; x1: number; y1: number }

type Point = { x: number; y: number };

/**
 * Drags a round brush of `radius` pixels from `from` to `to` over the layer (points in pixels, clipped to the
 * layer). Gives the box of pixels that really changed, or null when none did.
 */
export function paintStroke(
  layer: Uint8Array, size: number, from: Point, to: Point, radius: number, value: number, soft = false,
): PixelBox | null {
  const target = Math.max(0, Math.min(255, Math.round(value)));
  const r = Math.max(radius, 0);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(r / 2, 0.25);
  const stamps = Math.max(1, Math.ceil(length / step) + 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let s = 0; s < stamps; s++) {
    const t = stamps === 1 ? 0 : s / (stamps - 1);
    const cx = from.x + (to.x - from.x) * t;
    const cy = from.y + (to.y - from.y) * t;
    const ia = Math.max(0, Math.ceil(cx - r)), ib = Math.min(size - 1, Math.floor(cx + r));
    const ja = Math.max(0, Math.ceil(cy - r)), jb = Math.min(size - 1, Math.floor(cy + r));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const d = Math.hypot(i - cx, j - cy);
        if (d > r) continue;
        const k = j * size + i;
        const old = layer[k];
        let next = target;
        if (soft) {
          const falloff = r > 0 ? 1 - d / r : 1;
          next = Math.round(old + (target - old) * falloff);
        }
        if (next === old) continue;
        layer[k] = next;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
  }
  return x1 < x0 ? null : { x0, y0, x1, y1 };
}

/**
 * Fills the patch of pixels equal to the one at (x, y) and joined to it side by side (not corner to corner) with
 * `value`. Gives false when nothing was filled: the start is off the layer or already holds the value.
 */
export function floodFill(layer: Uint8Array, size: number, x: number, y: number, value: number): boolean {
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return false;
  const was = layer[py * size + px];
  if (was === value) return false;
  // A plain list of pixels still to look at, so the biggest layer cannot run the call stack out.
  const todo: number[] = [py * size + px];
  layer[py * size + px] = value;
  while (todo.length) {
    const k = todo.pop() as number;
    const i = k % size, j = (k - i) / size;
    if (i > 0 && layer[k - 1] === was) { layer[k - 1] = value; todo.push(k - 1); }
    if (i < size - 1 && layer[k + 1] === was) { layer[k + 1] = value; todo.push(k + 1); }
    if (j > 0 && layer[k - size] === was) { layer[k - size] = value; todo.push(k - size); }
    if (j < size - 1 && layer[k + size] === was) { layer[k + size] = value; todo.push(k + size); }
  }
  return true;
}

interface Snapshot { box: PixelBox; bytes: Uint8Array }

/** Copies the bytes of `box` out of the layer, row by row. */
function copyBox(layer: Uint8Array, size: number, box: PixelBox): Uint8Array {
  const w = box.x1 - box.x0 + 1;
  const out = new Uint8Array(w * (box.y1 - box.y0 + 1));
  for (let j = box.y0; j <= box.y1; j++) {
    const from = j * size + box.x0;
    out.set(layer.subarray(from, from + w), (j - box.y0) * w);
  }
  return out;
}

/** Writes bytes back into the box they were copied from. */
function pasteBox(layer: Uint8Array, size: number, box: PixelBox, bytes: Uint8Array): void {
  const w = box.x1 - box.x0 + 1;
  for (let j = box.y0; j <= box.y1; j++) {
    layer.set(bytes.subarray((j - box.y0) * w, (j - box.y0 + 1) * w), j * size + box.x0);
  }
}

/**
 * Undo and redo for one layer. Call `record` just before a change, with the box the change will touch; it keeps a
 * copy of those bytes. `undo` puts them back (keeping what was there for `redo`). The oldest steps are dropped
 * past `limit`. A layer is always a square, so the side is worked out from its length.
 */
export class LayerHistory {
  private undos: Snapshot[] = [];
  private redos: Snapshot[] = [];

  constructor(private readonly limit = 30) {}

  get canUndo(): boolean { return this.undos.length > 0; }
  get canRedo(): boolean { return this.redos.length > 0; }

  /** Keeps the bytes of `box` as they are now. Call before the change. Clears what could be redone. */
  record(layer: Uint8Array, box: PixelBox): void {
    const b = { ...box };
    this.undos.push({ box: b, bytes: copyBox(layer, Math.round(Math.sqrt(layer.length)), b) });
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
  }

  /** Takes back the last change. False when there is none. */
  undo(layer: Uint8Array): boolean { return this.swap(layer, this.undos, this.redos); }

  /** Puts back the change last taken back. False when there is none. */
  redo(layer: Uint8Array): boolean { return this.swap(layer, this.redos, this.undos); }

  private swap(layer: Uint8Array, from: Snapshot[], into: Snapshot[]): boolean {
    const step = from.pop();
    if (!step) return false;
    const size = Math.round(Math.sqrt(layer.length));
    into.push({ box: step.box, bytes: copyBox(layer, size, step.box) });
    pasteBox(layer, size, step.box, step.bytes);
    return true;
  }
}
