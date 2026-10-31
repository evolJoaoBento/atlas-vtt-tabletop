/**
 * What the players' picture of the board leaves out, by Atlas's rules for its player window: hidden tokens, and
 * whatever stands under the fog. Their copy numbers are the GM's (`levels.ts`). Which
 * resources they see is `visibleResources(…, 'player')`. Pure, so it is tested without Obsidian.
 */
import type { FogArea } from './fog';

interface Point {
  x: number;
  y: number;
}

function inRing(point: Point, ring: readonly Point[]): boolean {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) within = !within;
  }
  return within;
}

/** Whether fog covers a point of the map: inside an area, and not in a hole erased out of it. */
export function insideFog(areas: readonly FogArea[], point: Point): boolean {
  return areas.some((area) => inRing(point, area.outer) && !area.holes.some((hole) => inRing(point, hole)));
}

/** Whether players see a token standing at `at`: not hidden by the GM, its centre not under the fog. */
export function playerSees(token: { hidden: boolean }, at: Point, fog: readonly FogArea[]): boolean {
  return !token.hidden && !insideFog(fog, at);
}
