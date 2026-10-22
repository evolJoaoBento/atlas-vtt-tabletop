/**
 * The line round a die still to be thrown: its silhouette, and nothing inside it, as TacticalEngine draws the line round
 * a creature (the user's own engine, `faction-outline.ts`). Two meshes hang on the die and share one hull:
 *
 * - the mask, at `renderOrder -2`, drawn into the stencil buffer only (no colour, no depth), marking where the die is;
 * - the rim, at `renderOrder -1`, the hull's back faces pushed out along its normals, drawn only where the mask is not.
 *
 * So the line is round the die and never across its faces. The hull is the die's own geometry with its corners welded,
 * so the faces pushed apart stay joined (a bevelled die's split normals would tear the rim at every edge). The board's
 * renderer must have a stencil buffer.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** How far the rim stands out past the die, in die edges: a line, not a halo. */
export const DIE_OUTLINE_WIDTH = 0.07;
const STENCIL_REF = 1;
const RIM = 'die-outline';
const MASK = 'die-outline-mask';

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

const rims = new Map<string, THREE.MeshBasicMaterial>();
function rimMaterial(color: string): THREE.MeshBasicMaterial {
  let material = rims.get(color);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      side: THREE.BackSide,
      stencilWrite: true,
      stencilRef: STENCIL_REF,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    const push = DIE_OUTLINE_WIDTH.toFixed(4);
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n\ttransformed += normalize( normal ) * ${push};`);
    };
    material.customProgramCacheKey = () => `die-outline:${push}`;
    rims.set(color, material);
  }
  return material;
}

/** The die's geometry, corners welded and smooth normals worked out: a closed hull that pushes out without tearing. */
function hullOf(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const bare = new THREE.BufferGeometry();
  bare.setAttribute('position', geometry.getAttribute('position').clone());
  if (geometry.index) bare.setIndex(geometry.index.clone());
  const hull = mergeVertices(bare);
  hull.computeVertexNormals();
  return hull;
}

/** Puts the line (hidden) round a die, in `color`. Its hull goes with the die (`disposeOutline`). */
export function addOutline(die: THREE.Mesh, color: string): void {
  if (die.children.some((child) => child.name === RIM)) return;
  const hull = hullOf(die.geometry);
  for (const [name, material, order] of [[MASK, maskMaterial(), -2], [RIM, rimMaterial(color), -1]] as const) {
    const mesh = new THREE.Mesh(hull, material);
    mesh.name = name;
    mesh.renderOrder = order;
    mesh.visible = false;
    // Never a second shadow, and never what a click finds: the die is.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.raycast = () => {};
    die.add(mesh);
  }
}

/** Shows or hides the line round a die. */
export function showOutline(die: THREE.Mesh, visible: boolean): void {
  for (const child of die.children) if (child.name === RIM || child.name === MASK) child.visible = visible;
}

/** Whether the line round a die shows. */
export function outlineShown(die: THREE.Mesh): boolean {
  return die.children.some((child) => child.name === RIM && child.visible);
}

/** The die's hull goes with it (the materials are shared, and stay). */
export function disposeOutline(die: THREE.Mesh): void {
  const rim = die.children.find((child) => child.name === RIM) as THREE.Mesh | undefined;
  rim?.geometry.dispose();
}
