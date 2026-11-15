// Atlas source: src/app/packages/components/primitives/useFocusTrap.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect, type RefObject } from 'react';
import { keepTabWithin } from './tabStops';

/**
 * Keeps Tab and Shift+Tab inside a dialog while `active` (WAI-ARIA dialog pattern, `keepTabWithin`).
 * Captured on the dialog's document, so nothing behind the dialog sees the key.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    const doc = containerRef.current?.ownerDocument;
    if (!active || !doc) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      const container = containerRef.current;
      if (container) keepTabWithin(container, event);
    };
    doc.addEventListener('keydown', handleKeyDown, true);
    return (): void => doc.removeEventListener('keydown', handleKeyDown, true);
  }, [containerRef, active]);
}
