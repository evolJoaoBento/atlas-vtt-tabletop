// Atlas source: src/app/react/hooks/useElementHeight.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { observeResize } from '../../utils/observeResize';

/**
 * The laid-out height of an element, kept up to date: what a clip around it
 * animates to when its content changes. Null until it was measured.
 */
export function useElementHeight<T extends HTMLElement>(): [RefObject<T | null>, number | null] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setHeight(el.offsetHeight);
    measure();
    return observeResize([el], measure);
  }, []);

  return [ref, height];
}
