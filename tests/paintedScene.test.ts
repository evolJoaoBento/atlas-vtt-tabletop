import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BACKGROUND, emptyLayers, TERRAINS, type LoadedBackground } from '../src/background/backgroundData';
import { PaintedScene, type PaintedArea } from '../src/background/paintedScene';

const AREA: PaintedArea = { width: 700, height: 700, cell: 70, margin: 0, tile: 2 };
const TOPOGRAPHY = TERRAINS.find((t) => t.id === 'topography')!.index;
/** Far past the board, where the ground has eased in fully. */
const FAR = 60;

/** A background whose every cell is topography at `level` squares: so the ground there shows which read was used. */
function background(level: number): LoadedBackground {
  const layers = emptyLayers(64);
  layers.terrain.fill(TOPOGRAPHY);
  return { settings: { ...DEFAULT_BACKGROUND, height: { low: level, high: level } }, layers, materials: [] };
}

/** A read the test finishes by hand. */
function deferred(): { promise: Promise<LoadedBackground | null>; done: (value: LoadedBackground | null) => void; fail: () => void } {
  let done!: (value: LoadedBackground | null) => void, fail!: () => void;
  const promise = new Promise<LoadedBackground | null>((resolve, reject) => { done = resolve; fail = () => reject(new Error('read failed')); });
  return { promise, done, fail };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

function scene(reads: Promise<LoadedBackground | null>[]): { scene: PaintedScene; changed: () => number; asked: () => number } {
  let changed = 0, asked = 0;
  const made = new PaintedScene({ background: () => reads[asked++] ?? Promise.resolve(null), material: async () => null }, () => { changed++; });
  return { scene: made, changed: () => changed, asked: () => asked };
}

const heightOf = (made: PaintedScene): number | null => made.look('a', AREA)?.height(FAR, 5) ?? null;

test('a read that was in flight when the background was forgotten is dropped, and the next one is used', async () => {
  const old = deferred(), fresh = deferred();
  const { scene: made, changed, asked } = scene([old.promise, fresh.promise]);
  assert.equal(heightOf(made), null);
  made.forget('a');
  assert.equal(heightOf(made), null);
  assert.equal(asked(), 2, 'forgetting lets the background be read again at once');
  old.done(background(3));
  await settle();
  assert.equal(heightOf(made), null, 'the old read is not drawn');
  assert.equal(changed(), 0);
  fresh.done(background(7));
  await settle();
  assert.equal(heightOf(made), 7);
  assert.equal(changed(), 1);
});

test('an old read that lands after the fresh one does not replace it', async () => {
  const old = deferred(), fresh = deferred();
  const { scene: made } = scene([old.promise, fresh.promise]);
  heightOf(made);
  made.forget('a');
  heightOf(made);
  fresh.done(background(7));
  await settle();
  old.done(background(3));
  await settle();
  assert.equal(heightOf(made), 7);
});

test('a read that failed is tried again on the next draw, without forgetting, and said once', async () => {
  const first = deferred(), second = deferred();
  const warnings: unknown[][] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const { scene: made, changed, asked } = scene([first.promise, second.promise]);
    assert.equal(heightOf(made), null);
    first.fail();
    await settle();
    assert.equal(changed(), 0, 'a failure does not ask for another draw (it would read again for ever)');
    assert.equal(heightOf(made), null);
    assert.equal(asked(), 2, 'the next draw reads it again');
    second.done(background(5));
    await settle();
    assert.equal(heightOf(made), 5);
    assert.equal(changed(), 1);
    assert.equal(warnings.length, 1);
  } finally { console.warn = warn; }
});

test('a background the host answers null for is not kept as missing either', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const gone = deferred(), back = deferred();
    const { scene: made } = scene([gone.promise, back.promise]);
    heightOf(made);
    gone.done(null);
    await settle();
    assert.equal(heightOf(made), null);
    back.done(background(4));
    await settle();
    assert.equal(heightOf(made), 4);
  } finally { console.warn = warn; }
});

test('a read that lands after the scene was put away is ignored', async () => {
  const late = deferred();
  const { scene: made, changed } = scene([late.promise]);
  heightOf(made);
  made.dispose();
  late.done(background(3));
  await settle();
  assert.equal(changed(), 0);
  assert.equal(made.liquids.size, 0);
});
