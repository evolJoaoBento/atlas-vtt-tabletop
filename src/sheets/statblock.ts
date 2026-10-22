/**
 * The stat block a token links, as the creature it describes: the Fantasy Statblocks bestiary entry of the note
 * (`FantasyStatblocks`, once its bestiary is resolved), else the note's own fields (its `statblock` block with its
 * frontmatter laid over it), else the bestiary creature of the token's statblock name. What comes back is the
 * creature as is; the sheet whitelists it (`sheet.ts`). Ported from Atlas VTT Connect (MIT, `statblockSource.ts`).
 */
import { parseYaml, TFile, type App } from 'obsidian';

interface FantasyStatblocksApi {
  isResolved?(): boolean;
  getBestiaryCreatures?(): unknown;
  hasCreature?(name: string): boolean;
  getCreatureFromBestiary?(name: string): unknown;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

function api(): FantasyStatblocksApi | null {
  const found = (window as { FantasyStatblocks?: unknown }).FantasyStatblocks;
  return isObject(found) ? found : null;
}

function resolved(statblocks: FantasyStatblocksApi | null): statblocks is FantasyStatblocksApi {
  try {
    return statblocks?.isResolved?.() === true;
  } catch {
    return false;
  }
}

function fromBestiary(read: (statblocks: FantasyStatblocksApi) => unknown): unknown {
  const statblocks = api();
  if (!resolved(statblocks)) return null;
  try {
    return read(statblocks) ?? null;
  } catch {
    return null;
  }
}

/** The path of the note, without a heading (`note.md#Goblin`). */
const notePath = (path: string): string => path.split('#')[0] ?? path;

/** A note's `statblock` block, its frontmatter and its name; null when it is no note. */
async function readNote(app: App, path: string): Promise<{ name: string; front?: Rec; block?: Rec } | null> {
  const file = app.vault.getAbstractFileByPath(notePath(path));
  if (!(file instanceof TFile)) return null;
  const front = app.metadataCache.getFileCache(file)?.frontmatter;
  let block: Rec | undefined;
  const match = /```statblock[^\n]*\n([\s\S]*?)```/.exec(await app.vault.cachedRead(file));
  if (match) {
    try {
      const parsed: unknown = parseYaml(match[1]);
      if (isObject(parsed)) block = parsed;
    } catch {
      // A block that is not YAML holds no fields.
    }
  }
  return { name: file.basename, front, block };
}

/** A statblock note's fields: its `statblock` block's, with its frontmatter laid over them. */
export async function statblockFields(app: App, path: string): Promise<Rec | null> {
  const note = await readNote(app, path);
  return note && (note.front || note.block) ? { ...note.block, ...note.front } : null;
}

/** The creature `token` links; null when it links none or none can be read. */
export async function statblockOf(app: App, token: { statblockPath?: string | null; statblockName?: string | null }): Promise<unknown> {
  const path = typeof token.statblockPath === 'string' ? token.statblockPath : '';
  const name = typeof token.statblockName === 'string' ? token.statblockName.trim() : '';
  if (path) {
    const entry = fromBestiary((statblocks) => {
      const creatures = statblocks.getBestiaryCreatures?.();
      return Array.isArray(creatures) ? creatures.find((creature) => isObject(creature) && creature.path === path) : null;
    });
    if (entry) return entry;
    const note = await readNote(app, path);
    // A note is a stat block with a `statblock` block, or frontmatter that says so (`statblock: true`, or stats).
    if (note && (note.block || note.front?.statblock === true || Array.isArray(note.front?.stats))) return { name: note.name, ...note.block, ...note.front };
  }
  return name ? fromBestiary((statblocks) => (statblocks.hasCreature?.(name) === true ? statblocks.getCreatureFromBestiary?.(name) : null)) : null;
}
