// Atlas source: src/app/initiative/turnOptions.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
/**
 * The GM's choices for what a turn change does, kept in Atlas' settings (`data.json`) and so the
 * same on every device: a banner names the turn (on unless switched off), and online players move
 * their tokens only on their turn (off unless switched on). The GM's view always follows the turn.
 */
export interface InitiativeTurnOptions {
  banner: boolean;
  movesOnTurn: boolean;
}

/** The options before any choice. */
export const DEFAULT_TURN_OPTIONS: InitiativeTurnOptions = { banner: true, movesOnTurn: false };
