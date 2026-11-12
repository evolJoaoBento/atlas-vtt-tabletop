import { conditionKey } from './conditionSounds';

/** What the board needs of a map to hear what changed in it. */
export interface HeardMap {
  /** Names the scene shown: the news of another scene (or level) is silent. */
  id: string;
  /** The ids of the fog operations the map holds. */
  fogIds: string[];
  tokens: Array<{ id: string; conditions: string[] }>;
  /** Changes with the turn (the round and who acts); null when no fight runs. */
  turnKey: string | null;
  /** The tokens whose turn it is. */
  turnTokens: string[];
}

export interface HeardChanges {
  fogAdded: boolean;
  conditionsAdded: Array<{ tokenId: string; name: string }>;
  turnChanged: { tokens: string[] } | null;
}

/**
 * Compares each map the board is given with the one before it, in the same scene: a fog operation that is new (fog the
 * GM placed or revealed; line-of-sight discovery is no operation), a condition a token did not carry, a turn passing.
 * The first map, and the first after the scene changes, report nothing. A token or a fight that is new reports nothing either.
 */
export class BoardChanges {
  private scene: string | null = null;
  private fog = new Set<string>();
  private fogCount = 0;
  private conditions = new Map<string, Set<string>>();
  private turn: string | null = null;

  next(map: HeardMap): HeardChanges {
    const same = map.id === this.scene;
    const changes: HeardChanges = { fogAdded: false, conditionsAdded: [], turnChanged: null };
    if (same) {
      // An operation whose id repeats one already on the map still counts: the list is longer.
      changes.fogAdded = map.fogIds.length > this.fogCount || map.fogIds.some((id) => !this.fog.has(id));
      for (const token of map.tokens) {
        const had = this.conditions.get(token.id);
        if (!had) continue;
        for (const name of token.conditions) if (!had.has(conditionKey(name))) changes.conditionsAdded.push({ tokenId: token.id, name });
      }
      if (this.turn !== null && map.turnKey !== null && map.turnKey !== this.turn) changes.turnChanged = { tokens: [...map.turnTokens] };
    }
    this.scene = map.id;
    this.fog = new Set(map.fogIds);
    this.fogCount = map.fogIds.length;
    this.conditions = new Map(map.tokens.map((token) => [token.id, new Set(token.conditions.map(conditionKey))]));
    this.turn = map.turnKey;
    return changes;
  }
}
