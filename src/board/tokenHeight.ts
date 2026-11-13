/**
 * Atlas 0.15's token height on the board: a token stands `elevation` game units over its level's floor, which is so
 * many squares as the map counts heights (Atlas's own `tokenHeight` and `riseInCells`, `packages/atlas-shared`).
 * Pure, so it is tested without Obsidian.
 */
import { MAX_MOVEMENT_SPEED, riseInCells, tokenHeight } from '../../packages/atlas-shared/src/index';

/** How many squares over its floor a token stands: below it (burrowing) for a negative height; 0 where a square spans no distance. */
export function liftOf(token: { elevation?: unknown }, measurement: { unitDistance: number }): number {
  const height = tokenHeight(token);
  return Math.sign(height) * riseInCells(height, measurement);
}

/** A token's own speed in game units, as Atlas keeps one set by hand: above 0 and no more than Atlas's greatest; else null. */
export function ownSpeed(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_MOVEMENT_SPEED ? value : null;
}
