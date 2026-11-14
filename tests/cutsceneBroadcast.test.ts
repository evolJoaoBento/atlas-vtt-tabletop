import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastOf, readBoardCutscene } from '../src/cutscene/broadcast';
import { CutsceneChannel } from '../src/cutscene/cutsceneRun';
import { DEFAULT_CINEMATIC_SETTINGS } from '../src/cutscene/cinematicSettings';
import { levelOfPlace, mapOfPlace, placeAt, placed, placeOf, type Cutscene, type Shot } from '../src/cutscene/cutsceneData';
import { mapLabel } from '../src/cutscene/timelineView';

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

// ── What a player's board accepts ──────────────────────────────────────────────────────────────────────────────────

test('readBoardCutscene accepts what the broadcast sends, unchanged', () => {
  const sent = JSON.parse(JSON.stringify(broadcastOf(input).cutscene));
  assert.deepEqual(readBoardCutscene(sent), sent);
  const stepped = JSON.parse(JSON.stringify(broadcastOf({ ...input, step: { shot: 2, seq: 4 }, mapPath: 'maps/a.atlasmap' }).cutscene));
  assert.deepEqual(readBoardCutscene(stepped), stepped);
});

test('readBoardCutscene accepts a live run with no shots', () => {
  const live = JSON.parse(JSON.stringify(broadcastOf({ ...input, mode: 'live', cutscene: null }).cutscene));
  assert.deepEqual(readBoardCutscene(live), live);
});

test('readBoardCutscene refuses what breaks the limits', () => {
  const sent = (): any => JSON.parse(JSON.stringify(broadcastOf(input).cutscene));
  const many = sent();
  many.shots = Array.from({ length: 201 }, () => many.shots[0]);
  assert.equal(readBoardCutscene(many), null);
  const at200 = sent();
  at200.shots = Array.from({ length: 200 }, () => at200.shots[0]);
  assert.notEqual(readBoardCutscene(at200), null);
  const slash = sent();
  slash.shots[0].key = 'k/1';
  assert.equal(readBoardCutscene(slash), null);
  const keyframe = sent();
  assert.equal(keyframe.shots[1].keyframe, true);
  keyframe.step.shot = 1;
  assert.equal(readBoardCutscene(keyframe), null);
  const none = sent();
  none.shots = [];
  assert.equal(readBoardCutscene(none), null);
  const late = sent();
  late.shots[2].at = 3_600_001;
  assert.equal(readBoardCutscene(late), null);
  const far = sent();
  far.shots[0].eye.x = 1e7 + 1;
  assert.equal(readBoardCutscene(far), null);
  const run = sent();
  run.runId = 'a b';
  assert.equal(readBoardCutscene(run), null);
  const fade = sent();
  fade.look.fadeMs = 50;
  assert.equal(readBoardCutscene(fade), null);
  const bars = sent();
  bars.look.bars = 1.5;
  assert.equal(readBoardCutscene(bars), null);
  const liveShots = JSON.parse(JSON.stringify(broadcastOf({ ...input, mode: 'live', cutscene: null }).cutscene));
  liveShots.shots = sent().shots;
  assert.equal(readBoardCutscene(liveShots), null);
  assert.equal(readBoardCutscene(null), null);
  assert.equal(readBoardCutscene('x'), null);
});

test('readBoardCutscene keeps nothing of what it was given', () => {
  const sent = JSON.parse(JSON.stringify(broadcastOf(input).cutscene));
  const read = readBoardCutscene(sent)!;
  sent.shots[0].eye.x = 12345;
  assert.notEqual(read.shots[0].eye.x, 12345);
});

test('a place is a map and, where the shot names one, a level of it; a map alone is a place too', () => {
  const up = shot('u', 0, 'maps/keep.atlasmap', { level: 'level_up' });
  assert.equal(placeOf(shot('g', 0, 'maps/keep.atlasmap')), 'maps/keep.atlasmap');
  assert.notEqual(placeOf(up), 'maps/keep.atlasmap');
  assert.equal(placeOf(up), placeAt('maps/keep.atlasmap', 'level_up'));
  assert.equal(placeAt('maps/keep.atlasmap', null), 'maps/keep.atlasmap');
  assert.deepEqual([mapOfPlace(placeOf(up)), levelOfPlace(placeOf(up))], ['maps/keep.atlasmap', 'level_up']);
  assert.deepEqual([mapOfPlace('maps/keep.atlasmap'), levelOfPlace('maps/keep.atlasmap')], ['maps/keep.atlasmap', null]);
  // A place is named by its map.
  assert.equal(mapLabel(placeOf(up)), 'keep');
  // A cutscene as the run plays it: each shot's map is its place, so two levels of one scene are two scenes to switch between.
  const played = placed({ id: 'c', name: 'c', shots: [shot('g', 0, 'maps/keep.atlasmap'), up] });
  assert.deepEqual(played.shots.map((each) => [each.mapPath, 'level' in each]), [['maps/keep.atlasmap', false], [placeOf(up), false]]);
});

test('two levels of one map are two keys for players, each with its level; a map without a level is as before', () => {
  const levels: Cutscene = { id: 'c', name: 'Keep', shots: [shot('a', 0, 'maps/keep.atlasmap'), shot('b', 1000, 'maps/keep.atlasmap', { level: 'level_up' }), shot('c', 2000, 'maps/keep.atlasmap', { level: 'level_up' }), shot('d', 3000, 'maps/road.atlasmap')] };
  const out = broadcastOf({ ...input, cutscene: levels, step: { shot: 1, seq: 2 }, mapPath: placeAt('maps/keep.atlasmap', 'level_up') });
  assert.deepEqual(out.cutscene.shots.map((s) => s.key), ['k1', 'k2', 'k2', 'k3']);
  assert.deepEqual(out.maps, { k1: 'maps/keep.atlasmap', k2: 'maps/keep.atlasmap', k3: 'maps/road.atlasmap' });
  assert.deepEqual(out.levels, { k2: 'level_up' });
  assert.equal(out.cutscene.key, 'k2');
  // Nothing of a level's id, nor of a path, is in what players are sent.
  assert.ok(!JSON.stringify(out.cutscene).includes('level_up'));
  // No level anywhere: no table of levels.
  assert.equal('levels' in broadcastOf(input), false);
  // A live run on a level: its one key carries it; a place keyed earlier keeps its key.
  const live = broadcastOf({ ...input, mode: 'live', cutscene: null, mapPath: placeAt('maps/keep.atlasmap', 'level_up'), earlier: ['maps/keep.atlasmap'] });
  assert.deepEqual([live.cutscene.key, live.maps, live.levels], ['k2', { k2: 'maps/keep.atlasmap' }, { k2: 'level_up' }]);
});
