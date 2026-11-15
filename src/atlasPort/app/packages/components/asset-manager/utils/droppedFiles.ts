// Atlas source: src/app/packages/components/asset-manager/utils/droppedFiles.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { isVideoMapPath } from '../../../../pixi/mosaicCanvas/video/videoMapFiles';
import type { CreatorMode } from '../../../../../shims/atlasTypes';
import type { Tab } from '../types';
import { isCharacterTab } from './tabKinds';

/**
 * The creator that opens with images dropped on the asset manager's window (decision #12): the
 * token creator on the tabs that list tokens, the map creator everywhere else and for any video,
 * which only a map can be.
 */
export function creatorForDroppedFiles(files: readonly File[], tab: Tab): CreatorMode {
  return isCharacterTab(tab) && !files.some((file) => isVideoMapPath(file.name)) ? 'token' : 'map';
}
