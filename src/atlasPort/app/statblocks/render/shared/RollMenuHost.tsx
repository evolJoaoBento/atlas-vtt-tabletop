// Atlas source: src/app/statblocks/render/shared/RollMenuHost.tsx @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React, { useLayoutEffect, type RefObject } from 'react';
import { ContextMenuProvider, useOptionalContextMenu, type ContextMenuController } from '../../../react/root/ContextMenuContext';

function Capture({ into }: { into: RefObject<ContextMenuController | null> }): null {
  const controller = useOptionalContextMenu();
  useLayoutEffect(() => {
    into.current = controller;
    return () => { into.current = null; };
  }, [controller, into]);
  return null;
}

/**
 * A context menu of its own for a statblock's roll links where no surface
 * around it has one (a hover preview): it opens in the statblock's document.
 */
export function RollMenuHost({ controller }: { controller: RefObject<ContextMenuController | null> }): React.JSX.Element {
  return (
    <ContextMenuProvider local>
      <Capture into={controller} />
    </ContextMenuProvider>
  );
}
