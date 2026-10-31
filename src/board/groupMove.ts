/**
 * Moving several tokens at once: each keeps its place relative to the one the pointer holds, stays on the board, and
 * snaps by its own size, as Atlas snaps a dragged selection. Pure.
 */
import { snapPoint } from './geometry';
import type { BoardGrid } from './mapModel';

interface Point {
  x: number;
  y: number;
}

export interface GroupMember {
  /** Where it stood when the drag began. */
  origin: Point;
  size: number;
}

/** A point kept inside the board: `width` by `height`. */
function inside(point: Point, width: number, height: number): Point {
  return { x: Math.min(Math.max(point.x, 0), width), y: Math.min(Math.max(point.y, 0), height) };
}

/**
 * Where each member stands while the held token `held` is at `at` (not snapped): its origin moved by what the held
 * token has moved, kept on the board.
 */
export function groupFollow(members: ReadonlyMap<string, GroupMember>, held: string, at: Point, width: number, height: number): Map<string, Point> {
  const start = members.get(held)?.origin;
  const moved = new Map<string, Point>();
  if (!start) return moved;
  for (const [id, member] of members) {
    moved.set(id, id === held ? at : inside({ x: member.origin.x + (at.x - start.x), y: member.origin.y + (at.y - start.y) }, width, height));
  }
  return moved;
}

/** Where each member lands when the held token is dropped at `at`: each one's place, snapped by its own size. */
export function groupLanding(members: ReadonlyMap<string, GroupMember>, held: string, at: Point, grid: BoardGrid, width: number, height: number): Map<string, Point> {
  const landed = new Map<string, Point>();
  for (const [id, place] of groupFollow(members, held, at, width, height)) landed.set(id, snapPoint(grid, place.x, place.y, members.get(id)?.size ?? 1));
  return landed;
}
