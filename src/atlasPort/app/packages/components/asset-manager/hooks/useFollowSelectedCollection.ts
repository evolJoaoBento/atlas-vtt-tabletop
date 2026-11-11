// Atlas source: src/app/packages/components/asset-manager/hooks/useFollowSelectedCollection.ts @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { useEffect, useRef } from 'react';
import type { CollectionOption } from '../types';

/**
 * Keeps the selection on a real collection. Renaming a collection's folder
 * changes its id but not its uid, so the selection follows it; a deleted
 * collection falls back to the default one.
 */
export function useFollowSelectedCollection(
  collections: readonly CollectionOption[],
  selectedCollection: string,
  setSelectedCollection: (collectionId: string) => void,
): void {
  const selectedUid = useRef<string | null>(null);

  useEffect(() => {
    if (collections.length === 0) return;
    const selected = collections.find((collection) => collection.id === selectedCollection);
    if (selected) {
      selectedUid.current = selected.uid;
      return;
    }
    const moved = collections.find((collection) => collection.uid === selectedUid.current);
    setSelectedCollection(moved?.id ?? collections.find((collection) => collection.isDefault)?.id ?? collections[0]!.id);
  }, [collections, selectedCollection, setSelectedCollection]);
}
