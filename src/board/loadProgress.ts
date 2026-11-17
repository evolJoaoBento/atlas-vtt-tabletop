/**
 * How far along a board is with what it is loading (a map's image, token art, minis, props, materials): a batch is
 * opened when a map is loaded, and every file asked for while it is open counts in it, by weight. The batch closes once
 * nothing has been pending for a moment (what a map asks for just after it is drawn still counts), or when nothing has
 * come for a long time (a file that never arrives does not hold it open). The time left is worked out from the rate
 * the batch has gone at so far. Pure (the clock is given), so it is tested without a board.
 */

/** How long nothing may be pending before the batch is over, in milliseconds. */
export const SETTLE_MS = 300;
/** How long the batch waits on with nothing arriving before it gives up showing, in milliseconds. */
export const STALL_MS = 30_000;

export interface LoadState {
  /** A batch is going on. */
  open: boolean;
  /** How much of it is in, 0 to 1 (1 with nothing asked yet). */
  fraction: number;
  /** Files in, and asked for, in the batch. */
  done: number;
  total: number;
  /** Milliseconds left, at the rate so far; null until something has come in. */
  remainingMs: number | null;
  /** Milliseconds since the batch opened. */
  elapsedMs: number;
}

const CLOSED: LoadState = { open: false, fraction: 1, done: 0, total: 0, remainingMs: 0, elapsedMs: 0 };

export class LoadProgress {
  private openedAt: number | null = null;
  /** Which batch this is: a file of an earlier one counts no more. */
  private batch = 0;
  private lastChange = 0;
  private weightAsked = 0;
  private weightIn = 0;
  private asked = 0;
  private arrived = 0;
  private pending = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** Starts a batch (a map is being loaded); one going on goes on. */
  open(): void {
    if (this.openedAt === null) {
      this.batch += 1;
      this.openedAt = this.clock();
      this.lastChange = this.openedAt;
      this.weightAsked = this.weightIn = this.asked = this.arrived = this.pending = 0;
    }
    this.notify();
  }

  /** Counts `work` in the batch going on, if one is (else it is let be); `weight` is how long it takes against others. */
  track<T>(work: Promise<T>, weight = 1): Promise<T> {
    if (this.openedAt === null) return work;
    const batch = this.batch;
    this.weightAsked += weight;
    this.asked += 1;
    this.pending += 1;
    this.lastChange = this.clock();
    this.notify();
    const settle = (): void => {
      // A file of a batch that is over counts no more.
      if (this.openedAt === null || this.batch !== batch) return;
      this.pending -= 1;
      this.weightIn += weight;
      this.arrived += 1;
      this.lastChange = this.clock();
      this.notify();
    };
    work.then(settle, settle);
    return work;
  }

  /** The batch as it stands now; one that is over is closed here. */
  state(): LoadState {
    if (this.openedAt === null) return CLOSED;
    const now = this.clock();
    const idle = now - this.lastChange;
    if ((this.pending === 0 && idle >= SETTLE_MS) || idle >= STALL_MS) {
      this.openedAt = null;
      return CLOSED;
    }
    const elapsedMs = now - this.openedAt;
    const fraction = this.weightAsked > 0 ? this.weightIn / this.weightAsked : 1;
    const rate = this.weightIn > 0 && elapsedMs > 0 ? this.weightIn / elapsedMs : null;
    const remainingMs = this.pending === 0 ? 0 : rate ? (this.weightAsked - this.weightIn) / rate : null;
    return { open: true, fraction, done: this.arrived, total: this.asked, remainingMs, elapsedMs };
  }

  /** Called when a batch opens or a file of it is asked for or comes in. Returns the stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The time left as a person reads it. */
export function timeLeft(remainingMs: number | null): string {
  if (remainingMs === null) return 'working out the time left';
  const seconds = remainingMs / 1000;
  if (seconds < 1.5) return 'almost done';
  if (seconds < 60) return `about ${Math.round(seconds)} s left`;
  const minutes = Math.floor(seconds / 60), rest = Math.round(seconds % 60);
  return rest === 0 || minutes >= 10 ? `about ${Math.round(seconds / 60)} min left` : `about ${minutes} min ${rest} s left`;
}
