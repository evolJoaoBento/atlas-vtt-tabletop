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
import { addParallax, PARALLAX_TILE_SHARE, type ParallaxUniforms } from './parallax';
import { DEFAULT_TUNING, MATERIAL_SETTINGS_FILE, materialName, pickMaps, readMaterialSettings, roleOf, tuningOf, type MaterialMaps, type MaterialSettings, type MaterialTuning } from './materialMaps';

export const DEFAULT_MATERIALS_FOLDER = 'atlas-vtt/assets/materials';
/** What a material card carries when dragged from the gallery onto a wall: its folder. */
export const MATERIAL_DRAG_TYPE = 'application/x-atlas-tabletop-material';
/** The same as plain text, for where the custom type does not get through: this prefix, then the folder. */
export const MATERIAL_TEXT_PREFIX = 'atlas-tabletop-material:';

export interface LoadedMaterial {
  readonly name: string;
  /** Puts the maps on a material (it keeps them; they are shared by every material they are put on). */
  apply(material: THREE.MeshStandardMaterial): void;
  /** Lays the texture at another scale (squares per tile), on every material it was put on. */
  retile(scale: number): void;
  /**
   * How strongly a material shows its texture: the normal map's strength (`relief`), how dark the occlusion map makes the
   * creases, how glossy it is (a lower roughness lets the light glint on the relief) and how deep the surface seems
   * (`depth`, parallax from the height map). Called again with new numbers while the editor's preview is moved.
   */
  tune(material: THREE.MeshStandardMaterial, tuning: MaterialTuning): void;
  /** Whether the material came with a normal map; without one its relief is worked out from its height or colour map. */
  readonly hasNormal: boolean;
  /** Whether the material came with a height map, which parallax depth needs. */
  readonly hasHeight: boolean;
}

/**
 * Relief for a material that has no normal map: the slopes of a picture (the height map, or else the colours' lightness)
 * as a normal map. The strength is set on the material, not baked in.
 */
function normalMapFrom(picture: THREE.Texture): THREE.Texture | null {
  const image = picture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || !(image.width > 0) || !(image.height > 0)) return null;
  const side = (length: number): number => Math.max(8, Math.min(1024, length));
  const width = side(image.width);
  const height = side(image.height);
  try {
    const canvas = createEl('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const lift = new Float32Array(width * height);
    for (let i = 0; i < lift.length; i++) lift[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) / 255;
    const at = (x: number, y: number): number => lift[((y + height) % height) * width + ((x + width) % width)]!;
    const out = context.createImageData(width, height);
    const strength = 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Sobel slopes, the texture wrapping at its edges as it does on the wall.
        const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
        const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
        const length = Math.hypot(-dx * strength, dy * strength, 1);
        const o = (y * width + x) * 4;
        out.data[o] = Math.round(((-dx * strength) / length * 0.5 + 0.5) * 255);
        out.data[o + 1] = Math.round(((dy * strength) / length * 0.5 + 0.5) * 255);
        out.data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
        out.data[o + 3] = 255;
      }
    }
    context.putImageData(out, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  } catch {
    return null;
  }
}

/** A material's maps by role, as URLs; null for a role it has none of. */
export interface MaterialUrls {
  color: string | null;
  normal: string | null;
  roughness: string | null;
  ao: string | null;
  arm: string | null;
  metalness: string | null;
  /** The height (displacement) map, if there is one. */
  height?: string | null;
}

/**
 * A material from its maps' URLs: the vault's (the GM's board) or the files Connect brought (a player's board). Walls
 * are mapped one tile to a grid square: a tile `scale` squares wide repeats 1 / scale times a square.
 */
export async function materialFromUrls(name: string, urls: MaterialUrls, scale: number, normalDirectX: boolean, tuning: MaterialTuning = DEFAULT_TUNING): Promise<LoadedMaterial> {
  const texture = async (at: string | null, color = false): Promise<THREE.Texture | null> => (at ? readTexture(at, color) : null);
  const [color, normal, roughness, ao, arm, metalness, height] = await Promise.all([
    texture(urls.color, true), texture(urls.normal), texture(urls.roughness), texture(urls.ao), texture(urls.arm), texture(urls.metalness), texture(urls.height ?? null),
  ]);
  // Without a normal map, relief is worked out from the height map, or else from the colours.
  const derived = normal ? null : normalMapFrom(height ?? color!);
  const maps = [color, normal, roughness, ao, arm, metalness, height, derived];
  for (const map of maps) map?.repeat.set(1 / scale, 1 / scale);
  // One pair of uniforms for every material these maps are put on; the shader is only added where there is a height map.
  const parallax: ParallaxUniforms = { map: { value: height }, depth: { value: 0 }, push: { value: 0 }, outward: { value: 0 } };
  const tune = (material: THREE.MeshStandardMaterial, now: MaterialTuning): void => {
    // A normal map as made stands at 1. One worked out is nothing at 1: Relief above it builds the relief, which is not in the material as made.
    const strength = normal ? now.relief : Math.max(0, now.relief - 1);
    // DirectX normal maps point green the other way.
    material.normalScale.set(strength, normalDirectX ? -strength : strength);
    if (!normal) {
      const wanted = strength > 0 ? derived : null;
      if (material.normalMap !== wanted) { material.normalMap = wanted; material.needsUpdate = true; }
    }
    material.aoMapIntensity = now.occlusion;
    material.roughness = 1 - 0.85 * now.shine;
    parallax.depth.value = height ? now.depth * PARALLAX_TILE_SHARE : 0;
    parallax.push.value = height ? now.displace : 0;
    parallax.outward.value = now.outward;
    // Walls cut their faces finely only for a material that moves them (see WallSet).
    material.userData.displaces = height !== null && now.displace > 0;
    material.userData.tileScale = scale;
  };
  return {
    name,
    hasNormal: normal !== null,
    hasHeight: height !== null,
    retile: (next) => { for (const map of maps) map?.repeat.set(1 / next, 1 / next); },
    tune,
    apply: (material) => {
      material.color.set(0xffffff);
      material.map = color;
      material.normalMap = normal;
      // An ARM map packs ambient occlusion (red), roughness (green) and metalness (blue), as three.js reads them.
      material.aoMap = ao ?? arm;
      material.roughnessMap = roughness ?? arm;
      material.metalnessMap = metalness ?? arm;
      tune(material, tuning);
      material.metalness = metalness || arm ? 1 : 0;
      if (height) addParallax(material, parallax);
    },
  };
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

  /** A material's own settings (its texture scale), from the file beside its maps. */
  async settings(folderPath: string): Promise<MaterialSettings> {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(`${folderPath}/${MATERIAL_SETTINGS_FILE}`));
    return readMaterialSettings(file instanceof TFile ? await this.app.vault.read(file) : null);
  }

  /** Keeps a material's settings beside its maps; boards painted with it are drawn again. */
  async saveSettings(folderPath: string, settings: MaterialSettings): Promise<void> {
    const path = normalizePath(`${folderPath}/${MATERIAL_SETTINGS_FILE}`);
    const text = JSON.stringify(settings, null, 2);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.vault.modify(file, text);
    else await this.app.vault.create(path, text);
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
    const settings = await this.settings(folderPath);
    return materialFromUrls(folder.name, {
      color: url(maps.color), normal: url(maps.normal), roughness: url(maps.roughness), ao: url(maps.ao), arm: url(maps.arm), metalness: url(maps.metalness), height: url(maps.height),
    }, settings.scale, maps.normalDirectX === true, tuningOf(settings));
  }

  /** A material's own copy, for the editor's preview: its maps read afresh, so moving the preview changes no wall. */
  async loadForEditing(folderPath: string): Promise<{ loaded: LoadedMaterial; settings: MaterialSettings }> {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) throw new Error('the material is missing.');
    const maps = this.mapsOf(folder);
    if (!maps) throw new Error('it has no colour map.');
    const url = (path: string | undefined): string | null => {
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      return file instanceof TFile ? this.app.vault.getResourcePath(file) : null;
    };
    const settings = await this.settings(folderPath);
    const loaded = await materialFromUrls(folder.name, {
      color: url(maps.color), normal: url(maps.normal), roughness: url(maps.roughness), ao: url(maps.ao), arm: url(maps.arm), metalness: url(maps.metalness), height: url(maps.height),
    }, settings.scale, maps.normalDirectX === true, tuningOf(settings));
    return { loaded, settings };
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
