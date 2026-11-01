/**
 * Atlas's walls and doors standing on the 3D board. Walls are boxes along their segments, as tall as the fog (a low
 * wall half that), merged into one mesh per material so a map of hundreds of segments costs a few draws; their faces
 * are mapped in world space, one texture tile per grid square, so a material runs on across segments without
 * stretching. A door is its own leaf on a hinge at the segment's first point, swinging a quarter turn when it opens,
 * eased; a door may be a prop from the gallery instead, fitted to the opening. A secret door looks like the walls
 * around it; the GM sees a thin accent line on it, and an arrow on a one-way wall, that players do not.
 *
 * What each wall is painted with comes from `look`: a material shared by every wall painted alike.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LoadedMini } from '../library';
import { DISPLACE_TILE_SHARE } from '../parallax';
import { easeSwing, isDoor, leafHeading, NO_FLIP, passHeading, segmentFrame, stepOpenness, swingSide, type BoardWall, type DoorFlip } from './walls';

export interface WallLookup {
  /** The material of a wall painted with `path` (null: the plain look of a wall, or of a door). */
  look(path: string | null, door: boolean): THREE.Material;
  /** The material painted on a wall or door, by id. */
  materialOf(id: string): string | null;
  /** A wall's own height in grid squares; null for the default (the fog's, half that for a low wall). */
  heightOf(id: string): number | null;
  /** Whether walls painted with `path` are moved by a height map, so their faces are cut finely enough to follow it. */
  displaces?(path: string | null): boolean;
  /** How wide a tile of the texture painted with `path` stands, in grid squares (1 when unknown). */
  tileOf?(path: string | null): number;
  /** The prop standing in for a door, by id. */
  propOf(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it (hinge at the other end, opening to the other side); none unless said. */
  flipOf?(id: string): DoorFlip;
  /** Loads a prop's model. */
  prop(glb: string): Promise<LoadedMini | null>;
}

export interface WallShape {
  /** How tall a full wall stands, and the size of a grid square (a texture tile), in map pixels. */
  height: number;
  tile: number;
  /** How thick a wall stands, in map pixels. */
  thickness: number;
  /** Whether a point of the map is under the fog of war: walls there are hidden from players. */
  fogged(x: number, y: number): boolean;
  /** Changes when the fog does, so walls are sorted again. */
  fogKey: string;
  /** How round the walls' edges are, as a share of a square (0: sharp). */
  edge: number;
  /** Cuts a texture tile of a displaced wall's faces is given (0: none). */
  cuts: number;
}

/** A door's leaf is a little thinner than its wall, so it never flickers in the wall. */
const LEAF = 0.8;
/** Glass, which stops light and lets sight through. */
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, depthWrite: false });
const ACCENT = new THREE.MeshBasicMaterial({ color: 0x7c5cff, side: THREE.DoubleSide });

/** Cuts a tile of a displaced wall's face is given, and the most one face gets (a long wall in a huge map stays cheap). */
export const DISPLACE_DETAIL = 16;
const MAX_CUTS = 96;
/** The most triangles all the displaced walls of a map may have between them: past it every wall is cut a little coarser. */
export const DISPLACE_TRIANGLES = 800_000;
/** Steps in a rounded edge's quarter turn. */
const ROUND_STEPS = 3;
/** The reach of a vertex grows from nothing at a face's edge to all of it this far in, in squares. */
const EDGE_FADE = 0.1;

interface Door {
  wall: BoardWall;
  pivot: THREE.Group;
  leaf: THREE.Object3D;
  openness: number;
  goal: number;
  height: number;
  /** How the GM turned it from the way Atlas draws it. */
  flip: DoorFlip;
}

/**
 * Appends a box's faces to `out`: a segment `length` long and `thick` thick, `height` tall from `bottom`, centred on
 * (cx, cz) and heading `heading` (radians, map x toward map y). Faces are mapped in world space by `tile`.
 * With a `detail` (cuts a tile) and `out.reach`, the long faces and the top are cut into a grid, each vertex with how far a height map
 * may push it in: nothing at the face's edges, so the boxes of a wall still meet. With `rounding`, the top edges are rounded to
 * `share` of a square, and the vertical edges at the ends asked for (not where a wall carries straight on into another, which
 * would leave a groove): every face is cut at the rounded bands and its vertices are pulled onto the arc, so the faces still
 * meet and the normals run smooth round the edge.
 */
export function pushBox(
  out: { positions: number[]; normals: number[]; uvs: number[]; reach?: number[] },
  cx: number, cz: number, heading: number, length: number, thick: number, bottom: number, height: number, tile: number, detail = 0,
  rounding?: { start: boolean; end: boolean; share: number },
): void {
  const ux = Math.cos(heading);
  const uz = Math.sin(heading);
  const nx = -uz;
  const nz = ux;
  const hl = length / 2;
  const ht = thick / 2;
  const top = bottom + height;
  const r = rounding && rounding.share > 0 ? Math.min(ht * 0.8, tile * rounding.share, length / 4, height / 4) : 0;
  const around = (a: number, b: number, y: number): [number, number, number] => [cx + ux * a + nx * b, y, cz + uz * a + nz * b];
  const arc = (k: number): number => r * Math.tan((k * Math.PI) / (4 * ROUND_STEPS));
  // The grid lines along an axis from lo to hi: the arc's steps where an edge is rounded, and cuts between.
  const lines = (lo: number, hi: number, roundLo: boolean, roundHi: boolean, cut: boolean): number[] => {
    const from = lo + (roundLo ? r : 0);
    const to = hi - (roundHi ? r : 0);
    const inner = cut && detail > 0 && out.reach ? Math.min(MAX_CUTS, Math.max(1, Math.ceil(((to - from) / tile) * detail))) : 1;
    const list: number[] = [];
    if (roundLo) for (let k = ROUND_STEPS; k >= 1; k--) list.push(lo + r - arc(k));
    for (let i = 0; i <= inner; i++) list.push(from + ((to - from) * i) / inner);
    if (roundHi) for (let k = 1; k <= ROUND_STEPS; k++) list.push(hi - r + arc(k));
    return list;
  };
  type Axis = 'a' | 'b' | 'y';
  const extent: Record<Axis, [number, number]> = { a: [-hl, hl], b: [-ht, ht], y: [bottom, top] };
  // Which edges are rounded, as [low, high] on each axis: the bottom is not (it stands on the floor).
  const rounded: Record<Axis, [boolean, boolean]> = { a: [r > 0 && !!rounding?.start, r > 0 && !!rounding?.end], b: [r > 0, r > 0], y: [false, r > 0] };
  const clampTo = (axis: Axis, value: number): number => {
    const [lo, hi] = extent[axis];
    return Math.min(hi - (rounded[axis][1] ? r : 0), Math.max(lo + (rounded[axis][0] ? r : 0), value));
  };
  const vectors: Record<Axis, [number, number, number]> = { a: [ux, 0, uz], b: [nx, 0, nz], y: [0, 1, 0] };
  type Vertex = { position: [number, number, number]; normal: [number, number, number]; uv: [number, number]; reach: number };
  /** One face: fixed on `fixed` at its `sign` side, gridded over the other two axes (`u`, `v`). */
  const face = (fixed: Axis, sign: 1 | -1, u: Axis, v: Axis, uv: (p: [number, number, number]) => [number, number], cut: boolean): void => {
    const us = lines(extent[u][0], extent[u][1], rounded[u][0], rounded[u][1], cut);
    const vs = lines(extent[v][0], extent[v][1], rounded[v][0], rounded[v][1], cut);
    const normal = vectors[fixed].map((value) => value * sign) as [number, number, number];
    // Wound to face out: u cross v must run the way the face looks.
    const eu = vectors[u];
    const ev = vectors[v];
    const cross = [eu[1] * ev[2] - eu[2] * ev[1], eu[2] * ev[0] - eu[0] * ev[2], eu[0] * ev[1] - eu[1] * ev[0]];
    const flip = cross[0]! * normal[0] + cross[1]! * normal[1] + cross[2]! * normal[2] < 0;
    const vertex = (i: number, j: number): Vertex => {
      const at: Record<Axis, number> = { a: 0, b: 0, y: 0 };
      at[fixed] = sign > 0 ? extent[fixed][1] : extent[fixed][0];
      at[u] = us[i]!;
      at[v] = vs[j]!;
      const flat = around(at.a, at.b, at.y);
      let position = flat;
      let facing = normal;
      if (r > 0) {
        // The inner box is the one the arcs are drawn round; a vertex off it is put on the arc, r from it.
        const da = at.a - clampTo('a', at.a);
        const db = at.b - clampTo('b', at.b);
        const dy = at.y - clampTo('y', at.y);
        const size = Math.hypot(da, db, dy);
        const edged = (da !== 0 ? 1 : 0) + (db !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) > 1;
        if (size > 1e-9 && edged) {
          const la = da / size;
          const lb = db / size;
          const ly = dy / size;
          position = around(clampTo('a', at.a) + la * r, clampTo('b', at.b) + lb * r, clampTo('y', at.y) + ly * r);
          facing = [ux * la + nx * lb, ly, uz * la + nz * lb];
        }
      }
      let reach = 0;
      if (cut && detail > 0 && out.reach) {
        const edge = Math.min(us[i]! - extent[u][0], extent[u][1] - us[i]!, vs[j]! - extent[v][0], extent[v][1] - vs[j]!) / tile / EDGE_FADE;
        const ease = Math.min(1, Math.max(0, edge));
        reach = ease * ease * (3 - 2 * ease) * tile * DISPLACE_TILE_SHARE;
      }
      return { position, normal: facing, uv: uv(flat), reach };
    };
    const emit = (p: Vertex): void => {
      out.positions.push(...p.position);
      out.normals.push(...p.normal);
      out.uvs.push(...p.uv);
      out.reach?.push(p.reach);
    };
    for (let i = 0; i + 1 < us.length; i++) {
      for (let j = 0; j + 1 < vs.length; j++) {
        const p00 = vertex(i, j);
        const p10 = vertex(i + 1, j);
        const p11 = vertex(i + 1, j + 1);
        const p01 = vertex(i, j + 1);
        for (const p of flip ? [p00, p11, p10, p00, p01, p11] : [p00, p10, p11, p00, p11, p01]) emit(p);
      }
    }
  };
  const along = (p: [number, number, number]): number => (p[0] * ux + p[2] * uz) / tile;
  const across = (p: [number, number, number]): number => (p[0] * nx + p[2] * nz) / tile;
  const side = (p: [number, number, number]): [number, number] => [along(p), p[1] / tile];
  const end = (p: [number, number, number]): [number, number] => [across(p), p[1] / tile];
  const flat = (p: [number, number, number]): [number, number] => [along(p), across(p)];
  face('b', 1, 'a', 'y', side, true);
  face('b', -1, 'a', 'y', side, true);
  face('a', 1, 'b', 'y', end, false);
  face('a', -1, 'b', 'y', end, false);
  face('y', 1, 'a', 'b', flat, true);
  face('y', -1, 'a', 'b', flat, false);
}

/** How a wall's ends are drawn where it meets others (see `planJoins`). */
export interface WallJoin {
  /** How far the box runs past its first and second end: half the thickness, to close a corner, or none where a wall carries straight on. */
  extend: [number, number];
  /** 0, 1, 2...: walls that overlap at a corner stand a little different from each other, so their coplanar faces never fight in depth. */
  level: number;
}

/** The sine of the angle between two walls above which their corner is treated as square (about 64 degrees). */
const SQUARE_CORNER = 0.9;

const endKey = (p: { x: number; y: number }): string => `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;

/**
 * Where walls meet, their boxes overlap, and overlapping boxes share planes (a top at the same height, a side in line):
 * the depth buffer then picks one at random per pixel, and the join flickers. A wall that carries straight on into
 * another stops at the join instead of running into it; walls that meet at an angle or in a T still overlap, so each
 * takes a level that differs from every wall it touches (greedily: the first level none of the earlier ones has).
 */
export function planJoins(walls: ReadonlyArray<Pick<BoardWall, 'id' | 'p1' | 'p2'>>, thick: number): Map<string, WallJoin> {
  const at = new Map<string, Array<{ id: string; end: 0 | 1 }>>();
  for (const wall of walls) {
    for (const end of [0, 1] as const) {
      const key = endKey(end === 0 ? wall.p1 : wall.p2);
      const list = at.get(key);
      if (list) list.push({ id: wall.id, end }); else at.set(key, [{ id: wall.id, end }]);
    }
  }
  const byId = new Map(walls.map((wall) => [wall.id, wall]));
  const length = (id: string): number => {
    const wall = byId.get(id)!;
    return Math.hypot(wall.p2.x - wall.p1.x, wall.p2.y - wall.p1.y);
  };
  const direction = (id: string): { x: number; y: number } => {
    const wall = byId.get(id)!;
    const length = Math.hypot(wall.p2.x - wall.p1.x, wall.p2.y - wall.p1.y) || 1;
    return { x: (wall.p2.x - wall.p1.x) / length, y: (wall.p2.y - wall.p1.y) / length };
  };
  const joins = new Map<string, WallJoin>(walls.map((wall) => [wall.id, { extend: [thick / 2, thick / 2], level: 0 }]));
  const neighbours = new Map<string, Set<string>>(walls.map((wall) => [wall.id, new Set<string>()]));
  for (const meeting of at.values()) {
    if (meeting.length < 2) continue;
    for (const a of meeting) for (const b of meeting) if (a.id !== b.id) neighbours.get(a.id)!.add(b.id);
    if (meeting.length === 3 || meeting.length === 4) {
      squareCrossing(meeting, joins, neighbours, direction, length, thick);
      continue;
    }
    if (meeting.length !== 2) continue;
    const [a, b] = meeting as [{ id: string; end: 0 | 1 }, { id: string; end: 0 | 1 }];
    if (a.id === b.id) continue;
    const da = direction(a.id);
    const db = direction(b.id);
    // Walls on one line: the sine of the angle between them is nothing.
    if (Math.abs(da.x * db.y - da.y * db.x) < 0.02) {
      joins.get(a.id)!.extend[a.end] = 0;
      joins.get(b.id)!.extend[b.end] = 0;
      neighbours.get(a.id)!.delete(b.id);
      neighbours.get(b.id)!.delete(a.id);
    } else if (Math.abs(da.x * db.y - da.y * db.x) > SQUARE_CORNER && length(a.id) >= thick * 2 && length(b.id) >= thick * 2) {
      // A corner near a right angle: one wall takes the corner square, the other stops at its face, so no box overlaps another
      // (walls of different materials would otherwise show their tops and faces through each other there).
      const [taker, stopper] = a.id < b.id ? [a, b] : [b, a];
      joins.get(taker.id)!.extend[taker.end] = thick / 2;
      joins.get(stopper.id)!.extend[stopper.end] = -thick / 2;
      neighbours.get(a.id)!.delete(b.id);
      neighbours.get(b.id)!.delete(a.id);
    }
  }
  const placed = new Set<string>();
  for (const wall of walls) {
    const used = new Set<number>();
    for (const other of neighbours.get(wall.id)!) if (placed.has(other)) used.add(joins.get(other)!.level);
    let level = 0;
    while (used.has(level)) level++;
    joins.get(wall.id)!.level = level;
    placed.add(wall.id);
  }
  return joins;
}

/**
 * A T (two walls in line and a third square to them) or a crossing (two lines square to each other) at one point: the walls
 * in line stop flush at it, and the walls across stop at their faces, so no box overlaps another. Anything else is left to
 * the levels.
 */
function squareCrossing(
  meeting: Array<{ id: string; end: 0 | 1 }>, joins: Map<string, WallJoin>, neighbours: Map<string, Set<string>>,
  direction: (id: string) => { x: number; y: number }, length: (id: string) => number, thick: number,
): void {
  if (new Set(meeting.map((m) => m.id)).size !== meeting.length) return;
  const sine = (a: { id: string }, b: { id: string }): number => {
    const da = direction(a.id);
    const db = direction(b.id);
    return Math.abs(da.x * db.y - da.y * db.x);
  };
  const pairs: Array<[typeof meeting[number], typeof meeting[number]]> = [];
  const paired = new Set<string>();
  for (const a of meeting) for (const b of meeting) {
    if (a.id < b.id && !paired.has(a.id) && !paired.has(b.id) && sine(a, b) < 0.02) { pairs.push([a, b]); paired.add(a.id); paired.add(b.id); }
  }
  const rest = meeting.filter((m) => !paired.has(m.id));
  const fits = (meeting.length === 3 && pairs.length === 1 && rest.length === 1) || (meeting.length === 4 && pairs.length === 2);
  if (!fits || meeting.some((m) => length(m.id) < thick * 2)) return;
  const through = pairs.sort((x, y) => (x[0].id < y[0].id ? -1 : 1))[0]!;
  const across = meeting.filter((m) => m !== through[0] && m !== through[1]);
  if (across.some((m) => sine(m, through[0]) <= SQUARE_CORNER)) return;
  for (const m of through) joins.get(m.id)!.extend[m.end] = 0;
  for (const m of across) joins.get(m.id)!.extend[m.end] = -thick / 2;
  for (const a of meeting) for (const b of meeting) neighbours.get(a.id)!.delete(b.id);
}

function geometryOf(data: { positions: number[]; normals: number[]; uvs: number[]; reach?: number[] }): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  // The ambient-occlusion map reads a second set: the same.
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(data.uvs, 2));
  if (data.reach) geometry.setAttribute('reach', new THREE.Float32BufferAttribute(data.reach, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class WallSet {
  readonly object3d = new THREE.Group();
  /** What only the GM sees: the secret doors' accent and the one-way arrows. */
  private readonly gmOnly = new THREE.Group();
  private readonly doors = new Map<string, Door>();
  /** The merged meshes, and for each the wall of every box in it, in order, with the triangle each box ends at (boxes of displaced walls are cut into many). */
  private readonly meshes: Array<{ mesh: THREE.Mesh; ids: string[]; ends: number[] }> = [];
  private signature = '';
  private generation = 0;

  constructor(private readonly lookup: WallLookup) {
    this.object3d.name = 'walls';
    this.object3d.add(this.gmOnly);
  }

  /**
   * Draws the map's walls. Only a change of what stands (segments, height, paint, props) rebuilds them; a door that
   * opened or shut swings to its new place.
   */
  update(walls: readonly BoardWall[], shape: WallShape): void {
    const signature = JSON.stringify([shape.height, shape.tile, shape.edge, shape.cuts, shape.thickness, shape.fogKey, walls.map((wall) => [wall.id, wall.type, wall.p1, wall.p2, wall.direction, wall.blocks, wall.limited, wall.chain, this.lookup.materialOf(wall.id), this.lookup.displaces?.(this.lookup.materialOf(wall.id)) ?? false, this.lookup.tileOf?.(this.lookup.materialOf(wall.id)) ?? 1, this.lookup.heightOf(wall.id), isDoor(wall) ? this.lookup.propOf(wall.id) : null, isDoor(wall) ? this.lookup.flipOf?.(wall.id) ?? NO_FLIP : null])]);
    if (signature !== this.signature) {
      const openness = new Map([...this.doors].map(([id, door]) => [id, door.openness]));
      this.clear();
      this.signature = signature;
      this.build(walls, shape, openness);
    }
    for (const wall of walls) {
      const door = this.doors.get(wall.id);
      if (door) { door.wall = wall; door.goal = wall.closed ? 0 : 1; }
    }
  }

  private build(walls: readonly BoardWall[], shape: WallShape, openness: Map<string, number>): void {
    const generation = ++this.generation;
    const thick = shape.thickness;
    const joins = planJoins(walls.filter((wall) => wall.type !== 'door' && wall.type !== 'secret-door'), thick);
    // A level is a hair of height (a hundredth of a square) and of thickness: too small to see, larger than the depth buffer tells apart.
    const rise = shape.tile * 0.01;
    // A displaced wall's triangles grow with the square of its cuts: when the map's walls would be too many for it, they are all cut coarser.
    const cutsOf = (paint: string | null): number => (shape.cuts > 0 && this.lookup.displaces?.(paint) ? shape.cuts / Math.max(0.05, this.lookup.tileOf?.(paint) ?? 1) : 0);
    const sizes: [number, number, number][] = [];
    for (const wall of walls) {
      if (wall.type === 'door' || wall.type === 'secret-door' || wall.blocks === 'light' || wall.blocks === 'sight') continue;
      const cuts = cutsOf(this.lookup.materialOf(wall.id));
      if (cuts <= 0) continue;
      const own = this.lookup.heightOf(wall.id);
      const squares = own !== null ? own : wall.limited ? shape.height / shape.tile / 2 : shape.height / shape.tile;
      sizes.push([Math.hypot(wall.p2.x - wall.p1.x, wall.p2.y - wall.p1.y) / shape.tile, squares, cuts]);
    }
    // The faces, their ends and top, and the rounded edges come to about twice the two big faces.
    const estimate = (factor: number): number => sizes.reduce((sum, [long, squares, cuts]) => sum + 8 * Math.min(MAX_CUTS, Math.max(1, long * cuts * factor)) * Math.min(MAX_CUTS, Math.max(1, squares * cuts * factor)), 0);
    let coarser = 1;
    for (let i = 0; i < 12 && estimate(coarser) > DISPLACE_TRIANGLES; i++) coarser *= 0.8;
    const groups = new Map<string, { material: THREE.Material; data: { positions: number[]; normals: number[]; uvs: number[]; reach?: number[] }; ids: string[]; ends: number[]; detail: number; shadow: boolean; fogged: boolean }>();
    for (const wall of walls) {
      const own = this.lookup.heightOf(wall.id);
      const height = own !== null ? own * shape.tile : wall.limited ? shape.height / 2 : shape.height;
      // A wall set to no height stands nowhere.
      if (height <= 0) continue;
      const frame = segmentFrame(wall.p1, wall.p2);
      if (wall.type === 'door' || wall.type === 'secret-door') {
        this.addDoor(wall, shape, height, thick, openness.get(wall.id) ?? (wall.closed ? 0 : 1), generation);
        this.doors.get(wall.id)!.pivot.userData.fogged = shape.fogged(frame.cx, frame.cy);
        continue;
      }
      const glass = wall.blocks === 'light';
      const paint = this.lookup.materialOf(wall.id);
      // Walls under the fog (by their middle, as tokens are) go in meshes of their own, which players do not see.
      const fogged = shape.fogged(frame.cx, frame.cy);
      const key = `${glass ? 'glass' : wall.blocks === 'sight' ? `curtain|${paint ?? ''}` : `wall|${paint ?? ''}`}|${fogged ? 'fog' : ''}`;
      let group = groups.get(key);
      if (!group) {
        // A curtain lets light through: it casts no shadow.
        // The cuts follow the texture, not the grid: a small tile needs finer cuts to show its relief.
        const detail = glass || wall.blocks === 'sight' ? 0 : cutsOf(paint) * coarser;
        group = { material: glass ? GLASS : this.lookup.look(paint, false), data: { positions: [], normals: [], uvs: [], ...(detail ? { reach: [] } : {}) }, ids: [], ends: [], detail, shadow: wall.blocks !== 'sight', fogged };
        groups.set(key, group);
      }
      // A little longer than the segment at a corner, so corners meet without a gap; where walls meet they stand at levels (planJoins).
      const join = joins.get(wall.id)!;
      const [before, after] = join.extend;
      const shift = (after - before) / 2;
      pushBox(group.data, frame.cx + Math.cos(frame.heading) * shift, frame.cy + Math.sin(frame.heading) * shift, frame.heading, frame.length + before + after, thick - join.level * thick * 0.04, 0, height + join.level * rise, shape.tile, group.detail, { start: before > 0, end: after > 0, share: shape.edge });
      group.ids.push(wall.id);
      group.ends.push(group.data.positions.length / 9);
      if (wall.direction) this.addArrow(wall, frame, height, thick);
    }
    for (const group of groups.values()) {
      const mesh = new THREE.Mesh(geometryOf(group.data), group.material);
      mesh.castShadow = group.shadow;
      mesh.receiveShadow = true;
      mesh.userData.walls = true;
      mesh.userData.fogged = group.fogged;
      this.object3d.add(mesh);
      this.meshes.push({ mesh, ids: group.ids, ends: group.ends });
    }
  }

  private addDoor(wall: BoardWall, shape: WallShape, height: number, thick: number, openness: number, generation: number): void {
    const frame = segmentFrame(wall.p1, wall.p2);
    const pivot = new THREE.Group();
    // The hinge is at the segment's first end, or the second where the door was turned or mirrored.
    const flip = this.lookup.flipOf?.(wall.id) ?? NO_FLIP;
    const hinge = flip.hinge ? wall.p2 : wall.p1;
    pivot.position.set(hinge.x, 0, hinge.y);
    pivot.userData.doorId = wall.id;
    // A secret door wears the walls' look unless it was painted itself.
    const paint = this.lookup.materialOf(wall.id);
    const secret = wall.type === 'secret-door';
    const data = { positions: [] as number[], normals: [] as number[], uvs: [] as number[] };
    // A hair lower than the walls beside it, whose tops it would share.
    pushBox(data, frame.length / 2, 0, 0, frame.length, thick * LEAF, 0, height - shape.tile * 0.01, shape.tile, 0, { start: true, end: true, share: shape.edge });
    const leaf = new THREE.Mesh(geometryOf(data), this.lookup.look(paint, !secret));
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    leaf.userData.doorId = wall.id;
    leaf.userData.ownGeometry = true;
    pivot.add(leaf);
    if (secret) {
      // A thin line along the top of the leaf.
      const accent = new THREE.Mesh(new THREE.BoxGeometry(frame.length * 0.8, thick * 0.15, thick * 0.3), ACCENT);
      accent.position.set(frame.length / 2, height + thick * 0.1, 0);
      accent.userData.gmOnly = true;
      accent.userData.ownGeometry = true;
      pivot.add(accent);
    }
    this.object3d.add(pivot);
    const door: Door = { wall, pivot, leaf, openness, goal: wall.closed ? 0 : 1, height, flip };
    this.doors.set(wall.id, door);
    this.pose(door);
    const glb = this.lookup.propOf(wall.id);
    if (glb) {
      void this.lookup.prop(glb).then((model) => {
        if (!model || generation !== this.generation || this.doors.get(wall.id) !== door) return;
        const fitted = fitDoorProp(model, frame.length, height);
        fitted.traverse((node) => { node.userData.doorId = wall.id; });
        pivot.remove(leaf);
        pivot.add(fitted);
        door.leaf = fitted;
      });
    }
  }

  /** A one-way wall's arrow, on its top, pointing the way light passes it (away from the side it stops). */
  private addArrow(wall: BoardWall, frame: ReturnType<typeof segmentFrame>, height: number, thick: number): void {
    const size = Math.min(frame.length * 0.3, thick * 1.6);
    const toward = passHeading(wall) ?? frame.heading;
    const dx = Math.cos(toward);
    const dz = Math.sin(toward);
    const ux = Math.cos(frame.heading);
    const uz = Math.sin(frame.heading);
    const y = height + 0.5;
    const vertices = [
      frame.cx + dx * size * 0.8, y, frame.cy + dz * size * 0.8,
      frame.cx + ux * size / 2, y, frame.cy + uz * size / 2,
      frame.cx - ux * size / 2, y, frame.cy - uz * size / 2,
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    const arrow = new THREE.Mesh(geometry, ACCENT);
    arrow.userData.gmOnly = true;
    this.gmOnly.add(arrow);
  }

  private pose(door: Door): void {
    door.pivot.rotation.y = -leafHeading(door.wall, easeSwing(door.openness), door.flip);
  }

  /** Builds the walls again at the next update (their materials changed). */
  invalidate(): void {
    this.signature = '';
  }

  /** Swings the doors toward their goals; returns whether one is still moving. */
  step(dt: number): boolean {
    let moving = false;
    for (const door of this.doors.values()) {
      if (door.openness === door.goal) continue;
      door.openness = stepOpenness(door.openness, door.goal, dt);
      this.pose(door);
      moving = true;
    }
    return moving;
  }

  /** Opens or shuts a door at once on the board (the save follows). */
  setOpen(id: string, open: boolean): void {
    const door = this.doors.get(id);
    if (door) door.goal = open ? 1 : 0;
  }

  /** What the players do not see: hidden for their picture. */
  show(viewer: 'gm' | 'player'): void {
    const gm = viewer === 'gm';
    this.gmOnly.visible = gm;
    for (const { mesh } of this.meshes) mesh.visible = gm || mesh.userData.fogged !== true;
    for (const door of this.doors.values()) {
      door.pivot.visible = gm || door.pivot.userData.fogged !== true;
      door.pivot.traverse((node) => { if (node.userData.gmOnly) node.visible = gm; });
    }
  }

  /** The door a ray hits first, by id. */
  doorAt(raycaster: THREE.Raycaster): string | null {
    const pivots = [...this.doors.values()].map((door) => door.pivot);
    const hit = raycaster.intersectObjects(pivots, true).find((candidate) => candidate.object.visible && candidate.object.userData.gmOnly !== true);
    return (hit?.object.userData.doorId as string | undefined) ?? null;
  }

  /** The wall or door a ray hits first, by id. */
  wallAt(raycaster: THREE.Raycaster): string | null {
    const targets = [...this.meshes.map((entry) => entry.mesh), ...[...this.doors.values()].map((door) => door.pivot)];
    const hit = raycaster.intersectObjects(targets, true).find((candidate) => candidate.object.userData.gmOnly !== true);
    if (!hit) return null;
    const door = hit.object.userData.doorId as string | undefined;
    if (door) return door;
    const entry = this.meshes.find((candidate) => candidate.mesh === hit.object);
    if (!entry || hit.faceIndex == null) return null;
    const face = hit.faceIndex;
    return entry.ids[entry.ends.findIndex((end) => face < end)] ?? null;
  }

  /** The side a door swings to, for its menu. */
  swing(id: string): 1 | -1 | null {
    const door = this.doors.get(id);
    return door ? swingSide(door.wall, door.flip) : null;
  }

  private clear(): void {
    this.generation++;
    for (const { mesh } of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    this.meshes.length = 0;
    for (const door of this.doors.values()) {
      door.pivot.removeFromParent();
      door.pivot.traverse((node) => {
        const mesh = node as THREE.Mesh;
        // A prop's geometry is its model's, shared: only what was made for the door goes.
        if (mesh.isMesh && mesh.userData.ownGeometry === true) mesh.geometry.dispose();
      });
    }
    this.doors.clear();
    for (const child of [...this.gmOnly.children]) {
      child.removeFromParent();
      (child as THREE.Mesh).geometry?.dispose();
    }
  }

  dispose(): void {
    this.clear();
    this.object3d.removeFromParent();
  }
}

/**
 * A gallery prop fitted to a door's opening: turned so its widest side runs along the door, stretched to the door's
 * width and the wall's height (its depth kept in proportion), its near edge on the hinge.
 */
export function fitDoorProp(model: LoadedMini, length: number, height: number): THREE.Object3D {
  const holder = new THREE.Group();
  const clone = cloneSkinned(model.scene);
  const box = new THREE.Box3().setFromObject(clone, true);
  const size = box.getSize(new THREE.Vector3());
  // Modelled along z: turned a quarter so it runs along the door.
  if (size.z > size.x) clone.rotation.y = Math.PI / 2;
  const along = Math.max(size.x, size.z, 1e-6);
  const across = Math.min(size.x, size.z);
  const sx = length / along;
  const sy = height / Math.max(size.y, 1e-6);
  clone.updateMatrix();
  const inner = new THREE.Group();
  inner.add(clone);
  inner.scale.set(sx, sy, sx);
  // Centred on the opening's middle, half the door from the hinge.
  inner.position.set(length / 2, 0, 0);
  holder.add(inner);
  holder.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });
  holder.userData.depth = across * sx;
  return holder;
}
