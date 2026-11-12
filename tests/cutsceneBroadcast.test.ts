import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastOf } from '../src/cutscene/broadcast';
import { CutsceneChannel } from '../src/cutscene/cutsceneRun';
import { DEFAULT_CINEMATIC_SETTINGS } from '../src/cutscene/cinematicSettings';
import type { Cutscene, Shot } from '../src/cutscene/cutsceneData';

const shot = (id: string, at: number, mapPath: string, extra: Partial<Shot> = {}): Shot => ({
  id, at, mapPath, eye: { x: at, y: 500, z: 900 }, target: { x: at, y: 0, z: 100 }, keyframe: false, transition: 'fade', ...extra,
});

const run: Cutscene = {
  id: 'c', name: 'Docks',
  shots: [shot('a', 0, 'maps/a.atlasmap'), shot('b', 1000, 'maps/b.atlasmap', { keyframe: true }), shot('c', 2000, 'maps/a.atlasmap')],
};

const input = { runId: 'run-1', mode: 'prepared' as const, cutscene: run, step: { shot: 0, seq: 1 }, mapPath: 'maps/a.atlasmap', settings: { ...DEFAULT_CINEMATIC_SETTINGS } };

test('keys follow the first appearance of each map', () => {
  const out = broadcastOf(input);
  assert.deepEqual(out.cutscene.shots.map((s) => s.key), ['k1', 'k2', 'k1']);
  assert.deepEqual(out.maps, { k1: 'maps/a.atlasmap', k2: 'maps/b.atlasmap' });
  assert.equal(out.cutscene.key, 'k1');
  assert.deepEqual(out.cutscene.step, { shot: 0, seq: 1 });
});

test('no vault path is in what is sent', () => {
  const text = JSON.stringify(broadcastOf(input).cutscene);
  assert.ok(!text.includes('.atlasmap'));
  assert.ok(!text.includes('/'));
});

test('the shots are copied, not shared', () => {
  const out = broadcastOf(input);
  out.cutscene.shots[0].eye.x = 99999;
  assert.equal(run.shots[0].eye.x, 0);
});

test('bars off give null, on give the aspect; the fade length is carried', () => {
  assert.equal(broadcastOf({ ...input, settings: { ...input.settings, bars: false } }).cutscene.look.bars, null);
  const on = broadcastOf({ ...input, settings: { ...input.settings, bars: true, aspect: 1.85, fadeMs: 900 } }).cutscene.look;
  assert.deepEqual(on, { bars: 1.85, fadeMs: 900 });
});

test('the key is the map shown now, which may be a map no shot is on', () => {
  const out = broadcastOf({ ...input, mapPath: 'maps/c.atlasmap' });
  assert.equal(out.cutscene.key, 'k3');
  assert.equal(out.maps.k3, 'maps/c.atlasmap');
});

test('live with no cutscene has no shots and the key k1', () => {
  const out = broadcastOf({ ...input, mode: 'live', cutscene: null });
  assert.deepEqual(out.cutscene.shots, []);
  assert.equal(out.cutscene.key, 'k1');
  assert.deepEqual(out.maps, { k1: 'maps/a.atlasmap' });
});

test('a map seen earlier in the run keeps its number, a new one takes the next', () => {
  const live = { ...input, mode: 'live' as const, cutscene: null };
  const second = broadcastOf({ ...live, mapPath: 'maps/b.atlasmap', earlier: ['maps/a.atlasmap'] });
  assert.equal(second.cutscene.key, 'k2');
  const back = broadcastOf({ ...live, mapPath: 'maps/a.atlasmap', earlier: ['maps/a.atlasmap', 'maps/b.atlasmap'] });
  assert.equal(back.cutscene.key, 'k1');
  assert.deepEqual(back.maps, { k1: 'maps/a.atlasmap' });
});

// ── The channel behind api.cutscene ────────────────────────────────────────────────────────────────────────────────

const told = (n: number) => broadcastOf({ ...input, step: { shot: 0, seq: n } });
const owner = (name: string) => ({ name, ended: 0, cam: null as null | { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }, end() { this.ended++; }, dispose() { this.ended++; }, liveCamera() { return this.cam; } });

test('the channel hands out the run and tells listeners of each change', () => {
  const channel = new CutsceneChannel();
  const a = owner('a');
  let heard = 0;
  const stop = channel.onChange(() => heard++);
  assert.equal(channel.current(), null);
  channel.publish(a, told(1));
  channel.publish(a, told(2));
  assert.equal(channel.current()?.cutscene.step.seq, 2);
  assert.equal(heard, 2);
  channel.publish(a, null);
  assert.equal(channel.current(), null);
  assert.equal(heard, 3);
  stop();
  channel.publish(a, told(1));
  assert.equal(heard, 3);
});

test('a second owner starting a run ends the first one', () => {
  const channel = new CutsceneChannel();
  const a = owner('a');
  const b = owner('b');
  channel.publish(a, told(1));
  channel.publish(b, told(1));
  assert.equal(a.ended, 1);
  assert.equal(channel.current() !== null, true);
  // The first one's late null is not the second one's end.
  channel.publish(a, null);
  assert.notEqual(channel.current(), null);
});

test('only the owner of the run can clear it, and the camera is the owner\'s while live', () => {
  const channel = new CutsceneChannel();
  const a = owner('a');
  const live = broadcastOf({ ...input, mode: 'live', cutscene: null });
  channel.publish(a, live);
  a.cam = { eye: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } };
  assert.deepEqual(channel.camera(), a.cam);
  let moves = 0;
  channel.onCamera(() => moves++);
  channel.cameraMoved(owner('other'));
  assert.equal(moves, 0);
  channel.cameraMoved(a);
  assert.equal(moves, 1);
  channel.publish(a, told(1));
  assert.equal(channel.camera(), null);
  channel.cameraMoved(a);
  assert.equal(moves, 1);
});

test('ending the channel ends the run and publishes null', () => {
  const channel = new CutsceneChannel();
  const a = owner('a');
  let heard = 0;
  channel.onChange(() => heard++);
  channel.publish(a, told(1));
  channel.endRun();
  assert.equal(a.ended, 1);
  channel.publish(a, null);
  assert.equal(channel.current(), null);
  assert.equal(heard, 2);
});

test('disposing the channel (Tabletop unloads): the owner is disposed once, listeners hear null once and nothing after', () => {
  const channel = new CutsceneChannel();
  const a = owner('a');
  let heard = 0;
  channel.onChange(() => heard++);
  channel.onCamera(() => heard++);
  channel.publish(a, broadcastOf({ ...input, mode: 'live', cutscene: null }));
  assert.equal(heard, 1);
  channel.dispose();
  assert.equal(channel.current(), null);
  assert.equal(a.ended, 1);
  assert.equal(heard, 2);
  channel.publish(a, null);
  channel.publish(a, told(1));
  channel.cameraMoved(a);
  assert.equal(heard, 2);
  // Disposing with no run tells nobody.
  const idle = new CutsceneChannel();
  let idleHeard = 0;
  idle.onChange(() => idleHeard++);
  idle.dispose();
  assert.equal(idleHeard, 0);
});
