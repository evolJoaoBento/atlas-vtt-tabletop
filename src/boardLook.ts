/**
 * A map's look on the board as Connect reads it (`BoardLook`): the heights, materials, door props, props, fog height
 * and ambient light the GM gave it, from Tabletop's own data. Materials are listed only once their settings are read
 * (`MaterialIndex`), so nothing is guessed; Connect hears when they are.
 */
import type { TFile, TFolder, Vault } from 'obsidian';
import type { BoardData } from './board/boardData';
import type { BoardLook } from './connectContract';
import { pickMaps, readMaterialSettings, MATERIAL_SETTINGS_FILE, type MaterialMaps } from './materialMaps';

export interface MaterialInfo {
  scale: number;
  /** Texture role to vault path; a DirectX normal map is the role `normal-dx`. */
  maps: Record<string, string>;
}

export interface MaterialView {
  info(folder: string): MaterialInfo | null;
}

export function boardLookFor(data: BoardData, materials: MaterialView, mapPath: string): BoardLook {
  const used = data.usedMaterials(mapPath)
    .map((id) => ({ id, info: materials.info(id) }))
    .filter((entry): entry is { id: string; info: MaterialInfo } => entry.info !== null)
    .map(({ id, info }) => ({ id, scale: info.scale, maps: { ...info.maps } }));
  const fog = data.fogHeight(mapPath);
  return Object.freeze({
    wallHeight: (id: string) => data.wallHeight(mapPath, id),
    wallMaterial: (id: string) => data.wallMaterial(mapPath, id),
    doorProp: (id: string) => data.doorProp(mapPath, id),
    lightHeight: (id: string) => data.lightHeight(mapPath, id),
    fogHeight: fog,
    ambient: data.ambient(mapPath),
    props: data.props(mapPath).map((prop) => ({ id: prop.id, path: prop.glb, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.rotation })),
    materials: used,
  });
}

/** A material's maps by role, as the wire names them. */
export function rolesOf(maps: MaterialMaps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of ['color', 'roughness', 'ao', 'arm', 'metalness'] as const) {
    const path = maps[role];
    if (path) out[role] = path;
  }
  if (maps.normal) out[maps.normalDirectX ? 'normal-dx' : 'normal'] = maps.normal;
  return out;
}

/**
 * Materials' maps and scale, read from the vault and kept: `info` answers at once (null the first time, while the
 * settings file is read) and `changed` is called once it knows. `forget` drops what a changed file may alter.
 */
export class MaterialIndex implements MaterialView {
  private readonly known = new Map<string, MaterialInfo | null>();
  private readonly reading = new Set<string>();

  constructor(private readonly vault: Pick<Vault, 'getAbstractFileByPath' | 'read'>, private readonly changed: () => void) {}

  info(folder: string): MaterialInfo | null {
    if (this.known.has(folder)) return this.known.get(folder) ?? null;
    if (!this.reading.has(folder)) void this.read(folder);
    return null;
  }

  /** A material file changed somewhere: everything is read again when next asked. */
  forgetAll(): void {
    this.known.clear();
  }

  forget(path: string): void {
    for (const folder of [...this.known.keys()]) if (path === folder || path.startsWith(`${folder}/`)) this.known.delete(folder);
  }

  private async read(folder: string): Promise<void> {
    this.reading.add(folder);
    try {
      const found = this.vault.getAbstractFileByPath(folder) as TFolder | null;
      const files = found && 'children' in found ? found.children.filter((child) => !('children' in child)).map((child) => child.path) : [];
      const maps = pickMaps(files);
      const settings = this.vault.getAbstractFileByPath(`${folder}/${MATERIAL_SETTINGS_FILE}`) as TFile | null;
      const text = settings && !('children' in settings) ? await this.vault.read(settings) : null;
      this.known.set(folder, maps ? { scale: readMaterialSettings(text).scale, maps: rolesOf(maps) } : null);
    } catch (error) {
      console.warn('[Tabletop] Could not read a material for Connect:', error);
      this.known.set(folder, null);
    } finally {
      this.reading.delete(folder);
    }
    this.changed();
  }
}
