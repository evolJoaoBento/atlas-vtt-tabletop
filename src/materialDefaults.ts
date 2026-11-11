/**
 * The materials walls and doors wear when none was painted on them: one for each kind (a wall, a door, a secret door,
 * a window, a low wall, a curtain), each none to begin with, set in the gallery's Materials tab (Defaults). A painted
 * material always wins; a secret door with no default of its own wears the walls'. Pure.
 */
import type { BoardWall } from './board/walls';

export const MATERIAL_KINDS = ['wall', 'door', 'secretDoor', 'window', 'lowWall', 'curtain'] as const;
export type MaterialKind = typeof MATERIAL_KINDS[number];
export type MaterialDefaults = Partial<Record<MaterialKind, string>>;

export const MATERIAL_KIND_NAMES: Record<MaterialKind, string> = {
  wall: 'Walls', door: 'Doors', secretDoor: 'Secret doors', window: 'Windows', lowWall: 'Low walls', curtain: 'Curtains',
};

/** What a wall is, for its default. Glass (a wall that stops only light) takes none: it is drawn as glass. */
export function materialKindOf(wall: Pick<BoardWall, 'type' | 'blocks' | 'limited'>): MaterialKind | null {
  if (wall.type === 'door') return 'door';
  if (wall.type === 'secret-door') return 'secretDoor';
  if (wall.blocks === 'light') return null;
  if (wall.blocks === 'sight') return 'curtain';
  if (wall.blocks === 'movement') return 'window';
  if (wall.limited) return 'lowWall';
  return 'wall';
}

/** The material a wall wears: its own, else its kind's default (a secret door's, else the walls'), else none. */
export function materialWith(painted: string | null, wall: Pick<BoardWall, 'type' | 'blocks' | 'limited'>, defaults: MaterialDefaults | null | undefined): string | null {
  if (painted) return painted;
  if (!defaults) return null;
  const kind = materialKindOf(wall);
  if (!kind) return null;
  return defaults[kind] ?? (kind === 'secretDoor' ? defaults.wall ?? null : null);
}

/** Saved defaults, those well formed. */
export function readMaterialDefaults(raw: unknown): MaterialDefaults {
  const out: MaterialDefaults = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const kind of MATERIAL_KINDS) {
    const value = (raw as Record<string, unknown>)[kind];
    if (typeof value === 'string' && value.trim()) out[kind] = value;
  }
  return out;
}

/** The materials the defaults bring onto a map with these walls (for players, who need their maps). */
export function defaultsUsed(walls: ReadonlyArray<Pick<BoardWall, 'type' | 'blocks' | 'limited'>>, painted: (index: number) => string | null, defaults: MaterialDefaults | null | undefined): string[] {
  if (!defaults || Object.keys(defaults).length === 0) return [];
  const used = new Set<string>();
  walls.forEach((wall, index) => {
    if (painted(index)) return;
    const material = materialWith(null, wall, defaults);
    if (material) used.add(material);
  });
  return [...used];
}
