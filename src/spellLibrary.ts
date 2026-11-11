/**
 * The vault's spell notes, for the 3D board's spell search (`board/spellPicker.ts`): every Markdown note in a folder
 * whose name has "spell" in it (`SRD Spells/2014`, `Spells`, `Homebrew spells`, ...) that reads as a spell
 * (`board/spellNotes.ts`). Read on the first search, then kept as the vault changes. Where each comes from is its
 * folder's name: `2014`, `2024`, or the homebrew folder's.
 */
import { TFile, type App, type EventRef } from 'obsidian';
import { readSpellNote } from './board/spellNotes';
import type { SpellBook, SpellEntry } from './board/spellPicker';

/** Whether a note's folder makes it a spell note to read. */
export function inSpellFolder(path: string): boolean {
  const folders = path.split('/').slice(0, -1);
  return path.toLowerCase().endsWith('.md') && folders.some((folder) => /spell/i.test(folder));
}

/** A note's name as its spell is called: the name, without the set's year the note's file name may carry. */
const sourceOf = (path: string): string => {
  const folders = path.split('/').slice(0, -1);
  const last = folders[folders.length - 1] ?? '';
  return /^\d{4}$/.test(last) ? `SRD ${last}` : last;
};

/** The order spells come in for a search: names starting with it, then words starting with it, then the rest. */
export function searchSpells(entries: readonly SpellEntry[], query: string, limit = 40): SpellEntry[] {
  const words = query.trim().toLowerCase();
  const scored: Array<{ entry: SpellEntry; score: number }> = [];
  for (const entry of entries) {
    const name = entry.note.name.toLowerCase();
    let score: number;
    if (!words) score = 3;
    else if (name === words) score = 0;
    else if (name.startsWith(words)) score = 1;
    else if (name.split(/[\s'/-]+/).some((word) => word.startsWith(words))) score = 2;
    else if (name.includes(words)) score = 3;
    else continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.note.name.localeCompare(b.entry.note.name) || b.entry.source.localeCompare(a.entry.source));
  return scored.slice(0, limit).map((each) => each.entry);
}

export class SpellLibrary implements SpellBook {
  private readonly entries = new Map<string, SpellEntry>();
  private loading: Promise<void> | null = null;
  private readonly refs: EventRef[] = [];

  constructor(private readonly app: App) {}

  async search(query: string, limit = 40): Promise<SpellEntry[]> {
    await this.load();
    return searchSpells([...this.entries.values()], query, limit);
  }

  /** How many spell notes there are (once read). */
  get size(): number {
    return this.entries.size;
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      const files = this.app.vault.getMarkdownFiles().filter((file) => inSpellFolder(file.path));
      await Promise.all(files.map((file) => this.read(file)));
      const vault = this.app.vault;
      this.refs.push(
        vault.on('modify', (file) => { if (file instanceof TFile) void this.read(file); }),
        vault.on('create', (file) => { if (file instanceof TFile) void this.read(file); }),
        vault.on('delete', (file) => { this.entries.delete(file.path); }),
        vault.on('rename', (file, old) => { this.entries.delete(old); if (file instanceof TFile) void this.read(file); }),
      );
    })();
    return this.loading;
  }

  private async read(file: TFile): Promise<void> {
    if (!inSpellFolder(file.path)) { this.entries.delete(file.path); return; }
    try {
      const note = readSpellNote(await this.app.vault.cachedRead(file), file.basename.replace(/\s*\(\d{4}\)$/, ''));
      if (note) this.entries.set(file.path, { id: file.path, note, source: sourceOf(file.path) });
      else this.entries.delete(file.path);
    } catch {
      this.entries.delete(file.path);
    }
  }

  dispose(): void {
    for (const ref of this.refs) this.app.vault.offref(ref);
    this.refs.length = 0;
  }
}
