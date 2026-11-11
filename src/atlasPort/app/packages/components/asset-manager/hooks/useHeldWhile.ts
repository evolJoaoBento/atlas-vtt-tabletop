// Atlas source: src/app/packages/components/asset-manager/hooks/useHeldWhile.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useRef } from 'react';

/** `value`, except while `hold` is true: then the value from the last render before the hold began. */
export function useHeldWhile<T>(hold: boolean, value: T): T {
  const held = useRef(value);
  if (!hold) held.current = value;
  return held.current;
}
