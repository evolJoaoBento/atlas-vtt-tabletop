// Atlas source: src/app/packages/components/asset-manager/utils/sceneCreation.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { MapAsset } from '../types';
import type { CreateScenePrefill } from '../hooks/useAssetCrud';

/** Background and name of a new scene built on a map. */
export function scenePrefillFromMap(map: MapAsset): CreateScenePrefill {
  return { backgroundPath: map.mapFilePath, defaultName: map.name };
}
