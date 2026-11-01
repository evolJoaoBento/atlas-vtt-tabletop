/**
 * Parallax depth for a material with a height map (Poly Haven's `_disp_`): the surface is read as if the texture lay
 * below it, so the texture shifts as the camera moves and bricks stand proud of their mortar. It changes the sampling
 * position of every map of the material in the fragment shader (steep parallax: the view ray is walked down through
 * layers of height until it meets the surface); no geometry is added.
 */
import * as THREE from 'three';

/** One shared pair of uniforms per material: the height map, and how deep the surface is read to be (in texture units). */
export interface ParallaxUniforms {
  map: { value: THREE.Texture | null };
  depth: { value: number };
  /** How far the geometry is pushed in by the height map, as a multiple of each vertex's `reach` attribute. */
  push: { value: number };
  /** 0 to 1: the share of the relief that stands out of the surface (the rest sinks into it). */
  outward: { value: number };
}

/** How deep a `depth` of 1 reads, as a share of one tile of the texture. */
export const PARALLAX_TILE_SHARE = 0.07;

/** How far a `displace` of 1 pushes the valleys of a wall in, as a share of one tile (the wall's faces are cut finely enough to follow: see `pushBox`). */
export const DISPLACE_TILE_SHARE = 0.05;

const FUNCTION = /* glsl */`
uniform sampler2D parallaxMap;
uniform float parallaxDepth;
uniform float parallaxOutward;

// How far to move the sampling position so the texture seems to lie below the surface, seen from where the camera is.
vec2 parallaxOffset() {
  if (parallaxDepth <= 0.0) return vec2(0.0);
  vec3 N = normalize(vNormal);
  vec3 p1 = dFdx(-vViewPosition);
  vec3 p2 = dFdy(-vViewPosition);
  vec2 t1 = dFdx(vMapUv);
  vec2 t2 = dFdy(vMapUv);
  vec3 p2perp = cross(p2, N);
  vec3 p1perp = cross(N, p1);
  vec3 T = p2perp * t1.x + p1perp * t2.x;
  vec3 B = p2perp * t1.y + p1perp * t2.y;
  float scale = inversesqrt(max(dot(T, T), dot(B, B)));
  // The view direction in the surface's own space: along the texture, across it, and out of it.
  vec3 V = normalize(vec3(dot(vViewPosition, T * scale), dot(vViewPosition, B * scale), dot(vViewPosition, N)));
  if (V.z < 0.02) return vec2(0.0);
  vec2 dx = dFdx(vMapUv);
  vec2 dy = dFdy(vMapUv);
  float layers = mix(40.0, 10.0, clamp(V.z, 0.0, 1.0));
  // Seen at a grazing angle the shift would smear the texture along the surface: it fades out.
  float grazing = smoothstep(0.12, 0.4, V.z);
  vec2 stepUv = V.xy / max(V.z, 0.25) * parallaxDepth * grazing / layers;
  // The walk starts above the surface by the share that stands out, and goes down through all of the depth.
  vec2 uv = vMapUv + stepUv * layers * parallaxOutward;
  float level = 0.0;
  float surface = 1.0 - textureGrad(parallaxMap, uv, dx, dy).r;
  float previousLevel = 0.0;
  float previousSurface = surface;
  for (int i = 0; i < 40; i++) {
    if (level >= surface) break;
    previousLevel = level;
    previousSurface = surface;
    uv -= stepUv;
    surface = 1.0 - textureGrad(parallaxMap, uv, dx, dy).r;
    level += 1.0 / layers;
  }
  // Between the last two layers, where the ray crosses the surface.
  float after = surface - level;
  float before = previousSurface - previousLevel;
  float share = after / (after - before - 1e-5);
  return (uv + stepUv * clamp(share, 0.0, 1.0)) - vMapUv;
}
`;

/** Every texture the material reads with the same position, so all of them shift together. */
const SHIFTED = ['map_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps', 'aomap_fragment'] as const;

/**
 * Makes a material read all its maps at the parallax position. Needs the material's colour map (the position is
 * `vMapUv`) and a height map in `uniforms.map`; with a depth of 0 it draws as before.
 */
export function addParallax(material: THREE.MeshStandardMaterial, uniforms: ParallaxUniforms): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.parallaxMap = uniforms.map;
    shader.uniforms.parallaxDepth = uniforms.depth;
    shader.uniforms.parallaxPush = uniforms.push;
    shader.uniforms.parallaxOutward = uniforms.outward;
    // The faces are cut into a fine grid with a `reach` at each vertex (0 at the edges, so boxes still meet); the low parts of the height map sink in from the surface, the high parts stay.
    shader.vertexShader = `attribute float reach;\nuniform sampler2D parallaxMap;\nuniform float parallaxPush;\nuniform float parallaxOutward;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += objectNormal * (textureLod(parallaxMap, vMapUv, 1.5).r - (1.0 - parallaxOutward)) * reach * parallaxPush;');
    let source = shader.fragmentShader.replace('void main() {', `${FUNCTION}\nvoid main() {\n  vec2 parallaxShift = parallaxOffset();`);
    for (const name of SHIFTED) {
      const chunk = THREE.ShaderChunk[name].replace(/\b(v\w+Uv)\b/g, '($1 + parallaxShift)');
      source = source.replace(`#include <${name}>`, chunk);
    }
    shader.fragmentShader = source;
  };
  material.customProgramCacheKey = () => 'tabletop-parallax';
  material.needsUpdate = true;
}
