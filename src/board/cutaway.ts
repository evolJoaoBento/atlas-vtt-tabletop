/**
 * See-through walls: what stands between the camera and the point it turns around (the pivot) fades out, so a wall in front
 * of the action does not hide it. It is done in the walls' own fragment shader: a fragment nearer the camera than the pivot,
 * within a radius of the line between them (a cone: wider the nearer the camera), is dithered away (most of it, leaving a faint ghost), with a soft edge. One
 * pair of uniforms is shared by every wall material, and the board aims it before each drawing; shadows are not touched.
 */
import * as THREE from 'three';

export interface CutawayUniforms {
  eye: { value: THREE.Vector3 };
  pivot: { value: THREE.Vector3 };
  /** How wide the cut is round the line of sight at the pivot, in map pixels; it widens toward the camera. */
  radius: { value: number };
  /** 0 off, 1 on. */
  strength: { value: number };
}

export function newCutaway(): CutawayUniforms {
  return { eye: { value: new THREE.Vector3() }, pivot: { value: new THREE.Vector3() }, radius: { value: 100 }, strength: { value: 0 } };
}

/** How much of the wall is left in the cut, so it is still a faint ghost. */
const GHOST = 0.12;
/** How much wider the window is at the camera than at the pivot: the width grows by this many times the set width. */
const NEAR_WIDENING = 2;

const FRAGMENT = /* glsl */`
uniform vec3 cutEye;
uniform vec3 cutPivot;
uniform float cutRadius;
uniform float cutStrength;
varying vec3 vCutWorld;
`;

const TEST = /* glsl */`
  if (cutStrength > 0.0) {
    vec3 sight = cutPivot - cutEye;
    float along = dot(vCutWorld - cutEye, sight) / max(dot(sight, sight), 1e-4);
    // Between the camera and the pivot only: the cut ends at the pivot.
    float between = smoothstep(0.02, 0.08, along) * (1.0 - smoothstep(0.94, 1.0, along));
    float away = distance(vCutWorld, cutEye + sight * along);
    // The window is a cone: its set width at the pivot, wider the nearer the camera, so what is close is cut more.
    float reach = cutRadius * (1.0 + ${NEAR_WIDENING.toFixed(1)} * (1.0 - clamp(along, 0.0, 1.0)));
    float cut = cutStrength * between * (1.0 - smoothstep(reach * 0.7, reach, away));
    float keep = 1.0 - cut * ${(1 - GHOST).toFixed(2)};
    // Interleaved gradient noise on the screen: a fine dither, no pattern that crawls.
    float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (keep < noise) discard;
  }
`;

/**
 * Makes a wall material fade where it is between the camera and the pivot. It goes on after whatever else the material
 * adds to its shader (parallax), and a material already given it is left alone.
 */
export function addCutaway(material: THREE.Material, uniforms: CutawayUniforms): void {
  const before = material.onBeforeCompile as ((shader: THREE.WebGLProgramParametersWithUniforms, renderer: THREE.WebGLRenderer) => void) & { cutaway?: boolean };
  if (before.cutaway) return;
  const key = material.customProgramCacheKey.bind(material);
  const wrapped: typeof before = (shader, renderer) => {
    before.call(material, shader, renderer);
    shader.uniforms.cutEye = uniforms.eye;
    shader.uniforms.cutPivot = uniforms.pivot;
    shader.uniforms.cutRadius = uniforms.radius;
    shader.uniforms.cutStrength = uniforms.strength;
    shader.vertexShader = `varying vec3 vCutWorld;\n${shader.vertexShader}`
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = `${FRAGMENT}${shader.fragmentShader}`
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${TEST}`);
  };
  wrapped.cutaway = true;
  material.onBeforeCompile = wrapped;
  material.customProgramCacheKey = () => `${key()}|cutaway`;
  material.needsUpdate = true;
}
