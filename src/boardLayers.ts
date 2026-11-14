/**
 * The scenes stacked with a map (elevation layers), as Connect reads them to put them on its players' boards: for each
 * other scene of the map's stack, its floor image, grid, and the walls, doors, lights and props the GM gave it, with
 * where it stands relative to the map (its height and its place on the plane). Tokens, pins, notes and fog stay out:
 * players see the form of a layer, never what is on it. The scenes are read from the vault and kept; `layers` answers
 * at once (without a scene not read yet) and `changed` is called once it is.
 */
import { defaultsUsed, materialWith, type MaterialDefaults } from './materialDefaults';
import type { TFile, Vault } from 'obsidian';
import type { BoardData } from './board/boardData';
import { readMap, type BoardMap } from './board/mapModel';
import { levelRise, onFirstLevel, propsOnLevel, resolveLevel } from './board/levels';
import type { BoardLayerLook } from './connectContract';
import { waterOf, type MaterialInfo, type MaterialView } from './boardLook';
import { extrasOf } from './board/recordExtras';

/**
 * Scenes read from the vault and kept until their file changes. A scene whose file changed is answered for as it
 * was read last until the new reading is in (and `changed` says so): what is built from it never goes blank between
 * a save and its reading.
 */
export class LayerIndex {
  private readonly known = new Map<string, BoardMap | null>();
  private readonly texts = new Map<string, string>();
  /** A scene read at one of its levels, by path and level. */
  private readonly atLevel = new Map<string, BoardMap | null>();
  private readonly reading = new Set<string>();
  /** Scenes whose file changed while they were being read: read once more. */
  private readonly again = new Set<string>();

  constructor(private readonly vault: Pick<Vault, 'getAbstractFileByPath' | 'read'>, private readonly changed: () => void) {}

  /** The scene's map as read, or null while it is read (or cannot be). */
  map(path: string): BoardMap | null {
    if (this.known.has(path)) return this.known.get(path) ?? null;
    if (!this.reading.has(path)) void this.read(path);
    return null;
  }

  /** The scene's map at one of its levels (Atlas levels), or null while it is read (or cannot be). */
  mapAt(path: string, level: string): BoardMap | null {
    const key = `${path}\n${level}`;
    if (this.atLevel.has(key)) return this.atLevel.get(key) ?? null;
    const text = this.texts.get(path);
    if (text === undefined) {
      this.map(path);
      return null;
    }
    let map: BoardMap | null = null;
    try {
      map = readMap(path, text, level);
    } catch {
      map = null;
    }
    this.atLevel.set(key, map);
    return map;
  }

  /** Whether `path` is a scene read before (so a change to its file matters to a stack that shows it). */
  has(path: string): boolean {
    return this.known.has(path);
  }

  /** The scene's file changed: it is read again; until then it is answered for as it was. */
  forget(path: string): void {
    if (!this.known.has(path)) return;
    if (!this.reading.has(path)) void this.read(path);
    else this.again.add(path);
  }

  forgetAll(): void {
    this.known.clear();
    this.texts.clear();
    this.atLevel.clear();
  }

  private async read(path: string): Promise<void> {
    this.reading.add(path);
    try {
      const file = this.vault.getAbstractFileByPath(path) as TFile | null;
      const text = file && !('children' in file) ? await this.vault.read(file) : null;
      const map = text !== null ? readMap(path, text, null) : null;
      if (text !== null) this.texts.set(path, text);
      else this.texts.delete(path);
      this.known.set(path, map);
    } catch (error) {
      console.warn('[Tabletop] Could not read a stacked scene for Connect:', error);
      this.texts.delete(path);
      this.known.set(path, null);
    } finally {
      this.reading.delete(path);
      // Its levels are read from the new text when next asked for.
      for (const key of [...this.atLevel.keys()]) if (key.startsWith(`${path}\n`)) this.atLevel.delete(key);
    }
    if (this.again.delete(path)) void this.read(path);
    this.changed();
  }
}

const isDefault = (info: MaterialInfo): boolean => info.tuning === undefined;

/**
 * The other scenes of `mapPath`'s stack, as Connect sends them, lowest first. Empty when the map is on its own, and for a
 * scene not read yet (Connect hears of it through `changed`).
 */
export function layersFor(data: BoardData, materials: MaterialView, scenes: Pick<LayerIndex, 'map'> & Partial<Pick<LayerIndex, 'mapAt'>>, mapPath: string, viewedLevel?: string | null, defaults: MaterialDefaults | null = null): BoardLayerLook[] {
  // A scene with Atlas levels: its other levels are its layers.
  const own = scenes.mapAt ? scenes.map(mapPath) : null;
  if (own && own.levels.length > 1 && scenes.mapAt) return levelLayersFor(data, materials, scenes as Pick<LayerIndex, 'map' | 'mapAt'>, mapPath, own, viewedLevel ?? null, defaults);
  // A scene without levels has no layers: a scene stack of older Tabletop is not sent (it becomes levels: `stackMigration.ts`).
  return [];
}

/** Game units a square of the scene spans (its own override, else its grid's distance); five where it says none. */
function unitsOf(map: BoardMap): number {
  const grid = (map.rawGrid ?? {}) as { unitDistanceOverride?: unknown; unitDistance?: unknown };
  for (const value of [grid.unitDistanceOverride, grid.unitDistance]) if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return 5;
}

/** The other levels of a scene with Atlas levels, as Connect sends them, lowest first: each at its height above the level shown. */
function levelLayersFor(data: BoardData, materials: MaterialView, scenes: Pick<LayerIndex, 'map' | 'mapAt'>, mapPath: string, own: BoardMap, viewedLevel: string | null, defaults: MaterialDefaults | null): BoardLayerLook[] {
  const shown = resolveLevel(own.levels, viewedLevel);
  const units = unitsOf(own);
  const legacy = data.legacyExtras(mapPath);
  const used = [...new Set(own.levels.flatMap((level) => { const map = scenes.mapAt(mapPath, level.id); const extras = extrasOf(map, legacy); return map ? [...extras.usedMaterials(), ...defaultsUsed(map.walls, (index) => extras.wallMaterial(map.walls[index]!.id), defaults)] : []; }))]
    .map((id) => ({ id, info: materials.info(id) }))
    .filter((entry): entry is { id: string; info: MaterialInfo } => entry.info !== null)
    .map(({ id, info }) => ({ id, scale: info.scale, maps: { ...info.maps }, ...(isDefault(info) ? {} : { tuning: { ...info.tuning! } }) }));
  const out: BoardLayerLook[] = [];
  // A light on several levels lights the shown one already: no layer lights it twice.
  const lit = new Set((shown !== null ? scenes.mapAt(mapPath, shown)?.lights ?? [] : []).map((light) => light.id));
  for (const level of own.levels) {
    if (level.id === shown) continue;
    if (data.layerHidden(`${mapPath}#atlas-level:${level.id}`)) continue;
    const map = scenes.mapAt(mapPath, level.id);
    if (!map || !map.background) continue;
    // The level's own liquids; a mask painted before water was Atlas's lies on the first level.
    const water = waterOf(map, onFirstLevel(own.levels, level.id) ? data.legacyWater(mapPath) : null);
    const extras = extrasOf(map, legacy);
    out.push({
      elevation: levelRise(own.levels, shown, level.id, units),
      stands: { x: 0, y: 0, turn: 0 },
      image: map.background,
      // A level Atlas fitted to the scene's grid: its fit goes too, so players lay its image under the records that moved with it.
      grid: { size: map.grid.size, offsetX: map.grid.offsetX, offsetY: map.grid.offsetY, ...(map.grid.mapStretch ? { mapStretch: { ...map.grid.mapStretch } } : {}) },
      walls: map.walls.map((wall) => ({
        id: wall.id, type: wall.type, p1: { ...wall.p1 }, p2: { ...wall.p2 }, closed: wall.closed, direction: wall.direction, blocks: wall.blocks, limited: wall.limited, chain: wall.chain,
        height: extras.wallHeight(wall.id), window: extras.windowOf(wall.id), width: extras.wallWidth(wall.id), material: materialWith(extras.wallMaterial(wall.id), wall, defaults), doorProp: extras.doorProp(wall.id), flip: extras.doorFlip(wall.id),
      })),
      lights: map.lights.filter((light) => light.tokenId === null && !light.hidden && !lit.has(light.id)).map((light) => ({
        id: light.id, x: light.x, y: light.y, height: extras.lightHeight(light.id), bright: light.bright, dim: light.dim, color: light.color, intensity: light.intensity,
        animation: light.animation === 'none' ? null : light.animation, angle: light.angle, rotation: light.rotation, darkness: light.darkness, activeBelowAmbient: light.activeBelowAmbient,
      })),
      props: propsOnLevel(data.props(mapPath), level.id, own.levels).map((prop) => ({ id: prop.id, path: prop.glb, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.rotation, ...(prop.solid ? { solid: true } : {}), ...(prop.lift ? { lift: prop.lift } : {}) })),
      materials: used,
      fogHeight: data.fogHeight(mapPath),
      wallThickness: data.wallThickness(mapPath),
      ...water,
    });
  }
  return out.sort((a, b) => a.elevation - b.elevation);
}
