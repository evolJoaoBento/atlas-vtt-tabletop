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
import { easeSwing, isDoor, leafHeading, passHeading, segmentFrame, stepOpenness, swingSide, type BoardWall } from './walls';

export interface WallLookup {
  /** The material of a wall painted with `path` (null: the plain look of a wall, or of a door). */
  look(path: string | null, door: boolean): THREE.Material;
  /** The material painted on a wall or door, by id. */
  materialOf(id: string): string | null;
  /** A wall's own height in grid squares; null for the default (the fog's, half that for a low wall). */
  heightOf(id: string): number | null;
  /** The prop standing in for a door, by id. */
  propOf(id: string): string | null;
  /** Loads a prop's model. */
  prop(glb: string): Promise<LoadedMini | null>;
}

export interface WallShape {
  /** How tall a full wall stands, and the size of a grid square (a texture tile), in map pixels. */
  height: number;
  tile: number;
  /** Whether a point of the map is under the fog of war: walls there are hidden from players. */
  fogged(x: number, y: number): boolean;
  /** Changes when the fog does, so walls are sorted again. */
  fogKey: string;
}

/** A wall is this share of a grid square thick; a door's leaf a little thinner, so it never flickers in the wall. */
const THICKNESS = 0.12;
const LEAF = 0.8;
/** Glass, which stops light and lets sight through. */
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9fc6e8, transparent: true, opacity: 0.32, roughness: 0.1, metalness: 0.1, depthWrite: false });
const ACCENT = new THREE.MeshBasicMaterial({ color: 0x7c5cff, side: THREE.DoubleSide });

/** Twelve triangles a box: the face index of a hit tells its segment. */
const TRIANGLES_PER_BOX = 12;

interface Door {
  wall: BoardWall;
  pivot: THREE.Group;
  leaf: THREE.Object3D;
  openness: number;
  goal: number;
  height: number;
}

/**
 * Appends a box's faces to `out`: a segment `length` long and `thick` thick, `height` tall from `bottom`, centred on
 * (cx, cz) and heading `heading` (radians, map x toward map y). Faces are mapped in world space by `tile`.
 */
export function pushBox(
  out: { positions: number[]; normals: number[]; uvs: number[] },
  cx: number, cz: number, heading: number, length: number, thick: number, bottom: number, height: number, tile: number,
): void {
  const ux = Math.cos(heading);
  const uz = Math.sin(heading);
  const nx = -uz;
  const nz = ux;
  const hl = length / 2;
  const ht = thick / 2;
  const corner = (a: number, b: number, y: number): [number, number, number] => [cx + ux * a + nx * b, y, cz + uz * a + nz * b];
  const along = (p: [number, number, number]): number => (p[0] * ux + p[2] * uz) / tile;
  const across = (p: [number, number, number]): number => (p[0] * nx + p[2] * nz) / tile;
  const quad = (corners: Array<[number, number, number]>, normal: [number, number, number], uv: (p: [number, number, number]) => [number, number]): void => {
    const [a, b, c, d] = corners as [[number, number, number], [number, number, number], [number, number, number], [number, number, number]];
    for (const p of [a, b, c, a, c, d]) {
      out.positions.push(...p);
      out.normals.push(...normal);
      out.uvs.push(...uv(p));
    }
  };
  const top = bottom + height;
  const side = (p: [number, number, number]): [number, number] => [along(p), p[1] / tile];
  const end = (p: [number, number, number]): [number, number] => [across(p), p[1] / tile];
  const flat = (p: [number, number, number]): [number, number] => [along(p), across(p)];
  // The long faces, each wound to face out.
  quad([corner(-hl, ht, bottom), corner(hl, ht, bottom), corner(hl, ht, top), corner(-hl, ht, top)], [nx, 0, nz], side);
  quad([corner(hl, -ht, bottom), corner(-hl, -ht, bottom), corner(-hl, -ht, top), corner(hl, -ht, top)], [-nx, 0, -nz], side);
  // The two ends.
  quad([corner(hl, ht, bottom), corner(hl, -ht, bottom), corner(hl, -ht, top), corner(hl, ht, top)], [ux, 0, uz], end);
  quad([corner(-hl, -ht, bottom), corner(-hl, ht, bottom), corner(-hl, ht, top), corner(-hl, -ht, top)], [-ux, 0, -uz], end);
  // The top and the bottom.
  quad([corner(-hl, ht, top), corner(hl, ht, top), corner(hl, -ht, top), corner(-hl, -ht, top)], [0, 1, 0], flat);
  quad([corner(-hl, -ht, bottom), corner(hl, -ht, bottom), corner(hl, ht, bottom), corner(-hl, ht, bottom)], [0, -1, 0], flat);
}

function geometryOf(data: { positions: number[]; normals: number[]; uvs: number[] }): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  // The ambient-occlusion map reads a second set: the same.
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(data.uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

export class WallSet {
  readonly object3d = new THREE.Group();
  /** What only the GM sees: the secret doors' accent and the one-way arrows. */
  private readonly gmOnly = new THREE.Group();
  private readonly doors = new Map<string, Door>();
  /** The merged meshes, and for each the wall of every box in it, in order. */
  private readonly meshes: Array<{ mesh: THREE.Mesh; ids: string[] }> = [];
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
    const signature = JSON.stringify([shape.height, shape.tile, shape.fogKey, walls.map((wall) => [wall.id, wall.type, wall.p1, wall.p2, wall.direction, wall.blocks, wall.limited, wall.chain, this.lookup.materialOf(wall.id), this.lookup.heightOf(wall.id), isDoor(wall) ? this.lookup.propOf(wall.id) : null])]);
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
    const thick = shape.tile * THICKNESS;
    const groups = new Map<string, { material: THREE.Material; data: { positions: number[]; normals: number[]; uvs: number[] }; ids: string[]; shadow: boolean; fogged: boolean }>();
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
        group = { material: glass ? GLASS : this.lookup.look(paint, false), data: { positions: [], normals: [], uvs: [] }, ids: [], shadow: wall.blocks !== 'sight', fogged };
        groups.set(key, group);
      }
      // A little longer than the segment, so corners meet without a gap.
      pushBox(group.data, frame.cx, frame.cy, frame.heading, frame.length + thick, thick, 0, height, shape.tile);
      group.ids.push(wall.id);
      if (wall.direction) this.addArrow(wall, frame, height, thick);
    }
    for (const group of groups.values()) {
      const mesh = new THREE.Mesh(geometryOf(group.data), group.material);
      mesh.castShadow = group.shadow;
      mesh.receiveShadow = true;
      mesh.userData.walls = true;
      mesh.userData.fogged = group.fogged;
      this.object3d.add(mesh);
      this.meshes.push({ mesh, ids: group.ids });
    }
  }

  private addDoor(wall: BoardWall, shape: WallShape, height: number, thick: number, openness: number, generation: number): void {
    const frame = segmentFrame(wall.p1, wall.p2);
    const pivot = new THREE.Group();
    pivot.position.set(wall.p1.x, 0, wall.p1.y);
    pivot.userData.doorId = wall.id;
    // A secret door wears the walls' look unless it was painted itself.
    const paint = this.lookup.materialOf(wall.id);
    const secret = wall.type === 'secret-door';
    const data = { positions: [] as number[], normals: [] as number[], uvs: [] as number[] };
    pushBox(data, frame.length / 2, 0, 0, frame.length, thick * LEAF, 0, height, shape.tile);
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
    const door: Door = { wall, pivot, leaf, openness, goal: wall.closed ? 0 : 1, height };
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
    door.pivot.rotation.y = -leafHeading(door.wall, easeSwing(door.openness));
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
    return entry && hit.faceIndex != null ? entry.ids[Math.floor(hit.faceIndex / TRIANGLES_PER_BOX)] ?? null : null;
  }

  /** The side a door swings to, for its menu. */
  swing(id: string): 1 | -1 | null {
    const door = this.doors.get(id);
    return door ? swingSide(door.wall) : null;
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
