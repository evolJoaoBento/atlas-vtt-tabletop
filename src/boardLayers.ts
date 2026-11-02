/**
 * The scenes stacked with a map (elevation layers), as Connect reads them to put them on its players' boards: for each
 * other scene of the map's stack, its floor image, grid, and the walls, doors, lights and props the GM gave it, with
 * where it stands relative to the map (its height and its place on the plane). Tokens, pins, notes and fog stay out:
 * players see the form of a layer, never what is on it. The scenes are read from the vault and kept; `layers` answers
 * at once (without a scene not read yet) and `changed` is called once it is.
 */
import type { TFile, Vault } from 'obsidian';
import type { BoardData } from './board/boardData';
import { NO_PLACEMENT, relativeTo } from './board/layerPlacement';
import { readMap, type BoardMap } from './board/mapModel';
import type { BoardLayerLook } from './connectContract';
import type { MaterialInfo, MaterialView } from './boardLook';

/** Scenes read from the vault and kept until their file changes. */
export class LayerIndex {
  private readonly known = new Map<string, BoardMap | null>();
  private readonly reading = new Set<string>();

  constructor(private readonly vault: Pick<Vault, 'getAbstractFileByPath' | 'read'>, private readonly changed: () => void) {}

  /** The scene's map as read, or null while it is read (or cannot be). */
  map(path: string): BoardMap | null {
    if (this.known.has(path)) return this.known.get(path) ?? null;
    if (!this.reading.has(path)) void this.read(path);
    return null;
  }

  /** Whether `path` is a scene read before (so a change to its file matters to a stack that shows it). */
  has(path: string): boolean {
    return this.known.has(path);
  }

  forget(path: string): void {
    this.known.delete(path);
  }

  forgetAll(): void {
    this.known.clear();
  }

  private async read(path: string): Promise<void> {
    this.reading.add(path);
    try {
      const file = this.vault.getAbstractFileByPath(path) as TFile | null;
      this.known.set(path, file && !('children' in file) ? readMap(path, await this.vault.read(file), null) : null);
    } catch (error) {
      console.warn('[Tabletop] Could not read a stacked scene for Connect:', error);
      this.known.set(path, null);
    } finally {
      this.reading.delete(path);
    }
    this.changed();
  }
}

const isDefault = (info: MaterialInfo): boolean => info.tuning === undefined;

/**
 * The other scenes of `mapPath`'s stack, as Connect sends them, lowest first. Empty when the map is on its own, and for a
 * scene not read yet (Connect hears of it through `changed`).
 */
export function layersFor(data: BoardData, materials: MaterialView, scenes: Pick<LayerIndex, 'map'>, mapPath: string): BoardLayerLook[] {
  const stack = data.stackOf(mapPath);
  const mine = stack.find((member) => member.path === mapPath);
  if (!mine) return [];
  const out: BoardLayerLook[] = [];
  for (const member of stack) {
    if (member.path === mapPath) continue;
    const map = scenes.map(member.path);
    if (!map || !map.background) continue;
    const used = data.usedMaterials(member.path)
      .map((id) => ({ id, info: materials.info(id) }))
      .filter((entry): entry is { id: string; info: MaterialInfo } => entry.info !== null)
      .map(({ id, info }) => ({ id, scale: info.scale, maps: { ...info.maps }, ...(isDefault(info) ? {} : { tuning: { ...info.tuning! } }) }));
    const placement = relativeTo(mine.placement ?? NO_PLACEMENT, member.placement);
    out.push({
      elevation: member.elevation - mine.elevation,
      stands: { x: placement.x, y: placement.y, turn: placement.turn },
      image: map.background,
      grid: { size: map.grid.size, offsetX: map.grid.offsetX, offsetY: map.grid.offsetY },
      walls: map.walls.map((wall) => ({
        id: wall.id, type: wall.type, p1: { ...wall.p1 }, p2: { ...wall.p2 }, closed: wall.closed, direction: wall.direction, blocks: wall.blocks, limited: wall.limited, chain: wall.chain,
        height: data.wallHeight(member.path, wall.id), material: data.wallMaterial(member.path, wall.id), doorProp: data.doorProp(member.path, wall.id), flip: data.doorFlip(member.path, wall.id),
      })),
      lights: map.lights.filter((light) => light.tokenId === null && !light.hidden).map((light) => ({
        id: light.id, x: light.x, y: light.y, height: data.lightHeight(member.path, light.id), bright: light.bright, dim: light.dim, color: light.color, intensity: light.intensity,
        animation: light.animation === 'none' ? null : light.animation, angle: light.angle, rotation: light.rotation, darkness: light.darkness, activeBelowAmbient: light.activeBelowAmbient,
      })),
      props: data.props(member.path).map((prop) => ({ id: prop.id, path: prop.glb, x: prop.x, y: prop.y, scale: prop.scale, turn: prop.rotation })),
      materials: used,
      fogHeight: data.fogHeight(member.path),
      wallThickness: data.wallThickness(member.path),
    });
  }
  return out.sort((a, b) => a.elevation - b.elevation);
}
