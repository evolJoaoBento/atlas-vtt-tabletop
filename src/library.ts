/**
 * The minis: GLB files in one vault folder (`atlas-vtt/assets/minis` by default). Imports copy files into it; GLBs put
 * there by hand are listed too. Each GLB is parsed once and shared; thumbnails are drawn once per file and kept in memory.
 */
import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { checkGlb } from './glbCheck';

export const DEFAULT_MINIS_FOLDER = 'atlas-vtt/assets/minis';
const THUMB_PX = 192;

export interface LoadedMini {
  /** The model, centred on its footprint and standing on y = 0. Clone it (`SkeletonUtils.clone`); never add it to a scene. */
  readonly scene: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
  /** The widest side of the model's footprint (x or z), in model units. */
  readonly footprint: number;
  readonly height: number;
}

export const isGlbPath = (path: string): boolean => /\.glb$/i.test(path);

/** Why a GLB cannot be used, in words for the user. */
export function explainLoadError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/draco|meshopt/i.test(text)) return 'it is compressed (Draco or Meshopt), which Tabletop does not read. Re-export it without mesh compression.';
  if (/ktx2|basisu/i.test(text)) return 'it uses KTX2 textures, which Tabletop does not read.';
  if (/magic|json|unexpected token/i.test(text)) return 'it is not a valid binary glTF (.glb) file.';
  return text;
}

function parse(data: ArrayBuffer): Promise<GLTF> {
  checkGlb(data);
  // Nothing outside the file is ever fetched.
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : 'data:,'));
  const loader = new GLTFLoader(manager);
  return new Promise((resolve, reject) => loader.parse(data, '', resolve, reject));
}

function normalise(gltf: GLTF): LoadedMini {
  const root = new THREE.Group();
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  if (box.isEmpty()) throw new Error('it has no visible geometry.');
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  // A figure is usually made standing on its origin: it stands there, so a sword held out does not push it off its
  // token. A model whose origin lies outside its own footprint is centred on that footprint instead.
  const origin = new THREE.Vector3().setFromMatrixPosition(model.matrixWorld);
  const onOrigin = origin.x >= box.min.x && origin.x <= box.max.x && origin.z >= box.min.z && origin.z <= box.max.z;
  const stand = onOrigin ? origin : centre;
  model.position.sub(new THREE.Vector3(stand.x, box.min.y, stand.z));
  root.add(model);
  root.updateMatrixWorld(true);
  return { scene: root, animations: gltf.animations, footprint: Math.max(size.x, size.z, 1e-6), height: size.y };
}

/** Reads a GLB into a model Tabletop can draw; throws with the reason when it cannot. */
export async function parseMini(data: ArrayBuffer): Promise<LoadedMini> {
  return normalise(await parse(data));
}

export class MiniLibrary {
  private readonly models = new Map<string, Promise<LoadedMini>>();
  private readonly thumbs = new Map<string, Promise<string | null>>();
  private readonly listeners = new Set<() => void>();
  private thumbRenderer: THREE.WebGLRenderer | null = null;
  private thumbQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: App, private readonly folder: () => string) {}

  get folderPath(): string {
    return normalizePath(this.folder() || DEFAULT_MINIS_FOLDER);
  }

  /** The GLBs in the minis folder (and its subfolders), by name. */
  list(): TFile[] {
    const root = `${this.folderPath}/`;
    return this.app.vault.getFiles().filter((file) => file.path.startsWith(root) && file.extension.toLowerCase() === 'glb')
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** The vault changed a file: forget what was read of it, and tell the gallery when it is a mini. */
  fileChanged(path: string, oldPath?: string): void {
    for (const candidate of [path, oldPath]) {
      if (!candidate) continue;
      this.models.delete(candidate);
      this.thumbs.delete(candidate);
    }
    const root = `${this.folderPath}/`;
    if ([path, oldPath].some((candidate) => candidate && (candidate.startsWith(root) || `${candidate}/` === root))) this.emit();
  }

  emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  /** The model of the GLB at `path`, parsed once. Rejects with a reason (`explainLoadError`) when it cannot be drawn. */
  load(path: string): Promise<LoadedMini> {
    let found = this.models.get(path);
    if (!found) {
      found = (async () => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) throw new Error('the file is missing.');
        return parseMini(await this.app.vault.readBinary(file));
      })();
      found.catch(() => this.models.delete(path));
      this.models.set(path, found);
    }
    return found;
  }

  /** Copies GLB files into the minis folder; returns the vault paths made and the failures, with reasons. */
  async import(files: readonly File[]): Promise<{ added: string[]; failed: Array<{ name: string; reason: string }> }> {
    const added: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    await this.ensureFolder(this.folderPath);
    for (const file of files) {
      if (!isGlbPath(file.name)) {
        failed.push({ name: file.name, reason: 'only .glb files can be imported.' });
        continue;
      }
      try {
        const data = await file.arrayBuffer();
        await parseMini(data.slice(0));
        const path = this.freePath(file.name);
        await this.app.vault.createBinary(path, data);
        added.push(path);
      } catch (error) {
        failed.push({ name: file.name, reason: explainLoadError(error) });
      }
    }
    if (added.length > 0) this.emit();
    return { added, failed };
  }

  private freePath(name: string): string {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, '-');
    const base = clean.replace(/\.glb$/i, '');
    let path = normalizePath(`${this.folderPath}/${base}.glb`);
    for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${this.folderPath}/${base} ${n}.glb`);
    return path;
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

  /** A picture of the mini (a data URL), drawn once; null when it cannot be drawn. */
  thumbnail(path: string): Promise<string | null> {
    let found = this.thumbs.get(path);
    if (!found) {
      // One at a time: they share one renderer.
      found = this.thumbQueue.then(() => this.drawThumb(path)).catch(() => null);
      this.thumbQueue = found;
      this.thumbs.set(path, found);
    }
    return found;
  }

  private async drawThumb(path: string): Promise<string | null> {
    const mini = await this.load(path);
    if (!this.thumbRenderer) {
      this.thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.thumbRenderer.setSize(THUMB_PX, THUMB_PX, false);
      this.thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const model = cloneSkinned(mini.scene);
    scene.add(model);
    const reach = Math.max(mini.footprint, mini.height);
    const camera = new THREE.PerspectiveCamera(30, 1, reach / 100, reach * 100);
    const distance = (reach / 2) / Math.tan(THREE.MathUtils.degToRad(15)) * 1.15;
    const target = new THREE.Vector3(0, mini.height / 2, 0);
    camera.position.copy(target).add(new THREE.Vector3(0.55, 0.45, 1).normalize().multiplyScalar(distance));
    camera.lookAt(target);
    this.thumbRenderer.render(scene, camera);
    return this.thumbRenderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.thumbRenderer?.dispose();
    this.thumbRenderer?.forceContextLoss();
    this.thumbRenderer = null;
    this.models.clear();
    this.thumbs.clear();
    this.listeners.clear();
  }
}
