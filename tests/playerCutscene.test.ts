import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardCutscene } from '../src/connectContract';
import { PlayerCutsceneState } from '../src/cutscene/playerCutscene';

const pose = (n: number) => ({ eye: { x: n * 100, y: 500, z: 900 }, target: { x: n * 100, y: 0, z: 100 } });
const shot = (n: number, key: string, at: number, transition: 'fade' | 'cut' | 'move' = 'fade') => ({ key, ...pose(n), at, keyframe: false, transition });

const make = (step: { shot: number; seq: number }, key = 'k1', fadeMs = 600): BoardCutscene => ({
  runId: 'run-1', mode: 'prepared', look: { bars: 2.39, fadeMs },
  shots: [shot(0, 'k1', 0), shot(1, 'k1', 2000, 'move'), shot(2, 'k2', 4000, 'fade'), shot(3, 'k2', 6000, 'cut')],
  step, key,
});

test('the enter fade goes black on the own scene, then the run shows its scene black until it has been drawn', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 0, seq: 1 }), 0);
  const early = s.view(300);
  assert.equal(early.black, 0.5);
  assert.equal(early.show, 'own');
  assert.equal(early.locked, true);
  assert.equal(s.view(700).show, 'k1');
  assert.equal(s.view(700).black, 1);
  s.sceneArrived('k1');
  assert.equal(s.view(1400).black, 0);
});

test('a scene that arrives late is faded in from its arrival, not popped in', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 0, seq: 1 }), 0);
  s.view(700);
  s.view(5000);
  s.sceneArrived('k1');
  const at = s.view(5000).black;
  assert.equal(at, 1);
  const mid = s.view(5300).black;
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  assert.equal(s.view(5700).black, 0);
});

test('locked from the start of the run until the leave fade is done', () => {
  const s = new PlayerCutsceneState();
  assert.equal(s.view(0).locked, false);
  s.cutscene(make({ shot: 0, seq: 1 }), 0);
  s.view(700);
  s.sceneArrived('k1');
  assert.equal(s.view(2000).locked, true);
  s.cutscene(null, 3000);
  assert.equal(s.view(3300).locked, true);
  assert.equal(s.view(4100).locked, true);
  const done = s.view(4200);
  assert.equal(done.locked, false);
  assert.equal(done.show, 'own');
  assert.equal(done.black, 0);
});

test('ending: restore is true exactly once, at the black midpoint', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 0, seq: 1 }), 0);
  s.view(700);
  s.sceneArrived('k1');
  s.view(2000);
  s.cutscene(null, 3000);
  assert.equal(s.view(3300).restore, false);
  assert.equal(s.view(3300).show, 'k1');
  const mid = s.view(3600);
  assert.equal(mid.restore, true);
  assert.equal(mid.show, 'own');
  assert.equal(mid.black, 1);
  assert.equal(s.view(3600).restore, false);
  assert.equal(s.view(3900).restore, false);
  assert.equal(s.view(3900).show, 'own');
  assert.equal(s.view(3900).black, 0.5);
});

test('setConnected(false) ends the run: disconnected behaves as cutscene(null)', () => {
  const a = new PlayerCutsceneState();
  const b = new PlayerCutsceneState();
  for (const s of [a, b]) {
    s.cutscene(make({ shot: 0, seq: 1 }), 0);
    s.view(700);
    s.sceneArrived('k1');
    s.view(2000);
  }
  a.disconnected(3000);
  b.cutscene(null, 3000);
  for (const t of [3300, 3600, 3900, 4200, 4300]) assert.deepEqual(a.view(t), b.view(t));
  // A second call changes nothing more.
  a.disconnected(3900);
  b.cutscene(null, 3900);
  assert.deepEqual(a.view(4000), b.view(4000));
  assert.equal(a.view(4300).locked, false);
});

test('joins mid-run at the current shot: black at once, then that shot at rest', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 3, seq: 7 }, 'k2'), 0, true);
  const first = s.view(0);
  assert.equal(first.black, 1);
  assert.equal(first.show, 'k2');
  assert.equal(first.locked, true);
  s.view(300);
  s.sceneArrived('k2');
  const later = s.view(1500);
  assert.equal(later.black, 0);
  assert.deepEqual(later.camera?.eye, pose(3).eye);
  assert.deepEqual(later.camera?.target, pose(3).target);
});

test('a step to a shot on the same map plays on; one on another map holds black until its scene has been drawn', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 0, seq: 1 }), 0, true);
  s.view(10);
  s.sceneArrived('k1');
  s.view(1000);
  // Next: shot 1 on the same map, a move of two seconds.
  s.cutscene(make({ shot: 1, seq: 2 }), 1000);
  const mid = s.view(2000);
  assert.equal(mid.black, 0);
  assert.equal(mid.show, 'k1');
  assert.ok((mid.camera?.eye.x ?? 0) > 0 && (mid.camera?.eye.x ?? 0) < 100);
  // Next: shot 2 on k2, a fade; the scene of k2 is slow to come.
  s.cutscene(make({ shot: 2, seq: 3 }, 'k2'), 3000);
  s.view(3000);
  const midFade = s.view(3500);
  assert.equal(midFade.show, 'k1');
  assert.ok(midFade.black > 0);
  const swapped = s.view(4100);
  assert.equal(swapped.show, 'k2');
  assert.equal(swapped.black, 1);
  const held = s.view(9000);
  assert.equal(held.show, 'k2');
  assert.equal(held.black, 1);
  // The playback waited: its clock stood still while the scene was missing.
  s.sceneArrived('k2');
  s.view(9000);
  assert.ok(s.view(9100).black > 0.5);
  const after = s.view(12000);
  assert.equal(after.black, 0);
  assert.deepEqual(after.camera?.eye, pose(2).eye);
});

test('older news of the run changes nothing', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 1, seq: 5 }), 0, true);
  s.view(0);
  s.sceneArrived('k1');
  s.view(2000);
  s.cutscene(make({ shot: 0, seq: 2 }), 2000);
  assert.deepEqual(s.view(2100).camera?.eye, pose(1).eye);
});

test('a live run shows the key of the scene, and a new key holds black until that scene has been drawn', () => {
  const live = (key: string, seq: number): BoardCutscene => ({ runId: 'live-1', mode: 'live', look: { bars: null, fadeMs: 600 }, shots: [], step: { shot: 0, seq }, key });
  const s = new PlayerCutsceneState();
  s.cutscene(live('k1', 1), 0, true);
  s.view(0);
  s.sceneArrived('k1');
  assert.equal(s.view(1000).black, 0);
  assert.equal(s.view(1000).camera, null);
  s.cutscene(live('k2', 2), 1500);
  const held = s.view(1600);
  assert.equal(held.show, 'k2');
  assert.equal(held.black, 1);
  s.sceneArrived('k2');
  assert.equal(s.view(3000).black, 0);
});

test('a run that arrives while another is shown starts black on its own scene', () => {
  const s = new PlayerCutsceneState();
  s.cutscene(make({ shot: 0, seq: 1 }), 0, true);
  s.view(0);
  s.sceneArrived('k1');
  s.view(1000);
  s.cutscene({ ...make({ shot: 0, seq: 1 }), runId: 'run-2' }, 1000);
  const v = s.view(1000);
  assert.equal(v.black, 1);
  assert.equal(v.show, 'k1');
});
