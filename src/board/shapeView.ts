/**
 * The raised shapes of one level, drawn (`terrainShapes.ts`): a mesh per shape wearing the level's map image from
 * above, or a material of the gallery. Used by the board for the level it shows and by each elevation layer for its
 * own, so a shape takes its level's look (faded, hidden) with everything else standing on it.
 */
import * as THREE from 'three';
import { shapeGeometry, type TerrainShape } from './terrainShapes';

export interface ShapeLook {
  /** World units to a grid square. */
  cell: number;
  /** The level's map size, in its pixels. */
  width: number;
  height: number;
  /** The level's map image (null: none read yet). */
  image: THREE.Texture | null;
  /** The shared material of a gallery material's folder. */
  material(folder: string): THREE.Material;
}

const PLAIN = 0x8a8178;

export class ShapesView {
  readonly object3d = new THREE.Group();
  private readonly meshes = new Map<string, { key: string; mesh: THREE.Mesh }>();
  /** The level's map image, laid on from above (shared by every shape here that has no material). */
  private readonly imageMaterial = new THREE.MeshStandardMaterial({ color: PLAIN, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  /** Plain closed sides (no material named for them). */
  private readonly sideMaterial = new THREE.MeshStandardMaterial({ color: 0x9c9184, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });

  constructor() {
    this.object3d.name = 'shapes';
  }

  update(shapes: readonly TerrainShape[], look: ShapeLook): void {
    if (this.imageMaterial.map !== look.image) {
      this.imageMaterial.map = look.image;
      this.imageMaterial.color.set(look.image ? 0xffffff : PLAIN);
      this.imageMaterial.needsUpdate = true;
    }
    const wanted = new Set(shapes.map((shape) => shape.id));
    for (const [id, kept] of [...this.meshes]) {
      if (wanted.has(id)) continue;
      kept.mesh.removeFromParent();
      kept.mesh.geometry.dispose();
      this.meshes.delete(id);
    }
    for (const shape of shapes) {
      const key = JSON.stringify([shape.outline, shape.inner, shape.material ?? null, shape.sides ?? null, look.cell, look.width, look.height]);
      let kept = this.meshes.get(shape.id);
      if (!kept || kept.key !== key) {
        const geometry = shapeGeometry(shape, look.cell, look.width, look.height, shape.material !== undefined);
        if (kept) { kept.mesh.geometry.dispose(); kept.mesh.geometry = geometry; kept.key = key; }
        else {
          const mesh = new THREE.Mesh(geometry, this.imageMaterial);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.userData.shapeId = shape.id;
          kept = { key, mesh };
          this.meshes.set(shape.id, kept);
          this.object3d.add(mesh);
        }
      }
      const top = shape.material ? look.material(shape.material) : this.imageMaterial;
      const sides = typeof shape.sides === 'string' ? look.material(shape.sides) : this.sideMaterial;
      kept.mesh.material = [top, sides];
    }
  }

  /** The meshes, to be picked. */
  get pickables(): THREE.Object3D[] {
    return [...this.meshes.values()].map((kept) => kept.mesh);
  }

  dispose(): void {
    for (const kept of this.meshes.values()) kept.mesh.geometry.dispose();
    this.meshes.clear();
    this.imageMaterial.dispose();
    this.sideMaterial.dispose();
    this.object3d.removeFromParent();
  }
}
