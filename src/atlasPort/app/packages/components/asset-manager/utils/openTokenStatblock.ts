// Atlas source: src/app/packages/components/asset-manager/utils/openTokenStatblock.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { App } from 'obsidian';
import type { TokenAsset } from '../types';
import { openStatblockNote } from '../../../../../shims/handOffs';

export interface TokenStatblockOpening {
  /** The note is gone: the dialog to link another opens instead. */
  onMissing: (asset: TokenAsset) => void;
  /** The note opened beside its statblock, in the workspace the asset manager covers. */
  onEditorOpened?: (() => void) | undefined;
}

/** Opens a token's statblock note (its card's badge, its menu); a note that is gone opens the link dialog. */
export function openTokenStatblock(app: App, asset: TokenAsset, opening: TokenStatblockOpening): void {
  if (!asset.statblockPath) return;
  // The pane takes the collection from the tokens that link the note (§7.1).
  const opened = openStatblockNote(app, asset.statblockPath, { collectionId: null, from: 'asset-manager' });
  if (opened === 'missing') opening.onMissing(asset);
  else if (opened === 'editor') opening.onEditorOpened?.();
}
