/**
 * A map's look on the board as Connect reads it (`BoardLook`): the heights, materials, door props, props, fog height
 * and ambient light the GM gave it, from Tabletop's own data. Materials are listed only once their settings are read
 * (`MaterialIndex`), so nothing is guessed; Connect hears when they are.
 */
import { onFirstLevel, propsOnLevel, type BoardLevel } from './board/levels';
import type { TFile, TFolder, Vault } from 'obsidian';
import type { BoardData } from './board/boardData';
import type { BoardWall } from './board/walls';
import { defaultsUsed, materialWith, type MaterialDefaults } from './materialDefaults';
import { placedTable, type ArTable } from './arTable';
import type { BoardLayerLook, BoardLook, BoardWater } from './connectContract';
import { DEFAULT_TUNING, pickMaps, readMaterialSettings, tuningOf, MATERIAL_SETTINGS_FILE, type MaterialMaps, type MaterialTuning } from './materialMaps';

export interface MaterialInfo {
  scale: number;
  tuning?: MaterialTuning;
  /** Texture role to vault path; a DirectX normal map is the role `normal-dx`. */
  maps: Record<string, string>;
}

export interface MaterialView {
  info(folder: string): MaterialInfo | null;
}

const isDefault = (tuning: MaterialTuning): boolean => tuning.relief === DEFAULT_TUNING.relief && tuning.occlusion === DEFAULT_TUNING.occlusion && tuning.shine === DEFAULT_TUNING.shine && tuning.depth === DEFAULT_TUNING.depth && tuning.displace === DEFAULT_TUNING.displace && tuning.outward === DEFAULT_TUNING.outward;

export function boardLookFor(data: BoardData, materials: MaterialView, mapPath: string, layers: ReadonlyArray<BoardLayerLook> = [], shown: { levels: readonly BoardLevel[]; level: string | null } = { levels: [], level: null }, defaults: { walls: readonly BoardWall[]; chosen: MaterialDefaults } | null = null): BoardLook {
  // Walls with no material painted wear their kind's default, for players too.
  const wallsById = new Map((defaults?.walls ?? []).map((wall) => [wall.id, wall]));
  const wallMaterial = (id: string): string | null => {
    const painted = data.wallMaterial(mapPath, id);
    const wall = wallsById.get(id);
    return wall ? materialWith(painted, wall, defaults?.chosen) : painted;
  };
  const fromDefaults = defaults ? defaultsUsed(defaults.walls, (index) => data.wallMaterial(mapPath, defaults.walls[index]!.id), defaults.chosen) : [];
  const used = [...new Set([...data.usedMaterials(mapPath), ...fromDefaults])]
    .map((id) => ({ id, info: materials.info(id) }))
    .filter((entry): entry is { id: string; info: MaterialInfo } => entry.info !== null)
    .map(({ id, info }) => ({ id, scale: info.scale, maps: { ...info.maps }, ...(!info.tuning || isDefault(info.tuning) ? {} : { tuning: { ...info.tuning } }) }));
  const fog = data.fogHeight(mapPath);
  return Object.freeze({
    wallHeight: (id: string) => data.wallHeight(mapPath, id),
    wallMaterial,
    doorProp: (id: string) => data.doorProp(mapPath, id),
    doorFlip: (id: string) => data.doorFlip(mapPath, id),
    windowOf: (id: string) => data.windowOf(mapPath, id),
    wallWidth: (id: string) => data.wallWidth(mapPath, id),
    lightHeight: (id: string) => data.lightHeight(mapPath, id),
    fogHeight: fog,
    wallThickness: data.wallThickness(mapPath),
    // The board's light is Atlas's scene lighting, which players are sent with the scene: nothing of its own here.
    ambient: null,
    ...(layers.length > 0 ? { layers } : {}),
    // Painted water lies on the scene's first level; props stand on their own level.
    ...(onFirstLevel(shown.levels, shown.level) ? waterOf(data, mapPath) : {}),
    ...arTableOf(data, mapPath),
    props: propsOnLevel(data.props(mapPath), shown.level, shown.levels).map((prop) => ({ id: prop.id, path: prop.glb, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.rotation, ...(prop.solid ? { solid: true } : {}), ...(prop.lift ? { lift: prop.lift } : {}) })),
    materials: used,
  });
}

/** Where the players' AR marker sheets lie on the map, placed, for their phones; nothing when the GM placed none. */
export function arTableOf(data: BoardData, mapPath: string): { arTable?: ArTable } {
  const saved = data.arTable(mapPath);
  return saved ? { arTable: placedTable(saved) } : {};
}

/** The map's painted water with its motion, for players; nothing when it has none. */
export function waterOf(data: BoardData, mapPath: string): { water?: BoardWater } {
  const saved = data.water(mapPath);
  return saved ? { water: { mask: { ...saved.mask }, motion: data.waterMotion(mapPath) } } : {};
}

/** A material's maps by role, as the wire names them. */
export function rolesOf(maps: MaterialMaps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const role of ['color', 'roughness', 'ao', 'arm', 'metalness', 'height'] as const) {
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
      this.known.set(folder, maps ? { scale: readMaterialSettings(text).scale, tuning: tuningOf(readMaterialSettings(text)), maps: rolesOf(maps) } : null);
    } catch (error) {
      console.warn('[Tabletop] Could not read a material for Connect:', error);
      this.known.set(folder, null);
    } finally {
      this.reading.delete(folder);
    }
    this.changed();
  }
}
