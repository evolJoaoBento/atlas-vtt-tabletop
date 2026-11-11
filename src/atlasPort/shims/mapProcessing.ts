// Stand-in for Atlas's pixi/mosaicCanvas/mapProcessing.ts and packages/components/shared/useMapProcessing.ts @ 0.12.0
// (AGPL-3.0): how far Atlas has cut a large map into tiles is Atlas's own (its worker); the board's cards show none.
import type { App } from 'obsidian';

export interface MapProcessing {
  readonly none: true;
}

export const MapProcessing = {
  forApp: (_app: App | null | undefined): MapProcessing | null => null,
};

export function useSceneImagePaths(_app: App | null, _processing: MapProcessing | null, _scenePath: string | null): readonly string[] {
  return [];
}

export function useProcessingPercent(_processing: MapProcessing | null, _paths: readonly string[]): number | null {
  return null;
}
