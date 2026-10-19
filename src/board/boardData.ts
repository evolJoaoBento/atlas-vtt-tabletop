/**
 * What the board remembers per map besides the minis: how each token without a mini is shown (a disc, the default, or
 * a standee) and the props standing on the map. Kept in Tabletop's own data, never in the map file. Follows vault
 * renames and deletions the way the mini assignments do. Pure, so it is tested without Obsidian.
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
}

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
  return out.styles || out.props ? out : null;
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
    const kept = tidy({ styles, props });
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
      next[to] = { ...map, ...(props ? { props } : {}) };
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
      const kept = tidy({ ...map, props });
      if (kept) next[mapPath] = kept;
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }
}
