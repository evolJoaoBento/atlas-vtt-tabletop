import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { DiceTable, type DiceSettings, type DiceTableHost } from '../src/dice/diceTable';
import type { FaceReading } from '../src/dice/kit/faces';
import { DEFAULT_RULES } from '../src/dice/rollRules';
import { RollSession } from '../src/dice/rollSession';

const SETTINGS: DiceSettings = { dieSquares: 0.6, tolerance: 0.3, motionThreshold: 2, shadows: true, highlight: true, highlightColor: '#ffd700' };

function table(yaw: number | (() => number) = 0.7): { dice: DiceTable; scene: THREE.Scene; wakes: number[] } {
  const scene = new THREE.Scene();
  const wakes: number[] = [];
  const host: DiceTableHost = {
    scene,
    gridSize: () => 70,
    target: () => ({ x: 500, z: 300 }),
    visibleHalfExtent: () => ({ x: 600, z: 400 }),
    cameraYaw: typeof yaw === 'number' ? () => yaw : yaw,
    wake: () => { wakes.push(1); },
    textures: () => ({}),
    pack: () => ({}),
  };
  return { dice: new DiceTable(host, SETTINGS), scene, wakes };
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
  assert.equal(wakes.length, 1, 'a throw asks the board for frames');
  assert.equal(dice.busy, true);
  const ms = run(dice);
  assert.equal(dice.busy, false, `settled in ${ms} ms`);
  assert.deepEqual(readings.map(([id]) => id).sort(), session.dice.map((state) => state.id).sort());
  const local = dice.object3d.children.map((mesh) => mesh.position);
  // The tray is 0.8 of the view: 480 by 320 map pixels each way, a die 42.
  for (const at of local) {
    assert.ok(Math.abs(at.x) <= 480 / 42 && Math.abs(at.z) <= 320 / 42 && at.y >= 0 && at.y < 1.2, `inside the tray: ${at.x}, ${at.y}, ${at.z}`);
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

test('a die thrown again goes up the screen as the camera faces now, though the tray was laid facing another way', () => seeded(7, () => {
  let yaw = 0.7;
  const { dice } = table(() => yaw);
  const session = new RollSession({ dice: { d6: 1 }, modifier: 0 }, DEFAULT_RULES);
  dice.throwRoll(session, { dx: 0, dy: -200, ms: 100 });
  run(dice);
  // A quarter turn more: up the screen is now the tray's -x (its left as it was laid).
  yaw += Math.PI / 2;
  dice.throwDie(session.dice[0].id, { dx: 0, dy: -200, ms: 100 });
  const mesh = dice.object3d.children[0];
  const from = mesh.position.clone();
  for (let i = 0; i < 4; i++) dice.step(1000 / 60);
  const moved = mesh.position.clone().sub(from);
  assert.ok(moved.x < -1 && Math.abs(moved.z) < Math.abs(moved.x) / 3, `toward the tray's -x: ${moved.x}, ${moved.z}`);
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

test('a die resting on another is read where it lies, and falls when the die under it is thrown again', () => seeded(5, () => {
  const { dice } = table(0);
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
  top.position.set(base.position.x, base.position.y + 1.02, base.position.z);
  top.quaternion.copy(base.quaternion);
  top.velocity.set(0, 0, 0);
  top.angularVelocity.set(0, 0, 0);
  const ms = run(dice);
  assert.ok(ms < 2000, `read without waiting out the longest roll: ${ms} ms`);
  const onTop = readings.get(over)?.[1];
  assert.ok(onTop && !onTop.caught && onTop.face !== null && onTop.face >= 1 && onTop.face <= 6, `a face: ${JSON.stringify(onTop)}`);
  assert.ok(top.position.y > 1.2, `it lies on the other die: ${top.position.y}`);
  dice.throwDie(under, { dx: 0, dy: -200, ms: 100 });
  assert.equal(top.type, CANNON.Body.DYNAMIC, 'the die on top is no longer held in the air');
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
