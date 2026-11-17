import { BACKGROUND_SIZE, DEFAULT_BACKGROUND, emptyLayers, readBackgroundSettings, type BackgroundLayers, type BackgroundSettings } from './backgroundData';

/** Where painted backgrounds live in the vault unless the user picks another folder. */
export const DEFAULT_BACKGROUNDS_FOLDER = 'atlas-vtt/assets/backgrounds';

/** The few file actions the store needs. Paths are vault paths; `folders` gives the full path of each folder inside `root`. */
export interface BackgroundFiles {
  read(path: string): Promise<ArrayBuffer | null>;
  readText(path: string): Promise<string | null>;
  write(path: string, data: ArrayBuffer | string): Promise<void>;
  folders(root: string): Promise<string[]>;
  remove(folder: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Turns a painted layer into PNG bytes and back, and draws the small preview picture. */
export interface LayerCodec {
  encode(layer: Uint8Array, size: number): Promise<ArrayBuffer>;
  /** The layer's bytes, or null when the picture cannot be read or is the wrong size. */
  decode(bytes: ArrayBuffer, size: number): Promise<Uint8Array | null>;
  thumbnail(layers: BackgroundLayers): Promise<ArrayBuffer>;
}

const SETTINGS_FILE = 'background.json';
const THUMB_FILE = 'thumb.png';
const LAYER_FILES = [
  { key: 'terrain', file: 'terrain.png', empty: 0 },
  { key: 'material', file: 'material.png', empty: 0 },
  { key: 'height', file: 'height.png', empty: 128 },
] as const;

/** A name made safe to be a folder name: odd characters become spaces, runs of spaces shrink to one. */
function folderName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean || 'Background';
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Painted backgrounds kept as folders: settings, three layer pictures and a thumbnail each. */
export class BackgroundStore {
  private listeners = new Set<() => void>();

  constructor(private files: BackgroundFiles, private codec: LayerCodec, private root: string = DEFAULT_BACKGROUNDS_FOLDER) {}

  /** Every background folder holding a settings file, sorted by name. */
  async list(): Promise<{ folder: string; name: string; thumb: string }[]> {
    const found: { folder: string; name: string; thumb: string }[] = [];
    for (const folder of await this.files.folders(this.root)) {
      if (await this.files.readText(`${folder}/${SETTINGS_FILE}`) === null) continue;
      found.push({ folder, name: baseName(folder), thumb: `${folder}/${THUMB_FILE}` });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Reads a background. A layer that is missing or unreadable comes back empty, with one warning. */
  async load(folder: string): Promise<{ settings: BackgroundSettings; layers: BackgroundLayers } | null> {
    const text = await this.files.readText(`${folder}/${SETTINGS_FILE}`);
    if (text === null) return null;
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = undefined; }
    const settings = readBackgroundSettings(raw);
    const layers = emptyLayers(BACKGROUND_SIZE);
    const missing: string[] = [];
    for (const { key, file, empty } of LAYER_FILES) {
      const bytes = await this.files.read(`${folder}/${file}`);
      let data: Uint8Array | null = null;
      if (bytes) {
        try { data = await this.codec.decode(bytes, BACKGROUND_SIZE); } catch { data = null; }
      }
      if (data && data.length === BACKGROUND_SIZE * BACKGROUND_SIZE) layers[key] = data;
      else { layers[key].fill(empty); missing.push(file); }
    }
    if (missing.length) console.warn(`Painted background "${folder}": ${missing.join(', ')} missing or unreadable, using empty layers.`);
    return { settings, layers };
  }

  /** Writes settings, the three layer pictures and the thumbnail, then tells listeners. */
  async save(folder: string, settings: BackgroundSettings, layers: BackgroundLayers): Promise<void> {
    await this.write(folder, settings, layers);
    this.changed();
  }

  /** Makes a new empty background and returns its folder. */
  async create(name: string): Promise<string> {
    const folder = await this.freeFolder(name);
    await this.write(folder, { ...DEFAULT_BACKGROUND, name: baseName(folder) }, emptyLayers(BACKGROUND_SIZE));
    this.changed();
    return folder;
  }

  /** Copies a background under a new name and returns the new folder. */
  async duplicate(folder: string, name: string): Promise<string> {
    const target = await this.freeFolder(name);
    const copyName = baseName(target);
    for (const file of [SETTINGS_FILE, THUMB_FILE, ...LAYER_FILES.map((l) => l.file)]) {
      if (file === SETTINGS_FILE) {
        const text = await this.files.readText(`${folder}/${file}`);
        if (text !== null) await this.files.write(`${target}/${file}`, this.withName(text, copyName));
        continue;
      }
      const bytes = await this.files.read(`${folder}/${file}`);
      if (bytes) await this.files.write(`${target}/${file}`, bytes.slice(0));
    }
    this.changed();
    return target;
  }

  /** Renames a background (its folder and its saved name) and returns the new folder. */
  async rename(folder: string, name: string): Promise<string> {
    const wanted = folderName(name);
    const target = wanted === baseName(folder) ? folder : await this.freeFolder(name);
    if (target !== folder) await this.files.rename(folder, target);
    const text = await this.files.readText(`${target}/${SETTINGS_FILE}`);
    if (text !== null) await this.files.write(`${target}/${SETTINGS_FILE}`, this.withName(text, baseName(target)));
    this.changed();
    return target;
  }

  async remove(folder: string): Promise<void> {
    await this.files.remove(folder);
    this.changed();
  }

  /** Calls `listener` after every change; returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private async write(folder: string, settings: BackgroundSettings, layers: BackgroundLayers): Promise<void> {
    await this.files.write(`${folder}/${SETTINGS_FILE}`, JSON.stringify(settings, null, 2));
    for (const { key, file } of LAYER_FILES) await this.files.write(`${folder}/${file}`, await this.codec.encode(layers[key], layers.size));
    await this.files.write(`${folder}/${THUMB_FILE}`, await this.codec.thumbnail(layers));
  }

  private withName(text: string, name: string): string {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { raw = undefined; }
    return JSON.stringify({ ...readBackgroundSettings(raw), name }, null, 2);
  }

  /** A folder path under the root for this name, with " 2", " 3"... added until nothing is there. */
  private async freeFolder(name: string): Promise<string> {
    const taken = new Set((await this.files.folders(this.root)).map(baseName));
    const base = folderName(name);
    let candidate = base;
    for (let n = 2; taken.has(candidate); n++) candidate = `${base} ${n}`;
    return `${this.root}/${candidate}`;
  }
}
