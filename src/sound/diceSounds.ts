import { Thinner } from './thinning';
import type { PlayOptions, SoundId } from './soundEngine';

/** A point in board space. */
interface Point { x: number; y: number; z: number }

/** The sound of a die hitting something at `speed` (die edges a second along the contact), or null when too soft to hear. */
export function hitSound(dieType: string, speed: number): { gain: number; rate: number } | null {
  if (speed < 0.4) return null;
  const gain = Math.min(1, 0.15 + ((speed - 0.4) / (8 - 0.4)) * 0.85);
  return { gain, rate: RATES[dieType] ?? 1 };
}

/** Smaller dice ring higher. */
const RATES: Record<string, number> = { d4: 1.15, d6: 1.05, d8: 1.08, d10: 1.0, d12: 0.96, d20: 0.92, d100: 1.0 };

/** What a dice table reports, which wiring turns into sounds. (The table also reports the rolling speed; no sound follows it.) */
export interface DiceSoundSource {
  onHit: (dieType: string, speed: number, at: Point) => void;
  onCaught: (at: Point) => void;
}

/** Where the sounds go: a board's `sound`. */
export interface DiceSoundSink {
  sound(id: SoundId, options?: PlayOptions): void;
}

/**
 * Makes a dice table's hits and caught dice heard on a board; the clacks alone carry the roll. At most six clacks in
 * any 50 ms get through (`now` is the clock for that, in ms), so a big handful of dice does not clip.
 */
export function wireDiceSounds(table: DiceSoundSource, sink: DiceSoundSink, now: () => number = () => performance.now()): void {
  const thinner = new Thinner(6, 50);
  table.onHit = (dieType, speed, at) => {
    const hit = hitSound(dieType, speed);
    if (!hit || !thinner.take(now())) return;
    sink.sound('dice.hit', { at, gain: hit.gain, rate: hit.rate });
  };
  table.onCaught = (at) => sink.sound('dice.caught', { at });
}
