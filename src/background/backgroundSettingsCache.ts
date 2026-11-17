import type { BackgroundSettings } from './backgroundData';

/**
 * The settings of the painted backgrounds that Connect's look names, kept as last read. A background is asked for
 * while the look is built, so an unread one answers null and is read in the background; `filled` is called when one
 * lands, so the look is built and sent again.
 */
export class BackgroundSettingsCache {
  private readonly kept = new Map<string, BackgroundSettings>();
  private readonly asking = new Set<string>();
  /** Counts the clears: a read started before one is out of date when it lands. */
  private generation = 0;

  constructor(
    private readonly read: (folder: string) => Promise<BackgroundSettings | null>,
    private readonly filled: () => void,
  ) {}

  /** The settings of the background in `folder`, or null while they are being read (or when there are none to read). */
  get(folder: string): BackgroundSettings | null {
    const have = this.kept.get(folder);
    if (have) return have;
    if (this.asking.has(folder)) return null;
    this.asking.add(folder);
    const generation = this.generation;
    void this.read(folder).then((settings) => {
      if (generation !== this.generation) return;
      this.asking.delete(folder);
      // Nothing there (gone, or mid-save): not kept, so the next look reads it again.
      if (!settings) return;
      this.kept.set(folder, settings);
      this.filled();
    }).catch((error: unknown) => {
      if (generation === this.generation) this.asking.delete(folder);
      console.warn('[Tabletop] Could not read a painted background for Connect:', error);
    });
    return null;
  }

  /** Forgets everything read (a background was saved, renamed or removed); reads under way are dropped when they land. */
  clear(): void {
    this.generation += 1;
    this.kept.clear();
    this.asking.clear();
  }
}
