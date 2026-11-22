// Atlas source: src/app/initiative/turnColor.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
/**
 * The colour a combatant's turn flashes in, on the players' list and in the turn banner: its token's ring colour; null
 * for the accent (a combatant without a token, or a ring without a colour of its own).
 */
export function turnColor(token: { readonly ringColor?: string | undefined } | undefined): string | null {
  return token?.ringColor || null;
}
