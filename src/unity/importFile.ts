/**
 * What the importer does with a file that is not a GLB already: a Unity asset bundle (HeroForge's Unity3D export, a
 * .unity3d file) or a TaleSpire creature (.tsMod) is converted to a GLB, and a zip is opened for the models inside it. Everything happens in
 * memory; nothing is run from the file and nothing is fetched.
 */
import { readUnityModel } from './model';
import { readTsMod } from './tsmod';
import { unityToGlb } from './toScene';
import { readZip } from './zip';

export interface ConvertedModel {
  /** The name for the GLB, without its extension. */
  readonly name: string;
  readonly glb: ArrayBuffer;
}

/** Files this converts: a Unity bundle, a TaleSpire creature, or a zip that may hold some. */
export const isUnityImport = (name: string): boolean => /\.(unity3d|tsmod|zip)$/i.test(name);

const MAX_ENTRY = 512 * 1024 * 1024;
const MAX_ENTRIES = 64;

const baseName = (path: string): string => (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]*$/, '');

/** One bundle's or creature's model as a GLB, with the name the file gives it (empty when it gives none). */
async function modelToGlb(path: string, data: Uint8Array): Promise<{ name: string; glb: ArrayBuffer }> {
  const model = /\.tsmod$/i.test(path) ? readTsMod(data) : readUnityModel(data);
  return { name: /\.tsmod$/i.test(path) ? model.name : '', glb: await unityToGlb(model) };
}

/** A TaleSpire zip holds `root.tsMod`: a file name like that says nothing, so the creature's own name is used. */
const generic = (name: string): boolean => /^(root|model|mod)$/i.test(name);

/**
 * The GLBs a file makes: one for a .unity3d or .tsMod, and one for each of those or .glb inside a zip. Throws, with a reason in
 * plain words, when it holds nothing to import.
 */
export async function convertToGlbs(fileName: string, data: ArrayBuffer): Promise<ConvertedModel[]> {
  if (/\.(unity3d|tsmod)$/i.test(fileName)) {
    const made = await modelToGlb(fileName, new Uint8Array(data));
    return [{ name: made.name && generic(baseName(fileName)) ? made.name : baseName(fileName), glb: made.glb }];
  }
  let entries: { [path: string]: Uint8Array };
  try {
    entries = readZip(new Uint8Array(data), (entry) => !/(^|\/)__MACOSX\//.test(entry.name) && /\.(unity3d|tsmod|glb)$/i.test(entry.name) && entry.size <= MAX_ENTRY);
  } catch (error) {
    throw new Error(error instanceof Error && /^the zip|^a size|^it is not a zip/.test(error.message) ? error.message : 'it is not a zip file, or it is damaged.');
  }
  const paths = Object.keys(entries);
  if (paths.length === 0) throw new Error('the zip holds no .unity3d, .tsMod or .glb file.');
  if (paths.length > MAX_ENTRIES) throw new Error('the zip holds too many models to import at once.');
  const out: ConvertedModel[] = [];
  for (const path of paths) {
    const bytes = entries[path];
    if (/\.glb$/i.test(path)) out.push({ name: baseName(path), glb: bytes.slice().buffer });
    else {
      const made = await modelToGlb(path, bytes);
      out.push({ name: made.name && generic(baseName(path)) ? made.name : baseName(path), glb: made.glb });
    }
  }
  return out;
}
