/**
 * The look of a spell's damage (`Spell.effect`, one of D&D's thirteen damage types), drawn inside its shape from
 * primitives, after the way game ability effects are layered (glow passes, GPU particles, rings, ribbons, crystals):
 *
 * - Particles: one `THREE.Points` per layer, each point's path worked out in the vertex shader from where and when it
 *   started (start, velocity, drift up or down, swirl), looping, so nothing is simulated on the CPU. Colour runs through
 *   four stops over a point's life; soft, ring or spark shaped; added on (glows) or laid over (smoke, mist).
 * - Meshes: shockwaves, light rays, slash arcs, needles and rocks flying, ice crystals, a force lattice, psychic rings,
 *   lightning bolts redrawn a dozen times a second (a wide glow and a white core), tongues of flame.
 *
 * Each look is fitted to its shape (`Volume.path`): a sphere's bursts out of its middle, a cube's out to its faces, a
 * beam's streams down its length, a cone's fans from its tip, a wall's rises from its foot (its fire a row of flames
 * along its foot, its crystals upright, its slashes across its face, its force a grid over its skin).
 *
 * All of it in the shape's own space (`SpellView.object3d`), sized by the shape and the grid. Particles of a spell
 * cut off by walls are cut the same way (its mask). `tick` moves it on; the board calls it every frame it draws.
 */
import * as THREE from 'three';
import type { DamageType, Spell, SpellShape } from './spells';

/** Each damage type's colours: the shape's own, and the light at its edge. */
export const DAMAGE_COLORS: Record<DamageType, { body: string; edge: string; opacity?: number }> = {
  acid: { body: '#e0c81a', edge: '#fff59a' },
  bludgeoning: { body: '#9a7b56', edge: '#e6cfa4' },
  cold: { body: '#4fb3e8', edge: '#f2feff' },
  explosion: { body: '#ff5a14', edge: '#ffd27a' },
  fire: { body: '#ad002d', edge: '#ee7800' },
  force: { body: '#d01c2a', edge: '#ffb0b0' },
  lightning: { body: '#2f7dff', edge: '#e6f6ff' },
  // A see-through black.
  necrotic: { body: '#000000', edge: '#12061a', opacity: 4 },
  piercing: { body: '#8aa0b4', edge: '#f2f6fa' },
  poison: { body: '#7cbf2a', edge: '#c9a0ff' },
  psychic: { body: '#e03cc4', edge: '#7af0ff' },
  radiant: { body: '#ffc94a', edge: '#fffbe6' },
  slashing: { body: '#a8adb6', edge: '#ffffff' },
  thunder: { body: '#7a3cff', edge: '#e2ccff' },
};

/** The mask a spell cut off by walls is drawn through (`SpellView`'s own uniforms, shared). */
export interface MaskUniforms {
  mask: THREE.IUniform;
  maskBox: THREE.IUniform;
  useMask: THREE.IUniform;
}

// ---- Where things go inside a shape ----

/**
 * A shape's space: a random point inside it, its middle, its long axis, points along that axis with the width there,
 * and its way through: where something crossing it starts and ends. A sphere bursts from its middle out; a cube pushes
 * out to its faces; a beam streams from one end to the other (from the caster, or up a standing column); a cone fans
 * from its tip to its base; a wall rises from its foot.
 */
export interface Volume {
  kind: SpellShape;
  sample(random: () => number): THREE.Vector3;
  middle: THREE.Vector3;
  /** Unit; the way the shape runs (its forward for a cone or beam). */
  axis: THREE.Vector3;
  /** Points along the axis, each with how far the shape reaches across it there. */
  spine: Array<{ at: THREE.Vector3; radius: number }>;
  /** How far it reaches from its middle at most. */
  radius: number;
  /** One crossing of it: where it starts and where it ends. */
  path(random: () => number): { from: THREE.Vector3; to: THREE.Vector3 };
  /** Its run, end to end (a beam's, a cone's tip to base, a wall's foot to top; the middle for a sphere or cube). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** How far it reaches across its run, a share `f` of the way along. */
  widthAt(f: number): number;
  /** A cube's or a wall's sides (x, y, z). */
  box: THREE.Vector3 | null;
}

function inBall(random: () => number): THREE.Vector3 {
  for (;;) {
    const point = new THREE.Vector3(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    if (point.lengthSq() <= 1) return point;
  }
}

function inDisc(random: () => number): THREE.Vector2 {
  const angle = random() * Math.PI * 2;
  const reach = Math.sqrt(random());
  return new THREE.Vector2(Math.cos(angle) * reach, Math.sin(angle) * reach);
}

/** A way out of the middle (unit), any way. */
function anyWay(random: () => number): THREE.Vector3 {
  const point = inBall(random);
  return point.lengthSq() < 1e-6 ? new THREE.Vector3(0, 1, 0) : point.normalize();
}

/** The shape's volume, in the space its geometry is drawn in (`spellView.ts`'s `geometryOf`). */
export function volumeOf(spell: Spell): Volume {
  const self = spell.from === 'self';
  const along = (from: number, to: number, count: number, width: (z: number) => number, axis: 'x' | 'z'): Volume['spine'] =>
    Array.from({ length: count }, (_, index) => {
      const value = count === 1 ? (from + to) / 2 : from + ((to - from) * (index + 0.5)) / count;
      return { at: axis === 'z' ? new THREE.Vector3(0, 0, value) : new THREE.Vector3(value, 0, 0), radius: width(value) };
    });
  const origin = new THREE.Vector3();
  switch (spell.shape) {
    case 'sphere': {
      const r = spell.size;
      return {
        kind: 'sphere', sample: (random) => inBall(random).multiplyScalar(r), middle: origin.clone(), axis: new THREE.Vector3(0, 1, 0),
        spine: [{ at: origin.clone(), radius: r }], radius: r,
        path: (random) => ({ from: inBall(random).multiplyScalar(r * 0.12), to: anyWay(random).multiplyScalar(r * (0.75 + random() * 0.25)) }),
        from: origin.clone(), to: origin.clone(), widthAt: () => r, box: null,
      };
    }
    case 'cube': {
      const s = spell.size;
      return {
        kind: 'cube', sample: (random) => new THREE.Vector3((random() - 0.5) * s, (random() - 0.5) * s, (random() - 0.5) * s),
        middle: origin.clone(), axis: new THREE.Vector3(0, 1, 0), spine: [{ at: origin.clone(), radius: s / 2 }], radius: s * 0.87,
        path: (random) => {
          // Out to a face: the way, stretched until it meets the box.
          const way = anyWay(random);
          const reach = (s / 2) / Math.max(Math.abs(way.x), Math.abs(way.y), Math.abs(way.z));
          return { from: inBall(random).multiplyScalar(s * 0.08), to: way.multiplyScalar(reach) };
        },
        from: origin.clone(), to: origin.clone(), widthAt: () => s / 2, box: new THREE.Vector3(s, s, s),
      };
    }
    case 'cylinder': {
      const r = spell.size;
      const length = spell.length;
      // From the caster's end (z = 0) forward; a standing column from its foot (+z, down) to its top (-z, up).
      const zA = self ? 0 : length / 2;
      const zB = zA - length;
      const count = Math.max(1, Math.min(8, Math.round(length / (r * 2))));
      return {
        kind: 'cylinder',
        sample: (random) => { const disc = inDisc(random).multiplyScalar(r); return new THREE.Vector3(disc.x, disc.y, zB + random() * length); },
        middle: new THREE.Vector3(0, 0, (zA + zB) / 2), axis: new THREE.Vector3(0, 0, -1), spine: along(zA, zB, count, () => r, 'z'),
        radius: Math.hypot(r, length / 2),
        path: (random) => {
          const disc = inDisc(random).multiplyScalar(r);
          const end = disc.clone().multiplyScalar(0.85 + random() * 0.3);
          return { from: new THREE.Vector3(disc.x, disc.y, zA), to: new THREE.Vector3(end.x, end.y, zB) };
        },
        from: new THREE.Vector3(0, 0, zA), to: new THREE.Vector3(0, 0, zB), widthAt: () => r, box: null,
      };
    }
    case 'cone': {
      const length = spell.size;
      const base = length * Math.tan(spell.angle / 2);
      // The tip at +z (z1), the base at z0.
      const z1 = self ? 0 : length / 2;
      const z0 = z1 - length;
      const width = (z: number): number => (base * (z1 - z)) / length;
      const count = Math.max(1, Math.min(8, Math.round(length / Math.max(1, base))));
      return {
        kind: 'cone',
        sample: (random) => {
          // Denser toward the base, as the volume is.
          const z = z1 - length * Math.cbrt(random());
          const disc = inDisc(random).multiplyScalar(width(z));
          return new THREE.Vector3(disc.x, disc.y, z);
        },
        middle: new THREE.Vector3(0, 0, z1 - length * 0.75), axis: new THREE.Vector3(0, 0, -1), spine: along(z1, z0, count, width, 'z'),
        radius: Math.hypot(base, length / 2),
        path: (random) => {
          const start = inDisc(random).multiplyScalar(base * 0.04);
          const end = inDisc(random).multiplyScalar(base);
          return { from: new THREE.Vector3(start.x, start.y, z1), to: new THREE.Vector3(end.x, end.y, z0) };
        },
        from: new THREE.Vector3(0, 0, z1), to: new THREE.Vector3(0, 0, z0), widthAt: (f) => Math.max(1e-3, base * f), box: null,
      };
    }
    case 'wall': {
      const to = spell.to!;
      const run = Math.max(1e-3, Math.hypot(to.x - spell.at.x, to.y - spell.at.y));
      const height = spell.length;
      const thick = spell.size;
      const count = Math.max(1, Math.min(10, Math.round(run / Math.max(1, height))));
      return {
        kind: 'wall',
        sample: (random) => new THREE.Vector3((random() - 0.5) * run, (random() - 0.5) * height, (random() - 0.5) * thick),
        middle: origin.clone(), axis: new THREE.Vector3(1, 0, 0), spine: along(-run / 2, run / 2, count, () => height / 2, 'x'),
        radius: Math.hypot(run, height) / 2,
        path: (random) => {
          const x = (random() - 0.5) * run;
          const z = (random() - 0.5) * thick;
          return { from: new THREE.Vector3(x, -height / 2, z), to: new THREE.Vector3(x + (random() - 0.5) * thick, height / 2, z) };
        },
        from: new THREE.Vector3(0, -height / 2, 0), to: new THREE.Vector3(0, height / 2, 0), widthAt: () => run / 2,
        box: new THREE.Vector3(run, height, thick),
      };
    }
  }
}

/** The same random numbers for the same spell, so every board draws it alike. */
function seeded(seed: number): () => number {
  let state = Math.floor(Math.abs(seed) * 9301 + 49297) % 233280 || 1;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

// ---- Particles ----

const PARTICLE_VERTEX = /* glsl */ `
attribute vec3 aVelocity;
attribute float aSeed;
attribute float aLife;
uniform float uTime;
uniform float uSize;
uniform vec2 uGrow;
uniform vec3 uUp;
uniform float uRise;
uniform vec2 uSwirl;
uniform float uPull;
uniform float uViewport;
uniform float uNear;
varying float vT;
varying float vNear;
varying float vSeed;
varying vec3 vWorld;
void main() {
  float age = mod(uTime + aSeed * aLife, aLife);
  float t = age / aLife;
  vec3 p = position + aVelocity * age + 0.5 * uUp * uRise * age * age;
  // Drawn in toward where it started from (a pull > 0) instead of out.
  p = mix(p, position * (1.0 - t), uPull);
  float turn = uTime * uSwirl.x + aSeed * 6.2831;
  p += vec3(sin(turn), 0.0, cos(turn)) * uSwirl.y * t;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vT = t;
  vSeed = aSeed;
  vec4 eye = viewMatrix * world;
  gl_Position = projectionMatrix * eye;
  float size = uSize * mix(uGrow.x, uGrow.y, t) * smoothstep(0.0, 0.08, t);
  // Close to the eye (looking out from inside it) a point fades and stays small, not a blot over the view.
  vNear = smoothstep(uNear * 0.5, uNear * 2.5, -eye.z);
  gl_PointSize = clamp(size * projectionMatrix[1][1] * uViewport * 0.5 / max(1.0, -eye.z), 1.0, uViewport * 0.06);
}`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor0;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uAlpha;
uniform float uShape;
uniform sampler2D mask;
uniform vec4 maskBox;
uniform float useMask;
varying float vT;
varying float vSeed;
varying vec3 vWorld;
varying float vNear;
vec3 gradient(float t) {
  if (t < 0.333) return mix(uColor0, uColor1, t / 0.333);
  if (t < 0.666) return mix(uColor1, uColor2, (t - 0.333) / 0.333);
  return mix(uColor2, uColor3, (t - 0.666) / 0.334);
}
void main() {
  if (useMask > 0.5) {
    vec2 uv = (vWorld.xz - maskBox.xy) / (maskBox.zw - maskBox.xy);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || texture2D(mask, uv).r < 0.5) discard;
  }
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  float shape;
  if (uShape < 0.5) shape = exp(-d * d * 3.5);                      // soft
  else if (uShape < 1.5) shape = smoothstep(0.22, 0.0, abs(d - 0.72)); // ring (a bubble)
  else shape = pow(1.0 - d, 3.0);                                     // spark
  float fade = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.7, 1.0, vT));
  gl_FragColor = vec4(gradient(vT), shape * fade * uAlpha * vNear);
  #include <colorspace_fragment>
}`;

interface ParticleLayer {
  count: number;
  /** World size of a point at its birth, squares. */
  size: number;
  /** Its size at birth and at death, times `size`. */
  grow: [number, number];
  /** Lifetime, seconds (each point a little more or less). */
  life: number;
  /** Speed out of its start, squares a second: along `direction` (or every way when null), plus a random part. */
  speed: number;
  spread: number;
  direction?: THREE.Vector3 | null;
  /** Up (+) or down (-), squares a second², the world's way. */
  rise?: number;
  /** Turning round as it goes: turns a second, and how far, squares. */
  swirl?: [number, number];
  /** Drawn inward to where it started from, 0..1. */
  pull?: number;
  /**
   * Along the shape's way (`Volume.path`), crossing it once in its life: out of a sphere's middle, to a cube's faces,
   * down a beam or a cone, up a wall (`out`), or the other way (`back`).
   */
  flow?: 'out' | 'back';
  colors: [string, string, string, string];
  alpha: number;
  shape: 'soft' | 'ring' | 'spark';
  /** Added on (a glow) or laid over (smoke). */
  additive: boolean;
  /** Born on the shape's surface rather than through it. */
  surface?: boolean;
}

// ---- The effect ----

export class SpellEffect {
  readonly object3d = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly particleUniforms: Array<Record<string, THREE.IUniform>> = [];
  /** Moved on each frame: by the clock, seconds. */
  private readonly movers: Array<(time: number) => void> = [];
  private readonly frees: Array<() => void> = [];
  private readonly random: () => number;
  private readonly volume: Volume;
  /** The world's up in the shape's own space (it may be turned). */
  private readonly up: THREE.Vector3;

  /** `build` draws another look than the damage's own in the shape (what a spell hits: `hitAura`). */
  constructor(readonly type: DamageType, private readonly spell: Spell, private readonly cell: number, turn: THREE.Quaternion, private readonly maskUniforms: MaskUniforms, build?: (effect: SpellEffect) => void) {
    this.object3d.name = `spell-effect-${type}`;
    this.object3d.userData.noOutline = true;
    this.random = seeded(spell.at.x * 0.37 + spell.at.y * 0.73 + spell.yaw * 11 + type.length);
    this.volume = volumeOf(spell);
    this.up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn.clone().invert());
    (build ?? BUILDERS[type])(this);
  }

  /** The shape was turned (aiming it): the world's up, as its particles rise, follows. */
  turned(turn: THREE.Quaternion): void {
    this.up.set(0, 1, 0).applyQuaternion(turn.clone().invert());
  }

  /** On to `time` (seconds); `viewport` the drawing's height, pixels, for the particles' size. */
  tick(time: number, viewport: number): void {
    for (const uniforms of this.particleUniforms) {
      uniforms.uTime!.value = time;
      uniforms.uViewport!.value = viewport;
    }
    for (const move of this.movers) move(time);
  }

  /** Something of a layer's own to free with the effect. */
  onDispose(free: () => void): void {
    this.frees.push(free);
  }

  dispose(): void {
    for (const free of this.frees.splice(0)) free();
    this.object3d.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }

  // ---- What the builders use ----

  get vol(): Volume { return this.volume; }
  get sq(): number { return this.cell; }
  rand(): number { return this.random(); }

  particles(layer: ParticleLayer): void {
    const volume = this.volume;
    const count = Math.max(8, Math.min(600, Math.round(layer.count)));
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const lives = new Float32Array(count);
    const cell = this.cell;
    for (let i = 0; i < count; i++) {
      const life = layer.life * (0.7 + this.random() * 0.6);
      lives[i] = life;
      let start = volume.sample(this.random);
      let travel: THREE.Vector3 | null = null;
      if (layer.flow) {
        const { from, to } = volume.path(this.random);
        const [a, b] = layer.flow === 'out' ? [from, to] : [to, from];
        start = a;
        travel = b.sub(a).divideScalar(life);
      }
      if (layer.surface) {
        const out = start.clone().sub(volume.middle);
        if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
        // Pushed out to the edge along its way from the middle (near enough for every shape).
        for (let step = 0; step < 6; step++) {
          const further = volume.middle.clone().add(out.clone().multiplyScalar(1.15));
          if (!this.inside(further)) break;
          out.multiplyScalar(1.15);
        }
        start = volume.middle.clone().add(out);
      }
      positions.set([start.x, start.y, start.z], i * 3);
      const way = layer.direction ? layer.direction.clone() : inBall(this.random).normalize();
      const velocity = way.multiplyScalar(layer.speed * cell).add(inBall(this.random).multiplyScalar(layer.spread * cell));
      if (travel) velocity.add(travel);
      velocities.set([velocity.x, velocity.y, velocity.z], i * 3);
      seeds[i] = this.random();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
    // The points wander: never culled by their start's bounds.
    geometry.boundingSphere = new THREE.Sphere(volume.middle.clone(), volume.radius * 4 + cell * 4);
    const uniforms: Record<string, THREE.IUniform> = {
      uTime: { value: 0 }, uViewport: { value: 800 }, uNear: { value: cell },
      uSize: { value: layer.size * cell }, uGrow: { value: new THREE.Vector2(layer.grow[0], layer.grow[1]) },
      uUp: { value: this.up }, uRise: { value: (layer.rise ?? 0) * cell },
      uSwirl: { value: new THREE.Vector2((layer.swirl?.[0] ?? 0) * Math.PI * 2, (layer.swirl?.[1] ?? 0) * cell) },
      uPull: { value: layer.pull ?? 0 },
      uColor0: { value: new THREE.Color(layer.colors[0]) }, uColor1: { value: new THREE.Color(layer.colors[1]) },
      uColor2: { value: new THREE.Color(layer.colors[2]) }, uColor3: { value: new THREE.Color(layer.colors[3]) },
      uAlpha: { value: layer.alpha }, uShape: { value: layer.shape === 'soft' ? 0 : layer.shape === 'ring' ? 1 : 2 },
      ...this.maskUniforms,
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERTEX, fragmentShader: PARTICLE_FRAGMENT, uniforms,
      transparent: true, depthWrite: false, blending: layer.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 6;
    points.raycast = () => {};
    this.particleUniforms.push(uniforms);
    this.keep(geometry, material);
    this.object3d.add(points);
  }

  /** Whether a point is inside the shape (near enough: by its spine). */
  private inside(point: THREE.Vector3): boolean {
    const { spine, axis } = this.volume;
    const spacing = spine.length > 1 ? spine[0]!.at.distanceTo(spine[1]!.at) : 0;
    return spine.some((bone) => {
      const off = point.clone().sub(bone.at);
      const lengthwise = off.dot(axis);
      const across = off.sub(axis.clone().multiplyScalar(lengthwise)).length();
      return Math.abs(lengthwise) <= Math.max(spacing / 2, spine.length === 1 ? bone.radius : 0) && across <= bone.radius;
    });
  }

  /** A glowing material (added on), or a plain see-through one. */
  glow(color: string, opacity: number, additive = true, side: THREE.Side = THREE.DoubleSide): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.materials.push(material);
    return material;
  }

  mesh(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 6;
    mesh.raycast = () => {};
    this.object3d.add(mesh);
    return mesh;
  }

  keepGeometry(geometry: THREE.BufferGeometry): void {
    this.geometries.push(geometry);
  }

  keep(geometry: THREE.BufferGeometry, material: THREE.Material): void {
    this.geometries.push(geometry);
    this.materials.push(material);
  }

  move(mover: (time: number) => void): void {
    this.movers.push(mover);
  }

  /** A turn that lays +z along `axis`. */
  static facing(axis: THREE.Vector3): THREE.Quaternion {
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize());
  }

  get damage(): Spell { return this.spell; }
  /** The wall cut, for a layer's own shader. */
  get masks(): MaskUniforms { return this.maskUniforms; }
  get worldUp(): THREE.Vector3 { return this.up.clone(); }
}

// ---- Shared pieces, each fitted to the shape ----

/** Whether the shape has a way it runs (a beam, a cone): its looks stream along it. */
function streams(e: SpellEffect): boolean {
  return e.vol.kind === 'cylinder' || e.vol.kind === 'cone';
}

/** A line set, glowing. */
function lines(e: SpellEffect, points: number[], color: string, opacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
  const segments = new THREE.LineSegments(geometry, material);
  segments.renderOrder = 6;
  segments.raycast = () => {};
  e.keep(geometry, material);
  e.object3d.add(segments);
  return segments;
}

/** A grid over a box's faces, about every `step` (a cube's or a wall's skin). */
function boxGrid(size: THREE.Vector3, step: number): number[] {
  const points: number[] = [];
  const half = size.clone().multiplyScalar(0.5);
  const axes = [0, 1, 2] as const;
  for (const normal of axes) {
    const [b, c] = axes.filter((axis) => axis !== normal) as [0 | 1 | 2, 0 | 1 | 2];
    for (const side of [-1, 1]) {
      const at = (vb: number, vc: number): number[] => {
        const point = [0, 0, 0];
        point[normal] = side * half.getComponent(normal);
        point[b] = vb;
        point[c] = vc;
        return point;
      };
      const nb = Math.max(1, Math.round(size.getComponent(b) / step));
      const nc = Math.max(1, Math.round(size.getComponent(c) / step));
      for (let i = 0; i <= nb; i++) {
        const vb = -half.getComponent(b) + (size.getComponent(b) * i) / nb;
        points.push(...at(vb, -half.getComponent(c)), ...at(vb, half.getComponent(c)));
      }
      for (let i = 0; i <= nc; i++) {
        const vc = -half.getComponent(c) + (size.getComponent(c) * i) / nc;
        points.push(...at(-half.getComponent(b), vc), ...at(half.getComponent(b), vc));
      }
    }
  }
  return points;
}

/**
 * Waves going through the shape, one after another: from a sphere's middle out (rings, or shells); out to a cube's
 * faces (wire boxes, or boxes); down a beam or a cone, the width of it there (rings, or discs); up a wall (bands).
 * `sides` 6 makes the rings hexagons; `wobble` tips them as they go.
 */
function pulses(e: SpellEffect, color: string, every: number, opacity: number, style: 'ring' | 'shell', options: { count?: number; sides?: number; wobble?: number; thickness?: number } = {}): void {
  const volume = e.vol;
  const count = options.count ?? 2;
  const thickness = options.thickness ?? 0.035;
  const fade = (t: number): number => (1 - t) * Math.min(1, t * 6);
  for (let k = 0; k < count; k++) {
    const offset = k / count;
    switch (volume.kind) {
      case 'sphere': {
        const r = volume.radius;
        const up = e.worldUp;
        const mesh = style === 'ring'
          ? e.mesh(new THREE.TorusGeometry(1, thickness, 6, 64), e.glow(color, opacity))
          : e.mesh(new THREE.SphereGeometry(1, 28, 18), e.glow(color, opacity, true, THREE.BackSide));
        if (style === 'ring') mesh.quaternion.copy(SpellEffect.facing(up));
        e.move((time) => {
          const t = (time / every + offset) % 1;
          mesh.scale.setScalar(Math.max(1e-3, r * (style === 'ring' ? 0.15 + 0.9 * t : t)));
          (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * (style === 'ring' ? fade(t) : (1 - t) ** 2);
        });
        break;
      }
      case 'cube': {
        const s = volume.box!.x;
        if (style === 'ring') {
          const box = lines(e, boxGrid(new THREE.Vector3(1, 1, 1), 1), color, opacity);
          e.move((time) => {
            const t = (time / every + offset) % 1;
            box.scale.setScalar(Math.max(1e-3, s * (0.1 + 0.9 * t)));
            (box.material as THREE.LineBasicMaterial).opacity = opacity * fade(t);
          });
        } else {
          const mesh = e.mesh(new THREE.BoxGeometry(1, 1, 1), e.glow(color, opacity, true, THREE.BackSide));
          e.move((time) => {
            const t = (time / every + offset) % 1;
            mesh.scale.setScalar(Math.max(1e-3, s * t));
            (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * (1 - t) ** 2;
          });
        }
        break;
      }
      case 'cylinder':
      case 'cone': {
        const geometry = style === 'ring' ? new THREE.TorusGeometry(1, thickness, 6, options.sides ?? 48) : new THREE.CircleGeometry(1, options.sides ?? 40);
        const mesh = e.mesh(geometry, e.glow(color, opacity));
        const face = SpellEffect.facing(volume.axis);
        const wobble = options.wobble ?? 0;
        e.move((time) => {
          const t = (time / every + offset) % 1;
          mesh.position.copy(volume.from).lerp(volume.to, t);
          mesh.scale.setScalar(Math.max(1e-3, volume.widthAt(t) * (style === 'ring' ? 1 : 0.95)));
          mesh.quaternion.copy(face);
          if (wobble) mesh.rotateX(Math.sin(time * 3 + k * 2) * wobble).rotateY(Math.cos(time * 2.3 + k) * wobble);
          mesh.rotateZ(time * 0.4);
          const ends = Math.min(1, t * 8) * Math.min(1, (1 - t) * 6);
          (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * ends * (style === 'ring' ? 1 : 0.5);
        });
        break;
      }
      case 'wall': {
        // A frame round the wall, climbing it (a wide, faint one for a shell).
        const box = volume.box!;
        const width = e.sq * (style === 'ring' ? 0.035 : 0.12);
        const material = e.glow(color, opacity);
        const frame = new THREE.Group();
        for (const [x, z, sx, sz] of [[0, box.z / 2, box.x, width], [0, -box.z / 2, box.x, width], [box.x / 2, 0, width, box.z], [-box.x / 2, 0, width, box.z]] as const) {
          const bar = e.mesh(new THREE.BoxGeometry(sx + width, width, sz + width), material);
          bar.removeFromParent();
          bar.position.set(x, 0, z);
          frame.add(bar);
        }
        e.object3d.add(frame);
        const wobble = options.wobble ?? 0;
        e.move((time) => {
          const t = (time / every + offset) % 1;
          frame.position.set(0, -box.y / 2 + box.y * t, 0);
          frame.rotation.set(0, 0, wobble ? Math.sin(time * 2 + k) * wobble * 0.15 : 0);
          material.opacity = opacity * (style === 'ring' ? 1 : 0.35) * Math.min(1, t * 8) * Math.min(1, (1 - t) * 6);
        });
        break;
      }
    }
  }
}

/** A jagged path from a to b, split `depth` times, each middle pushed aside by up to `roughness` of the length. */
function jagged(a: THREE.Vector3, b: THREE.Vector3, depth: number, roughness: number, random: () => number): THREE.Vector3[] {
  let points = [a, b];
  let push = a.distanceTo(b) * roughness;
  for (let level = 0; level < depth; level++) {
    const next: THREE.Vector3[] = [points[0]!];
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]!;
      const to = points[i]!;
      const middle = from.clone().add(to).multiplyScalar(0.5).add(inBall(random).multiplyScalar(push));
      next.push(middle, to);
    }
    points = next;
    push *= 0.55;
  }
  return points;
}

/**
 * Things crossing the shape along its way (`Volume.path`), over and over: needles, shards, rocks. `geometry` points
 * along +y; it is laid along its crossing and sized by `scale` (x, y, z; y its length).
 */
function flights(e: SpellEffect, geometry: THREE.BufferGeometry, material: THREE.Material, count: number, scale: THREE.Vector3, speed: number, options: { reverse?: boolean; spin?: number } = {}): void {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  e.keep(geometry, material);
  e.object3d.add(mesh);
  const random = (): number => e.rand();
  const trips = Array.from({ length: count }, () => {
    const { from, to } = e.vol.path(random);
    const [a, b] = options.reverse ? [to, from] : [from, to];
    return { a, b, turn: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()), offset: random(), speed: speed * (0.75 + random() * 0.5), roll: random() * 6.28 };
  });
  const matrix = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  e.move((time) => {
    trips.forEach((trip, index) => {
      const t = (time * trip.speed + trip.offset) % 1;
      at.copy(trip.a).lerp(trip.b, t);
      turn.copy(trip.turn);
      if (options.spin) turn.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * options.spin + trip.roll));
      // In and out of sight at the ends of the way.
      const grow = Math.min(1, t * 6) * Math.min(1, (1 - t) * 8);
      size.copy(scale).multiplyScalar(Math.max(1e-3, grow));
      matrix.compose(at, turn, size);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
}

/** Rays along the shape's ways (out of a sphere's middle, down a beam, fanned in a cone, up a wall), each pulsing. */
function rays(e: SpellEffect, color: string, count: number, width: number, opacity: number): void {
  const random = (): number => e.rand();
  for (let i = 0; i < count; i++) {
    const { from, to } = e.vol.path(random);
    const length = from.distanceTo(to);
    if (length < 1e-3) continue;
    const material = e.glow(color, opacity);
    const way = to.clone().sub(from).normalize();
    // Two planes crossed along the ray: it shows from any side.
    for (const roll of [0, Math.PI / 2]) {
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.translate(0, 0.5, 0);
      const ray = e.mesh(geometry, material);
      ray.position.copy(from);
      ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), way).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), roll));
      ray.scale.set(width, length, 1);
    }
    const phase = random() * 6.28;
    const rate = 2 + random() * 2;
    e.move((time) => { material.opacity = opacity * (0.45 + 0.55 * Math.max(0, Math.sin(time * rate + phase))); });
  }
}

/**
 * Ice crystals fitted to the shape: bristling out of a sphere, squared in a cube, standing out round a beam, pointing
 * down a cone (bigger toward its base), upright in a wall.
 */
function crystals(e: SpellEffect, color: string, opacity: number): void {
  const volume = e.vol;
  const count = Math.max(6, Math.min(48, Math.round(density(e, volume.kind === 'wall' ? 20 : 14))));
  const geometry = new THREE.OctahedronGeometry(1, 0);
  geometry.scale(0.32, 1, 0.32);
  const material = e.glow(color, opacity, false);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  e.keep(geometry, material);
  e.object3d.add(mesh);
  const random = (): number => e.rand();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    let at = volume.sample(random);
    let way: THREE.Vector3;
    let size = e.sq * (0.15 + random() * 0.3);
    switch (volume.kind) {
      case 'sphere':
        way = at.lengthSq() > 1e-6 ? at.clone().normalize() : anyWay(random);
        at = way.clone().multiplyScalar(volume.radius * (0.3 + random() * 0.6));
        break;
      case 'cube': {
        const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
        way = axes[Math.floor(random() * 3)]!.multiplyScalar(random() < 0.5 ? -1 : 1);
        break;
      }
      case 'cylinder': {
        const off = at.clone().sub(volume.from);
        const across = off.sub(volume.axis.clone().multiplyScalar(off.dot(volume.axis)));
        way = across.lengthSq() > 1e-6 ? across.normalize() : anyWay(random);
        break;
      }
      case 'cone': {
        const { from, to } = volume.path(random);
        way = to.clone().sub(from).normalize();
        const f = random();
        at = from.clone().lerp(to, f);
        size *= 0.5 + f * 1.2;
        break;
      }
      default:
        way = yAxis.clone().add(new THREE.Vector3((random() - 0.5) * 0.4, 0, (random() - 0.5) * 0.4)).normalize();
        size = Math.min(volume.box!.y * 0.35, e.sq * (0.4 + random() * 0.6));
        at.y = -volume.box!.y / 2 + size * (0.6 + random() * 0.4) + random() * (volume.box!.y - size);
    }
    const turn = new THREE.Quaternion().setFromUnitVectors(yAxis, way).multiply(new THREE.Quaternion().setFromAxisAngle(yAxis, random() * 6.28));
    matrix.compose(at, turn, new THREE.Vector3().setScalar(size));
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  e.move((time) => {
    material.opacity = opacity * (0.85 + 0.15 * Math.sin(time * 2.1));
    // A sphere's crystals turn slowly together.
    if (volume.kind === 'sphere') mesh.rotation.y = time * 0.15;
  });
}

/**
 * Blades' arcs, each a flash: round a sphere every way; squared to a cube's faces; across a beam or a cone, the width
 * of it there; slanting across a wall's face.
 */
function arcs(e: SpellEffect, core: string, edge: string): void {
  const volume = e.vol;
  const count = Math.max(3, Math.min(12, Math.round(density(e, 4))));
  const random = (): number => e.rand();
  for (let i = 0; i < count; i++) {
    let center = volume.middle.clone();
    let radius = volume.radius * (0.6 + random() * 0.3);
    let base = new THREE.Quaternion();
    switch (volume.kind) {
      case 'sphere':
        base.setFromEuler(new THREE.Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI));
        break;
      case 'cube': {
        const quarter = (): number => Math.floor(random() * 4) * (Math.PI / 2);
        base.setFromEuler(new THREE.Euler(quarter(), quarter(), Math.PI / 4 + quarter()));
        radius = volume.box!.x * (0.45 + random() * 0.2);
        break;
      }
      case 'cylinder':
      case 'cone': {
        const f = (i + 0.5) / count;
        center = volume.from.clone().lerp(volume.to, f);
        radius = Math.max(e.sq * 0.3, volume.widthAt(f) * 0.95);
        base = SpellEffect.facing(volume.axis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), random() * 6.28));
        break;
      }
      case 'wall':
        center = new THREE.Vector3((random() - 0.5) * volume.box!.x * 0.8, 0, 0);
        radius = volume.box!.y * (0.45 + random() * 0.15);
        base.setFromAxisAngle(new THREE.Vector3(0, 0, 1), random() * 6.28);
        break;
    }
    const thin = e.mesh(new THREE.TorusGeometry(1, 0.035, 4, 40, Math.PI * 0.75), e.glow(core, 0.9));
    const wide = e.mesh(new THREE.TorusGeometry(1, 0.1, 4, 40, Math.PI * 0.75), e.glow(edge, 0.4));
    for (const mesh of [thin, wide]) { mesh.position.copy(center); mesh.scale.setScalar(radius); }
    const offset = random();
    e.move((time) => {
      const t = (time * 0.9 + offset) % 1;
      const sweep = t * Math.PI * 1.5;
      for (const mesh of [thin, wide]) {
        mesh.quaternion.copy(base);
        mesh.rotateZ(sweep);
        mesh.visible = t < 0.45;
      }
      const flash = t < 0.45 ? Math.sin((t / 0.45) * Math.PI) : 0;
      (thin.material as THREE.MeshBasicMaterial).opacity = 0.9 * flash;
      (wide.material as THREE.MeshBasicMaterial).opacity = 0.4 * flash;
    });
  }
}

/** A force's lattice: a breathing net round a sphere, a grid over a cube's or a wall's skin, hexagons down a beam or a cone. */
function lattice(e: SpellEffect, color: string): void {
  const volume = e.vol;
  if (volume.kind === 'sphere') {
    const shell = new THREE.IcosahedronGeometry(1, 1);
    const edges = new THREE.EdgesGeometry(shell);
    shell.dispose();
    const net = lines(e, Array.from(edges.getAttribute('position').array as ArrayLike<number>), color, 0.6);
    edges.dispose();
    e.move((time) => {
      net.rotation.set(time * 0.21, time * 0.33, 0);
      net.scale.setScalar(volume.radius * (0.92 + 0.06 * Math.sin(time * 2.4)));
      (net.material as THREE.LineBasicMaterial).opacity = 0.45 + 0.25 * Math.sin(time * 2.4);
    });
    return;
  }
  if (volume.box) {
    const grid = lines(e, boxGrid(volume.box, e.sq * 0.5), color, 0.55);
    e.move((time) => {
      grid.scale.setScalar(0.985 + 0.015 * Math.sin(time * 2.4));
      (grid.material as THREE.LineBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(time * 2.4);
    });
    return;
  }
  // Six rails down its length, at a hexagon's corners, and hexagons running along them.
  const points: number[] = [];
  const face = SpellEffect.facing(volume.axis);
  for (let corner = 0; corner < 6; corner++) {
    const angle = (corner / 6) * Math.PI * 2;
    const across = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).applyQuaternion(face);
    const a = volume.from.clone().add(across.clone().multiplyScalar(volume.widthAt(0)));
    const b = volume.to.clone().add(across.clone().multiplyScalar(volume.widthAt(1)));
    points.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const rails = lines(e, points, color, 0.4);
  e.move((time) => { (rails.material as THREE.LineBasicMaterial).opacity = 0.3 + 0.2 * Math.sin(time * 2.4); });
  pulses(e, color, 1.4, 0.8, 'ring', { count: 4, sides: 6, thickness: 0.03 });
}

/** Lightning bolts along the shape's ways (out of a sphere's middle, to a cube's faces, down a beam, fanned in a cone, up a wall). */
function bolts(e: SpellEffect, outer: string): void {
  const volume = e.vol;
  const count = Math.max(2, Math.min(7, Math.round(density(e, 3))));
  const core = e.glow('#ffffff', 0.95);
  const halo = e.glow(outer, 0.35);
  const pairs: Array<{ core: THREE.Mesh | null; halo: THREE.Mesh | null }> = Array.from({ length: count }, () => ({ core: null, halo: null }));
  let step = -1;
  const random = (): number => e.rand();
  const strokes = (points: THREE.Vector3[]): THREE.CurvePath<THREE.Vector3> => {
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let i = 1; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i - 1]!, points[i]!));
    return curve;
  };
  e.move((time) => {
    const now = Math.floor(time * 12);
    if (now === step) return;
    step = now;
    pairs.forEach((pair, index) => {
      for (const mesh of [pair.core, pair.halo]) if (mesh) { mesh.geometry.dispose(); mesh.removeFromParent(); }
      pair.core = null;
      pair.halo = null;
      // Not every bolt every flash; a beam's first bolt runs its whole length, always.
      const spine = volume.kind === 'cylinder' && index === 0;
      if (!spine && random() < 0.35) return;
      const { from, to } = spine ? { from: volume.from.clone(), to: volume.to.clone() } : volume.path(random);
      const path = jagged(from, to, 5, spine ? 0.08 : 0.2, random);
      const fork = path[Math.floor(path.length * (0.3 + random() * 0.4))]!;
      const branch = jagged(fork, fork.clone().lerp(volume.path(random).to, 0.5), 3, 0.3, random);
      const joined = (radius: number): THREE.BufferGeometry => {
        const a = new THREE.TubeGeometry(strokes(path), path.length * 2, radius, 4, false);
        const b = new THREE.TubeGeometry(strokes(branch), branch.length * 2, radius * 0.7, 4, false);
        const merged = mergeTubes([a, b]);
        a.dispose();
        b.dispose();
        return merged;
      };
      pair.core = new THREE.Mesh(joined(e.sq * 0.014), core);
      pair.halo = new THREE.Mesh(joined(e.sq * 0.06), halo);
      for (const mesh of [pair.core, pair.halo]) { mesh.renderOrder = 7; mesh.raycast = () => {}; e.object3d.add(mesh); }
    });
    halo.opacity = 0.25 + random() * 0.2;
  });
  e.onDispose(() => { for (const pair of pairs) for (const mesh of [pair.core, pair.halo]) mesh?.geometry.dispose(); });
}

// ---- Flames ----

const NOISE = /* glsl */ `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return v; }
`;

/**
 * A flame, as stylized anime fire is drawn: a teardrop shell standing on its base, bent and twisted up its height by
 * a slow noise, torn by a scrolling noise into a few hard-edged shards (more of it torn away toward the tip), flat
 * coloured from orange at its foot to crimson at its tip, and moved on in steps, twelve a second, not smoothly.
 * The shell is built standing in the world's up, wherever the shape is turned.
 */
const FLAME_VERTEX = /* glsl */ `
attribute vec3 aBase;
attribute vec2 aSize;
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying vec3 vWorld;
${NOISE}
void main() {
  float t = floor(uTime * 12.0) / 12.0;
  float h = position.y;
  // The whole flame leans and bends, more toward its tip, and twists round as it rises.
  float leanX = noise3(vec3(h * 1.3 - t * 1.7, aSeed * 7.0, 0.0)) - 0.5;
  float leanZ = noise3(vec3(h * 1.3 - t * 1.7, aSeed * 7.0, 5.0)) - 0.5;
  float twist = h * 2.4 + sin(t * 2.7 + aSeed * 10.0) * 0.8;
  vec2 round = vec2(cos(twist) * position.x - sin(twist) * position.z, sin(twist) * position.x + cos(twist) * position.z);
  float leap = 0.85 + 0.15 * sin(t * 4.3 + aSeed * 20.0);
  vec3 offset = vec3(round.x * aSize.x + leanX * h * h * aSize.y * 1.1, h * aSize.y * leap, round.y * aSize.x + leanZ * h * h * aSize.y * 1.1);
  vec3 world = (modelMatrix * vec4(aBase, 1.0)).xyz + offset;
  vUv = uv;
  vSeed = aSeed;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const FLAME_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uHot;
uniform vec3 uCore;
uniform sampler2D mask;
uniform vec4 maskBox;
uniform float useMask;
varying vec2 vUv;
varying float vSeed;
varying vec3 vWorld;
${NOISE}
void main() {
  if (useMask > 0.5) {
    vec2 m = (vWorld.xz - maskBox.xy) / (maskBox.zw - maskBox.xy);
    if (m.x < 0.0 || m.y < 0.0 || m.x > 1.0 || m.y > 1.0 || texture2D(mask, m).r < 0.5) discard;
  }
  float t = floor(uTime * 12.0) / 12.0;
  float h = vUv.y;
  // Round the shell without a seam, and up it, scrolling upward.
  float a = vUv.x * 6.2831;
  vec3 q = vec3(cos(a) * 0.9, sin(a) * 0.9, h * 2.4 - t * 2.2) + vec3(vSeed * 11.0);
  float n = noise3(q) * 0.7 + noise3(q * 2.1 + 4.0) * 0.3;
  // Torn: hard edges, more torn away up toward the tip, flickering.
  float cut = mix(0.36, 0.7, h) + 0.05 * sin(t * 9.0 + vSeed * 30.0);
  if (n < cut || h > 0.97) discard;
  vec3 color = mix(uHot, uDeep, smoothstep(0.3, 0.9, h));
  color = mix(color, uCore, (1.0 - smoothstep(0.0, 0.28, h)) * 0.55);
  gl_FragColor = vec4(color * 1.15, 1.0);
  #include <colorspace_fragment>
}`;

/** A teardrop's outline, foot to tip (x the radius, y the height, both 0..1): what a flame's shell is turned from. */
function flameProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const y = i / 20;
    points.push(new THREE.Vector2(Math.max(1e-3, 1.4 * Math.sqrt(y) * (1 - y) ** 1.5), y));
  }
  return points;
}

/**
 * Flames fitted to the shape: low in a sphere or a cube; a row along a wall's foot, as tall as the wall; up a standing
 * column; scattered down a beam or a cone (whose breath streams with them).
 */
function flames(e: SpellEffect): void {
  const volume = e.vol;
  const wall = volume.kind === 'wall';
  // Sized to the shape: as tall as a sphere's or a cube's reach, a beam's or a cone's width, a wall's height; fat;
  // and as many as cover its floor, shoulder to shoulder.
  const run = volume.from.distanceTo(volume.to);
  const across = volume.kind === 'cone' ? volume.widthAt(0.75) : volume.kind === 'cube' || volume.kind === 'cylinder' ? volume.widthAt(0.5) : volume.radius;
  const tallest = wall ? volume.box!.y : Math.max(e.sq * 0.8, Math.min(e.sq * 9, across * (volume.kind === 'cube' ? 1.6 : 1.05)));
  const fat = wall ? 0.3 : 0.34;
  const foot = tallest * 0.8 * fat * 0.45;
  const floor = wall ? volume.box!.x * Math.max(volume.box!.z, foot * 2)
    : volume.kind === 'sphere' ? Math.PI * volume.radius ** 2
      : volume.kind === 'cube' ? volume.box!.x ** 2
        : volume.kind === 'cone' ? run * volume.widthAt(1)
          : run * across * 2;
  const count = Math.max(4, Math.min(180, Math.round(wall ? (volume.box!.x / foot) * 1.4 : (floor / (Math.PI * foot * foot)) * (volume.kind === 'cube' ? 1.6 : 1.1))));
  const shell = new THREE.LatheGeometry(flameProfile(), 18);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = shell.index;
  geometry.setAttribute('position', shell.getAttribute('position'));
  geometry.setAttribute('uv', shell.getAttribute('uv'));
  const bases = new Float32Array(count * 3);
  const sizes = new Float32Array(count * 2);
  const seeds = new Float32Array(count);
  const up = e.worldUp;
  const random = (): number => e.rand();
  for (let i = 0; i < count; i++) {
    let base: THREE.Vector3;
    if (wall) {
      base = new THREE.Vector3((random() - 0.5) * volume.box!.x, -volume.box!.y / 2, (random() - 0.5) * volume.box!.z);
    } else {
      // The lower of two points: the fire sits low; in a sphere or a cube, on its floor.
      const a = volume.sample(random);
      const b = volume.sample(random);
      base = a.dot(up) < b.dot(up) ? a : b;
      if (volume.kind === 'sphere' || volume.kind === 'cube') {
        const across = base.clone().sub(up.clone().multiplyScalar(base.dot(up)));
        const drop = volume.kind === 'sphere'
          ? Math.sqrt(Math.max(0, volume.radius ** 2 - across.lengthSq()))
          : (volume.box!.x / 2) * (Math.abs(up.x) + Math.abs(up.y) + Math.abs(up.z));
        base = across.sub(up.clone().multiplyScalar(drop * 0.95));
      }
      // Never under the floor the spell stands over.
      const below = -e.damage.at.h - base.dot(up);
      if (below > 0) base.add(up.clone().multiplyScalar(below));
    }
    bases.set([base.x, base.y, base.z], i * 3);
    const height = tallest * (0.6 + random() * 0.4);
    // The shell's radius, and its height.
    sizes.set([height * fat * (0.85 + random() * 0.3), height], i * 2);
    seeds[i] = random();
  }
  geometry.setAttribute('aBase', new THREE.InstancedBufferAttribute(bases, 3));
  geometry.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 2));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    vertexShader: FLAME_VERTEX, fragmentShader: FLAME_FRAGMENT,
    uniforms: {
      uTime: { value: 0 }, uDeep: { value: new THREE.Color('#ad002d') }, uHot: { value: new THREE.Color('#ee7800') }, uCore: { value: new THREE.Color('#ffc24a') },
      ...e.masks,
    },
    // Flat and solid, as drawn fire is; its glow is a haze of its own (`fire`).
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.raycast = () => {};
  e.keep(geometry, material);
  e.keepGeometry(shell);
  e.object3d.add(mesh);
  e.move((time) => { material.uniforms.uTime!.value = time; });
}

// ---- The damage types ----

type Builder = (effect: SpellEffect) => void;

const BUILDERS: Record<DamageType, Builder> = {
  acid: (e) => {
    const n = density(e, 60);
    if (streams(e)) {
      // A spray: droplets flung down its length, splashing.
      e.particles({ count: n * 1.2, size: 0.09, grow: [0.8, 1.3], life: 0.9, speed: 0, spread: 0.12, rise: -0.8, flow: 'out', colors: ['#fffbc0', '#fff04a', '#e0c81a', '#8a7a0a'], alpha: 0.95, shape: 'spark', additive: true });
      e.particles({ count: n * 0.5, size: 0.18, grow: [0.5, 1.5], life: 1.4, speed: 0, spread: 0.06, rise: 0.2, colors: ['#fffbc0', '#fff04a', '#e0c81a', '#8a7a0a'], alpha: 0.8, shape: 'ring', additive: true });
    } else if (e.vol.kind === 'wall') {
      // Running down the wall, bubbling on it.
      e.particles({ count: n, size: 0.08, grow: [1, 0.7], life: 1.6, speed: 0, spread: 0.02, flow: 'back', colors: ['#fff59a', '#ffe12e', '#c8a80c', '#5a4a04'], alpha: 0.9, shape: 'spark', additive: true });
      e.particles({ count: n * 0.6, size: 0.16, grow: [0.6, 1.6], life: 1.8, speed: 0, spread: 0.04, rise: 0.1, colors: ['#fffbc0', '#fff04a', '#e0c81a', '#8a7a0a'], alpha: 0.85, shape: 'ring', additive: true });
    } else {
      // Bubbles rising and swelling until they burst; drips falling.
      e.particles({ count: n, size: 0.18, grow: [0.6, 1.6], life: 1.8, speed: 0, spread: 0.08, rise: 0.25, colors: ['#fffbc0', '#fff04a', '#e0c81a', '#8a7a0a'], alpha: 0.9, shape: 'ring', additive: true });
      e.particles({ count: n * 0.5, size: 0.08, grow: [1, 0.6], life: 1.2, speed: 0, spread: 0.05, rise: -1.6, colors: ['#fff59a', '#ffe12e', '#c8a80c', '#5a4a04'], alpha: 0.85, shape: 'spark', additive: true });
    }
    e.particles({ count: n * 0.4, size: 0.5, grow: [0.7, 1.3], life: 3, speed: 0, spread: 0.05, rise: 0.05, colors: ['#d8c018', '#b8a012', '#7a6a0c', '#3a3204'], alpha: 0.28, shape: 'soft', additive: false });
  },
  bludgeoning: (e) => {
    pulses(e, '#e6cfa4', 1.1, 0.75, 'ring', { thickness: 0.05 });
    // Rocks and chips: thrown out of a sphere or a cube, hurled down a beam or a cone, falling down a wall.
    const rock = new THREE.DodecahedronGeometry(1, 0);
    flights(e, rock, e.glow('#b39a78', 0.95, false), Math.max(6, Math.min(30, Math.round(density(e, 10)))), new THREE.Vector3(e.sq * 0.09, e.sq * 0.09, e.sq * 0.09), 0.8, { reverse: e.vol.kind === 'wall', spin: 6 });
    e.particles({ count: density(e, 40), size: 0.1, grow: [1, 0.8], life: 1.1, speed: 0, spread: 0.3, rise: -2.2, flow: e.vol.kind === 'wall' ? 'back' : 'out', colors: ['#f0dcb4', '#c9a77c', '#8b6f4e', '#4a3a2a'], alpha: 0.9, shape: 'spark', additive: false });
    e.particles({ count: density(e, 25), size: 0.55, grow: [0.6, 1.5], life: 2.2, speed: 0.3, spread: 0.1, colors: ['#b39a78', '#8b7458', '#5e4e3c', '#2e261e'], alpha: 0.3, shape: 'soft', additive: false });
  },
  cold: (e) => {
    crystals(e, '#bfefff', 0.55);
    if (streams(e)) {
      // A frost breath streaming down it.
      e.particles({ count: density(e, 70), size: 0.45, grow: [0.5, 1.6], life: 1.6, speed: 0, spread: 0.06, flow: 'out', colors: ['#f2feff', '#a9dcf2', '#3e737a', '#09304c'], alpha: 0.35, shape: 'soft', additive: false });
      e.particles({ count: density(e, 70), size: 0.06, grow: [1, 0.4], life: 1.2, speed: 0, spread: 0.1, flow: 'out', colors: ['#ffffff', '#e6f9ff', '#8adaff', '#3e8fb0'], alpha: 1, shape: 'spark', additive: true });
    } else {
      e.particles({ count: density(e, 40), size: 0.6, grow: [0.8, 1.4], life: 3.5, speed: 0.05, spread: 0.08, colors: ['#f2feff', '#a9dcf2', '#3e737a', '#09304c'], alpha: 0.3, shape: 'soft', additive: false });
      e.particles({ count: density(e, 60), size: 0.06, grow: [1, 0.4], life: 2, speed: 0, spread: 0.1, rise: 0.15, colors: ['#ffffff', '#e6f9ff', '#8adaff', '#3e8fb0'], alpha: 1, shape: 'spark', additive: true });
    }
  },
  explosion: (e) => {
    const n = density(e, 120);
    // A blast along the shape's way: out of a sphere's middle, to a cube's faces, down a beam or a cone, up a wall.
    e.particles({ count: n, size: 0.42, grow: [0.6, 1.4], life: 1.1, speed: 0, spread: 0.12, rise: 0.8, flow: 'out', colors: ['#fff3d0', '#ffb02e', '#ff3d10', '#3a0c06'], alpha: 0.75, shape: 'soft', additive: true });
    e.particles({ count: n * 0.3, size: 0.6, grow: [0.6, 1.8], life: 2.2, speed: 0, spread: 0.08, rise: 0.8, colors: ['#5a2a14', '#3a2620', '#262020', '#181616'], alpha: 0.3, shape: 'soft', additive: false });
    e.particles({ count: n * 0.35, size: 0.06, grow: [1, 0.3], life: 1.6, speed: 0, spread: 0.35, rise: 1.2, flow: 'out', swirl: [0.6, 0.4], colors: ['#fff7d6', '#ffcf70', '#ff7a1a', '#7a1a06'], alpha: 1, shape: 'spark', additive: true });
    if (!streams(e)) pulses(e, '#ffb02e', 1.1, 0.3, 'shell', { count: 1 });
  },
  fire: (e) => {
    // Drawn fire (`flames`), with a glow round it; down a beam or a cone, a breath of it streams; sharp embers flying up.
    flames(e);
    e.particles({ count: density(e, 18), size: 1.1, grow: [0.8, 1.2], life: 1.6, speed: 0, spread: 0.04, rise: 0.15, colors: ['#ee7800', '#d0300e', '#ad002d', '#3a0008'], alpha: 0.16, shape: 'soft', additive: true });
    if (streams(e)) e.particles({ count: density(e, 50), size: 0.3, grow: [0.5, 1.2], life: 0.9, speed: 0, spread: 0.06, rise: 0.4, flow: 'out', colors: ['#ffc24a', '#ee7800', '#ad002d', '#3a0008'], alpha: 0.5, shape: 'soft', additive: true });
    e.particles({ count: density(e, 30), size: 0.06, grow: [1, 0.4], life: 1.4, speed: 0.1, spread: 0.25, rise: 1.6, swirl: [0.5, 0.3], colors: ['#ffd27a', '#ee7800', '#d0300e', '#ad002d'], alpha: 1, shape: 'spark', additive: true });
  },
  force: (e) => {
    lattice(e, '#ffb0b0');
    if (e.vol.kind === 'sphere' || e.vol.kind === 'cube') {
      pulses(e, '#ff3b3b', 1.6, 0.18, 'shell', { count: 1 });
      // Motes drawn in from its skin.
      e.particles({ count: density(e, 70), size: 0.08, grow: [1, 0.5], life: 1.4, speed: 0, spread: 0, pull: 1, surface: true, colors: ['#ffc0c0', '#ff6a6a', '#d01c2a', '#5a0008'], alpha: 1, shape: 'spark', additive: true });
    } else {
      e.particles({ count: density(e, 60), size: 0.07, grow: [1, 0.5], life: 1.2, speed: 0, spread: 0.02, flow: 'out', colors: ['#ffc0c0', '#ff6a6a', '#d01c2a', '#5a0008'], alpha: 1, shape: 'spark', additive: true });
    }
  },
  lightning: (e) => {
    bolts(e, '#3aa0ff');
    e.particles({ count: density(e, 60), size: 0.05, grow: [1, 0.2], life: 0.5, speed: streams(e) ? 0 : 1.6, spread: 0.6, rise: -1, ...(streams(e) ? { flow: 'out' as const } : {}), colors: ['#ffffff', '#c9ecff', '#3aa0ff', '#1e5b95'], alpha: 1, shape: 'spark', additive: true });
    e.particles({ count: density(e, 20), size: 0.6, grow: [0.8, 1.2], life: 1.5, speed: 0, spread: 0.05, colors: ['#3d6ab0', '#2a4a80', '#1a2e50', '#0b1528'], alpha: 0.18, shape: 'soft', additive: true });
  },
  necrotic: (e) => {
    // Dark smoke writhing through it; sickly motes sinking.
    e.particles({ count: density(e, 60), size: 0.65, grow: [0.7, 1.4], life: 2.6, speed: 0, spread: 0.1, rise: 0.1, swirl: [0.25, 0.6], colors: ['#4a1f66', '#2a0f3a', '#160820', '#050208'], alpha: 0.5, shape: 'soft', additive: false });
    e.particles({ count: density(e, 50), size: 0.07, grow: [1, 0.4], life: 2.2, speed: 0, spread: 0.05, rise: -0.5, swirl: [0.4, 0.3], colors: ['#c8ffd4', '#7dff9a', '#2f8a4a', '#0b2a16'], alpha: 0.95, shape: 'spark', additive: true });
    if (e.vol.kind === 'sphere' || e.vol.kind === 'cube') {
      // Wisps drawn in from its skin, as life drains.
      e.particles({ count: density(e, 40), size: 0.12, grow: [1.2, 0.3], life: 1.6, speed: 0, spread: 0, pull: 1, surface: true, colors: ['#8a4fb0', '#5a2a80', '#2a0f3a', '#000000'], alpha: 0.7, shape: 'soft', additive: false });
    } else {
      // Down a beam or a cone, a dark breath; up a wall, wisps rising.
      e.particles({ count: density(e, 50), size: 0.35, grow: [0.6, 1.6], life: 1.8, speed: 0, spread: 0.05, flow: 'out', swirl: [0.3, 0.3], colors: ['#5a2a80', '#2a0f3a', '#100618', '#000000'], alpha: 0.55, shape: 'soft', additive: false });
    }
  },
  piercing: (e) => {
    // Needles along its way: out of a sphere's middle, to a cube's faces, down a beam, fanned in a cone, spikes up a wall.
    const needle = new THREE.ConeGeometry(1, 1, 5);
    flights(e, needle, e.glow('#f2f6fa', 0.85), Math.max(6, Math.min(40, Math.round(density(e, 16)))), new THREE.Vector3(e.sq * 0.03, e.sq * 0.6, e.sq * 0.03), 0.55);
    e.particles({ count: density(e, 50), size: 0.05, grow: [1, 0.2], life: 0.6, speed: 0, spread: 0.1, flow: 'out', colors: ['#ffffff', '#dfe6ee', '#8aa0b4', '#3a4a5a'], alpha: 0.9, shape: 'spark', additive: true });
  },
  poison: (e) => {
    // A sickly cloud turning slowly, bubbles in it; down a beam or a cone, the gas streams; up a wall, it seeps.
    e.particles({ count: density(e, 70), size: 0.8, grow: [0.7, 1.3], life: 3.2, speed: 0, spread: 0.06, rise: 0.04, swirl: [0.15, 0.5], colors: ['#c9ff6a', '#7cbf2a', '#4a7a1a', '#3a1e4f'], alpha: 0.32, shape: 'soft', additive: false });
    if (streams(e) || e.vol.kind === 'wall') e.particles({ count: density(e, 50), size: 0.5, grow: [0.4, 1.5], life: streams(e) ? 1.8 : 3, speed: 0, spread: 0.04, flow: 'out', colors: ['#d8ff8a', '#9ad84a', '#5a8a20', '#2a1a3a'], alpha: 0.35, shape: 'soft', additive: false });
    e.particles({ count: density(e, 35), size: 0.12, grow: [0.6, 1.4], life: 2, speed: 0, spread: 0.05, rise: 0.3, colors: ['#e6ff9a', '#b6ff5c', '#7cbf2a', '#3a5a10'], alpha: 0.8, shape: 'ring', additive: true });
    e.particles({ count: density(e, 30), size: 0.06, grow: [1, 0.5], life: 2.4, speed: 0, spread: 0.08, swirl: [0.3, 0.4], colors: ['#e0c8ff', '#c9a0ff', '#8a5cc0', '#3a1e4f'], alpha: 0.9, shape: 'spark', additive: true });
  },
  psychic: (e) => {
    const volume = e.vol;
    const colors = ['#ff4fd8', '#7af0ff', '#c46bff'];
    if (volume.kind === 'sphere' || volume.kind === 'cube') {
      // Rings round its middle: tumbling every which way in a sphere, a gyroscope's three in a cube.
      colors.forEach((color, k) => {
        const ring = e.mesh(new THREE.TorusGeometry(1, 0.025, 6, 64), e.glow(color, 0.7));
        ring.scale.setScalar((volume.kind === 'cube' ? volume.box!.x * 0.5 : volume.radius) * (0.6 + k * 0.15));
        const speed = 0.4 + k * 0.25;
        e.move((time) => {
          if (volume.kind === 'cube') ring.rotation.set(k === 0 ? time * speed : Math.PI / 2, k === 1 ? time * speed : 0, k === 2 ? time * speed : 0);
          else ring.rotation.set(time * speed + k * 1.1, time * speed * 0.7 + k * 2.1, time * 0.3 * k);
          (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(time * 3 + k * 2);
        });
      });
    } else {
      // Waves of thought down a beam or a cone, up a wall, wavering as they go.
      pulses(e, '#ff4fd8', 1.6, 0.8, 'ring', { count: 3, wobble: 0.35 });
      pulses(e, '#7af0ff', 2.1, 0.5, 'ring', { count: 2, wobble: 0.5, thickness: 0.02 });
    }
    e.particles({ count: density(e, 70), size: 0.09, grow: [0.6, 1.2], life: 2, speed: 0, spread: 0.05, swirl: [0.8, 0.9], ...(streams(e) ? { flow: 'out' as const } : {}), colors: ['#ffd0f6', '#ff4fd8', '#8a5cff', '#2a0e4a'], alpha: 0.9, shape: 'spark', additive: true });
    e.particles({ count: density(e, 30), size: 0.5, grow: [0.5, 1.5], life: 2.4, speed: 0, spread: 0.04, colors: ['#ff8af0', '#c46bff', '#5a2aa0', '#1a0a30'], alpha: 0.22, shape: 'soft', additive: true });
  },
  radiant: (e) => {
    const volume = e.vol;
    // Light along its ways: out of a sphere's or a cube's heart, a beam's shafts, a cone's spotlight, a wall's columns.
    rays(e, '#ffe08a', Math.max(8, Math.min(24, Math.round(density(e, 8)))), e.sq * 0.07, 0.45);
    if (volume.kind !== 'wall') {
      const heart = e.mesh(new THREE.SphereGeometry(1, 16, 12), e.glow('#ffe9a8', 0.35));
      heart.position.copy(volume.kind === 'sphere' || volume.kind === 'cube' ? volume.middle : volume.from);
      e.move((time) => heart.scale.setScalar(Math.min(volume.radius * 0.15, e.sq * 0.14) * (0.85 + 0.15 * Math.sin(time * 5))));
    }
    if (volume.kind === 'cylinder') {
      // A beam's bright core.
      const core = e.mesh(new THREE.CylinderGeometry(1, 1, 1, 16, 1, true), e.glow('#fff6d0', 0.25));
      core.position.copy(volume.from).lerp(volume.to, 0.5);
      core.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), volume.axis);
      core.scale.set(volume.widthAt(0.5) * 0.3, volume.from.distanceTo(volume.to), volume.widthAt(0.5) * 0.3);
      e.move((time) => { (core.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.1 * Math.sin(time * 6); });
    }
    e.particles({ count: density(e, 80), size: 0.07, grow: [1, 0.3], life: 2, speed: 0, spread: 0.06, rise: streams(e) ? 0 : 0.35, ...(volume.kind === 'sphere' || volume.kind === 'cube' ? {} : { flow: 'out' as const }), colors: ['#ffffff', '#fffbe6', '#ffd36a', '#a8741a'], alpha: 1, shape: 'spark', additive: true });
  },
  slashing: (e) => {
    arcs(e, '#ffffff', '#9aa0a8');
    e.particles({ count: density(e, 40), size: 0.06, grow: [1, 0.5], life: 1.1, speed: 0.4, spread: 0.3, rise: -2.4, colors: ['#ffffff', '#d0d4da', '#8a9098', '#3a3e44'], alpha: 0.9, shape: 'spark', additive: true });
    e.particles({ count: density(e, 30), size: 0.05, grow: [1, 0.2], life: 0.5, speed: streams(e) ? 0 : 1.5, spread: 0.3, ...(streams(e) ? { flow: 'out' as const } : {}), colors: ['#ffffff', '#ffe0e0', '#c8ccd4', '#5a5e66'], alpha: 1, shape: 'spark', additive: true });
  },
  thunder: (e) => {
    // Booms through it: shells and rings (out of a sphere, to a cube's faces, down a beam or a cone, up a wall).
    pulses(e, '#9b5cff', 1.2, 0.35, 'shell', { count: 1 });
    pulses(e, '#e2ccff', 1.2, 0.85, 'ring', { count: 2 });
    e.particles({ count: density(e, 60), size: 0.4, grow: [0.5, 1.6], life: 1.2, speed: 0, spread: 0.2, flow: 'out', colors: ['#e2ccff', '#a46bff', '#5a2aa0', '#1e0a40'], alpha: 0.3, shape: 'soft', additive: true });
    e.particles({ count: density(e, 30), size: 0.05, grow: [1, 0.3], life: 0.9, speed: 0, spread: 0.3, flow: 'out', colors: ['#ffffff', '#e2ccff', '#9b5cff', '#3a1a80'], alpha: 1, shape: 'spark', additive: true });
  },
};

/** How many of something for the shape: `per` for a square's worth of its size, more for a big one, within reason. */
function density(effect: SpellEffect, per: number): number {
  const squares = effect.vol.radius / effect.sq;
  return per * Math.max(0.6, Math.min(5, squares * 0.6));
}

/** Tubes as one geometry (positions only: the bolts are flat coloured). */
function mergeTubes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const part of parts) {
    const geometry = part.index ? part.toNonIndexed() : part;
    positions.push(...Array.from(geometry.getAttribute('position').array as ArrayLike<number>));
    if (geometry !== part) geometry.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return merged;
}


// ---- On what a spell hits ----

/**
 * What a damaging spell does to each thing it hits, drawn round that thing: flames licking up it, frost and ice at its
 * feet, lightning crackling over it, acid bubbling, a poison cloud, necrotic wisps drained out of it, a shaft of light,
 * a force cage, psychic rings round its head, thunder rings, dust, needles, slashes. A standing column the size of the
 * thing (`r` its half width, `h` its height, map pixels), its middle at the thing's; a flash when it is first hit.
 * The board moves it with the thing (`object3d.position`) and drops it when the thing is no longer hit.
 */
export function hitAura(type: DamageType, r: number, h: number, cell: number): SpellEffect {
  // A cylinder at a point, stood up: its own -z the world's up.
  const pitch = Math.PI / 2;
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, 0, 'YXZ'));
  const column: Spell = { shape: 'cylinder', from: 'point', at: { x: 0, y: 0, h: 0 }, yaw: 0, pitch, roll: 0, size: Math.max(1, r * 1.3), length: Math.max(1, h), angle: 0, effect: type };
  const masks: MaskUniforms = { mask: { value: null }, maskBox: { value: new THREE.Vector4(0, 0, 1, 1) }, useMask: { value: 0 } };
  const effect = new SpellEffect(type, column, cell, turn, masks, (e) => {
    // Meshes in a group the world's way up (y), its middle the thing's.
    const upright = new THREE.Group();
    upright.quaternion.copy(turn).invert();
    e.object3d.add(upright);
    const add = (mesh: THREE.Object3D): void => { upright.add(mesh); };
    AURAS[type](e, add, Math.max(1, r), Math.max(1, h));
    flash(e, add, DAMAGE_COLORS[type].edge, Math.max(r, h / 2));
  });
  effect.object3d.quaternion.copy(turn);
  effect.object3d.name = `spell-hit-${type}`;
  return effect;
}

type Aura = (e: SpellEffect, add: (mesh: THREE.Object3D) => void, r: number, h: number) => void;

/** A burst of the damage's light as the thing is hit: out and gone in half a second. */
function flash(e: SpellEffect, add: (mesh: THREE.Object3D) => void, color: string, radius: number): void {
  const material = e.glow(color, 0);
  const ball = e.mesh(new THREE.SphereGeometry(1, 20, 14), material);
  add(ball);
  let start = -1;
  e.move((time) => {
    if (start < 0) start = time;
    const t = (time - start) / 0.55;
    ball.visible = t < 1;
    if (!ball.visible) return;
    ball.scale.setScalar(radius * (0.6 + t * 0.9));
    material.opacity = 0.55 * (1 - t);
  });
}

/** Flat things at the feet, laid on the floor. */
function atFeet(mesh: THREE.Object3D, h: number): void {
  mesh.position.y = -h / 2 + 1;
}

const UP = new THREE.Vector3(0, 0, -1);

const AURAS: Record<DamageType, Aura> = {
  fire: (e, add, r, h) => {
    // Tongues of flame round it, the spell's own (a fire sphere's, as wide as the thing), from its feet.
    const ring: Spell = { shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: r * 1.15, length: 0, angle: 0, effect: 'fire' };
    const tongues = new SpellEffect('fire', ring, e.sq, new THREE.Quaternion(), e.masks, flames);
    tongues.object3d.position.y = -h / 2;
    add(tongues.object3d);
    e.move((time) => tongues.tick(time, 800));
    e.onDispose(() => tongues.dispose());
    const n = Math.max(30, (r / e.sq) * 70);
    e.particles({ count: n, size: 0.32, grow: [1, 0.25], life: 1.1, speed: 0.5, spread: 0.12, direction: UP, rise: 0.5, colors: ['#fff3b0', '#ffb020', '#ff4a10', '#3a0a00'], alpha: 0.75, shape: 'soft', additive: true });
    e.particles({ count: n * 0.5, size: 0.05, grow: [1, 0.4], life: 1.8, speed: 0.8, spread: 0.3, direction: UP, colors: ['#ffffff', '#ffd27a', '#ff6a10', '#601000'], alpha: 1, shape: 'spark', additive: true });
    e.particles({ count: n * 0.3, size: 0.45, grow: [0.6, 2], life: 2.6, speed: 0.45, spread: 0.1, direction: UP, colors: ['#4a3a30', '#3a3030', '#2a2626', '#1a1a1a'], alpha: 0.22, shape: 'soft', additive: false });
    const glow = e.mesh(new THREE.TorusGeometry(r * 1.05, e.sq * 0.05, 6, 40), e.glow('#ff7a1a', 0.5));
    glow.rotation.x = Math.PI / 2;
    atFeet(glow, h);
    add(glow);
    e.move((time) => { (glow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(time * 13) * Math.sin(time * 7.3); });
  },
  explosion: (e, add, r, h) => {
    AURAS.fire(e, add, r, h);
    const shell = e.mesh(new THREE.SphereGeometry(1, 20, 14), e.glow('#ffd27a', 0.4));
    add(shell);
    e.move((time) => {
      const t = (time % 1.6) / 1.6;
      shell.scale.setScalar(Math.max(r, h / 2) * (0.5 + t * 1.2));
      (shell.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - t);
    });
  },
  cold: (e, add, r, h) => {
    e.particles({ count: 45, size: 0.06, grow: [1, 0.6], life: 2.6, speed: 0.05, spread: 0.08, rise: -0.25, colors: ['#ffffff', '#e8faff', '#9ad8ff', '#3a7aa8'], alpha: 1, shape: 'spark', additive: true });
    e.particles({ count: 25, size: 0.5, grow: [0.6, 1.4], life: 3, speed: 0, spread: 0.05, swirl: [0.2, 0.3], colors: ['#e8faff', '#bfe8ff', '#8ac8f0', '#4a88b8'], alpha: 0.18, shape: 'soft', additive: false });
    // Ice shards round the feet, pointing out and up.
    const ice = e.glow('#cdf2ff', 0.6, false);
    const count = 9;
    for (let i = 0; i < count; i++) {
      const tall = h * (0.18 + e.rand() * 0.22);
      const shard = e.mesh(new THREE.ConeGeometry(e.sq * (0.05 + e.rand() * 0.05), tall, 5), ice);
      const angle = (i / count) * Math.PI * 2 + e.rand() * 0.4;
      shard.position.set(Math.cos(angle) * r * 0.95, -h / 2 + tall * 0.4, Math.sin(angle) * r * 0.95);
      shard.rotation.set(Math.sin(angle) * 0.45, 0, -Math.cos(angle) * 0.45);
      add(shard);
    }
    const frost = e.mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.1, h, 24, 1, true), e.glow('#7fd4ff', 0.12));
    add(frost);
    const floor = e.mesh(new THREE.CircleGeometry(r * 1.4, 32), e.glow('#dff6ff', 0.3, false));
    floor.rotation.x = -Math.PI / 2;
    atFeet(floor, h);
    add(floor);
  },
  lightning: (e, add, r, h) => {
    e.particles({ count: 35, size: 0.05, grow: [1, 0.2], life: 0.5, speed: 1.2, spread: 0.5, colors: ['#ffffff', '#e6f6ff', '#6aa8ff', '#1a3a90'], alpha: 1, shape: 'spark', additive: true });
    const shell = e.mesh(new THREE.CylinderGeometry(r * 1.05, r * 1.05, h, 20, 1, true), e.glow('#5a9cff', 0.1));
    add(shell);
    // Arcs over it, redrawn a dozen times a second.
    const arcs = 4;
    const segments = 2 ** 4;
    const positions = new Float32Array(arcs * segments * 2 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: '#dff0ff', transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    const crackle = new THREE.LineSegments(geometry, material);
    crackle.renderOrder = 7;
    crackle.raycast = () => {};
    crackle.frustumCulled = false;
    e.keep(geometry, material);
    add(crackle);
    const random = (): number => e.rand();
    const onSkin = (): THREE.Vector3 => {
      const angle = random() * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * r, (random() - 0.5) * h, Math.sin(angle) * r);
    };
    let step = -1;
    e.move((time) => {
      const now = Math.floor(time * 12);
      if (now === step) return;
      step = now;
      let k = 0;
      for (let a = 0; a < arcs; a++) {
        const path = jagged(onSkin(), onSkin(), 4, 0.25, random);
        for (let i = 1; i < path.length; i++) {
          positions.set([path[i - 1]!.x, path[i - 1]!.y, path[i - 1]!.z, path[i]!.x, path[i]!.y, path[i]!.z], k);
          k += 6;
        }
      }
      geometry.attributes.position!.needsUpdate = true;
      (shell.material as THREE.MeshBasicMaterial).opacity = 0.06 + random() * 0.12;
    });
  },
  acid: (e, add, r, h) => {
    e.particles({ count: 40, size: 0.12, grow: [0.6, 1.3], life: 1.6, speed: 0.1, spread: 0.05, rise: 0.35, colors: ['#fffbc0', '#fff04a', '#c8d81a', '#5a6a0a'], alpha: 0.85, shape: 'ring', additive: true });
    e.particles({ count: 30, size: 0.05, grow: [1, 0.6], life: 1, speed: 0, spread: 0.05, rise: -1.6, colors: ['#fffbc0', '#e8f04a', '#a8c01a', '#4a5a0a'], alpha: 0.95, shape: 'spark', additive: true });
    e.particles({ count: 15, size: 0.4, grow: [0.5, 1.5], life: 2.2, speed: 0.3, spread: 0.1, direction: UP, colors: ['#e8f0a0', '#c8d860', '#8a9a40', '#3a4020'], alpha: 0.15, shape: 'soft', additive: false });
    const puddle = e.mesh(new THREE.CircleGeometry(r * 1.3, 32), e.glow('#c8d81a', 0.4, false));
    puddle.rotation.x = -Math.PI / 2;
    atFeet(puddle, h);
    add(puddle);
    e.move((time) => { puddle.scale.setScalar(1 + 0.06 * Math.sin(time * 2.5)); });
  },
  poison: (e, _add, r) => {
    const n = Math.max(20, (r / e.sq) * 40);
    e.particles({ count: n * 1.8, size: 0.85, grow: [0.6, 1.8], life: 3, speed: 0.15, spread: 0.15, rise: 0.08, swirl: [0.25, 0.6], colors: ['#d8ff8a', '#9ad83a', '#6aa82a', '#3a6a18'], alpha: 0.6, shape: 'soft', additive: false });
    e.particles({ count: n * 0.6, size: 0.06, grow: [1, 0.4], life: 2, speed: 0.1, spread: 0.1, swirl: [0.4, 0.4], rise: 0.15, colors: ['#ffffff', '#e0c0ff', '#9a60e0', '#3a1a60'], alpha: 0.9, shape: 'spark', additive: true });
  },
  necrotic: (e, add, r, h) => {
    e.particles({ count: 40, size: 0.4, grow: [0.8, 1.8], life: 2.4, speed: 0.35, spread: 0.1, direction: UP, swirl: [0.3, 0.2], colors: ['#1a0a24', '#0e0614', '#06030a', '#000000'], alpha: 0.45, shape: 'soft', additive: false });
    // Life drawn out of it: sparks pulled in to the dark.
    e.particles({ count: 40, size: 0.06, grow: [1, 0.3], life: 1.6, speed: 0.6, spread: 0.3, pull: 0.5, rise: 0.3, colors: ['#e0c0ff', '#9a4ad8', '#4a1a70', '#10041a'], alpha: 1, shape: 'spark', additive: true });
    const ring = e.mesh(new THREE.CircleGeometry(r * 1.35, 32), e.glow('#000000', 0.55, false));
    ring.rotation.x = -Math.PI / 2;
    atFeet(ring, h);
    add(ring);
  },
  radiant: (e, add, r, h) => {
    const shaft = e.mesh(new THREE.CylinderGeometry(r * 0.9, r * 1.2, h * 4, 24, 1, true), e.glow('#fff2b0', 0.16));
    shaft.position.y = h * 1.5;
    add(shaft);
    const halo = e.mesh(new THREE.TorusGeometry(r * 0.55, e.sq * 0.025, 6, 40), e.glow('#ffe08a', 0.8));
    halo.rotation.x = Math.PI / 2;
    halo.position.y = h / 2 + e.sq * 0.15;
    add(halo);
    e.move((time) => {
      (shaft.material as THREE.MeshBasicMaterial).opacity = 0.13 + 0.05 * Math.sin(time * 3);
      halo.position.y = h / 2 + e.sq * (0.15 + 0.04 * Math.sin(time * 2));
    });
    e.particles({ count: 50, size: 0.06, grow: [1, 0.3], life: 2.2, speed: 0.05, spread: 0.05, rise: -0.3, colors: ['#ffffff', '#fffbe6', '#ffd36a', '#a8741a'], alpha: 1, shape: 'spark', additive: true });
  },
  force: (e, add, r, h) => {
    const material = e.glow('#ff6a6a', 0.45);
    material.wireframe = true;
    const cage = e.mesh(new THREE.IcosahedronGeometry(1, 1), material);
    cage.scale.set(r * 1.25, h * 0.6, r * 1.25);
    add(cage);
    const skin = e.mesh(new THREE.IcosahedronGeometry(1, 2), e.glow('#d01c2a', 0.1));
    skin.scale.copy(cage.scale);
    add(skin);
    e.move((time) => {
      const beat = 1 + 0.04 * Math.sin(time * 4);
      cage.scale.set(r * 1.25 * beat, h * 0.6 * beat, r * 1.25 * beat);
      cage.rotation.y = time * 0.4;
      material.opacity = 0.3 + 0.2 * Math.abs(Math.sin(time * 4));
    });
    e.particles({ count: 25, size: 0.05, grow: [1, 0.3], life: 1, speed: 0.2, spread: 0.1, colors: ['#ffffff', '#ffb0b0', '#d01c2a', '#400008'], alpha: 0.9, shape: 'spark', additive: true, surface: true });
  },
  psychic: (e, add, r, h) => {
    ['#ff4fd8', '#7af0ff', '#c46bff'].forEach((color, k) => {
      const ring = e.mesh(new THREE.TorusGeometry(r * (0.55 + k * 0.15), e.sq * 0.02, 6, 48), e.glow(color, 0.7));
      ring.position.y = h / 2 + e.sq * 0.1;
      add(ring);
      e.move((time) => {
        ring.rotation.set(Math.PI / 2 + 0.5 * Math.sin(time * (1 + k * 0.4) + k), time * (0.8 + k * 0.3), 0.4 * Math.cos(time * 1.3 + k * 2));
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(time * 3 + k * 2);
      });
    });
    e.particles({ count: 45, size: 0.07, grow: [0.6, 1.2], life: 2, speed: 0, spread: 0.05, swirl: [0.8, 0.6], rise: 0.2, colors: ['#ffd0f6', '#ff4fd8', '#8a5cff', '#2a0e4a'], alpha: 0.9, shape: 'spark', additive: true });
  },
  thunder: (e, add, r, h) => {
    for (let k = 0; k < 3; k++) {
      const ring = e.mesh(new THREE.TorusGeometry(1, 0.03, 6, 48), e.glow(k === 1 ? '#e2ccff' : '#9b5cff', 0.7));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -h / 2 + h * (0.15 + k * 0.3);
      add(ring);
      e.move((time) => {
        const t = ((time + k * 0.25) % 1.1) / 1.1;
        ring.scale.setScalar(r * (0.8 + t * 1.8));
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t);
      });
    }
    e.particles({ count: 25, size: 0.45, grow: [0.5, 1.6], life: 1.1, speed: 0.6, spread: 0.2, colors: ['#e2ccff', '#a46bff', '#5a2aa0', '#1e0a40'], alpha: 0.2, shape: 'soft', additive: true });
  },
  bludgeoning: (e, add, r, h) => {
    e.particles({ count: 50, size: 0.5, grow: [0.5, 1.8], life: 1.6, speed: 0.5, spread: 0.2, rise: -0.3, colors: ['#d8c0a0', '#a88a66', '#7a6448', '#3a3024'], alpha: 0.45, shape: 'soft', additive: false });
    e.particles({ count: 20, size: 0.05, grow: [1, 0.6], life: 0.9, speed: 1, spread: 0.4, rise: -2, colors: ['#e6cfa4', '#9a7b56', '#6a5238', '#2a2018'], alpha: 0.9, shape: 'spark', additive: false });
    const ring = e.mesh(new THREE.TorusGeometry(1, e.sq * 0.035 / Math.max(1, r), 4, 40), e.glow('#f0dcb4', 0.9));
    ring.rotation.x = Math.PI / 2;
    atFeet(ring, h);
    add(ring);
    e.move((time) => {
      const t = (time % 1.3) / 1.3;
      ring.scale.setScalar(r * (0.6 + t * 1.4));
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
  },
  piercing: (e, add, r, h) => {
    // Needles flying in at it from every side, over and over.
    const material = e.glow('#f2f6fa', 0.9);
    const needles = Array.from({ length: 6 }, (_, k) => {
      const needle = e.mesh(new THREE.CylinderGeometry(e.sq * 0.01, e.sq * 0.01, e.sq * 0.45, 4), material);
      const angle = (k / 6) * Math.PI * 2 + e.rand();
      const tilt = (e.rand() - 0.5) * 0.6;
      const way = new THREE.Vector3(Math.cos(angle), tilt, Math.sin(angle)).normalize();
      needle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), way);
      add(needle);
      return { needle, way, offset: e.rand(), y: (e.rand() - 0.5) * h * 0.6 };
    });
    e.move((time) => {
      for (const { needle, way, offset, y } of needles) {
        const t = (time * 1.4 + offset) % 1;
        const far = r * (3 - t * 2.1);
        needle.position.copy(way).multiplyScalar(far).setY(y + way.y * far);
        needle.visible = t < 0.95;
      }
    });
    e.particles({ count: 25, size: 0.05, grow: [1, 0.3], life: 0.6, speed: 0.8, spread: 0.4, colors: ['#ffffff', '#f2f6fa', '#8aa0b4', '#2a3440'], alpha: 1, shape: 'spark', additive: true });
  },
  slashing: (e, add, r, h) => {
    const cuts = Array.from({ length: 3 }, (_, k) => {
      const cut = e.mesh(new THREE.TorusGeometry(r * 1.2, e.sq * 0.05, 4, 32, Math.PI * 0.7), e.glow('#ffffff', 0));
      add(cut);
      return { cut, offset: k / 3 };
    });
    e.move((time) => {
      for (const { cut, offset } of cuts) {
        const cycle = time * 1.2 + offset;
        const t = cycle % 1;
        const round = Math.floor(cycle);
        // Each slash at its own slant, a new one each round.
        cut.rotation.set(Math.sin(round * 7.1 + offset * 13) * 1.2, round * 2.3 + offset * 4, Math.cos(round * 3.7 + offset * 5) * 0.9);
        cut.position.y = (Math.sin(round * 5.3 + offset * 9) * 0.3) * h;
        (cut.material as THREE.MeshBasicMaterial).opacity = t < 0.5 ? 1 - t / 0.5 : 0;
      }
    });
    e.particles({ count: 20, size: 0.05, grow: [1, 0.4], life: 0.8, speed: 0.6, spread: 0.3, rise: -1.6, colors: ['#ffffff', '#ffd0d0', '#c03030', '#400808'], alpha: 0.9, shape: 'spark', additive: true });
  },
};
