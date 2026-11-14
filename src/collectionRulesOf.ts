/**
 * The rules of the collection a map belongs to (its grid defaults, conditions, resources), as the board reads them:
 * from Atlas's running asset service while Atlas is there (it has the settings as they are now, and writes them to
 * disk a moment after a change, in a hidden folder Obsidian announces nothing of), else from Atlas's metadata file.
 */
import type { App } from 'obsidian';
import { AtlasBridge } from './atlasBridge';
import { ASSETS_METADATA_PATH, collectionOf, emptyRules, readCollectionRules, type CollectionRules } from './board/conditions';

export async function collectionRulesOf(app: App, path: string): Promise<CollectionRules> {
  const collection = collectionOf(path);
  if (!collection) return emptyRules();
  try {
    const bridge = new AtlasBridge(app);
    const service = bridge.assetService();
    const id = bridge.collectionFor(path) ?? collection;
    const settings = service?.getCollectionSettings(id);
    if (settings && typeof settings === 'object') return readCollectionRules({ collections: { [collection]: { settings } } }, collection);
  } catch {
    // Not readable just now: the file is.
  }
  try {
    return readCollectionRules(JSON.parse(await app.vault.adapter.read(ASSETS_METADATA_PATH)), collection);
  } catch {
    return emptyRules(true);
  }
}
