/**
 * Atlas's liquids (`objects.liquids`: water, lava, acid, each an outline with holes) and the board's water mask, each
 * as the other. The board draws and paints water as a mask (`water.ts`); Atlas keeps it as outlines, and Atlas's
 * record is the only place it is kept:
 *
 * - `readLiquids`: a level's liquids as the board draws them; `rasterAreas` lays their outlines into a mask.
 * - `maskOutlines`: a painted mask traced along its texel edges into outlines, thinned to within less than half a
 *   texel (so the outlines give the very same mask back), and held to what Atlas keeps (corners per liquid, liquids
 *   per level): what that gives up is counted (`OutlineReport`).
 * - `strokeLiquids`: a finished stroke as the change it makes to the liquids Atlas has at that moment.
 * - `brushLiquids`: outlines as the liquids the brush writes: Atlas's fields for its own 2D view (kind, colours,
 *   flow), and the board's motion beside them (`tabletop: { v: 1, brush: true, motion }`).
 * - `withoutAreas`: a painted mask less what liquids made in Atlas cover: those are Atlas's to change.
 *
 * Pure.
 */
import { DEFAULT_WATER_MOTION, readWaterMotion, WaterMask, type WaterMotion } from './water';

type Point = { x: number; y: number };

/** A patch of liquid: its outline and what stands dry inside it, map pixels. */
export interface WaterArea { polygon: Point[]; holes: Point[][] }

export type LiquidKind = 'water' | 'lava' | 'acid';

export interface BoardLiquid extends WaterArea {
  /** Its id in Atlas (its place in Atlas's record). */
  id: string;
  liquid: LiquidKind;
  /** The colour Atlas draws its surface in, `#rrggbb`. */
  surface: string;
  /** Made by the board's brush (the rest are Atlas's own, drawn and left as they are). */
  brush: boolean;
  /** How the brush's water moves; null on a liquid made in Atlas. */
  motion: WaterMotion | null;
}

/** What Atlas keeps: the corners of one liquid (its outline and holes together) and the liquids of one level. */
export const LIQUID_LIMITS = { corners: 2048, patches: 256 } as const;

/** How far a thinned outline may lie from the texel edge it was traced along, in texels: under half, so no texel's centre changes sides. */
const THIN = 0.45;
/** The furthest an outline is thinned to fit Atlas's corners, in texels (a quarter of a square, where the mask has eight texels to a square). */
const MOST_THIN = 2;
/** Twice the area, in texels, of the dry spots filled before an edge is thinned further: spots of the same reach. */
const SMALL_HOLE = 2 * MOST_THIN * MOST_THIN;

/** What `maskOutlines` gave up to fit what Atlas keeps: dry spots filled, patches whose edge was thinned past the mask's own texels, patches left out. */
export interface OutlineReport { holes: number; thinned: number; patches: number }
const KINDS: readonly LiquidKind[] = ['water', 'lava', 'acid'];
const SURFACES: Record<LiquidKind, string> = { water: '#3b82f6', lava: '#ea580c', acid: '#65a30d' };
const HEX = /^#[0-9a-f]{6}$/i;

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPlace = (value: unknown): value is Point => isObj(value) && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y);
const ringOf = (value: unknown): Point[] | null => (Array.isArray(value) && value.length >= 3 && value.every(isPlace) ? value.map(({ x, y }) => ({ x, y })) : null);

/** The liquids of a record of Atlas's (`objects.liquids`, those of the level shown), in the order they were made; what is no liquid is left out. */
export function readLiquids(raw: unknown): BoardLiquid[] {
  if (!isObj(raw)) return [];
  const liquids: BoardLiquid[] = [];
  for (const [id, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const liquid = KINDS.find((kind) => kind === value.liquid);
    const polygon = ringOf(value.polygon);
    if (!liquid || !polygon) continue;
    const holes = (Array.isArray(value.holes) ? value.holes : []).map(ringOf).filter((ring): ring is Point[] => ring !== null);
    const colors = isObj(value.colors) ? value.colors : {};
    const extra = isObj(value.tabletop) ? value.tabletop : {};
    const brush = extra.brush === true;
    liquids.push({
      id, liquid, polygon, holes,
      surface: typeof colors.surface === 'string' && HEX.test(colors.surface) ? colors.surface.toLowerCase() : SURFACES[liquid],
      brush, motion: brush ? readWaterMotion(extra.motion) : null,
    });
  }
  return liquids;
}

/** How a level's water moves on the board: as the brush's water says; with only liquids made in Atlas, still, in the first one's colour; null without any. */
export function motionOf(liquids: readonly BoardLiquid[]): WaterMotion | null {
  const mine = liquids.find((liquid) => liquid.motion !== null);
  if (mine?.motion) return mine.motion;
  const [first] = liquids;
  return first ? { ...DEFAULT_WATER_MOTION, kind: 'still', tint: first.surface } : null;
}

/** Makes wet every texel of `mask` whose centre lies in one of `areas` (in its outline and in none of its holes). */
export function rasterAreas(mask: WaterMask, areas: readonly WaterArea[]): void {
  const { texel, width, height } = mask;
  let changed = false;
  for (const area of areas) {
    const rings = [area.polygon, ...area.holes];
    let top = Infinity;
    let bottom = -Infinity;
    for (const point of area.polygon) { top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
    const first = Math.max(0, Math.floor(top / texel - 0.5));
    const last = Math.min(height - 1, Math.ceil(bottom / texel - 0.5));
    for (let j = first; j <= last; j++) {
      const y = (j + 0.5) * texel;
      // Where the row's middle line crosses the rings: inside between each pair (even-odd, so holes are dry).
      const crossings: number[] = [];
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k]!;
          const b = ring[(k + 1) % ring.length]!;
          if ((a.y > y) === (b.y > y)) continue;
          crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k]! / texel - 0.5));
        const to = Math.min(width - 1, Math.ceil(crossings[k + 1]! / texel - 0.5) - 1);
        for (let i = from; i <= to; i++) { mask.data[j * width + i] = 255; changed = true; }
      }
    }
  }
  if (changed) mask.version++;
}

/** A copy of `mask` with every texel `areas` cover made dry. */
export function withoutAreas(mask: WaterMask, areas: readonly WaterArea[]): WaterMask {
  const out = mask.copy();
  if (areas.length === 0) return out;
  const covered = WaterMask.like(mask);
  rasterAreas(covered, areas);
  for (let k = 0; k < out.data.length; k++) if (covered.data[k]! > 0) out.data[k] = 0;
  return out;
}

const area2 = (ring: readonly Point[]): number => {
  let sum = 0;
  for (let k = 0; k < ring.length; k++) { const a = ring[k]!; const b = ring[(k + 1) % ring.length]!; sum += a.x * b.y - b.x * a.y; }
  return sum;
};

/** A closed ring without the points that lie on a straight run between their neighbours. */
function withoutStraights(ring: Point[]): Point[] {
  const out: Point[] = [];
  for (let k = 0; k < ring.length; k++) {
    const before = ring[(k + ring.length - 1) % ring.length]!;
    const at = ring[k]!;
    const after = ring[(k + 1) % ring.length]!;
    if ((at.x - before.x) * (after.y - at.y) - (at.y - before.y) * (after.x - at.x) !== 0) out.push(at);
  }
  return out;
}

/** Douglas–Peucker on the open run `points[from..to]`: marks the points to keep. */
function thinRun(points: readonly Point[], from: number, to: number, tolerance: number, keep: Uint8Array): void {
  const stack: Array<[number, number]> = [[from, to]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const start = points[a]!;
    const end = points[b]!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    let far = -1;
    let most = tolerance;
    for (let k = a + 1; k < b; k++) {
      const point = points[k]!;
      const off = length === 0 ? Math.hypot(point.x - start.x, point.y - start.y) : Math.abs((point.x - start.x) * dy - (point.y - start.y) * dx) / length;
      if (off > most) { most = off; far = k; }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
}

/** A closed ring thinned to within `tolerance`; the ring as it was when thinning would leave it no area. */
function thinRing(ring: Point[], tolerance: number): Point[] {
  if (ring.length <= 4) return ring;
  // Two points far apart split the ring into two runs.
  let far = 0;
  let most = -1;
  for (let k = 1; k < ring.length; k++) { const d = (ring[k]!.x - ring[0]!.x) ** 2 + (ring[k]!.y - ring[0]!.y) ** 2; if (d > most) { most = d; far = k; } }
  const open = [...ring, ring[0]!];
  const keep = new Uint8Array(open.length);
  keep[0] = 1;
  keep[far] = 1;
  keep[open.length - 1] = 1;
  thinRun(open, 0, far, tolerance, keep);
  thinRun(open, far, open.length - 1, tolerance, keep);
  const out = ring.filter((_, k) => keep[k] === 1);
  return out.length >= 3 && area2(out) !== 0 ? out : ring;
}

/**
 * The outlines of a mask's wet texels: one area per patch (texels joined side by side; two that only touch at a corner
 * are two patches), with the dry ground inside it as its holes. Each ring runs along texel edges and is thinned
 * (`THIN`). A patch of more corners than `limits.corners` gives up as little as fits it, a step at a time: the dry
 * spots of a texel or two inside it are filled, smallest first; its edge is thinned, to within two texels at most;
 * the rest of the dry ground inside it is filled, smallest first; and a patch that still has too many is left out.
 * Only the `limits.patches` largest patches are given. What was given up is added to `report`.
 */
export function maskOutlines(mask: WaterMask, limits: { corners: number; patches: number } = LIQUID_LIMITS, report?: OutlineReport): WaterArea[] {
  const { width, height, texel, data } = mask;
  const wet = (i: number, j: number): boolean => i >= 0 && j >= 0 && i < width && j < height && data[j * width + i]! > 0;
  // Patches: wet texels joined side by side.
  const patch = new Int32Array(width * height).fill(-1);
  let patches = 0;
  const stack: number[] = [];
  for (let seed = 0; seed < patch.length; seed++) {
    if (data[seed] === 0 || patch[seed] !== -1) continue;
    patch[seed] = patches;
    stack.push(seed);
    while (stack.length > 0) {
      const k = stack.pop()!;
      const i = k % width;
      for (const n of [i > 0 ? k - 1 : -1, i < width - 1 ? k + 1 : -1, k - width, k + width]) {
        if (n < 0 || n >= patch.length || data[n] === 0 || patch[n] !== -1) continue;
        patch[n] = patches;
        stack.push(n);
      }
    }
    patches += 1;
  }
  if (patches === 0) return [];
  // The edges between wet and dry, each from one grid corner to the next with its wet texel on the same side: a
  // texel's top runs leftwards, its left side down, its bottom rightwards, its right side up. Corners are numbered
  // across the grid of (width + 1) by (height + 1).
  const across = width + 1;
  const next = new Map<number, number[]>();
  const edge = (from: number, to: number): void => { const list = next.get(from); if (list) list.push(to); else next.set(from, [to]); };
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      if (data[j * width + i] === 0) continue;
      const a = j * across + i;
      if (!wet(i, j - 1)) edge(a + 1, a);
      if (!wet(i - 1, j)) edge(a, a + across);
      if (!wet(i, j + 1)) edge(a + across, a + across + 1);
      if (!wet(i + 1, j)) edge(a + across + 1, a + 1);
    }
  }
  // The texel an edge belongs to (the wet one beside it), so each ring knows its patch.
  const texelOf = (from: number, to: number): number => {
    const i = from % across;
    const j = Math.floor(from / across);
    if (to === from - 1) return j * width + (i - 1);          // a top, running left
    if (to === from + across) return j * width + i;           // a left side, running down
    if (to === from + 1) return (j - 1) * width + i;          // a bottom, running right
    return (j - 1) * width + (i - 1);                         // a right side, running up
  };
  const rings: Array<{ patch: number; ring: Point[] }> = [];
  for (const [start, outs] of next) {
    while (outs.length > 0) {
      let from = start;
      let to = outs.pop()!;
      const owner = patch[texelOf(from, to)]!;
      const ring: Point[] = [];
      for (;;) {
        ring.push({ x: from % across, y: Math.floor(from / across) });
        const dx = (to % across) - (from % across);
        const dy = Math.floor(to / across) - Math.floor(from / across);
        if (to === start) break;
        const choices = next.get(to)!;
        // Where two patches meet at a corner two edges leave it: the one that turns with this texel keeps the patches apart.
        const turn = to + dy + -dx * across;
        const at = choices.length > 1 && choices.includes(turn) ? choices.indexOf(turn) : choices.length - 1;
        const [chosen] = choices.splice(at, 1);
        from = to;
        to = chosen!;
      }
      rings.push({ patch: owner, ring });
    }
  }
  // Per patch: the ring that goes round it, and the rings round the dry ground inside it.
  const byPatch = new Map<number, { outer: Point[] | null; holes: Point[][]; size: number }>();
  for (const { patch: owner, ring } of rings) {
    const entry = byPatch.get(owner) ?? { outer: null, holes: [], size: 0 };
    byPatch.set(owner, entry);
    const corners = withoutStraights(ring);
    const signed = area2(corners);
    // Traced with the wet texel on the left of each edge (y down), a patch's own ring has a negative area.
    if (signed < 0) { entry.outer = corners; entry.size = -signed; } else entry.holes.push(corners);
  }
  const areas: Array<WaterArea & { size: number }> = [];
  for (const { outer, holes, size } of byPatch.values()) {
    if (!outer) continue;
    let tolerance = THIN;
    let polygon = thinRing(outer, tolerance);
    // The dry ground inside, the smallest last.
    const dry = [...holes].sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a)));
    let inner = dry.map((hole) => thinRing(hole, tolerance));
    const count = (): number => polygon.length + inner.reduce((sum, hole) => sum + hole.length, 0);
    let filled = 0;
    const fill = (): void => { dry.pop(); inner.pop(); filled += 1; };
    // Too many corners for Atlas. First the dry spots of a texel or two are filled;
    while (count() > limits.corners && dry.length > 0 && Math.abs(area2(dry[dry.length - 1]!)) <= SMALL_HOLE) fill();
    // then the edge is thinned, to within two texels at most;
    while (count() > limits.corners && tolerance < MOST_THIN) {
      tolerance = Math.min(MOST_THIN, tolerance * 1.6);
      polygon = thinRing(outer, tolerance);
      inner = dry.map((hole) => thinRing(hole, tolerance));
    }
    // then the rest of the dry ground inside, smallest first;
    while (count() > limits.corners && dry.length > 0) fill();
    // and a patch that still has too many is no liquid Atlas would keep.
    if (count() > limits.corners) { if (report) report.patches += 1; continue; }
    if (report) { report.holes += filled; if (tolerance > THIN) report.thinned += 1; }
    const scale = (ring: Point[]): Point[] => ring.map((point) => ({ x: point.x * texel, y: point.y * texel }));
    areas.push({ polygon: scale(polygon), holes: inner.map(scale), size });
  }
  areas.sort((a, b) => b.size - a.size);
  if (report) report.patches += Math.max(0, areas.length - limits.patches);
  return areas.slice(0, limits.patches).map(({ polygon, holes }) => ({ polygon, holes }));
}

/** What `maskOutlines` gave up, in words for the GM; null when nothing was. */
export function givenUpText(gave: OutlineReport): string | null {
  const parts = [
    gave.patches > 0 ? `${gave.patches} of the smallest ${gave.patches === 1 ? 'patch was' : 'patches were'} left out` : '',
    gave.holes > 0 ? `${gave.holes} small dry ${gave.holes === 1 ? 'spot was' : 'spots were'} filled` : '',
    gave.thinned > 0 ? `the edge of ${gave.thinned === 1 ? 'the largest water was' : `the ${gave.thinned} largest waters was`} smoothed` : '',
  ].filter((part) => part !== '');
  if (parts.length === 0) return null;
  return `Atlas keeps ${LIQUID_LIMITS.patches} liquids on a level, of ${LIQUID_LIMITS.corners} corners each: to fit, ${parts.join(', ')}.`;
}

/** Whether two masks have the same texels wet (no mask is a dry one). */
export function sameWet(a: WaterMask | null, b: WaterMask | null): boolean {
  if (!a || !b) return (a ?? b)?.empty ?? true;
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let k = 0; k < a.data.length; k++) if ((a.data[k]! > 0) !== (b.data[k]! > 0)) return false;
  return true;
}

const hex = (value: number): string => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
/** `color` mixed towards `other` (`#rrggbb` each) by `share`. */
function mix(color: string, other: string, share: number): string {
  const part = (text: string, at: number): number => parseInt(text.slice(at, at + 2), 16);
  return `#${[1, 3, 5].map((at) => hex(part(color, at) + (part(other, at) - part(color, at)) * share)).join('')}`;
}

const cent = (value: number): number => Math.round(value * 100) / 100 + 0;

/**
 * Outlines as the liquids the brush writes (Atlas's `LiquidSurfaceInput`): water in the motion's tint (Atlas draws it
 * in these colours in its own view), flowing the way the motion runs when it flows (0 runs up the map, 90 to the
 * right), on `level` when the scene has levels, with the motion and the brush's mark in the `tabletop` field.
 */
export function brushLiquids(areas: readonly WaterArea[], motion: WaterMotion, level: string | null): Array<Record<string, unknown>> {
  const tint = HEX.test(motion.tint) ? motion.tint.toLowerCase() : DEFAULT_WATER_MOTION.tint;
  const colors = { surface: tint, deep: mix(tint, '#000000', 0.45), glint: mix(tint, '#ffffff', 0.6) };
  const turn = (motion.direction * Math.PI) / 180;
  const round = (ring: readonly Point[]): Point[] => ring.map((point) => ({ x: cent(point.x), y: cent(point.y) }));
  return areas.map((area) => ({
    liquid: 'water',
    polygon: round(area.polygon),
    ...(area.holes.length > 0 ? { holes: area.holes.map(round) } : {}),
    colors: { ...colors },
    ...(motion.kind === 'flow' ? { flow: { x: Math.round(Math.sin(turn) * 1e6) / 1e6 + 0, y: Math.round(-Math.cos(turn) * 1e6) / 1e6 + 0 } } : {}),
    ...(level ? { level } : {}),
    tabletop: { v: 1, brush: true, motion: { ...motion } },
  }));
}

/**
 * A finished stroke of the brush as the change it makes to a level's liquids: `painted` is the board's whole mask, and
 * `now` the liquids Atlas has on the level at the moment of the write (not those the board last read: a stroke may
 * end before the map was read again after the one before). Every brush-made liquid there is taken off (`remove`) and
 * the mask's outlines written in their place (`add`), in `motion`; a liquid made in Atlas is neither taken off nor
 * painted under (the brush says nothing where it lies), and counts towards the level's liquids. `kept` is the water
 * the level has once that is done: not what was painted where a liquid of Atlas's was erased over, or where Atlas's
 * limits gave something up (`report`).
 */
export function strokeLiquids(painted: WaterMask, now: readonly BoardLiquid[], level: string | null, motion: WaterMotion, report?: OutlineReport): { remove: string[]; add: Array<Record<string, unknown>>; kept: WaterMask } {
  const foreign = now.filter((liquid) => !liquid.brush);
  const areas = maskOutlines(withoutAreas(painted, foreign), { corners: LIQUID_LIMITS.corners, patches: Math.max(0, LIQUID_LIMITS.patches - foreign.length) }, report);
  const kept = WaterMask.like(painted);
  rasterAreas(kept, [...foreign, ...areas]);
  return { remove: now.filter((liquid) => liquid.brush).map((liquid) => liquid.id), add: brushLiquids(areas, motion, level), kept };
}

/**
 * A board's water as it is handed to the board: the outlines of Atlas's liquids (`areas`), the saved mask of a map
 * whose water was not moved to Atlas yet (`mask`), or both, and how it moves. `key` names this water where the
 * giver knows it (so the board need not compare outlines).
 */
export interface WaterSource {
  areas?: readonly WaterArea[];
  mask?: unknown;
  key?: string;
  motion: unknown;
}

/** What tells one water from another: the key given, else the mask and the outlines themselves (never the motion). */
export function waterKeyOf(source: WaterSource | null): string {
  if (!source) return 'null';
  return source.key ?? JSON.stringify([source.mask ?? null, source.areas ?? []]);
}

/** The mask a board draws for `source` on a map of this size: the saved mask and every outline together; null when nothing is wet. */
export function maskOfSource(source: WaterSource | null, mapWidth: number, mapHeight: number, cell: number): WaterMask | null {
  if (!source || !(mapWidth > 0) || !(mapHeight > 0)) return null;
  const mask = WaterMask.read(source.mask, mapWidth, mapHeight, cell) ?? WaterMask.forMap(mapWidth, mapHeight, cell);
  if (source.areas && source.areas.length > 0) rasterAreas(mask, source.areas);
  return mask.empty ? null : mask;
}

/** Outlines as the wire carries them to players: each ring a flat list of x, y in map pixels. */
export interface WireWaterArea { polygon: number[]; holes?: number[][] }

const flat = (ring: readonly Point[]): number[] => ring.flatMap((point) => [cent(point.x), cent(point.y)]);
const unflat = (ring: unknown): Point[] | null => {
  if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 !== 0 || !ring.every((value) => typeof value === 'number' && Number.isFinite(value))) return null;
  const out: Point[] = [];
  for (let k = 0; k < ring.length; k += 2) out.push({ x: ring[k] as number, y: ring[k + 1] as number });
  return out;
};

/** Outlines for the wire. */
export function wireAreas(areas: readonly WaterArea[]): WireWaterArea[] {
  return areas.map((area) => ({ polygon: flat(area.polygon), ...(area.holes.length > 0 ? { holes: area.holes.map(flat) } : {}) }));
}

/**
 * Water as it came over the wire (`{ areas, motion }`; a saved `mask` from a GM of before) as a board is handed it;
 * null for none. Anything that is no ring of at least three places is left out.
 */
export function waterFromWire(water: unknown): WaterSource | null {
  if (!isObj(water)) return null;
  const areas: WaterArea[] = [];
  for (const entry of Array.isArray(water.areas) ? water.areas : []) {
    if (!isObj(entry)) continue;
    const polygon = unflat(entry.polygon);
    if (!polygon) continue;
    areas.push({ polygon, holes: (Array.isArray(entry.holes) ? entry.holes : []).map(unflat).filter((ring): ring is Point[] => ring !== null) });
  }
  if (areas.length === 0 && !isObj(water.mask)) return null;
  return { ...(areas.length > 0 ? { areas } : {}), ...(isObj(water.mask) ? { mask: water.mask } : {}), motion: water.motion ?? null };
}

/**
 * A level's water as a board is handed it: the outlines of its liquids, the saved mask of a map whose painted water
 * was not moved to Atlas yet (`legacy`), and its motion: the one `chosen` on the board just now, else the brush's
 * water's, else the old mask's. Null without water and without a motion chosen.
 */
export function waterSourceOf(liquids: readonly BoardLiquid[], legacy: { mask: unknown; motion?: unknown } | null, chosen: WaterMotion | null = null): WaterSource | null {
  const motion = chosen ?? liquids.find((liquid) => liquid.motion !== null)?.motion ?? legacy?.motion ?? motionOf(liquids);
  if (liquids.length === 0 && !legacy && !motion) return null;
  return { areas: liquids.map(({ polygon, holes }) => ({ polygon, holes })), ...(legacy ? { mask: legacy.mask } : {}), motion: motion ?? null };
}

/** Water for the wire (`BoardWater`): outlines, an old mask not moved yet, and the motion; nothing without water. */
export function wireWater(liquids: readonly BoardLiquid[], legacy: { mask: unknown; motion?: unknown } | null): { areas?: WireWaterArea[]; mask?: unknown; motion: unknown } | null {
  const source = waterSourceOf(liquids, legacy);
  if (!source || (liquids.length === 0 && !legacy)) return null;
  return { ...(liquids.length > 0 ? { areas: wireAreas(source.areas ?? []) } : {}), ...(legacy ? { mask: legacy.mask } : {}), motion: source.motion };
}

/**
 * The water a map kept as a brush mask in Tabletop's data, as the liquids its move to Atlas writes: its outlines as
 * the brush's water on `level`, with the motion it had (what Atlas's limits gave up is added to `report`). Null when
 * the mask cannot be read for a map of this size (it was painted on another image, or on another grid).
 */
export function legacyWaterLiquids(legacy: { mask: unknown; motion?: unknown }, mapWidth: number, mapHeight: number, cell: number, level: string | null, report?: OutlineReport): Array<Record<string, unknown>> | null {
  const mask = WaterMask.read(legacy.mask, mapWidth, mapHeight, cell);
  if (!mask) return null;
  return brushLiquids(maskOutlines(mask, LIQUID_LIMITS, report), readWaterMotion(legacy.motion), level);
}
