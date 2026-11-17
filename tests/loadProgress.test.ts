import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LoadProgress, SETTLE_MS, STALL_MS, timeLeft } from '../src/board/loadProgress';

function clocked() {
  let now = 1000;
  const progress = new LoadProgress(() => now);
  return { progress, advance: (ms: number) => { now += ms; } };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

test('nothing is counted while no map is loading; a batch with nothing asked is all in', () => {
  const { progress } = clocked();
  void progress.track(Promise.resolve(1));
  assert.equal(progress.state().open, false);
  progress.open();
  assert.deepEqual({ ...progress.state(), elapsedMs: 0 }, { open: true, fraction: 1, done: 0, total: 0, remainingMs: 0, elapsedMs: 0 });
});

test('files count by weight, the time left is worked out from the rate so far, and the batch closes once nothing is pending a moment', async () => {
  const { progress, advance } = clocked();
  progress.open();
  const map = deferred(), mini = deferred(), art = deferred();
  void progress.track(map.promise, 4);
  void progress.track(mini.promise, 2);
  void progress.track(art.promise, 2);
  assert.equal(progress.state().remainingMs, null);
  advance(2000);
  map.resolve();
  await settled();
  const half = progress.state();
  assert.equal(half.fraction, 0.5);
  assert.deepEqual([half.done, half.total], [1, 3]);
  // Half in two seconds: two more to go.
  assert.equal(half.remainingMs, 2000);
  mini.resolve();
  // A file that fails still comes in (it is done with).
  art.reject(new Error('missing'));
  await settled();
  assert.equal(progress.state().fraction, 1);
  assert.equal(progress.state().remainingMs, 0);
  assert.equal(progress.state().open, true);
  advance(SETTLE_MS);
  assert.equal(progress.state().open, false);
});

test('what is asked for just after the last file came in still counts in the same batch', async () => {
  const { progress, advance } = clocked();
  progress.open();
  const first = deferred();
  void progress.track(first.promise);
  first.resolve();
  await settled();
  advance(SETTLE_MS - 50);
  const late = deferred();
  void progress.track(late.promise);
  assert.deepEqual([progress.state().done, progress.state().total], [1, 2]);
  late.resolve();
  await settled();
  advance(SETTLE_MS);
  assert.equal(progress.state().open, false);
});

test('a file that never comes does not hold the batch open forever, and a file of a batch that is over counts no more', async () => {
  const { progress, advance } = clocked();
  progress.open();
  const never = deferred();
  void progress.track(never.promise);
  advance(STALL_MS - 1);
  assert.equal(progress.state().open, true);
  advance(1);
  assert.equal(progress.state().open, false);
  progress.open();
  const now = deferred();
  void progress.track(now.promise);
  never.resolve();
  await settled();
  assert.deepEqual([progress.state().done, progress.state().total], [0, 1]);
});

test('the listeners hear of a batch opening and of each file', async () => {
  const { progress } = clocked();
  let heard = 0;
  const stop = progress.onChange(() => { heard += 1; });
  progress.open();
  const one = deferred();
  void progress.track(one.promise);
  one.resolve();
  await settled();
  assert.equal(heard, 3);
  stop();
  progress.open();
  assert.equal(heard, 3);
});

test('the time left reads as a person says it', () => {
  assert.equal(timeLeft(null), 'working out the time left');
  assert.equal(timeLeft(800), 'almost done');
  assert.equal(timeLeft(12_400), 'about 12 s left');
  assert.equal(timeLeft(95_000), 'about 1 min 35 s left');
  assert.equal(timeLeft(120_000), 'about 2 min left');
  assert.equal(timeLeft(14 * 60_000 + 20_000), 'about 14 min left');
});
