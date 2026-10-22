/**
 * Physical dice on the board: the map is the tray (see tray.ts), its edges the only walls; a roll's dice are laid at rest
 * where the camera looks, each picked up and carried under the pointer anywhere on the map and thrown with cannon-es
 * from where it is let go, and read once it comes to rest. The board's tokens, props and walls stand on the map as fixed
 * shapes: a die bounces off them, they never move. The world is Interactive Dice's, tuned the same way, in die units (a die's edge
 * is 1); the dice's group is scaled up to the board and turned with the camera, so the tray's near wall faces the
 * thrower. Only the thrower's board draws the dice: the board keeps them out of the players' picture.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { diePhysicsShape, dieMaterial, type DicePack } from './kit/dieShapes';
import { buildDie } from './dieBuild';
import { addOutline, disposeOutline, showOutline } from './dieOutline';
import { readFace, type DieType, type FaceReading, type Vec3 } from './kit/faces';
import type { RollSession } from './rollSession';
import { MAX_THROW_SPEED, MIN_THROW_SPEED, throwVector, type Flick } from './throwInput';
import { dieEdgePx, trayOnMap, type Tray } from './tray';

/**
 * Something on the board a die bounces off, in map pixels: a token or prop (round, `radius` across its middle), or a
 * wall (a box `halfLength` along `heading`, radians from map x toward map y, and `halfWidth` across it). It stands
 * `height` tall from the table.
 */
export type DiceObstacle =
  | { kind: 'round'; x: number; z: number; radius: number; height: number }
  | { kind: 'box'; x: number; z: number; halfLength: number; halfWidth: number; heading: number; height: number };

export interface DiceTableHost {
  scene: THREE.Scene;
  gridSize(): number;
  /** Where the camera looks, on the ground (map pixels). */
  target(): { x: number; z: number };
  /** The map's size in map pixels (it spans from 0, 0); 0 × 0 with none. */
  mapSize(): { width: number; height: number };
  cameraYaw(): number;
  /** Asks the board for frames: dice are moving. */
  wake(): void;
  /** A die's face sheet, painted over its colour (the pack's for the die when null), and its normal map. */
  textures(type: DieType, color: string | null): { map?: THREE.Texture; normalMap?: THREE.Texture };
  pack(): DicePack;
  /** What stands on the board for dice to bounce off (none without it). */
  obstacles?(): DiceObstacle[];
}

export interface DiceSettings {
  /** A die's edge, in grid squares. */
  dieSquares: number;
  /** How far from flat a die may rest and still be read (Interactive Dice's face detection tolerance). */
  tolerance: number;
  /** Interactive Dice's motion threshold: higher waits for stiller dice. */
  motionThreshold: number;
  shadows: boolean;
  /** Whether a die still to be thrown (laid, caught on an edge, an explosion's) has a line round it, and in what colour. */
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
/** How high a die is let go from at least, and how far apart dice thrown together start. */
const START_HEIGHT = 2;
const SPREAD = 1.4;
/** How high a die is carried under the pointer, in die edges. */
const HOLD_HEIGHT = 2;
/** How close the dice of a bundle in hand are held round the pointer, and the turn between one and the next. */
const BUNDLE_SPACING = 1.25;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/** How far apart the dice of a roll are laid on the table, centre to centre, in die edges. */
const LAY_SPACING = 1.8;
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
/** Tokens, props and the map's walls: a die bounces off them as off the tray's walls. */
const OBSTACLE_MATERIAL = new CANNON.Material({ friction: 0.4, restitution: 0.35 });

interface ThrownDie {
  type: DieType;
  body: CANNON.Body;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
  /** How far its farthest corner is from its centre, in die edges. */
  radius: number;
  normals: Vec3[];
  numbers: number[];
  /** Read and reported, laid on the table unthrown, or carried: it lies still (held) until thrown. */
  settled: boolean;
  /** Laid on the table, never thrown: it has nothing to read. */
  laid?: boolean;
  /** Carried under the pointer: no line round it while it is in hand. */
  held?: boolean;
  /** The roll waits on it being thrown: the line round it shows (unless it is in hand). */
  waited?: boolean;
  stillMs: number;
  rollingMs: number;
}

export class DiceTable {
  /** The dice in the board's scene: the board hides it from the players' picture. */
  readonly object3d = new THREE.Group();
  /** A die came to rest: what it shows (caught when no face is up). */
  onSettled: (id: number, reading: FaceReading) => void = () => {};
  /** A die at rest was knocked loose (the die under it was thrown again): it moves, and is read again where it lands. */
  onLoosened: (id: number) => void = () => {};
  private readonly world = new CANNON.World();
  private readonly dice = new Map<number, ThrownDie>();
  private walls: CANNON.Body[] = [];
  /** The board's tokens, props and walls in the tray, as they stood at the last throw. */
  private obstacles: CANNON.Body[] = [];
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

  /** Lays a roll's dice at rest in a tray where the camera looks now, to be thrown one by one; an earlier roll's go. */
  placeRoll(session: RollSession): void {
    this.clear();
    this.session = session;
    this.layTray();
    this.placeMissing();
  }

  /** Lays at rest, beside the others, every die of the roll the table has none for yet (an explosion's). */
  placeMissing(): void {
    const session = this.session;
    if (!session) return;
    if (!this.tray) this.layTray();
    let laid = false;
    for (const state of session.dice) {
      if (this.dice.has(state.id) || state.status === 'rolling') continue;
      this.lay(this.dieFor(state.id, state.die, state.color));
      laid = true;
    }
    if (laid) this.host.wake();
  }

  /** Throws the session's dice not yet read, all together, the way the flick went (each from where it lies). */
  throwRoll(session: RollSession, flick: Flick): void {
    if (session !== this.session) this.placeRoll(session);
    const ids = session.dice.filter((state) => state.status === 'waiting' || state.status === 'rolling').map((state) => state.id);
    ids.forEach((id, index) => this.throwDie(id, flick, index, ids.length));
  }

  /**
   * Throws one die from where it lies or is carried (laid, caught, read, or a new one of the session: an explosion),
   * the way the flick went; the dice resting on it fall. The `index`th of `count` thrown together starts beside the rest.
   */
  throwDie(dieId: number, flick: Flick, index = 0, count = 1): void {
    let die = this.dice.get(dieId);
    if (die) this.loosenDiceOn(die);
    else {
      const state = this.session?.dice.find((candidate) => candidate.id === dieId);
      if (!state) return;
      if (!this.tray) this.layTray();
      die = this.dieFor(state.id, state.die, state.color);
      this.lay(die);
    }
    this.standObstacles();
    this.launch(die, flick, index, count);
    this.host.wake();
  }

  /**
   * Carries a die, or a bundle of dice, under the pointer (`ray`, in the board's world), over the table: the first die
   * under the pointer, the others gathered round it. They hang still, unread, till thrown; the dice resting on them fall.
   */
  hold(dieIds: number | readonly number[], ray: THREE.Ray): void {
    const dice = (typeof dieIds === 'number' ? [dieIds] : [...dieIds]).map((id) => this.dice.get(id)).filter((die): die is ThrownDie => die !== undefined);
    const tray = this.tray;
    if (dice.length === 0 || !tray) return;
    const edge = dieEdgePx(this.host.gridSize(), this.settings.dieSquares);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -HOLD_HEIGHT * edge);
    const at = ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return;
    this.object3d.updateMatrixWorld(true);
    const local = this.object3d.worldToLocal(at);
    const halfWidth = tray.halfWidth / edge - 1;
    const halfDepth = tray.halfDepth / edge - 1;
    dice.forEach((die, index) => {
      if (die.held !== true) this.loosenDiceOn(die);
      // A sunflower round the pointer: each die a little over its own width from the next.
      const reach = BUNDLE_SPACING * Math.sqrt(index);
      const angle = index * GOLDEN_ANGLE;
      const { body } = die;
      this.freeze(die);
      die.settled = true;
      die.held = true;
      this.outline(die);
      body.position.set(
        Math.max(-halfWidth, Math.min(halfWidth, local.x + Math.cos(angle) * reach)),
        HOLD_HEIGHT,
        Math.max(-halfDepth, Math.min(halfDepth, local.z + Math.sin(angle) * reach)),
      );
      die.mesh.position.set(body.position.x, body.position.y, body.position.z);
    });
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

  /** Takes a die off the table (an explosion its die no longer earns); the dice resting on it fall. */
  remove(dieId: number): void {
    const die = this.dice.get(dieId);
    if (!die) return;
    this.dice.delete(dieId);
    this.removeDie(die);
    this.loosenDiceOn(die);
    // The board draws only when woken: the die leaves the picture now, whether or not others still roll.
    this.host.wake();
  }

  /** The die a ray (in the board's world) meets first, or null. */
  pick(ray: THREE.Ray): number | null {
    this.object3d.updateMatrixWorld(true);
    this.raycaster.ray.copy(ray);
    const hits = this.raycaster.intersectObjects([...this.dice.values()].map((die) => die.mesh), false);
    const id = hits[0]?.object.userData.dieId as number | undefined;
    return id ?? null;
  }

  /**
   * The dice the roll waits on being thrown (laid, caught on an edge, an explosion's): a line round each, as
   * TacticalEngine rims a creature; none round the others, nor round a die in hand.
   */
  mark(waiting: readonly number[]): void {
    const wanted = new Set(waiting);
    let changed = false;
    for (const [id, die] of this.dice) {
      die.waited = wanted.has(id);
      changed = this.outline(die) || changed;
    }
    if (changed) this.host.wake();
  }

  /** Shows the line round a die as its state asks; whether that changed anything. */
  private outline(die: ThrownDie): boolean {
    const show = this.settings.highlight && die.waited === true && die.held !== true;
    const rim = die.mesh.children.find((child) => child.name === 'die-outline');
    if (!rim || rim.visible === show) return false;
    showOutline(die.mesh, show);
    return true;
  }

  /** Takes every die and the tray away, and off the screen at once (the board draws only when woken). */
  clear(): void {
    const shown = this.dice.size > 0;
    for (const die of this.dice.values()) this.removeDie(die);
    this.dice.clear();
    for (const wall of this.walls) this.world.removeBody(wall);
    this.walls = [];
    for (const body of this.obstacles) this.world.removeBody(body);
    this.obstacles = [];
    this.tray = null;
    this.session = null;
    if (shown) this.host.wake();
  }

  dispose(): void {
    // Clear asks for the frame that draws the board without the dice; the group leaves the scene before it comes.
    this.clear();
    this.object3d.removeFromParent();
  }

  /** The tray where the camera looks: its floor and four walls, and the dice's group placed and scaled on it. */
  private layTray(): void {
    for (const wall of this.walls) this.world.removeBody(wall);
    const grid = this.host.gridSize();
    const edge = dieEdgePx(grid, this.settings.dieSquares);
    const tray = trayOnMap(this.host.mapSize(), this.host.target(), grid, edge);
    this.tray = tray;
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
      // cannon measured the plane's bounds when the body was made, facing +z at the origin, and never measures a
      // static body again: unmeasured, the felt and the side walls held dice only on the tray's far half, the near wall none.
      body.updateAABB();
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
    this.standObstacles();
  }

  /**
   * The board's tokens, props and walls inside the tray, as they stand now, as fixed bodies a die bounces off (in the
   * tray's frame, in die edges). Made again at each throw: tokens move between throws.
   */
  private standObstacles(): void {
    for (const body of this.obstacles) this.world.removeBody(body);
    this.obstacles = [];
    const tray = this.tray;
    if (!tray || !this.host.obstacles) return;
    const edge = dieEdgePx(this.host.gridSize(), this.settings.dieSquares);
    const cos = Math.cos(tray.yaw);
    const sin = Math.sin(tray.yaw);
    // Map pixels to the tray's frame: about its centre, turned back by its yaw (as the dice's group is turned by it).
    const toTray = (x: number, z: number): { x: number; z: number } => {
      const dx = (x - tray.center.x) / edge;
      const dz = (z - tray.center.z) / edge;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
    };
    const reachX = tray.halfWidth / edge + 2;
    const reachZ = tray.halfDepth / edge + 2;
    for (const obstacle of this.host.obstacles()) {
      if (!(obstacle.height > 0)) continue;
      const at = toTray(obstacle.x, obstacle.z);
      const height = obstacle.height / edge;
      let body: CANNON.Body;
      if (obstacle.kind === 'round') {
        const radius = obstacle.radius / edge;
        if (!(radius > 0) || Math.abs(at.x) > reachX + radius || Math.abs(at.z) > reachZ + radius) continue;
        body = new CANNON.Body({ mass: 0, material: OBSTACLE_MATERIAL, shape: new CANNON.Cylinder(radius, radius, height, 16) });
      } else {
        const halfLength = obstacle.halfLength / edge;
        const halfWidth = obstacle.halfWidth / edge;
        const reach = halfLength + halfWidth;
        if (!(halfLength > 0) || Math.abs(at.x) > reachX + reach || Math.abs(at.z) > reachZ + reach) continue;
        body = new CANNON.Body({ mass: 0, material: OBSTACLE_MATERIAL, shape: new CANNON.Box(new CANNON.Vec3(halfLength, height / 2, Math.max(halfWidth, 0.05))) });
        // The wall's heading on the map (x toward map y, the board's +z) is a turn about -y; the tray is turned by its yaw.
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -obstacle.heading - tray.yaw);
      }
      body.position.set(at.x, height / 2, at.z);
      body.updateAABB();
      this.world.addBody(body);
      this.obstacles.push(body);
    }
  }

  /**
   * Lays a die at rest on the felt, flat on one of its faces and turned at random, in the first free spot of a spiral
   * out from the tray's centre (clear of the other dice and of what stands on the board); held there until thrown.
   */
  private lay(die: ThrownDie): void {
    const { body } = die;
    const down = new THREE.Vector3(0, -1, 0);
    const normal = die.normals[Math.floor(Math.random() * die.normals.length)] ?? { x: 0, y: -1, z: 0 };
    const flat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(normal.x, normal.y, normal.z).normalize(), down);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    const pose = turn.multiply(flat);
    // Its lowest corner on the felt.
    const corners = die.mesh.geometry.getAttribute('position');
    const corner = new THREE.Vector3();
    let lowest = 0;
    for (let i = 0; i < corners.count; i++) lowest = Math.min(lowest, corner.fromBufferAttribute(corners, i).applyQuaternion(pose).y);
    const spot = this.freeSpot(die);
    this.freeze(die);
    die.settled = true;
    die.laid = true;
    body.position.set(spot.x, -lowest, spot.z);
    body.quaternion.set(pose.x, pose.y, pose.z, pose.w);
    die.mesh.position.set(body.position.x, body.position.y, body.position.z);
    die.mesh.quaternion.copy(pose);
  }

  /** The first spot, spiralling out from where the camera looks, on the map, clear of the other dice and the board's obstacles. */
  private freeSpot(die: ThrownDie): { x: number; z: number } {
    const tray = this.tray as Tray;
    const edge = dieEdgePx(this.host.gridSize(), this.settings.dieSquares);
    // Where the camera looks, in the tray's frame (it is never turned), kept on the map.
    const target = this.host.target();
    const inner = (value: number, half: number): number => Math.max(-half, Math.min(half, value));
    const from = {
      x: inner((target.x - tray.center.x) / edge, tray.halfWidth / edge - die.radius),
      z: inner((target.z - tray.center.z) / edge, tray.halfDepth / edge - die.radius),
    };
    const halfWidth = tray.halfWidth / edge - die.radius;
    const halfDepth = tray.halfDepth / edge - die.radius;
    const others = [...this.dice.values()].filter((other) => other !== die);
    const clear = (x: number, z: number): boolean => {
      if (Math.abs(x) > halfWidth || Math.abs(z) > halfDepth) return false;
      if (others.some((other) => Math.hypot(other.body.position.x - x, other.body.position.z - z) < (die.radius + other.radius) * 0.9)) return false;
      return this.obstacles.every((body) => {
        const box = body.aabb;
        return x + die.radius < box.lowerBound.x || x - die.radius > box.upperBound.x || z + die.radius < box.lowerBound.z || z - die.radius > box.upperBound.z;
      });
    };
    for (let ring = 0; ring < 12; ring++) {
      const around = Math.max(1, ring * 6);
      for (let i = 0; i < around; i++) {
        const angle = (i / around) * Math.PI * 2;
        const x = from.x + Math.cos(angle) * ring * LAY_SPACING;
        const z = from.z + Math.sin(angle) * ring * LAY_SPACING;
        if (clear(x, z)) return { x, z };
      }
    }
    return from;
  }

  /** A die held where it is: it moves only when it is thrown (or knocked loose). */
  private freeze(die: ThrownDie): void {
    const { body } = die;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.type = CANNON.Body.STATIC;
    body.mass = 0;
    body.updateMassProperties();
  }

  /** A die's body and mesh, made once per id. */
  private dieFor(id: number, type: DieType, color: string | undefined): ThrownDie {
    const existing = this.dice.get(id);
    if (existing) return existing;
    const pack = this.host.pack();
    const { geometry, normals, numbers } = buildDie(type, DIE_SIZE, pack);
    const mesh = new THREE.Mesh(geometry, dieMaterial(type, pack, this.host.textures(type, color ?? null), color ?? null));
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
    // After the body: the line's hull is made from the die's geometry, which the body's shape is read from first.
    if (this.settings.highlight) addOutline(mesh, this.settings.highlightColor);
    const corners = geometry.getAttribute('position');
    let radius = 0;
    for (let i = 0; i < corners.count; i++) radius = Math.max(radius, Math.hypot(corners.getX(i), corners.getY(i), corners.getZ(i)));
    const die: ThrownDie = { type, body, mesh, radius, normals, numbers, settled: false, stillMs: 0, rollingMs: 0 };
    this.dice.set(id, die);
    return die;
  }

  /**
   * Sends a die across the tray the way the flick went (up the screen is away from the thrower), from where it lies or
   * is carried, lifted off the felt; the `index`th of `count` dice thrown together starts beside the others.
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
    const from = { x: body.position.x, y: body.position.y, z: body.position.z };
    const start = (shift: number): CANNON.Vec3 => new CANNON.Vec3(
      inside(from.x + across.x * (offset + shift), halfWidth),
      Math.max(from.y, START_HEIGHT) + (index % 3) * 0.6,
      inside(from.z + across.z * (offset + shift), halfDepth),
    );
    body.position.copy(this.clearStart(die, start));
    body.quaternion.setFromEuler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    body.velocity.set(dir.x * speed + (Math.random() - 0.5) * 2, -DROP_SPEED, dir.z * speed + (Math.random() - 0.5) * 2);
    // Spin that rolls the die the way it travels, plus some of every kind.
    const spin = (): number => (Math.random() - 0.5) * MAX_SPIN;
    body.angularVelocity.set(spin() + dir.z * MAX_SPIN * 0.4, spin(), spin() - dir.x * MAX_SPIN * 0.4);
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
    delete die.laid;
    delete die.held;
    // In the air, the roll waits on it no longer: the line comes back only if it lands caught.
    die.waited = false;
    this.outline(die);
    die.stillMs = 0;
    die.rollingMs = 0;
  }

  /**
   * Lets go of the dice held resting on `under` (and on those, in turn) before it is thrown again: held, they would
   * float where it was. A held body touches no other held body, so they are found by where they lie, not by contacts.
   */
  private loosenDiceOn(under: ThrownDie): void {
    const { x, y, z } = under.body.position;
    for (const [id, die] of this.dice) {
      // A die laid unthrown lies on the felt: nothing rests on it, and it has no reading to lose.
      if (die === under || !die.settled || die.laid) continue;
      const at = die.body.position;
      if (at.y <= RESTING_HEIGHT || at.y <= y || Math.hypot(at.x - x, at.z - z) > SUPPORT_REACH) continue;
      this.loosen(die);
      this.tell(() => this.onLoosened(id));
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
    this.tell(() => this.onSettled(id, reading));
  }

  /** Calls a listener. The board's frame loop steps the table: a listener's failure stays here, the other dice still read. */
  private tell(listener: () => void): void {
    try {
      listener();
    } catch (error) {
      console.error('[Tabletop] A dice table listener failed:', error);
    }
  }

  private removeDie(die: ThrownDie): void {
    this.world.removeBody(die.body);
    disposeOutline(die.mesh);
    die.mesh.removeFromParent();
    die.mesh.geometry.dispose();
    die.mesh.material.dispose();
  }
}
