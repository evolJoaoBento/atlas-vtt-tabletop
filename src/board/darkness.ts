/**
 * The darkness of a lit scene as a Connect player has it: where the GM's lighting lets players see nothing, the ground
 * is black. Connect sends it as fog (`sceneAdapter.ts` sets it apart); it is laid flat just over the map, under the
 * tokens, rather than stood up as the fog's solid wall.
 */
import * as THREE from 'three';
import { fogAreas, type FogOperation } from './fog';

/** Just over the map and its grid, under everything standing on it. */
const LIFT = 0.6;

export class DarknessLayer {
  readonly object3d = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, depthWrite: false });
  private key = '';

  constructor() {
    this.object3d.name = 'darkness';
    this.object3d.renderOrder = 1;
  }

  update(operations: readonly FogOperation[]): void {
    const key = JSON.stringify(operations);
    if (key === this.key) return;
    this.key = key;
    this.clear();
    for (const area of fogAreas(operations)) {
      if (area.outer.length < 3) continue;
      const shape = new THREE.Shape(area.outer.map((point) => new THREE.Vector2(point.x, point.y)));
      for (const hole of area.holes) if (hole.length >= 3) shape.holes.push(new THREE.Path(hole.map((point) => new THREE.Vector2(point.x, point.y))));
      // The shape is drawn in the map's x/y: turned flat so y runs along the board's z.
      const geometry = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.y = LIFT;
      mesh.renderOrder = 1;
      this.object3d.add(mesh);
    }
  }

  /** Whether any part of the map is dark. */
  get dark(): boolean {
    return this.object3d.children.length > 0;
  }

  private clear(): void {
    for (const child of [...this.object3d.children]) {
      (child as THREE.Mesh).geometry.dispose();
      this.object3d.remove(child);
    }
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
  }
}
