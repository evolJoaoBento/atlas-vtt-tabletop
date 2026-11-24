// Atlas source: src/app/react/hooks/useCollectionWidgetLibrary.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useCallback, useSyncExternalStore } from 'react';
import { WidgetSyncService } from '../../services/WidgetSyncService';
import type { WidgetRecord } from '../../utils/collectionWidgets';
import { useAtlasUI } from '../../../shims/atlasUI';

const NO_WIDGETS: WidgetRecord = {};

/** Every widget of the collection, kept current while other scenes add or edit them. */
export function useCollectionWidgetLibrary(collectionId: string | null): WidgetRecord {
  const { app } = useAtlasUI();
  const sync = WidgetSyncService.forApp(app);
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => sync?.subscribeToLibraries(onChange) ?? (() => undefined),
    [sync],
  );
  const read = useCallback(
    (): WidgetRecord => (sync && collectionId ? sync.collectionLibrary(collectionId) : NO_WIDGETS),
    [sync, collectionId],
  );
  return useSyncExternalStore(subscribe, read, read);
}
