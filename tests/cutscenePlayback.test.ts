import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Cutscene, Shot } from '../src/cutscene/cutsceneData';
import { CutscenePlayback } from '../src/cutscene/playback';

const shot = (id: string, at: number, mapPath: string, n: number, extra: Partial<Shot> = {}): Shot => ({
  id, at, mapPath, eye: { x: n * 3, y: 5 + n * n, z: -n }, target: { x: n, y: 0, z: n * 2 }, keyframe: false, transition: 'fade', ...extra,
});
const fixture = (): Cutscene => ({
  id: 'c', name: 'n',
  shots: [
    shot('A', 0, 'a', 0),
    shot('B', 1000, 'a', 1, { keyframe: true, transition: 'move' }),
    shot('C', 2000, 'a', 2, { transition: 'move' }),
    shot('D', 3000, 'b', 3, { transition: 'fade' }),
    shot('E', 3600, 'b', 4, { transition: 'cut' }),
  ],
});

test('next walks the stops and ends after the last', () => {
  const c = fixture();
  const play = new CutscenePlayback(c);
  assert.equal(play.shot, 0);
  assert.equal(play.seq, 0);
  assert.equal(play.next(0), 'playing');
  assert.equal(play.playing, true);
  assert.equal(play.shot, 2);
  const rested = play.frame(2000);
  assert.equal(rested.resting, true);
  assert.deepEqual(rested.eye, c.shots[2].eye);
  assert.equal(play.playing, false);
  play.next(2000);
  assert.equal(play.shot, 3);
  play.next(2000);
  assert.equal(play.shot, 4);
  assert.equal(play.next(3000), 'ended');
  assert.equal(play.seq, 3);
});

test('next during a transition finishes it first', () => {
  const c = fixture();
  const play = new CutscenePlayback(c);
  play.next(0);
  play.next(500);
  assert.equal(play.shot, 3);
  const f = play.frame(500);
  assert.deepEqual(f.eye, c.shots[2].eye);
  assert.equal(f.black, 0);
  assert.equal(f.resting, false);
});

test('previous is a cut to the previous stop', () => {
  const play = new CutscenePlayback(fixture());
  play.next(0);
  play.frame(5000);
  play.next(5000);
  assert.equal(play.shot, 3);
  assert.equal(play.previous(5100), true);
  assert.equal(play.shot, 2);
  assert.equal(play.frame(5100).resting, true);
  assert.equal(play.previous(5200), true);
  assert.equal(play.previous(5200), false);
  assert.equal(play.shot, 0);
});

test('previous while heading to a shot rests on the stop before it', () => {
  const play = new CutscenePlayback(fixture());
  play.next(0);
  assert.equal(play.previous(100), true);
  assert.equal(play.shot, 0);
  assert.equal(play.playing, false);
});

test('a preview can start on a keyframe shot', () => {
  const play = new CutscenePlayback(fixture(), 1);
  assert.equal(play.shot, 1);
  assert.equal(play.frame(0).resting, true);
  play.next(0);
  assert.equal(play.shot, 2);
});

test('follow: the next stop plays, anything else seeks, stale news is ignored', () => {
  const play = new CutscenePlayback(fixture());
  play.follow(3, 5, 0);
  assert.equal(play.shot, 3);
  assert.equal(play.frame(0).resting, true);
  assert.equal(play.seq, 5);
  play.follow(4, 4, 0);
  assert.equal(play.shot, 3);
  play.follow(3, 5, 0);
  assert.equal(play.seq, 5);
  play.follow(4, 6, 10);
  assert.equal(play.shot, 4);
  assert.equal(play.seq, 6);
  assert.equal(play.playing, true);
});

test('seek rests with no transition', () => {
  const play = new CutscenePlayback(fixture());
  play.next(0);
  play.seek(3, 9);
  assert.equal(play.playing, false);
  assert.equal(play.seq, 9);
  assert.equal(play.frame(0).mapPath, 'b');
});

test('a cutscene with no shots cannot be played', () => {
  assert.throws(() => new CutscenePlayback({ id: 'c', name: 'n', shots: [] }));
});

test('next into the last stop mid-transition returns ended and stays on the last shot', () => {
  const play = new CutscenePlayback(fixture());
  play.next(0);
  play.next(10);
  play.next(20);
  assert.equal(play.shot, 4);
  assert.equal(play.next(30), 'ended');
  assert.equal(play.shot, 4);
});

test('mashing next across a keyframe chain never rests on the keyframe', () => {
  const c = fixture();
  const stops = [0, 2, 3, 4];
  const play = new CutscenePlayback(c);
  for (let i = 0; i < 12; i++) {
    play.next(i * 7);
    assert.ok(stops.includes(play.shot), `shot ${play.shot} is not a stop`);
    play.frame(i * 7 + 3);
  }
  assert.equal(play.shot, 4);
});

test('previous then next lands on the stop after the previous one, not the keyframe', () => {
  const play = new CutscenePlayback(fixture());
  play.next(0);
  play.frame(5000);
  assert.equal(play.shot, 2);
  assert.equal(play.previous(5000), true);
  assert.equal(play.shot, 0);
  play.next(5000);
  assert.equal(play.shot, 2);
});
