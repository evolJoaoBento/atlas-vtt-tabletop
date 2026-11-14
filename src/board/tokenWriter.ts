/**
 * Saves what the board changes on a map: a token moved, copied (Shift + Alt-drag), killed, reset, hidden or shown, given or
 * relieved of a condition, deleted, put in or taken out of the initiative; a resource stepped or edited; and what the
 * initiative tracker does (turns, rolls, the order, a fight started or ended).
 *
 * Atlas's store is the only writer of Atlas's records. Atlas keeps one map loaded at a time and never re-reads a file it
 * has open, so a change goes through the store actions of the Atlas view holding the map, which Atlas shows and saves.
 * While Atlas is on its way to the map, a change waits for it (`held`); a map it does not come to hold is not changed
 * at all (`NotHeldError`), and the board's bar offers Edit here. No map file is ever written.
 *
 * A held change is made at once, before any wait: the undo recorder counts the steps Atlas's history gained by the
 * time the call returns.
 */
import type { AtlasSceneState, AtlasView } from '../atlas';
import { defeatedResources, resourceUpdate, type ResourceDefinition, type ResourceValue, type ResourceHolder } from './resources';
import { initiativeEntryFor } from './tokenEdits';
import type { InitiativeAction } from './initiative';
import { mergeExtra, type WallExtraChange } from './recordExtras';

type RawToken = Record<string, unknown> & { x?: number; y?: number; imagePath?: string; instanceNumber?: number };
/**
 * What a change does to a token, given it as Atlas holds it in memory (its resources as `resources`): the fields it
 * sets, `undefined` for one it deletes; null when it changes nothing.
 */
export type TokenChange = (token: ResourceHolder & Record<string, unknown>) => Record<string, unknown> | null;

/** Sets one resource: `edit` turns the value the token holds into the new one. */
function setResource(key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): TokenChange {
  return (token) => {
    const stored = token.resources?.[key];
    if (!stored) throw new Error(`the token has no ${key}`);
    return resourceUpdate(token, key, edit(stored), maxEdited);
  };
}

const kill = (definitions: readonly ResourceDefinition[]): TokenChange => (token) => {
  const resources = defeatedResources(token, definitions);
  return resources ? { resources } : null;
};

/** A new token id as Atlas makes them (`addTokens` in its store). */
export const newTokenId = (): string => `tok_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

/** What a token keeps when it goes to another scene: everything but its copy number (the new scene numbers it) and the floor it stood on. */
function arrivingToken(raw: Record<string, unknown>, id: string, x: number, y: number): RawToken {
  const { instanceNumber: _number, level: _level, levels: _levels, offLevel: _offLevel, levelId: _levelId, ...kept } = raw;
  return { ...structuredClone(kept), id, x, y } as RawToken;
}

/** Sends a tracker change to Atlas's store, the action Atlas's own tracker calls; false when Atlas offers none. */
function sendToAtlas(state: AtlasSceneState, action: InitiativeAction): boolean {
  switch (action.type) {
    case 'roll': {
      if (action.entryId !== undefined) {
        if (!state.rollEntryInitiative) return false;
        state.rollEntryInitiative(action.entryId, action.roll, action.statblockModifiers[action.entryId] ?? null);
      } else {
        if (!state.rollAllInitiative) return false;
        state.rollAllInitiative(action.roll, new Map(Object.entries(action.statblockModifiers)));
      }
      return true;
    }
    // Atlas 0.9 passes the defeated by (an older Atlas takes no such set and ignores it).
    case 'next': return state.nextTurn ? (state.nextTurn(new Set(action.defeated ?? [])), true) : false;
    case 'previous': return state.previousTurn ? (state.previousTurn(new Set(action.defeated ?? [])), true) : false;
    case 'reorder': return state.reorderInitiative ? (state.reorderInitiative(action.from, action.to), true) : false;
    case 'front': return state.moveToFront ? (state.moveToFront(action.id), true) : false;
    case 'back': return state.moveToBack ? (state.moveToBack(action.id), true) : false;
    case 'start': return state.startCombat ? (state.startCombat(action.rules, new Set(action.defeated ?? [])), true) : false;
    case 'end': return state.endCombat ? (state.endCombat(), true) : false;
    case 'sitsOut': return state.setInitiativeSitsOut ? (state.setInitiativeSitsOut(action.id, action.sitsOut), true) : false;
    case 'reset': {
      if (!state.resetInitiative) return false;
      // The combatants kept beside the map (Atlas 0.9) go with the tracker, as Atlas's Clear takes them.
      const beside = Object.values(state.objects.tokens).filter((token) => (token as { offMap?: unknown }).offMap === true).map((token) => token.id);
      state.resetInitiative();
      if (beside.length > 0) state.deleteTokens?.(beside);
      return true;
    }
    case 'edit': return state.updateInitiativeEntry ? (state.updateInitiativeEntry(action.id, action.changes), true) : false;
    case 'remove': {
      if (!state.removeFromInitiative) return false;
      const tokenId = state.initiative?.entries.find((entry) => entry.id === action.id)?.tokenId;
      state.removeFromInitiative(action.id, new Set(action.defeated ?? []));
      // One kept beside the map (Atlas 0.9) goes with its token, as Atlas removes it.
      const token = tokenId ? state.objects.tokens[tokenId] as { offMap?: unknown } | undefined : undefined;
      if (tokenId && token?.offMap === true) state.deleteTokens?.([tokenId]);
      return true;
    }
  }
}

/**
 * An edit of Atlas's records on a map Atlas does not hold. Atlas keeps one map loaded at a time, and its store is the
 * only thing that writes a map: the edit is refused, and the board's bar offers Edit here.
 */
/**
 * An edit of Atlas's records on a map Atlas does not hold. Atlas keeps one map loaded at a time, and its store is the
 * only thing that writes a map: the edit is refused, and the board's bar offers Edit here.
 */
export class NotHeldError extends Error {
  constructor() {
    super('Atlas holds another map: click Edit here first.');
    this.name = 'NotHeldError';
  }
}

/** Atlas's level holds as many measures as it keeps: one more is refused. */
export class MeasureFullError extends Error {
  constructor() {
    super('This level holds as many measures as Atlas keeps: remove one first.');
    this.name = 'MeasureFullError';
  }
}

export interface TokenWriterDeps {
  /** The open Atlas map views. */
  views: () => AtlasView[];
  /**
   * The state of Atlas's store once it holds `path`: at once when it does; after the wait when Atlas is on its way to
   * the map (edits made meanwhile wait here, in the order they were made); null when it does not come to.
   */
  held: (path: string) => Promise<AtlasSceneState | null>;
  /** Makes Atlas hold `path` and waits for it; false when it does not come to. Without it a token never changes scene. */
  follow?: (path: string) => Promise<boolean>;
}

export class TokenWriter {
  constructor(private readonly deps: TokenWriterDeps) {}

  /** The Atlas view holding the map, loaded; null when none does. */
  holder(path: string): AtlasView | null {
    for (const view of this.deps.views()) {
      const state = view.atlasStore.getState();
      if (state.mapPath === path && state.mapLoaded !== false && state.isMapLoading !== true) return view;
    }
    return null;
  }

  /** Waits for Atlas when the map is not held yet, so an edit made while it loads goes to its store. */
  private async ready(path: string): Promise<void> {
    await this.deps.held(path);
  }

  /** The store of the Atlas view holding the map; `NotHeldError` when none does. */
  private store(path: string): AtlasSceneState {
    const view = this.holder(path);
    if (!view) throw new NotHeldError();
    return view.atlasStore.getState();
  }

  /** The store holding the map, which must hold the token. */
  private tokenStore(path: string, id: string): AtlasSceneState {
    const state = this.store(path);
    if (!Object.hasOwn(state.objects?.tokens ?? {}, id)) throw new Error(`no token ${id} on this map`);
    return state;
  }

  /** Atlas holds the map but not the action needed. */
  private static missing(action: string): Error {
    return new Error(`Atlas has this map open but offers no ${action} here; change it in Atlas`);
  }

  /** Moves the token. */
  async move(path: string, id: string, x: number, y: number): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.updateToken) throw TokenWriter.missing('token update');
    state.updateToken(id, { x, y });
  }

  /** Moves several tokens as one change (one undo step in Atlas). */
  async moveMany(path: string, moves: ReadonlyArray<{ id: string; x: number; y: number }>): Promise<void> {
    const first = moves[0];
    if (!first) return;
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, first.id);
    if (state.updateTokens) {
      state.updateTokens(moves.map(({ id, x, y }) => ({ id, changes: { x, y } })));
      return;
    }
    if (!state.updateToken) throw TokenWriter.missing('token update');
    for (const { id, x, y } of moves) state.updateToken(id, { x, y });
  }

  /** Turns several tokens as one request each (degrees, 0 to 360). */
  async rotate(path: string, turns: ReadonlyArray<{ id: string; rotation: number }>): Promise<void> {
    const first = turns[0];
    if (!first) return;
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, first.id);
    if (state.updateTokens) {
      state.updateTokens(turns.map(({ id, rotation }) => ({ id, changes: { rotation } })));
      return;
    }
    if (!state.updateToken) throw TokenWriter.missing('token update');
    for (const { id, rotation } of turns) state.updateToken(id, { rotation });
  }

  /** Copies the token to (x, y) under `newId` (Atlas numbers the copy). */
  async copy(path: string, id: string, newId: string, x: number, y: number): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.addToken) throw TokenWriter.missing('way to add a token');
    const source = structuredClone(state.objects.tokens[id]) as unknown as RawToken;
    delete source.instanceNumber;
    state.addToken({ ...source, id: newId, x, y });
  }

  /** Changes a token through Atlas's store, which holds its resources as `resources`. */
  private async change(path: string, id: string, change: TokenChange): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.updateToken) throw TokenWriter.missing('token update');
    const changes = change(state.objects.tokens[id] as unknown as ResourceHolder & Record<string, unknown>);
    if (changes) state.updateToken(id, changes);
  }

  /**
   * Sets one of the token's resources: `edit` gets the value Atlas holds now, so steps made in quick succession add up
   * even before the board has read them back.
   */
  resource(path: string, id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): Promise<void> {
    return this.change(path, id, setResource(key, edit, maxEdited));
  }

  /** Changes the token as `change` says (a condition, hidden or shown, Reset). */
  update(path: string, id: string, change: TokenChange): Promise<void> {
    return this.change(path, id, change);
  }

  /** Puts the token in Atlas's initiative tracker, or takes it out; its tracker opens too, as Atlas's menu opens it. */
  async initiative(path: string, id: string, join: boolean): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.addToInitiative || !state.removeFromInitiative) throw TokenWriter.missing('initiative tracker');
    if (state.initiativeTrackerOpen === false) state.setInitiativeTrackerOpen?.(true);
    const entry = state.initiative?.entries.find((candidate) => candidate.tokenId === id);
    const token = state.objects.tokens[id] as unknown as Parameters<typeof initiativeEntryFor>[0];
    if (join && !entry) state.addToInitiative(initiativeEntryFor(token));
    else if (!join && entry) state.removeFromInitiative(entry.id);
  }

  /** Changes the initiative tracker as `action` says, through Atlas's own tracker actions (Atlas rolls its own dice). */
  async initiativeAction(path: string, action: InitiativeAction): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    if (!sendToAtlas(this.store(path), action)) throw TokenWriter.missing('such initiative action');
  }

  /** Whether the tracker can do `action` on this map: when Atlas holds it, as Atlas offers it; else it will be asked. */
  offers(path: string, action: 'reset' | 'sitsOut'): boolean {
    const state = this.holder(path)?.atlasStore.getState();
    if (!state) return true;
    return action === 'reset' ? typeof state.resetInitiative === 'function' : typeof state.setInitiativeSitsOut === 'function';
  }

  /**
   * Adds spawned tokens (Atlas's token inputs) and gives their ids at once, as Atlas's `addTokens` does: through Atlas's
   * store when it holds the map (one undo step there); else once it holds it (Atlas keeps an id it is handed), and
   * `done` rejects with `NotHeldError` when it does not come to.
   */
  addTokensNow(path: string, inputs: ReadonlyArray<Record<string, unknown>>): { ids: string[]; done: Promise<unknown> } {
    type Adds = { addTokens?: (inputs: ReadonlyArray<Record<string, unknown>>) => string[] };
    const view = this.holder(path);
    if (view) {
      const add = (view.atlasStore.getState() as Adds).addTokens;
      if (typeof add !== 'function') throw TokenWriter.missing('way to add tokens');
      return { ids: add(inputs), done: Promise.resolve() };
    }
    const withIds = inputs.map((input) => ({ ...input, id: typeof input.id === 'string' ? input.id : newTokenId() }));
    const done = this.deps.held(path).then(() => {
      const store = this.store(path) as Adds;
      if (typeof store.addTokens !== 'function') throw TokenWriter.missing('way to add tokens');
      store.addTokens(withIds);
    });
    return { ids: withIds.map((input) => input.id), done };
  }

  /** Saves the random tables window's choices for the map, through Atlas's `updateLootRoller`. */
  async lootRoller(path: string, settings: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const update = (this.store(path) as { updateLootRoller?: (settings: Readonly<Record<string, unknown>>) => void }).updateLootRoller;
    if (typeof update !== 'function') throw TokenWriter.missing('random tables');
    update(settings);
  }

  /** Runs `fn` as one step of Atlas's history on the view holding the map (as it stands, where Atlas offers no transaction). */
  private asOneStep<T>(path: string, fn: () => T): T {
    const transaction = this.holder(path)?.atlasStore.temporal?.getState().transaction;
    return transaction ? transaction(fn) : fn();
  }

  /**
   * Keeps a measure on the map (a spell, a template: `packages/atlas-host` `spellMeasure`), as Atlas keeps its own, in
   * one step of its history; its id in Atlas. `MeasureFullError` when the level holds no more.
   */
  async addMeasure(path: string, record: Readonly<Record<string, unknown>>): Promise<string> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.addMeasure) throw TokenWriter.missing('measures');
    const add = state.addMeasure;
    const id = this.asOneStep(path, () => add({ ...record }));
    if (id === null) throw new MeasureFullError();
    return id;
  }

  /** Takes measures off the map, together in one step of Atlas's history; one Atlas no longer has is passed over. */
  async removeMeasures(path: string, ids: readonly string[]): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.deleteMeasure) throw TokenWriter.missing('measures');
    const remove = state.deleteMeasure;
    const there = ids.filter((id) => Object.hasOwn(state.objects?.measures ?? {}, id));
    if (there.length === 0) return;
    this.asOneStep(path, () => { for (const id of there) remove(id); });
  }

  /**
   * Sets what the GM sets on walls or doors in 3D (`recordExtras.ts`): each wall's own record takes the change in its
   * `tabletop` field (a key given as null goes; the field's other keys stay), all in one step of Atlas's history. A
   * wall Atlas no longer has is passed over.
   */
  async setWallExtras(path: string, ids: readonly string[], change: WallExtraChange): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.updateWall) throw TokenWriter.missing('wall update');
    const update = state.updateWall;
    const walls = state.objects?.walls ?? {};
    const there = ids.filter((id) => Object.hasOwn(walls, id));
    if (there.length === 0) return;
    this.asOneStep(path, () => { for (const id of there) update(id, { tabletop: mergeExtra(walls[id]?.tabletop, change) }); });
  }

  /**
   * Sets how high a light hangs, in grid squares (null: its default again): on the placed light's own record, or, for
   * a light a token carries (`lightId` is the token's id), on the token's. One step of Atlas's history.
   */
  async setLightHeight(path: string, lightId: string, height: number | null): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    const lights = state.objects?.lights ?? {};
    const tokens = state.objects?.tokens ?? {};
    if (Object.hasOwn(lights, lightId)) {
      if (!state.updateLight) throw TokenWriter.missing('light update');
      const update = state.updateLight;
      this.asOneStep(path, () => update(lightId, { tabletop: mergeExtra(lights[lightId]?.tabletop, { height }) }));
    } else if (Object.hasOwn(tokens, lightId)) {
      if (!state.updateToken) throw TokenWriter.missing('token update');
      const update = state.updateToken;
      this.asOneStep(path, () => update(lightId, { tabletop: mergeExtra((tokens[lightId] as { tabletop?: unknown }).tabletop, { lightHeight: height }) }));
    }
  }

  /** Opens or shuts a door (a locked one stays shut). */
  async toggleDoor(path: string, id: string): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.toggleDoor) throw TokenWriter.missing('door action');
    state.toggleDoor(id);
  }

  /** Makes walls Atlas's windows (they stop only tokens; sight and light pass both ways), or plain walls again. */
  async setWindow(path: string, ids: readonly string[], window: boolean): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.updateWall) throw TokenWriter.missing('wall update');
    for (const id of ids) state.updateWall(id, { blocks: window ? 'movement' : undefined });
  }

  /** Turns Atlas's Snap to grid (for tokens) on or off for the map. */
  async setSnapToGrid(path: string, on: boolean): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.setSnapToGrid) throw TokenWriter.missing('snap to grid');
    state.setSnapToGrid(on);
  }

  /**
   * Sets the scene's light level (0 to 1) and the colour it is tinted, as Atlas's lighting page does. An
   * `ambientColor` given as undefined takes the colour off.
   */
  async setSceneLighting(path: string, changes: { ambient?: number; ambientColor?: string | undefined }): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.setSceneLighting) throw TokenWriter.missing('scene lighting');
    const given: { ambient?: number; ambientColor?: string | undefined } = {};
    if (typeof changes.ambient === 'number' && Number.isFinite(changes.ambient)) given.ambient = Math.min(1, Math.max(0, changes.ambient));
    if (Object.hasOwn(changes, 'ambientColor')) given.ambientColor = changes.ambientColor;
    state.setSceneLighting(given);
  }

  /** Locks a door (shutting it) or unlocks it. */
  async lockDoor(path: string, id: string, locked: boolean): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.setDoorLocked) throw TokenWriter.missing('door lock');
    state.setDoorLocked(id, locked);
  }

  /** Lets players read a pin's note online, or not (Atlas's "Readable by players"). */
  async setPinReadable(path: string, id: string, readable: boolean): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.updateNotePin) throw TokenWriter.missing('pin update');
    state.updateNotePin(id, { readable: readable ? true : undefined });
  }

  /** Kills the token, as Atlas's Kill does: every resource that defeats it spent. */
  kill(path: string, id: string, definitions: readonly ResourceDefinition[]): Promise<void> {
    return this.change(path, id, kill(definitions));
  }

  /**
   * Takes a token to another scene: added there under `newId` at (x, y), and only then removed from this one, so a
   * failure leaves it where it was. Atlas holds one map at a time, so this is two held steps: Atlas is brought to `to`
   * for the add, then back to `from` for the removal; it stops before the removal when either map does not come to be
   * held. Without `follow` the token stays where it is (`NotHeldError`).
   */
  async transfer(from: string, id: string, to: string, newId: string, at: { x: number; y: number }): Promise<void> {
    const follow = this.deps.follow;
    if (this.holder(from) === null) await this.ready(from);
    const state = this.tokenStore(from, id);
    if (!follow) throw new NotHeldError();
    const raw = structuredClone(state.objects.tokens[id]) as unknown as Record<string, unknown>;
    const target = (await follow(to)) ? this.holder(to)?.atlasStore.getState() : null;
    if (!target) throw new NotHeldError();
    if (!target.addToken) throw TokenWriter.missing('way to add a token');
    target.addToken(arrivingToken(raw, newId, at.x, at.y));
    // Back to the map it came from: only there can it be taken away. Not held again, it stays on both, and the caller says so.
    const back = (await follow(from)) ? this.holder(from)?.atlasStore.getState() : null;
    if (!back || !Object.hasOwn(back.objects?.tokens ?? {}, id)) throw new NotHeldError();
    if (!back.deleteTokens) throw TokenWriter.missing('way to delete a token');
    back.deleteTokens([id]);
  }

  /** Deletes the token from the map. */
  async remove(path: string, id: string): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.deleteTokens) throw TokenWriter.missing('way to delete a token');
    state.deleteTokens([id]);
  }
}
