/**
 * The materials library: the textures walls and doors are painted with, one folder each under
 * `atlas-vtt/assets/materials`, as Poly Haven gives them (a colour map, and as many of a normal, roughness, ambient
 * occlusion or packed AO/roughness/metal "ARM" map as it has). Tabletop tells the maps apart by their names
 * (`brick_wall_diff_1k.jpg`, `…_nor_gl_1k.jpg`, `…_rough_1k.jpg`, `…_arm_1k.jpg`). Imports take the zip Poly Haven
 * downloads, or a folder of its maps; a folder put there by hand is listed too. Each material is read once.
 */
import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import * as THREE from 'three';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';
import { materialName, pickMaps, roleOf, type MaterialMaps } from './materialMaps';

export const DEFAULT_MATERIALS_FOLDER = 'atlas-vtt/assets/materials';
/** What a material card carries when dragged from the gallery onto a wall: its folder. */
export const MATERIAL_DRAG_TYPE = 'application/x-atlas-tabletop-material';

export interface LoadedMaterial {
  readonly name: string;
  /** Puts the maps on a material (it keeps them; they are shared by every material they are put on). */
  apply(material: THREE.MeshStandardMaterial): void;
}

function readTexture(url: string, color: boolean): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (texture) => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      resolve(texture);
    }, undefined, () => reject(new Error(`cannot read ${url}`)));
  });
}

export class MaterialLibrary {
  private readonly loaded = new Map<string, Promise<LoadedMaterial>>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly app: App, private readonly folder: () => string) {}

  get folderPath(): string {
    return normalizePath(this.folder() || DEFAULT_MATERIALS_FOLDER);
  }

  /** The materials: the folders under the library's folder holding a colour map, by name. */
  list(): TFolder[] {
    const root = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (!(root instanceof TFolder)) return [];
    return root.children.filter((child): child is TFolder => child instanceof TFolder && this.mapsOf(child) !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private mapsOf(folder: TFolder): MaterialMaps | null {
    return pickMaps(folder.children.filter((child): child is TFile => child instanceof TFile).map((file) => file.path));
  }

  /** A picture of the material for its card: its colour map. */
  thumbnail(folderPath: string): string | null {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    const color = folder instanceof TFolder ? this.mapsOf(folder)?.color : undefined;
    const file = color ? this.app.vault.getAbstractFileByPath(color) : null;
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The vault changed a file: a material it belongs to is read again, and the gallery told. */
  fileChanged(path: string, oldPath?: string): void {
    const root = `${this.folderPath}/`;
    let touched = false;
    for (const candidate of [path, oldPath]) {
      if (!candidate || !(candidate.startsWith(root) || `${candidate}/` === root)) continue;
      touched = true;
      for (const key of [...this.loaded.keys()]) if (candidate === key || candidate.startsWith(`${key}/`) || key.startsWith(`${candidate}/`)) this.loaded.delete(key);
    }
    if (touched) for (const listener of [...this.listeners]) listener();
  }

  /** The material in `folderPath`, its maps read once. */
  load(folderPath: string): Promise<LoadedMaterial> {
    let found = this.loaded.get(folderPath);
    if (!found) {
      found = this.read(folderPath);
      found.catch(() => this.loaded.delete(folderPath));
      this.loaded.set(folderPath, found);
    }
    return found;
  }

  private async read(folderPath: string): Promise<LoadedMaterial> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) throw new Error('the material is missing.');
    const maps = this.mapsOf(folder);
    if (!maps) throw new Error('it has no colour map.');
    const url = (path: string | undefined): string | null => {
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
    };
    const texture = async (path: string | undefined, color = false): Promise<THREE.Texture | null> => {
      const at = url(path);
      return at ? readTexture(at, color) : null;
    };
    const [color, normal, roughness, ao, arm, metalness] = await Promise.all([
      texture(maps.color, true), texture(maps.normal), texture(maps.roughness), texture(maps.ao), texture(maps.arm), texture(maps.metalness),
    ]);
    return {
      name: folder.name,
      apply: (material) => {
        material.color.set(0xffffff);
        material.map = color;
        material.normalMap = normal;
        // DirectX normal maps point green the other way.
        if (normal) material.normalScale.set(1, maps.normalDirectX ? -1 : 1);
        // An ARM map packs ambient occlusion (red), roughness (green) and metalness (blue), as three.js reads them.
        material.aoMap = ao ?? arm;
        material.roughnessMap = roughness ?? arm;
        material.metalnessMap = metalness ?? arm;
        material.roughness = 1;
        material.metalness = metalness || arm ? 1 : 0;
      },
    };
  }

  /**
   * Imports materials: each zip Poly Haven gives (its maps taken out of it), and loose maps grouped by the material
   * their names belong to. Returns the folders made and the failures, with reasons.
   */
  async import(files: readonly File[]): Promise<{ added: string[]; failed: Array<{ name: string; reason: string }> }> {
    const added: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    const loose = new Map<string, Array<{ name: string; data: ArrayBuffer }>>();
    for (const file of files) {
      if (/\.zip$/i.test(file.name)) {
        try {
          const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
          const images = Object.entries(entries).filter(([name]) => !name.endsWith('/') && roleOf(name.split('/').pop()!) !== null)
            .map(([name, bytes]) => ({ name: name.split('/').pop()!, data: bytes.slice().buffer }));
          if (!pickMaps(images.map((image) => image.name))) throw new Error('it holds no colour map (a file named like …_diff_1k.jpg).');
          added.push(await this.save(materialName(file.name), images));
        } catch (error) {
          failed.push({ name: file.name, reason: error instanceof Error ? error.message : String(error) });
        }
        continue;
      }
      if (!roleOf(file.name)) continue;
      const name = materialName(file.name);
      const group = loose.get(name) ?? [];
      group.push({ name: file.name, data: await file.arrayBuffer() });
      loose.set(name, group);
    }
    for (const [name, images] of loose) {
      if (!pickMaps(images.map((image) => image.name))) {
        failed.push({ name, reason: 'no colour map among its files (a file named like …_diff_1k.jpg).' });
        continue;
      }
      try {
        added.push(await this.save(name, images));
      } catch (error) {
        failed.push({ name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    if (files.length > 0 && added.length + failed.length === 0) failed.push({ name: 'the files', reason: 'none is a zip or a texture map Tabletop knows.' });
    if (added.length > 0) for (const listener of [...this.listeners]) listener();
    return { added, failed };
  }

  /** Writes a material's maps into a new folder of its own; returns the folder. */
  private async save(name: string, images: ReadonlyArray<{ name: string; data: ArrayBuffer }>): Promise<string> {
    await this.ensureFolder(this.folderPath);
    let folder = normalizePath(`${this.folderPath}/${name}`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(folder); n++) folder = normalizePath(`${this.folderPath}/${name} ${n}`);
    await this.app.vault.createFolder(folder);
    for (const image of images) await this.app.vault.createBinary(normalizePath(`${folder}/${image.name}`), image.data);
    return folder;
  }

  private async ensureFolder(path: string): Promise<void> {
    let built = '';
    for (const part of path.split('/')) {
      built = built ? `${built}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(built);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${built} is a file, not a folder.`);
      try {
        await this.app.vault.createFolder(built);
      } catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(built) instanceof TFolder)) throw error;
      }
    }
  }

  dispose(): void {
    this.loaded.clear();
    this.listeners.clear();
  }
}
