import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addShot, allowedTransitions, limitProblem, MAX_AT_MS, MAX_SHOTS, readCutscenes, removeShot, retime, setKeyframe, setTransition, updateShot, type Cutscene, type Shot } from '../src/cutscene/cutsceneData';

const pose = { eye: { x: 0, y: 5, z: 5 }, target: { x: 0, y: 0, z: 0 } };
const shot = (id: string, at: number, mapPath: string, extra: Partial<Shot> = {}): Shot => ({ id, at, mapPath, ...pose, keyframe: false, transition: 'fade', ...extra });
const plain = (id: string, at: number, map: string, extra: Record<string, unknown> = {}) => ({ id, at, mapPath: map, ...pose, keyframe: false, transition: 'fade', ...extra });

test('allowedTransitions: a move only on one map', () => {
  assert.deepEqual(allowedTransitions(shot('x', 0, 'a.atlasmap'), shot('y', 1, 'a.atlasmap')), ['fade', 'cut', 'move']);
  assert.deepEqual(allowedTransitions(shot('x', 0, 'a'), shot('y', 1, 'b')), ['fade', 'cut']);
});

test('readCutscenes drops bad shots, sorts, spaces and names', () => {
  const bad = plain('bad', 700, 'a', { eye: { x: NaN, y: 0, z: 0 } });
  const same = plain('same', 800, 'a', { target: pose.eye });
  const noMap = plain('nomap', 900, '');
  const read = readCutscenes([{ id: 'c', name: '', shots: [plain('s1', 500, 'a'), plain('s0', 0, 'a'), plain('s2', 550, 'a', { transition: 'move' }), bad, same, noMap] }, { name: 'no id', shots: [] }]);
  assert.equal(read.length, 1);
  assert.equal(read[0].name, 'Cutscene');
  assert.deepEqual(read[0].shots.map((s) => s.at), [0, 500, 600]);
  assert.deepEqual(read[0].shots.map((s) => s.id), ['s0', 's1', 's2']);
  assert.equal(read[0].shots[2].transition, 'move');
});

test('readCutscenes turns a cross-map move into a fade', () => {
  const [c] = readCutscenes([{ id: 'c', name: 'n', shots: [plain('s0', 0, 'a'), plain('s1', 1000, 'b', { transition: 'move' })] }]);
  assert.equal(c.shots[1].transition, 'fade');
});

test('readCutscenes survives junk', () => {
  assert.deepEqual(readCutscenes(undefined), []);
  assert.deepEqual(readCutscenes([null, 3, { id: 'c' }]), [{ id: 'c', name: 'Cutscene', shots: [] }]);
});

const three: Cutscene = { id: 'c', name: 'n', shots: [shot('a', 0, 'm'), shot('b', 1000, 'm', { transition: 'move' }), shot('c', 2000, 'm')] };

test('addShot keeps move on the same map, falls back to fade across maps', () => {
  const base: Cutscene = { id: 'c', name: 'n', shots: [shot('a', 0, 'a')] };
  assert.equal(addShot(base, { id: 'b', at: 1000, mapPath: 'b', ...pose }, 'move').shots[1].transition, 'fade');
  const same = addShot(base, { id: 'b', at: 1000, mapPath: 'a', ...pose }, 'move');
  assert.equal(same.shots[1].transition, 'move');
  assert.equal(same.shots[1].keyframe, false);
});

test('addShot rechecks the shot after it, and keeps order', () => {
  const c: Cutscene = { id: 'c', name: 'n', shots: [shot('a', 0, 'm'), shot('z', 2000, 'm', { transition: 'move' })] };
  const added = addShot(c, { id: 'b', at: 1000, mapPath: 'other', ...pose }, 'cut');
  assert.deepEqual(added.shots.map((s) => s.id), ['a', 'b', 'z']);
  assert.equal(added.shots[1].transition, 'cut');
  assert.equal(added.shots[2].transition, 'fade');
});

test('addShot refuses a shot too close to another or a repeated id', () => {
  assert.equal(addShot(three, { id: 'n', at: 1050, mapPath: 'm', ...pose }, 'fade'), three);
  assert.equal(addShot(three, { id: 'a', at: 500, mapPath: 'm', ...pose }, 'fade'), three);
});

test('retime clamps to the gap from both neighbours', () => {
  assert.equal(retime(three, 'b', 50).shots[1].at, 100);
  assert.equal(retime(three, 'b', 1990).shots[1].at, 1900);
  assert.equal(retime(three, 'b', 1500).shots[1].at, 1500);
  assert.equal(retime(three, 'c', 5000).shots[2].at, 5000);
  assert.equal(retime(three, 'a', -50).shots[0].at, 0);
  assert.equal(retime(three, 'b', 1000), three);
});

test('setTransition refuses what is not allowed', () => {
  const across: Cutscene = { id: 'c', name: 'n', shots: [shot('a', 0, 'a'), shot('b', 1000, 'b')] };
  assert.equal(setTransition(across, 'b', 'move'), across);
  assert.equal(setTransition(across, 'b', 'cut').shots[1].transition, 'cut');
  assert.equal(setTransition(three, 'c', 'move').shots[2].transition, 'move');
});

test('setKeyframe and removeShot', () => {
  assert.equal(setKeyframe(three, 'b', true).shots[1].keyframe, true);
  assert.equal(setKeyframe(three, 'b', false), three);
  assert.deepEqual(removeShot(three, 'b').shots.map((s) => s.id), ['a', 'c']);
  assert.equal(removeShot(three, 'nope'), three);
});

test('updateShot moving a shot to another map turns the move into it into a fade', () => {
  const moved = updateShot(three, 'b', { mapPath: 'other', ...pose });
  assert.equal(moved.shots[1].mapPath, 'other');
  assert.equal(moved.shots[1].transition, 'fade');
  // The shot after it was a fade already; a move out of it onto another map is mended too.
  const withMove: Cutscene = { ...three, shots: three.shots.map((s) => (s.id === 'c' ? { ...s, transition: 'move' as const } : s)) };
  assert.equal(updateShot(withMove, 'b', { mapPath: 'other', ...pose }).shots[2].transition, 'fade');
  assert.equal(updateShot(three, 'b', { mapPath: 'm', eye: pose.eye, target: pose.eye }), three);
});

test('limits: at most 200 shots, a shot no later than one hour, cameras within 1e7', () => {
  const full: Cutscene = { id: 'f', name: 'Full', shots: Array.from({ length: MAX_SHOTS }, (_, i) => shot(`s${i}`, i * 100, 'm')) };
  assert.equal(limitProblem(full), null);
  assert.equal(addShot(full, { id: 'more', at: 50_000, mapPath: 'm', ...pose }, 'fade'), full);
  const one: Cutscene = { id: 'o', name: 'One', shots: [shot('a', 0, 'm')] };
  assert.equal(addShot(one, { id: 'late', at: MAX_AT_MS + 1, mapPath: 'm', ...pose }, 'fade'), one);
  assert.equal(addShot(one, { id: 'edge', at: MAX_AT_MS, mapPath: 'm', ...pose }, 'fade').shots.length, 2);
  assert.equal(addShot(one, { id: 'far', at: 500, mapPath: 'm', eye: { x: 2e7, y: 5, z: 5 }, target: pose.target }, 'fade'), one);
  assert.equal(retime(one, 'a', MAX_AT_MS * 2).shots[0].at, MAX_AT_MS);
  const two = addShot(one, { id: 'b', at: 500, mapPath: 'm', ...pose }, 'fade');
  assert.equal(retime(two, 'b', MAX_AT_MS * 2).shots[1].at, MAX_AT_MS);
  assert.match(limitProblem({ ...full, shots: [...full.shots, shot('x', 1e6, 'm')] }) ?? '', /at most 200 shots/);
  assert.match(limitProblem({ ...one, shots: [shot('a', MAX_AT_MS + 1, 'm')] }) ?? '', /1 hour/);
  assert.match(limitProblem({ ...one, shots: [shot('a', 0, 'm', { target: { x: 0, y: 0, z: -1e8 } })] }) ?? '', /too far/);
});
