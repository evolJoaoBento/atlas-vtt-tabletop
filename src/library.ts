/**
 * A library of GLBs in one vault folder: the minis (`atlas-vtt/assets/minis` by default) that stand on tokens, or the
 * props (`atlas-vtt/assets/props`) that stand on the board. Imports copy files into it; GLBs put there by hand are
 * listed too. Each GLB is parsed once and shared; thumbnails are drawn once per file and kept in memory.
 */
import { normalizePath, TFile, TFolder, type App } from 'obsidian';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { checkGlb } from './glbCheck';
import { simplifyModel } from './simplify';
import { convertToGlbs, isUnityImport } from './unity/importFile';

export const DEFAULT_MINIS_FOLDER = 'atlas-vtt/assets/minis';
export const DEFAULT_PROPS_FOLDER = 'atlas-vtt/assets/props';

/** What a library holds, for its wording: minis (on tokens) or props (on the board). */
export interface LibraryKind {
  readonly one: string;
  readonly many: string;
  readonly fallback: string;
}

export const MINIS: LibraryKind = { one: 'mini', many: 'minis', fallback: DEFAULT_MINIS_FOLDER };
export const PROPS: LibraryKind = { one: 'prop', many: 'props', fallback: DEFAULT_PROPS_FOLDER };
const THUMB_PX = 192;

export interface LoadedMini {
  /** The model, centred on its footprint and standing on y = 0. Clone it (`SkeletonUtils.clone`); never add it to a scene. */
  readonly scene: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
  /** The widest side of the model's footprint (x or z), in model units. */
  readonly footprint: number;
  readonly height: number;
  /** Its triangles as drawn, and as the file has them when it was thinned to `TRIANGLE_BUDGET` (null otherwise). */
  readonly triangles: number;
  readonly simplifiedFrom: number | null;
}

/** The most triangles a mini or prop is drawn with; a heavier GLB is thinned when it is read. */
export const TRIANGLE_BUDGET = 30_000;

export const isGlbPath = (path: string): boolean => /\.glb$/i.test(path);

/** What an import says: how many were imported, and which were already there (used again); null when neither. */
export function importNotice(kind: { one: string; many: string }, folder: string, added: readonly string[], reused: readonly string[]): string | null {
  const count = (n: number): string => `${n} ${n === 1 ? kind.one : kind.many}`;
  const name = (path: string): string => path.split('/').pop()!.replace(/\.glb$/i, '');
  const parts: string[] = [];
  if (added.length > 0) parts.push(`imported ${count(added.length)} into ${folder}`);
  if (reused.length === 1) parts.push(`${name(reused[0]!)} was already there, so it is used as it is`);
  else if (reused.length > 1) parts.push(`${count(reused.length)} were already there, so they are used as they are`);
  return parts.length > 0 ? `Tabletop: ${parts.join('; ')}.` : null;
}

/** Whether two files hold the same bytes. */
export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/**
 * The first of `paths` whose file holds exactly `bytes`, read with `read` (null: no file there, which ends the search,
 * as the numbered copies of a name end at the first gap); null when none does.
 */
export async function sameFileAmong(paths: Iterable<string>, read: (path: string) => Promise<ArrayBuffer | null>, bytes: ArrayBuffer): Promise<string | null> {
  for (const path of paths) {
    const held = await read(path);
    if (held === null) return null;
    if (sameBytes(held, bytes)) return path;
  }
  return null;
}

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

function normalise(gltf: GLTF, counts: { before: number; after: number }): LoadedMini {
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
  return {
    scene: root, animations: gltf.animations, footprint: Math.max(size.x, size.z, 1e-6), height: size.y,
    triangles: counts.after, simplifiedFrom: counts.after < counts.before ? counts.before : null,
  };
}

/** Reads a GLB into a model Tabletop can draw; throws with the reason when it cannot. */
export async function parseMini(data: ArrayBuffer): Promise<LoadedMini> {
  const gltf = await parse(data);
  return normalise(gltf, await simplifyModel(gltf.scene, TRIANGLE_BUDGET));
}

export class MiniLibrary {
  private readonly models = new Map<string, Promise<LoadedMini>>();
  private readonly thumbs = new Map<string, Promise<string | null>>();
  private readonly listeners = new Set<() => void>();
  private thumbRenderer: THREE.WebGLRenderer | null = null;
  private thumbQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly app: App, private readonly folder: () => string, readonly kind: LibraryKind = MINIS) {}

  get folderPath(): string {
    return normalizePath(this.folder() || this.kind.fallback);
  }

  /** The GLBs in the library's folder (and its subfolders), by name. */
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

  /** Imports under way, one after another: two at once would pick the same free name and the second would fail. */
  private importing: Promise<unknown> = Promise.resolve();

  /**
   * Copies GLB files (or what HeroForge and TaleSpire exports convert to) into the library's folder; returns the vault
   * paths made, the files already there that were used again (the same model imported before: `reused`, nothing
   * written), and the failures, with reasons.
   */
  import(files: readonly File[]): Promise<{ added: string[]; reused: string[]; failed: Array<{ name: string; reason: string }> }> {
    const run = this.importing.then(() => this.importNow(files));
    this.importing = run.catch(() => undefined);
    return run;
  }

  private async importNow(files: readonly File[]): Promise<{ added: string[]; reused: string[]; failed: Array<{ name: string; reason: string }> }> {
    const added: string[] = [];
    const reused: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];
    await this.ensureFolder(this.folderPath);
    for (const file of files) {
      const glb = isGlbPath(file.name);
      if (!glb && !isUnityImport(file.name)) {
        failed.push({ name: file.name, reason: 'only .glb files, HeroForge Unity3D exports (.unity3d), TaleSpire creatures (.tsMod) and zips of them can be imported.' });
        continue;
      }
      try {
        const data = await file.arrayBuffer();
        const models = glb ? [{ name: file.name.replace(/\.glb$/i, ''), glb: data }] : await convertToGlbs(file.name, data);
        for (const model of models) {
          // The same model imported before (under its name, or a numbered copy of it): that file is used again.
          const copy = await sameFileAmong(this.namesFor(`${model.name}.glb`), (path) => this.readIfFile(path), model.glb);
          if (copy) {
            if (!reused.includes(copy) && !added.includes(copy)) reused.push(copy);
            continue;
          }
          await parseMini(model.glb.slice(0));
          added.push(await this.write(`${model.name}.glb`, model.glb));
        }
      } catch (error) {
        failed.push({ name: file.name, reason: explainLoadError(error) });
      }
    }
    if (added.length > 0) this.emit();
    return { added, reused, failed };
  }

  /** The paths an import named `name` may take: the name itself, then its numbered copies (`name 2`, `name 3`…). */
  private *namesFor(name: string): Generator<string> {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, '-');
    const base = clean.replace(/\.glb$/i, '');
    yield normalizePath(`${this.folderPath}/${base}.glb`);
    for (let n = 2; ; n++) yield normalizePath(`${this.folderPath}/${base} ${n}.glb`);
  }

  /** The bytes of the vault file at `path`; null when there is none (the end of the numbered copies). */
  private async readIfFile(path: string): Promise<ArrayBuffer | null> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return null;
    return file instanceof TFile ? this.app.vault.readBinary(file) : new ArrayBuffer(0);
  }

  /** Writes `data` at the first free path for `name`; one that turns out taken meanwhile (on disk, not yet indexed) is skipped. */
  private async write(name: string, data: ArrayBuffer): Promise<string> {
    let tries = 0;
    for (const path of this.namesFor(name)) {
      if (this.app.vault.getAbstractFileByPath(path)) continue;
      try {
        await this.app.vault.createBinary(path, data);
        return path;
      } catch (error) {
        if (!/already exists/i.test(error instanceof Error ? error.message : String(error)) || ++tries >= 20) throw error;
      }
    }
    throw new Error('no free file name.');
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
