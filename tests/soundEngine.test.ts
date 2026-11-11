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
  const { context, engine } = setup();
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
