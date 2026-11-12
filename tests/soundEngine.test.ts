import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG } from '../src/sound/catalog';
import { SoundEngine, type ContextLike, type DocumentLike } from '../src/sound/soundEngine';
import { DEFAULT_SOUND_SETTINGS, readSoundSettings } from '../src/sound/soundSettings';

class FakeParam {
  ramps: Array<{ value: number; at: number }> = [];
  constructor(public value = 1) {}
  cancelScheduledValues() {}
  setValueAtTime() {}
  linearRampToValueAtTime(value: number, at: number) { this.ramps.push({ value, at }); }
}
class FakeNode {
  connections: unknown[] = [];
  connect(to: unknown) { this.connections.push(to); }
  disconnect() {}
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(0); }
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  starts: Array<number | undefined> = [];
  stops: Array<number | undefined> = [];
  start(when?: number) { this.starts.push(when); }
  stop(when?: number) { this.stops.push(when); }
}

/** A stand-in audio context that records what the engine builds and starts. */
class FakeContext implements ContextLike {
  state = 'running';
  currentTime = 10;
  destination = { name: 'destination' };
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  panners: FakePanner[] = [];
  resumed = 0;
  closed = false;
  async resume() { this.resumed++; this.state = 'running'; }
  async close() { this.closed = true; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node; }
  createBufferSource() { const node = new FakeSource(); this.sources.push(node); return node; }
  async decodeAudioData(data: ArrayBuffer) { return { decoded: data.byteLength }; }
  get started() { return this.sources.filter((source) => source.starts.length > 0); }
}

class FakeDocument implements DocumentLike {
  hidden = false;
  handlers = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)?.add(listener);
  }
  removeEventListener(type: string, listener: () => void) { this.handlers.get(type)?.delete(listener); }
  fire(type: string) { for (const handler of [...(this.handlers.get(type) ?? [])]) handler(); }
  listening() { let count = 0; for (const set of this.handlers.values()) count += set.size; return count; }
}

const files = async () => [new ArrayBuffer(4), new ArrayBuffer(8)];
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(options: { state?: string; load?: (id: string) => Promise<ArrayBuffer[]>; now?: () => number } = {}) {
  const context = new FakeContext();
  if (options.state) context.state = options.state;
  const document = new FakeDocument();
  const loaded: string[] = [];
  const loader = options.load ?? (async (id: string) => { loaded.push(id); return files(); });
  const engine = SoundEngine.forTest(() => context, document, loader, options.now);
  return { context, document, engine, loaded };
}

test('plays once loaded', async () => {
  const { context, engine, loaded } = setup();
  engine.play('dice.hit');
  assert.equal(context.started.length, 0);
  await settle();
  assert.equal(context.started.length, 1);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 2);
  assert.deepEqual(loaded, ['dice.hit']);
});

test('a sound that is only decoded after 300 ms is dropped', async () => {
  let clock = 0;
  const { context, engine } = setup({ now: () => clock, load: async () => { clock += 400; return files(); } });
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 0);
  engine.play('dice.hit');
  assert.equal(context.started.length, 1);
});

test('hidden plays nothing, queues nothing', async () => {
  const { context, document, engine } = setup();
  engine.play('dice.hit');
  await settle();
  const before = context.started.length;
  document.hidden = true;
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, before);
  document.hidden = false;
  document.fire('visibilitychange');
  await settle();
  assert.equal(context.started.length, before);
});

test('a sound that becomes hidden while decoding is dropped', async () => {
  const { context, document, engine } = setup();
  engine.play('dice.hit');
  document.hidden = true;
  await settle();
  assert.equal(context.started.length, 0);
});

test('resume on first gesture', async () => {
  const { context, document, engine } = setup({ state: 'suspended' });
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 0);
  document.fire('pointerdown');
  await settle();
  assert.equal(context.resumed, 1);
  assert.equal(context.started.length, 0);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 1);
});

test('settings gate: a group off or muted starts nothing, and the volume scales the master gain', async () => {
  const { context, engine } = setup();
  const master = context.gains[0];
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, volume: 0.3 });
  assert.equal(master.gain.value, 0.3);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, groups: { ...DEFAULT_SOUND_SETTINGS.groups, dice: false } });
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 0);
  engine.play('mini.pickup');
  await settle();
  assert.equal(context.started.length, 1);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, muted: true });
  assert.equal(master.gain.value, 0);
  engine.play('mini.pickup');
  await settle();
  assert.equal(context.started.length, 1);
});

test('a sound is placed by the listener and routed through its group gain', async () => {
  const { context, engine } = setup({ now: () => 0 });
  engine.setListener({ eye: { x: 0, y: 100, z: 200 }, target: { x: 0, y: 0, z: 0 } }, 100);
  engine.play('dice.hit');
  await settle();
  engine.play('dice.hit', { at: { x: 5000, y: 0, z: 0 }, gain: 0.5, delayMs: 100 });
  await settle();
  const placed = context.started[1];
  assert.equal(placed.starts[0], 10.1);
  assert.ok(context.panners[1].pan.value > 0.59 && context.panners[1].pan.value <= 0.6);
  assert.equal(context.gains[context.gains.length - 1].gain.value, 0.5 * CATALOG['dice.hit'].gain * 0.15);
  assert.equal(context.panners[0].pan.value, 0);
  assert.notEqual(context.panners[1].connections[0], context.gains[0]);
});

test('loop eases', async () => {
  const { context, engine } = setup();
  engine.loop('w', 'water.ripples', 0.5);
  await settle();
  assert.equal(context.started.length, 1);
  const source = context.started[0];
  assert.equal(source.loop, true);
  const node = context.gains[context.gains.length - 1];
  assert.deepEqual(node.gain.ramps.at(-1), { value: 0.5 * CATALOG['water.ripples'].gain, at: 10.4 });
  engine.loop('w', 'water.ripples', 0.2);
  assert.equal(context.sources.length, 1);
  assert.deepEqual(node.gain.ramps.at(-1), { value: 0.2 * CATALOG['water.ripples'].gain, at: 10.4 });
  engine.loop('w', null, 0);
  assert.deepEqual(node.gain.ramps.at(-1), { value: 0, at: 10.4 });
  assert.equal(source.stops.length, 1);
  assert.ok((source.stops[0] ?? 0) >= 10.4);
});

test('a loop stopped before its file decodes never starts', async () => {
  const { context, engine } = setup();
  engine.loop('w', 'water.ripples', 0.5);
  engine.loop('w', null, 0);
  await settle();
  assert.equal(context.started.length, 0);
});

test('loops go silent while the board is hidden and return when shown', async () => {
  const { context, document, engine } = setup();
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  const node = context.gains[context.gains.length - 1];
  document.hidden = true;
  document.fire('visibilitychange');
  assert.equal(node.gain.ramps.at(-1)?.value, 0);
  document.hidden = false;
  document.fire('visibilitychange');
  assert.equal(node.gain.ramps.at(-1)?.value, 0.5 * CATALOG['water.flow'].gain);
});

test('a file that fails to load plays nothing and is not asked for again', async () => {
  let asked = 0;
  const { context, engine } = setup({ load: async () => { asked++; throw new Error('missing'); } });
  engine.play('dice.hit');
  await settle();
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 0);
  assert.equal(asked, 1);
});

test('dispose closes the context and stops listening', async () => {
  const { context, document, engine } = setup();
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  assert.ok(document.listening() > 0);
  engine.dispose();
  assert.equal(document.listening(), 0);
  assert.equal(context.closed, true);
  assert.equal(context.started[0].stops.length, 1);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 1);
});

test('readSoundSettings fills in defaults and clamps the volume', () => {
  const read = readSoundSettings({ volume: 7, groups: { dice: false } });
  assert.equal(read.volume, 1);
  assert.equal(read.groups.dice, false);
  assert.equal(read.groups.water, true);
  assert.equal(read.muted, false);
  assert.deepEqual(readSoundSettings(null), DEFAULT_SOUND_SETTINGS);
  assert.deepEqual(readSoundSettings({ volume: 'loud', muted: 'yes', groups: 3 }), DEFAULT_SOUND_SETTINGS);
  assert.equal(readSoundSettings({ volume: -2, muted: true }).volume, 0);
  assert.equal(readSoundSettings({ muted: true }).muted, true);
});

test('the catalogue gain is the base level, multiplied by the caller gain', async () => {
  const { context, engine } = setup();
  engine.play('turn.horn', { gain: 0.5 });
  await settle();
  assert.equal(context.gains[context.gains.length - 1].gain.value, 0.5 * CATALOG['turn.horn'].gain);
  engine.play('turn.horn');
  await settle();
  assert.equal(context.gains[context.gains.length - 1].gain.value, CATALOG['turn.horn'].gain);
});

test('the catalogue decides the group: the doors toggle silences walls too', async () => {
  const { context, engine } = setup();
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, groups: { ...DEFAULT_SOUND_SETTINGS.groups, doors: false } });
  engine.play('wall.crumble');
  engine.play('door.open');
  await settle();
  assert.equal(context.started.length, 0);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 1);
});

test('an id that is not in the catalogue is a silent no-op', async () => {
  const { context, engine, loaded } = setup();
  const unknown = 'spell.impact.nonsense' as unknown as Parameters<typeof engine.play>[0];
  engine.play(unknown);
  engine.loop('x', unknown, 0.5);
  await settle();
  assert.equal(context.started.length, 0);
  assert.deepEqual(loaded, []);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 1);
});

test('a touch or a pointer release unlocks the context, not only a key', async () => {
  for (const gesture of ['pointerup', 'touchend', 'keydown']) {
    const { context, document } = setup({ state: 'suspended' });
    document.fire(gesture);
    await settle();
    assert.equal(context.resumed, 1, gesture);
  }
});

test('shared engine is null where the window has no audio', () => {
  const win = { document: new FakeDocument() } as unknown as Window;
  assert.equal(SoundEngine.shared(win, files), null);
  const broken = { document: new FakeDocument(), AudioContext: class { constructor() { throw new Error('no audio'); } } } as unknown as Window;
  assert.equal(SoundEngine.shared(broken, files), null);
});

test('a loop for a group that is off or muted starts no source, and starts when switched on', async () => {
  const { context, engine } = setup();
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, groups: { ...DEFAULT_SOUND_SETTINGS.groups, water: false } });
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  assert.equal(context.started.length, 0);
  engine.configure(DEFAULT_SOUND_SETTINGS);
  assert.equal(context.started.length, 1);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, muted: true });
  assert.equal(context.started[0].stops.length, 1);
  engine.configure(DEFAULT_SOUND_SETTINGS);
  assert.equal(context.started.length, 2);
});

test('a loop switched off by its group stops its running source', async () => {
  const { context, engine } = setup();
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  assert.equal(context.started.length, 1);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, groups: { ...DEFAULT_SOUND_SETTINGS.groups, water: false } });
  assert.equal(context.started[0].stops.length, 1);
});

test('shared engines are counted per window: the last dispose closes the context and a later shared makes a new one', async () => {
  const contexts: FakeContext[] = [];
  const win = { document: new FakeDocument(), AudioContext: class extends FakeContext { constructor() { super(); contexts.push(this); } } } as unknown as Window;
  const first = SoundEngine.shared(win, files);
  const second = SoundEngine.shared(win, files);
  assert.equal(first, second);
  first?.dispose();
  assert.equal(contexts[0].closed, false);
  second?.dispose();
  await settle();
  assert.equal(contexts[0].closed, true);
  assert.equal((win as unknown as { document: FakeDocument }).document.listening(), 0);
  const third = SoundEngine.shared(win, files);
  assert.notEqual(third, first);
  assert.equal(contexts.length, 2);
  third?.dispose();
});

test('sounds asked while the audio clock stands still keep their spacing instead of all starting on one instant', async () => {
  // Right after the output device wakes from silence the clock can stand still for about a second.
  let wall = 1000;
  const { context, engine } = setup({ now: () => wall });
  engine.play('dice.hit');
  await settle();
  for (const advance of [0, 55, 55, 55]) { wall += advance; engine.play('dice.hit'); }
  const starts = context.started.map((source) => source.starts[0] ?? NaN);
  assert.deepEqual(starts.map((at) => Math.round((at - 10) * 1000)), [0, 0, 55, 110, 165]);
});

test('with the audio clock running, sounds start at the clock and a gap in the calls starts the spacing afresh', async () => {
  let wall = 1000;
  const { context, engine } = setup({ now: () => wall });
  engine.play('dice.hit');
  await settle();
  context.currentTime = 11; wall += 55; engine.play('dice.hit');
  // The clock stood still for a long gap between two calls: the second is not pushed a minute late.
  context.currentTime = 11; wall += 60_000; engine.play('dice.hit');
  const starts = context.started.map((source) => source.starts[0] ?? NaN);
  assert.deepEqual(starts.map((at) => Math.round(at * 1000) / 1000), [10, 11, 11]);
});

test('warm decodes every one-shot once, plays nothing and leaves loops to their first use', async () => {
  const { context, engine, loaded } = setup();
  await engine.warm();
  assert.equal(context.started.length, 0);
  const oneShots = Object.keys(CATALOG).filter((id) => !CATALOG[id as keyof typeof CATALOG].loop);
  assert.deepEqual([...loaded].sort(), oneShots.sort());
  engine.play('door.open');
  assert.equal(context.started.length, 1);
});

test('a delay asked of a sound is kept on top of the spacing while the audio clock stands still', async () => {
  let wall = 1000;
  const { context, engine } = setup({ now: () => wall });
  engine.play('dice.hit');
  await settle();
  wall += 55; engine.play('dice.hit', { delayMs: 100 });
  wall += 55; engine.play('dice.hit', { delayMs: 100 });
  const starts = context.started.map((source) => source.starts[0] ?? NaN);
  assert.deepEqual(starts.map((at) => Math.round((at - 10) * 1000)), [0, 155, 210]);
});
