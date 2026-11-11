/**
 * Players looking at the map in augmented reality, on the GM's board: each phone's camera, where that player's AR puts
 * it over the table, drawn as an eye in the player's colour, made only of primitives. The eye looks the way the phone
 * looks, blinks now and then (sometimes twice), glances about a little, and carries the player's name over it and a
 * faint thread down to the map under it. It eases between updates (a phone sends about ten a second, fewer when still)
 * and fades out when the player leaves AR, loses the tracking or goes quiet for a few seconds.
 */
import * as THREE from 'three';
import { plateTexture } from './textures';

/** A phone camera's pose in board units: where it is, and which way it faces (looking down its −z, up its +y). */
export interface ViewerPose {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

const finite = (value: unknown, limit: number): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;

export function isViewerPose(value: unknown): value is ViewerPose {
  const pose = value as Partial<ViewerPose> | null;
  if (typeof pose !== 'object' || pose === null || !Array.isArray(pose.position) || !Array.isArray(pose.quaternion)) return false;
  if (pose.position.length !== 3 || !pose.position.every((v) => finite(v, 1e7))) return false;
  if (pose.quaternion.length !== 4 || !pose.quaternion.every((v) => finite(v, 1.01))) return false;
  const length = Math.hypot(...pose.quaternion);
  return length > 0.9 && length < 1.1;
}

/** Silent this long: the player is taken to have left. */
const STALE_SECONDS = 4;
const FADE_SECONDS = 0.4;
/** How fast the eye catches up with the pose sent (per second). */
const EASE = 12;
const BLINK_SECONDS = 0.3;
/** How far back the lids fold when open (radians about the eye's side axis). */
const UPPER_OPEN = 1.0;
const LOWER_OPEN = 0.7;

interface Eye {
  group: THREE.Group;
  /** The iris, pupil and glint: they glance about. */
  look: THREE.Group;
  upper: THREE.Mesh;
  lower: THREE.Mesh;
  label: THREE.Sprite;
  labelAspect: number;
  thread: THREE.Line;
  /** Every material with its full opacity, for the fade. */
  materials: Array<{ material: THREE.Material; opacity: number }>;
  target: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null;
  placed: boolean;
  seen: number;
  shown: number;
  size: number;
  name: string;
  color: string;
  blinkAt: number;
  blinks: number;
  glanceAt: number;
  glance: THREE.Euler;
}

const random = (min: number, max: number): number => min + Math.random() * (max - min);

/** How open the lids are (1 open, 0 shut) `t` seconds into a blink. */
export function lidOpenness(t: number): number {
  if (t <= 0 || t >= BLINK_SECONDS) return 1;
  const x = Math.abs((2 * t) / BLINK_SECONDS - 1);
  return x * x * (3 - 2 * x);
}

export class ArViewers {
  readonly object3d = new THREE.Group();
  private readonly eyes = new Map<string, Eye>();

  constructor() {
    this.object3d.name = 'ar-viewers';
  }

  /**
   * A player's AR view: `pose` in board units (null: they left AR or lost the tracking), the eye `size` (its radius,
   * board units), `now` the board's clock (seconds).
   */
  set(from: string, name: string, color: string, pose: ViewerPose | null, size: number, now: number): void {
    let eye = this.eyes.get(from);
    if (!pose) {
      if (eye) eye.target = null;
      return;
    }
    if (eye && (eye.color !== color || eye.name !== name || Math.abs(eye.size - size) > 1e-6)) {
      this.remove(from);
      eye = undefined;
    }
    eye ??= this.make(from, name, color, size, now);
    eye.target = {
      position: new THREE.Vector3(...pose.position),
      quaternion: new THREE.Quaternion(...pose.quaternion).normalize(),
    };
    eye.seen = now;
  }

  /** Whether any eye shows (the board keeps drawing frames for the blinks). */
  get animating(): boolean {
    return this.eyes.size > 0;
  }

  /** How many eyes show. */
  get count(): number {
    return this.eyes.size;
  }

  /** Moves, blinks and fades the eyes to `now`; `pixel` is a screen pixel in board units at the view's distance. */
  step(now: number, dt: number, pixel: number): boolean {
    const ease = 1 - Math.exp(-EASE * Math.max(0, dt));
    for (const [from, eye] of [...this.eyes]) {
      if (eye.target && now - eye.seen > STALE_SECONDS) eye.target = null;
      const target = eye.target;
      eye.shown = Math.min(1, Math.max(0, eye.shown + (target ? 1 : -1) * (dt / FADE_SECONDS)));
      if (!target && eye.shown <= 0) {
        this.remove(from);
        continue;
      }
      if (target) {
        if (!eye.placed) {
          eye.group.position.copy(target.position);
          eye.group.quaternion.copy(target.quaternion);
          eye.placed = true;
        } else {
          eye.group.position.lerp(target.position, ease);
          eye.group.quaternion.slerp(target.quaternion, ease);
        }
      }
      // Blinks: every few seconds, now and then two in a row.
      if (now >= eye.blinkAt + BLINK_SECONDS) {
        if (eye.blinks > 1) {
          eye.blinks--;
          eye.blinkAt = now + 0.08;
        } else {
          eye.blinks = Math.random() < 0.2 ? 2 : 1;
          eye.blinkAt = now + random(2.2, 5.5);
        }
      }
      const open = lidOpenness(now - eye.blinkAt);
      eye.upper.rotation.x = open * UPPER_OPEN;
      eye.lower.rotation.x = -open * LOWER_OPEN;
      // A glance about every second or two, back to the middle more often than not.
      if (now >= eye.glanceAt) {
        const away = Math.random() < 0.6;
        eye.glance.set(away ? random(-0.18, 0.18) : 0, away ? random(-0.25, 0.25) : 0, 0);
        eye.glanceAt = now + random(0.8, 2.2);
      }
      eye.look.rotation.x += (eye.glance.x - eye.look.rotation.x) * Math.min(1, dt * 18);
      eye.look.rotation.y += (eye.glance.y - eye.look.rotation.y) * Math.min(1, dt * 18);
      // The name: over the eye, 18 screen pixels tall; the thread: from the eye down to the map.
      eye.label.position.set(eye.group.position.x, eye.group.position.y + eye.size * 1.9, eye.group.position.z);
      eye.label.scale.set(pixel * 18 * eye.labelAspect, pixel * 18, 1);
      const line = eye.thread.geometry.getAttribute('position') as THREE.BufferAttribute;
      line.setXYZ(0, eye.group.position.x, eye.group.position.y - eye.size * 1.1, eye.group.position.z);
      line.setXYZ(1, eye.group.position.x, Math.min(1, eye.group.position.y), eye.group.position.z);
      line.needsUpdate = true;
      eye.thread.geometry.computeBoundingSphere();
      const fade = eye.shown * eye.shown * (3 - 2 * eye.shown);
      for (const { material, opacity } of eye.materials) material.opacity = opacity * fade;
    }
    return this.animating;
  }

  /** Forgets every eye. */
  clear(): void {
    for (const from of [...this.eyes.keys()]) this.remove(from);
  }

  dispose(): void {
    this.clear();
  }

  /** An eye of primitives, looking down its −z: the eyeball, the iris, pupil and glint, two lids, the name and the thread. */
  private make(from: string, name: string, color: string, size: number, now: number): Eye {
    const materials: Eye['materials'] = [];
    const keep = <M extends THREE.Material>(material: M): M => {
      material.transparent = true;
      materials.push({ material, opacity: material.opacity });
      return material;
    };
    const tint = new THREE.Color(color);
    const group = new THREE.Group();
    group.name = `ar-viewer:${from}`;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(size, 32, 20), keep(new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.25, metalness: 0 })));
    // A cap of the sphere round −z: rotated from round +y.
    const cap = (radius: number, angle: number, material: THREE.Material): THREE.Mesh =>
      new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 8, 0, Math.PI * 2, 0, angle).rotateX(-Math.PI / 2), material);
    const look = new THREE.Group();
    const iris = cap(size * 1.004, 0.5, keep(new THREE.MeshStandardMaterial({ color: tint, emissive: tint.clone().multiplyScalar(0.35), roughness: 0.4 })));
    const ring = cap(size * 1.002, 0.56, keep(new THREE.MeshBasicMaterial({ color: tint.clone().multiplyScalar(0.45) })));
    const pupil = cap(size * 1.008, 0.22, keep(new THREE.MeshBasicMaterial({ color: 0x08080a })));
    const glint = new THREE.Mesh(new THREE.SphereGeometry(size * 0.08, 12, 8), keep(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    glint.position.set(size * 0.22, size * 0.24, -size * 0.95);
    look.add(ring, iris, pupil, glint);
    // The lids: half shells a little over the eyeball, folding back (about the eye's side axis) to open.
    const lidMaterial = keep(new THREE.MeshStandardMaterial({ color: tint.clone().lerp(new THREE.Color(0x000000), 0.35), roughness: 0.6, side: THREE.DoubleSide }));
    const upper = new THREE.Mesh(new THREE.SphereGeometry(size * 1.09, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMaterial);
    const lower = new THREE.Mesh(new THREE.SphereGeometry(size * 1.09, 32, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), lidMaterial);
    upper.rotation.x = UPPER_OPEN;
    lower.rotation.x = -LOWER_OPEN;
    group.add(ball, look, upper, lower);
    const plate = plateTexture(name, 22);
    const label = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, depthTest: false })));
    label.renderOrder = 12;
    const thread = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)),
      keep(new THREE.LineBasicMaterial({ color: tint, opacity: 0.4, depthWrite: false })),
    );
    thread.frustumCulled = false;
    this.object3d.add(group, label, thread);
    const eye: Eye = {
      group, look, upper, lower, label, labelAspect: plate.width / plate.height, thread, materials,
      target: null, placed: false, seen: now, shown: 0, size, name, color,
      blinkAt: now + random(0.6, 2), blinks: 1, glanceAt: now + random(0.5, 1.5), glance: new THREE.Euler(),
    };
    for (const { material } of materials) material.opacity = 0;
    this.eyes.set(from, eye);
    return eye;
  }

  private remove(from: string): void {
    const eye = this.eyes.get(from);
    if (!eye) return;
    this.eyes.delete(from);
    this.object3d.remove(eye.group, eye.label, eye.thread);
    // Not the label's: every sprite shares three's one quad.
    eye.group.traverse((child) => { (child as THREE.Mesh).geometry?.dispose(); });
    eye.thread.geometry.dispose();
    (eye.label.material as THREE.SpriteMaterial).map?.dispose();
    for (const { material } of eye.materials) material.dispose();
  }
}
