// Atlas source: src/app/react/hooks/useStableCallback.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useCallback, useInsertionEffect, useRef } from 'react';

/**
 * Returns a function whose identity never changes but that always calls the
 * latest `callback`, so memoized children do not re-render when a parent
 * recreates its handlers.
 */
export function useStableCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback);
  useInsertionEffect(() => {
    latest.current = callback;
  });
  return useCallback((...args: Args): Result => latest.current(...args), []);
}
