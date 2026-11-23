/**
 * Editing a kept measurement on the board, as Atlas's map does (`MeasureHandleInteraction`, `measureHandle.ts`,
 * `measureHandleDrag.ts`, `measurePopoverGuard.ts`): the pure parts. Every kept measurement has a handle at its origin (a
 * badge) and, an area, one at its far end (a dot, which resizes and turns it) and one next to that (which only turns it); a
 * press on a handle opens the measurement's popover, a drag changes its points, and Delete takes it off.
 *
 * Which measurements, where the handles stand, which handle a press lands on and what a drag changes are here; the board
 * draws and follows them (`measureHandleMarks.ts`, `board.ts`) and the popover is `measurePopover.ts`.
 */
import { areaResizedBy, measureMovedBy, measureTurnedBy } from '../atlasPort/app/measure/measureMove';
import { measureKind, type MeasureRecord } from '../../packages/atlas-host/src/spellMeasure';
import { followedToken, placedMeasure, type BoardMeasure } from './boardMeasures';

type Place = { x: number; y: number };

/** The handle at the origin: a badge, a little wider to press than to see (Atlas's `MEASURE_HANDLE_RADIUS` 10, hit 12). */
export const HANDLE_RADIUS = 10;
export const HANDLE_HIT = 12;
/** The dot at an area's far end, and the one that only turns it, both smaller (Atlas's 6, hit 9). */
export const END_RADIUS = 6;
export const END_HIT = 9;
/** Screen pixels from the far end's dot to the turn handle: both dots and a small gap (Atlas's `MEASURE_TURN_HANDLE_OFFSET`). */
export const TURN_OFFSET = END_RADIUS + END_RADIUS + 4;
/** Where the badge of a measurement on a token stands on its rim, and the step to the next one on the same token (Atlas's `auraArea.ts`). */
const BADGE_DIRECTION: Place = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
const BADGE_STEP = Math.PI / 5;

export type HandlePart = 'origin' | 'end' | 'turn';

/** A handle on the board: whose, which part, and where it stands on screen (pixels) or, for placing, on the map. */
export interface Handle { id: string; part: HandlePart; x: number; y: number }
export interface HandleRef { id: string; part: HandlePart }

/** What of a token places a badge: where it stands and how large (Atlas's size: it covers `2 * size - 1` cells across). */
export interface RimToken { id: string; x: number; y: number; size: number }

/**
 * The measurements that take a handle: every kept area, kept ruler and template. A cast spell is drawn in 3D and
 * erased by the Template tool's tap; its measure is its cast's, not for the handles to move.
 */
export function editableMeasures(measures: readonly BoardMeasure[]): BoardMeasure[] {
  return measures.filter(({ record }) => measureKind(record) !== 'spell');
}

/** Where a measurement's handles stand on the map. `drags` is whether they may be dragged: an aura stays with its token. */
export interface HandleSpot { origin: Place; end: Place | null; drags: boolean }

/** The radius of a token's space, map pixels. */
const spaceRadius = (token: RimToken, cell: number): number => (Math.max(1, 2 * token.size - 1) * cell) / 2;

/** How near the rim a point still is and counts as outside the token's space (Atlas's `RIM_ROOM`). */
const RIM_ROOM = 0.5;

/** The token whose space holds `point`, the later where several do. */
function tokenHolding(point: Place, tokens: readonly RimToken[], cell: number): RimToken | null {
  let held: RimToken | null = null;
  for (const token of tokens) {
    const reach = spaceRadius(token, cell) - RIM_ROOM;
    if (reach > 0 && (point.x - token.x) ** 2 + (point.y - token.y) ** 2 < reach * reach) held = token;
  }
  return held;
}

/**
 * Where the handles of `measures` stand (Atlas's `rimSpots` and `handlePlace`): a measurement that follows a token
 * lies around it, as the board draws it; the badge of one that lies on a token stands on the rim of the token's space,
 * the first where an aura's always stood and each further one of the same token a step along it, so that the token's
 * middle keeps the presses meant for the token. Others stand at their points.
 */
export function handleSpots(measures: readonly BoardMeasure[], tokens: readonly RimToken[], cell: number): Map<string, HandleSpot> {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const spots = new Map<string, HandleSpot>();
  const taken = new Map<string, number>();
  for (const { id, record } of measures) {
    const aura = followedToken(record);
    const placed = placedMeasure(record, (token) => { const at = byId.get(token); return at ? { x: at.x, y: at.y } : null; });
    if (!placed) continue;
    const [first, second] = placed.points;
    const bearer = aura !== null ? byId.get(aura) ?? null : tokenHolding(record.points[0], tokens, cell);
    let origin: Place = { x: first.x, y: first.y };
    if (bearer && Number.isFinite(bearer.x) && Number.isFinite(bearer.y)) {
      const place = taken.get(bearer.id) ?? 0;
      taken.set(bearer.id, place + 1);
      const rim = spaceRadius(bearer, cell);
      const cos = Math.cos(place * BADGE_STEP);
      const sin = Math.sin(place * BADGE_STEP);
      origin = { x: bearer.x + (BADGE_DIRECTION.x * cos - BADGE_DIRECTION.y * sin) * rim, y: bearer.y + (BADGE_DIRECTION.x * sin + BADGE_DIRECTION.y * cos) * rim };
    }
    spots.set(id, { origin, end: placed.shape === 'ruler' || aura !== null || !second ? null : { x: second.x, y: second.y }, drags: aura === null });
  }
  return spots;
}

/**
 * Where the turn handle of an area stands, `pixel` map pixels to a screen pixel: beside its far end, to the right of it
 * as seen from the origin, a fixed distance on screen away; along the area's own edge there. A circle has none (it looks
 * the same at any angle), a ruler none (its distance follows the grid's diagonal rule), nor an area whose points lie on each other.
 */
export function turnSpot(record: Pick<MeasureRecord, 'shape' | 'points'>, pixel: number): Place | null {
  const first = record.points[0];
  const last = record.points[record.points.length - 1];
  if (record.shape === 'circle' || record.shape === 'ruler' || !first || !last) return null;
  const length = Math.hypot(last.x - first.x, last.y - first.y);
  if (length === 0) return null;
  const reach = TURN_OFFSET * pixel;
  return { x: last.x - ((last.y - first.y) / length) * reach, y: last.y + ((last.x - first.x) / length) * reach };
}

const REACH: Record<HandlePart, number> = { origin: HANDLE_HIT, end: END_HIT, turn: END_HIT };

/**
 * The handle at screen point (`x`, `y`) of `handles` (their screen places): the nearest within its reach, and of
 * handles as near as each other the later, which lies on top (Atlas's `measureHandleAt`).
 */
export function hitHandle(handles: readonly Handle[], x: number, y: number): HandleRef | null {
  let nearest: HandleRef | null = null;
  let best = Infinity;
  for (const handle of handles) {
    const distance = Math.hypot(x - handle.x, y - handle.y);
    if (distance <= REACH[handle.part] && distance <= best) {
      best = distance;
      nearest = { id: handle.id, part: handle.part };
    }
  }
  return nearest;
}

/** The grid points snap to, with whether the map's Snap is on. */
export interface MeasureGridSnap { type: 'square' | 'hex-vertical' | 'hex-horizontal'; size: number; offsetX: number; offsetY: number; snap: boolean }

/**
 * The points of `record` once the pointer has moved `by` (map pixels) since it took the handle (Atlas's `handleDrag`): the
 * origin moves the whole measurement, its first point snapping as a new one's start would; the far end resizes and turns
 * an area, its size snapping as a new area's would; the turn handle only turns it about its origin, smoothly, from where it
 * stood (`turnFrom`). `free` (Alt) places freely. Null where there is no drag: an aura, which lies where its token stands.
 */
export function dragPoints(record: Pick<MeasureRecord, 'shape' | 'points'> & { follows?: unknown; aura?: unknown }, part: HandlePart, by: Place, grid: MeasureGridSnap, free: boolean, turnFrom: Place | null): Place[] | null {
  if (followedToken(record as MeasureRecord) !== null) return null;
  const points = record.points.map(({ x, y }) => ({ x, y }));
  const geometry = grid.snap ? { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY } : null;
  if (part === 'turn') return turnFrom ? measureTurnedBy(points, turnFrom, by) : null;
  if (part === 'end') return areaResizedBy(points, by, geometry, free);
  return measureMovedBy(record.shape, points, by, geometry, free);
}

/** Whether two sets of points say the same: a drag that snaps leaves most moves of the pointer where it was, and nothing is then written. */
export function samePoints(a: readonly Place[] | undefined, b: readonly Place[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((point, index) => point.x === b[index]?.x && point.y === b[index]?.y));
}

/** Delete takes the measurement the pointer is over, else the one whose popover is open (Atlas's `handleDelete`), when it can be edited. */
export function deleteTargetOf({ hovered, open, editable }: { hovered: string | null; open: string | null; editable: readonly string[] }): string | null {
  const id = hovered ?? open;
  return id !== null && editable.includes(id) ? id : null;
}

/** What says whether the board edits measurements now (Atlas's `mayEditMeasure`): the GM's board of a loaded map, in GM view, with Atlas's actions to write them. */
export function mayEditMeasures(state: { gm: boolean; gmView: boolean; loaded: boolean; eye: boolean; cinematic: boolean; writes: boolean }): boolean {
  return state.gm && state.gmView && state.loaded && !state.eye && !state.cinematic && state.writes;
}
