// Stand-in for Atlas's packages/components/asset-manager/hooks/useOpenAsset.ts @ 0.15.0 (AGPL-3.0): an asset's main action on
// the board. Tokens and encounters are spawned by Atlas's own code (onto the board, src/assets/boardTarget.ts), a scene
// opens on the board, and a map opens the latest scene of the collection on it (Atlas's `latestSceneOn`, read by Atlas's
// `MapScenes`) on the board; a map with no scene yet (which starts a new scene in Atlas) is handed to Atlas's asset manager.
import { useEffect } from 'react';
import { Notice, TFile, type App } from 'obsidian';
import { spawnAndClose, spawnEncounterTokens, spawnTokenAsset } from '../app/packages/components/asset-manager/utils/tokenSpawnService';
import { MapScenes, latestSceneOn } from '../app/packages/components/asset-manager/utils/mapScenes';
import { useStableCallback } from '../app/react/hooks/useStableCallback';
import { runInBackground } from '../app/utils/backgroundTask';
import { spawnBoard } from '../../assets/boardTarget';
import { AtlasBridge } from '../../atlasBridge';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface OpenAssetDeps {
  app: App;
  view: unknown;
  assetService: any;
  onClose: () => void;
  /** The collection shown, whose scenes a map's main action opens. */
  collectionId: string;
}

export type OpenAsset = (asset: any, spawnCount: number) => Promise<void>;

/** Opens a scene on the board the asset manager was opened over; false when the scene or its map file is gone. */
export async function openScene(deps: Omit<OpenAssetDeps, 'collectionId'>, assetId: string): Promise<boolean> {
  const scene = await deps.assetService?.getAssetById?.(assetId);
  const path: unknown = scene?.type === 'scene' ? scene.data?.mapPath : undefined;
  if (typeof path !== 'string' || !(deps.app.vault.getAbstractFileByPath(path) instanceof TFile)) return false;
  const board = spawnBoard();
  if (!board) return false;
  deps.onClose();
  await board.openMap(path);
  return true;
}

/** A map's main action: its latest scene in the collection, on the board; a map with no scene is made one in Atlas. */
export async function openMap(deps: OpenAssetDeps, map: any): Promise<void> {
  const scenes = deps.assetService ? await MapScenes.forApp(deps.app).read(deps.assetService, deps.collectionId) : [];
  const latest = latestSceneOn(map.mapFilePath, scenes);
  if (latest && await openScene(deps, latest.id)) return;
  if (!new AtlasBridge(deps.app).openGlobalAssetManager('maps')) new Notice('Tabletop: making a scene from a map needs Atlas.');
  else new Notice("Tabletop: make the scene in Atlas's asset manager.");
}

export function useOpenAsset(deps: OpenAssetDeps, tab?: string): OpenAsset {
  const { app, assetService, collectionId } = deps;
  // On the Maps tab the collection's scenes are read ahead, as Atlas does, so a map's menu can offer its scene.
  useEffect(() => {
    if (tab === 'maps' && assetService) runInBackground(MapScenes.forApp(app).read(assetService, collectionId), 'Reading the scenes of the maps');
  }, [app, assetService, collectionId, tab]);

  return useStableCallback(async (asset: any, spawnCount: number): Promise<void> => {
    const ctx = { app: deps.app, view: null, assetService: deps.assetService, random: Math.random };
    switch (asset.type) {
      case 'maps':
        await openMap(deps, asset);
        return;
      case 'tokens':
        await spawnAndClose(ctx as any, deps.onClose, (spawn) => spawnTokenAsset(spawn, asset, Math.max(1, spawnCount)));
        return;
      case 'scenes':
        await openScene(deps, asset.id);
        return;
      case 'encounters':
        await spawnAndClose(ctx as any, deps.onClose, (spawn) => spawnEncounterTokens(spawn, asset));
    }
  });
}
