/**
 * Water painted on the map: where it is (a mask over the map, a fraction of a grid cell per texel) and how all of the
 * map's water moves (one motion for the whole map). Pure; the board draws it (src/board/waterSurface.ts) and keeps it with
 * the map's board data. A mask is saved as run lengths: water is drawn in broad areas, so it stays small.
 */

export type WaterMotionKind = 'still' | 'ripples' | 'flow' | 'waves';
export const WATER_MOTION_KINDS: readonly WaterMotionKind[] = ['still', 'ripples', 'flow', 'waves'];

export interface WaterMotion {
  kind: WaterMotionKind;
  /** How much the water moves, 0 (glassy) to 1 (rough). */
  amount: number;
  /** Where flowing water runs, in degrees: 0 runs up the map, 90 to the right. */
  direction: number;
  /** The water's colour, '#rrggbb': what it scatters back, and how it tints the ground seen through it. */
  tint: string;
  /** How clear the water is, 0 (opaque: the ground under it is hidden) to 1 (glass clear). */
  clarity: number;
  /** Lava only: what kind of lava it is (`LAVA_STYLES`); absent on water and acid. */
  style?: LavaStyle;
}

/** The kinds of lava, each its own look: how much of it is crust, and what the crust is like. */
export type LavaStyle = 'crust' | 'ropey' | 'rubble' | 'lake' | 'magma';
export const LAVA_STYLES: readonly { value: LavaStyle; label: string; hint: string }[] = [
  { value: 'crust', label: 'Crusted flow', hint: 'Plates of dark cooled crust with glowing cracks between them' },
  { value: 'ropey', label: 'Ropey (pahoehoe)', hint: 'A smooth glossy skin folded into ropes, molten toes breaking out' },
  { value: 'rubble', label: 'Rubble (a\'a)', hint: 'Rough jagged clinker, glowing only deep in the gaps' },
  { value: 'lake', label: 'Lava lake', hint: 'Open molten rock, crust rafts drifting and breaking on it' },
  { value: 'magma', label: 'Magma', hint: 'Thick, very hot rock, swirling with dark streaks of slag' },
];
const STYLE_VALUES = new Set<string>(LAVA_STYLES.map((style) => style.value));

/** Colours to start the tint from. */
export const WATER_TINTS: readonly { name: string; tint: string }[] = [
  { name: 'Lake', tint: '#2d6b78' },
  { name: 'Tropical', tint: '#1fa3a8' },
  { name: 'Deep sea', tint: '#123f63' },
  { name: 'River', tint: '#4a7466' },
  { name: 'Swamp', tint: '#4f5a2c' },
  { name: 'Murky', tint: '#5b5038' },
  { name: 'Glacier', tint: '#8fc9d6' },
  { name: 'Blood', tint: '#6b1414' },
];

export const DEFAULT_WATER_MOTION: WaterMotion = { kind: 'ripples', amount: 0.5, direction: 90, tint: '#2d6b78', clarity: 0.6 };

/** What a liquid is: Atlas's three (`objects.liquids`). Each is painted, moves and looks on its own. */
export type LiquidKind = 'water' | 'lava' | 'acid';
export const LIQUID_KINDS: readonly LiquidKind[] = ['water', 'lava', 'acid'];

/** How each liquid starts: lava flowing slowly in molten orange and opaque, acid bubbling, bright and a little clear. */
export const LIQUID_DEFAULTS: Readonly<Record<LiquidKind, WaterMotion>> = {
  water: DEFAULT_WATER_MOTION,
  lava: { kind: 'flow', amount: 0.35, direction: 90, tint: '#ff5a1f', clarity: 0, style: 'crust' },
  acid: { kind: 'ripples', amount: 0.45, direction: 90, tint: '#8bd630', clarity: 0.35 },
};

/** Colours to start each liquid's tint from. */
export const LIQUID_TINTS: Readonly<Record<LiquidKind, readonly { name: string; tint: string }[]>> = {
  water: WATER_TINTS,
  lava: [
    { name: 'Molten', tint: '#ff5a1f' },
    { name: 'White-hot', tint: '#ffb347' },
    { name: 'Deep red', tint: '#c2240f' },
    { name: 'Cooling', tint: '#8a2a0a' },
    { name: 'Sulfur blue', tint: '#2f8cff' },
    { name: 'Fel green', tint: '#57d12b' },
  ],
  acid: [
    { name: 'Toxic', tint: '#8bd630' },
    { name: 'Bile', tint: '#c9d43a' },
    { name: 'Venom', tint: '#3fbf5a' },
    { name: 'Sickly', tint: '#a3b83a' },
    { name: 'Caustic', tint: '#38d6c0' },
    { name: 'Violet', tint: '#9a4fd6' },
  ],
};

/** What each motion is called for each liquid (lava that stands still is a crusted pool, acid that ripples bubbles). */
export const MOTION_LABELS: Readonly<Record<LiquidKind, Readonly<Record<WaterMotionKind, string>>>> = {
  water: { still: 'Still', ripples: 'Ripples', flow: 'Flowing', waves: 'Waves' },
  lava: { still: 'Still', ripples: 'Churning', flow: 'Flowing', waves: 'Surging' },
  acid: { still: 'Still', ripples: 'Bubbling', flow: 'Flowing', waves: 'Surging' },
};

export const LIQUID_NAMES: Readonly<Record<LiquidKind, string>> = { water: 'Water', lava: 'Lava', acid: 'Acid' };

/** A motion as kept, read tolerantly: what is missing or broken is `fallback`'s (the water's, unless said). */
export function readWaterMotion(raw: unknown, fallback: WaterMotion = DEFAULT_WATER_MOTION): WaterMotion {
  const value = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const kind = WATER_MOTION_KINDS.includes(value.kind as WaterMotionKind) ? value.kind as WaterMotionKind : fallback.kind;
  const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? Math.min(1, Math.max(0, value.amount)) : fallback.amount;
  const turn = typeof value.direction === 'number' && Number.isFinite(value.direction) ? value.direction : fallback.direction;
  const tint = typeof value.tint === 'string' && /^#[0-9a-f]{6}$/i.test(value.tint) ? value.tint.toLowerCase() : fallback.tint;
  const clarity = typeof value.clarity === 'number' && Number.isFinite(value.clarity) ? Math.min(1, Math.max(0, value.clarity)) : fallback.clarity;
  // A kind of lava only where the motion is lava's (its fallback has one).
  const style = typeof value.style === 'string' && STYLE_VALUES.has(value.style) && fallback.style ? value.style as LavaStyle : fallback.style;
  return { kind, amount, direction: ((turn % 360) + 360) % 360, tint, clarity, ...(style ? { style } : {}) };
}

/** A mask as the board data keeps it. */
export interface SavedWaterMask {
  width: number;
  height: number;
  /** Run lengths (dry, wet, dry…) as base-128 varints, base64. */
  data: string;
}

/** Texels per grid cell, and the longest side a mask may have. */
const PER_CELL = 8;
const MAX_SIDE = 2048;

export class WaterMask {
  readonly data: Uint8Array;
  /** Counts the changes made to the cells, so what is derived from them (the sound's search) is made again only then. */
  version = 0;

  private constructor(readonly width: number, readonly height: number, readonly texel: number, data?: Uint8Array) {
    this.data = data ?? new Uint8Array(width * height);
  }

  /** An empty mask for a map of this size (map pixels) and grid cell. */
  static forMap(mapWidth: number, mapHeight: number, cell: number): WaterMask {
    const fine = Math.max(1, cell) / PER_CELL;
    const texel = Math.max(fine, Math.max(mapWidth, mapHeight) / MAX_SIDE);
    return new WaterMask(Math.max(1, Math.ceil(mapWidth / texel)), Math.max(1, Math.ceil(mapHeight / texel)), texel);
  }

  /** An empty mask of the same size and texel as `mask`. */
  static like(mask: WaterMask): WaterMask {
    return new WaterMask(mask.width, mask.height, mask.texel);
  }

  /** This mask again, to change without changing this one. */
  copy(): WaterMask {
    return new WaterMask(this.width, this.height, this.texel, this.data.slice());
  }

  /** A saved mask for this map; null when it is missing, broken or was made for a map of another size. */
  static read(saved: unknown, mapWidth: number, mapHeight: number, cell: number): WaterMask | null {
    if (typeof saved !== 'object' || saved === null) return null;
    const { width, height, data } = saved as Partial<SavedWaterMask>;
    const fresh = WaterMask.forMap(mapWidth, mapHeight, cell);
    if (width !== fresh.width || height !== fresh.height || typeof data !== 'string') return null;
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0)); } catch { return null; }
    const out = fresh.data;
    let at = 0;
    let wet = false;
    for (let i = 0; i < bytes.length;) {
      let run = 0;
      let shift = 0;
      let byte: number;
      do {
        if (i >= bytes.length) return null;
        byte = bytes[i++]!;
        run += (byte & 0x7f) * 2 ** shift;
        shift += 7;
      } while (byte & 0x80);
      if (at + run > out.length) return null;
      if (wet) out.fill(255, at, at + run);
      at += run;
      wet = !wet;
    }
    return at === out.length ? fresh : null;
  }

  save(): SavedWaterMask {
    const bytes: number[] = [];
    const push = (run: number): void => {
      do {
        let byte = run % 128;
        run = Math.floor(run / 128);
        if (run > 0) byte |= 0x80;
        bytes.push(byte);
      } while (run > 0);
    };
    let wet = false;
    let run = 0;
    for (const value of this.data) {
      if ((value > 0) === wet) { run += 1; continue; }
      push(run);
      wet = !wet;
      run = 1;
    }
    push(run);
    let text = '';
    for (const byte of bytes) text += String.fromCharCode(byte);
    return { width: this.width, height: this.height, data: btoa(text) };
  }

  /** Dries every texel `other` (a mask of the same size) has wet; whether any changed. */
  dryUnder(other: WaterMask): boolean {
    if (other.width !== this.width || other.height !== this.height) return false;
    let changed = false;
    for (let k = 0; k < this.data.length; k++) if (this.data[k]! > 0 && other.data[k]! > 0) { this.data[k] = 0; changed = true; }
    if (changed) this.version++;
    return changed;
  }

  get empty(): boolean {
    return !this.data.some((value) => value > 0);
  }

  /** The mask's value (0 dry, 255 water) under a map point. */
  at(x: number, y: number): number {
    const i = Math.floor(x / this.texel);
    const j = Math.floor(y / this.texel);
    return i < 0 || j < 0 || i >= this.width || j >= this.height ? 0 : this.data[j * this.width + i]!;
  }

  /** Paints (or erases) a round brush of `radius` map pixels at a map point. Returns whether anything changed. */
  paint(x: number, y: number, radius: number, wet: boolean): boolean {
    const r = radius / this.texel;
    const cx = x / this.texel;
    const cy = y / this.texel;
    const value = wet ? 255 : 0;
    let changed = false;
    for (let j = Math.max(0, Math.floor(cy - r)); j <= Math.min(this.height - 1, Math.ceil(cy + r)); j++) {
      for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(this.width - 1, Math.ceil(cx + r)); i++) {
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue;
        const k = j * this.width + i;
        if (this.data[k] !== value) { this.data[k] = value; changed = true; }
      }
    }
    if (changed) this.version++;
    return changed;
  }

  /**
   * The bucket: from the texel under a map point, every texel joined to it (side by side) whose colour in `colors` (RGBA,
   * one pixel a texel, as the mask) is within `tolerance` of the colour there, is made water (or dry). `blocked` texels
   * (the walls) are never crossed. Returns whether anything changed.
   */
  fill(x: number, y: number, colors: ArrayLike<number>, tolerance: number, wet: boolean, blocked?: ArrayLike<number> | null): boolean {
    const si = Math.floor(x / this.texel);
    const sj = Math.floor(y / this.texel);
    const { width, height } = this;
    if (si < 0 || sj < 0 || si >= width || sj >= height || colors.length < width * height * 4) return false;
    const seed = sj * width + si;
    if (blocked?.[seed]) return false;
    const r = colors[seed * 4]!;
    const g = colors[seed * 4 + 1]!;
    const b = colors[seed * 4 + 2]!;
    const limit = tolerance * tolerance;
    const value = wet ? 255 : 0;
    const seen = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    seen[seed] = 1;
    let changed = false;
    while (head < tail) {
      const k = queue[head++]!;
      if (this.data[k] !== value) { this.data[k] = value; changed = true; }
      const i = k % width;
      const near = [i > 0 ? k - 1 : -1, i < width - 1 ? k + 1 : -1, k >= width ? k - width : -1, k + width < width * height ? k + width : -1];
      for (const n of near) {
        if (n < 0 || seen[n]) continue;
        seen[n] = 1;
        if (blocked?.[n]) continue;
        const dr = colors[n * 4]! - r;
        const dg = colors[n * 4 + 1]! - g;
        const db = colors[n * 4 + 2]! - b;
        if (dr * dr + dg * dg + db * db > limit) continue;
        queue[tail++] = n;
      }
    }
    if (changed) this.version++;
    return changed;
  }

  /** Paints the brush all along a line, so a quick drag leaves no gaps. */
  stroke(from: { x: number; y: number }, to: { x: number; y: number }, radius: number, wet: boolean): boolean {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const steps = Math.max(1, Math.ceil(length / Math.max(this.texel, radius / 2)));
    let changed = false;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      changed = this.paint(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, wet) || changed;
    }
    return changed;
  }
}
