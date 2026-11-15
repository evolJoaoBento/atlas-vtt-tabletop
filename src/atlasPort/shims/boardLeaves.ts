// Stand-in for Atlas's plugin/atlasLeaves.ts @ 0.15.0 (AGPL-3.0) in the copies: "the map view" the asset manager acts on
// (spawns onto) is the 3D board it was opened over (src/assets/boardTarget.ts); saving an open scene before its file
// moves is Atlas's own view's (`getLoadedAtlasView`).
import type { App } from 'obsidian';
import { boardAtlasView } from '../../assets/boardTarget';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atlas's own loaded map view, as Atlas's `getLoadedAtlasView` answers: its one caller in the copies saves an open
 * scene's pending changes before the scene's file is renamed or moved (`sceneRename.ts`), and Atlas, which holds the
 * board's map, is the one writer of it. Null without an Atlas tab, or one that is no map view yet (a deferred tab).
 */
export function getLoadedAtlasView(app: App): any {
  const view = (app.workspace.getLeavesOfType('atlas-vtt')[0]?.view ?? null) as any;
  return view && typeof view.getTabMetaStore === 'function' && typeof view.saveMap === 'function' ? view : null;
}

export async function loadAtlasView(_app: App): Promise<any> {
  return boardAtlasView();
}

export function atlasViewOfStore(_app: App, _store: unknown): any {
  return null;
}
