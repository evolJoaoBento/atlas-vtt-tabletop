/**
 * Which mini stands on which token: per map path, per Atlas token id. Kept in Tabletop's own data (not in the map
 * file, which Atlas writes with its own schema). A deleted token keeps its placement, so undoing the delete brings the
 * mini back; a deleted map or GLB takes its placements with it. Pure, so it is tested without Obsidian.
 */

export interface MiniPlacement {
  /** Vault path of the GLB. */
  readonly mini: string;
  /** Size relative to the token's footprint; 1 fills it. */
  readonly scale: number;
  /** Turn in degrees, on top of the token's own rotation. */
  readonly turn: number;
}

export type AssignmentData = Record<string, Record<string, MiniPlacement>>;

export const DEFAULT_PLACEMENT: Omit<MiniPlacement, 'mini'> = Object.freeze({ scale: 1, turn: 0 });

const clampScale = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(4, Math.max(0.2, value)) : 1);
const cleanTurn = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? ((value % 360) + 360) % 360 : 0);

/** Reads saved data, dropping anything malformed. */
export function readAssignments(raw: unknown): AssignmentData {
  const out: AssignmentData = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [map, tokens] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof tokens !== 'object' || tokens === null) continue;
    const kept: Record<string, MiniPlacement> = {};
    for (const [id, entry] of Object.entries(tokens as Record<string, unknown>)) {
      const value = entry as Partial<MiniPlacement> | null;
      if (!value || typeof value.mini !== 'string' || value.mini === '') continue;
      kept[id] = { mini: value.mini, scale: clampScale(value.scale), turn: cleanTurn(value.turn) };
    }
    if (Object.keys(kept).length > 0) out[map] = kept;
  }
  return out;
}

export class Assignments {
  private data: AssignmentData;
  private readonly listeners = new Set<(mapPath: string | null) => void>();

  constructor(initial: AssignmentData = {}) {
    this.data = initial;
  }

  toJSON(): AssignmentData {
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
        console.error('[Tabletop] An assignment listener failed:', error);
      }
    }
  }

  get(mapPath: string, tokenId: string): MiniPlacement | null {
    return this.data[mapPath]?.[tokenId] ?? null;
  }

  forMap(mapPath: string): Readonly<Record<string, MiniPlacement>> {
    return this.data[mapPath] ?? {};
  }

  set(mapPath: string, tokenId: string, placement: MiniPlacement): void {
    const map = { ...(this.data[mapPath] ?? {}) };
    map[tokenId] = { mini: placement.mini, scale: clampScale(placement.scale), turn: cleanTurn(placement.turn) };
    this.data = { ...this.data, [mapPath]: map };
    this.changed(mapPath);
  }

  remove(mapPath: string, tokenId: string): void {
    if (!this.data[mapPath]?.[tokenId]) return;
    const map = { ...this.data[mapPath] };
    delete map[tokenId];
    const next = { ...this.data };
    if (Object.keys(map).length === 0) delete next[mapPath];
    else next[mapPath] = map;
    this.data = next;
    this.changed(mapPath);
  }

  /**
   * Follows a vault rename: a renamed map (or a folder holding maps) moves its placements, and a renamed GLB (or a
   * folder holding GLBs) is followed by every placement using it.
   */
  rename(oldPath: string, newPath: string): void {
    const moved = (path: string): string | null => {
      if (path === oldPath) return newPath;
      if (path.startsWith(`${oldPath}/`)) return newPath + path.slice(oldPath.length);
      return null;
    };
    let touched = false;
    const next: AssignmentData = {};
    for (const [map, tokens] of Object.entries(this.data)) {
      const mapTo = moved(map) ?? map;
      if (mapTo !== map) touched = true;
      const kept: Record<string, MiniPlacement> = {};
      for (const [id, placement] of Object.entries(tokens)) {
        const miniTo = moved(placement.mini);
        if (miniTo) touched = true;
        kept[id] = miniTo ? { ...placement, mini: miniTo } : placement;
      }
      next[mapTo] = { ...(next[mapTo] ?? {}), ...kept };
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }

  /** Follows a deleted map or GLB: its placements go. */
  deleted(path: string): void {
    const under = (candidate: string): boolean => candidate === path || candidate.startsWith(`${path}/`);
    let touched = false;
    const next: AssignmentData = {};
    for (const [map, tokens] of Object.entries(this.data)) {
      if (under(map)) { touched = true; continue; }
      const kept: Record<string, MiniPlacement> = {};
      for (const [id, placement] of Object.entries(tokens)) {
        if (under(placement.mini)) { touched = true; continue; }
        kept[id] = placement;
      }
      if (Object.keys(kept).length > 0) next[map] = kept;
    }
    if (!touched) return;
    this.data = next;
    this.changed(null);
  }
}
