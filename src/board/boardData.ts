/**
 * What the board remembers per map besides the minis: how each token without a mini is shown (a disc, the default, or
 * a standee), the props standing on the map, how tall its fog of war stands, the material painted on each wall and
 * door, the prop a door is replaced with, how high each light hangs, and how bright the board's ambient light is.
 * It also records which maps are elevation layers of another (a balcony, an upper floor), and how high. Kept in
 * Tabletop's own data, never in the map file. Follows vault renames and deletions the way the mini assignments
 * do. Pure, so it is tested without Obsidian.
 */

export type TokenStyle = 'disc' | 'standee';

export interface PropPlacement {
  readonly id: string;
  /** Vault path of the prop's GLB. */
  readonly glb: string;
  /** Where it stands, in the map image's pixels. */
  readonly x: number;
  readonly y: number;
  /** Degrees, clockwise seen from above. */
  readonly rotation: number;
  readonly scale: number;
}

interface MapData {
  styles?: Record<string, TokenStyle>;
  props?: PropPlacement[];
  /** How tall the fog stands, in grid squares; kept only when it is not the default. */
  fogHeight?: number;
  /** Wall (or door) id to the vault folder of the material painted on it. */
  wallMaterials?: Record<string, string>;
  /** Door id to the vault path of the prop GLB that stands in for its leaf. */
  doorProps?: Record<string, string>;
  /** Wall (or door) id to its own height, in grid squares; unset stands it as tall as the fog. */
  wallHeights?: Record<string, number>;
  /** Light id (or the id of the token carrying it) to its height above the map, in grid squares. */
  lightHeights?: Record<string, number>;
  /** The board's ambient light, 0 (pitch black) to 1 (daylight); unset follows Atlas's scene light. */
  ambient?: number;
  /** How thick its walls stand, as a share of a grid square; kept only when it is not the default. */
  wallThickness?: number;
  /** This map is a layer of another, standing above it (or below, if negative). */
  layer?: ElevationLayer;
}

/** A map stacked on another: the base map's path, and how many grid squares above it this one stands. */
export interface ElevationLayer {
  readonly base: string;
  readonly elevation: number;
}

/** One map of a stack, with its height above the base map in grid squares. */
export interface StackMember {
  readonly path: string;
  readonly elevation: number;
}

/** Fog stands one square tall unless the GM says otherwise. */
export const DEFAULT_FOG_HEIGHT = 1;

/** Walls stand an eighth of a square thick or so unless the GM says otherwise. */
export const DEFAULT_WALL_THICKNESS = 0.12;

export type BoardDataJSON = Record<string, MapData>;

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

function readProp(raw: unknown): PropPlacement | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.glb !== 'string' || raw.glb === '') return null;
  return { id: raw.id, glb: raw.glb, x: finite(raw.x, 0), y: finite(raw.y, 0), rotation: finite(raw.rotation, 0), scale: finite(raw.scale, 1) };
}

/** Drops empty parts, so a map with nothing left is not kept. */
function tidy(map: MapData): MapData | null {
  const out: MapData = {};
  if (map.styles && Object.keys(map.styles).length > 0) out.styles = map.styles;
  if (map.props && map.props.length > 0) out.props = map.props;
  if (map.fogHeight !== undefined && map.fogHeight !== DEFAULT_FOG_HEIGHT) out.fogHeight = map.fogHeight;
  if (map.wallMaterials && Object.keys(map.wallMaterials).length > 0) out.wallMaterials = map.wallMaterials;
  if (map.doorProps && Object.keys(map.doorProps).length > 0) out.doorProps = map.doorProps;
  if (map.lightHeights && Object.keys(map.lightHeights).length > 0) out.lightHeights = map.lightHeights;
  if (map.wallHeights && Object.keys(map.wallHeights).length > 0) out.wallHeights = map.wallHeights;
  if (map.ambient !== undefined) out.ambient = map.ambient;
  if (map.wallThickness !== undefined && map.wallThickness !== DEFAULT_WALL_THICKNESS) out.wallThickness = map.wallThickness;
  if (map.layer) out.layer = map.layer;
  return Object.keys(out).length > 0 ? out : null;
}

/** The string values of a record, the others dropped. */
function strings(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (isObj(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'string' && value !== '') out[key] = value;
  return out;
}

/** The light heights: numbers from 0 up. */
function heights(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(raw)) for (const [key, value] of Object.entries(raw)) if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
  return out;
}

function readLayer(raw: unknown): ElevationLayer | undefined {
  return isObj(raw) && typeof raw.base === 'string' && raw.base !== '' && typeof raw.elevation === 'number' && Number.isFinite(raw.elevation)
    ? { base: raw.base, elevation: raw.elevation }
    : undefined;
}

/** Reads saved data, dropping anything malformed. Only standees are stored: a disc is the default. */
export function readBoardData(raw: unknown): BoardDataJSON {
  const out: BoardDataJSON = {};
  if (!isObj(raw)) return out;
  for (const [path, value] of Object.entries(raw)) {
    if (!isObj(value)) continue;
    const styles: Record<string, TokenStyle> = {};
    if (isObj(value.styles)) for (const [id, style] of Object.entries(value.styles)) if (style === 'standee') styles[id] = style;
    const props = Array.isArray(value.props) ? value.props.map(readProp).filter((prop): prop is PropPlacement => prop !== null) : [];
    const fogHeight = typeof value.fogHeight === 'number' && Number.isFinite(value.fogHeight) && value.fogHeight >= 0 ? value.fogHeight : undefined;
    const ambient = typeof value.ambient === 'number' && value.ambient >= 0 && value.ambient <= 1 ? value.ambient : undefined;
    const wallThickness = typeof value.wallThickness === 'number' && Number.isFinite(value.wallThickness) && value.wallThickness > 0 ? value.wallThickness : undefined;
    const layer = readLayer(value.layer);
    const kept = tidy({
      styles, props, ...(layer && { layer }), ...(fogHeight !== undefined && { fogHeight }),
      wallMaterials: strings(value.wallMaterials), doorProps: strings(value.doorProps), lightHeights: heights(value.lightHeights),
      wallHeights: heights(value.wallHeights),
      ...(ambient !== undefined && { ambient }),
      ...(wallThickness !== undefined && { wallThickness }),
    });
    if (kept) out[path] = kept;
  }
  return out;
}

export class BoardData {
  private data: BoardDataJSON;
  private readonly listeners = new Set<(mapPath: string | null) => void>();

  constructor(initial: BoardDataJSON = {}) {
    this.data = initial;
  }

  toJSON(): BoardDataJSON {
    return this.data;
  }

  onChange(listener: (mapPath: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private changed(mapPath: string | null): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(mapPath);
      } catch (error) {
        console.error('[Tabletop] A board data listener failed:', error);
      }
    }
  }

  private put(mapPath: string, map: MapData): void {
    const kept = tidy(map);
    const next = { ...this.data };
    if (kept) next[mapPath] = kept;
    else delete next[mapPath];
    this.data = next;
    this.changed(mapPath);
  }

  style(mapPath: string, tokenId: string): TokenStyle {
    return this.data[mapPath]?.styles?.[tokenId] ?? 'disc';
  }

  setStyle(mapPath: string, tokenId: string, style: TokenStyle): void {
    if (this.style(mapPath, tokenId) === style) return;
    const map = this.data[mapPath] ?? {};
    const styles = { ...(map.styles ?? {}) };
    if (style === 'disc') delete styles[tokenId];
    else styles[tokenId] = style;
    this.put(mapPath, { ...map, styles });
  }

  /** How tall the map's fog stands, in grid squares. */
  fogHeight(mapPath: string): number {
    return this.data[mapPath]?.fogHeight ?? DEFAULT_FOG_HEIGHT;
  }

  setFogHeight(mapPath: string, height: number): void {
    if (!Number.isFinite(height) || height < 0 || this.fogHeight(mapPath) === height) return;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), fogHeight: height });
  }

  /** How thick the map's walls stand, as a share of a grid square. */
  wallThickness(mapPath: string): number {
    return this.data[mapPath]?.wallThickness ?? DEFAULT_WALL_THICKNESS;
  }

  /** None or less is no wall at all: refused, as is anything not a number. */
  setWallThickness(mapPath: string, thickness: number): void {
    if (!Number.isFinite(thickness) || thickness <= 0 || this.wallThickness(mapPath) === thickness) return;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), wallThickness: thickness });
  }

  /** The material painted on a wall or door: its vault folder, or null for the plain look. */
  wallMaterial(mapPath: string, wallId: string): string | null {
    return this.data[mapPath]?.wallMaterials?.[wallId] ?? null;
  }

  /** The materials painted anywhere on a map, each once, in the order first painted. */
  usedMaterials(mapPath: string): string[] {
    return [...new Set(Object.values(this.data[mapPath]?.wallMaterials ?? {}))];
  }

  /** Paints walls (one segment, or a whole drawn wall) with a material; null takes it off. */
  setWallMaterial(mapPath: string, wallIds: readonly string[], material: string | null): void {
    const map = this.data[mapPath] ?? {};
    const wallMaterials = { ...(map.wallMaterials ?? {}) };
    for (const id of wallIds) {
      if (material) wallMaterials[id] = material;
      else delete wallMaterials[id];
    }
    this.put(mapPath, { ...map, wallMaterials });
  }

  /** A wall's or door's own height in grid squares; null when it stands as tall as the fog. */
  wallHeight(mapPath: string, wallId: string): number | null {
    return this.data[mapPath]?.wallHeights?.[wallId] ?? null;
  }

  /** Sets walls' own height (one segment, or a whole wall); null stands them as tall as the fog again. */
  setWallHeight(mapPath: string, wallIds: readonly string[], height: number | null): void {
    if (height !== null && (!Number.isFinite(height) || height < 0)) return;
    const map = this.data[mapPath] ?? {};
    const wallHeights = { ...(map.wallHeights ?? {}) };
    for (const id of wallIds) {
      if (height === null) delete wallHeights[id];
      else wallHeights[id] = height;
    }
    this.put(mapPath, { ...map, wallHeights });
  }

  /** The prop standing in for a door's leaf, or null for the plain door. */
  doorProp(mapPath: string, doorId: string): string | null {
    return this.data[mapPath]?.doorProps?.[doorId] ?? null;
  }

  setDoorProp(mapPath: string, doorId: string, glb: string | null): void {
    if (this.doorProp(mapPath, doorId) === glb) return;
    const map = this.data[mapPath] ?? {};
    const doorProps = { ...(map.doorProps ?? {}) };
    if (glb) doorProps[doorId] = glb;
    else delete doorProps[doorId];
    this.put(mapPath, { ...map, doorProps });
  }

  /** How high a light hangs, in grid squares; null when it was never set. */
  lightHeight(mapPath: string, lightId: string): number | null {
    return this.data[mapPath]?.lightHeights?.[lightId] ?? null;
  }

  /** Sets a light's height in squares; null puts it back at its default. */
  setLightHeight(mapPath: string, lightId: string, height: number | null): void {
    if (height !== null && (!Number.isFinite(height) || height < 0)) return;
    if (this.lightHeight(mapPath, lightId) === height) return;
    const map = this.data[mapPath] ?? {};
    const lightHeights = { ...(map.lightHeights ?? {}) };
    if (height === null) delete lightHeights[lightId];
    else lightHeights[lightId] = height;
    this.put(mapPath, { ...map, lightHeights });
  }

  /** The board's ambient light (0–1); null when it follows Atlas's scene light. */
  ambient(mapPath: string): number | null {
    return this.data[mapPath]?.ambient ?? null;
  }

  setAmbient(mapPath: string, ambient: number): void {
    if (!Number.isFinite(ambient) || ambient < 0 || ambient > 1 || this.ambient(mapPath) === ambient) return;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), ambient });
  }

  props(mapPath: string): readonly PropPlacement[] {
    return this.data[mapPath]?.props ?? [];
  }

  addProp(mapPath: string, prop: Omit<PropPlacement, 'id'>): PropPlacement {
    const placed: PropPlacement = { ...prop, id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` };
    const map = this.data[mapPath] ?? {};
    this.put(mapPath, { ...map, props: [...(map.props ?? []), placed] });
    return placed;
  }

  moveProp(mapPath: string, id: string, x: number, y: number): void {
    const map = this.data[mapPath];
    if (!map?.props?.some((prop) => prop.id === id)) return;
    this.put(mapPath, { ...map, props: map.props.map((prop) => (prop.id === id ? { ...prop, x, y } : prop)) });
  }

  /** The map this one is a layer of, and how high it stands above it; null for a map that is not a layer. */
  layerOf(mapPath: string): ElevationLayer | null {
    return this.data[mapPath]?.layer ?? null;
  }

  /**
   * Stacks a map on another, `elevation` grid squares above it. A map stacked on a layer joins that layer's stack, and
   * a map that has layers of its own cannot become one (nor a map be its own base). Returns whether it was done.
   */
  setLayer(mapPath: string, base: string, elevation: number): boolean {
    if (!Number.isFinite(elevation)) return false;
    const root = this.data[base]?.layer ?? null;
    // On a layer, the elevation is given from that layer: the stack is measured from its base.
    const target = root ? root.base : base;
    const height = Math.round((root ? root.elevation + elevation : elevation) * 100) / 100;
    if (target === mapPath || this.layersOf(mapPath).length > 0) return false;
    const current = this.data[mapPath]?.layer;
    if (current && current.base === target && current.elevation === height) return true;
    this.put(mapPath, { ...(this.data[mapPath] ?? {}), layer: { base: target, elevation: height } });
    return true;
  }

  clearLayer(mapPath: string): void {
    const map = this.data[mapPath];
    if (!map?.layer) return;
    const { layer: _layer, ...rest } = map;
    this.put(mapPath, rest);
  }

  /** The maps stacked directly on this base. */
  layersOf(base: string): StackMember[] {
    return Object.entries(this.data)
      .filter(([, map]) => map.layer?.base === base)
      .map(([path, map]) => ({ path, elevation: map.layer!.elevation }));
  }

  /**
   * The stack a map belongs to, lowest first, with heights measured from the base map; empty for a map on its own.
   * Opening any of them shows them all.
   */
  stackOf(mapPath: string): StackMember[] {
    const base = this.data[mapPath]?.layer?.base ?? mapPath;
    const layers = this.layersOf(base);
    if (layers.length === 0) return [];
    return [{ path: base, elevation: 0 }, ...layers].sort((a, b) => a.elevation - b.elevation || a.path.localeCompare(b.path));
  }

  removeProp(mapPath: string, id: string): void {
    const map = this.data[mapPath];
    if (!map?.props?.some((prop) => prop.id === id)) return;
    this.put(mapPath, { ...map, props: map.props.filter((prop) => prop.id !== id) });
  }

  /** Follows a vault rename: of a map or a folder of maps, and of a prop's GLB or a folder of GLBs. */
  rename(oldPath: string, newPath: string): void {
    const moved = (path: string): string | null => {
      if (path === oldPath) return newPath;
      if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
      return null;
    };
    let touched = false;
    const next: BoardDataJSON = {};
    for (const [path, map] of Object.entries(this.data)) {
      const to = moved(path) ?? path;
      if (to !== path) touched = true;
      const props = map.props?.map((prop) => {
        const glb = moved(prop.glb);
        if (!glb) return prop;
        touched = true;
        return { ...prop, glb };
      });
      const follow = (paths: Record<string, string> | undefined): Record<string, string> | undefined => {
        if (!paths) return undefined;
        return Object.fromEntries(Object.entries(paths).map(([id, path]) => {
          const to = moved(path);
          if (to) touched = true;
          return [id, to ?? path];
        }));
      };
      const wallMaterials = follow(map.wallMaterials);
      const doorProps = follow(map.doorProps);
      const base = map.layer ? moved(map.layer.base) : null;
      if (base) touched = true;
      next[to] = { ...map, ...(props ? { props } : {}), ...(wallMaterials ? { wallMaterials } : {}), ...(doorProps ? { doorProps } : {}), ...(map.layer && base ? { layer: { ...map.layer, base } } : {}) };
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }

  /** Follows a deletion: a deleted map takes its data, a deleted GLB its props. */
  deleted(path: string): void {
    const under = (candidate: string): boolean => candidate === path || candidate.startsWith(`${path}/`);
    let touched = false;
    const next: BoardDataJSON = {};
    for (const [mapPath, map] of Object.entries(this.data)) {
      if (under(mapPath)) { touched = true; continue; }
      const props = map.props?.filter((prop) => !under(prop.glb));
      if (props && props.length !== map.props?.length) touched = true;
      const keep = (paths: Record<string, string> | undefined): Record<string, string> | undefined => {
        if (!paths) return undefined;
        const left = Object.fromEntries(Object.entries(paths).filter(([, path]) => !under(path)));
        if (Object.keys(left).length !== Object.keys(paths).length) touched = true;
        return left;
      };
      // A layer whose base is gone is a map on its own again.
      const orphan = map.layer !== undefined && under(map.layer.base);
      if (orphan) touched = true;
      const { layer: _layer, ...bare } = map;
      const kept = tidy({ ...(orphan ? bare : map), props, wallMaterials: keep(map.wallMaterials), doorProps: keep(map.doorProps) });
      if (kept) next[mapPath] = kept;
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }
}
