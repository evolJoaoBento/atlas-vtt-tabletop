import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG } from '../src/sound/catalog';
import { compressorMakeupGain } from '../src/sound/limiter';
import { SoundEngine, type ContextLike, type DocumentLike } from '../src/sound/soundEngine';
import { DEFAULT_SOUND_SETTINGS, readSoundSettings, SOUND_GROUPS } from '../src/sound/soundSettings';

class FakeParam {
  ramps: Array<{ value: number; at: number }> = [];
  targets: Array<{ value: number; at: number; constant: number }> = [];
  constructor(public value = 1) {}
  cancelScheduledValues() {}
  setValueAtTime() {}
  linearRampToValueAtTime(value: number, at: number) { this.ramps.push({ value, at }); }
  setTargetAtTime(value: number, at: number, constant: number) { this.targets.push({ value, at, constant }); }
}
class FakeNode {
  connections: unknown[] = [];
  connect(to: unknown) { this.connections.push(to); }
  disconnect() {}
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakePanner extends FakeNode { pan = new FakeParam(0); }
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}
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
  compressors: FakeCompressor[] = [];
  resumed = 0;
  closed = false;
  async resume() { this.resumed++; this.state = 'running'; }
  async close() { this.closed = true; }
  createGain() { const node = new FakeGain(); this.gains.push(node); return node; }
  createStereoPanner() { const node = new FakePanner(); this.panners.push(node); return node; }
  createDynamicsCompressor() { const node = new FakeCompressor(); this.compressors.push(node); return node; }
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

function setup(options: { state?: string; load?: (id: string) => Promise<ArrayBuffer[]>; now?: () => number; context?: FakeContext } = {}) {
  const context = options.context ?? new FakeContext();
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
  assert.equal(master.gain.targets.at(-1)?.value, 0.3);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, groups: { ...DEFAULT_SOUND_SETTINGS.groups, dice: false } });
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 0);
  engine.play('mini.pickup');
  await settle();
  assert.equal(context.started.length, 1);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, muted: true });
  assert.equal(master.gain.targets.at(-1)?.value, 0);
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

test('a volume or group change glides the gain over a few milliseconds instead of jumping (no zipper clicks)', () => {
  const { context, engine } = setup();
  const master = context.gains[0];
  const dice = context.gains[1 + SOUND_GROUPS.indexOf('dice')];
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, volume: 0.9, groups: { ...DEFAULT_SOUND_SETTINGS.groups, dice: false } });
  assert.deepEqual(master.gain.targets.at(-1), { value: 0.9, at: 10, constant: 0.02 });
  assert.deepEqual(dice.gain.targets.at(-1), { value: 0, at: 10, constant: 0.02 });
});

test('a peak limiter sits between the master gain and the speakers, so a loud pile of sounds does not clip', () => {
  const { context } = setup();
  const master = context.gains[0];
  const limiter = context.compressors[0];
  assert.ok(limiter, 'a compressor is made');
  assert.deepEqual(master.connections, [limiter]);
  assert.equal(limiter.threshold.value, -3);
  assert.equal(limiter.ratio.value, 20);
  assert.equal(limiter.knee.value, 0);
  assert.equal(limiter.attack.value, 0.003);
  assert.equal(limiter.release.value, 0.25);
});

test('a fixed gain after the limiter takes back the make-up gain Chromium adds, so quiet sounds keep their level', () => {
  const { context } = setup();
  const limiter = context.compressors[0];
  const post = limiter.connections[0] as FakeGain;
  assert.deepEqual(post.connections, [context.destination]);
  // Chromium's make-up for a hard knee: 0.6 of the loss a full-scale input suffers, here 0.6 * 2.85 = 1.71 dB.
  assert.ok(Math.abs(compressorMakeupGain(-3, 20) - 1.2178) < 0.0005);
  assert.ok(Math.abs(post.gain.value - 0.8212) < 0.0005, `post gain ${post.gain.value}`);
  assert.ok(Math.abs(post.gain.value * compressorMakeupGain(-3, 20) - 1) < 1e-9);
});

test('without a compressor the master gain goes straight to the speakers', async () => {
  const context = new FakeContext();
  (context as unknown as { createDynamicsCompressor?: unknown }).createDynamicsCompressor = undefined;
  const { engine } = setup({ context });
  assert.deepEqual(context.gains[0].connections, [context.destination]);
  engine.play('dice.hit');
  await settle();
  assert.equal(context.started.length, 1);
});

test('the host decides whether its sound is heard: a hidden window still plays for a player window in view, and not for a board nobody sees', async () => {
  const { context, document, engine } = setup();
  engine.play('dice.hit');
  await settle();
  document.hidden = true;
  engine.play('dice.hit', {}, () => true);
  await settle();
  assert.equal(context.started.length, 2);
  document.hidden = false;
  engine.play('dice.hit', {}, () => false);
  await settle();
  assert.equal(context.started.length, 2);
});

test('a loop eases by the rule its host gives when the window visibility changes', async () => {
  const { context, document, engine } = setup();
  let shown = true;
  engine.loop('w', 'water.flow', 0.5, () => shown);
  await settle();
  const node = context.gains[context.gains.length - 1];
  assert.equal(node.gain.ramps.at(-1)?.value, 0.5 * CATALOG['water.flow'].gain);
  // The window hides, but the host's players' window is still in view: the loop keeps playing.
  document.hidden = true;
  document.fire('visibilitychange');
  assert.equal(node.gain.ramps.at(-1)?.value, 0.5 * CATALOG['water.flow'].gain);
  // Its rule now says nobody sees it: asked again, it eases to silence.
  shown = false;
  engine.loop('w', 'water.flow', 0.5, () => shown);
  assert.equal(node.gain.ramps.at(-1)?.value, 0);
  shown = true;
  document.hidden = false;
  document.fire('visibilitychange');
  assert.equal(node.gain.ramps.at(-1)?.value, 0.5 * CATALOG['water.flow'].gain);
});

test('a sound that fails to start never throws into the board', async () => {
  const context = new FakeContext();
  context.createBufferSource = () => { throw new Error('broken'); };
  const { engine } = setup({ context });
  engine.play('dice.hit');
  await settle();
  assert.doesNotThrow(() => engine.play('dice.hit'));
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  assert.doesNotThrow(() => engine.configure({ ...DEFAULT_SOUND_SETTINGS, muted: true }));
  assert.doesNotThrow(() => engine.configure(DEFAULT_SOUND_SETTINGS));
  assert.doesNotThrow(() => engine.loop('w', null, 0));
});

test('without a stereo panner a sound goes straight to its group gain', async () => {
  const context = new FakeContext();
  (context as unknown as { createStereoPanner?: unknown }).createStereoPanner = undefined;
  const { engine } = setup({ context });
  engine.setListener({ eye: { x: 0, y: 100, z: 200 }, target: { x: 0, y: 0, z: 0 } }, 100);
  engine.play('dice.hit', { at: { x: 50, y: 0, z: 0 } });
  await settle();
  assert.equal(context.started.length, 1);
  const level = context.gains[context.gains.length - 1];
  assert.deepEqual(level.connections, [context.gains[1 + SOUND_GROUPS.indexOf('dice')]]);
});

test('a sound is played at the level chosen for it, and only that sound', async () => {
  const { context, engine } = setup();
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, levels: { 'door.open': 0, 'dice.hit': 2 } });
  const levelOfLast = () => context.gains[context.gains.length - 1].gain.value;
  engine.play('door.open');
  engine.play('dice.hit');
  engine.play('door.shut');
  await settle();
  engine.play('door.open');
  assert.equal(levelOfLast(), 0);
  engine.play('dice.hit');
  assert.ok(Math.abs(levelOfLast() - CATALOG['dice.hit'].gain * 2) < 1e-9);
  engine.play('door.shut');
  assert.ok(Math.abs(levelOfLast() - CATALOG['door.shut'].gain) < 1e-9);
});

test('a loop follows the level chosen for its sound as soon as it changes', async () => {
  const { context, engine } = setup();
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  const node = context.gains[context.gains.length - 1];
  assert.equal(node.gain.ramps.at(-1)?.value, 0.5 * CATALOG['water.flow'].gain);
  engine.configure({ ...DEFAULT_SOUND_SETTINGS, levels: { 'water.flow': 1.5 } });
  assert.ok(Math.abs((node.gain.ramps.at(-1)?.value ?? 0) - 0.5 * CATALOG['water.flow'].gain * 1.5) < 1e-9);
});

test('invalidate drops the decoded files of one sound, so its next play loads afresh', async () => {
  const { context, engine, loaded } = setup();
  engine.play('dice.hit');
  engine.play('door.open');
  await settle();
  assert.deepEqual(loaded, ['dice.hit', 'door.open']);
  engine.invalidate('dice.hit');
  await settle();
  assert.deepEqual(loaded, ['dice.hit', 'door.open', 'dice.hit']);
  const before = context.started.length;
  engine.play('dice.hit');
  engine.play('door.open');
  assert.equal(context.started.length, before + 2);
  assert.deepEqual(loaded, ['dice.hit', 'door.open', 'dice.hit']);
});

test('invalidate swaps in the new files: what plays after is decoded from what the loader gives now', async () => {
  let size = 4;
  const { context, engine } = setup({ load: async () => [new ArrayBuffer(size)] });
  engine.play('dice.hit');
  await settle();
  assert.deepEqual(context.started[0].buffer, { decoded: 4 });
  size = 9;
  engine.invalidate('dice.hit');
  await settle();
  engine.play('dice.hit');
  assert.deepEqual(context.started.at(-1)?.buffer, { decoded: 9 });
});

test('invalidate restarts a playing loop on the new file, fading the old one out', async () => {
  let size = 4;
  const { context, engine } = setup({ load: async () => [new ArrayBuffer(size)] });
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  const first = context.sources[0];
  assert.deepEqual(first.buffer, { decoded: 4 });
  size = 9;
  engine.invalidate('water.flow');
  assert.equal(first.stops.length, 1, 'the old loop is told to stop after its fade');
  await settle();
  const second = context.sources.at(-1)!;
  assert.notEqual(second, first);
  assert.deepEqual(second.buffer, { decoded: 9 });
  assert.equal(second.loop, true);
  assert.equal(second.starts.length, 1);
});

test('invalidate of one sound leaves the loops of others alone', async () => {
  const { context, engine } = setup();
  engine.loop('w', 'water.flow', 0.5);
  await settle();
  const count = context.sources.length;
  engine.invalidate('dice.hit');
  await settle();
  assert.equal(context.sources.length, count);
  assert.equal(context.sources[0].stops.length, 0);
});

test('a custom file that does not decode is reported, and the built-in files play instead', async () => {
  const context = new FakeContext();
  context.decodeAudioData = async (data: ArrayBuffer) => { if (data.byteLength === 1) throw new Error('bad'); return { decoded: data.byteLength }; };
  const reports: unknown[] = [];
  const asked: boolean[] = [];
  const load = Object.assign(async (_id: string, builtIn = false) => { asked.push(builtIn); return builtIn ? [new ArrayBuffer(7)] : [new ArrayBuffer(1)]; }, {
    customFailed: (id: string, bad: number[], all: boolean) => { reports.push([id, bad, all]); },
  });
  const { engine } = setup({ context, load });
  engine.play('door.open');
  await settle();
  assert.deepEqual(reports, [['door.open', [0], true]]);
  assert.deepEqual(asked, [false, true]);
  engine.play('door.open');
  assert.deepEqual(context.started[0].buffer, { decoded: 7 });
});

test('with some custom variants good and one bad, the good ones play and the bad one is reported', async () => {
  const context = new FakeContext();
  context.decodeAudioData = async (data: ArrayBuffer) => { if (data.byteLength === 1) throw new Error('bad'); return { decoded: data.byteLength }; };
  const reports: unknown[] = [];
  const load = Object.assign(async () => [new ArrayBuffer(1), new ArrayBuffer(5)], { customFailed: (id: string, bad: number[], all: boolean) => { reports.push([id, bad, all]); } });
  const { engine } = setup({ context, load });
  engine.play('door.open');
  await settle();
  assert.deepEqual(reports, [['door.open', [0], false]]);
  assert.deepEqual(context.started[0].buffer, { decoded: 5 });
});

test('invalidateEverywhere reaches the engines made by shared, and no longer a disposed one', async () => {
  const context = new FakeContext();
  const win = { AudioContext: function () { return context; }, document: new FakeDocument(), setTimeout: () => 0 } as unknown as Window;
  const loaded: string[] = [];
  const engine = SoundEngine.shared(win, async (id) => { loaded.push(id); return files(); })!;
  engine.play('dice.hit');
  await settle();
  SoundEngine.invalidateEverywhere(['dice.hit']);
  await settle();
  assert.deepEqual(loaded, ['dice.hit', 'dice.hit']);
  engine.dispose();
  SoundEngine.invalidateEverywhere('all');
  await settle();
  assert.deepEqual(loaded, ['dice.hit', 'dice.hit']);
});
