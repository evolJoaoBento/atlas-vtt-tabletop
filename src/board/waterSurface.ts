/**
 * The painted water on the board: one sheet over the map's floor, drawn only where the mask has water. It is a
 * physical, see-through material: the ground under it is seen refracted through the moving surface (three's
 * transmission pass), tinted by the water's colour more the deeper it is (further from the shore), with caustics
 * dancing on it; the surface catches the sun's and Atlas's lights as glints and reflects the sky at grazing angles, and
 * foam gathers on the shore. How clear it is, its tint and its motion are the map's one setting (src/board/water.ts), so
 * all of the map's water looks and moves alike.
 */
import * as THREE from 'three';
import { WATER_MOTION_KINDS, type WaterMask, type WaterMotion } from './water';

/** Just above the floor, under walls, props and tokens. */
const LIFT = 0.08;

const SHADER_HEAD = /* glsl */ `
uniform sampler2D uWaterMask;
uniform float uWaterTime;
uniform float uWaterAmount;
uniform int uWaterKind;
uniform vec2 uWaterDir;
uniform vec2 uWaterCells;
uniform vec3 uWaterTint;
uniform float uWaterClarity;
uniform float uWaterBlur;
float waterHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float waterNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(waterHash(i), waterHash(i + vec2(1.0, 0.0)), u.x), mix(waterHash(i + vec2(0.0, 1.0)), waterHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
/** Noise drifting through a few octaves, each its own way: a lively, non-repeating surface. */
float waterFbm(vec2 p, vec2 drift, float s) {
  float sum = 0.0;
  float weight = 0.5;
  mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    sum += weight * (waterNoise(p + drift * s) * 2.0 - 1.0);
    p = turn * p * 2.03;
    drift = turn * drift * 1.3;
    weight *= 0.5;
  }
  return sum;
}
/** A travelling wave train along a direction (sharpened crests, as real swell has). */
float waterSwell(vec2 p, vec2 dir, float length, float s) {
  float k = 6.2831 / length;
  float phase = dot(p, dir) * k - s * sqrt(9.8 * k) * 0.6;
  return pow(0.5 + 0.5 * sin(phase), 2.0) * 2.0 - 1.0;
}
/** The water's surface height at a point (in grid cells), about -1 to 1, for the map's motion. */
float waterHeight(vec2 p, float t) {
  float speed = 0.2 + uWaterAmount * 1.4;
  float s = t * speed;
  if (uWaterKind == 0) return waterFbm(p * 0.9, vec2(0.05, 0.03), t) * 0.5;
  if (uWaterKind == 2) {
    vec2 along = uWaterDir;
    vec2 across = vec2(-along.y, along.x);
    vec2 q = vec2(dot(p, along) * 0.7 - s * 1.6, dot(p, across) * 1.9);
    return waterFbm(q, vec2(-0.2, 0.1), s) * 0.8 + waterFbm(p * 2.4, vec2(0.3, -0.25), s) * 0.25;
  }
  if (uWaterKind == 3) {
    vec2 d1 = uWaterDir;
    vec2 d2 = normalize(d1 + vec2(-d1.y, d1.x) * 0.35);
    vec2 d3 = normalize(d1 - vec2(-d1.y, d1.x) * 0.5);
    float swell = waterSwell(p, d1, 3.2, s) * 0.5 + waterSwell(p, d2, 2.1, s) * 0.28 + waterSwell(p, d3, 1.3, s) * 0.17;
    return swell * 0.8 + waterFbm(p * 1.6, vec2(0.2, 0.15), s) * 0.3;
  }
  return waterFbm(p * 1.1, vec2(0.31, 0.23), s) * 0.65 + waterFbm(p * 2.3 + 7.1, vec2(-0.22, 0.37), s) * 0.35;
}
`;

/** Where the map's image would be read: here the water's body colour, depth, foam and surface slope are worked out. */
const SHADER_BODY = /* glsl */ `
  vec2 waterUv = vec2(vUv.x, 1.0 - vUv.y);
  float waterWet = smoothstep(0.3, 0.7, texture2D(uWaterMask, waterUv).r);
  if (waterWet < 0.01) discard;
  // Depth: how far into the water this is (the mask blurred over a couple of cells), shallow at the shore.
  float waterNear = textureLod(uWaterMask, waterUv, uWaterBlur * 0.55).r;
  float waterFar = textureLod(uWaterMask, waterUv, uWaterBlur).r;
  float waterDepth = smoothstep(0.45, 1.0, waterFar * 0.6 + waterNear * 0.4);
  vec2 waterP = waterUv * uWaterCells;
  float waterT = uWaterTime;
  float waterE = 0.06;
  float waterH = waterHeight(waterP, waterT);
  vec2 waterGrad = vec2(waterHeight(waterP + vec2(waterE, 0.0), waterT) - waterH, waterHeight(waterP + vec2(0.0, waterE), waterT) - waterH) / waterE;
  // Fine capillary ripples on top, for sparkle.
  vec2 waterFineP = waterP * 7.0;
  float waterFine = waterNoise(waterFineP + vec2(waterT * 0.9, -waterT * 0.7));
  vec2 waterFineGrad = vec2(waterNoise(waterFineP + vec2(0.05, 0.0) + vec2(waterT * 0.9, -waterT * 0.7)) - waterFine, waterNoise(waterFineP + vec2(0.0, 0.05) + vec2(waterT * 0.9, -waterT * 0.7)) - waterFine) / 0.05;
  float waterRough = 0.15 + uWaterAmount * 0.85;
  vec2 waterSlope = waterGrad * (0.05 + 0.2 * waterRough) + waterFineGrad * (0.004 + 0.012 * waterRough);
  // Foam: on the shore, broken by noise, and on the crests of rough water.
  float waterShore = waterWet * (1.0 - smoothstep(0.7, 0.96, texture2D(uWaterMask, waterUv, 1.5).r * 0.5 + waterNear * 0.5));
  float waterFoamNoise = waterNoise(waterP * 3.5 + vec2(waterT * 0.4, waterT * 0.3)) * 0.6 + waterNoise(waterP * 9.0 - waterT * 0.5) * 0.4;
  float waterFoam = smoothstep(0.45, 0.85, waterShore * (0.5 + waterFoamNoise)) * (0.25 + 0.55 * waterRough);
  waterFoam += smoothstep(0.7, 1.0, waterH) * smoothstep(0.55, 0.8, waterFoamNoise) * smoothstep(0.5, 1.0, uWaterAmount) * (uWaterKind == 3 ? 0.8 : 0.35);
  waterFoam = clamp(waterFoam, 0.0, 1.0);
  // The light the water's body scatters back: its tint, darker the deeper it is.
  vec3 waterBody = uWaterTint * mix(0.85, 0.3, waterDepth);
  diffuseColor = vec4(mix(waterBody, vec3(0.92, 0.95, 0.96), waterFoam), waterWet);
`;

/** The surface's slope bends its normal (view space: the map's x runs along world x, its y along world z). */
const SHADER_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
  {
    vec3 waterTx = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
    vec3 waterTz = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    normal = normalize(normal - (waterSlope.x * waterTx + waterSlope.y * waterTz) * (1.0 - waterFoam * 0.6));
  }
  roughnessFactor = mix(roughnessFactor, 0.75, waterFoam);
`;

/** The sky, mirrored at grazing angles (Fresnel), in the colour and strength of the board's ambient light. */
const SHADER_SKY = /* glsl */ `
#include <lights_fragment_end>
  {
    float waterCos = saturate(dot(normal, geometryViewDir));
    float waterFresnel = 0.02 + 0.98 * pow(1.0 - waterCos, 5.0);
    reflectedLight.indirectSpecular += irradiance * waterFresnel * (1.0 - waterFoam) * 0.3;
  }
`;

/**
 * The ground seen through the water: as much as the water is clear (less where it is deep or foaming), absorbed into
 * the tint with depth, and lit by moving caustics.
 */
function transmissionChunk(): string {
  let chunk = THREE.ShaderChunk.transmission_fragment;
  const clear = 'material.transmission = transmission;';
  const after = 'material.attenuationColor, material.attenuationDistance );';
  // three tints what is seen through by the surface's colour; here the water's own absorption (below) does that.
  const body = 'material.roughness, material.diffuseContribution,';
  if (!chunk.includes(clear) || !chunk.includes(after) || !chunk.includes(body)) return chunk;
  chunk = chunk.replace(body, 'material.roughness, vec3(1.0),');
  chunk = chunk.replace(clear, `material.transmission = transmission * min(1.0, uWaterClarity * 1.15) * mix(1.0, 0.6, waterDepth * (1.0 - uWaterClarity * 0.6)) * (1.0 - waterFoam);`);
  chunk = chunk.replace(after, `${after}
  {
    vec3 waterAbsorb = uWaterTint / max(max(uWaterTint.r, max(uWaterTint.g, uWaterTint.b)), 0.001);
    transmitted.rgb *= mix(vec3(1.0), waterAbsorb, (0.5 + 0.5 * waterDepth) * (1.0 - uWaterClarity * 0.35));
    vec2 waterC = waterP * 1.6 + waterSlope * 2.0;
    float waterCaustic = pow(abs(sin(waterNoise(waterC + waterT * 0.35) * 6.2831 + waterT * 0.8) * sin(waterNoise(waterC * 1.7 - waterT * 0.3) * 6.2831 - waterT * 0.6)), 3.0);
    transmitted.rgb *= 1.0 + waterCaustic * (0.25 + 0.6 * uWaterAmount) * (1.0 - waterDepth * 0.6) * (uWaterKind == 0 ? 0.4 : 1.0);
  }`);
  return chunk;
}

export class WaterSurface {
  readonly object3d: THREE.Mesh;
  private readonly texture: THREE.DataTexture;
  private readonly material: THREE.MeshPhysicalMaterial;
  private readonly uniforms = {
    uWaterMask: { value: null as THREE.Texture | null },
    uWaterTime: { value: 0 },
    uWaterAmount: { value: 0.5 },
    uWaterKind: { value: 1 },
    uWaterDir: { value: new THREE.Vector2(1, 0) },
    uWaterCells: { value: new THREE.Vector2(1, 1) },
    uWaterTint: { value: new THREE.Color() },
    uWaterClarity: { value: 0.6 },
    uWaterBlur: { value: 4 },
  };
  private motion: WaterMotion;

  constructor(readonly mask: WaterMask, mapWidth: number, mapHeight: number, cell: number, motion: WaterMotion) {
    this.texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RedFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    // Mipmaps: the mask blurred, read as the water's depth.
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.generateMipmaps = true;
    this.texture.needsUpdate = true;
    this.uniforms.uWaterMask.value = this.texture;
    this.uniforms.uWaterCells.value.set(mapWidth / cell, mapHeight / cell);
    // Blur over about two cells: the mip level whose texel spans that much of the mask.
    this.uniforms.uWaterBlur.value = Math.max(1, Math.log2(Math.max(1, (2 * cell) / Math.max(1e-6, mask.texel))));
    this.material = new THREE.MeshPhysicalMaterial({
      roughness: 0.05, metalness: 0, ior: 1.333, transmission: 1, thickness: cell * 0.6, specularIntensity: 1,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
    });
    this.material.defines = { ...this.material.defines, USE_UV: '' };
    const transmission = transmissionChunk();
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = SHADER_HEAD + shader.fragmentShader
        .replace('#include <map_fragment>', SHADER_BODY)
        .replace('#include <normal_fragment_maps>', SHADER_NORMAL)
        .replace('#include <lights_fragment_end>', SHADER_SKY)
        .replace('#include <transmission_fragment>', transmission);
    };
    this.material.customProgramCacheKey = () => 'tabletop-water-2';
    const geometry = new THREE.PlaneGeometry(mapWidth, mapHeight).rotateX(-Math.PI / 2);
    this.object3d = new THREE.Mesh(geometry, this.material);
    this.object3d.position.set(mapWidth / 2, LIFT, mapHeight / 2);
    this.object3d.receiveShadow = true;
    this.object3d.renderOrder = 1;
    this.object3d.raycast = () => {};
    this.motion = motion;
    this.setMotion(motion);
  }

  /** The mask changed (painted, erased): shown at the next frame. */
  maskChanged(): void {
    this.texture.needsUpdate = true;
  }

  setMotion(motion: WaterMotion): void {
    this.motion = motion;
    this.uniforms.uWaterAmount.value = motion.amount;
    this.uniforms.uWaterKind.value = WATER_MOTION_KINDS.indexOf(motion.kind);
    const turn = THREE.MathUtils.degToRad(motion.direction);
    // 0 runs up the map (towards row 0), 90 to the right.
    this.uniforms.uWaterDir.value.set(Math.sin(turn), -Math.cos(turn));
    this.uniforms.uWaterTint.value.set(motion.tint);
    this.uniforms.uWaterClarity.value = motion.clarity;
  }

  /** Whether the water needs frames to move (still water barely moves, but it still shimmers). */
  get moving(): boolean {
    return !this.mask.empty;
  }

  /** Moves the water on to this time, in seconds. */
  tick(seconds: number): void {
    this.uniforms.uWaterTime.value = seconds;
  }

  get currentMotion(): WaterMotion {
    return this.motion;
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.object3d.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
