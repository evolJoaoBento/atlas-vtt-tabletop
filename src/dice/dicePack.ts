/**
 * The pack the dice are made from: the one chosen in the settings, read from the shared packs folder, else the default
 * pack carried in Tabletop. Never an empty pack: without its manifest a die has no shape of its own (a d100 is built as
 * a d20) and no numbering, so it reads wrong or caught.
 */
import { DEFAULT_PACK, DEFAULT_PACK_CONFIG, defaultPackSheets } from './defaultPack';
import type { DicePack } from './kit/dieShapes';
import type { DieType } from './kit/faces';
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
    return { name, config, textures: packFileUrls(fs, folder, name, config, 'texture'), normals: packFileUrls(fs, folder, name, config, 'normal') };
  } catch (error) {
    console.warn(`[Tabletop] The dice pack "${name}" cannot be read: rolling with the default dice.`, error);
    return vendoredPack();
  }
}
