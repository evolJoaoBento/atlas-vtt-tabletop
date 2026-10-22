/**
 * Interactive Dice's default pack, carried inside main.js: Obsidian installs a plugin as main.js, manifest.json and
 * styles.css only, so the pack's folder would never arrive. Its files are written into the shared packs folder when
 * missing, and they are the dice Tabletop falls back to when the chosen pack cannot be read.
 */
import type { DicePack } from './kit/dieShapes';
import type { DieType } from './kit/faces';
import d4 from './kit/default-pack/d4_Numbers.png';
import d6 from './kit/default-pack/d6_Numbers.png';
import d8 from './kit/default-pack/d8_Numbers.png';
import d10 from './kit/default-pack/d10_Numbers.png';
import d10Percent from './kit/default-pack/d10_Percent_Numbers.png';
import d12 from './kit/default-pack/d12_Numbers.png';
import d20 from './kit/default-pack/d20_Numbers.png';
import packJson from './kit/default-pack/pack.json';

/** The default pack's folder under the shared packs folder, as Interactive Dice names it. */
export const DEFAULT_PACK = 'Texture-Pack-Default';

/** The default pack's manifest: the shapes, numbering and finish of every die. */
export const DEFAULT_PACK_CONFIG: DicePack = packJson as unknown as DicePack;

const SHEETS: Record<string, Uint8Array> = {
  'd4_Numbers.png': d4,
  'd6_Numbers.png': d6,
  'd8_Numbers.png': d8,
  'd10_Numbers.png': d10,
  'd10_Percent_Numbers.png': d10Percent,
  'd12_Numbers.png': d12,
  'd20_Numbers.png': d20,
};

/** The default pack as files for the shared packs folder, keyed by path under it; the manifest written as Interactive Dice writes it. */
export function defaultPackFiles(): Record<string, ArrayBuffer> {
  const files: Record<string, ArrayBuffer> = {};
  for (const [name, bytes] of Object.entries(SHEETS)) files[`${DEFAULT_PACK}/${name}`] = bytes.slice().buffer;
  files[`${DEFAULT_PACK}/pack.json`] = new TextEncoder().encode(`${JSON.stringify(packJson, null, 2)}\n`).buffer;
  return files;
}

let sheetUrls: Partial<Record<DieType, string>> | null = null;

/** The default pack's sheets as URLs of the bytes carried here, by die type (made once): no file needs to exist. */
export function defaultPackSheets(): Partial<Record<DieType, string>> {
  if (sheetUrls) return sheetUrls;
  const urls: Partial<Record<DieType, string>> = {};
  for (const [type, entry] of Object.entries(DEFAULT_PACK_CONFIG.dice ?? {})) {
    const bytes = entry.texture ? SHEETS[entry.texture] : undefined;
    if (bytes) urls[type as DieType] = URL.createObjectURL(new Blob([bytes.slice()], { type: 'image/png' }));
  }
  sheetUrls = urls;
  return urls;
}

/** Lets go of the default sheets' URLs (the plugin unloads); they are made again when next asked for. */
export function releaseDefaultPackSheets(): void {
  for (const url of Object.values(sheetUrls ?? {})) URL.revokeObjectURL(url);
  sheetUrls = null;
}
