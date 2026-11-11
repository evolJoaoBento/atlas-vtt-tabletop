// Atlas source: src/app/packages/components/asset-manager/components/mapProcessingContext.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { createContext, useContext } from 'react';
import type { App } from 'obsidian';
import type { MapProcessing } from '../../../../../shims/mapProcessing';

/** Which map images are being processed, and the app to read scene files from; null shows no processing sign. */
export interface MapProcessingLookup {
  app: App;
  processing: MapProcessing;
}

// Provided by the content pane, so cards receive only primitives and stay memoized.
export const MapProcessingContext = createContext<MapProcessingLookup | null>(null);

export function useMapProcessingLookup(): MapProcessingLookup | null {
  return useContext(MapProcessingContext);
}
