/**
 * The board's walls as Atlas's fog logic reads them (`WallSegment`): the rooms the walls enclose and the snapping to wall
 * ends read these. The copies cache on the array they are given, so the list is the same array while `walls` is.
 */
import type { BoardWall } from './walls';

export interface FogWall {
  id: string;
  kind: 'wall';
  type: 'solid' | 'door' | 'secret-door';
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  direction?: 'left' | 'right';
  closed?: boolean;
  locked?: boolean;
  blocks?: 'sight' | 'light' | 'movement';
  limited?: boolean;
  chainId?: string;
  floor?: 'left' | 'right';
}

const cache = new WeakMap<readonly BoardWall[], readonly FogWall[]>();

/** `walls` as Atlas's segments (what the board keeps as null Atlas leaves unset). */
export function fogWalls(walls: readonly BoardWall[]): readonly FogWall[] {
  let list = cache.get(walls);
  if (!list) {
    list = walls.map((wall): FogWall => ({
      id: wall.id, kind: 'wall', type: wall.type, p1: wall.p1, p2: wall.p2, closed: wall.closed,
      ...(wall.locked && { locked: true }),
      ...(wall.direction && { direction: wall.direction }),
      ...(wall.blocks && { blocks: wall.blocks }),
      ...(wall.limited && { limited: true }),
      ...(wall.chain && { chainId: wall.chain }),
      ...(wall.floor && { floor: wall.floor }),
    }));
    cache.set(walls, list);
  }
  return list;
}
