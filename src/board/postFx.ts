import * as THREE from 'three';

/**
 * The board's post-processing. The miniature look: the picture is blurred towards its top and bottom edges and sharp in a band across the middle,
 * the way a lens that shifts and tilts shows a model. Contact shadows: a screen-space ambient occlusion from the depth
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
uniform sampler2D map;
uniform sampler2D light;
uniform sampler2D bloomA;
uniform sampler2D bloomB;
uniform float bloom;
uniform float finalPass;
uniform float vignette;
uniform float saturation;
uniform float contrast;
uniform float warmth;
uniform vec2 step;
uniform float focus;
uniform float sharp;
uniform float range;
uniform float maxPx;
varying vec2 vUv;
void main() {
  float away = max(abs(vUv.y - focus) - sharp, 0.0);
  float t = clamp(away / range, 0.0, 1.0);
  float amount = t * t * (3.0 - 2.0 * t) * maxPx;
  vec2 along = step * amount * 0.25;
  vec4 sum = texture2D(map, vUv) * 0.2270270;
  sum += (texture2D(map, vUv + along) + texture2D(map, vUv - along)) * 0.1945946;
  sum += (texture2D(map, vUv + along * 2.0) + texture2D(map, vUv - along * 2.0)) * 0.1216216;
  sum += (texture2D(map, vUv + along * 3.0) + texture2D(map, vUv - along * 3.0)) * 0.0540541;
  sum += (texture2D(map, vUv + along * 4.0) + texture2D(map, vUv - along * 4.0)) * 0.0162162;
  vec3 colour = sum.rgb * texture2D(light, vUv).r;
  if (finalPass > 0.5) {
    // SPIKE: bloom added in linear light, then grading and a vignette, before the tone mapping.
    colour += (texture2D(bloomA, vUv).rgb + texture2D(bloomB, vUv).rgb) * bloom;
    colour *= mix(vec3(1.0), vec3(1.0 + 0.06 * warmth, 1.0 + 0.01 * warmth, 1.0 - 0.06 * warmth), 1.0);
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

/** SPIKE: the looks under trial (bloom's threshold and strength, a vignette, colour grading); none when absent. */
export interface PostFxTrial {
  bloom?: { threshold: number; strength: number };
  vignette?: number;
  saturation?: number;
  contrast?: number;
  warmth?: number;
}

const BRIGHT = /* glsl */ `
uniform sampler2D map;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  float peak = max(c.r, max(c.g, c.b));
  float knee = threshold * 0.5;
  float soft = clamp(peak - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float keep = max(soft, peak - threshold) / max(peak, 1e-4);
  gl_FragColor = vec4(c * keep, 1.0);
}`;

const BLUR = /* glsl */ `
uniform sampler2D map;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(map, vUv).rgb * 0.2270270;
  sum += (texture2D(map, vUv + step * 1.3846154).rgb + texture2D(map, vUv - step * 1.3846154).rgb) * 0.3162162;
  sum += (texture2D(map, vUv + step * 3.2307692).rgb + texture2D(map, vUv - step * 3.2307692).rgb) * 0.0702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

export interface PostFxLook {
  /** SPIKE: looks under trial. */
  trial?: PostFxTrial;
  /** The miniature look's blur. */
  tilt: boolean;
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
  private readonly black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  /** SPIKE: bloom's targets, half and quarter size, each with a blur partner. */
  private readonly blooms: THREE.WebGLRenderTarget[] = [];
  private readonly bright: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;

  constructor(private readonly renderer: THREE.WebGLRenderer, antialias: boolean) {
    const options = { type: THREE.HalfFloatType, depthBuffer: false };
    this.drawn = new THREE.WebGLRenderTarget(1, 1, { ...options, depthBuffer: true, stencilBuffer: true, samples: antialias ? 4 : 0 });
    this.drawn.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type, undefined, undefined, undefined, undefined, undefined, undefined, THREE.DepthStencilFormat);
    this.across = new THREE.WebGLRenderTarget(1, 1, options);
    this.shade = new THREE.WebGLRenderTarget(1, 1, options);
    this.flat.needsUpdate = true;
    this.black.needsUpdate = true;
    for (let i = 0; i < 4; i++) this.blooms.push(new THREE.WebGLRenderTarget(1, 1, options));
    this.bright = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BRIGHT, uniforms: { map: { value: null }, threshold: { value: 1 } }, depthTest: false, depthWrite: false });
    this.blur = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: BLUR, uniforms: { map: { value: null }, step: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false });
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
        bloomA: { value: null },
        bloomB: { value: null },
        bloom: { value: 0 },
        finalPass: { value: 0 },
        vignette: { value: 0 },
        saturation: { value: 1 },
        contrast: { value: 1 },
        warmth: { value: 0 },
        step: { value: new THREE.Vector2() },
        focus: { value: 0.5 },
        sharp: { value: SHARP_BAND },
        range: { value: BLUR_RANGE },
        maxPx: { value: MAX_BLUR_PX },
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
      for (let i = 0; i < 4; i++) { const d = i < 2 ? 2 : 4; this.blooms[i]!.setSize(Math.max(1, Math.round(width / d)), Math.max(1, Math.round(height / d))); }
    }
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(this.drawn);
    renderer.clear();
    renderer.render(scene, camera);
    this.material.uniforms.maxPx.value = look.tilt ? MAX_BLUR_PX : 0;
    this.material.uniforms.sharp.value = look.tilt ? SHARP_BAND : 1;
    this.material.uniforms.light.value = this.flat;
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
    const trial = look.trial ?? {};
    const u = this.material.uniforms;
    u.bloomA.value = this.black; u.bloomB.value = this.black; u.bloom.value = 0;
    if (trial.bloom) {
      const quad = this.scene.children[0] as THREE.Mesh;
      const pass = (material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget): void => { quad.material = material; renderer.setRenderTarget(target); renderer.render(this.scene, this.camera); };
      const blurInto = (from: THREE.WebGLRenderTarget, via: THREE.WebGLRenderTarget): void => {
        this.blur.uniforms.map.value = from.texture; (this.blur.uniforms.step.value as THREE.Vector2).set(1 / from.width, 0); pass(this.blur, via);
        this.blur.uniforms.map.value = via.texture; (this.blur.uniforms.step.value as THREE.Vector2).set(0, 1 / from.height); pass(this.blur, from);
      };
      this.bright.uniforms.map.value = this.drawn.texture; this.bright.uniforms.threshold.value = trial.bloom.threshold;
      pass(this.bright, this.blooms[0]!);
      blurInto(this.blooms[0]!, this.blooms[1]!);
      this.blur.uniforms.map.value = this.blooms[0]!.texture; (this.blur.uniforms.step.value as THREE.Vector2).set(1 / this.blooms[0]!.width, 1 / this.blooms[0]!.height); pass(this.blur, this.blooms[2]!);
      blurInto(this.blooms[2]!, this.blooms[3]!);
      blurInto(this.blooms[2]!, this.blooms[3]!);
      quad.material = this.material;
      u.bloomA.value = this.blooms[0]!.texture; u.bloomB.value = this.blooms[2]!.texture; u.bloom.value = trial.bloom.strength;
    }
    u.vignette.value = trial.vignette ?? 0;
    u.saturation.value = trial.saturation ?? 1;
    u.contrast.value = trial.contrast ?? 1;
    u.warmth.value = trial.warmth ?? 0;
    // Across, in linear light, then down to the screen with the tone mapping.
    u.finalPass.value = 0;
    this.material.uniforms.map.value = this.drawn.texture;
    (this.material.uniforms.step.value as THREE.Vector2).set(1 / width, 0);
    renderer.setRenderTarget(this.across);
    renderer.render(this.scene, this.camera);
    this.material.uniforms.map.value = this.across.texture;
    // The creases were darkened across; down, the picture is only blurred.
    this.material.uniforms.light.value = this.flat;
    (this.material.uniforms.step.value as THREE.Vector2).set(0, 1 / height);
    u.finalPass.value = 1;
    renderer.setRenderTarget(before);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.drawn.dispose();
    this.drawn.depthTexture?.dispose();
    this.across.dispose();
    this.shade.dispose();
    this.flat.dispose();
    this.black.dispose();
    for (const target of this.blooms) target.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.occlusion.dispose();
    this.material.dispose();
    (this.scene.children[0] as THREE.Mesh).geometry.dispose();
  }
}

/** SPIKE: the looks under trial, set at run time on `globalThis.__tabletopFx` (with `halo`, the flames' glow); null when none. */
export function spikeTrial(): (PostFxTrial & { halo?: number }) | null {
  const trial = (globalThis as { __tabletopFx?: PostFxTrial & { halo?: number } }).__tabletopFx;
  return trial && (trial.bloom || trial.vignette || trial.saturation !== undefined || trial.contrast !== undefined || trial.warmth) ? trial : null;
}
