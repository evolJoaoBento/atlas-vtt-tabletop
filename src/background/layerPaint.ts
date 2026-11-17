/**
 * Painting on a background's layers, and taking it back. A layer is one byte per pixel, row by row
 * (`y * size + x`); the editor paints the height layer and the index layers (materials, objects) with the same
 * tools.
 *
 * Points are in pixels, and pixel (i, j) has its centre at (i + 0.5, j + 0.5): a brush or a fill start at (10.2, 7.9)
 * means pixel (10, 7), and a brush paints the pixels whose centre lies within its radius.
 *
 * - `paintStroke`: a round brush dragged from one point to another. A hard stroke sets the value; a soft stroke
 *   (for the height layer only) nudges each pixel toward the value, most at the middle of the brush and hardly at its
 *   rim.
 * - `floodFill`: pours a value into the patch of equal pixels the start point sits in.
 * - `LayerHistory`: undo and redo for one layer. A stroke (any number of segments, or a fill) is one step, and only
 *   the box it changed is kept.
 *
 * Pure.
 */

/** A box of pixels, both ends included. */
export interface PixelBox { x0: number; y0: number; x1: number; y1: number }

type Point = { x: number; y: number };

/** A value as a byte: rounded and held to 0..255. Null when it is not a number. */
function toByte(value: number): number | null {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, Math.round(value))) : null;
}

/**
 * Drags a round brush of `radius` pixels from `from` to `to` over the layer (clipped to the layer). `soft` is for the
 * height layer: each pixel moves toward the value by how near the brush middle it is. `continued` says this segment
 * carries on from the one before, which already stamped at `from`, so it is left out and a soft stroke does not dab
 * twice at the joint. Gives the box of pixels that really changed, or null when none did.
 */
export function paintStroke(
  layer: Uint8Array, size: number, from: Point, to: Point, radius: number, value: number, soft = false,
  continued = false,
): PixelBox | null {
  const target = toByte(value);
  if (target === null || ![from.x, from.y, to.x, to.y, radius].every(Number.isFinite)) return null;
  const r = Math.max(radius, 0);
  const r2 = r * r;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(r / 2, 0.25);
  const stamps = Math.max(1, Math.ceil(length / step) + 1);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let s = continued ? 1 : 0; s < stamps; s++) {
    const t = stamps === 1 ? 0 : s / (stamps - 1);
    const cx = from.x + (to.x - from.x) * t;
    const cy = from.y + (to.y - from.y) * t;
    const ia = Math.max(0, Math.floor(cx - r - 0.5)), ib = Math.min(size - 1, Math.ceil(cx + r - 0.5));
    const ja = Math.max(0, Math.floor(cy - r - 0.5)), jb = Math.min(size - 1, Math.ceil(cy + r - 0.5));
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const dx = i + 0.5 - cx, dy = j + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const k = j * size + i;
        const old = layer[k];
        let next = target;
        if (soft) {
          const falloff = r > 0 ? 1 - Math.sqrt(d2) / r : 1;
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
 * `value`. Gives the box that was filled, or null when nothing was: the start is off the layer or already holds the
 * value.
 */
export function floodFill(layer: Uint8Array, size: number, x: number, y: number, value: number): PixelBox | null {
  const fill = toByte(value);
  if (fill === null || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return null;
  const was = layer[py * size + px];
  if (was === fill) return null;
  // A plain list of pixels still to look at, so the biggest layer cannot run the call stack out.
  const todo: number[] = [py * size + px];
  layer[py * size + px] = fill;
  let x0 = px, y0 = py, x1 = px, y1 = py;
  while (todo.length) {
    const k = todo.pop() as number;
    const i = k % size, j = (k - i) / size;
    if (i < x0) x0 = i;
    if (i > x1) x1 = i;
    if (j < y0) y0 = j;
    if (j > y1) y1 = j;
    if (i > 0 && layer[k - 1] === was) { layer[k - 1] = fill; todo.push(k - 1); }
    if (i < size - 1 && layer[k + 1] === was) { layer[k + 1] = fill; todo.push(k + 1); }
    if (j > 0 && layer[k - size] === was) { layer[k - size] = fill; todo.push(k - size); }
    if (j < size - 1 && layer[k + size] === was) { layer[k + size] = fill; todo.push(k + size); }
  }
  return { x0, y0, x1, y1 };
}

interface Step { box: PixelBox; bytes: Uint8Array }

/** Copies the bytes of `box` out of a layer, row by row. */
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
 * Undo and redo for one square layer of `size` pixels a side. Call `begin` before a stroke (it takes a copy of the
 * layer, in one buffer that is reused), paint as many segments or one fill as you like, then `commit`: the pixels
 * that changed become one step, keeping only their box. `cancel` ends a stroke without a step. The oldest steps are
 * dropped past `limit`.
 */
export class LayerHistory {
  private undos: Step[] = [];
  private redos: Step[] = [];
  private scratch: Uint8Array;
  private begun = false;

  constructor(private readonly size: number, private readonly limit = 30) {
    this.scratch = new Uint8Array(size * size);
  }

  get canUndo(): boolean { return this.undos.length > 0; }
  get canRedo(): boolean { return this.redos.length > 0; }

  /** Starts a stroke: remembers the layer as it is now. */
  begin(layer: Uint8Array): void {
    this.scratch.set(layer);
    this.begun = true;
  }

  /**
   * Ends the stroke as one step. Gives the box that changed, or null (and no step) when nothing did. Clears what
   * could be redone.
   */
  commit(layer: Uint8Array): PixelBox | null {
    if (!this.begun) return null;
    this.begun = false;
    const { size, scratch } = this;
    let x0 = size, y0 = size, x1 = -1, y1 = -1;
    for (let j = 0; j < size; j++) {
      const row = j * size;
      for (let i = 0; i < size; i++) {
        if (layer[row + i] === scratch[row + i]) continue;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
    }
    if (x1 < 0) return null;
    const box = { x0, y0, x1, y1 };
    this.undos.push({ box, bytes: copyBox(scratch, size, box) });
    if (this.undos.length > this.limit) this.undos.shift();
    this.redos = [];
    return { ...box };
  }

  /** Ends a stroke without keeping a step. */
  cancel(): void { this.begun = false; }

  /** Takes back the last step. Gives the box it changed, or null when there is none. */
  undo(layer: Uint8Array): PixelBox | null { return this.swap(layer, this.undos, this.redos); }

  /** Puts back the step last taken back. Gives the box it changed, or null when there is none. */
  redo(layer: Uint8Array): PixelBox | null { return this.swap(layer, this.redos, this.undos); }

  private swap(layer: Uint8Array, from: Step[], into: Step[]): PixelBox | null {
    const step = from.pop();
    if (!step) return null;
    into.push({ box: step.box, bytes: copyBox(layer, this.size, step.box) });
    pasteBox(layer, this.size, step.box, step.bytes);
    return { ...step.box };
  }
}
