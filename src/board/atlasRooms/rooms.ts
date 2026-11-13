// Atlas source: src/app/lighting/rooms.ts @ 0.14.0 (AGPL-3.0), the part that turns rooms into walls (`roomWalls`),
// copied for Tabletop: Atlas 0.14 carves rooms out of the rock, and on a level with rooms everything outside them is
// solid. Tabletop reads map files without Atlas, so it works the walls out itself, as Atlas does.
import { normalizePolygon, unionShapes } from './polygonClip';
import { MAX_Q, Q_SCALE, type QPolygon, type QShape } from './shapeTypes';

/** A room as Atlas 0.14 keeps it in `objects.rooms`: an open area, in eighth pixels, on one level. */
export interface Room {
  id: string;
  kind: 'room';
  name: string;
  /** Rock again until shown: its area makes no opening. */
  hidden?: boolean;
  /** Its place in the list, first at 0. */
  order: number;
  /** The open area, in eighth pixels. */
  area: RoomArea;
  level?: string;
}

/** A `QShape` the store may hold. */
export type RoomArea = number[][];

/** A wall a room's outline makes, as Atlas writes it (`WallSegment`). */
export interface RoomWall {
  id: string;
  kind: 'wall';
  type: 'solid';
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  chainId: 'rooms';
}

const EMPTY: RoomArea = [];
const own = (shape: QShape): RoomArea => shape as RoomArea;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isRing = (ring: unknown): ring is QPolygon => Array.isArray(ring) && ring.length >= 6 && ring.length % 2 === 0
  && ring.every((value) => Number.isInteger(value) && Math.abs(value as number) <= MAX_Q);

/** Whether `area` is an area a room can have: rings of bounded eighth pixels. */
export const isRoomArea = (area: unknown): area is RoomArea => Array.isArray(area) && area.every(isRing);

/** A room as the file has it, or null where it is none (a hand edit, a newer version): it is then passed over. */
function readRoom(id: string, value: unknown): Room | null {
  if (!isRecord(value) || !isRoomArea(value.area)) return null;
  return value.id === id && typeof value.name === 'string' && Number.isFinite(value.order) ? (value as unknown as Room) : null;
}

/** The rooms that are rooms, in their order (`objects.rooms`, already narrowed to a level). */
export function readRooms(rooms: unknown): Room[] {
  if (!isRecord(rooms)) return [];
  return Object.entries(rooms).flatMap(([id, room]) => readRoom(id, room) ?? []).sort((a, b) => a.order - b.order);
}

const joined = (a: RoomArea, b: RoomArea): RoomArea => (b.length === 0 ? a : own(unionShapes(a, b)));

/** All shown rooms as one area. */
export function openArea(rooms: readonly Room[]): RoomArea {
  return rooms.filter((room) => !room.hidden).reduce((open, room) => joined(open, room.area), EMPTY);
}

/**
 * The walls the shown rooms' outline makes: solid, one per edge of their union (rooms that touch or overlap make no
 * wall between them). An edge is named by its ends, as Atlas 0.14 named it (`room_<x1>_<y1>_<x2>_<y2>`, in eighth
 * pixels, on the chain `rooms`). None where there are no rooms. Only a 0.14 file Atlas 0.15 has not saved yet still has
 * rooms: 0.15 turns them into real walls as it loads the scene (`room_<level>_<x1>_<y1>_<x2>_<y2>`, on the chain
 * `rooms_<level>`) and drops them.
 */
export function roomWalls(rooms: readonly Room[]): RoomWall[] {
  const walls: RoomWall[] = [];
  for (const ring of openArea(rooms)) {
    for (let i = 0; i < ring.length; i += 2) {
      const next = (i + 2) % ring.length;
      const [x1, y1, x2, y2] = [ring[i]!, ring[i + 1]!, ring[next]!, ring[next + 1]!];
      const id = `room_${x1}_${y1}_${x2}_${y2}`;
      walls.push({ id, kind: 'wall', type: 'solid', p1: { x: x1 / Q_SCALE, y: y1 / Q_SCALE }, p2: { x: x2 / Q_SCALE, y: y2 / Q_SCALE }, chainId: 'rooms' });
    }
  }
  return walls;
}

/** Whether `walls` (a scene's wall records) already hold Atlas 0.15's room walls: an id starting `room_` on a chain starting `rooms_`. */
export function hasConvertedRoomWalls(walls: unknown): boolean {
  if (typeof walls !== 'object' || walls === null) return false;
  return Object.entries(walls as Record<string, unknown>).some(([key, raw]) => {
    const wall = raw as { id?: unknown; chainId?: unknown } | null;
    const id = typeof wall?.id === 'string' ? wall.id : key;
    return id.startsWith('room_') && typeof wall?.chainId === 'string' && wall.chainId.startsWith('rooms_');
  });
}

/** A room's area from world-pixel polygons (for tests and fixtures): their union, in eighth pixels. */
export function areaOf(polygons: readonly (readonly { x: number; y: number }[])[]): RoomArea {
  const rings = polygons.filter((polygon) => polygon.length >= 3)
    .flatMap((polygon) => normalizePolygon(polygon.flatMap((p) => [Math.round(p.x * Q_SCALE), Math.round(p.y * Q_SCALE)])));
  return rings.length === 0 ? EMPTY : own(unionShapes(rings, EMPTY));
}
