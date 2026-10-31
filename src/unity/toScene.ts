/**
 * Makes a three.js model of a Unity model, and a GLB of that. Unity is left-handed with pictures stored bottom row first:
 * the mesh is placed by its matrix, mirrored across x with its triangles turned round, and each picture is turned right
 * side up with its v coordinate flipped to match. Unity's metallic/smoothness and occlusion maps are repacked into the
 * one picture glTF reads (occlusion red, roughness green, metalness blue).
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { DecodedMesh } from './mesh';
import type { UnityMaterial, UnityModel } from './model';
import type { DecodedTexture } from './texture';

type Pixels = { width: number; height: number; rgba: Uint8Array };

function flipRows(texture: Pixels): Uint8Array {
  const row = texture.width * 4;
  const out = new Uint8Array(texture.rgba.length);
  for (let y = 0; y < texture.height; y++) out.set(texture.rgba.subarray(y * row, (y + 1) * row), (texture.height - 1 - y) * row);
  return out;
}

/** A picture three.js can draw and the glTF exporter can write: a canvas holding the pixels. */
function dataTexture(pixels: Pixels, srgb: boolean): THREE.CanvasTexture {
  const canvas = new OffscreenCanvas(pixels.width, pixels.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('this device cannot draw the pictures of the model.');
  context.putImageData(new ImageData(new Uint8ClampedArray(flipRows(pixels)), pixels.width, pixels.height), 0, 0);
  const texture = new THREE.CanvasTexture(canvas as unknown as HTMLCanvasElement);
  texture.flipY = false;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Unity packs a tangent-space normal map's x in alpha and y in green (DXT5nm); three reads x, y and z from colour. */
function unpackNormals(map: DecodedTexture): Pixels {
  if (map.format !== 12) return map;
  const out = new Uint8Array(map.rgba.length);
  for (let i = 0; i < out.length; i += 4) {
    const x = (map.rgba[i + 3] / 255) * 2 - 1;
    const y = (map.rgba[i + 1] / 255) * 2 - 1;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    out[i] = Math.round((x * 0.5 + 0.5) * 255);
    out[i + 1] = map.rgba[i + 1];
    out[i + 2] = Math.round((z * 0.5 + 0.5) * 255);
    out[i + 3] = 255;
  }
  return { width: map.width, height: map.height, rgba: out };
}

/** Occlusion in red, roughness in green, metalness in blue; null when the material has no maps for them. */
function packOrm(material: UnityMaterial): Pixels | null {
  const { occlusion, metallicGloss } = material;
  if (!occlusion && !metallicGloss) return null;
  const width = Math.max(occlusion?.width ?? 1, metallicGloss?.width ?? 1);
  const height = Math.max(occlusion?.height ?? 1, metallicGloss?.height ?? 1);
  const out = new Uint8Array(width * height * 4);
  const at = (map: DecodedTexture, x: number, y: number): number => (Math.min(map.height - 1, Math.floor((y * map.height) / height)) * map.width + Math.min(map.width - 1, Math.floor((x * map.width) / width))) * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = occlusion ? Math.round(255 * (1 - material.occlusionStrength + material.occlusionStrength * (occlusion.rgba[at(occlusion, x, y)] / 255))) : 255;
      if (metallicGloss) {
        const i = at(metallicGloss, x, y);
        out[o + 1] = Math.round(255 * (1 - (metallicGloss.rgba[i + 3] / 255) * material.glossMapScale));
        out[o + 2] = metallicGloss.rgba[i];
      } else {
        out[o + 1] = Math.round(255 * (1 - material.glossiness));
        out[o + 2] = Math.round(255 * material.metallic);
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, rgba: out };
}

function isBlack(map: DecodedTexture): boolean {
  for (let i = 0; i < map.rgba.length; i += 4) if (map.rgba[i] | map.rgba[i + 1] | map.rgba[i + 2]) return false;
  return true;
}

function makeMaterial(unity: UnityMaterial | null, name: string): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ name, color: 0xffffff, roughness: 0.8, metalness: 0 });
  if (!unity) return material;
  material.color.setRGB(unity.color[0], unity.color[1], unity.color[2], THREE.LinearSRGBColorSpace);
  material.roughness = 1 - unity.glossiness;
  material.metalness = unity.metallic;
  if (unity.diffuse) material.map = dataTexture(unity.diffuse, true);
  if (unity.normal) {
    material.normalMap = dataTexture(unpackNormals(unity.normal), false);
    material.normalScale.set(unity.bumpScale, unity.bumpScale);
  }
  const orm = packOrm(unity);
  if (orm) {
    const texture = dataTexture(orm, false);
    if (unity.occlusion) {
      material.aoMap = texture;
      material.aoMapIntensity = 1;
    }
    material.roughnessMap = texture;
    material.metalnessMap = texture;
    material.roughness = 1;
    material.metalness = 1;
  }
  if (unity.emission && !isBlack(unity.emission)) {
    material.emissiveMap = dataTexture(unity.emission, true);
    material.emissive.setRGB(unity.emissionColor[0], unity.emissionColor[1], unity.emissionColor[2], THREE.LinearSRGBColorSpace);
    if (unity.emissionColor.every((channel) => channel === 0)) material.emissive.setRGB(1, 1, 1);
  }
  return material;
}

function makeGeometry(mesh: DecodedMesh, matrix: readonly number[]): THREE.BufferGeometry {
  const world = new THREE.Matrix4().fromArray(matrix as number[]);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(world);
  const count = mesh.positions.length / 3;
  const positions = new Float32Array(count * 3);
  const normals = mesh.normals ? new Float32Array(count * 3) : null;
  const point = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    point.set(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]).applyMatrix4(world);
    positions.set([-point.x, point.y, point.z], i * 3);
    if (normals && mesh.normals) {
      point.set(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]).applyMatrix3(normalMatrix).normalize();
      normals.set([-point.x, point.y, point.z], i * 3);
    }
  }
  const indices = Uint32Array.from(mesh.indices);
  // Mirroring turns every triangle inside out; swapping two corners turns it back.
  for (let i = 0; i < indices.length; i += 3) {
    const swap = indices[i + 1];
    indices[i + 1] = indices[i + 2];
    indices[i + 2] = swap;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (normals) geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (mesh.uvs) {
    const uvs = new Float32Array(mesh.uvs.length);
    for (let i = 0; i < uvs.length; i += 2) {
      uvs[i] = mesh.uvs[i];
      uvs[i + 1] = 1 - mesh.uvs[i + 1];
    }
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  if (!normals) geometry.computeVertexNormals();
  return geometry;
}

/** The model as three.js objects, one mesh per part, with a material for each sub-mesh that holds triangles. */
export function unityToScene(model: UnityModel): THREE.Group {
  const group = new THREE.Group();
  group.name = model.name || 'mini';
  model.parts.forEach((part, partIndex) => {
    const geometry = makeGeometry(part.mesh, part.matrix);
    const materials: THREE.Material[] = [];
    for (const range of part.mesh.groups) {
      const material = makeMaterial(part.materials[range.submesh] ?? part.materials[0] ?? null, `material ${partIndex + 1}.${range.submesh + 1}`);
      geometry.addGroup(range.start, range.count, materials.push(material) - 1);
    }
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.name = `part ${partIndex + 1}`;
    group.add(mesh);
  });
  return group;
}

/** A self-contained binary glTF of the model. */
export async function unityToGlb(model: UnityModel): Promise<ArrayBuffer> {
  const result = await new GLTFExporter().parseAsync(unityToScene(model), { binary: true, onlyVisible: false });
  if (!(result instanceof ArrayBuffer)) throw new Error('the model could not be converted.');
  return result;
}
