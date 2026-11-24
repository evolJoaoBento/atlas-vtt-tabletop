// Atlas source: src/app/platform/useCoarsePointer.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useSyncExternalStore } from 'react';
import { deviceProfile } from './deviceProfile';

const subscribe = (onChange: () => void): (() => void) => deviceProfile().onPointerChange(onChange);
const isCoarse = (): boolean => deviceProfile().pointer === 'coarse';

/** Whether the pointer is a finger now; follows a mouse being attached or taken away. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarse);
}
