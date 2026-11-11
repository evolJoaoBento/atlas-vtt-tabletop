/**
 * The handles of a spell set at a point (`spellCaster.ts`), as a 3D editor's: three arrows to move it along the board's
 * axes (x red, up green, the map's y blue) and three rings to turn it about them, round the spell's middle. Drawn over
 * everything and kept one size on screen. The board hands it presses (`grab`), moves (`drag`) and the release; it gives
 * back the spell moved or turned. Moves go by quarter squares and turns by 15 degrees, or freely with Shift.
 */
import * as THREE from 'three';
import { turnOf, type Spell } from './spells';

export type SpellAxis = 'x' | 'y' | 'z';
export type SpellHandle = { kind: 'move' | 'turn'; axis: SpellAxis };

const AXES: Record<SpellAxis, THREE.Vector3> = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const COLORS: Record<SpellAxis, number> = { x: 0xf0524f, y: 0x5fd35f, z: 0x4f8ff0 };
/** How big the handles are on screen: a share of the view's height. */
const SCREEN_SHARE = 0.16;
const TURN_STEP = Math.PI / 12;

function material(color: number, opacity = 0.95): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity, side: THREE.DoubleSide });
}

interface Drag {
  handle: SpellHandle;
  spell: Spell;
  /** Where along the axis (a move) or at what angle (a turn) the press was. */
  start: number;
  /** A turn seen edge on: the pointer's x instead. */
  screenX: number | null;
}

export class SpellGizmo {
  readonly object3d = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private drag: Drag | null = null;
  private hovered: THREE.Mesh[] = [];

  constructor() {
    this.object3d.name = 'spell-gizmo';
    this.object3d.renderOrder = 1000;
    const add = (handle: SpellHandle, geometry: THREE.BufferGeometry, place: (mesh: THREE.Mesh) => void, opacity?: number): void => {
      const mesh = new THREE.Mesh(geometry, material(COLORS[handle.axis], opacity));
      mesh.userData.handle = handle;
      mesh.userData.color = COLORS[handle.axis];
      mesh.renderOrder = 1000;
      place(mesh);
      this.meshes.push(mesh);
      this.object3d.add(mesh);
    };
    // The arrows, unit long: built along +y, laid along their axis.
    const lay = (axis: SpellAxis) => (mesh: THREE.Mesh): void => {
      if (axis === 'x') mesh.rotation.z = -Math.PI / 2;
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      add({ kind: 'move', axis }, new THREE.CylinderGeometry(0.035, 0.035, 0.75, 8).translate(0, 0.42, 0), lay(axis));
      add({ kind: 'move', axis }, new THREE.ConeGeometry(0.1, 0.26, 14).translate(0, 0.9, 0), lay(axis));
      // A fatter, unseen sleeve, so the arrow is easy to catch.
      add({ kind: 'move', axis }, new THREE.CylinderGeometry(0.12, 0.12, 1.05, 8).translate(0, 0.55, 0), lay(axis), 0);
    }
    // The rings, round each axis.
    const ring = (axis: SpellAxis) => (mesh: THREE.Mesh): void => {
      if (axis === 'x') mesh.rotation.y = Math.PI / 2;
      if (axis === 'y') mesh.rotation.x = Math.PI / 2;
    };
    for (const axis of ['x', 'y', 'z'] as const) {
      add({ kind: 'turn', axis }, new THREE.TorusGeometry(1.25, 0.025, 8, 96), ring(axis));
      add({ kind: 'turn', axis }, new THREE.TorusGeometry(1.25, 0.09, 6, 64), ring(axis), 0);
    }
    // A ball at the middle.
    const middle = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), material(0xffffff));
    middle.renderOrder = 1000;
    middle.raycast = () => {};
    this.object3d.add(middle);
    this.object3d.traverse((node) => { node.userData.noOutline = true; });
  }

  /** Stands the handles on the spell's middle, one size on screen for `camera`. */
  place(spell: Spell, camera: THREE.PerspectiveCamera): void {
    this.object3d.position.set(spell.at.x, spell.at.h, spell.at.y);
    const distance = camera.position.distanceTo(this.object3d.position);
    const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    this.object3d.scale.setScalar(Math.max(1e-3, height * SCREEN_SHARE));
    this.object3d.updateMatrixWorld(true);
  }

  /** The handle a ray meets, nearest first, or null. */
  hit(ray: THREE.Raycaster): SpellHandle | null {
    this.object3d.updateMatrixWorld(true);
    // An arrow goes before a ring it crosses on screen (a ring seen edge on lies along an arrow).
    const found = ray.intersectObjects(this.meshes, false).map((hit) => hit.object.userData.handle as SpellHandle);
    return found.find((handle) => handle.kind === 'move') ?? found[0] ?? null;
  }

  /** Lights the handle under the pointer (null: none). */
  hover(handle: SpellHandle | null): void {
    for (const mesh of this.hovered) (mesh.material as THREE.MeshBasicMaterial).color.setHex(mesh.userData.color as number);
    this.hovered = handle ? this.meshes.filter((mesh) => {
      const own = mesh.userData.handle as SpellHandle;
      return own.kind === handle.kind && own.axis === handle.axis;
    }) : [];
    for (const mesh of this.hovered) (mesh.material as THREE.MeshBasicMaterial).color.setHex(0xffe066);
  }

  get dragging(): boolean {
    return this.drag !== null;
  }

  /** A press on a handle: the drag starts from the spell as it is. False off the handles. */
  grab(ray: THREE.Raycaster, spell: Spell, pointerX: number): boolean {
    const handle = this.hit(ray);
    if (!handle) return false;
    const start = this.measure(handle, ray, spell);
    this.drag = { handle, spell, start: start ?? 0, screenX: start === null ? pointerX : null };
    this.hover(handle);
    return true;
  }

  /** The pointer moved while a handle is held: the spell as moved or turned, or null when nothing is held. */
  move(ray: THREE.Raycaster, pointerX: number, cell: number, free: boolean): Spell | null {
    const drag = this.drag;
    if (!drag) return null;
    const { handle, spell } = drag;
    if (handle.kind === 'move') {
      const now = this.measure(handle, ray, spell);
      if (now === null) return spell;
      let by = now - drag.start;
      if (!free) by = Math.round(by / (cell / 4)) * (cell / 4);
      const shift = AXES[handle.axis].clone().multiplyScalar(by);
      return { ...spell, at: { x: spell.at.x + shift.x, y: spell.at.y + shift.z, h: spell.at.h + shift.y } };
    }
    let angle: number;
    if (drag.screenX !== null) angle = (pointerX - drag.screenX) * 0.01;
    else {
      const now = this.measure(handle, ray, spell);
      if (now === null) return spell;
      angle = now - drag.start;
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
    }
    if (!free) angle = Math.round(angle / TURN_STEP) * TURN_STEP;
    const turned = new THREE.Quaternion().setFromAxisAngle(AXES[handle.axis], angle).multiply(turnOf(spell));
    const euler = new THREE.Euler().setFromQuaternion(turned, 'YXZ');
    return { ...spell, pitch: euler.x, yaw: euler.y, roll: euler.z };
  }

  release(): void {
    this.drag = null;
    this.hover(null);
  }

  /**
   * Where the ray is for a handle: a move's place along its axis line (the nearest point of the line to the ray); a
   * turn's angle round its axis, in the plane across it. Null where the ray runs along the line or the plane.
   */
  private measure(handle: SpellHandle, ray: THREE.Raycaster, spell: Spell): number | null {
    const origin = new THREE.Vector3(spell.at.x, spell.at.h, spell.at.y);
    const axis = AXES[handle.axis];
    const { origin: from, direction } = ray.ray;
    if (handle.kind === 'move') {
      // The closest points of two lines: origin + s·axis and from + t·direction.
      const w = origin.clone().sub(from);
      const b = axis.dot(direction);
      const denominator = 1 - b * b;
      if (Math.abs(denominator) < 1e-4) return null;
      const d = axis.dot(w);
      const e = direction.dot(w);
      return (b * e - d) / denominator;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, origin);
    if (Math.abs(direction.dot(axis)) < 0.15) return null;
    const at = ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return null;
    const off = at.sub(origin);
    // An angle round the axis, by two directions across it.
    const across = Math.abs(axis.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = across.clone().sub(axis.clone().multiplyScalar(across.dot(axis))).normalize();
    const v = axis.clone().cross(u);
    return Math.atan2(off.dot(v), off.dot(u));
  }

  dispose(): void {
    this.object3d.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    });
    this.object3d.removeFromParent();
  }
}
