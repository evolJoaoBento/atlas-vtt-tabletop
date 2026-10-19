/**
 * One mini standing on a token, as both the GM's overlay (`overlay.ts`) and the players' views (`playerMinis.ts`) draw
 * it: sized to the token's footprint and turned with it, leaning away from the way it is moved and springing back
 * upright, lifted a little while it moves, playing its GLB's idle clip (a walk or run clip while it moves) and wobbling
 * when shaken. The figure is a chain of groups, anchor → lean → yaw, standing on y = 0 in a top-down scene where screen
 * right is +x and screen down is +z.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LoadedMini } from './library';

/** Share of the token's diameter the mini's footprint fills at scale 1. */
const FILL = 0.9;
/** Lean per screen pixel per second of movement, and the most it leans. */
const LEAN_PER_SPEED = 0.0009;
const MAX_LEAN = THREE.MathUtils.degToRad(32);
/** Spring of the lean and the lift: stiffness and damping. */
const SPRING_K = 140;
const SPRING_D = 16;
/** How much bigger a mini looks while it is carried. */
const LIFT = 0.08;
/** Below this speed (screen px/s) a mini is standing still. */
const MOVING_SPEED = 25;
const SHAKE_SECONDS = 0.9;

interface Spring { value: number; velocity: number }

function step(spring: Spring, target: number, dt: number): void {
  const force = SPRING_K * (target - spring.value) - SPRING_D * spring.velocity;
  spring.velocity += force * dt;
  spring.value += spring.velocity * dt;
}

const settled = (spring: Spring): boolean => Math.abs(spring.value) < 1e-3 && Math.abs(spring.velocity) < 1e-3;
const findClip = (clips: readonly THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null => clips.find((clip) => pattern.test(clip.name)) ?? null;

/** Where and how a figure stands this frame. */
export interface FigurePose {
  /** Where it is drawn, in the scene's units. */
  x: number;
  y: number;
  /** Where its token is in the world, for its speed: panning the camera does not lean anything. */
  worldX: number;
  worldY: number;
  /** Screen pixels per world unit. */
  zoom: number;
  /** The token's diameter in the scene's units, the mini's own scale, and the token's rotation plus the mini's turn in degrees. */
  size: number;
  scale: number;
  turn: number;
  /** Seconds since the last frame, and the clock the shakes are timed on. */
  dt: number;
  now: number;
}

export class MiniFigure {
  readonly anchor = new THREE.Group();
  private readonly lean = new THREE.Group();
  private readonly yaw = new THREE.Group();
  private readonly materials: THREE.Material[] = [];
  private model: LoadedMini | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private idle: THREE.AnimationAction | null = null;
  private move: THREE.AnimationAction | null = null;
  private moving = false;
  private opacity = 1;
  private last: { x: number; y: number } | null = null;
  private readonly leanX: Spring = { value: 0, velocity: 0 };
  private readonly leanZ: Spring = { value: 0, velocity: 0 };
  private readonly lift: Spring = { value: 0, velocity: 0 };
  private shakeAt: number | null = null;

  constructor() {
    this.anchor.add(this.lean);
    this.lean.add(this.yaw);
  }

  get ready(): boolean {
    return this.model !== null;
  }

  /** Whether it moves on its own: a clip playing, a lean or a lift settling, a wobble. */
  get animating(): boolean {
    if (!this.model) return false;
    return this.mixer !== null || this.shakeAt !== null || this.moving || !settled(this.leanX) || !settled(this.leanZ) || !settled(this.lift);
  }

  /** Puts a copy of `model` on the figure, with its own materials so one copy can be faded alone. */
  attach(model: LoadedMini): void {
    const copy = cloneSkinned(model.scene);
    copy.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.frustumCulled = false;
      const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => material.clone());
      this.materials.push(...own);
      mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
    });
    this.yaw.add(copy);
    this.model = model;
    if (model.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(copy);
      const moveClip = findClip(model.animations, /walk|run|move|jog/i);
      const idleClip = findClip(model.animations, /idle|stand|breath/i) ?? (moveClip ? null : model.animations[0]!);
      this.mixer = mixer;
      this.idle = idleClip ? mixer.clipAction(idleClip) : null;
      this.move = moveClip ? mixer.clipAction(moveClip) : null;
      this.idle?.play();
    }
  }

  shake(now: number): void {
    this.shakeAt = now;
  }

  /** Not drawn this frame: it is hidden, and its speed starts over when it shows again. */
  hide(): void {
    this.anchor.visible = false;
    this.last = null;
  }

  pose(pose: FigurePose): void {
    const model = this.model;
    if (!model) {
      this.hide();
      return;
    }
    const { dt } = pose;
    this.anchor.visible = true;
    this.anchor.position.set(pose.x, 0, pose.y);
    // Speed in screen pixels, from the token's place in the world.
    let vx = 0;
    let vz = 0;
    if (this.last && dt > 0) {
      vx = ((pose.worldX - this.last.x) * pose.zoom) / dt;
      vz = ((pose.worldY - this.last.y) * pose.zoom) / dt;
    }
    this.last = { x: pose.worldX, y: pose.worldY };
    const speed = Math.hypot(vx, vz);
    const angle = Math.min(MAX_LEAN, speed * LEAN_PER_SPEED);
    // Leans back from the way it goes: about the axis across the movement, so its top trails.
    step(this.leanX, speed > 1 ? (-vz / speed) * angle : 0, dt);
    step(this.leanZ, speed > 1 ? (vx / speed) * angle : 0, dt);
    const moving = speed > MOVING_SPEED;
    step(this.lift, moving ? LIFT : 0, dt);
    const tilt = Math.hypot(this.leanX.value, this.leanZ.value);
    if (tilt > 1e-4) this.lean.quaternion.setFromAxisAngle(new THREE.Vector3(this.leanX.value / tilt, 0, this.leanZ.value / tilt), tilt);
    else this.lean.quaternion.identity();

    let wobble = 0;
    let squash = 0;
    if (this.shakeAt !== null) {
      const t = pose.now - this.shakeAt;
      if (t > SHAKE_SECONDS) this.shakeAt = null;
      else {
        const fade = Math.exp(-t * 5);
        wobble = 0.45 * Math.sin(t * 32) * fade;
        squash = 0.12 * Math.sin(t * 24) * fade;
      }
    }
    // Atlas turns tokens clockwise on screen; about +y that is a negative turn here.
    this.yaw.rotation.y = -THREE.MathUtils.degToRad(pose.turn) + wobble;
    const base = (pose.size * pose.scale * FILL * (1 + this.lift.value)) / model.footprint;
    this.yaw.scale.set(base * (1 - squash / 2), base * (1 + squash), base * (1 - squash / 2));

    if (moving !== this.moving && this.move) {
      const [from, to] = moving ? [this.idle, this.move] : [this.move, this.idle];
      to?.reset().play();
      if (from && to) from.crossFadeTo(to, 0.25, false);
      else from?.fadeOut(0.25);
    }
    this.moving = moving;
    this.mixer?.update(dt);
  }

  /** Fades the figure (a token only the GM sees). */
  fade(opacity: number): void {
    if (Math.abs(opacity - this.opacity) <= 0.01) return;
    this.opacity = opacity;
    for (const material of this.materials) {
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.needsUpdate = true;
    }
  }

  /** Takes it out of its scene. Geometry and textures are the shared GLB's; only the materials are this copy's. */
  dispose(): void {
    this.mixer?.stopAllAction();
    this.anchor.removeFromParent();
    for (const material of this.materials) material.dispose();
  }
}
