/**
 * Thins a heavy model down to a triangle budget when it is read, so a 300k-triangle mini draws about as fast as a
 * game-ready one. Only each mesh's list of triangles is rewritten (meshoptimizer's simplifier, which keeps UV and
 * normal seams closed); every vertex stays, so skinning, morphs and animation keep working. The GLB file is never
 * changed.
 */
import { MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** How much detail the simplifier may give up to reach the budget: any, it picks the least visible collapses first. */
const MAX_ERROR = 1;

/** The model's triangles, over all its meshes. */
export function triangleCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    count += (geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0) / 3;
  });
  return Math.round(count);
}

function positionsOf(geometry: THREE.BufferGeometry): Float32Array {
  const position = geometry.attributes.position;
  const out = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    out[i * 3] = position.getX(i);
    out[i * 3 + 1] = position.getY(i);
    out[i * 3 + 2] = position.getZ(i);
  }
  return out;
}

/** Simplifies one geometry in place to `ratio` of its triangles, group by group so each material keeps its own. */
function simplifyGeometry(geometry: THREE.BufferGeometry, ratio: number): void {
  const index = geometry.index!;
  const source = Uint32Array.from(index.array as ArrayLike<number>);
  const positions = positionsOf(geometry);
  const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: source.length, materialIndex: 0 }];
  const parts: Uint32Array[] = [];
  const kept: Array<{ start: number; count: number; materialIndex?: number }> = [];
  let start = 0;
  for (const group of groups) {
    const count = Math.min(group.count, source.length - group.start);
    const slice = source.subarray(group.start, group.start + count);
    const target = Math.max(3, Math.floor((count * ratio) / 3) * 3);
    const [indices] = count > target ? MeshoptSimplifier.simplify(slice, positions, 3, target, MAX_ERROR) : [slice];
    parts.push(indices);
    kept.push({ start, count: indices.length, materialIndex: group.materialIndex });
    start += indices.length;
  }
  const merged = new Uint32Array(start);
  let at = 0;
  for (const part of parts) { merged.set(part, at); at += part.length; }
  geometry.setIndex(new THREE.BufferAttribute(merged, 1));
  if (geometry.groups.length > 0) {
    geometry.clearGroups();
    for (const group of kept) geometry.addGroup(group.start, group.count, group.materialIndex);
  }
}

/**
 * Brings `root` down to about `budget` triangles, spread over its meshes in proportion. A model within the budget is
 * left alone. Returns the counts before and after.
 */
export async function simplifyModel(root: THREE.Object3D, budget: number): Promise<{ before: number; after: number }> {
  const before = triangleCount(root);
  if (before <= budget) return { before, after: before };
  await MeshoptSimplifier.ready;
  const ratio = budget / before;
  const done = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
    // A geometry shared by several meshes is simplified once.
    if (done.has(mesh.geometry)) return;
    if (!mesh.geometry.index) {
      const indexed = mergeVertices(mesh.geometry);
      mesh.geometry.dispose();
      mesh.geometry = indexed;
    }
    done.add(mesh.geometry);
    simplifyGeometry(mesh.geometry, ratio);
  });
  return { before, after: triangleCount(root) };
}
