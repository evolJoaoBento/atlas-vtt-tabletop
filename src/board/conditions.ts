/**
 * A map's rules from its collection, as Atlas keeps them in `atlas-vtt/.atlas-data/assets-metadata.json`: the
 * conditions a token may carry (name, colour, whether it takes a number) and the names and colours of the stat block's
 * resources. A map belongs to the collection whose folder (`atlas-vtt/collections/<id>/`) holds it. Pure.
 */

export interface ConditionDefinition {
  name: string;
  color: string;
  /** Carries a number on each token (Exhaustion 2). */
  valued: boolean;
}

export interface ResourceDefinition {
  name: string;
  color: string;
}

export interface CollectionRules {
  conditions: Map<string, ConditionDefinition>;
  resources: Map<string, ResourceDefinition>;
}

export const ASSETS_METADATA_PATH = 'atlas-vtt/.atlas-data/assets-metadata.json';
const COLLECTIONS_FOLDER = 'atlas-vtt/collections/';

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The collection a map belongs to, or null when it is not in one. */
export function collectionOf(mapPath: string): string | null {
  if (!mapPath.startsWith(COLLECTIONS_FOLDER)) return null;
  const id = mapPath.slice(COLLECTIONS_FOLDER.length).split('/')[0];
  return id ? id : null;
}

export function emptyRules(): CollectionRules {
  return { conditions: new Map(), resources: new Map() };
}

/** Reads a collection's conditions and resource names from Atlas's asset index. */
export function readCollectionRules(metadata: unknown, collection: string): CollectionRules {
  const rules = emptyRules();
  const settings = isObj(metadata) && isObj(metadata.collections) && isObj(metadata.collections[collection]) ? metadata.collections[collection].settings : null;
  if (!isObj(settings)) return rules;
  if (Array.isArray(settings.conditions)) {
    for (const entry of settings.conditions) {
      if (!isObj(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') continue;
      rules.conditions.set(entry.id, { name: entry.name, color: typeof entry.color === 'string' ? entry.color : '#888888', valued: entry.valued === true });
    }
  }
  if (Array.isArray(settings.resources)) {
    for (const entry of settings.resources) {
      if (!isObj(entry) || typeof entry.key !== 'string' || typeof entry.name !== 'string') continue;
      rules.resources.set(entry.key, { name: entry.name, color: typeof entry.color === 'string' ? entry.color : '#64748b' });
    }
  }
  return rules;
}

/** A condition's name as Atlas shows it: a valued one with its number (1 when unset). */
export function conditionLabel(definition: ConditionDefinition, value: number | undefined): string {
  return definition.valued ? `${definition.name} ${value ?? 1}` : definition.name;
}

/** A resource's name: the collection's, else its key made readable (`ki-points` → `Ki points`). */
export function resourceLabel(rules: CollectionRules, key: string): string {
  const named = rules.resources.get(key)?.name;
  if (named) return named;
  const words = key.replace(/[-_.]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
