import { Notice, TFile, TFolder, type App, type EventRef } from 'obsidian';
import { CATALOG, loadSound, type SoundId } from './catalog';
import { BUILT_IN_DIR, cleanFolder, CustomSounds, SOUND_EXTENSIONS, soundsReadme } from './customSounds';
import { SoundEngine } from './soundEngine';

/** The bytes of one bundled variant, as a fresh copy. */
function bytesOf(file: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(file.length);
  new Uint8Array(copy).set(file);
  return copy;
}

/**
 * The custom sounds folder of a vault: serves its files to the sound engines, follows the vault's changes to them, and
 * does what the settings list asks (replace, reset, export the built-in sounds). The folder is only created when
 * something is first written to it.
 */
export class VaultSounds {
  readonly custom: CustomSounds;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: App, private readonly folderSetting: () => string | undefined) {
    this.custom = new CustomSounds(
      {
        paths: () => this.app.vault.getFiles().map((file) => file.path),
        read: (path) => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) return Promise.reject(new Error(`no file ${path}`));
          return this.app.vault.readBinary(file);
        },
      },
      () => this.folder,
      loadSound,
      (message) => { new Notice(message); },
      (ids) => {
        SoundEngine.invalidateEverywhere(ids);
        for (const listener of [...this.listeners]) listener();
      },
    );
  }

  get folder(): string {
    return cleanFolder(this.folderSetting());
  }

  /** Tells `listener` whenever the custom files change; returns the way to stop. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The vault events to register (the plugin passes each to `registerEvent`). */
  events(): EventRef[] {
    const vault = this.app.vault;
    const folderTouched = (file: unknown, ...paths: string[]): boolean => file instanceof TFolder && paths.includes(this.folder);
    return [
      vault.on('create', (file) => { if (folderTouched(file, file.path)) this.custom.folderChanged(); else this.custom.fileChanged(file.path); }),
      vault.on('modify', (file) => this.custom.fileChanged(file.path)),
      vault.on('delete', (file) => { if (folderTouched(file, file.path)) this.custom.folderChanged(); else this.custom.fileChanged(file.path); }),
      vault.on('rename', (file, oldPath) => { if (folderTouched(file, file.path, oldPath)) this.custom.folderChanged(); else this.custom.fileChanged(file.path, oldPath); }),
    ];
  }

  /** The folder setting changed. */
  folderChanged(): void {
    this.custom.folderChanged();
  }

  private async ensureFolder(path: string): Promise<void> {
    let built = '';
    for (const part of path.split('/')) {
      built = built === '' ? part : `${built}/${part}`;
      if (!this.app.vault.getAbstractFileByPath(built)) await this.app.vault.createFolder(built);
    }
  }

  private async write(path: string, data: ArrayBuffer | string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      if (typeof data === 'string') await this.app.vault.modify(existing, data);
      else await this.app.vault.modifyBinary(existing, data);
    } else if (typeof data === 'string') await this.app.vault.create(path, data);
    else await this.app.vault.createBinary(path, data);
  }

  /** Makes `picked` the sound `id`: saved as `<id>.<ext>` in the folder, in place of any custom files it had. Returns false for a file type that is not accepted. */
  async replace(id: SoundId, picked: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<boolean> {
    const ext = picked.name.slice(picked.name.lastIndexOf('.') + 1).toLowerCase();
    if (!SOUND_EXTENSIONS.includes(ext)) return false;
    const data = await picked.arrayBuffer();
    const folder = this.folder;
    await this.ensureFolder(folder);
    const target = `${folder}/${id}.${ext}`;
    for (const old of this.custom.filesOf(id)) {
      const file = this.app.vault.getAbstractFileByPath(old);
      if (old !== target && file instanceof TFile) await this.app.fileManager.trashFile(file);
    }
    await this.write(target, data);
    return true;
  }

  /** Deletes the custom files of `id`, so the built-in sound plays again. */
  async reset(id: SoundId): Promise<void> {
    for (const path of this.custom.filesOf(id)) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) await this.app.fileManager.trashFile(file);
    }
  }

  /** Writes every bundled sound to `<folder>/built-in/<id>-N.mp3`, and the README to the folder. */
  async exportBuiltIn(): Promise<number> {
    const folder = this.folder;
    const dir = `${folder}/${BUILT_IN_DIR}`;
    await this.ensureFolder(dir);
    let count = 0;
    for (const id of Object.keys(CATALOG) as SoundId[]) {
      const files = CATALOG[id].files;
      for (let i = 0; i < files.length; i++) {
        await this.write(`${dir}/${id}-${i + 1}.mp3`, bytesOf(files[i]));
        count++;
      }
    }
    await this.write(`${folder}/README.md`, soundsReadme(folder));
    return count;
  }
}
