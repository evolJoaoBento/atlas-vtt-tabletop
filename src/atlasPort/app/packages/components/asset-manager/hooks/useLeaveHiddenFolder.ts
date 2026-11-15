// Atlas source: src/app/packages/components/asset-manager/hooks/useLeaveHiddenFolder.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect } from 'react';
import type { AssetData } from './useAssetData';
import type { SelectionState } from './useSelectionHandlers';

/**
 * Leaves an open folder the Characters tab stopped showing, since only player characters fill
 * it now, for the nearest folder above it that shows, or the root. Also covers a remembered
 * folder restored on opening, once the tab has loaded.
 */
export function useLeaveHiddenFolder(
  data: Pick<AssetData, 'assetsLoading' | 'shownFolderOf'>,
  sel: Pick<SelectionState, 'selectedFolderId' | 'handleNavigateToFolder'>,
): void {
  const { selectedFolderId, handleNavigateToFolder } = sel;
  const target = data.assetsLoading ? selectedFolderId : data.shownFolderOf(selectedFolderId);
  useEffect(() => {
    if (target !== selectedFolderId) handleNavigateToFolder(target);
  }, [target, selectedFolderId, handleNavigateToFolder]);
}
