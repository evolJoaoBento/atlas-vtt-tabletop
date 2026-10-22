import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DiceTable, type DiceObstacle, type DiceSettings, type DiceTableHost } from '../src/dice/diceTable';
import { outlineShown } from '../src/dice/dieOutline';
import type { FaceReading } from '../src/dice/kit/faces';
import { DEFAULT_RULES } from '../src/dice/rollRules';
import { RollSession } from '../src/dice/rollSession';

const SETTINGS: DiceSettings = { dieSquares: 0.6, tolerance: 0.3, motionThreshold: 2, shadows: true, highlight: true, highlightColor: '#ffd700' };

function table(yaw: number | (() => number) = 0.7, obstacles: DiceObstacle[] = [], settings: DiceSettings = SETTINGS): { dice: DiceTable; scene: THREE.Scene; wakes: number[] } {
  const scene = new THREE.Scene();
  const wakes: number[] = [];
  const host: DiceTableHost = {
    scene,
    gridSize: () => 70,
    target: () => ({ x: 500, z: 300 }),
    // A map 1000 by 600: the tray, centred on it at (500, 300) where the camera looks.
    mapSize: () => ({ width: 1000, height: 600 }),
    cameraYaw: typeof yaw === 'number' ? () => yaw : yaw,
    wake: () => { wakes.push(1); },
    textures: () => ({}),
    pack: () => ({}),
    obstacles: () => obstacles,
  };
  return { dice: new DiceTable(host, settings), scene, wakes };
}

/** The table's dice bodies: these tests set a die where a throw could only land it by chance. */
const bodyOf = (dice: DiceTable, id: number): CANNON.Body =>
  ((dice as unknown as { dice: Map<number, { body: CANNON.Body }> }).dice.get(id) as { body: CANNON.Body }).body;

/** Runs `body` with Math.random replaced by a seeded generator (mulberry32), so a throw comes out the same every time. */
function seeded<T>(seed: number, body: () => T): T {
  const random = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return body();
  } finally {
    Math.random = random;
  }
}

/**
 * A stack of two bevelled dice does not stand long in cannon (the upper one creeps off): these settings read a die as
 * still sooner (Interactive Dice's motion threshold, low), so the upper one is read, and held, where it was set.
 */
const STACKING: DiceSettings = { ...SETTINGS, motionThreshold: 0.25 };

/** Sets a die at rest square on the felt where it lies (its faces along the axes), `half` its half height. */
function squareUp(body: CANNON.Body, half: number): void {
  body.quaternion.set(0, 0, 0, 1);
  body.position.y = half;
  body.updateAABB();
}

/** Steps 60 frames a second until nothing moves, or gives up after a minute of play. */
function run(dice: DiceTable): number {
  let ms = 0;
  while (dice.busy && ms < 60_000) {
    dice.step(1000 / 60);
    ms += 1000 / 60;
  }
  return ms;
}

test('a thrown 2d6 settles inside the tray and each die is read once', () => seeded(1, () => {
  const { dice, scene, wakes } = table();
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  const readings: Array<[number, number | null]> = [];
  dice.onSettled = (id, reading) => { readings.push([id, reading.face]); session.settle(id, reading); };
  dice.throwRoll(session, { dx: 20, dy: -300, ms: 150 });
  assert.ok(scene.children.includes(dice.object3d), 'the dice are in the board\'s scene');
  assert.ok(wakes.length >= 1, 'a throw asks the board for frames');
  assert.equal(dice.busy, true);
  const ms = run(dice);
  assert.equal(dice.busy, false, `settled in ${ms} ms`);
  assert.deepEqual(readings.map(([id]) => id).sort(), session.dice.map((state) => state.id).sort());
  const local = dice.object3d.children.map((mesh) => mesh.position);
  // The tray is 0.8 of the view: 480 by 320 map pixels each way, a die 42.
  for (const at of local) {
    assert.ok(Math.abs(at.x) <= 500 / 42 && Math.abs(at.z) <= 300 / 42 && at.y >= 0 && at.y < 1.2, `on the map: ${at.x}, ${at.y}, ${at.z}`);
  }
  for (const [, face] of readings) assert.ok(face === null || (face >= 1 && face <= 6), `a d6 face: ${face}`);
}));

test('a die thrown again is read again; a new die of the session is made for it', () => {
  const { dice } = table();
  const session = new RollSession({ dice: { d20: 1 }, modifier: 0 }, DEFAULT_RULES);
  const settled: number[] = [];
  dice.onSettled = (id) => { settled.push(id); };
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  const [d20] = session.dice;
  dice.throwDie(d20.id, { dx: 100, dy: 0, ms: 100 });
  assert.equal(dice.busy, true);
  run(dice);
  dice.throwDie(999, { dx: 0, dy: -100, ms: 100 });
  assert.equal(dice.busy, false, 'an id the session does not know throws nothing');
  assert.deepEqual(settled, [d20.id, d20.id]);
});

test('every die type reads a face of its own (or is caught), never a made-up number', () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d4: 1, d6: 1, d8: 1, d10: 1, d12: 1, d20: 1 }, modifier: 0 }, DEFAULT_RULES);
  const faces = new Map<number, number | null>();
  dice.onSettled = (id, reading) => { faces.set(id, reading.face); };
  dice.throwRoll(session, { dx: -50, dy: -250, ms: 120 });
  run(dice);
  for (const state of session.dice) {
    const face = faces.get(state.id);
    assert.ok(faces.has(state.id), `${state.die} was read`);
    assert.ok(face === null || (face >= 0 && face <= Number(state.die.slice(1))), `${state.die} read ${face}`);
  }
});

test('a ray finds the die it meets; clear takes the dice away', () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d8: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.throwRoll(session, { dx: 0, dy: -150, ms: 100 });
  run(dice);
  const mesh = dice.object3d.children[0];
  const at = mesh.getWorldPosition(new THREE.Vector3());
  const down = new THREE.Ray(new THREE.Vector3(at.x, at.y + 500, at.z), new THREE.Vector3(0, -1, 0));
  assert.equal(dice.pick(down), session.dice[0].id);
  const miss = new THREE.Ray(new THREE.Vector3(at.x + 400, 500, at.z), new THREE.Vector3(0, -1, 0));
  assert.equal(dice.pick(miss), null);
  dice.clear();
  assert.equal(dice.object3d.children.length, 0);
  assert.equal(dice.busy, false);
});

test('a die thrown again goes up the screen as the camera faces now, though it faced another way before', () => seeded(7, () => {
  let yaw = 0.7;
  const { dice } = table(() => yaw);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  // A quarter turn more: up the screen is now the camera's forward along the ground as it faces now.
  yaw += Math.PI / 2;
  dice.throwDie(session.dice[0].id, { dx: 0, dy: -200, ms: 100 });
  const mesh = dice.object3d.children[0];
  const from = mesh.position.clone();
  for (let i = 0; i < 4; i++) dice.step(1000 / 60);
  const moved = mesh.position.clone().sub(from);
  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const along = (moved.x * forward.x + moved.z * forward.z) / Math.hypot(moved.x, moved.z);
  assert.ok(Math.hypot(moved.x, moved.z) > 1 && along > 0.9, `up the screen as the camera faces now: ${moved.x}, ${moved.z}`);
}));

test('a die at rest on the felt reads the number it shows', () => seeded(11, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 4 }, modifier: 0 }, DEFAULT_RULES);
  const readings: FaceReading[] = [];
  dice.onSettled = (id, reading) => { readings.push(reading); session.settle(id, reading); };
  dice.throwRoll(session, { dx: 10, dy: -220, ms: 120 });
  run(dice);
  assert.equal(readings.length, 4);
  const numbers = readings.filter((reading) => !reading.caught);
  assert.ok(numbers.length >= 2, `most dice show a face: ${JSON.stringify(readings)}`);
  for (const reading of numbers) assert.ok(reading.face !== null && reading.face >= 1 && reading.face <= 6, `a d6 face: ${reading.face}`);
  assert.ok(session.dice.some((state) => state.status === 'settled' && state.value !== undefined), 'the roll has a number from them');
}));

test('a listener that throws does not stop the other dice being read', () => seeded(3, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  const read: number[] = [];
  dice.onSettled = (id) => {
    read.push(id);
    if (read.length === 1) throw new Error('listener failed');
  };
  const errors: unknown[] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
    assert.doesNotThrow(() => run(dice));
  } finally {
    console.error = consoleError;
  }
  assert.deepEqual([...read].sort(), session.dice.map((state) => state.id).sort());
  assert.equal(dice.busy, false);
  assert.equal(errors.length, 1, 'the failure is reported');
}));

test('a die resting on another is read where it lies, and falls when the die under it is thrown again', () => seeded(15, () => {
  const { dice } = table(0, [], STACKING);
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  const readings = new Map<number, FaceReading[]>();
  dice.onSettled = (id, reading) => { readings.set(id, [...(readings.get(id) ?? []), reading]); };
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  const [under, over] = session.dice.map((state) => state.id);
  assert.equal(readings.get(under)?.[0].caught, false, 'the lower die lies flat');
  // The upper die is thrown again and set down flat on the lower one, still.
  dice.throwDie(over, { dx: 0, dy: -200, ms: 100 });
  const base = bodyOf(dice, under);
  const top = bodyOf(dice, over);
  // A stack that stands: the lower die square on the felt, the upper square on it (two bevelled dice set askew topple).
  squareUp(base, 0.5);
  top.position.set(base.position.x, base.position.y + 1.02, base.position.z);
  top.quaternion.copy(base.quaternion);
  top.velocity.set(0, 0, 0);
  top.angularVelocity.set(0, 0, 0);
  const ms = run(dice);
  assert.ok(ms < 6000, `read without waiting out the longest roll (12 s): ${ms} ms`);
  const onTop = readings.get(over)?.[1];
  assert.ok(onTop && !onTop.caught && onTop.face !== null && onTop.face >= 1 && onTop.face <= 6, `a face: ${JSON.stringify(onTop)}`);
  assert.ok(top.position.y > 1.2, `it lies on the other die: ${top.position.y}`);
  const loosened: number[] = [];
  dice.onLoosened = (id) => { loosened.push(id); };
  const topMesh = dice.object3d.children.find((mesh) => mesh.userData.dieId === over) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhongMaterial>;
  dice.mark([over]);
  assert.equal(outlineShown(topMesh), true, '(the roll waits on it: the line round it shows)');
  dice.throwDie(under, { dx: 0, dy: -200, ms: 100 });
  assert.equal(outlineShown(topMesh), false, 'a die knocked loose has no line round it while it falls');
  assert.equal(top.type, CANNON.Body.DYNAMIC, 'the die on top is no longer held in the air');
  assert.deepEqual(loosened, [over], 'and the table says so');
  run(dice);
  assert.equal(dice.busy, false);
  assert.ok(top.position.y < 1.2, `it fell to the felt: ${top.position.y}`);
  assert.equal(readings.get(over)?.length, 3, 'and is read again where it fell');
}));

test('a die still tumbling at the longest roll is caught, never a number', () => seeded(9, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  const readings: FaceReading[] = [];
  dice.onSettled = (_id, reading) => { readings.push(reading); };
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  const body = bodyOf(dice, session.dice[0].id);
  // Something keeps the die spinning after every step of the world: it never comes to rest.
  const world = (dice as unknown as { world: CANNON.World }).world;
  world.addEventListener('postStep', () => { if (body.type === CANNON.Body.DYNAMIC) body.angularVelocity.set(0, 20, 0); });
  let ms = 0;
  while (dice.busy && ms < 15_000) {
    dice.step(1000 / 60);
    ms += 1000 / 60;
  }
  assert.ok(ms >= 12_000 && ms < 12_100, `held at the longest roll: ${ms} ms`);
  assert.deepEqual(readings, [{ caught: true, face: null, confidence: 0 }]);
}));

test('dice thrown again one after another start clear of each other and of the dice at rest', () => seeded(13, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 3 }, modifier: 0 }, DEFAULT_RULES);
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  const [a, b, c] = session.dice.map((state) => bodyOf(dice, state.id));
  // A die held where the next throw starts: the throw starts beside it, not inside it.
  dice.throwDie(session.dice[0].id, { dx: 0, dy: -200, ms: 100 });
  const start = a.position.clone();
  run(dice);
  c.position.copy(start);
  dice.throwDie(session.dice[0].id, { dx: 0, dy: -200, ms: 100 });
  dice.throwDie(session.dice[1].id, { dx: 0, dy: -200, ms: 100 });
  // A d6's corners are √3/2 of an edge from its centre.
  const apart = Math.sqrt(3);
  assert.ok(a.position.distanceTo(c.position) >= apart, `clear of the die at rest: ${a.position.distanceTo(c.position)}`);
  assert.ok(b.position.distanceTo(c.position) >= apart, `clear of the die at rest: ${b.position.distanceTo(c.position)}`);
  assert.ok(a.position.distanceTo(b.position) >= apart, `clear of each other: ${a.position.distanceTo(b.position)}`);
}));

test('the felt and the walls hold a die wherever it lands in a wide tray', () => seeded(17, () => {
  const scene = new THREE.Scene();
  // A map 2800 by 1800: the tray its whole size, the dice laid where the camera looks, off its centre.
  const host: DiceTableHost = {
    scene, gridSize: () => 70, target: () => ({ x: 700, z: 500 }), mapSize: () => ({ width: 2800, height: 1800 }),
    cameraYaw: () => 0, wake: () => {}, textures: () => ({}), pack: () => ({}),
  };
  for (const flick of [{ dx: 0, dy: -100, ms: 140 }, { dx: 30, dy: -260, ms: 140 }, { dx: 400, dy: 0, ms: 100 }, { dx: 0, dy: 600, ms: 100 }]) {
    const dice = new DiceTable(host, SETTINGS);
    const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
    dice.throwRoll(session, flick);
    const ms = run(dice);
    for (const mesh of dice.object3d.children) {
      const at = mesh.position;
      assert.ok(Math.abs(at.x) <= 1400 / 42 && Math.abs(at.z) <= 900 / 42 && at.y > 0 && at.y < 1.2, `${JSON.stringify(flick)}: on the felt in ${ms} ms: ${at.x}, ${at.y}, ${at.z}`);
    }
    dice.dispose();
  }
}));

test('a die new to the table lets go of no dice held where it is made', () => seeded(21, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 3 }, modifier: 0 }, DEFAULT_RULES);
  const [first, second, third] = session.dice.map((state) => state.id);
  // The third die already has its number: the throw leaves it off the table, as an explosion not yet thrown is.
  session.settle(third, { caught: false, face: 4, confidence: 1 });
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  // Two dice held one on the other at the tray's centre, where a new die's body is made.
  bodyOf(dice, first).position.set(0, 0.5, 0);
  bodyOf(dice, second).position.set(0, 1.5, 0);
  dice.throwDie(third, { dx: 0, dy: -200, ms: 100 });
  assert.equal(bodyOf(dice, second).type, CANNON.Body.STATIC, 'the die on top is still held');
  assert.equal(bodyOf(dice, first).type, CANNON.Body.STATIC);
}));

test('a die taken off the table lets go of the dice resting on it', () => seeded(15, () => {
  const { dice } = table(0, [], STACKING);
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  const [under, over] = session.dice.map((state) => state.id);
  dice.throwDie(over, { dx: 0, dy: -200, ms: 100 });
  const base = bodyOf(dice, under);
  const top = bodyOf(dice, over);
  // A stack that stands: the lower die square on the felt, the upper square on it (two bevelled dice set askew topple).
  squareUp(base, 0.5);
  top.position.set(base.position.x, base.position.y + 1.02, base.position.z);
  top.quaternion.copy(base.quaternion);
  top.velocity.set(0, 0, 0);
  top.angularVelocity.set(0, 0, 0);
  run(dice);
  const loosened: number[] = [];
  dice.onLoosened = (id) => { loosened.push(id); };
  dice.remove(under);
  assert.deepEqual(dice.object3d.children.map((mesh) => mesh.userData.dieId), [over]);
  assert.deepEqual(loosened, [over]);
  run(dice);
  assert.ok(top.position.y < 1.2, `it fell to the felt: ${top.position.y}`);
  dice.remove(999);
}));

test('a roll is laid on the felt at rest where the camera looks: flat, on the map, apart, nothing moving or read', () => seeded(3, () => {
  const { dice } = table(0.4);
  const session = new RollSession({ dice: { d4: 1, d6: 2, d8: 1, d10: 1, d12: 1, d20: 1, d100: 1 }, modifier: 0 }, DEFAULT_RULES);
  const read: number[] = [];
  dice.onSettled = (id) => { read.push(id); };
  dice.placeRoll(session);
  assert.equal(dice.busy, false, 'laid dice ask for no frames');
  dice.step(1000);
  assert.deepEqual(read, [], 'a laid die is not read: it was never thrown');
  const meshes = dice.object3d.children as THREE.Mesh[];
  assert.equal(meshes.length, session.dice.length, 'a d100 is laid as its two dice');
  for (const mesh of meshes) {
    // The dice's group is scaled to the board: a die's edge is 42 map pixels here.
    const lowest = new THREE.Box3().setFromObject(mesh).min.y / 42;
    assert.ok(Math.abs(lowest) < 0.02, `on the felt: lowest corner ${lowest} die edges`);
    assert.ok(Math.abs(mesh.position.x) < 500 / 42 && Math.abs(mesh.position.z) < 300 / 42, 'on the map');
  }
  for (let i = 0; i < meshes.length; i++) for (let j = i + 1; j < meshes.length; j++) {
    const a = meshes[i].position;
    const b = meshes[j].position;
    assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.9, 'laid apart');
  }
}));

test('a die carried under the pointer hangs over the table, then is thrown from there and read', () => seeded(4, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  const read: number[] = [];
  dice.onSettled = (id) => { read.push(id); };
  dice.placeRoll(session);
  const [d6] = session.dice;
  // Straight down onto the table, 3 squares right of the tray's centre (map 500, 300): the die is carried there.
  dice.hold(d6.id, new THREE.Ray(new THREE.Vector3(500 + 210, 1000, 300), new THREE.Vector3(0, -1, 0)));
  const body = bodyOf(dice, d6.id);
  assert.ok(Math.abs(body.position.x - 210 / 42) < 1e-6 && body.position.y === 2, `carried: ${body.position.toString()}`);
  assert.equal(dice.busy, false, 'carried, it does not fall');
  session.reroll(d6.id);
  dice.throwDie(d6.id, { dx: 0, dy: -100, ms: 100 });
  assert.equal(dice.busy, true);
  run(dice);
  assert.deepEqual(read, [d6.id]);
}));

test('a token on the board stops a die: none is laid in it, none ends in it, and the token stays put', () => seeded(6, () => {
  // A big token right where the camera looks, where the dice would be laid and through which they are thrown.
  const token: DiceObstacle = { kind: 'round', x: 500, z: 300, radius: 100, height: 120 };
  const { dice } = table(0, [token]);
  const session = new RollSession({ dice: { d6: 4 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  const r = 100 / 42;
  const outside = (at: CANNON.Vec3): boolean => Math.hypot(at.x, at.z) > r || at.y >= 120 / 42;
  for (const state of session.dice) assert.ok(outside(bodyOf(dice, state.id).position), 'no die is laid inside the token');
  // Each thrown across the tray, through where the token stands.
  for (const state of session.dice) {
    const at = bodyOf(dice, state.id).position;
    session.reroll(state.id);
    dice.throwDie(state.id, { dx: -at.x * 40, dy: at.z * 40, ms: 80 });
  }
  run(dice);
  for (const state of session.dice) assert.ok(outside(bodyOf(dice, state.id).position), `a die never ends inside the token: ${bodyOf(dice, state.id).position.toString()}`);
  assert.deepEqual(token, { kind: 'round', x: 500, z: 300, radius: 100, height: 120 }, 'the token is not moved');
}));

test('a wall on the board stands in the tray as a box along its heading', () => {
  // A wall right across the tray (along map x), a little toward -z of its centre.
  const wall: DiceObstacle = { kind: 'box', x: 500, z: 300 - 84, halfLength: 400, halfWidth: 6, heading: 0, height: 140 };
  const { dice } = table(0, [wall]);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  const [d6] = session.dice;
  // Thrown hard straight up the screen (toward -z): the wall stops it short of it.
  session.reroll(d6.id);
  dice.throwDie(d6.id, { dx: 0, dy: -500, ms: 60 });
  run(dice);
  assert.ok(bodyOf(dice, d6.id).position.z > -84 / 42, `stopped by the wall: ${bodyOf(dice, d6.id).position.toString()}`);
});

test("the map's edge is the only wall: a die thrown hard toward it stops at it, on the map", () => seeded(12, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  const [d6] = session.dice;
  // Carried to near the map's right edge (map x 950 of 1000), and flung right, at the edge.
  dice.hold(d6.id, new THREE.Ray(new THREE.Vector3(950, 1000, 300), new THREE.Vector3(0, -1, 0)));
  session.reroll(d6.id);
  dice.throwDie(d6.id, { dx: 600, dy: 0, ms: 60 });
  run(dice);
  const at = bodyOf(dice, d6.id).position;
  assert.ok(at.x <= 500 / 42 && at.x > 300 / 42, `stopped by the map's edge, not before it: ${at.toString()}`);
}));

test('a roll is laid where the camera looks, wherever on the map that is', () => {
  const scene = new THREE.Scene();
  const host: DiceTableHost = {
    scene, gridSize: () => 70, target: () => ({ x: 200, z: 1500 }), mapSize: () => ({ width: 2800, height: 1800 }),
    cameraYaw: () => 0, wake: () => {}, textures: () => ({}), pack: () => ({}),
  };
  const dice = new DiceTable(host, SETTINGS);
  dice.placeRoll(new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES));
  const world = dice.object3d.children[0].getWorldPosition(new THREE.Vector3());
  assert.ok(Math.hypot(world.x - 200, world.z - 1500) < 1, `laid where the camera looks: ${world.x}, ${world.z}`);
});

test('the line round a die: on while the roll waits on it, off in hand and in the air, on again when it lands caught', () => seeded(31, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 2 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  const [a, b] = session.dice;
  const mesh = (id: number) => dice.object3d.children.find((candidate) => candidate.userData.dieId === id) as THREE.Mesh;
  dice.mark([a.id, b.id]);
  assert.deepEqual([outlineShown(mesh(a.id)), outlineShown(mesh(b.id))], [true, true], 'both laid, both to be thrown');
  dice.hold(a.id, new THREE.Ray(new THREE.Vector3(500, 1000, 300), new THREE.Vector3(0, -1, 0)));
  assert.equal(outlineShown(mesh(a.id)), false, 'picked up: no line');
  dice.mark([a.id, b.id]);
  assert.equal(outlineShown(mesh(a.id)), false, 'still in hand: no line, whatever else changes');
  session.reroll(a.id);
  dice.throwDie(a.id, { dx: 0, dy: -200, ms: 100 });
  dice.mark([b.id]);
  assert.deepEqual([outlineShown(mesh(a.id)), outlineShown(mesh(b.id))], [false, true], 'in the air: no line; the other still waits');
  run(dice);
  dice.mark([a.id, b.id]);
  assert.equal(outlineShown(mesh(a.id)), true, 'landed caught (the roll waits on it again): the line is back');
  const rim = mesh(a.id).children.find((child) => child.name === 'die-outline') as THREE.Mesh;
  assert.equal(dice.pick(new THREE.Ray(mesh(a.id).getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 500, 0)), new THREE.Vector3(0, -1, 0))), a.id, 'a click finds the die, never its line');
  assert.equal((rim.material as THREE.MeshBasicMaterial).stencilWrite, true, 'drawn only outside the die (stencil)');
}));

test('no line round any die with the highlight off in the settings', () => {
  const { dice } = table(0, [], { ...SETTINGS, highlight: false });
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  dice.mark([session.dice[0].id]);
  assert.equal(outlineShown(dice.object3d.children[0] as THREE.Mesh), false);
});

test('a bundle in hand: every die held round the pointer, apart, none read, none outlined; let go, all thrown', () => seeded(41, () => {
  const { dice } = table(0);
  const session = new RollSession({ dice: { d6: 4, d20: 2 }, modifier: 0 }, DEFAULT_RULES);
  dice.placeRoll(session);
  const ids = session.dice.map((die) => die.id);
  dice.mark(ids);
  dice.hold(ids, new THREE.Ray(new THREE.Vector3(500, 1000, 300), new THREE.Vector3(0, -1, 0)));
  const held = ids.map((id) => bodyOf(dice, id).position.clone());
  assert.ok(held.every((at) => at.y === 2), 'all carried over the table');
  assert.ok(Math.hypot(held[0].x, held[0].z) < 1e-6, 'the first under the pointer');
  for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
    assert.ok(Math.hypot(held[i].x - held[j].x, held[i].z - held[j].z) > 1.1, 'held apart');
  }
  assert.ok(held.every((at) => Math.hypot(at.x, at.z) < 4), 'gathered close round the pointer');
  assert.equal(dice.busy, false);
  assert.ok((dice.object3d.children as THREE.Mesh[]).every((mesh) => !outlineShown(mesh)), 'in hand: no lines');
  for (const id of ids) { session.reroll(id); dice.throwDie(id, { dx: 0, dy: -200, ms: 100 }); }
  assert.equal(dice.busy, true);
  run(dice);
  assert.equal(dice.busy, false);
}));
