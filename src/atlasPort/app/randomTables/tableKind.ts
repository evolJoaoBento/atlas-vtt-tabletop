// Atlas source: src/app/randomTables/tableKind.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { roleProperties } from '../loot/lootItem';
import type { RandomTableKind } from '../../shims/atlasTypes';

/** What a table most likely gives: items where a column names a price or a rarity, else text. */
export function guessTableKind(columns: readonly string[]): RandomTableKind {
  const roles = roleProperties(columns.map((column) => column.trim()));
  return roles.price !== undefined || roles.rarity !== undefined ? 'items' : 'text';
}
