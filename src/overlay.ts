/**
 * The minis over one Atlas map view: a transparent WebGL canvas laid over the view's map canvas, which takes no pointer
 * input, drawn top-down with an orthographic camera in the canvas's own CSS pixels. Each frame every mini is put where
 * its token's sprite is (so it follows drags and glides), sized to the token's footprint and turned with it. A mini
 * leans away from the way it is moved and springs back upright, plays its GLB's animations (an idle clip, and a walk
 * or run clip while it moves) and wobbles when its token is clicked.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  gridSize, isLoaded, mapCanvas, tokenAt, tokenPixelSize, tokenSprites, viewport, type AtlasView,
} from './atlas';
import type { Assignments, MiniPlacement } from './assignments';
import type { LoadedMini, MiniLibrary } from './library';

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
/** A press that travels further than this (CSS px) or lasts longer than this is a drag, not a click. */
const CLICK_SLOP_PX = 6;
const CLICK_MS = 450;
const CAMERA_HEIGHT = 100_000;

interface Spring { value: number; velocity: number }

function step(spring: Spring, target: number, dt: number): void {
  const force = SPRING_K * (target - spring.value) - SPRING_D * spring.velocity;
  spring.velocity += force * dt;
  spring.value += spring.velocity * dt;
}

interface Instance {
  readonly tokenId: string;
  readonly mini: string;
  readonly anchor: THREE.Group;
  readonly lean: THREE.Group;
  readonly yaw: THREE.Group;
  readonly materials: THREE.Material[];
  model: LoadedMini | null;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  move: THREE.AnimationAction | null;
  moving: boolean;
  opacity: number;
  /** Last place of the token in world units, for its speed. */
  last: { x: number; y: number } | null;
  leanX: Spring;
  leanZ: Spring;
  lift: Spring;
  shakeAt: number | null;
  failed: boolean;
}

const findClip = (clips: readonly THREE.AnimationClip[], pattern: RegExp): THREE.AnimationClip | null => clips.find((clip) => pattern.test(clip.name)) ?? null;

export class MiniOverlay {
  private readonly win: Window;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, CAMERA_HEIGHT * 2);
  private readonly instances = new Map<string, Instance>();
  private readonly clock = new THREE.Clock();
  private frame: number | null = null;
  private disposed = false;
  private press: { id: string; x: number; y: number; at: number } | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(
    private readonly view: AtlasView,
    private readonly assignments: Assignments,
    private readonly library: MiniLibrary,
    private readonly onFailed: (mini: string, error: unknown) => void,
  ) {
    const doc = view.containerEl?.ownerDocument ?? document;
    this.win = doc.defaultView ?? window;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'atlas-tabletop-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, CAMERA_HEIGHT, 0);
    // Screen right is +x and screen down is +z: the camera looks down with -z as its up.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4250, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    // From the top left of the screen, high up.
    sun.position.set(-0.6, 1, -0.8);
    this.scene.add(sun);

    const root = view.containerEl;
    if (root) {
      const down = (event: PointerEvent): void => this.pointerDown(event);
      const up = (event: PointerEvent): void => this.pointerUp(event);
      root.addEventListener('pointerdown', down, true);
      root.addEventListener('pointerup', up, true);
      this.stops.push(() => { root.removeEventListener('pointerdown', down, true); root.removeEventListener('pointerup', up, true); });
    }
    this.schedule();
  }

  get viewId(): string {
    return this.view.viewId;
  }

  /** Wobbles the mini on `tokenId`, if it has one. */
  shake(tokenId: string): void {
    const instance = this.instances.get(tokenId);
    if (instance) instance.shakeAt = this.clock.elapsedTime;
  }

  private pointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const id = tokenAt(this.view, event.clientX, event.clientY);
    this.press = id && this.instances.has(id) ? { id, x: event.clientX, y: event.clientY, at: performance.now() } : null;
  }

  private pointerUp(event: PointerEvent): void {
    const press = this.press;
    this.press = null;
    if (!press || event.button !== 0) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP_PX || performance.now() - press.at > CLICK_MS) return;
    this.shake(press.id);
  }

  private schedule(): void {
    if (this.disposed || this.frame !== null) return;
    this.frame = this.win.requestAnimationFrame(() => {
      this.frame = null;
      try {
        this.draw();
      } catch (error) {
        console.error('[Tabletop] Drawing the minis failed:', error);
      }
      this.schedule();
    });
  }

  private sync(mapPath: string, tokens: Readonly<Record<string, unknown>>): void {
    const wanted = this.assignments.forMap(mapPath);
    for (const [id, instance] of [...this.instances]) {
      const placement = wanted[id];
      if (!placement || placement.mini !== instance.mini || !Object.hasOwn(tokens, id)) this.drop(id);
    }
    for (const [id, placement] of Object.entries(wanted)) {
      if (!this.instances.has(id) && Object.hasOwn(tokens, id)) this.add(id, placement);
    }
  }

  private add(tokenId: string, placement: MiniPlacement): void {
    const anchor = new THREE.Group();
    const lean = new THREE.Group();
    const yaw = new THREE.Group();
    anchor.add(lean);
    lean.add(yaw);
    anchor.visible = false;
    this.scene.add(anchor);
    const instance: Instance = {
      tokenId, mini: placement.mini, anchor, lean, yaw, materials: [], model: null, mixer: null, idle: null, move: null, moving: false,
      opacity: 1, last: null, leanX: { value: 0, velocity: 0 }, leanZ: { value: 0, velocity: 0 }, lift: { value: 0, velocity: 0 }, shakeAt: null, failed: false,
    };
    this.instances.set(tokenId, instance);
    this.library.load(placement.mini).then((model) => {
      if (this.instances.get(tokenId) !== instance || this.disposed) return;
      const copy = cloneSkinned(model.scene);
      // Own materials, so a hidden token's mini can be faded without fading every copy of the GLB.
      copy.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => material.clone());
        instance.materials.push(...own);
        mesh.material = Array.isArray(mesh.material) ? own : own[0]!;
      });
      yaw.add(copy);
      instance.model = model;
      if (model.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(copy);
        const idleClip = findClip(model.animations, /idle|stand|breath/i) ?? (findClip(model.animations, /walk|run|move/i) ? null : model.animations[0]!);
        const moveClip = findClip(model.animations, /walk|run|move|jog/i);
        instance.mixer = mixer;
        instance.idle = idleClip ? mixer.clipAction(idleClip) : null;
        instance.move = moveClip ? mixer.clipAction(moveClip) : null;
        instance.idle?.play();
      }
    }, (error: unknown) => {
      if (this.instances.get(tokenId) !== instance) return;
      instance.failed = true;
      this.onFailed(placement.mini, error);
    });
  }

  private drop(tokenId: string): void {
    const instance = this.instances.get(tokenId);
    if (!instance) return;
    this.instances.delete(tokenId);
    instance.mixer?.stopAllAction();
    this.scene.remove(instance.anchor);
    // Geometry and textures are the shared GLB's; only the materials are this copy's.
    for (const material of instance.materials) material.dispose();
  }

  private hide(): void {
    if (this.canvas.style.display !== 'none') this.canvas.style.display = 'none';
  }

  private draw(): void {
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    const now = this.clock.elapsedTime;
    const state = this.view.atlasStore.getState();
    if (!isLoaded(state) || !this.view.containerEl?.isConnected) {
      for (const id of [...this.instances.keys()]) this.drop(id);
      this.hide();
      return;
    }
    const mapPath = state.mapPath as string;
    const tokens = state.objects.tokens;
    this.sync(mapPath, tokens);
    const target = mapCanvas(this.view);
    const port = viewport(this.view);
    if (this.instances.size === 0 || !target || !port?.toScreen) {
      this.hide();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      this.hide();
      return;
    }
    this.place(target, rect);
    const zoom = port.scale?.x && port.scale.x > 0 ? port.scale.x : 1;
    const sprites = tokenSprites(this.view);
    const grid = gridSize(this.view);
    const placements = this.assignments.forMap(mapPath);

    for (const instance of this.instances.values()) {
      const token = tokens[instance.tokenId];
      const sprite = sprites[instance.tokenId];
      const placement = placements[instance.tokenId];
      const shown = instance.model && token && placement && sprite && sprite.destroyed !== true && sprite.visible && sprite.worldVisible !== false && sprite.alpha > 0.01;
      if (!shown) {
        instance.anchor.visible = false;
        instance.last = null;
        continue;
      }
      const model = instance.model!;
      const at = port.toScreen(sprite.x, sprite.y);
      instance.anchor.visible = true;
      instance.anchor.position.set(at.x, 0, at.y);

      // Speed in screen pixels, from the token's place in the world: panning the camera does not lean anything.
      let vx = 0;
      let vz = 0;
      if (instance.last && dt > 0) {
        vx = ((sprite.x - instance.last.x) * zoom) / dt;
        vz = ((sprite.y - instance.last.y) * zoom) / dt;
      }
      instance.last = { x: sprite.x, y: sprite.y };
      const speed = Math.hypot(vx, vz);
      const leanAngle = Math.min(MAX_LEAN, speed * LEAN_PER_SPEED);
      // Leans back from the way it goes: about the axis across the movement, so its top trails.
      const ax = speed > 1 ? (-vz / speed) * leanAngle : 0;
      const az = speed > 1 ? (vx / speed) * leanAngle : 0;
      step(instance.leanX, ax, dt);
      step(instance.leanZ, az, dt);
      step(instance.lift, speed > MOVING_SPEED ? LIFT : 0, dt);
      const tilt = Math.hypot(instance.leanX.value, instance.leanZ.value);
      if (tilt > 1e-4) instance.lean.quaternion.setFromAxisAngle(new THREE.Vector3(instance.leanX.value / tilt, 0, instance.leanZ.value / tilt), tilt);
      else instance.lean.quaternion.identity();

      let wobble = 0;
      let squash = 0;
      if (instance.shakeAt !== null) {
        const t = now - instance.shakeAt;
        if (t > SHAKE_SECONDS) instance.shakeAt = null;
        else {
          const fade = Math.exp(-t * 5);
          wobble = 0.45 * Math.sin(t * 32) * fade;
          squash = 0.12 * Math.sin(t * 24) * fade;
        }
      }
      // Atlas turns tokens clockwise on screen; about +y that is a negative turn here.
      instance.yaw.rotation.y = -THREE.MathUtils.degToRad((token.rotation ?? 0) + placement.turn) + wobble;
      const size = tokenPixelSize(grid, token.size) * zoom * placement.scale * FILL * (1 + instance.lift.value);
      const base = size / model.footprint;
      instance.yaw.scale.set(base * (1 - squash / 2), base * (1 + squash), base * (1 - squash / 2));

      const opacity = Math.min(1, sprite.alpha);
      if (Math.abs(opacity - instance.opacity) > 0.01) {
        instance.opacity = opacity;
        for (const material of instance.materials) {
          material.transparent = opacity < 1;
          material.opacity = opacity;
          material.needsUpdate = true;
        }
      }

      const moving = speed > MOVING_SPEED;
      if (moving !== instance.moving && instance.move) {
        const [from, to] = moving ? [instance.idle, instance.move] : [instance.move, instance.idle];
        to?.reset().play();
        if (from && to) from.crossFadeTo(to, 0.25, false);
        else from?.fadeOut(0.25);
      }
      instance.moving = moving;
      instance.mixer?.update(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  /** Lays the overlay exactly over the map canvas, at the window's pixel ratio. */
  private place(target: HTMLCanvasElement, rect: DOMRect): void {
    if (this.canvas.previousElementSibling !== target) target.after(this.canvas);
    const style = this.canvas.style;
    style.display = 'block';
    style.position = 'absolute';
    style.left = `${target.offsetLeft}px`;
    style.top = `${target.offsetTop}px`;
    style.width = `${rect.width}px`;
    style.height = `${rect.height}px`;
    const ratio = this.win.devicePixelRatio || 1;
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== rect.width || size.y !== rect.height) this.renderer.setSize(rect.width, rect.height, false);
    if (this.camera.right !== rect.width || this.camera.bottom !== -rect.height) {
      this.camera.left = 0;
      this.camera.right = rect.width;
      this.camera.top = 0;
      this.camera.bottom = -rect.height;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    for (const stop of this.stops.splice(0)) stop();
    for (const id of [...this.instances.keys()]) this.drop(id);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
