// Stand-in for Atlas's services/AssetService.ts @ 0.12.0 (AGPL-3.0) in the copies. Tabletop never builds Atlas's asset
// service: `getInstance` hands over Atlas's running one (through a map view, src/atlasBridge.ts). Without it, the copies
// get an empty one that knows no collection, so they show nothing instead of failing.
import type { App } from 'obsidian';
import { AtlasBridge, type AtlasAssetService } from '../../atlasBridge';

const NONE: AtlasAssetService = {
  getCollectionForMap: () => null,
  getCollectionSettings: () => ({}),
  updateCollectionSettings: async () => {},
};

/** The service last handed over, for Atlas's static helpers that have no app at hand. */
let last: AtlasAssetService | null = null;

export type AssetService = AtlasAssetService;

export const AssetService = {
  getInstance(app?: App): AtlasAssetService {
    const running = app ? new AtlasBridge(app).assetService() : null;
    if (running) last = running;
    return running ?? NONE;
  },
  /** The default collection of the loaded index (Atlas's own answer while its service is reachable). */
  defaultCollectionId(): string {
    const id = typeof last?.getDefaultCollectionId === 'function' ? (last.getDefaultCollectionId as () => unknown)() : null;
    return typeof id === 'string' ? id : 'default';
  },
  newAssetId(type: string): string {
    return `${type}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  },
};
