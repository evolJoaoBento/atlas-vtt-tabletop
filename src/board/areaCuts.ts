/**
 * Where walls stop an area, as Atlas 0.19 stops its kept measures: what a straight way from the area's origin reaches,
 * swept as light is (`measureWalls.ts`, `areaWithinWalls`), through the walls light is traced through (the scene's
 * sealed walls: closed doors stop it, open doors and walls that stop only a token do not). The board's flat marks,
 * the 3D volumes of areas with an effect and every cast spell are cut by the same sweep, so they agree with Atlas's
 * own drawing. Pure.
 */
import { BASE_TEXEL, worldTexel } from '../atlasPort/app/lighting/lightingConstants';
import { sealedWalls } from '../atlasPort/app/lighting/sealWalls';
import { ringBounds, type MeasureArea, type ShapedArea } from '../atlasPort/app/measure/measureGeometry';
import { areaWithinWalls } from '../atlasPort/app/measure/measureWalls';
import { fogWalls } from './fogWalls';
import type { BoardWall, Point } from './walls';

/** What of the map the cut depends on besides its walls: its size (the lighting seals walls by it) and its grid cell. */
export interface WallsLook {
  size?: { width: number; height: number } | null;
  cell?: number;
}

/** A twelfth of a cell and four pixels at least: how near a wall an origin counts as on it (Atlas's `wallSlack`, cells counted). */
const LEAST_SLACK = 4;
const SLACK_OF_CELL = 1 / 12;

export function wallSlack(cell: number | undefined): number {
  return cell !== undefined && cell > 0 ? Math.max(LEAST_SLACK, cell * SLACK_OF_CELL) : LEAST_SLACK;
}

/**
 * The walls areas stop at: the board's walls as Atlas's segments, their joints sealed as the lighting seals them. The
 * same array while the walls and the map's size are, so Atlas's sweeps (kept by it) are worked out once.
 */
export function stoppingWalls(walls: readonly BoardWall[], size?: WallsLook['size']): readonly object[] {
  if (walls.length === 0) return [];
  return sealedWalls(fogWalls(walls) as never, size ? worldTexel(size) : BASE_TEXEL);
}

/** `shaped` as the map's walls leave it: the area itself where no wall stands in its reach (`cutArea(...) === shaped`). */
export function cutArea(shaped: ShapedArea, walls: readonly BoardWall[], look: WallsLook = {}): MeasureArea {
  if (walls.length === 0) return shaped;
  return areaWithinWalls(shaped, stoppingWalls(walls, look.size) as never, wallSlack(look.cell));
}

/** The rings of an area as plain floor points. */
export function ringsOf(area: Pick<MeasureArea, 'rings'>): Point[][] {
  return area.rings.map((ring) => ring.map((point) => ({ x: point.x, y: point.y })));
}

/**
 * What the walls leave of a reach of `reach` pixels about `origin`, swept from there towards `towards` (a unit way:
 * which side of a wall the origin lies on, where it lies on one). Null where no wall is in the way. Its rings are
 * the swept ground within a square of that reach, and `contains` asks whether a point lies in it.
 */
export function reachWithin(origin: Point, towards: Point, reach: number, walls: readonly BoardWall[], look: WallsLook = {}): MeasureArea | null {
  if (walls.length === 0) return null;
  const half = reach * 1.05 + 1;
  const ring = [
    { x: origin.x - half, y: origin.y - half }, { x: origin.x + half, y: origin.y - half },
    { x: origin.x + half, y: origin.y + half }, { x: origin.x - half, y: origin.y + half },
  ];
  const everywhere: ShapedArea = { rings: [ring], bounds: ringBounds([ring]), contains: () => true, origin, towards, reach };
  const cut = cutArea(everywhere, walls, look);
  return cut === everywhere ? null : cut;
}
