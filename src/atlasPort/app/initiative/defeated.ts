// Atlas source: src/app/initiative/defeated.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { isDefeated } from '../resources/resourceValues';
import type { ResourceDefinition } from '../resources/resourceTypes';
import type { TokenEntity } from '../../shims/atlasTypes';
import type { InitiativeEntry } from '../../shims/atlasTypes';
import { entryToken } from './party';

/**
 * Whether a combatant is defeated, as its card's skull says: its token holds a resource that
 * defeats it and has spent it. An entry without its token is not.
 */
export function combatantDefeated(token: TokenEntity | undefined, definitions: readonly ResourceDefinition[]): boolean {
  return token !== undefined && isDefeated(token, definitions);
}

/** The entry ids of the defeated combatants. */
export function defeatedCombatants(
  entries: readonly InitiativeEntry[],
  tokens: Readonly<Record<string, TokenEntity>>,
  definitions: readonly ResourceDefinition[],
): ReadonlySet<string> {
  return new Set(entries.filter((entry) => combatantDefeated(entryToken(tokens, entry), definitions)).map((entry) => entry.id));
}
