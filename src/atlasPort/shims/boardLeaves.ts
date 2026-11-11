// Stand-in for Atlas's plugin/atlasLeaves.ts @ 0.12.0 (AGPL-3.0) in the copies: "the map view" the asset manager acts on
// is the 3D board it was opened over (src/assets/boardTarget.ts), never Atlas's own view.
import type { App } from 'obsidian';
import { boardAtlasView } from '../../assets/boardTarget';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function getLoadedAtlasView(_app: App): any {
  return boardAtlasView();
}

export async function loadAtlasView(_app: App): Promise<any> {
  return boardAtlasView();
}

export function atlasViewOfStore(_app: App, _store: unknown): any {
  return null;
}
