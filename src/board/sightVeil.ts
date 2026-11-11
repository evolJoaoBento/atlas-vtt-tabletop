/**
 * The unseen squares of the board, drawn as dark blocks: the board is tiled by its grid squares and every square no token
 * that sees has in sight (lineOfSight.ts) is covered by a block as tall as the walls, so the floor, the walls and
 * everything standing there are not shown. Runs of squares along a row are one block, so a big map stays a few hundred
 * blocks. Unlit, so it reads as black from any side.
 */
import * as THREE from 'three';
import type { SightTiles } from './lineOfSight';
import type { Rooms, SightArea } from './sightRooms';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const COLOR = 0x070605;

export class SightVeil {
  readonly object3d = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLOR, side: THREE.DoubleSide }));
  private key = '';
  /** The rooms the last room veil was made for. */
  private rooms: Rooms | null = null;

  constructor() {
    this.object3d.name = 'sight-veil';
    this.object3d.visible = false;
    this.object3d.frustumCulled = false;
    this.object3d.castShadow = false;
    this.object3d.receiveShadow = false;
  }

  /** Takes every block away. */
  clear(): void {
    this.key = '';
    this.object3d.geometry.dispose();
    this.object3d.geometry = new THREE.BufferGeometry();
  }

  /** Covers every square `seen` marks 0 (null clears), as tall as `height`, within the map's `width` x `height`. */
  update(seen: Uint8Array | null, tiles: SightTiles, map: { width: number; height: number }, height: number): void {
    if (!seen) {
      this.clear();
      return;
    }
    const key = `${tiles.cols}x${tiles.rows}|${tiles.size}|${tiles.startX},${tiles.startY}|${map.width}x${map.height}|${height}|${seen.join('')}`;
    if (key === this.key) return;
    this.key = key;
    const positions: number[] = [];
    const quad = (a: number[], b: number[], c: number[], d: number[]): void => { positions.push(...a, ...b, ...c, ...a, ...c, ...d); };
    const { cols, rows, size, startX, startY } = tiles;
    for (let row = 0; row < rows; row++) {
      const z0 = Math.max(0, startY + row * size);
      const z1 = Math.min(map.height, startY + (row + 1) * size);
      if (z1 <= z0) continue;
      let col = 0;
      while (col < cols) {
        if (seen[row * cols + col]) { col++; continue; }
        let end = col;
        while (end + 1 < cols && !seen[row * cols + end + 1]) end++;
        const x0 = Math.max(0, startX + col * size);
        const x1 = Math.min(map.width, startX + (end + 1) * size);
        col = end + 1;
        if (x1 <= x0) continue;
        // Top and four sides (the bottom is never seen).
        quad([x0, height, z0], [x0, height, z1], [x1, height, z1], [x1, height, z0]);
        quad([x0, 0, z0], [x1, 0, z0], [x1, height, z0], [x0, height, z0]);
        quad([x1, 0, z1], [x0, 0, z1], [x0, height, z1], [x1, height, z1]);
        quad([x0, 0, z1], [x0, 0, z0], [x0, height, z0], [x0, height, z1]);
        quad([x1, 0, z0], [x1, 0, z1], [x1, height, z1], [x1, height, z0]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.object3d.geometry.dispose();
    this.object3d.geometry = geometry;
  }

  /**
   * Covers every room `seen` marks 0 (cinematic sight), its outline raised as tall as `height` and the buildings inside
   * it left open, so the veil follows the walls at any angle.
   */
  updateRooms(rooms: Rooms, seen: Uint8Array, height: number): void {
    const key = `rooms|${rooms.rooms.length}|${rooms.rooms[0]?.box.x0},${rooms.rooms[0]?.area}|${height}|${seen.join('')}`;
    if (key === this.key && this.rooms === rooms) return;
    this.key = key;
    this.rooms = rooms;
    this.raise(rooms.rooms.filter((_, index) => !seen[index]), height);
  }

  /** Covers every area given (what rays leave unseen), each raised as tall as `height` with its holes left open. */
  updateAreas(areas: readonly SightArea[], height: number): void {
    this.key = '';
    this.rooms = null;
    this.raise(areas, height);
  }

  /** The veil as the areas raised into blocks. */
  private raise(areas: readonly SightArea[], height: number): void {
    const parts: THREE.BufferGeometry[] = [];
    areas.forEach((room) => {
      if (room.outer.length < 3) return;
      // The shape lies in x, -y and is raised along z; turned, z is up and -y is the map's y.
      const shape = new THREE.Shape(room.outer.map((point) => new THREE.Vector2(point.x, -point.y)));
      for (const hole of room.holes) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, -point.y))));
      try {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 1, steps: 1 });
        geometry.rotateX(-Math.PI / 2);
        geometry.deleteAttribute('uv');
        geometry.deleteAttribute('normal');
        parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
      } catch {
        // A room whose outline would not triangulate is left unveiled rather than breaking the rest.
      }
    });
    const merged = parts.length > 0 ? mergeGeometries(parts) ?? new THREE.BufferGeometry() : new THREE.BufferGeometry();
    for (const part of parts) part.dispose();
    this.object3d.geometry.dispose();
    this.object3d.geometry = merged;
  }

  dispose(): void {
    this.object3d.geometry.dispose();
    (this.object3d.material as THREE.Material).dispose();
    this.object3d.removeFromParent();
  }
}
