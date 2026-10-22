import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { DiceTable, type DiceSettings, type DiceTableHost } from '../src/dice/diceTable';
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

test('a thrown 2d6 settles inside the tray and each die is read once', () => {
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
});

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
