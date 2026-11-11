// Stand-in for Atlas's packages/components/asset-manager/hooks/useOpenAsset.ts @ 0.12.0 (AGPL-3.0): an asset's main action on
// the board. Tokens and encounters are spawned by Atlas's own code (onto the board, src/assets/boardTarget.ts), a scene
// opens on the board, and a map (which starts a new scene in Atlas) is handed to Atlas's asset manager.
import { useCallback } from 'react';
import { Notice, type App } from 'obsidian';
import { spawnAndClose, spawnEncounterTokens, spawnTokenAsset } from '../app/packages/components/asset-manager/utils/tokenSpawnService';
import { spawnBoard } from '../../assets/boardTarget';
import { AtlasBridge } from '../../atlasBridge';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OpenAssetDeps {
  app: App;
  view: unknown;
  assetService: any;
  onClose: () => void;
}

export type OpenAsset = (asset: any, spawnCount: number) => Promise<void>;

export function useOpenAsset(deps: OpenAssetDeps): OpenAsset {
  return useCallback(async (asset: any, spawnCount: number): Promise<void> => {
    const ctx = { app: deps.app, view: null, assetService: deps.assetService, random: Math.random };
    switch (asset.type) {
      case 'maps':
        if (!new AtlasBridge(deps.app).openGlobalAssetManager('maps')) new Notice('Tabletop: making a scene from a map needs Atlas.');
        else new Notice("Tabletop: make the scene in Atlas's asset manager.");
        return;
      case 'tokens':
        await spawnAndClose(ctx as any, deps.onClose, (spawn) => spawnTokenAsset(spawn, asset, Math.max(1, spawnCount)));
        return;
      case 'scenes': {
        const scene = await deps.assetService?.getAssetById?.(asset.id);
        const path = scene?.type === 'scene' ? scene.data?.mapPath : asset.data?.mapPath;
        if (typeof path === 'string') { await spawnBoard()?.openMap(path); deps.onClose(); }
        return;
      }
      case 'encounters':
        await spawnAndClose(ctx as any, deps.onClose, (spawn) => spawnEncounterTokens(spawn, asset));
    }
  }, [deps]);
}
