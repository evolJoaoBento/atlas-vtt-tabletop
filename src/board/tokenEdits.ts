/**
 * What the token menu changes, by Atlas's own rules (its store actions `setTokensCondition`,
 * `changeTokensConditionValue`, `resetTokens`, `addToInitiative` and `removeFromInitiative`): each returns the
 * token fields (or the initiative state) after the change, a field set to `undefined` being one Atlas deletes. The
 * token writer sends them to Atlas's store or the map file; the board shows them at once. Pure, so it is tested
 * without Obsidian.
 */
import { restedResources, type ResourceDefinition, type ResourceHolder } from './resources';

export interface ConditionHolder {
  conditions?: string[] | undefined;
  conditionValues?: Record<string, number> | undefined;
}

export type ConditionFields = { conditions: string[] | undefined; conditionValues?: Record<string, number> | undefined };

/** A valued condition held without a number counts as 1. */
const valueOf = (token: ConditionHolder, id: string): number => token.conditionValues?.[id] ?? 1;

/** The fields after taking a condition and its number off (Atlas's `removeCondition`). */
function without(token: ConditionHolder, id: string): ConditionFields {
  const remaining = (token.conditions ?? []).filter((other) => other !== id);
  const values = { ...(token.conditionValues ?? {}) };
  delete values[id];
  return { conditions: remaining.length > 0 ? remaining : undefined, conditionValues: Object.keys(values).length > 0 ? values : undefined };
}

/** Adds the condition (at the end) or takes it off; null when the token already is that way. */
export function conditionChange(token: ConditionHolder, id: string, active: boolean): ConditionFields | null {
  const has = (token.conditions ?? []).includes(id);
  if (has === active) return null;
  return active ? { conditions: [...(token.conditions ?? []), id] } : without(token, id);
}

/** Steps a valued condition: a token without it gains it at the step; one that falls to 0 loses it. */
export function conditionStep(token: ConditionHolder, id: string, delta: number): ConditionFields {
  const has = (token.conditions ?? []).includes(id);
  const next = (has ? valueOf(token, id) : 0) + delta;
  if (next <= 0) return without(token, id);
  return { conditions: has ? [...token.conditions!] : [...(token.conditions ?? []), id], conditionValues: { ...(token.conditionValues ?? {}), [id]: next } };
}

/** Reset: every defined resource back at its start (full when draining, empty when filling), every condition gone. */
export function resetChange(token: ResourceHolder & ConditionHolder, definitions: readonly ResourceDefinition[]): ResourceHolder & ConditionFields {
  const resources = restedResources(token, definitions);
  return { ...(resources ? { resources } : {}), conditions: undefined, conditionValues: undefined };
}

// ── Initiative ──────────────────────────────────────────────────────────────

/** A combatant of Atlas's initiative tracker, as its map file keeps it. */
export interface InitiativeEntry {
  id: string;
  tokenId: string;
  order: number;
  isActive: boolean;
  [field: string]: unknown;
}

export interface InitiativeState {
  entries: InitiativeEntry[];
  currentIndex: number;
  [field: string]: unknown;
}

/** Atlas's tracker before anyone joined it. */
function emptyInitiative(): InitiativeState {
  return { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } };
}

/** What Atlas puts in the tracker for a token (its `initiativeEntryForToken`). */
export function initiativeEntryFor(token: { id: string; kind?: string; name?: string | null; imagePath?: string | null; statblockPath?: string | null }): Record<string, unknown> {
  const character = token.kind === 'character';
  return {
    tokenId: token.id,
    name: character ? token.name : 'Token',
    initiative: 0,
    initiativeModifier: 0,
    imagePath: token.imagePath,
    isNPC: true,
    ...(character && token.statblockPath ? { statblockPath: token.statblockPath } : {}),
  };
}

/** The tracker with the token added last (active when it is the only one), unless it is in it already. */
export function addToInitiative(state: InitiativeState | undefined, entry: Record<string, unknown>, id: string): InitiativeState {
  const current = state ?? emptyInitiative();
  if (current.entries.some((other) => other.tokenId === entry.tokenId)) return current;
  const added: InitiativeEntry = { ...entry, id, order: current.entries.length, isActive: current.entries.length === 0 } as InitiativeEntry;
  return { ...current, entries: [...current.entries, added] };
}

/** The tracker without the token: the others' order closed up; its turn, if it had it, passed to the next one. */
export function removeFromInitiative(state: InitiativeState, tokenId: string): InitiativeState {
  const index = state.entries.findIndex((entry) => entry.tokenId === tokenId);
  if (index === -1) return state;
  const wasActive = state.entries[index]!.isActive;
  const entries = state.entries.filter((_, i) => i !== index).map((entry, order) => ({ ...entry, order }));
  if (!wasActive || entries.length === 0) return { ...state, entries };
  const next = Math.min(index, entries.length - 1);
  entries[next] = { ...entries[next]!, isActive: true };
  return { ...state, entries, currentIndex: next };
}

/** A new combatant's id, as Atlas makes them. */
export function initiativeId(): string {
  return `init_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
