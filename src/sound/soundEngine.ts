import { CATALOG, type SoundId } from './catalog';
import { placeAt, type Listener } from './placement';
import { DEFAULT_SOUND_SETTINGS, SOUND_GROUPS, type SoundGroup, type SoundSettings } from './soundSettings';

export type { Listener } from './placement';
export type { SoundId } from './catalog';

export interface PlayOptions {
  /** Where the sound happens, in board space. Without it the sound is not placed. */
  at?: { x: number; y: number; z: number };
  gain?: number;
  rate?: number;
  delayMs?: number;
}

// The slices of the Web Audio API the engine uses, so a test can stand in for them.
interface ParamLike {
  value: number;
  cancelScheduledValues(time: number): unknown;
  setValueAtTime(value: number, time: number): unknown;
  linearRampToValueAtTime(value: number, time: number): unknown;
}
interface NodeLike { connect(to: unknown): unknown; disconnect(): void }
interface GainLike extends NodeLike { gain: ParamLike }
interface PannerLike extends NodeLike { pan: ParamLike }
interface SourceLike extends NodeLike {
  buffer: unknown;
  loop: boolean;
  playbackRate: { value: number };
  onended: (() => void) | null;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface ContextLike {
  state: string;
  currentTime: number;
  destination: unknown;
  resume(): Promise<void>;
  close(): Promise<void>;
  createGain(): GainLike;
  createStereoPanner(): PannerLike;
  createBufferSource(): SourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
}
export interface DocumentLike {
  hidden: boolean;
  addEventListener(type: string, listener: () => void, options?: boolean): void;
  removeEventListener(type: string, listener: () => void, options?: boolean): void;
}

type Loader = (id: SoundId) => Promise<ArrayBuffer[]>;

/** How long after the call a sound still plays once its file finishes decoding; later than that it is dropped. */
const LATE_START_MS = 300;
const EASE_SECONDS = 0.4;
const RATE_SPREAD = 0.04;
const GESTURES = ['pointerdown', 'keydown'];

interface Bank { buffers: unknown[] | null; ready: Promise<void> }

interface LoopState {
  id: SoundId;
  gain: number;
  source: SourceLike | null;
  node: GainLike | null;
}

/** The catalogue entry of `id`, or null for an id that is not in it (such as one built from vault data at run time). */
function knownEntry(id: SoundId): (typeof CATALOG)[SoundId] | null {
  return (CATALOG as Record<string, (typeof CATALOG)[SoundId] | undefined>)[id] ?? null;
}

const engines = new WeakMap<Window, SoundEngine>();

/**
 * Plays board sounds through one audio context. A sound is dropped, never queued, when the board is hidden, the
 * context has not been unlocked by a first gesture, or its group is off. Chain per sound:
 * source -> gain -> pan -> group gain -> master gain -> destination.
 */
export class SoundEngine {
  /** One engine per window, shared by every board in it; each `shared` call is balanced by one `dispose`. */
  static shared(win: Window, load: Loader): SoundEngine {
    const existing = engines.get(win);
    if (existing) { existing.holders++; return existing; }
    const Context = (win as unknown as { AudioContext: new () => ContextLike }).AudioContext;
    const engine = new SoundEngine(() => new Context(), win.document, load, () => Date.now(), () => engines.delete(win));
    engines.set(win, engine);
    return engine;
  }

  /** An engine over stand-in audio parts, for tests. `now` is the clock for the late-start rule, in ms. */
  static forTest(contextFactory: () => ContextLike, document: DocumentLike, load: Loader, now: () => number = () => Date.now()): SoundEngine {
    return new SoundEngine(contextFactory, document, load, now, () => {});
  }

  private holders = 1;
  private readonly context: ContextLike;
  private readonly master: GainLike;
  private readonly groupGains = new Map<SoundGroup, GainLike>();
  private readonly banks = new Map<SoundId, Bank>();
  private readonly loops = new Map<string, LoopState>();
  private settings: SoundSettings = DEFAULT_SOUND_SETTINGS;
  private listener: { listener: Listener; span: number } | null = null;
  private disposed = false;

  private constructor(
    contextFactory: () => ContextLike,
    private readonly document: DocumentLike,
    private readonly load: Loader,
    private readonly now: () => number,
    private readonly onDispose: () => void,
  ) {
    this.context = contextFactory();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    for (const group of SOUND_GROUPS) {
      const node = this.context.createGain();
      node.connect(this.master);
      this.groupGains.set(group, node);
    }
    this.configure(DEFAULT_SOUND_SETTINGS);
    for (const type of GESTURES) this.document.addEventListener(type, this.unlock, true);
    this.document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  /** Starts the context on the first gesture; a sound asked for before that is not played. */
  private readonly unlock = (): void => {
    if (this.context.state !== 'running') void this.context.resume().catch(() => {});
  };

  /** Loops go quiet while the board is hidden and come back when it is shown. */
  private readonly visibilityChanged = (): void => {
    for (const loop of this.loops.values()) this.easeLoop(loop);
  };

  play(id: SoundId, options: PlayOptions = {}): void {
    if (!this.canPlay(id)) return;
    const asked = this.now();
    const bank = this.bankFor(id);
    if (bank.buffers) { this.start(id, bank.buffers, options); return; }
    void bank.ready.then(() => {
      if (!bank.buffers || this.now() - asked > LATE_START_MS || !this.canPlay(id)) return;
      this.start(id, bank.buffers, options);
    });
  }

  /** Keeps the looping sound `id` going under `key` at `gain`, eased over 400 ms. `null` fades it out and stops it. */
  loop(key: string, id: SoundId | null, gain: number): void {
    if (this.disposed) return;
    if (id !== null && knownEntry(id) === null) return;
    const current = this.loops.get(key);
    if (id === null) {
      if (current) { this.fadeOut(current); this.loops.delete(key); }
      return;
    }
    if (current && current.id === id) {
      current.gain = gain;
      this.easeLoop(current);
      return;
    }
    if (current) this.fadeOut(current);
    const state: LoopState = { id, gain, source: null, node: null };
    this.loops.set(key, state);
    const bank = this.bankFor(id);
    void bank.ready.then(() => {
      if (this.disposed || this.loops.get(key) !== state || !bank.buffers) return;
      this.startLoop(state, bank.buffers);
    });
  }

  setListener(listener: Listener, span: number): void {
    this.listener = { listener, span };
  }

  configure(settings: SoundSettings): void {
    this.settings = settings;
    this.master.gain.value = settings.muted ? 0 : settings.volume;
    for (const group of SOUND_GROUPS) {
      const node = this.groupGains.get(group);
      if (node) node.gain.value = settings.groups[group] ? 1 : 0;
    }
  }

  dispose(): void {
    if (this.disposed || --this.holders > 0) return;
    this.disposed = true;
    for (const type of GESTURES) this.document.removeEventListener(type, this.unlock, true);
    this.document.removeEventListener('visibilitychange', this.visibilityChanged);
    for (const loop of this.loops.values()) loop.source?.stop();
    this.loops.clear();
    this.onDispose();
    void this.context.close().catch(() => {});
  }

  /** A sound plays only on a visible board, with an unlocked context, and when its group is on and the sound is not muted. */
  private canPlay(id: SoundId): boolean {
    if (this.disposed || this.document.hidden || this.context.state !== 'running') return false;
    const entry = knownEntry(id);
    return entry !== null && !this.settings.muted && this.settings.groups[entry.group];
  }

  private destinationFor(id: SoundId): GainLike {
    return this.groupGains.get(CATALOG[id].group) ?? this.master;
  }

  /** Asks for the files of `id` the first time it is needed, and decodes every variant that decodes. */
  private bankFor(id: SoundId): Bank {
    const known = this.banks.get(id);
    if (known) return known;
    const bank: Bank = { buffers: null, ready: Promise.resolve() };
    bank.ready = (async () => {
      try {
        const files = await this.load(id);
        const decoded = await Promise.all(files.map((file) => this.context.decodeAudioData(file).catch(() => null)));
        bank.buffers = decoded.filter((buffer) => buffer !== null && buffer !== undefined);
      } catch {
        bank.buffers = [];
      }
    })();
    this.banks.set(id, bank);
    return bank;
  }

  private start(id: SoundId, buffers: unknown[], options: PlayOptions): void {
    if (buffers.length === 0) return;
    const context = this.context;
    let gain = (options.gain ?? 1) * CATALOG[id].gain;
    let pan = 0;
    if (options.at && this.listener) {
      const placed = placeAt(this.listener.listener, options.at, this.listener.span);
      gain *= placed.gain;
      pan = placed.pan;
    }
    const source = context.createBufferSource();
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    source.playbackRate.value = (options.rate ?? 1) * (1 + (Math.random() * 2 - 1) * RATE_SPREAD);
    const level = context.createGain();
    level.gain.value = gain;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    source.connect(level);
    level.connect(panner);
    panner.connect(this.destinationFor(id));
    source.onended = () => { source.disconnect(); level.disconnect(); panner.disconnect(); };
    source.start(context.currentTime + (options.delayMs ?? 0) / 1000);
  }

  private startLoop(state: LoopState, buffers: unknown[]): void {
    if (buffers.length === 0) return;
    const context = this.context;
    const source = context.createBufferSource();
    source.buffer = buffers[Math.floor(Math.random() * buffers.length)];
    source.loop = true;
    const node = context.createGain();
    node.gain.value = 0;
    source.connect(node);
    node.connect(this.destinationFor(state.id));
    state.source = source;
    state.node = node;
    source.start();
    this.easeLoop(state);
  }

  private easeLoop(state: LoopState): void {
    if (state.node) this.ramp(state.node, this.document.hidden ? 0 : state.gain * CATALOG[state.id].gain);
  }

  private fadeOut(state: LoopState): void {
    const { source, node } = state;
    if (!source || !node) return;
    this.ramp(node, 0);
    source.stop(this.context.currentTime + EASE_SECONDS + 0.05);
    source.onended = () => { source.disconnect(); node.disconnect(); };
  }

  private ramp(node: GainLike, target: number): void {
    const at = this.context.currentTime;
    node.gain.cancelScheduledValues(at);
    node.gain.setValueAtTime(node.gain.value, at);
    node.gain.linearRampToValueAtTime(target, at + EASE_SECONDS);
  }
}
