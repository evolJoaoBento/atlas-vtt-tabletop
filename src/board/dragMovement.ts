/**
 * A dragged token's ruler as Atlas 0.15's reads it (`measure/dragMovement.ts`, `packages/atlas-shared`): against the
 * token's speed, in the colour of the movement step the move lies in, where the collection names steps and the token
 * has a speed; else the plain distance. Pure, so it is tested without Obsidian.
 */
import { dragMove, type MovementRules, type MoveSettings } from '../../packages/atlas-shared/src/index';
import { formatDistance, type Measurement } from './measure';

/** The ruler's label and its colour: a step's `#rrggbb`, `beyond` past the last step, null for the accent. */
export interface RulerLook {
  label: string;
  color: string | null;
}

/**
 * How a drag of `cells` (what it costs, difficult terrain counted) reads for a token of `speed` game units (null
 * without one) under `rules`. What the token moved earlier in the turn is not counted: each drag counts from its start.
 */
export function rulerLook(cells: number, speed: number | null, rules: MovementRules | undefined, measurement: Measurement): RulerLook {
  const move = rules && rules.steps.length > 0 ? dragMove({ cells, earlier: 0, speed, rules, settings: measurement as unknown as MoveSettings }) : null;
  return move ? { label: move.label, color: move.color } : { label: formatDistance(cells, measurement), color: null };
}
