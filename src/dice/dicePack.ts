/**
 * The pack the dice are made from: the one chosen in the settings, read from the shared packs folder, else the default
 * pack carried in Tabletop. Never an empty pack: without its manifest a die has no shape of its own (a d100 is built as
 * a d20) and no numbering, so it reads wrong or caught.
 */
import { DEFAULT_PACK, DEFAULT_PACK_CONFIG, defaultPackSheets } from './defaultPack';
import { dieFaceCount, type DicePack, type PackDie } from './kit/dieShapes';
import { DIE_FACES, DIE_TYPES, type DieType } from './kit/faces';
import { loadPack, packFileUrls, type PackFs } from './kit/packs';

export interface ChosenPack {
  /** The pack's folder name. */
  name: string;
  config: DicePack;
  /** The face sheets and normal maps, by die type, as URLs. */
  textures: Partial<Record<DieType, string>>;
  normals: Partial<Record<DieType, string>>;
}

/** The default pack as Tabletop carries it: its manifest and its sheets, whatever the packs folder holds. */
export function vendoredPack(): ChosenPack {
  return { name: DEFAULT_PACK, config: DEFAULT_PACK_CONFIG, textures: defaultPackSheets(), normals: {} };
}

/** The pack `name` in `folder`; the default pack Tabletop carries when it has no readable manifest describing its dice. */
export async function choosePack(fs: PackFs, folder: string, name: string): Promise<ChosenPack> {
  const config = name ? await loadPack(fs, folder, name) : null;
  if (!config || typeof config.dice !== 'object' || config.dice === null) {
    if (name) console.warn(`[Tabletop] The dice pack "${name}" has no readable pack.json: rolling with the default dice.`);
    return vendoredPack();
  }
  try {
    return withDefaultDice({ name, config, textures: packFileUrls(fs, folder, name, config, 'texture'), normals: packFileUrls(fs, folder, name, config, 'normal') });
  } catch (error) {
    console.warn(`[Tabletop] The dice pack "${name}" cannot be read: rolling with the default dice.`, error);
    return vendoredPack();
  }
}

/** A d100 is a d10 with tens on it: ten faces. */
const facesOf = (type: DieType): number => (type === 'd100' ? 10 : DIE_FACES[type]);

/**
 * Whether a pack's entry is enough to build and read its die: a sheet, a solid with the die's number of faces, a number
 * for each face, and where each face lies on the sheet (a grid's cells or the faces' corners).
 */
function usableDie(type: DieType, entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
  const die = entry as PackDie;
  const faces = facesOf(type);
  return typeof die.texture === 'string' && die.texture !== ''
    && dieFaceCount(type, { dice: { [type]: die } }) === faces
    && Array.isArray(die.numbers) && die.numbers.length === faces && die.numbers.every((n) => Number.isInteger(n))
    && ((Array.isArray(die.faces) && die.faces.length === faces) || (Array.isArray(die.grid?.cells) && die.grid.cells.length === faces));
}

/**
 * A pack that leaves a die out, or describes it too little to build or read, wears the default pack's for it: its
 * shape, numbering and sheet. Built from nothing, that die would read wrong or never read.
 */
function withDefaultDice(pack: ChosenPack): ChosenPack {
  const missing = DIE_TYPES.filter((type) => !usableDie(type, pack.config.dice?.[type]));
  if (missing.length === 0) return pack;
  const fallback = vendoredPack();
  const dice = { ...pack.config.dice };
  const textures = { ...pack.textures };
  const normals = { ...pack.normals };
  for (const type of missing) {
    const entry = fallback.config.dice?.[type];
    if (entry) dice[type] = entry;
    if (fallback.textures[type]) textures[type] = fallback.textures[type];
    else delete textures[type];
    delete normals[type];
  }
  return { ...pack, config: { ...pack.config, dice }, textures, normals };
}
