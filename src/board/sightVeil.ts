/**
 * The unseen squares of the board, drawn as dark blocks: the board is tiled by its grid squares and every square no token
 * that sees has in sight (lineOfSight.ts) is covered by a block as tall as the walls, so the floor, the walls and
 * everything standing there are not shown. Runs of squares along a row are one block, so a big map stays a few hundred
 * blocks. Unlit, so it reads as black from any side.
 */
import * as THREE from 'three';
import type { SightTiles } from './lineOfSight';

const COLOR = 0x070605;

export class SightVeil {
  readonly object3d = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: COLOR, side: THREE.DoubleSide }));
  private key = '';

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

  dispose(): void {
    this.object3d.geometry.dispose();
    (this.object3d.material as THREE.Material).dispose();
    this.object3d.removeFromParent();
  }
}
