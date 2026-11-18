/**
 * The props of a painted background, as the board draws them. Near the map each prop is a copy of its model, made with
 * instancing (one draw call for every copy of one part of a model). Far from the map each prop is a flat picture of its
 * model on two crossed cards, also instanced, so tens of thousands cost little. The models, their geometry and their
 * pictures belong to the board and are shared; the forest only owns the instancing it builds on top of them.
 */
import * as THREE from 'three';
import type { LoadedMini } from '../library';
import { SINK } from '../board/groundPlane';
import type { PropBrush } from './backgroundData';
import type { ScatteredProp } from './propScatter';

/** A prop at scale 1 fills this share of a cell (a prop of the gallery and a painted prop alike). */
export const PROP_FILL = 0.9;

/** How far above the ground plane a prop stands, in world units, so its foot does not sink through a coarse triangle. */
const HAIR = 0.1;

/** The side of the square picture taken of a model, in model units: its widest side or its height, a little roomy. */
export function impostorSpan(model: LoadedMini): number {
  return Math.max(model.footprint, model.height) * 1.05;
}

/** Two crossed upright cards, each one unit wide and tall, standing on y = 0 and centred on x = z = 0. */
function crossedCards(): THREE.BufferGeometry {
  const position = new Float32Array([
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ]);
  const normal = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return geometry;
}

/** One part of a model: its geometry and material (shared), and where it sits in the model. */
interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  /** The part's matrix in the model, with the model root's own offset in it (but not its scale). */
  matrix: THREE.Matrix4;
}

/** The parts of a model, found once. */
function partsOf(model: LoadedMini): Part[] {
  const root = model.scene;
  root.updateWorldMatrix(true, true);
  // The model is drawn at a scale of its own, so the root's scale does not count; its position and turn do.
  const rootMatrix = new THREE.Matrix4().compose(root.position, root.quaternion, new THREE.Vector3(1, 1, 1));
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts: Part[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push({ geometry: mesh.geometry, material: mesh.material, matrix: new THREE.Matrix4().multiplyMatrices(rootMatrix, new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld)) });
  });
  return parts;
}

export class PropForest {
  readonly object3d = new THREE.Group();
  /** How many props stand near (full models) and far (flat pictures). */
  readonly counts = { models: 0, impostors: 0 };
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly cards: THREE.BufferGeometry;
  private readonly materials: THREE.Material[] = [];

  /**
   * `models` and `impostors` are by the model's vault path (what the brushes list); a placement whose model or picture
   * is missing is skipped. `heightAt` gives the ground's height in squares at a spot in squares; `cell` is the world
   * units to a square.
   */
  constructor(
    models: ReadonlyMap<string, LoadedMini>,
    placements: readonly ScatteredProp[],
    brushes: readonly PropBrush[],
    heightAt: (x: number, y: number) => number,
    cell: number,
    impostors: ReadonlyMap<string, THREE.Texture>,
  ) {
    this.object3d.name = 'painted-props';
    this.cards = crossedCards();
    // The placements by model: near ones and far ones.
    const near = new Map<string, ScatteredProp[]>(), far = new Map<string, ScatteredProp[]>();
    for (const placement of placements) {
      const path = brushes[placement.brush]?.props[placement.prop];
      if (path === undefined || !models.has(path)) continue;
      if (placement.far && !impostors.has(path)) continue;
      const list = placement.far ? far : near;
      const found = list.get(path);
      if (found) found.push(placement); else list.set(path, [placement]);
    }
    const spot = new THREE.Matrix4(), turn = new THREE.Matrix4(), size = new THREE.Matrix4(), base = new THREE.Matrix4(), out = new THREE.Matrix4();
    const place = (p: ScatteredProp, unit: number, into: THREE.Matrix4): void => {
      spot.makeTranslation(p.x * cell, heightAt(p.x, p.y) * cell - SINK + HAIR, p.y * cell);
      turn.makeRotationY(p.turn);
      size.makeScale(unit, unit, unit);
      into.multiplyMatrices(spot, base.multiplyMatrices(turn, size));
    };

    for (const [path, list] of near) {
      const model = models.get(path)!;
      const unit = cell * PROP_FILL / model.footprint;
      for (const part of partsOf(model)) {
        const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((p, i) => {
          place(p, unit * p.scale, out);
          mesh.setMatrixAt(i, out.multiply(part.matrix));
        });
        this.add(mesh, true);
      }
      this.counts.models += list.length;
    }

    for (const [path, list] of far) {
      const model = models.get(path)!;
      // The picture is one square of side `impostorSpan` model units; the cards are one unit across.
      const unit = cell * PROP_FILL / model.footprint * impostorSpan(model);
      const material = new THREE.MeshStandardMaterial({ map: impostors.get(path)!, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false, roughness: 1, metalness: 0 });
      this.materials.push(material);
      const mesh = new THREE.InstancedMesh(this.cards, material, list.length);
      list.forEach((p, i) => {
        place(p, unit * p.scale, out);
        mesh.setMatrixAt(i, out);
      });
      this.add(mesh, false);
      this.counts.impostors += list.length;
    }
  }

  private add(mesh: THREE.InstancedMesh, receive: boolean): void {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    mesh.receiveShadow = receive;
    // The copies are spread over the whole plane: one box would never fit them.
    mesh.frustumCulled = false;
    // Nobody picks a tree: skip walking thousands of copies for a ray.
    mesh.raycast = () => {};
    this.meshes.push(mesh);
    this.object3d.add(mesh);
  }

  /** Frees the instancing and what the forest made; the models' geometry, materials and pictures are the board's. */
  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    this.meshes.length = 0;
    this.cards.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
    this.object3d.removeFromParent();
  }
}
