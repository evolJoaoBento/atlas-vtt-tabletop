// Atlas source: src/app/packages/components/primitives/useExclusiveDropdown.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// Shared across component instances and React roots, without a map-view provider.
let activeDropdown: symbol | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot(): symbol | null {
  return activeDropdown;
}

function keepActiveDropdownFocused(event: Event): void {
  // Closing the previous menu must not steal focus from the newly opened one.
  if (activeDropdown !== null) event.preventDefault();
}

interface ExclusiveDropdown {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function useExclusiveDropdown(): ExclusiveDropdown {
  const [id] = useState(() => Symbol('dropdown'));
  const activeId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setIsOpen = useCallback((open: boolean): void => {
    // Delayed dismissal or unmount of the old menu cannot close its replacement.
    if (!open && activeDropdown !== id) return;
    const next = open ? id : null;
    if (activeDropdown === next) return;
    activeDropdown = next;
    for (const listener of listeners) listener();
  }, [id]);

  useEffect(() => () => setIsOpen(false), [setIsOpen]);

  return { isOpen: activeId === id, setIsOpen, onCloseAutoFocus: keepActiveDropdownFocused };
}
