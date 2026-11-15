// Stand-in for Atlas's services/AssetThumbnailService.ts @ 0.15.0 (AGPL-3.0): Atlas makes and writes thumbnails; the board
// only reads the ones Atlas made (a second maker would write them twice). A card without one shows the asset's own image.
import { TFile, type App } from 'obsidian';

export interface ThumbnailUpdate { id: string; thumbnailPath: string | null }
export interface ThumbnailState { path?: string; pending: boolean }
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ThumbnailAsset = { id: string; thumbnailPath?: string; [key: string]: any };

class ReadOnlyThumbnails {
  constructor(private readonly app: App) {}

  hasThumbnail(asset: ThumbnailAsset): boolean {
    return asset.thumbnailPath !== undefined && this.app.vault.getAbstractFileByPath(asset.thumbnailPath) instanceof TFile;
  }

  stateOf(asset: ThumbnailAsset): ThumbnailState {
    return this.hasThumbnail(asset) && asset.thumbnailPath ? { path: asset.thumbnailPath, pending: false } : { pending: false };
  }

  onUpdated(_listener: (updates: ThumbnailUpdate[]) => void): () => void { return () => {}; }
  ensureThumbnails(_assets: readonly ThumbnailAsset[]): void {}
  prioritize(_assetIds: readonly string[]): void {}
  async tryThumbnailForImage(_imagePath: string, _thumbnail?: unknown): Promise<undefined> { return undefined; }
}

const instances = new WeakMap<App, ReadOnlyThumbnails>();

export const AssetThumbnailService = {
  getInstance(app: App, _assetService?: unknown): ReadOnlyThumbnails {
    let found = instances.get(app);
    if (!found) { found = new ReadOnlyThumbnails(app); instances.set(app, found); }
    return found;
  },
};
