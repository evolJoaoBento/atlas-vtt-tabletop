/**
 * Atlas 0.15 turns a 0.14 scene's rooms into real walls the first time it loads the scene, and names them anew:
 * `room_<level>_<x1>_<y1>_<x2>_<y2>` on the chain `rooms_<level>`, where 0.14's computed outline was named
 * `room_<x1>_<y1>_<x2>_<y2>` (the coordinates in eighth pixels, both times). Tabletop keeps a wall's height, width,
 * material and window opening under the wall's id, so what a GM set on a room's outline in 0.14 would be left behind.
 * This finds, for each converted wall, the 0.14 name of the same edge. Pure.
 */
const Q_SCALE = 8;

export interface MigrationWall {
  id: string;
  chainId: string | null;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const point = (value: unknown): { x: number; y: number } | null =>
  (isObj(value) && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: value.x, y: value.y } : null);

/**
 * Every wall of a scene as Atlas's store (or a map file's `state`) holds them, on every level: never the walls of the
 * level shown alone, or the other levels' settings would be left behind for good.
 */
export function migrationWalls(state: unknown): MigrationWall[] {
  const walls = isObj(state) && isObj(state.objects) && isObj(state.objects.walls) ? state.objects.walls : {};
  const out: MigrationWall[] = [];
  for (const [key, raw] of Object.entries(walls)) {
    if (!isObj(raw)) continue;
    const p1 = point(raw.p1);
    const p2 = point(raw.p2);
    if (!p1 || !p2) continue;
    out.push({ id: typeof raw.id === 'string' ? raw.id : key, chainId: typeof raw.chainId === 'string' ? raw.chainId : null, p1, p2 });
  }
  return out;
}

const eighths = (value: number): number => Math.round(value * Q_SCALE) + 0;
const oldKey = (a: { x: number; y: number }, b: { x: number; y: number }): string => `room_${eighths(a.x)}_${eighths(a.y)}_${eighths(b.x)}_${eighths(b.y)}`;

/**
 * For each wall of a rooms chain (`chainId` starting `rooms_`): the 0.14 key of the same edge, or of that edge the other
 * way round, when `oldKeys` has it. A wall is matched by where it stands and by its chain, never by reading the level
 * out of its id (a level's id may hold underscores, or be empty). One old key may go to several walls: 0.14 named an
 * edge without its level, so two levels sharing an edge shared its settings.
 */
export function roomWallMoves(walls: readonly MigrationWall[], oldKeys: ReadonlySet<string>): Array<{ from: string; to: string }> {
  const moves: Array<{ from: string; to: string }> = [];
  for (const wall of walls) {
    if (wall.chainId === null || !wall.chainId.startsWith('rooms_')) continue;
    const from = [oldKey(wall.p1, wall.p2), oldKey(wall.p2, wall.p1)].find((key) => oldKeys.has(key));
    if (from !== undefined && from !== wall.id) moves.push({ from, to: wall.id });
  }
  return moves;
}
