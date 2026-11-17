/**
 * A map's look on the board as Connect reads it (`BoardLook`): the heights, materials, door props, props, fog height
 * and ambient light the GM gave it: what is set on a wall, a door or a light from Atlas's own records (`extras`), the
 * rest from Tabletop's own data. Materials are listed only once their settings are read
 * (`MaterialIndex`), so nothing is guessed; Connect hears when they are.
 */
import { onFirstLevel, propsOnLevel, resolveLevel, type BoardLevel } from './board/levels';
import { readMapState, type BoardMap } from './board/mapModel';
import type { TFile, TFolder, Vault } from 'obsidian';
import type { BoardData } from './board/boardData';
import type { BoardWall } from './board/walls';
import { extrasOf, type RecordExtras } from './board/recordExtras';
import { wireWater } from './board/liquids';
import { defaultsUsed, materialWith, type MaterialDefaults } from './materialDefaults';
import { placedTable, type ArTable } from './arTable';
import type { BoardGroundLook, BoardLayerLook, BoardLook, BoardShapeLook, BoardWater } from './connectContract';
import type { TerrainShape } from './board/terrainShapes';
import type { GroundSettings } from './board/ground';
import type { BackgroundSettings } from './background/backgroundData';
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

/**
 * The maps a look is built from: the scene (`own`) and, where it has levels, the level players are shown (`levelMap`).
 * A map Atlas holds is read from Atlas's store (`held`: its state), so what was just set, or undone, is in the look at
 * once, saved or not; any other map from its file as last read (`scenes`).
 */
export function lookMaps(mapPath: string, viewedLevel: string | null, scenes: { map(path: string): BoardMap | null; mapAt(path: string, level: string): BoardMap | null }, held: unknown): { own: BoardMap | null; shown: { levels: readonly BoardLevel[]; level: string | null } | undefined; levelMap: BoardMap | null } {
  const fromStore = (level?: string | null): BoardMap | null => {
    if (held === null || held === undefined) return null;
    try { return readMapState(mapPath, held, level); } catch { return null; }
  };
  const stored = fromStore();
  const own = stored ?? scenes.map(mapPath);
  const shown = own && own.levels.length > 1 ? { levels: own.levels, level: resolveLevel(own.levels, viewedLevel) } : undefined;
  const levelMap = shown?.level ? (stored ? fromStore(shown.level) : scenes.mapAt(mapPath, shown.level)) : null;
  return { own, shown, levelMap };
}

export function boardLookFor(data: BoardData, materials: MaterialView, mapPath: string, layers: ReadonlyArray<BoardLayerLook> = [], shown: { levels: readonly BoardLevel[]; level: string | null } = { levels: [], level: null }, defaults: { walls: readonly BoardWall[]; chosen: MaterialDefaults } | null = null, extras: RecordExtras = extrasOf(null, data.legacyExtras(mapPath)), water: { water?: BoardWater } = waterOf(null, onFirstLevel(shown.levels, shown.level) ? data.legacyWater(mapPath) : null), background: (folder: string) => BackgroundSettings | null = () => null): BoardLook {
  // Walls with no material painted wear their kind's default, for players too.
  const wallsById = new Map((defaults?.walls ?? []).map((wall) => [wall.id, wall]));
  const wallMaterial = (id: string): string | null => {
    const painted = extras.wallMaterial(id);
    const wall = wallsById.get(id);
    return wall ? materialWith(painted, wall, defaults?.chosen) : painted;
  };
  const fromDefaults = defaults ? defaultsUsed(defaults.walls, (index) => extras.wallMaterial(defaults.walls[index]!.id), defaults.chosen) : [];
  // The raised shapes of the level shown, and the ground round the map: their materials go with the walls'.
  const shapes = propsOnLevel(data.shapes(mapPath), shown.level, shown.levels);
  const ground = data.ground(mapPath);
  // A painted ground's settings, once read: its materials join the others, and a folder with none (gone, or not read yet) is an empty slot.
  const settings = ground.mode === 'painted' && ground.background ? background(ground.background) : null;
  const slots = settings ? settings.materials.map((folder) => (materials.info(folder) ? folder : '')) : [];
  const used = [...new Set([...extras.usedMaterials(), ...fromDefaults, ...shapeMaterials(shapes), ...(ground.material ? [ground.material] : []), ...slots.filter((folder) => folder !== '')])]
    .map((id) => ({ id, info: materials.info(id) }))
    .filter((entry): entry is { id: string; info: MaterialInfo } => entry.info !== null)
    .map(({ id, info }) => ({ id, scale: info.scale, maps: { ...info.maps }, ...(!info.tuning || isDefault(info.tuning) ? {} : { tuning: { ...info.tuning } }) }));
  const fog = data.fogHeight(mapPath);
  return Object.freeze({
    wallHeight: extras.wallHeight,
    wallMaterial,
    doorProp: extras.doorProp,
    doorFlip: extras.doorFlip,
    windowOf: extras.windowOf,
    wallWidth: extras.wallWidth,
    lightHeight: extras.lightHeight,
    fogHeight: fog,
    wallThickness: data.wallThickness(mapPath),
    ...(layers.length > 0 ? { layers } : {}),
    // The water of the level shown (Atlas's liquids, as the caller read them); props stand on their own level.
    ...water,
    ...arTableOf(data, mapPath),
    ...(shapes.length > 0 ? { shapes: shapes.map(shapeLook) } : {}),
    ground: groundLook(ground, settings && ground.background ? { folder: ground.background, settings, materials: slots } : null),
    props: propsOnLevel(data.props(mapPath), shown.level, shown.levels).map((prop) => ({ id: prop.id, path: prop.glb, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.rotation, ...(prop.solid ? { solid: true } : {}), ...(prop.lift ? { lift: prop.lift } : {}) })),
    materials: used,
  });
}

/** The materials a level's shapes are painted with (tops and sides), by vault folder. */
export function shapeMaterials(shapes: readonly TerrainShape[]): string[] {
  return shapes.flatMap((shape) => [shape.material, typeof shape.sides === 'string' ? shape.sides : undefined]).filter((folder): folder is string => typeof folder === 'string' && folder !== '');
}

/** A shape as Connect reads it: its corners copied, its materials by folder. */
export function shapeLook(shape: TerrainShape): BoardShapeLook {
  return {
    id: shape.id,
    outline: shape.outline.map(({ x, y, h }) => ({ x, y, h })),
    inner: shape.inner.map(({ x, y, h }) => ({ x, y, h })),
    ...(shape.material ? { material: shape.material } : {}),
    ...(shape.sides !== undefined ? { sides: shape.sides } : {}),
  };
}

/**
 * The ground as Connect reads it. A painted ground also carries where its three layer pictures lie (`painted.folder`),
 * its settings, and its material folders by slot (an empty one where the folder is gone); without the settings
 * (`painted` null: not read yet) it says nothing of them, and Connect falls back.
 */
export function groundLook(ground: GroundSettings, painted: { folder: string; settings: BackgroundSettings; materials: readonly string[] } | null = null): BoardGroundLook {
  return {
    mode: ground.mode, ...(ground.material ? { material: ground.material } : {}), noise: ground.noise, strength: ground.strength, fog: ground.fog, margin: ground.margin, tile: ground.tile,
    water: { ...ground.water }, lava: { ...ground.lava }, acid: { ...ground.acid },
    ...(painted ? { painted: { terrain: `${painted.folder}/terrain.png`, material: `${painted.folder}/material.png`, height: `${painted.folder}/height.png`, settings: painted.settings, materials: [...painted.materials] } } : {}),
  };
}

/** Where the players' AR marker sheets lie on the map, placed, for their phones; nothing when the GM placed none. */
export function arTableOf(data: BoardData, mapPath: string): { arTable?: ArTable } {
  const saved = data.arTable(mapPath);
  return saved ? { arTable: placedTable(saved) } : {};
}

/**
 * A level's water for players: the outlines of its liquids as Atlas has them (`map`), the old mask of a map whose
 * painted water was not moved to Atlas yet (`legacy`), and its motion; nothing when it has none.
 */
export function waterOf(map: Pick<BoardMap, 'liquids'> | null, legacy: ReturnType<BoardData['legacyWater']>): { water?: BoardWater } {
  const water = wireWater(map?.liquids ?? [], legacy);
  return water ? { water: water as BoardWater } : {};
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
