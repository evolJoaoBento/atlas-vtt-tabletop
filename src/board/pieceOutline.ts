/**
 * The line round a token, a mini or a prop a spell hits: the dice's line (`dieOutline.ts`) round every mesh of the
 * piece, red. The silhouette goes into the stencil buffer, and each mesh's hull, pushed out along its normals, is drawn
 * only outside it, so the line runs round the piece and never across it. An animated mini's hull is skinned to the same
 * skeleton, so the line moves with it. Hulls are kept per geometry; `PieceOutline.dispose` takes the line away.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const STENCIL_REF = 1;
const RIM = 'piece-outline';
const MASK = 'piece-outline-mask';

let mask: THREE.MeshBasicMaterial | undefined;
function maskMaterial(): THREE.MeshBasicMaterial {
  mask ??= new THREE.MeshBasicMaterial({
    colorWrite: false,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    stencilWrite: true,
    stencilRef: STENCIL_REF,
    stencilFunc: THREE.AlwaysStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,
  });
  return mask;
}

/** A rim pushed out `push` of its own units: its own material (each mesh's scale differs). */
function rimMaterial(color: string, push: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.BackSide,
    stencilWrite: true,
    stencilRef: STENCIL_REF,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
    stencilZPass: THREE.KeepStencilOp,
  });
  const uniform = { value: push };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.outlinePush = uniform;
    shader.vertexShader = `uniform float outlinePush;\n${shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normalize( normal ) * outlinePush;')}`;
  };
  material.customProgramCacheKey = () => 'piece-outline';
  return material;
}

const hulls = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** The geometry with its corners welded and smooth normals: a hull that pushes out without tearing (skinning kept). */
function hullOf(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  let hull = hulls.get(geometry);
  if (hull) return hull;
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position').clone());
  for (const name of ['skinIndex', 'skinWeight']) {
    const attribute = geometry.getAttribute(name);
    if (attribute) bare.setAttribute(name, attribute.clone());
  }
  if (geometry.index) bare.setIndex(geometry.index.clone());
  hull = mergeVertices(bare);
  hull.computeVertexNormals();
  hulls.set(geometry, hull);
  return hull;
}

/** Whether a mesh is part of what the piece shows (not its invisible hit column, a line of its own, a sprite). */
function drawn(mesh: THREE.Mesh): boolean {
  if (mesh.name === RIM || mesh.name === MASK || mesh.name.startsWith('die-outline')) return false;
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  if (materials.every((material) => material.visible === false)) return false;
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
  return mesh.geometry.getAttribute('position') !== undefined;
}

export class PieceOutline {
  private readonly added: THREE.Mesh[] = [];
  private readonly materials: THREE.Material[] = [];

  /** Puts a `width` (board units) line in `color` round every mesh of `root` that shows. */
  constructor(readonly root: THREE.Object3D, color: string, width: number) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => { if ((node as THREE.Mesh).isMesh && drawn(node as THREE.Mesh)) meshes.push(node as THREE.Mesh); });
    root.updateWorldMatrix(true, true);
    for (const mesh of meshes) {
      const scale = mesh.getWorldScale(new THREE.Vector3());
      const push = width / Math.max(1e-6, (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3);
      const hull = hullOf(mesh.geometry);
      const rim = rimMaterial(color, push);
      this.materials.push(rim);
      for (const [name, material, order] of [[MASK, maskMaterial(), -2], [RIM, rim, -1]] as const) {
        const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? mesh as THREE.SkinnedMesh : null;
        let line: THREE.Mesh;
        if (skinned && hull.getAttribute('skinIndex')) {
          const copy = new THREE.SkinnedMesh(hull, material);
          copy.bind(skinned.skeleton, skinned.bindMatrix);
          copy.bindMode = skinned.bindMode;
          line = copy;
        } else {
          line = new THREE.Mesh(hull, material);
        }
        line.name = name;
        line.renderOrder = order;
        line.castShadow = false;
        line.receiveShadow = false;
        line.frustumCulled = false;
        line.raycast = () => {};
        line.userData.noOutline = true;
        mesh.add(line);
        this.added.push(line);
      }
    }
  }

  dispose(): void {
    for (const line of this.added) line.removeFromParent();
    this.added.length = 0;
    for (const material of this.materials) material.dispose();
    this.materials.length = 0;
  }
}
