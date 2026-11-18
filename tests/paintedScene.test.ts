import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_BACKGROUND, emptyLayers, TERRAINS, type LoadedBackground } from '../src/background/backgroundData';
import * as THREE from 'three';
import type { LoadedMini } from '../src/library';
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

test('on a player board only the current background stays read: others are evicted', async () => {
  let asked = 0;
  const made = new PaintedScene({ background: async () => { asked++; return background(2); }, material: async () => null }, () => {}, { keepOnlyCurrent: () => true });
  made.look('a', AREA);
  await settle();
  assert.ok(made.look('a', AREA));
  made.look('b', AREA);
  await settle();
  assert.ok(made.look('b', AREA));
  assert.equal(asked, 2);
  made.look('a', AREA);
  await settle();
  assert.equal(asked, 3, 'a was evicted when b was shown, so it is read again');
});

test('without that option every background read stays', async () => {
  let asked = 0;
  const made = new PaintedScene({ background: async () => { asked++; return background(2); }, material: async () => null }, () => {});
  made.look('a', AREA);
  await settle();
  made.look('b', AREA);
  await settle();
  made.look('a', AREA);
  assert.equal(asked, 2);
});

test('after a save the old background keeps being drawn until the fresh read arrives', async () => {
  const fresh = deferred();
  let asked = 0;
  const made = new PaintedScene({ background: () => (asked++ === 0 ? Promise.resolve(background(3)) : fresh.promise), material: async () => null }, () => {});
  heightOf(made);
  await settle();
  assert.equal(heightOf(made), 3);
  made.forget('a');
  assert.equal(heightOf(made), 3, 'no blank to the plain horizon in between');
  fresh.done(background(7));
  await settle();
  assert.equal(heightOf(made), 7);
});

test('a refreshed background that cannot be read any more is dropped, and the board is told once', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    let asked = 0, changed = 0;
    const made = new PaintedScene({ background: async () => (asked++ === 0 ? background(3) : null), material: async () => null }, () => { changed++; });
    heightOf(made);
    await settle();
    assert.equal(heightOf(made), 3);
    changed = 0;
    made.forget('a');
    assert.equal(heightOf(made), 3);
    await settle();
    assert.equal(changed, 1);
    assert.equal(heightOf(made), null);
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

// ── Props ─────────────────────────────────────────────────────────────────

/** A model of one box, a square across and tall. */
function box(): LoadedMini {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  return { scene: group, animations: [], footprint: 1, height: 1, triangles: 12, simplifiedFrom: null };
}

/** A background whose whole picture is painted with one brush choosing among `props`. */
function forested(props: string[]): LoadedBackground {
  const layers = emptyLayers(64);
  layers.props.fill(1);
  return { settings: { ...DEFAULT_BACKGROUND, props: [{ name: 'Forest', props, density: 20, scale: 1 }] }, layers, materials: [] };
}

interface Forested { made: PaintedScene; asked: string[]; forest: () => PaintedScene['forest'] }

/** A scene drawing `background`, loading its models with `load` (what `model` asked for is kept). */
function withProps(background: LoadedBackground, load: (path: string) => Promise<LoadedMini | null>, options: { modelStallMs?: number } = {}): Forested {
  const asked: string[] = [];
  const made = new PaintedScene({
    background: async () => background,
    material: async () => null,
    model: (path) => { asked.push(path); return load(path); },
    impostor: () => new THREE.Texture(),
  }, () => {}, options);
  return { made, asked, forest: () => made.forest };
}

/** Draws until the forest stands (or `ms` pass): the board draws again when told, as this does. */
async function standing(held: Forested, area: PaintedArea = AREA, ms = 1500): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    held.made.look('a', area);
    if (held.forest()) return;
    await settle();
  }
}

/** Every copy's matrix, as numbers, near and far: what stands where. */
function matrices(forest: NonNullable<PaintedScene['forest']>): number[][] {
  const out: number[][] = [];
  forest.object3d.traverse((node) => { if ((node as THREE.InstancedMesh).isInstancedMesh) out.push(Array.from((node as THREE.InstancedMesh).instanceMatrix.array)); });
  return out;
}

test('a brush model that never arrives does not hold the forest back: the others are drawn once it has stalled', async () => {
  const held = withProps(forested(['a', 'never']), (path) => (path === 'a' ? Promise.resolve(box()) : new Promise<LoadedMini | null>(() => {})), { modelStallMs: 60 });
  await standing(held);
  const forest = held.forest();
  assert.ok(forest, 'the forest stands');
  assert.ok(forest.counts.models + forest.counts.impostors > 100, JSON.stringify(forest.counts));
  held.made.dispose();
});

test('a brush with a missing model places as many props as the same brush without it, every one with a model that is there', async () => {
  const gm = withProps(forested(['a', 'gone']), async (path) => (path === 'a' ? box() : null));
  const connect = withProps(forested(['a']), async () => box());
  await standing(gm);
  await standing(connect);
  const one = gm.forest(), other = connect.forest();
  assert.ok(one && other);
  assert.ok(other.counts.models + other.counts.impostors > 100);
  assert.deepEqual(one.counts, other.counts, 'the missing model costs no density');
  assert.deepEqual(matrices(one), matrices(other), 'the same props stand in the same places');
  gm.made.dispose();
  connect.made.dispose();
});

test('a brush left with no model places nothing, and the other brushes still do', async () => {
  const layers = emptyLayers(64);
  layers.props.fill(1);
  for (let j = 0; j < 64; j++) for (let i = 32; i < 64; i++) layers.props[j * 64 + i] = 2;
  const settings = { ...DEFAULT_BACKGROUND, props: [{ name: 'Lost', props: ['gone'], density: 20, scale: 1 }, { name: 'Found', props: ['a'], density: 20, scale: 1 }] };
  const held = withProps({ settings, layers, materials: [] }, async (path) => (path === 'a' ? box() : null));
  await standing(held);
  const forest = held.forest();
  assert.ok(forest && forest.counts.models + forest.counts.impostors > 50);
  held.made.dispose();
});

test('a change of reach alone (the fog slider) keeps the forest: no model asked again, the same forest', async () => {
  const held = withProps(forested(['a']), async () => box());
  await standing(held, { ...AREA, reach: 20000 });
  const first = held.forest();
  assert.ok(first);
  const asked = held.asked.length;
  held.made.look('a', { ...AREA, reach: 30000 });
  await settle();
  assert.equal(held.forest(), first, 'the same forest stands');
  assert.equal(held.asked.length, asked, 'no model was asked for again');
  assert.equal(held.made.object3d.children.filter((child) => child.name === 'painted-props').length, 1);
  // A change that does move the props (the map's size) builds another.
  held.made.look('a', { ...AREA, width: 1400, reach: 30000 });
  await standing({ ...held, forest: () => (held.forest() !== first ? held.forest() : null) });
  assert.notEqual(held.forest(), first);
  held.made.dispose();
});
