/**
 * The laser's beam on the 3D board, in Atlas's look: a ribbon along the smoothed trail lying just over the map,
 * narrowing as its points age, and a round dot (the pointer while it is not drawing, or the beam's head while it
 * is). Its cross-section is Atlas's three gaussians: a faint glow to the edge, a solid body in the laser's colour and
 * a white-hot filament, with a white-hot spot at the pointer. It is drawn over everything, so nothing on the board
 * hides it, and since it is part of the scene the player view shows it too. Its buffers are reused frame to frame.
 */
import * as THREE from 'three';
import type { BeamPoint } from './laser';

/** Most points of the smoothed beam: 101 samples, eight steps between each. */
const MAX_POINTS = 101 * 8 + 1;
/** Just over the map; drawn over everything anyway. */
const LIFT = 2;

const VERTEX = /* glsl */ `
attribute vec2 aCoord;
attribute float aLife;
varying vec2 vCoord;
varying float vLife;
varying vec2 vWorld;
void main() {
  vCoord = aCoord;
  vLife = aLife;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec2 uPointer;
uniform float uPointerRadius;
uniform float uPointerVisible;
uniform float uBodyShare;
varying vec2 vCoord;
varying float vLife;
varying vec2 vWorld;
void main() {
  float d = length(vCoord);
  if (d >= 1.0) discard;
  // Each gaussian is at half strength where its x reaches 1.
  float bodyD = d / uBodyShare;
  float filamentD = bodyD / 0.24;
  float spotD = length(vWorld - uPointer) / (uPointerRadius * uBodyShare * 0.43);
  float halo = exp(-d * d * 3.0) * 0.4;
  float body = exp(-bodyD * bodyD * 0.693);
  float filament = exp(-filamentD * filamentD * 0.693) * 0.5;
  float spot = exp(-spotD * spotD * 0.693) * 0.9 * uPointerVisible;
  float alpha = max(halo, body) * smoothstep(0.0, 0.5, vLife);
  vec3 color = mix(uColor, vec3(1.0), max(filament, spot));
  gl_FragColor = vec4(color * alpha, alpha);
}`;

export class LaserBeam {
  readonly object3d: THREE.Mesh;
  private readonly positions = new Float32Array((MAX_POINTS * 2 + 4) * 3);
  private readonly coords = new Float32Array((MAX_POINTS * 2 + 4) * 2);
  private readonly lives = new Float32Array(MAX_POINTS * 2 + 4);
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aCoord', new THREE.BufferAttribute(this.coords, 2).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(((MAX_POINTS - 1) + 1) * 6), 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uColor: { value: new THREE.Vector3(1, 0, 0.35) },
        uPointer: { value: new THREE.Vector2() },
        uPointerRadius: { value: 1 },
        uPointerVisible: { value: 0 },
        uBodyShare: { value: 0.25 },
      },
      transparent: true,
      // The ribbon's triangles face either way as the beam turns: none may be culled.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      // Its colour is already multiplied by its strength.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object3d = new THREE.Mesh(this.geometry, this.material);
    this.object3d.renderOrder = 60;
    this.object3d.frustumCulled = false;
    this.object3d.visible = false;
  }

  /**
   * Draws the beam along `trail` (map points, smoothed) with `dot` (the pointer while not drawing, or null), `halfWidth`
   * map pixels wide at full life, in `color` (`#rrggbb`); `pointer` is where the hot spot glows. Hidden when empty.
   */
  draw(trail: readonly BeamPoint[], dot: { x: number; y: number } | null, pointer: { x: number; y: number } | null, color: string, halfWidth: number, bodyShare: number): void {
    const points = trail.slice(-MAX_POINTS);
    const index = this.geometry.index!.array as Uint32Array;
    let vertex = 0;
    let triangle = 0;
    const put = (x: number, y: number, cx: number, cy: number, life: number): void => {
      this.positions.set([x, LIFT, y], vertex * 3);
      this.coords.set([cx, cy], vertex * 2);
      this.lives[vertex] = life;
      vertex++;
    };
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      const before = points[Math.max(0, i - 1)]!;
      const after = points[Math.min(points.length - 1, i + 1)]!;
      const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
      const nx = -(after.y - before.y) / length;
      const ny = (after.x - before.x) / length;
      const radius = halfWidth * Math.sqrt(Math.max(0, point.life));
      put(point.x + nx * radius, point.y + ny * radius, 1, 0, point.life);
      put(point.x - nx * radius, point.y - ny * radius, -1, 0, point.life);
      if (i > 0) {
        const a = vertex - 4;
        index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], triangle * 3);
        triangle += 2;
      }
    }
    // A round end: the dot while hovering, else the beam's head (its newest point, at full life).
    const head = points[points.length - 1];
    const cap = dot ? { ...dot, radius: halfWidth * 1.25, life: 1 } : head && head.life > 0.95 ? { ...head, radius: halfWidth } : null;
    if (cap) {
      const a = vertex;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) put(cap.x + cx * cap.radius, cap.y + cy * cap.radius, cx, cy, cap.life);
      index.set([a, a + 1, a + 2, a, a + 2, a + 3], triangle * 3);
      triangle += 2;
    }
    this.object3d.visible = triangle > 0;
    if (triangle === 0) return;
    this.geometry.setDrawRange(0, triangle * 3);
    for (const name of ['position', 'aCoord', 'aLife']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.index!.needsUpdate = true;
    const uniforms = this.material.uniforms;
    // The colour as typed: the shader writes it straight out, as Atlas's does.
    const hex = Number.parseInt(color.slice(1), 16);
    (uniforms.uColor!.value as THREE.Vector3).set(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
    if (pointer) (uniforms.uPointer!.value as THREE.Vector2).set(pointer.x, pointer.y);
    uniforms.uPointerVisible!.value = pointer ? 1 : 0;
    uniforms.uPointerRadius!.value = halfWidth * 1.25;
    uniforms.uBodyShare!.value = bodyShare;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object3d.removeFromParent();
  }
}
