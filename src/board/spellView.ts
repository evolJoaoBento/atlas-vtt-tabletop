/**
 * A spell drawn on the board (`spells.ts`): its shape, see-through in its caster's colour, brighter where it is seen
 * edge on. A shape is cut off by the walls, as Atlas cuts its kept areas (`spells.ts` `spellCut`): what of it lies
 * outside what a straight way from its origin reaches is not drawn (a mask of that ground, laid over the floor,
 * decides it fragment by fragment). An area of Atlas with an effect (`areaVolume.ts`) is drawn the same way, its own
 * footprint standing in for the shape.
 */
import * as THREE from 'three';
import type { WallsLook } from './areaCuts';
import { smoother } from './camera';
import { clipped, reachOf, spellCut, turnOf, type Spell, type SpellShape } from './spells';
import { DAMAGE_COLORS, SpellEffect } from './spellEffects';
import type { BoardWall } from './walls';
import type { SpellRules, WallLook } from './spellRules';

const MASK_SIZE = 512;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vView = cameraPosition - world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform vec3 edgeColor;
uniform float whiten;
uniform float opacity;
uniform sampler2D mask;
uniform vec4 maskBox;
uniform float useMask;
uniform float glow;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  if (useMask > 0.5) {
    vec2 uv = (vWorld.xz - maskBox.xy) / (maskBox.zw - maskBox.xy);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || texture2D(mask, uv).r < 0.5) discard;
  }
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.0);
  vec3 body = mix(color, edgeColor, rim * 0.7);
  gl_FragColor = vec4(mix(body, vec3(1.0), rim * whiten + glow * 0.45), min(1.0, opacity * (0.6 + rim * 0.9) + glow * 0.25));
  #include <colorspace_fragment>
}`;

/** The shape's geometry about its anchor, unturned (a wall's along its own run). */
function geometryOf(spell: Spell): THREE.BufferGeometry {
  const self = spell.from === 'self';
  switch (spell.shape) {
    case 'sphere': return new THREE.SphereGeometry(spell.size, 40, 24);
    case 'cube': return new THREE.BoxGeometry(spell.size, spell.size, spell.size);
    case 'cylinder': {
      const geometry = new THREE.CylinderGeometry(spell.size, spell.size, spell.length, 40, 1, false);
      // Its axis along -z, forward: the top (+y) to -z... and its top on the caster when cast from them.
      geometry.rotateX(-Math.PI / 2);
      if (self) geometry.translate(0, 0, -spell.length / 2);
      return geometry;
    }
    case 'cone': {
      const geometry = new THREE.ConeGeometry(spell.size * Math.tan(spell.angle / 2), spell.size, 40, 1, false);
      // The tip (+y) to +z, the base ahead (-z); the tip on the caster when cast from them.
      geometry.rotateX(Math.PI / 2);
      if (self) geometry.translate(0, 0, -spell.size / 2);
      return geometry;
    }
    case 'wall': {
      const to = spell.to!;
      const run = Math.max(1e-3, Math.hypot(to.x - spell.at.x, to.y - spell.at.y));
      return new THREE.BoxGeometry(run, spell.length, spell.size);
    }
  }
}

type FloorPoint = { x: number; y: number };

/**
 * An area of Atlas drawn as a volume (`areaVolume.ts`) in a spell's place: its floor shape as the walls leave it, standing
 * `height` tall from the floor, and `look`, the spell that stands for it in the damage's look (a column or a slab over
 * it; its particles are cut to the footprint). Its anchor `at.h` is its height in the board's space.
 */
export interface Footprint {
  rings: ReadonlyArray<ReadonlyArray<FloorPoint>>;
  height: number;
  look: Spell;
}

function boundsOf(rings: Footprint['rings']): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const ring of rings) for (const { x, y } of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}

/** The footprint's solid about its middle (the object's origin): the rings extruded straight up, the floor at -height/2. */
function footprintGeometry(footprint: Footprint, middle: FloorPoint): THREE.BufferGeometry {
  const shapes = footprint.rings.filter((ring) => ring.length > 2).map((ring) => new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x - middle.x, point.y - middle.y))));
  if (shapes.length === 0) return new THREE.BufferGeometry();
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: footprint.height, bevelEnabled: false, curveSegments: 1 });
  // The shape's y is the map's y (the board's z); its extrusion rises from the floor.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, footprint.height / 2, 0);
  return geometry;
}

/** Where a spell's shape stands in the board's space and how it is turned (a wall along its run). */
function poseOf(spell: Spell): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  if (spell.shape === 'wall') {
    const to = spell.to!;
    return {
      position: new THREE.Vector3((spell.at.x + to.x) / 2, spell.at.h + spell.length / 2, (spell.at.y + to.y) / 2),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(to.y - spell.at.y, to.x - spell.at.x), 0)),
    };
  }
  return { position: new THREE.Vector3(spell.at.x, spell.at.h, spell.at.y), quaternion: turnOf(spell) };
}

/** Where a shape grows from as it is cast: its centre, its base (a cylinder's, a wall's foot), or its tip (a cone's). */
export type SpellAnchor = 'centre' | 'base' | 'tip';

/** How long a cast takes to grow into place, ms. */
export const GROW_MS = 500;

export function anchorFor(shape: SpellShape): SpellAnchor {
  return shape === 'cone' ? 'tip' : shape === 'cylinder' || shape === 'wall' ? 'base' : 'centre';
}

/**
 * The scale a shape has `progress` (0 to 1) of the way through growing into place, eased. A sphere and a cube grow
 * all round from their centre. Any other shape grows along its own axis (`y` here, whatever that is in space: a
 * cylinder's length, a wall's height, a cone's length) and keeps its width, from its base or tip. `lift` is how far its
 * centre moves to keep that end where it is, in half the shape's extent along the axis (never above 0).
 */
export function growScale(shape: SpellShape, progress: number): { x: number; y: number; z: number; lift: number } {
  const k = smoother(progress);
  if (anchorFor(shape) === 'centre') return { x: k, y: k, z: k, lift: 0 };
  return { x: 1, y: k, z: 1, lift: k - 1 };
}

export class SpellView {
  readonly object3d = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private maskTexture: THREE.CanvasTexture | null = null;
  /** Its damage's look, drawn inside it (none for a plain spell). */
  private effect: SpellEffect | null = null;

  /** `color` its caster's; `cell` a square, map pixels (the size of its damage's look). */
  private current: Spell;

  get spell(): Spell { return this.current; }

  constructor(spell: Spell, color: string, walls: readonly BoardWall[], opacity = 0.5, cell = 50, options: { plain?: boolean; look?: WallsLook; footprint?: Footprint } = {}) {
    // With a damage, the shape takes the damage's colours, its caster's at its very edge, and fainter, for what is in it.
    this.current = spell;
    const damage = spell.effect ? DAMAGE_COLORS[spell.effect] : null;
    const body = damage ? new THREE.Color(damage.body) : new THREE.Color(color);
    const dark = damage ? new THREE.Color(damage.body).getHSL({ h: 0, s: 0, l: 0 }).l < 0.08 : false;
    // A dark damage (necrotic) keeps its edge dark too; the rest take a touch of the caster's colour there.
    const edge = damage ? new THREE.Color(damage.body).lerp(new THREE.Color(damage.edge), 0.5).lerp(new THREE.Color(color), dark ? 0 : 0.25) : new THREE.Color(color);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        color: { value: body },
        edgeColor: { value: edge },
        // A dark damage (necrotic) stays dark at its edge.
        whiten: { value: dark ? 0 : 0.2 },
        opacity: { value: damage ? opacity * 0.28 * (damage.opacity ?? 1) : opacity },
        mask: { value: null },
        maskBox: { value: new THREE.Vector4(0, 0, 1, 1) },
        useMask: { value: 0 },
        glow: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.baseOpacity = this.material.uniforms.opacity!.value as number;
    this.footprint = options.footprint ?? null;
    this.walls = options.look ?? {};
    this.mesh = new THREE.Mesh(this.footprint ? footprintGeometry(this.footprint, this.middleOf(this.footprint)) : geometryOf(spell), this.material);
    this.mesh.renderOrder = 5;
    this.mesh.raycast = () => {};
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.object3d.add(this.mesh);
    this.object3d.userData.spell = true;
    this.stand(spell);
    if (this.footprint) this.cutTo(this.footprint.rings, boundsOf(this.footprint.rings), 2);
    else if (clipped(spell)) this.clip(walls);
    if (spell.effect && !options.plain) {
      const { mask, maskBox, useMask } = this.material.uniforms;
      // A footprint's look stands in its own spell's place, which is not where the object is (its middle, upright).
      const frame = this.footprint ? poseOf(spell) : null;
      this.effect = new SpellEffect(spell.effect, spell, cell, frame ? frame.quaternion : this.object3d.quaternion, { mask: mask!, maskBox: maskBox!, useMask: useMask! });
      if (frame) {
        this.effect.object3d.position.copy(frame.position).sub(this.object3d.position);
        this.effect.object3d.quaternion.copy(frame.quaternion);
      }
      this.object3d.add(this.effect.object3d);
    }
  }

  /** The area of Atlas this draws, when it stands for one. */
  private readonly footprint: Footprint | null;
  /** What of the map the cut depends on besides the walls. */
  private walls: WallsLook;

  /** The middle of a footprint's bounds, map pixels: where the object stands. */
  private middleOf(footprint: Footprint): FloorPoint {
    const box = boundsOf(footprint.rings);
    return Number.isFinite(box.x0) ? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 } : { x: 0, y: 0 };
  }

  /** Where it grows from when cast. */
  get anchorOf(): SpellAnchor {
    return anchorFor(this.current.shape);
  }

  /** How far grown it is (1: whole). */
  private grown = 1;

  /** Shows it `progress` (0 to 1) of the way grown into place; its damage's look starts once it is whole. */
  grow(progress: number): void {
    this.grown = Math.max(0, Math.min(1, progress));
    this.placeGrown(this.mesh);
    if (this.solid) this.placeGrown(this.solid);
    if (this.effect) {
      const whole = this.grown >= 1;
      this.effect.object3d.visible = whole;
      this.effect.fade(whole ? 1 : 0);
    }
  }

  /** Scales and moves `part` (the shape's geometry) for how far grown it is. */
  private placeGrown(part: THREE.Mesh): void {
    const spell = this.current;
    const scale = growScale(spell.shape, this.grown);
    part.position.set(0, 0, 0);
    switch (spell.shape) {
      case 'sphere':
      case 'cube':
        part.scale.set(Math.max(1e-4, scale.x), Math.max(1e-4, scale.y), Math.max(1e-4, scale.z));
        break;
      case 'wall':
        // The box's height is its y, centred; its foot stays down.
        part.scale.set(1, Math.max(1e-4, scale.y), 1);
        part.position.y = scale.lift * spell.length / 2;
        break;
      case 'cylinder': {
        // Its axis along z, its base the +z end; cast from the caster it lies from 0 back to -length.
        const half = spell.length / 2;
        part.scale.set(1, 1, Math.max(1e-4, scale.y));
        part.position.z = (spell.from === 'self' ? 0 : half) * (1 - scale.y);
        break;
      }
      case 'cone': {
        // Its tip the +z end; cast from the caster it lies from 0 back to -size.
        part.scale.set(1, 1, Math.max(1e-4, scale.y));
        part.position.z = (spell.from === 'self' ? 0 : spell.size / 2) * (1 - scale.y);
        break;
      }
    }
  }

  /** Whether it moves by itself (a damage's look): the board draws it every frame then. */
  get animated(): boolean {
    return this.effect !== null;
  }

  /** On to `time`, seconds; `viewport` the drawing's height, pixels. */
  tick(time: number, viewport: number): void {
    if (this.grown >= 1) this.effect?.tick(time, viewport);
  }

  /** Where it stands and how it is turned. */
  private stand(spell: Spell): void {
    if (this.footprint) {
      const middle = this.middleOf(this.footprint);
      this.object3d.position.set(middle.x, this.footprint.height / 2, middle.y);
      return;
    }
    if (spell.shape === 'wall') {
      const to = spell.to!;
      this.object3d.position.set((spell.at.x + to.x) / 2, spell.at.h + spell.length / 2, (spell.at.y + to.y) / 2);
      this.object3d.rotation.set(0, -Math.atan2(to.y - spell.at.y, to.x - spell.at.x), 0);
    } else {
      this.object3d.position.set(spell.at.x, spell.at.h, spell.at.y);
      this.object3d.quaternion.copy(turnOf(spell));
    }
  }

  /** Whether `spell` is this one's shape, only moved or turned: it can be drawn by moving this one (`moveTo`). */
  fits(spell: Spell): boolean {
    const a = this.current;
    const run = (s: Spell): number => (s.to ? Math.hypot(s.to.x - s.at.x, s.to.y - s.at.y) : 0);
    return a.shape === spell.shape && a.from === spell.from && a.size === spell.size && a.length === spell.length && a.angle === spell.angle
      && a.effect === spell.effect && a.uncut === spell.uncut && Math.abs(run(a) - run(spell)) < 1e-6;
  }

  /** The same shape moved or turned (`fits`): what the walls cut is worked out again where it is. */
  moveTo(spell: Spell, walls: readonly BoardWall[], look: WallsLook = this.walls): void {
    this.current = spell;
    this.stand(spell);
    this.effect?.turned(this.object3d.quaternion);
    this.walls = look;
    if (clipped(spell)) {
      this.maskTexture?.dispose();
      this.maskTexture = null;
      this.clip(walls);
    }
  }

  /** Draws only what the walls leave of it (`spellCut`): that ground, painted over the floor round the shape. */
  private clip(walls: readonly BoardWall[]): void {
    const cut = spellCut(this.spell, walls, this.walls);
    if (!cut) {
      this.material.uniforms.useMask!.value = 0;
      return;
    }
    const reach = reachOf(this.spell) + 1;
    const box = { x0: this.spell.at.x - reach, y0: this.spell.at.y - reach, x1: this.spell.at.x + reach, y1: this.spell.at.y + reach };
    this.cutTo(cut.rings, box, 0);
  }

  /** Paints `rings` (floor points) white on a black mask over `box`, `grow` mask pixels fatter, and cuts fragments outside them. */
  private cutTo(rings: Footprint['rings'], box: { x0: number; y0: number; x1: number; y1: number }, grow: number): void {
    if (typeof document === 'undefined' || !Number.isFinite(box.x0) || !(box.x1 > box.x0) || !(box.y1 > box.y0)) return;
    const canvas = document.createElement('canvas');
    canvas.width = MASK_SIZE;
    canvas.height = MASK_SIZE;
    const context = canvas.getContext('2d');
    if (!context || !rings.some((ring) => ring.length >= 3)) return;
    const scale = MASK_SIZE / Math.max(box.x1 - box.x0, box.y1 - box.y0);
    context.fillStyle = '#000';
    context.fillRect(0, 0, MASK_SIZE, MASK_SIZE);
    context.fillStyle = '#fff';
    context.strokeStyle = '#fff';
    context.lineWidth = grow * 2;
    context.lineJoin = 'round';
    for (const ring of rings) {
      if (ring.length < 3) continue;
      context.beginPath();
      ring.forEach((point, index) => {
        const x = (point.x - box.x0) * scale;
        const y = (point.y - box.y0) * scale;
        if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
      });
      context.closePath();
      context.fill();
      if (grow > 0) context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    this.maskTexture?.dispose();
    this.maskTexture = texture;
    this.material.uniforms.mask!.value = texture;
    // The canvas is square and the box is stretched over its longer side: the mask's box is that square.
    const span = MASK_SIZE / scale;
    (this.material.uniforms.maskBox!.value as THREE.Vector4).set(box.x0, box.y0, box.x0 + span, box.y0 + span);
    this.material.uniforms.useMask!.value = 1;
  }

  /** Where the shape's body stands in the board's space (its box), for a look in tests. */
  bodyBox(): THREE.Box3 {
    this.object3d.updateMatrixWorld(true);
    this.mesh.geometry.computeBoundingBox();
    return (this.mesh.geometry.boundingBox ?? new THREE.Box3()).clone().applyMatrix4(this.mesh.matrixWorld);
  }

  /** How far along the ray the shape is met, or null (its cut by the walls aside). */
  hit(ray: THREE.Raycaster): number | null {
    this.object3d.updateMatrixWorld(true);
    const found: THREE.Intersection[] = [];
    THREE.Mesh.prototype.raycast.call(this.mesh, ray, found);
    return found.length > 0 ? Math.min(...found.map((each) => each.distance)) : null;
  }

  /** The solid a wall spell stands as (stone, ice, wood, thorns), drawn over its see-through shape. */
  private solid: THREE.Mesh | null = null;
  /** The shape's own colours, kept while rules colour it. */
  private ownLook: { color: THREE.Color; edge: THREE.Color; whiten: number; opacity: number } | null = null;
  private solidTexture: THREE.Texture | null = null;

  /**
   * What the spell's rules make it look like: a wall of stuff solid (a stone wall is stone, casting shadows), magical
   * darkness a black mass, an obscuring cloud a thick grey one. Force stays a see-through shimmer.
   */
  setRules(rules: SpellRules | null | undefined): void {
    this.solid?.removeFromParent();
    this.solid?.geometry.dispose();
    (this.solid?.material as THREE.Material | undefined)?.dispose();
    this.solidTexture?.dispose();
    this.solid = null;
    this.solidTexture = null;
    this.mesh.visible = true;
    const look = rules?.wall?.look;
    if (look && look !== 'force' && look !== 'fire') {
      const texture = stuffTexture(look);
      this.solidTexture = texture;
      const material = new THREE.MeshStandardMaterial({
        color: STUFF[look].color, roughness: STUFF[look].rough, metalness: 0, map: texture, flatShading: look === 'stone' || look === 'ice',
        transparent: look === 'ice', opacity: look === 'ice' ? 0.78 : 1,
      });
      this.solid = new THREE.Mesh(geometryOf(this.spell), material);
      this.solid.castShadow = look !== 'ice';
      this.solid.receiveShadow = true;
      this.solid.raycast = () => {};
      this.object3d.add(this.solid);
      this.mesh.visible = false;
      if (this.grown < 1) this.placeGrown(this.solid);
    }
    const uniforms = this.material.uniforms;
    // Its own look first (the rules may have changed while it was aimed), then theirs over it.
    this.ownLook ??= { color: (uniforms.color!.value as THREE.Color).clone(), edge: (uniforms.edgeColor!.value as THREE.Color).clone(), whiten: uniforms.whiten!.value as number, opacity: uniforms.opacity!.value as number };
    (uniforms.color!.value as THREE.Color).copy(this.ownLook.color);
    (uniforms.edgeColor!.value as THREE.Color).copy(this.ownLook.edge);
    uniforms.whiten!.value = this.ownLook.whiten;
    uniforms.opacity!.value = this.ownLook.opacity;
    if (rules?.light && !rules.dark) {
      (uniforms.color!.value as THREE.Color).set(rules.light.color ?? '#fff1c4');
      (uniforms.edgeColor!.value as THREE.Color).set('#ffffff');
      uniforms.whiten!.value = 0.5;
      uniforms.opacity!.value = 0.35;
    }
    if (rules?.dark) {
      (uniforms.color!.value as THREE.Color).set('#000000');
      (uniforms.edgeColor!.value as THREE.Color).set('#0a0410');
      uniforms.whiten!.value = 0;
      uniforms.opacity!.value = 0.92;
    } else if (rules?.obscure) {
      (uniforms.color!.value as THREE.Color).set('#c9ced4');
      (uniforms.edgeColor!.value as THREE.Color).set('#eef1f4');
      uniforms.whiten!.value = 0.1;
      uniforms.opacity!.value = 0.7;
    }
  }

  /** Lights the shape up (the GM about to clear it). */
  /** The shape's own opacity, before any fade. */
  private baseOpacity = 0;

  /** Shows `level` (1 to 0) of it: an instantaneous spell fading out after its cast. */
  fade(level: number): void {
    const k = Math.max(0, Math.min(1, level));
    this.material.uniforms.opacity!.value = this.baseOpacity * k;
    this.effect?.fade(k);
  }

  highlight(on: boolean): void {
    this.material.uniforms.glow!.value = on ? 1 : 0;
  }

  dispose(): void {
    this.object3d.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.maskTexture?.dispose();
    this.effect?.dispose();
    this.setRules(null);
  }
}

const STUFF: Record<Exclude<WallLook, 'force' | 'fire'>, { color: string; rough: number }> = {
  stone: { color: '#a29d95', rough: 0.95 },
  ice: { color: '#cdeeff', rough: 0.15 },
  wood: { color: '#8a5a32', rough: 0.85 },
  thorns: { color: '#5d6a33', rough: 0.9 },
  plain: { color: '#9c9c9c', rough: 0.8 },
};

/** A small painted texture for a wall's stuff: stone blocks, ice cracks, wood grain, a tangle of thorns. */
function stuffTexture(look: Exclude<WallLook, 'force' | 'fire'>): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  let seed = 7;
  const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  if (look === 'stone' || look === 'plain') {
    // Courses of blocks, each a shade of its own, mortar between.
    const rows = 6;
    const h = size / rows;
    for (let row = 0; row < rows; row++) {
      let x = -(row % 2) * h * 0.7;
      while (x < size) {
        const w = h * (1.1 + random() * 0.9);
        const shade = 150 + Math.floor(random() * 90);
        g.fillStyle = `rgb(${shade},${shade},${shade})`;
        g.fillRect(x + 2, row * h + 2, w - 4, h - 4);
        x += w;
      }
    }
    for (let i = 0; i < 900; i++) {
      const shade = Math.floor(random() * 255);
      g.fillStyle = `rgba(${shade},${shade},${shade},0.12)`;
      g.fillRect(random() * size, random() * size, 2, 2);
    }
  } else if (look === 'ice') {
    g.strokeStyle = 'rgba(120,170,200,0.6)';
    for (let i = 0; i < 26; i++) {
      g.lineWidth = 0.5 + random() * 1.5;
      g.beginPath();
      let x = random() * size;
      let y = random() * size;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) { x += (random() - 0.5) * 70; y += (random() - 0.5) * 70; g.lineTo(x, y); }
      g.stroke();
    }
  } else if (look === 'wood') {
    for (let y = 0; y < size; y += 3) {
      const shade = 170 + Math.floor(Math.sin(y * 0.21) * 30 + random() * 30);
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(0, y, size, 3);
    }
  } else {
    g.strokeStyle = 'rgba(40,40,30,0.8)';
    for (let i = 0; i < 70; i++) {
      g.lineWidth = 1 + random() * 3;
      g.beginPath();
      const x = random() * size;
      const y = random() * size;
      g.moveTo(x, y);
      g.bezierCurveTo(x + (random() - 0.5) * 80, y + (random() - 0.5) * 80, x + (random() - 0.5) * 80, y + (random() - 0.5) * 80, x + (random() - 0.5) * 120, y + (random() - 0.5) * 120);
      g.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Difficult ground over a spell's footprint (map pixels): a see-through tangle of webs and brambles on the floor. */
export function difficultGround(ring: ReadonlyArray<{ x: number; y: number }>, cell: number, doc: Document): THREE.Mesh {
  const shape = new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x, point.y)));
  const geometry = new THREE.ShapeGeometry(shape);
  // Laid on the floor: the shape's y is the map's y (the board's z).
  geometry.rotateX(Math.PI / 2);
  const uv = geometry.getAttribute('uv');
  const position = geometry.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / cell, position.getZ(i) / cell);
  let map: THREE.Texture | null = null;
  const canvas = doc.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  if (g) {
    let seed = 3;
    const random = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    g.strokeStyle = 'rgba(235,235,225,0.9)';
    for (let i = 0; i < 14; i++) {
      g.lineWidth = 1 + random() * 1.5;
      g.beginPath();
      const x = random() * 128;
      const y = random() * 128;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + (random() - 0.5) * 90, y + (random() - 0.5) * 90, x + (random() - 0.5) * 128, y + (random() - 0.5) * 128);
      g.stroke();
    }
    g.fillStyle = 'rgba(90,70,40,0.55)';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.arc(random() * 128, random() * 128, 1 + random() * 2.5, 0, Math.PI * 2); g.fill(); }
    map = new THREE.CanvasTexture(canvas);
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
    map.colorSpace = THREE.SRGBColorSpace;
  }
  const material = new THREE.MeshBasicMaterial({ map, color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  material.addEventListener('dispose', () => map?.dispose());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 4;
  mesh.raycast = () => {};
  mesh.name = 'spell-difficult-ground';
  return mesh;
}
