/**
 * What the board remembers per map besides the minis: how each token without a mini is shown (a disc, the default, or
 * a standee), the props standing on the map, how tall its fog of war stands, the material painted on each wall and
 * door, the prop a door is replaced with, how high each light hangs, and how bright the board's ambient light is.
 * Kept in Tabletop's own data, never in the map file. Follows vault renames and deletions the way the mini assignments
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
  /** Light id (or the id of the token carrying it) to its height above the map, in grid squares. */
  lightHeights?: Record<string, number>;
  /** The board's ambient light, 0 (pitch black) to 1 (daylight); unset follows Atlas's scene light. */
  ambient?: number;
}

/** Fog stands one square tall unless the GM says otherwise. */
export const DEFAULT_FOG_HEIGHT = 1;

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
  if (map.ambient !== undefined) out.ambient = map.ambient;
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
    const kept = tidy({
      styles, props, ...(fogHeight !== undefined && { fogHeight }),
      wallMaterials: strings(value.wallMaterials), doorProps: strings(value.doorProps), lightHeights: heights(value.lightHeights),
      ...(ambient !== undefined && { ambient }),
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

  /** The material painted on a wall or door: its vault folder, or null for the plain look. */
  wallMaterial(mapPath: string, wallId: string): string | null {
    return this.data[mapPath]?.wallMaterials?.[wallId] ?? null;
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
      next[to] = { ...map, ...(props ? { props } : {}), ...(wallMaterials ? { wallMaterials } : {}), ...(doorProps ? { doorProps } : {}) };
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
      const kept = tidy({ ...map, props, wallMaterials: keep(map.wallMaterials), doorProps: keep(map.doorProps) });
      if (kept) next[mapPath] = kept;
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }
}
