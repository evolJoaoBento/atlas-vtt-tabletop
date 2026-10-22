/**
 * Physical dice on the board: a tray laid at the camera's centre (see tray.ts), dice thrown into it with cannon-es, and
 * each die read once it comes to rest. The world is Interactive Dice's, tuned the same way, in die units (a die's edge
 * is 1); the dice's group is scaled up to the board and turned with the camera, so the tray's near wall faces the
 * thrower. Only the thrower's board draws the dice: the board keeps them out of the players' picture.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { diePhysicsShape, dieFaceNormals, dieGeometry, dieMaterial, type DicePack } from './kit/dieShapes';
import { readFace, type DieType, type FaceReading, type Vec3 } from './kit/faces';
import type { RollSession } from './rollSession';
import { MAX_THROW_SPEED, MIN_THROW_SPEED, throwVector, type Flick } from './throwInput';
import { dieEdgePx, trayAt, type Tray } from './tray';

export interface DiceTableHost {
  scene: THREE.Scene;
  gridSize(): number;
  /** Where the camera looks, on the ground (map pixels). */
  target(): { x: number; z: number };
  visibleHalfExtent(): { x: number; z: number };
  cameraYaw(): number;
  /** Asks the board for frames: dice are moving. */
  wake(): void;
  textures(type: DieType): { map?: THREE.Texture; normalMap?: THREE.Texture };
  pack(): DicePack;
}

export interface DiceSettings {
  /** A die's edge, in grid squares. */
  dieSquares: number;
  /** How far from flat a die may rest and still be read (Interactive Dice's face detection tolerance). */
  tolerance: number;
  /** Interactive Dice's motion threshold: higher waits for stiller dice. */
  motionThreshold: number;
  shadows: boolean;
  /** Whether a die caught on an edge is lit up, and in what colour. */
  highlight: boolean;
  highlightColor: string;
}

/** Half a d6's edge: the kit builds its solids at a size that is half the cube's edge, so a die's edge is 1. */
const DIE_SIZE = 0.5;
/** Interactive Dice's world: gravity scaled to dice, its contact stiffness, its step. */
const GRAVITY = -60;
const STEP = 1 / 120;
const MAX_SUBSTEPS = 8;
/** A die on the felt lies no higher than this over the floor (Interactive Dice's settle height, in die edges); higher, it rests on another die. */
const RESTING_HEIGHT = 1.2;
/** How far from a die's centre, across the felt, another die's centre may be and still rest on it (in die edges). */
const SUPPORT_REACH = 1.5;
/** Still for this long, a die is read where it lies, on the felt or on another die (Interactive Dice looks again every 100 ms). */
const STILL_MS = 100;
/** A die that never stops (jittering on another) is held after this long, and caught: it showed no face at rest. */
const LONGEST_ROLL_MS = 12_000;
/** Where a throw starts: a share of the tray behind its centre, this high, the dice this far apart. */
const START_SHARE = 0.55;
const START_HEIGHT = 3;
const SPREAD = 1.4;
/** How many places beside its own a die tries, a spread apart, for a start clear of the dice already there. */
const START_TRIES = 6;
/** Throw speed, in die edges per second: the flick's gentlest toss to its hardest fling. */
const MIN_SPEED = 10;
const MAX_SPEED = 40;
/** Interactive Dice's downward push and its largest spin, in radians per second. */
const DROP_SPEED = 3;
const MAX_SPIN = 25;

// cannon multiplies the friction and restitution of the two materials that touch (no contact materials are registered),
// so these are Interactive Dice's numbers as they are: a die, the felt and the walls.
const DIE_MATERIAL = new CANNON.Material({ friction: 0.4, restitution: 0.3 });
const FLOOR_MATERIAL = new CANNON.Material({ friction: 0.7, restitution: 0.25 });
const WALL_MATERIAL = new CANNON.Material({ friction: 0.3, restitution: 0.45 });

interface ThrownDie {
  type: DieType;
  body: CANNON.Body;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
  /** How far its farthest corner is from its centre, in die edges. */
  radius: number;
  normals: Vec3[];
  numbers: number[];
  /** Read and reported: it lies still until thrown again. */
  settled: boolean;
  stillMs: number;
  rollingMs: number;
}

export class DiceTable {
  /** The dice in the board's scene: the board hides it from the players' picture. */
  readonly object3d = new THREE.Group();
  /** A die came to rest: what it shows (caught when no face is up). */
  onSettled: (id: number, reading: FaceReading) => void = () => {};
  private readonly world = new CANNON.World();
  private readonly dice = new Map<number, ThrownDie>();
  private walls: CANNON.Body[] = [];
  private tray: Tray | null = null;
  private session: RollSession | null = null;
  private readonly raycaster = new THREE.Raycaster();

  constructor(private readonly host: DiceTableHost, private readonly settings: DiceSettings) {
    this.world.gravity.set(0, GRAVITY, 0);
    // World.allowSleep is off unless asked: without it no die would ever sleep.
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.contactEquationStiffness = 1e7;
    this.world.defaultContactMaterial.contactEquationRelaxation = 4;
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.broadphase.useBoundingBoxes = true;
    // Solver iterations stay at cannon's 10: Interactive Dice measured fewer than 8 leaving a d4 or d8 never asleep.
    this.object3d.name = 'tabletop-dice';
    host.scene.add(this.object3d);
  }

  /** Dice are in the air: the board steps the table and draws every frame. */
  get busy(): boolean {
    for (const die of this.dice.values()) if (!die.settled) return true;
    return false;
  }

  /** Throws a roll's dice into a tray laid where the camera looks now; the dice of an earlier roll go. */
  throwRoll(session: RollSession, flick: Flick): void {
    this.clear();
    this.session = session;
    this.layTray();
    const rolling = session.dice.filter((state) => state.status === 'rolling');
    rolling.forEach((state, index) => this.launch(this.dieFor(state.id, state.die, state.color), flick, index, rolling.length));
    this.host.wake();
  }

  /** Throws one die again (caught, or rerolled), or a new one of the session (an explosion), into the same tray. */
  throwDie(dieId: number, flick: Flick): void {
    let die = this.dice.get(dieId);
    if (!die) {
      const state = this.session?.dice.find((candidate) => candidate.id === dieId);
      if (!state) return;
      if (!this.tray) this.layTray();
      die = this.dieFor(state.id, state.die, state.color);
    }
    this.loosenDiceOn(die);
    this.launch(die, flick, 0, 1);
    this.host.wake();
  }

  /** Moves the dice on by `dtMs` and reads every die that has come to rest. */
  step(dtMs: number): void {
    if (!this.busy || dtMs <= 0) return;
    this.world.step(STEP, dtMs / 1000, MAX_SUBSTEPS);
    // Interactive Dice's settling: slower than these, wherever the die lies.
    const velocityLimit = 0.05 / this.settings.motionThreshold;
    const spinLimit = 0.5 / this.settings.motionThreshold;
    for (const [id, die] of this.dice) {
      const { body, mesh } = die;
      mesh.position.set(body.position.x, body.position.y, body.position.z);
      mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      if (die.settled) continue;
      die.rollingMs += dtMs;
      const still = body.velocity.length() <= velocityLimit && body.angularVelocity.length() <= spinLimit;
      die.stillMs = still ? die.stillMs + dtMs : 0;
      if (die.stillMs >= STILL_MS) this.settle(id, die, true);
      else if (die.rollingMs >= LONGEST_ROLL_MS) this.settle(id, die, false);
    }
  }

  /** The die a ray (in the board's world) meets first, or null. */
  pick(ray: THREE.Ray): number | null {
    this.object3d.updateMatrixWorld(true);
    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects([...this.dice.values()].map((die) => die.mesh), false);
    const id = hits[0]?.object.userData.dieId as number | undefined;
    return id ?? null;
  }

  /** Takes every die and the tray away. */
  clear(): void {
    for (const die of this.dice.values()) this.removeDie(die);
    this.dice.clear();
    for (const wall of this.walls) this.world.removeBody(wall);
    this.walls = [];
    this.tray = null;
    this.session = null;
  }

  dispose(): void {
    this.clear();
    this.object3d.removeFromParent();
  }

  /** The tray where the camera looks: its floor and four walls, and the dice's group placed and scaled on it. */
  private layTray(): void {
    for (const wall of this.walls) this.world.removeBody(wall);
    const grid = this.host.gridSize();
    const tray = trayAt(this.host.target(), this.host.visibleHalfExtent(), grid, this.host.cameraYaw());
    this.tray = tray;
    const edge = dieEdgePx(grid, this.settings.dieSquares);
    this.object3d.position.set(tray.center.x, 0, tray.center.z);
    this.object3d.rotation.set(0, tray.yaw, 0);
    this.object3d.scale.setScalar(edge);
    const halfWidth = tray.halfWidth / edge;
    const halfDepth = tray.halfDepth / edge;
    // Planes, the floor's and the walls': a die meets one by its corners, as it meets the felt, and nothing goes through.
    const plane = (material: CANNON.Material, x: number, z: number, axis: CANNON.Vec3, angle: number): CANNON.Body => {
      const body = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane() });
      body.position.set(x, 0, z);
      body.quaternion.setFromAxisAngle(axis, angle);
      return body;
    };
    const up = new CANNON.Vec3(0, 1, 0);
    this.walls = [
      // A plane faces its +z: the floor is turned to face up, each wall to face into the tray.
      plane(FLOOR_MATERIAL, 0, 0, new CANNON.Vec3(1, 0, 0), -Math.PI / 2),
      plane(WALL_MATERIAL, 0, -halfDepth, up, 0),
      plane(WALL_MATERIAL, 0, halfDepth, up, Math.PI),
      plane(WALL_MATERIAL, -halfWidth, 0, up, Math.PI / 2),
      plane(WALL_MATERIAL, halfWidth, 0, up, -Math.PI / 2),
    ];
    for (const body of this.walls) this.world.addBody(body);
  }

  /** A die's body and mesh, made once per id. */
  private dieFor(id: number, type: DieType, color: string | undefined): ThrownDie {
    const existing = this.dice.get(id);
    if (existing) return existing;
    const pack = this.host.pack();
    const geometry = dieGeometry(type, DIE_SIZE, pack);
    const { normals, numbers } = dieFaceNormals(type, geometry);
    const mesh = new THREE.Mesh(geometry, dieMaterial(type, pack, this.host.textures(type), color ?? null));
    mesh.castShadow = this.settings.shadows;
    mesh.receiveShadow = this.settings.shadows;
    mesh.userData.dieId = id;
    this.object3d.add(mesh);
    const body = new CANNON.Body({ mass: 1, material: DIE_MATERIAL, shape: diePhysicsShape(type, geometry) });
    body.linearDamping = 0.1;
    body.angularDamping = 0.1;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.1;
    body.sleepTimeLimit = 1;
    this.world.addBody(body);
    const corners = geometry.getAttribute('position');
    let radius = 0;
    for (let i = 0; i < corners.count; i++) radius = Math.max(radius, Math.hypot(corners.getX(i), corners.getY(i), corners.getZ(i)));
    const die: ThrownDie = { type, body, mesh, radius, normals, numbers, settled: false, stillMs: 0, rollingMs: 0 };
    this.dice.set(id, die);
    return die;
  }

  /**
   * Sends a die across the tray the way the flick went (up the screen is away from the thrower), from behind the
   * tray's centre so it has the tray to roll in; the `index`th of `count` dice thrown together stands beside the others.
   */
  private launch(die: ThrownDie, flick: Flick, index: number, count: number): void {
    const tray = this.tray as Tray;
    const edge = dieEdgePx(this.host.gridSize(), this.settings.dieSquares);
    const halfWidth = tray.halfWidth / edge;
    const halfDepth = tray.halfDepth / edge;
    // The flick on the ground as the camera sees it now, turned into the tray's frame (its +x screen right when it was
    // laid, +z toward the thrower): the camera may have turned since.
    const thrown = throwVector(flick, this.host.cameraYaw() - tray.yaw);
    const dir = { x: thrown.x, z: thrown.z };
    const across = { x: -dir.z, z: dir.x };
    const offset = (index - (count - 1) / 2) * SPREAD;
    const inside = (value: number, half: number): number => Math.max(-half + 1, Math.min(half - 1, value));
    const speed = MIN_SPEED + ((thrown.speed - MIN_THROW_SPEED) / (MAX_THROW_SPEED - MIN_THROW_SPEED)) * (MAX_SPEED - MIN_SPEED);
    const { body } = die;
    this.loosen(die);
    const start = (shift: number): CANNON.Vec3 => new CANNON.Vec3(
      inside(-dir.x * halfWidth * START_SHARE + across.x * (offset + shift), halfWidth),
      START_HEIGHT + (index % 3) * 1.2,
      inside(-dir.z * halfDepth * START_SHARE + across.z * (offset + shift), halfDepth),
    );
    body.position.copy(this.clearStart(die, start));
    body.quaternion.setFromEuler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    body.velocity.set(dir.x * speed + (Math.random() - 0.5) * 2, -DROP_SPEED, dir.z * speed + (Math.random() - 0.5) * 2);
    // Spin that rolls the die the way it travels, plus some of every kind.
    const spin = (): number => (Math.random() - 0.5) * MAX_SPIN;
    body.angularVelocity.set(spin() + dir.z * MAX_SPIN * 0.4, spin(), spin() - dir.x * MAX_SPIN * 0.4);
    die.mesh.material.emissive.set(0x000000);
    die.mesh.position.set(body.position.x, body.position.y, body.position.z);
    die.mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
  }

  /**
   * Where a die starts clear of every other die (at rest, or thrown just before it): its own place, else the nearest
   * clear one beside it, else its own place lifted over the dice there. A die started inside another is flung out.
   */
  private clearStart(die: ThrownDie, start: (shift: number) => CANNON.Vec3): CANNON.Vec3 {
    const others = [...this.dice.values()].filter((other) => other !== die);
    const clear = (at: CANNON.Vec3): boolean => others.every((other) => other.body.position.distanceTo(at) >= die.radius + other.radius);
    for (let i = 0; i <= START_TRIES * 2; i++) {
      // 0, then a spread to one side, the other, two spreads to one side...
      const at = start(Math.ceil(i / 2) * (i % 2 === 0 ? -SPREAD : SPREAD));
      if (clear(at)) return at;
    }
    const at = start(0);
    for (const other of others) {
      const across = Math.hypot(other.body.position.x - at.x, other.body.position.z - at.z);
      if (across < die.radius + other.radius) at.y = Math.max(at.y, other.body.position.y + die.radius + other.radius);
    }
    return at;
  }

  /** A held die moves again, under gravity and bumps, and is read again once it stops. */
  private loosen(die: ThrownDie): void {
    const { body } = die;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = 1;
    body.updateMassProperties();
    body.wakeUp();
    die.settled = false;
    die.stillMs = 0;
    die.rollingMs = 0;
  }

  /**
   * Lets go of the dice held resting on `under` (and on those, in turn) before it is thrown again: held, they would
   * float where it was. A held body touches no other held body, so they are found by where they lie, not by contacts.
   */
  private loosenDiceOn(under: ThrownDie): void {
    const { x, y, z } = under.body.position;
    for (const die of this.dice.values()) {
      if (die === under || !die.settled) continue;
      const at = die.body.position;
      if (at.y <= RESTING_HEIGHT || at.y <= y || Math.hypot(at.x - x, at.z - z) > SUPPORT_REACH) continue;
      this.loosen(die);
      this.loosenDiceOn(die);
    }
  }

  /**
   * Reads a die at rest and holds it there (another die bumps it no more), lit up when it is caught on an edge. A die
   * held only because it never stopped (`still` false) is caught: what it showed in passing is no number.
   */
  private settle(id: number, die: ThrownDie, still: boolean): void {
    const { body } = die;
    const reading: FaceReading = still
      ? readFace(die.type, die.normals, die.numbers, body.quaternion, this.settings.tolerance)
      : { caught: true, face: null, confidence: 0 };
    die.settled = true;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
    die.mesh.material.emissive.set(reading.caught && this.settings.highlight ? this.settings.highlightColor : 0x000000);
    // The board's frame loop steps the table: a listener's failure stays here, and the other dice are still read.
    try {
      this.onSettled(id, reading);
    } catch (error) {
      console.error('[Tabletop] A settled die listener failed:', error);
    }
  }

  private removeDie(die: ThrownDie): void {
    this.world.removeBody(die.body);
    die.mesh.removeFromParent();
    die.mesh.geometry.dispose();
    die.mesh.material.dispose();
  }
}
