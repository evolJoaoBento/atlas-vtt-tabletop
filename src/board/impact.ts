/**
 * The thud of something dropped into place: a mini landing on its square (a ring out over the floor, a puff of dust)
 * and a material slapped on a wall (a flash over the segment, dust off its foot). Each lives half a second or so; the
 * board steps them every frame while any lives.
 */
import * as THREE from 'three';

interface Burst {
  start: number;
  life: number;
  objects: THREE.Object3D[];
  step(t: number): void;
  free(): void;
}

const DUST = 18;

export class Impacts {
  readonly object3d = new THREE.Group();
  private readonly bursts: Burst[] = [];

  constructor() {
    this.object3d.name = 'impacts';
    this.object3d.userData.noOutline = true;
  }

  get active(): boolean {
    return this.bursts.length > 0;
  }

  /** A landing at a floor point (board space: x, the floor's height y, z), `radius` the thing's half width. */
  land(at: { x: number; y: number; z: number }, radius: number, color = '#e7dcc6', now = performance.now()): void {
    const objects: THREE.Object3D[] = [];
    const frees: Array<() => void> = [];
    const ring = (inner: number, opacity: number): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } => {
      const geometry = new THREE.RingGeometry(inner, 1, 48).rotateX(-Math.PI / 2);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(at.x, at.y + 0.6, at.z);
      mesh.renderOrder = 8;
      mesh.raycast = () => {};
      objects.push(mesh);
      frees.push(() => { geometry.dispose(); material.dispose(); });
      return { mesh, material };
    };
    const outer = ring(0.72, 0.95);
    const inner = ring(0.85, 0.7);
    const dust = this.dust(objects, frees, color, radius * 0.16, (k) => {
      const angle = (k / DUST) * Math.PI * 2 + Math.random() * 0.3;
      const speed = radius * (1.6 + Math.random() * 1.4);
      return { from: new THREE.Vector3(at.x + Math.cos(angle) * radius * 0.5, at.y + 1, at.z + Math.sin(angle) * radius * 0.5), velocity: new THREE.Vector3(Math.cos(angle) * speed, radius * (1.2 + Math.random()), Math.sin(angle) * speed) };
    });
    this.add({
      start: now, life: 0.6, objects,
      step: (t) => {
        const ease = 1 - (1 - Math.min(1, t / 0.45)) ** 3;
        outer.mesh.scale.setScalar(radius * (0.5 + ease * 1.8));
        outer.material.opacity = 0.95 * (1 - Math.min(1, t / 0.55));
        const late = Math.max(0, t - 0.08);
        inner.mesh.scale.setScalar(radius * (0.3 + (1 - (1 - Math.min(1, late / 0.4)) ** 3) * 0.8));
        inner.material.opacity = 0.6 * (1 - Math.min(1, late / 0.4));
        dust(t, radius);
      },
      free: () => frees.forEach((free) => free()),
    });
  }

  /** A material slapped on wall segments: each `{ p1, p2 }` map points, `height` how tall, `bottom` its foot's height. */
  slap(segments: ReadonlyArray<{ p1: { x: number; y: number }; p2: { x: number; y: number } }>, height: number, bottom: number, thick: number, color = '#fff6e0', now = performance.now()): void {
    if (segments.length === 0) return;
    const objects: THREE.Object3D[] = [];
    const frees: Array<() => void> = [];
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
    frees.push(() => material.dispose());
    for (const { p1, p2 } of segments) {
      const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (length < 1e-6) continue;
      const geometry = new THREE.BoxGeometry(length, height, thick * 1.6);
      const box = new THREE.Mesh(geometry, material);
      box.position.set((p1.x + p2.x) / 2, bottom + height / 2, (p1.y + p2.y) / 2);
      box.rotation.y = -Math.atan2(p2.y - p1.y, p2.x - p1.x);
      box.renderOrder = 8;
      box.raycast = () => {};
      objects.push(box);
      frees.push(() => geometry.dispose());
    }
    const size = Math.max(thick * 1.5, height * 0.06);
    const dust = this.dust(objects, frees, '#d9cdb5', size, () => {
      const segment = segments[Math.floor(Math.random() * segments.length)]!;
      const t = Math.random();
      const x = segment.p1.x + (segment.p2.x - segment.p1.x) * t;
      const z = segment.p1.y + (segment.p2.y - segment.p1.y) * t;
      // Off either face, a little up.
      const nx = -(segment.p2.y - segment.p1.y);
      const nz = segment.p2.x - segment.p1.x;
      const n = Math.hypot(nx, nz) || 1;
      const side = Math.random() < 0.5 ? -1 : 1;
      const speed = height * (0.4 + Math.random() * 0.5);
      return { from: new THREE.Vector3(x, bottom + 1, z), velocity: new THREE.Vector3((nx / n) * side * speed, height * (0.5 + Math.random() * 0.5), (nz / n) * side * speed) };
    });
    this.add({
      start: now, life: 0.55, objects,
      step: (t) => {
        // A bright hit, gone in a third of a second; the box breathes out a hair as it fades.
        material.opacity = 0.75 * Math.max(0, 1 - t / 0.4);
        for (const box of objects) if (box instanceof THREE.Mesh && box.geometry instanceof THREE.BoxGeometry) box.scale.set(1, 1 + t * 0.06, 1 + t * 0.8);
        dust(t, height);
      },
      free: () => frees.forEach((free) => free()),
    });
  }

  /** Steps them on to `now` (ms); whether any is left. */
  step(now = performance.now()): boolean {
    for (const burst of [...this.bursts]) {
      const t = (now - burst.start) / 1000;
      if (t >= burst.life) {
        for (const object of burst.objects) object.removeFromParent();
        burst.free();
        this.bursts.splice(this.bursts.indexOf(burst), 1);
        continue;
      }
      burst.step(Math.max(0, t));
    }
    return this.bursts.length > 0;
  }

  dispose(): void {
    for (const burst of this.bursts.splice(0)) { for (const object of burst.objects) object.removeFromParent(); burst.free(); }
    this.object3d.removeFromParent();
  }

  /** How many have been set off (for tests). */
  started = 0;

  private add(burst: Burst): void {
    this.started++;
    for (const object of burst.objects) this.object3d.add(object);
    this.bursts.push(burst);
    burst.step(0);
  }

  /** Dust motes thrown out and falling back, fading: their stepper. */
  private dust(objects: THREE.Object3D[], frees: Array<() => void>, color: string, size: number, spawn: (k: number) => { from: THREE.Vector3; velocity: THREE.Vector3 }): (t: number, scale: number) => void {
    const motes = Array.from({ length: DUST }, (_, k) => spawn(k));
    const positions = new Float32Array(DUST * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color, size: Math.max(1, size), transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    points.renderOrder = 8;
    points.raycast = () => {};
    objects.push(points);
    frees.push(() => { geometry.dispose(); material.dispose(); });
    return (t, scale) => {
      const gravity = scale * 6;
      motes.forEach((mote, k) => {
        const drag = Math.exp(-t * 3);
        positions[k * 3] = mote.from.x + mote.velocity.x * t * drag;
        positions[k * 3 + 1] = Math.max(mote.from.y - 1, mote.from.y + mote.velocity.y * t - 0.5 * gravity * t * t);
        positions[k * 3 + 2] = mote.from.z + mote.velocity.z * t * drag;
      });
      geometry.attributes.position!.needsUpdate = true;
      material.opacity = 0.8 * Math.max(0, 1 - t / 0.55);
    };
  }
}
