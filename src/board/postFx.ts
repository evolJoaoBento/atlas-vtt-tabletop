import * as THREE from 'three';

/**
 * The board's post-processing. The miniature look: the picture is blurred towards its top and bottom edges and sharp in a band across the middle,
 * the way a lens that shifts and tilts shows a model. Depth of field: where the camera aims (the orbit's target, a
 * cutscene's aim; for other cameras what the middle of the view rests on) is sharp and
 * what lies nearer or farther blurs, by how far it is from that as a share of the focus distance (so a big map and a small
 * one look alike), the way a camera lens focuses; the sky is blurred fully. Contact shadows: a screen-space ambient occlusion from the depth
 * of the picture darkens creases (walls, minis and props where they meet the floor). The scene is drawn into a
 * half-float target, the occlusion is worked out at half size, and two passes (across, then down) carry the picture to
 * the screen, blurred or not, where the tone mapping and colour space are applied as usual.
 */

/** The share of the height, either side of the middle, that stays sharp. */
export const SHARP_BAND = 0.16;
/** The share of the height over which the blur grows from nothing to its most. */
export const BLUR_RANGE = 0.34;
/** The most the blur reaches, in pixels at the drawing resolution. */
export const MAX_BLUR_PX = 7;
/** Depth of field: the share of the focus distance, nearer or farther, that stays sharp. */
export const DOF_SHARP = 0.06;
/** The share of the focus distance beyond that over which the blur grows to its most. */
export const DOF_RANGE = 0.6;
/** The most the depth of field blurs, in pixels at the drawing resolution. */
export const MAX_DOF_PX = 8;

/** How a depth-of-field blur grows: none within the sharp share, smoothly to its most beyond it. Pure. */
export function dofBlurAt(distance: number, focus: number | null): number {
  if (focus === null || !(focus > 0)) return 0;
  if (!Number.isFinite(distance)) return 1;
  const away = Math.abs(distance - focus) / focus - DOF_SHARP;
  if (away <= 0) return 0;
  const t = Math.min(1, away / DOF_RANGE);
  return t * t * (3 - 2 * t);
}

/**
 * The focus distance from the depths at the picture's middle and four points round it, a twentieth of the picture away
 * (Infinity for the sky): the middle's, else the nearest of the others; null when all are sky. Pure: the shader does the same.
 */
export function focusOf(depths: readonly number[]): number | null {
  if (Number.isFinite(depths[0])) return depths[0]!;
  const near = depths.slice(1).filter((depth) => Number.isFinite(depth));
  return near.length > 0 ? Math.min(...near) : null;
}

/** How dark the deepest crease gets, 0 to 1. */
export const AO_STRENGTH = 0.75;

/** How blurred a row is, 0 (sharp) to 1, from its place in the picture (0 the bottom, 1 the top). Pure. */
export function blurAt(v: number, focus = 0.5): number {
  const away = Math.abs(v - focus) - SHARP_BAND;
  if (away <= 0) return 0;
  const t = Math.min(1, away / BLUR_RANGE);
  return t * t * (3 - 2 * t);
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D map;
uniform sampler2D depthMap;
uniform float dof;
uniform float dofSharp;
uniform float dofRange;
uniform float dofPx;
uniform float focusFixed;
uniform float near;
uniform float far;
uniform sampler2D light;
uniform vec2 step;
uniform float focus;
uniform float sharp;
uniform float range;
uniform float maxPx;
uniform float grade;
uniform float saturation;
uniform float contrast;
uniform float warmth;
uniform float vignette;
varying vec2 vUv;
float depthAt(vec2 uv) {
  float raw = texture2D(depthMap, uv).x;
  return raw >= 1.0 ? -1.0 : -perspectiveDepthToViewZ(raw, near, far);
}
// Depth of field (\`dofBlurAt\`, \`focusOf\`): the focus is what the middle of the view rests on, else the nearest thing beside it.
float dofAmount() {
  float focusAt = focusFixed > 0.0 ? focusFixed : depthAt(vec2(0.5));
  if (focusAt < 0.0) {
    float around[4];
    around[0] = depthAt(vec2(0.45, 0.5));
    around[1] = depthAt(vec2(0.55, 0.5));
    around[2] = depthAt(vec2(0.5, 0.45));
    around[3] = depthAt(vec2(0.5, 0.55));
    for (int i = 0; i < 4; i++) {
      if (around[i] >= 0.0 && (focusAt < 0.0 || around[i] < focusAt)) focusAt = around[i];
    }
  }
  if (focusAt <= 0.0) return 0.0;
  float here = depthAt(vUv);
  if (here < 0.0) return 1.0;
  float t = clamp((abs(here - focusAt) / focusAt - dofSharp) / dofRange, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
void main() {
  float away = max(abs(vUv.y - focus) - sharp, 0.0);
  float t = clamp(away / range, 0.0, 1.0);
  float amount = t * t * (3.0 - 2.0 * t) * maxPx;
  if (dof > 0.5) amount = max(amount, dofAmount() * dofPx);
  vec2 along = step * amount * 0.25;
  vec4 sum = texture2D(map, vUv) * 0.2270270;
  sum += (texture2D(map, vUv + along) + texture2D(map, vUv - along)) * 0.1945946;
  sum += (texture2D(map, vUv + along * 2.0) + texture2D(map, vUv - along * 2.0)) * 0.1216216;
  sum += (texture2D(map, vUv + along * 3.0) + texture2D(map, vUv - along * 3.0)) * 0.0540541;
  sum += (texture2D(map, vUv + along * 4.0) + texture2D(map, vUv - along * 4.0)) * 0.0162162;
  vec3 colour = sum.rgb * texture2D(light, vUv).r;
  if (grade > 0.5) {
    // The cinematic grade, in linear light before the tone mapping: a little warmer, richer and firmer, the corners darker.
    colour *= vec3(1.0 + 0.06 * warmth, 1.0 + 0.01 * warmth, 1.0 - 0.06 * warmth);
    float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
    colour = mix(vec3(grey), colour, saturation);
    colour = max(vec3(0.0), (colour - 0.18) * contrast + 0.18);
    vec2 off = vUv - 0.5;
    colour *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(off, off) * 2.2);
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const AO_FRAGMENT = /* glsl */ `
#include <packing>
uniform sampler2D depthMap;
uniform vec2 texel;
uniform vec2 proj;
uniform float near;
uniform float far;
uniform float radius;
uniform float focalPx;
uniform float strength;
varying vec2 vUv;
float viewDepth(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(depthMap, uv).x, near, far);
}
vec3 viewPosition(vec2 uv, float depth) {
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc.x * depth / proj.x, ndc.y * depth / proj.y, -depth);
}
float noise(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
void main() {
  float raw = texture2D(depthMap, vUv).x;
  if (raw >= 1.0) { gl_FragColor = vec4(1.0); return; }
  float here = viewDepth(vUv);
  vec3 centre = viewPosition(vUv, here);
  vec3 normal = normalize(cross(dFdx(centre), dFdy(centre)));
  if (dot(normal, centre) > 0.0) normal = -normal;
  float reach = clamp(radius * focalPx / here, 3.0, 60.0);
  float turn = noise(gl_FragCoord.xy) * 6.2831853;
  float occluded = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = (float(i) + 0.5) / 16.0;
    float angle = turn + float(i) * 2.3999632;
    vec2 at = vUv + vec2(cos(angle), sin(angle)) * sqrt(t) * reach * texel;
    vec3 across = viewPosition(at, viewDepth(at)) - centre;
    float apart = length(across);
    // A point above this surface and within reach shades it; a flat floor has none, a wall beside it has many.
    float above = max(dot(normal, across) / max(apart, 1e-4) - 0.2, 0.0);
    occluded += above * (1.0 - smoothstep(radius * 0.6, radius, apart));
  }
  float light = 1.0 - strength * clamp(occluded / 16.0 * 1.6, 0.0, 1.0);
  gl_FragColor = vec4(vec3(light), 1.0);
}`;

/** The cinematic grade: saturation and contrast (1 leaves them), warmth (0 leaves it) and how dark the vignette makes the corners. */
export const GRADE = { saturation: 1.1, contrast: 1.05, warmth: 0.25, vignette: 0.2 } as const;

export interface PostFxLook {
  /** The miniature look's blur. */
  tilt: boolean;
  /** The cinematic grade (`GRADE`). */
  grade: boolean;
  /** Depth of field (`dofBlurAt`). */
  depthOfField?: boolean;
  /** Its focus distance where the camera aims at a point (the orbit's target); absent or null: what the middle of the view rests on (`focusOf`). */
  focus?: number | null;
  /** Contact shadows, with the radius they reach in world units. */
  occlusion: false | { radius: number };
}

export class PostFx {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly size = new THREE.Vector2();
  private readonly drawn: THREE.WebGLRenderTarget;
  private readonly across: THREE.WebGLRenderTarget;
  private readonly shade: THREE.WebGLRenderTarget;
  private readonly occlusion: THREE.ShaderMaterial;
  private readonly flat = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

  constructor(private readonly renderer: THREE.WebGLRenderer, antialias: boolean) {
    const options = { type: THREE.HalfFloatType, depthBuffer: false };
    this.drawn = new THREE.WebGLRenderTarget(1, 1, { ...options, depthBuffer: true, stencilBuffer: true, samples: antialias ? 4 : 0 });
    this.drawn.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type, undefined, undefined, undefined, undefined, undefined, undefined, THREE.DepthStencilFormat);
    this.across = new THREE.WebGLRenderTarget(1, 1, options);
    this.shade = new THREE.WebGLRenderTarget(1, 1, options);
    this.flat.needsUpdate = true;
    this.occlusion = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: AO_FRAGMENT,
      uniforms: {
        depthMap: { value: this.drawn.depthTexture },
        texel: { value: new THREE.Vector2() },
        proj: { value: new THREE.Vector2(1, 1) },
        near: { value: 1 },
        far: { value: 1000 },
        radius: { value: 1 },
        focalPx: { value: 1 },
        strength: { value: AO_STRENGTH },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        map: { value: null },
        light: { value: null },
        depthMap: { value: this.drawn.depthTexture },
        dof: { value: 0 },
        dofSharp: { value: DOF_SHARP },
        dofRange: { value: DOF_RANGE },
        dofPx: { value: MAX_DOF_PX },
        focusFixed: { value: 0 },
        near: { value: 1 },
        far: { value: 1000 },
        step: { value: new THREE.Vector2() },
        focus: { value: 0.5 },
        sharp: { value: SHARP_BAND },
        range: { value: BLUR_RANGE },
        maxPx: { value: MAX_BLUR_PX },
        grade: { value: 0 },
        saturation: { value: GRADE.saturation },
        contrast: { value: GRADE.contrast },
        warmth: { value: GRADE.warmth },
        vignette: { value: GRADE.vignette },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.scene.children[0].frustumCulled = false;
  }

  /** Draws `scene` through `camera` to the renderer's canvas with the looks asked for. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, look: PostFxLook): void {
    const { renderer } = this;
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    if (this.drawn.width !== width || this.drawn.height !== height) {
      this.drawn.setSize(width, height);
      this.across.setSize(width, height);
      this.shade.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
    }
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.drawn);
    renderer.clear();
    renderer.render(scene, camera);
    this.material.uniforms.maxPx.value = look.tilt ? MAX_BLUR_PX : 0;
    this.material.uniforms.sharp.value = look.tilt ? SHARP_BAND : 1;
    this.material.uniforms.light.value = this.flat;
    // Depth of field reads the depth as it was drawn; the camera's near plane moves with its distance (Board.fitNear).
    this.material.uniforms.dof.value = look.depthOfField === true ? 1 : 0;
    this.material.uniforms.focusFixed.value = look.focus != null && look.focus > 0 ? look.focus : 0;
    this.material.uniforms.near.value = camera.near;
    this.material.uniforms.far.value = camera.far;
    if (look.occlusion) {
      const uniforms = this.occlusion.uniforms;
      uniforms.near.value = camera.near;
      uniforms.far.value = camera.far;
      uniforms.radius.value = look.occlusion.radius;
      (uniforms.proj.value as THREE.Vector2).set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
      // Pixels per unit at a distance of one: half the height over the tangent of half the field of view.
      uniforms.focalPx.value = (this.shade.height / 2) * camera.projectionMatrix.elements[5];
      (uniforms.texel.value as THREE.Vector2).set(1 / this.shade.width, 1 / this.shade.height);
      (this.scene.children[0] as THREE.Mesh).material = this.occlusion;
      renderer.setRenderTarget(this.shade);
      renderer.render(this.scene, this.camera);
      (this.scene.children[0] as THREE.Mesh).material = this.material;
      this.material.uniforms.light.value = this.shade.texture;
    }
    // Across, in linear light, then down to the screen with the grade and the tone mapping.
    this.material.uniforms.grade.value = 0;
    this.material.uniforms.map.value = this.drawn.texture;
    (this.material.uniforms.step.value as THREE.Vector2).set(1 / width, 0);
    renderer.setRenderTarget(this.across);
    renderer.render(this.scene, this.camera);
    this.material.uniforms.map.value = this.across.texture;
    // The creases were darkened across; down, the picture is only blurred.
    this.material.uniforms.light.value = this.flat;
    (this.material.uniforms.step.value as THREE.Vector2).set(0, 1 / height);
    this.material.uniforms.grade.value = look.grade ? 1 : 0;
    renderer.setRenderTarget(before);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.drawn.dispose();
    this.drawn.depthTexture?.dispose();
    this.across.dispose();
    this.shade.dispose();
    this.flat.dispose();
    this.occlusion.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}
