import type { SoundId } from './catalog';
import { isSoundId, SOUND_INFO } from './soundInfo';

/** The file types a custom sound may be in. */
export const SOUND_EXTENSIONS: readonly string[] = ['mp3', 'ogg', 'wav', 'm4a', 'webm', 'flac'];
export const DEFAULT_SOUNDS_FOLDER = 'Tabletop sounds';
/** The subfolder the built-in sounds are exported to; nothing in it is ever read as a custom sound. */
export const BUILT_IN_DIR = 'built-in';

/** The largest custom file that is read, in bytes; a bigger one is skipped (a long recording would sit decoded in every window). */
export const MAX_CUSTOM_BYTES = 5 * 1024 * 1024;

function folderSegments(folder: string | undefined | null): string[] {
  return (folder ?? '').trim().replace(/\\/g, '/').split('/').filter((part) => part !== '');
}

/** Whether a folder setting climbs out of the vault (a `.` or `..` segment); such a setting is not used. */
export function isUnsafeFolder(folder: string | undefined | null): boolean {
  return folderSegments(folder).some((part) => part === '.' || part === '..');
}

/** A folder setting as a vault path: slashes forward, none at the ends; empty, or one with `.` or `..` in it, means the default. */
export function cleanFolder(folder: string | undefined | null): string {
  if (isUnsafeFolder(folder)) return DEFAULT_SOUNDS_FOLDER;
  const clean = folderSegments(folder).join('/');
  return clean === '' ? DEFAULT_SOUNDS_FOLDER : clean;
}

/** A file in the custom folder that stands for a sound: `variant` is 0 for `<id>.<ext>` and N for `<id>-N.<ext>`. */
export interface SoundFile { id: SoundId; variant: number; ext: string; path: string }

/** What `path` is as a custom sound of `folder`: null for a file that is not directly in the folder, has another extension, or names no sound. */
export function parseSoundFile(folder: string, path: string): SoundFile | null {
  const prefix = `${cleanFolder(folder)}/`;
  if (!path.startsWith(prefix)) return null;
  const name = path.slice(prefix.length);
  if (name.includes('/')) return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (!SOUND_EXTENSIONS.includes(ext)) return null;
  const stem = name.slice(0, dot);
  const numbered = /^(.+)-(\d+)$/.exec(stem);
  if (numbered && isSoundId(numbered[1])) return { id: numbered[1], variant: Number(numbered[2]), ext, path };
  return isSoundId(stem) ? { id: stem, variant: 0, ext, path } : null;
}

/** The custom files of each sound, in play order (the plain file first, then the numbered ones by number). */
export function resolveOverrides(folder: string, paths: readonly string[]): Map<SoundId, string[]> {
  const found = new Map<SoundId, SoundFile[]>();
  for (const path of paths) {
    const file = parseSoundFile(folder, path);
    if (!file) continue;
    const list = found.get(file.id) ?? [];
    list.push(file);
    found.set(file.id, list);
  }
  const out = new Map<SoundId, string[]>();
  for (const [id, files] of found) out.set(id, files.sort((a, b) => a.variant - b.variant || a.path.localeCompare(b.path)).map((file) => file.path));
  return out;
}

/** What the engine asks for a sound's files; `builtIn` asks for the bundled ones even when a custom set exists. */
export interface SoundLoader {
  (id: SoundId, builtIn?: boolean): Promise<ArrayBuffer[]>;
  /** The engine could not decode these variants (by position) of the set it was given; `all` when none played. */
  customFailed?(id: SoundId, bad: number[], all: boolean): void;
}

/** The part of the vault the custom folder needs. */
export interface SoundFolderIO {
  /** The path of every file in the vault. */
  paths(): string[];
  read(path: string): Promise<ArrayBuffer>;
  /** The size of a file in bytes, when it is known without reading it. */
  size?(path: string): number | undefined;
}

/**
 * Serves a sound's files from the custom folder when it holds some for it, and from the bundled set otherwise. It keeps
 * an index of the folder, which `fileChanged` and `folderChanged` bring up to date; `changed` is told which sounds
 * need their decoded copies dropped.
 */
export class CustomSounds {
  private index: Map<SoundId, string[]> | null = null;
  /** The files each sound was last served from, for naming the one that fails to decode. */
  private readonly served = new Map<SoundId, string[]>();
  /** Files already complained of, so a bad file is named once until it changes. */
  private readonly told = new Set<string>();

  constructor(
    private readonly io: SoundFolderIO,
    private readonly folder: () => string,
    private readonly builtIn: (id: SoundId) => Promise<ArrayBuffer[]>,
    private readonly notify: (message: string) => void,
    private readonly changed: (ids: SoundId[] | 'all') => void,
    /** Called when a sound's state shown in the list changes without a file changing (a decode failure). */
    private readonly stateChanged: () => void = () => {},
  ) {}

  /** Sounds whose custom files all failed to decode, so the built-in sound plays. */
  private readonly failed = new Set<SoundId>();

  /** Whether `id` has custom files but the built-in sound is playing because none of them decoded. */
  isFailed(id: SoundId): boolean {
    return this.failed.has(id);
  }

  private overrides(): Map<SoundId, string[]> {
    return (this.index ??= resolveOverrides(this.folder(), this.io.paths()));
  }

  /** The custom files of `id`, in play order; empty when it has none. */
  filesOf(id: SoundId): string[] {
    return this.overrides().get(id) ?? [];
  }

  isCustom(id: SoundId): boolean {
    return this.filesOf(id).length > 0;
  }

  /** The loader to hand to the sound engine. */
  readonly load: SoundLoader = Object.assign(
    async (id: SoundId, builtIn = false): Promise<ArrayBuffer[]> => {
      const files = builtIn ? [] : this.filesOf(id);
      if (files.length === 0) { this.served.delete(id); return this.builtIn(id); }
      const read: Array<{ path: string; data: ArrayBuffer }> = [];
      const unread: string[] = [];
      const oversize: string[] = [];
      for (const path of files) {
        const known = this.io.size?.(path);
        if (known !== undefined && known > MAX_CUSTOM_BYTES) { oversize.push(path); continue; }
        try {
          const data = await this.io.read(path);
          if (data.byteLength > MAX_CUSTOM_BYTES) oversize.push(path); else read.push({ path, data });
        } catch { unread.push(path); }
      }
      this.complain(oversize, 'is over 5 MB and is skipped');
      this.complain(unread, 'could not be read');
      if (read.length === 0) { this.served.delete(id); return this.builtIn(id); }
      this.served.set(id, read.map((entry) => entry.path));
      return read.map((entry) => entry.data);
    },
    {
      customFailed: (id: SoundId, bad: number[], all: boolean): void => {
        const names = this.served.get(id);
        if (!names) return;
        if (all) { this.failed.add(id); this.stateChanged(); }
        this.complain(bad.flatMap((position) => (names[position] ? [names[position]] : [])), all ? 'could not be decoded; the built-in sound plays instead' : 'could not be decoded and is skipped');
      },
    },
  );

  /** One Notice naming the files, unless they were named already. */
  private complain(paths: string[], what: string): void {
    const fresh = paths.filter((path) => !this.told.has(path));
    if (fresh.length === 0) return;
    for (const path of fresh) this.told.add(path);
    this.notify(`Tabletop: the custom sound ${fresh.map((path) => `"${path.slice(path.lastIndexOf('/') + 1)}"`).join(', ')} ${what}.`);
  }

  /** A file of the vault was created, changed, deleted or renamed (`oldPath` is where a renamed one was). */
  fileChanged(path: string, oldPath?: string): void {
    const folder = this.folder();
    const ids = new Set<SoundId>();
    for (const one of [path, oldPath]) {
      const file = one === undefined ? null : parseSoundFile(folder, one);
      if (!file) continue;
      ids.add(file.id);
      this.failed.delete(file.id);
      this.told.delete(one!);
    }
    if (ids.size === 0) return;
    this.index = null;
    this.changed([...ids]);
  }

  /** The folder setting changed, or the folder itself was created or removed: everything is looked up afresh. */
  folderChanged(): void {
    this.index = null;
    this.told.clear();
    this.failed.clear();
    this.changed('all');
  }
}

/** The README written into the custom folder: the naming rule and every sound with when it plays. */
export function soundsReadme(folder: string): string {
  const lines = [
    '# Tabletop sounds',
    '',
    `Put a sound file in this folder (\`${cleanFolder(folder)}\`) to replace one of the board's built-in sounds. The board picks up added, changed, deleted and renamed files at once; nothing needs a restart.`,
    '',
    '## Naming',
    '',
    '- `<sound id>.<ext>` replaces that sound, for example `dice.hit.mp3` or `condition.prone.ogg`.',
    '- Several variants are numbered `<sound id>-1.<ext>`, `<sound id>-2.<ext>` and so on. They replace the built-in set as a set, and the board picks one at random each time.',
    `- Accepted types: ${SOUND_EXTENSIONS.join(', ')}.`,
    `- Files in the \`${BUILT_IN_DIR}/\` subfolder (exported from the settings, for reference) are never used.`,
    '- Sounds called a loop play over and over while their cause lasts; use a file that loops without a click.',
    '- Per-sound volume, replace and reset are in Settings > Tabletop for Atlas VTT > Sound.',
    '',
    '## Who hears them',
    '',
    'Custom sounds play on this computer. Remote players (Connect in another vault, the web player) hear the built-in ones for now.',
    '',
    '## The sounds',
    '',
    '| Sound id | Name | When it plays |',
    '| --- | --- | --- |',
    ...(Object.keys(SOUND_INFO) as SoundId[]).map((id) => `| \`${id}\` | ${SOUND_INFO[id].name} | ${SOUND_INFO[id].when} |`),
    '',
  ];
  return lines.join('\n');
}
