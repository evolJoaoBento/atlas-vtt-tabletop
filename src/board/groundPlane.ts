/**
 * The plane to the horizon (`ground.ts`, horizon mode): a grid round the map, fine near the board and coarse far out,
 * level under the usable board and shaped by the noise pattern past its edge, tiled with a material of the gallery
 * (a tile a square) or plain ground. It lies a hair under the map, which is drawn on it.
 */
import * as THREE from 'three';
import type { LoadedMaterial } from '../materials';
import { groundHeight, REACH_SPANS, type GroundSettings } from './ground';

const PLAIN_GROUND = 0x5d6b45;
/** Grid lines across, each way. */
const SEGMENTS = 220;
/** How far under the map's floor it lies, in world units (so the map never fights it for the same depth). */
const SINK = 1;

export interface GroundArea {
  /** The map's size, in world units (its pixels). */
  width: number;
  height: number;
  /** World units to a grid square. */
  cell: number;
  /** The extra board round the map, in squares. */
  margin: number;
  /** How far out it runs from the map's middle, in world units (`planeReach`); unset, as far as it runs without fog. */
  reach?: number;
}

export class GroundPlane {
  readonly object3d: THREE.Mesh;
  /** World units to a square, for the colour drift (shared by both materials' shaders). */
  private readonly cell = { value: 1 };
  private readonly plain = naturalGround(new THREE.MeshStandardMaterial({ color: PLAIN_GROUND, roughness: 0.95, metalness: 0 }), this.cell);
  /** The ground's own copy of a gallery material (its maps shared, its shader its own: the walls are untouched). */
  private textured: THREE.MeshStandardMaterial | null = null;
  private folder: string | null = null;
  private key = '';

  constructor() {
    this.object3d = new THREE.Mesh(new THREE.BufferGeometry(), this.plain);
    this.object3d.name = 'ground';
    this.object3d.receiveShadow = true;
  }

  /**
   * Shapes it for the settings and the map; `read` loads a gallery material, and `loaded` is told when it is on (the
   * board draws again).
   */
  update(settings: GroundSettings, area: GroundArea, read: (folder: string) => Promise<LoadedMaterial | null>, loaded: () => void): void {
    this.cell.value = area.cell;
    const folder = settings.material ?? null;
    if (folder !== this.folder) {
      this.folder = folder;
      this.textured?.dispose();
      this.textured = null;
      this.object3d.material = this.plain;
      if (folder) {
        void read(folder).then((material) => {
          if (this.folder !== folder || !material) return;
          const made = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
          material.apply(made);
          this.textured = naturalGround(made, this.cell);
          this.object3d.material = this.textured;
          loaded();
        });
      }
    }
    const key = JSON.stringify([settings.noise, settings.strength, settings.margin, settings.tile, area.width, area.height, area.cell, area.reach ?? null]);
    if (key === this.key) return;
    this.key = key;
    this.object3d.geometry.dispose();
    this.object3d.geometry = groundGeometry(settings, area);
  }

  dispose(): void {
    this.object3d.geometry.dispose();
    this.plain.dispose();
    this.textured?.dispose();
    this.object3d.removeFromParent();
  }
}

/** GLSL: a value noise (0 to 1) and the texture read without its tiling showing (Inigo Quilez's "texture repetition"). */
const NO_TILE = `
float groundHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float groundNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(groundHash(i), groundHash(i + vec2(1.0, 0.0)), u.x), mix(groundHash(i + vec2(0.0, 1.0)), groundHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec4 textureNoTile(sampler2D samp, vec2 uv) {
  // A slow noise picks, place by place, which of a few shifted copies of the texture shows; neighbours blend.
  float k = groundNoise(uv * 0.35) * 8.0;
  float ia = floor(k), f = fract(k);
  vec2 offa = sin(vec2(3.0, 7.0) * ia), offb = sin(vec2(3.0, 7.0) * (ia + 1.0));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 a = textureGrad(samp, uv + offa, dx, dy), b = textureGrad(samp, uv + offb, dx, dy);
  return mix(a, b, smoothstep(0.2, 0.8, f));
}
`;

/** The chunks whose texture reads go through `textureNoTile`. */
const UNTILED: ReadonlyArray<[string, string]> = [
  ['map_fragment', 'map'], ['normal_fragment_maps', 'normalMap'], ['roughnessmap_fragment', 'roughnessMap'],
  ['aomap_fragment', 'aoMap'], ['metalnessmap_fragment', 'metalnessMap'],
];

/**
 * A ground material that looks less like tiles: every texture read is untiled (shifted copies blended by a slow
 * noise), and the colour drifts lighter and darker over tens of squares. Its own shader replaces any it had
 * (a gallery material's parallax: the ground needs none).
 */
export function naturalGround<T extends THREE.MeshStandardMaterial>(material: T, cell: { value: number }): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundCell = cell;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundAt;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundAt = (modelMatrix * vec4(transformed, 1.0)).xz;');
    let fragment = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec2 vGroundAt;\nuniform float uGroundCell;\n${NO_TILE}`);
    for (const [chunk, sampler] of UNTILED) {
      const code = (THREE.ShaderChunk as unknown as Record<string, string>)[chunk];
      if (!code) continue;
      fragment = fragment.replace(`#include <${chunk}>`, code.split(`texture2D( ${sampler},`).join(`textureNoTile( ${sampler},`));
    }
    // Slow patches of lighter and darker ground, by where it is (in squares): the same with any material or none.
    fragment = fragment.replace('#include <color_fragment>', `#include <color_fragment>
vec2 groundSq = vGroundAt / max(uGroundCell, 0.0001);
float groundPatch = groundNoise(groundSq * 0.03) * 0.65 + groundNoise(groundSq * 0.009 + 13.0) * 0.35;
diffuseColor.rgb *= mix(0.8, 1.14, groundPatch);`);
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => 'tabletop-ground';
  material.needsUpdate = true;
  return material;
}

/** The grid: lines bunched near the middle (u², so the board's surroundings are fine and the horizon coarse). */
export function groundGeometry(settings: GroundSettings, area: GroundArea): THREE.BufferGeometry {
  const { width, height, cell, margin } = area;
  const cx = width / 2, cz = height / 2;
  const reach = area.reach ?? Math.max(width, height) * REACH_SPANS;
  const flat = { x0: -margin, y0: -margin, x1: width / cell + margin, y1: height / cell + margin };
  const n = SEGMENTS + 1;
  const position = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  const along = (i: number): number => { const u = (i / SEGMENTS) * 2 - 1; return Math.sign(u) * u * u * reach; };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx + along(i), z = cz + along(j), k = j * n + i;
      const h = groundHeight(x / cell, z / cell, settings, flat);
      position.set([x, h * cell - SINK, z], k * 3);
      // In tiles: one tile a `tile` squares wide.
      uv.set([x / (cell * settings.tile), -z / (cell * settings.tile)], k * 2);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SEGMENTS; j++) {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      // Facing up (+y): seen from above, x right and z down the screen.
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
