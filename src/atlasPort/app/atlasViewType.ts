// Atlas source: src/app/atlasViewType.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { View } from 'obsidian';
import type { AtlasView } from '../shims/atlasTypes';

/**
 * The view type of an Atlas map, apart from the view itself: code that only
 * looks for open maps (statblock rolls, a token's ring) imports this, not the
 * whole map view.
 */
export const ATLAS_VIEW_TYPE = 'atlas-vtt';

/**
 * Whether `view` is a loaded Atlas map view; a deferred leaf's placeholder is not.
 * It reads the view instead of `instanceof AtlasView`, so code that only looks for
 * open maps does not load the view and the whole app behind it.
 */
export function isAtlasView(view: View | null | undefined): view is AtlasView {
  return view?.getViewType() === ATLAS_VIEW_TYPE && 'atlasStore' in view;
}
