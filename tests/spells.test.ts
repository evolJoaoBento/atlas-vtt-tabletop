import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { boxPoints, clampWallEnd, clipped, isInstantaneous, readSpell, spellHits, spellHolds, spellReaches, spellUnder, type Spell } from '../src/board/spells';
import type { BoardWall } from '../src/board/walls';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const base = { yaw: 0, pitch: 0, roll: 0, length: 0, angle: (53.13 * Math.PI) / 180 };
const wall = (p1: { x: number; y: number }, p2: { x: number; y: number }): BoardWall =>
  ({ id: 'w', p1, p2, type: 'solid', closed: true, blocks: 'all', direction: null, limited: false } as unknown as BoardWall);

test('a sphere holds what is within its radius of its middle', () => {
  const spell: Spell = { ...base, shape: 'sphere', from: 'point', at: { x: 100, y: 100, h: 20 }, size: 50 };
  assert.ok(spellHolds(spell, V(140, 20, 100)));
  assert.ok(!spellHolds(spell, V(160, 20, 100)));
  assert.ok(spellHolds(spell, V(100, 60, 100)));
});

test('a cube is its side across, round its middle, and turns', () => {
  const spell: Spell = { ...base, shape: 'cube', from: 'point', at: { x: 0, y: 0, h: 0 }, size: 100 };
  assert.ok(spellHolds(spell, V(49, 49, 49)));
  assert.ok(!spellHolds(spell, V(60, 0, 0)));
  const turned = { ...spell, yaw: Math.PI / 4 };
  assert.ok(spellHolds(turned, V(65, 0, 0)), 'a corner turned toward x');
});

test('a beam from the caster runs the way they look, its top on them', () => {
  // Yaw 0 looks along -z: the map's -y.
  const spell: Spell = { ...base, shape: 'cylinder', from: 'self', at: { x: 0, y: 0, h: 30 }, size: 10, length: 200 };
  assert.ok(spellHolds(spell, V(0, 30, -150)));
  assert.ok(!spellHolds(spell, V(0, 30, 20)), 'not behind the caster');
  assert.ok(!spellHolds(spell, V(15, 30, -100)), 'not beside it');
  const centred: Spell = { ...spell, from: 'point' };
  assert.ok(spellHolds(centred, V(0, 30, 90)) && !spellHolds(centred, V(0, 30, -150)));
});

test('a cone opens from its tip, or round its middle at a point', () => {
  const spell: Spell = { ...base, shape: 'cone', from: 'self', at: { x: 0, y: 0, h: 0 }, size: 100 };
  assert.ok(spellHolds(spell, V(0, 0, -90)));
  assert.ok(spellHolds(spell, V(40, 0, -90)), 'within the half angle');
  assert.ok(!spellHolds(spell, V(40, 0, -30)), 'outside near the tip');
  assert.ok(!spellHolds(spell, V(0, 0, 10)));
  const centred: Spell = { ...spell, from: 'point' };
  assert.ok(spellHolds(centred, V(0, 0, 45)) && !spellHolds(centred, V(0, 0, -60)));
});

test('a wall stands between its ends, as thick and high as set', () => {
  const spell: Spell = { ...base, shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 200, y: 0 }, size: 20, length: 100 };
  assert.ok(spellHolds(spell, V(100, 50, 5)));
  assert.ok(!spellHolds(spell, V(100, 150, 0)), 'over it');
  assert.ok(!spellHolds(spell, V(100, 50, 15)), 'beside it');
  assert.ok(!spellHolds(spell, V(230, 50, 0)), 'past its end');
  assert.deepEqual(clampWallEnd({ x: 0, y: 0 }, { x: 300, y: 400 }, 250), { x: 150, y: 200 });
  assert.deepEqual(clampWallEnd({ x: 0, y: 0 }, { x: 30, y: 40 }, 250), { x: 30, y: 40 });
});

test('a wall stops every cast, from the caster or at a point, as it stops an area of Atlas', () => {
  const walls = [wall({ x: 50, y: -100 }, { x: 50, y: 100 })];
  const spell: Spell = { ...base, shape: 'sphere', from: 'self', at: { x: 0, y: 0, h: 20 }, size: 200 };
  assert.ok(spellReaches(spell, V(30, 20, 0), walls));
  assert.ok(!spellReaches(spell, V(100, 20, 0), walls), 'behind the wall');
  const point: Spell = { ...spell, from: 'point' };
  assert.ok(spellReaches(point, V(30, 20, 0), walls));
  assert.ok(!spellReaches(point, V(100, 20, 0), walls), 'a point cast is cut too');
});

test('a cast whose measure lets it pass walls, and a wall spell, are never cut', () => {
  const walls = [wall({ x: 50, y: -100 }, { x: 50, y: 100 })];
  const spell: Spell = { ...base, shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 20 }, size: 200, uncut: true };
  assert.ok(spellReaches(spell, V(100, 20, 0), walls));
  assert.equal(clipped(spell), false);
  const slab: Spell = { ...base, shape: 'wall', from: 'point', at: { x: 0, y: 0, h: 0 }, to: { x: 0, y: 150 }, size: 20, length: 100 };
  assert.equal(clipped(slab), false);
  assert.ok(spellReaches({ ...slab, to: { x: 100, y: 0 } }, V(80, 50, 0), walls));
});

test('a point cast is swept from where Atlas starts its measure: a cube from the middle of its near side', () => {
  const walls = [wall({ x: -30, y: -200 }, { x: -30, y: 200 })];
  // A cube of 100 at (0,0) facing -y (yaw 0): Atlas square starts at its near side, (0, 50), and the wall at x = -30 cuts what lies past it.
  const cube: Spell = { ...base, shape: 'cube', from: 'point', at: { x: 0, y: 0, h: 50 }, size: 100 };
  assert.ok(spellReaches(cube, V(-20, 50, 0), walls));
  assert.ok(!spellReaches(cube, V(-45, 50, 0), walls));
});

test('hits are the targets with a point in reach, never the caster', () => {
  const spell: Spell = { ...base, shape: 'sphere', from: 'self', at: { x: 0, y: 0, h: 0 }, size: 100, caster: 'me' };
  const box = (x: number): THREE.Box3 => new THREE.Box3(V(x - 20, 0, -20), V(x + 20, 60, 20));
  const hits = spellHits(spell, [
    { id: 'me', points: boxPoints(box(0)) },
    { id: 'near', points: boxPoints(box(90)) },
    { id: 'far', points: boxPoints(box(300)) },
  ], []);
  assert.deepEqual(hits, ['near']);
});

test('only well formed spells are read', () => {
  const good = { ...base, shape: 'sphere', from: 'self', at: { x: 1, y: 2, h: 3 }, size: 10 };
  assert.deepEqual(readSpell(good), good);
  assert.equal(readSpell({ ...good, shape: 'torus' }), null);
  assert.equal(readSpell({ ...good, size: 0 }), null);
  assert.equal(readSpell({ ...good, shape: 'wall' }), null, 'a wall needs its other end and a height');
  assert.equal(readSpell({ ...good, shape: 'cylinder' }), null, 'a cylinder needs a length');
});

test('the eraser finds a spell under a floor point', () => {
  const spell: Spell = { ...base, shape: 'cone', from: 'self', at: { x: 0, y: 0, h: 30 }, size: 100 };
  assert.ok(spellUnder(spell, { x: 0, y: -60 }));
  assert.ok(!spellUnder(spell, { x: 0, y: 60 }));
});

test('a spell keeps its damage; an unknown one is dropped', () => {
  const fire: Spell = { shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: 70, length: 0, angle: 1, effect: 'fire' };
  assert.equal(readSpell(fire)?.effect, 'fire');
  assert.equal(readSpell({ ...fire, effect: 'sparkles' })?.effect, undefined);
});

test("an instantaneous spell is one whose words say so; one with a duration, or with no words, stays", () => {
  const about = (duration: string) => ({ about: { line: 'Level 3 Evocation', text: '', properties: [['Range', '150 feet'], ['Duration', duration]] as Array<[string, string]> } });
  assert.equal(isInstantaneous(about('Instantaneous')), true);
  assert.equal(isInstantaneous(about(' instantaneous ')), true);
  assert.equal(isInstantaneous(about('Concentration, up to 1 minute')), false);
  assert.equal(isInstantaneous(about('1 minute')), false);
  assert.equal(isInstantaneous(about('Instantaneous or 1 hour (see below)')), false);
  assert.equal(isInstantaneous({}), false);
});
