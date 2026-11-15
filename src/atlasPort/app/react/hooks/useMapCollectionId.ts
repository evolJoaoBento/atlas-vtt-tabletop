// Atlas source: src/app/react/hooks/useMapCollectionId.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { AssetService } from '../../../shims/assetService';
import { useAtlasUI } from '../../../shims/atlasUI';
import { useAtlasStore } from '../../../shims/viewStore';

/** The collection of the view's scene, or null for scenes outside any collection. */
export function useMapCollectionId(): string | null {
  const { app } = useAtlasUI();
  const mapPath = useAtlasStore((state) => state.mapPath);
  return mapPath ? AssetService.getInstance(app).getCollectionForMap(mapPath) : null;
}
