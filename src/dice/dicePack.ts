/**
 * The pack the dice are made from: the one chosen in the settings, read from the shared packs folder, else the default
 * pack carried in Tabletop. Never an empty pack: without its manifest a die has no shape of its own (a d100 is built as
 * a d20) and no numbering, so it reads wrong or caught.
 */
import { DEFAULT_PACK, DEFAULT_PACK_CONFIG, defaultPackSheets } from './defaultPack';
import { dieFaceCount, type DicePack, type PackDie } from './kit/dieShapes';
import { DIE_TYPES, type DieType } from './kit/faces';
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
    return await withDefaultDice(fs, `${folder}/${name}`, { name, config, textures: packFileUrls(fs, folder, name, config, 'texture'), normals: packFileUrls(fs, folder, name, config, 'normal') });
  } catch (error) {
    console.warn(`[Tabletop] The dice pack "${name}" cannot be read: rolling with the default dice.`, error);
    return vendoredPack();
  }
}

const isEntry = (entry: unknown): entry is PackDie => typeof entry === 'object' && entry !== null && !Array.isArray(entry);

async function exists(fs: PackFs, path: string): Promise<boolean> {
  try {
    return await fs.exists(path);
  } catch {
    return false;
  }
}

/**
 * Each die as Interactive Dice reads the pack format, made safe to build and read:
 * - a die the pack has no entry for, or whose sheet (its `texture`, else `<type>_Numbers.png`) is not in the pack's
 *   folder, wears the default pack's die and sheet;
 * - a die with a sheet keeps it; without `numbers` or `faces` the kit numbers and lays it out as its own;
 * - a d100 naming no solid is a d10 (the kit would build it as a d20, which never reads);
 * - `numbers` that do not count the die's faces are set aside, for the kit's own.
 */
async function withDefaultDice(fs: PackFs, packFolder: string, pack: ChosenPack): Promise<ChosenPack> {
  const fallback = vendoredPack();
  const dice: Record<string, PackDie> = { ...pack.config.dice };
  const textures = { ...pack.textures };
  const normals = { ...pack.normals };
  for (const type of DIE_TYPES) {
    const entry = pack.config.dice?.[type];
    if (!isEntry(entry) || !(await exists(fs, `${packFolder}/${entry.texture || `${type}_Numbers.png`}`))) {
      const standIn = fallback.config.dice?.[type];
      if (standIn) dice[type] = standIn;
      if (fallback.textures[type]) textures[type] = fallback.textures[type];
      else delete textures[type];
      delete normals[type];
      continue;
    }
    const die: PackDie = { ...entry };
    if (type === 'd100' && !die.geometry) die.geometry = 'd10';
    const faces = dieFaceCount(type, { dice: { [type]: die } });
    if (die.numbers !== undefined && !(Array.isArray(die.numbers) && die.numbers.length === faces && die.numbers.every((n) => Number.isInteger(n)))) delete die.numbers;
    dice[type] = die;
  }
  return { ...pack, config: { ...pack.config, dice }, textures, normals };
}
