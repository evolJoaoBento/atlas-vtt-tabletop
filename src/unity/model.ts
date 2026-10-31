/**
 * Reads the model out of a Unity asset bundle (HeroForge's Unity3D export): each mesh with the matrix that places it in
 * the scene and its materials with their pictures. Plain data in Unity's space; `toScene.ts` makes it a three.js model.
 * Skeletons and animations are not read: a figure stands in the pose it was exported in.
 */
import { readBundle, type BundleFile } from './bundle';
import { decodeMesh, type DecodedMesh, type ResourceReader } from './mesh';
import { CLASS, SerializedFile, type Record, type SerializedObject, type Value } from './serialized';
import { decodeTexture, type DecodedTexture } from './texture';

export interface UnityMaterial {
  readonly color: readonly [number, number, number, number];
  readonly emissionColor: readonly [number, number, number];
  readonly metallic: number;
  readonly glossiness: number;
  readonly glossMapScale: number;
  readonly bumpScale: number;
  readonly occlusionStrength: number;
  readonly diffuse: DecodedTexture | null;
  readonly normal: DecodedTexture | null;
  readonly metallicGloss: DecodedTexture | null;
  readonly occlusion: DecodedTexture | null;
  readonly emission: DecodedTexture | null;
}

export interface UnityPart {
  readonly mesh: DecodedMesh;
  /** Column-major 4×4, placing the mesh in the scene (Unity's left-handed space). */
  readonly matrix: readonly number[];
  /** One for each sub-mesh of the mesh, by index; null where the renderer has none. */
  readonly materials: ReadonlyArray<UnityMaterial | null>;
}

export interface UnityModel {
  readonly name: string;
  readonly parts: UnityPart[];
}

export const MAX_TEXTURE_SIZE = 1024;

const isRecord = (value: Value | undefined): value is Record => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
const asRecord = (value: Value | undefined): Record => (isRecord(value) ? value : {});
const asList = (value: Value | undefined): Value[] => (Array.isArray(value) ? value : []);
const numberOr = (value: Value | undefined, fallback: number): number => (typeof value === 'number' ? value : fallback);

/** A reference to an object of the same file: its id as text, or null when it points nowhere or to another file. */
function ref(value: Value | undefined): string | null {
  const pointer = asRecord(value);
  const id = pointer.m_PathID;
  if (numberOr(pointer.m_FileID, 0) !== 0 || id === undefined || id === 0 || id === '0') return null;
  return String(id);
}

type Matrix = number[];

function multiply(a: readonly number[], b: readonly number[]): Matrix {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}

/** Translation × rotation (a quaternion) × scale. */
function compose(position: Record, rotation: Record, scale: Record): Matrix {
  const x = numberOr(rotation.x, 0);
  const y = numberOr(rotation.y, 0);
  const z = numberOr(rotation.z, 0);
  const w = numberOr(rotation.w, 1);
  const length = Math.hypot(x, y, z, w) || 1;
  const [qx, qy, qz, qw] = [x / length, y / length, z / length, w / length];
  const sx = numberOr(scale.x, 1);
  const sy = numberOr(scale.y, 1);
  const sz = numberOr(scale.z, 1);
  return [
    (1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
    2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
    2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0,
    numberOr(position.x, 0), numberOr(position.y, 0), numberOr(position.z, 0), 1,
  ];
}

export function readUnityModel(data: Uint8Array, maxTexture = MAX_TEXTURE_SIZE): UnityModel {
  const files = readBundle(data);
  const main = files.find((file: BundleFile) => !/\.(resS|resource)$/i.test(file.path));
  if (!main) throw new Error('the bundle holds no scene.');
  const serialized = new SerializedFile(main.data);
  const byId = new Map<string, SerializedObject>();
  for (const object of serialized.objects) byId.set(object.pathId, object);
  const cache = new Map<string, Record>();
  const read = (id: string | null, classId: number): Record | null => {
    const object = id === null ? undefined : byId.get(id);
    if (!object || object.classId !== classId) return null;
    let found = cache.get(id!);
    if (!found) {
      found = serialized.read(object);
      cache.set(id!, found);
    }
    return found;
  };

  const resource: ResourceReader = (path, offset, size) => {
    const name = path.split('/').pop() ?? path;
    const file = files.find((entry) => entry.path === name || entry.path.endsWith(`/${name}`));
    if (!file) throw new Error('the bundle is missing a data file it refers to.');
    if (offset < 0 || offset + size > file.data.length) throw new Error('the bundle is damaged.');
    return file.data.subarray(offset, offset + size);
  };

  const textures = new Map<string, DecodedTexture | null>();
  const textureOf = (value: Value | undefined): DecodedTexture | null => {
    const id = ref(asRecord(value).m_Texture);
    if (id === null) return null;
    if (!textures.has(id)) {
      const texture = read(id, CLASS.Texture2D);
      textures.set(id, texture ? decodeTexture(texture, resource, maxTexture) : null);
    }
    return textures.get(id) ?? null;
  };

  const materials = new Map<string, UnityMaterial>();
  const materialOf = (id: string | null): UnityMaterial | null => {
    if (id === null) return null;
    const cached = materials.get(id);
    if (cached) return cached;
    const material = read(id, CLASS.Material);
    if (!material) return null;
    const saved = asRecord(material.m_SavedProperties);
    const named = (list: Value | undefined): Map<string, Value> => new Map(asList(list).map((entry) => [String(asRecord(entry).first), asRecord(entry).second as Value]));
    const slots = named(saved.m_TexEnvs);
    const floats = named(saved.m_Floats);
    const colours = named(saved.m_Colors);
    const colour = (key: string, fallback: number[]): number[] => {
      const c = asRecord(colours.get(key));
      return c.r === undefined ? fallback : [numberOr(c.r, 1), numberOr(c.g, 1), numberOr(c.b, 1), numberOr(c.a, 1)];
    };
    const base = colour('_Color', [1, 1, 1, 1]);
    const emission = colour('_EmissionColor', [0, 0, 0, 1]);
    const made: UnityMaterial = {
      color: [base[0], base[1], base[2], base[3]],
      emissionColor: [emission[0], emission[1], emission[2]],
      metallic: numberOr(floats.get('_Metallic'), 0),
      glossiness: numberOr(floats.get('_Glossiness'), 0.5),
      glossMapScale: numberOr(floats.get('_GlossMapScale'), 1),
      bumpScale: numberOr(floats.get('_BumpScale'), 1),
      occlusionStrength: numberOr(floats.get('_OcclusionStrength'), 1),
      diffuse: textureOf(slots.get('_MainTex')),
      normal: textureOf(slots.get('_BumpMap')),
      metallicGloss: textureOf(slots.get('_MetallicGlossMap')),
      occlusion: textureOf(slots.get('_OcclusionMap')),
      emission: textureOf(slots.get('_EmissionMap')),
    };
    materials.set(id, made);
    return made;
  };

  // Where each game object stands: its own transform, then its parents', up to the root.
  const transformOf = (gameObject: Record): { id: string; record: Record } | null => {
    for (const entry of asList(gameObject.m_Component)) {
      const id = ref(asRecord(entry).component);
      const record = read(id, CLASS.Transform);
      if (id !== null && record) return { id, record };
    }
    return null;
  };
  const worldOf = (transformId: string): Matrix => {
    let matrix: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const seen = new Set<string>();
    for (let id: string | null = transformId; id !== null && !seen.has(id);) {
      seen.add(id);
      const transform = read(id, CLASS.Transform);
      if (!transform) break;
      matrix = multiply(compose(asRecord(transform.m_LocalPosition), asRecord(transform.m_LocalRotation), asRecord(transform.m_LocalScale)), matrix);
      id = ref(transform.m_Father);
    }
    return matrix;
  };
  const active = (gameObject: Record): boolean => gameObject.m_IsActive !== false;

  const parts: UnityPart[] = [];
  const meshes = new Map<string, DecodedMesh>();
  const add = (gameObject: Record, meshId: string | null, renderer: Record): void => {
    const mesh0 = read(meshId, CLASS.Mesh);
    const transform = transformOf(gameObject);
    if (!mesh0 || !transform || !active(gameObject) || renderer.m_Enabled === false) return;
    let mesh = meshes.get(meshId!);
    if (!mesh) {
      mesh = decodeMesh(mesh0, resource, serialized.version);
      meshes.set(meshId!, mesh);
    }
    parts.push({ mesh, matrix: worldOf(transform.id), materials: asList(renderer.m_Materials).map((entry) => materialOf(ref(entry))) });
  };
  for (const object of serialized.objects) {
    if (object.classId === CLASS.MeshFilter) {
      const filter = serialized.read(object);
      const gameObject = read(ref(filter.m_GameObject), CLASS.GameObject);
      if (!gameObject) continue;
      for (const entry of asList(gameObject.m_Component)) {
        const renderer = read(ref(asRecord(entry).component), CLASS.MeshRenderer);
        if (renderer) add(gameObject, ref(filter.m_Mesh), renderer);
      }
    } else if (object.classId === CLASS.SkinnedMeshRenderer) {
      const renderer = serialized.read(object);
      const gameObject = read(ref(renderer.m_GameObject), CLASS.GameObject);
      if (gameObject) add(gameObject, ref(renderer.m_Mesh), renderer);
    }
  }
  if (parts.length === 0) throw new Error('the bundle holds no mesh to show.');
  const root = [...byId.values()].find((object) => object.classId === 142);
  const name = root ? String(serialized.read(root).m_Name ?? '') : '';
  return { name, parts };
}
