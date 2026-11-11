// Atlas source: src/app/statblocks/render/shared/SheetRecoverySlot.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React, { useContext } from 'react';
import { ValueEditingContext } from '../valueSlot';

/**
 * What stands under the header once for the whole sheet where a surface edits the statblock
 * (`ValueEditing.recovery`): a player character's recovery buttons. A card that is only read
 * shows none.
 */
export function SheetRecoverySlot(): React.ReactNode {
  const editing = useContext(ValueEditingContext);
  return editing?.recovery?.() ?? null;
}
