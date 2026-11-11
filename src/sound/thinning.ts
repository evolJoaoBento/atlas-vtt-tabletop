/** Lets at most `cap` things through in any `windowMs`, so a big handful of dice hits does not clip. */
export class Thinner {
  private taken: number[] = [];

  constructor(private readonly cap: number, private readonly windowMs: number) {}

  take(nowMs: number): boolean {
    this.taken = this.taken.filter((at) => at > nowMs - this.windowMs);
    if (this.taken.length >= this.cap) return false;
    this.taken.push(nowMs);
    return true;
  }
}

/**
 * Start delays for `count` sounds meant to play as a group: the first at 0, each next one about `stepMs` later,
 * nudged by up to half of `jitterMs` either way so the gaps stay at least `stepMs - jitterMs`. Sorted.
 */
export function staggerOffsets(count: number, stepMs = 45, jitterMs = 15, random: () => number = Math.random): number[] {
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    offsets.push(i === 0 ? 0 : Math.max(0, i * stepMs + (random() - 0.5) * jitterMs));
  }
  return offsets.sort((a, b) => a - b);
}
