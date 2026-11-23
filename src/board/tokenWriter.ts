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
import type { ExtrasMove } from './extrasMigration';
import { moveOf, type StackPlan } from './stackMove';
import { resolveLevel, type BoardLevel } from './levels';
import { collectMapObjects, countMapObjects, type MapObjectContent } from '../atlasPort/app/clipboard/mapObjectContent';
import { duplicateStep, pasteOffset, placeMapObjects } from '../atlasPort/app/clipboard/mapObjectPlacement';
import { levelObjects } from '../atlasPort/app/levels/levelObjects';
import type { GridState } from '../atlasPort/shims/atlasTypes';

type RawToken = Record<string, unknown> & { x?: number; y?: number; imagePath?: string; instanceNumber?: number };
/**
 * What a change does to a token, given it as Atlas holds it in memory (its resources as `resources`): the fields it
 * sets, `undefined` for one it deletes; null when it changes nothing.
 */
export type TokenChange = (token: ResourceHolder & Record<string, unknown>) => Record<string, unknown> | null;
/**
 * A change to a map's liquids worked out on those Atlas has at the moment of the write (`objects.liquids`, every
 * level's), and its lights (`objects.lights`): liquids to take off and add, and lights to take off (the glow of lava
 * and acid the brush made). A liquid added with a `glow` (a light's input) gets that light made with it.
 */
export type LiquidPlan = (liquids: Readonly<Record<string, unknown>>, lights: Readonly<Record<string, unknown>>) => { remove: readonly string[]; add: ReadonlyArray<Record<string, unknown>>; removeLights?: readonly string[] };

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
    case 'resetNumbers': return state.resetInitiativeNumbers ? (state.resetInitiativeNumbers(), true) : false;
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
  offers(path: string, action: 'reset' | 'sitsOut' | 'resetNumbers'): boolean {
    const state = this.holder(path)?.atlasStore.getState();
    // Reset initiative is Atlas 0.18's: hidden until Atlas holds the map and has it.
    if (action === 'resetNumbers') return typeof state?.resetInitiativeNumbers === 'function';
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

  /**
   * Changes a kept measure (its points moved, its colour, who sees it, its look…), as Atlas's own `updateMeasure` does, in
   * one step of its history. A field given as `undefined` goes. One Atlas no longer has is passed over; an Atlas without
   * `updateMeasure` (before 0.19) refuses.
   */
  async updateMeasure(path: string, id: string, changes: Readonly<Record<string, unknown>>): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.updateMeasure) throw TokenWriter.missing('measures');
    const update = state.updateMeasure;
    if (!Object.hasOwn(state.objects?.measures ?? {}, id)) return;
    this.asOneStep(path, () => update(id, { ...changes }));
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
    // A wall that already is as asked is left alone: setting what is there is no step of anyone's undo.
    const next = ids.filter((id) => Object.hasOwn(walls, id)).map((id) => ({ id, tabletop: mergeExtra(walls[id]?.tabletop, change) }))
      .filter(({ id, tabletop }) => JSON.stringify(tabletop ?? null) !== JSON.stringify(mergeExtra(walls[id]?.tabletop, {}) ?? null));
    if (next.length === 0) return;
    this.asOneStep(path, () => { for (const { id, tabletop } of next) update(id, { tabletop }); });
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

  /**
   * Writes a move of the GM's 3D settings onto Atlas's records (`extrasMigration.ts`), outside Atlas's history: a
   * migration is no step of the GM's undo. `NotHeldError` when Atlas does not hold the map: nothing is moved then.
   */
  async applyExtrasMove(path: string, move: ExtrasMove): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const view = this.holder(path);
    if (!view) throw new NotHeldError();
    const write = (): void => {
      // Read fresh at every write: an action swaps the store's state.
      const now = (): AtlasSceneState => view.atlasStore.getState();
      for (const { id, change } of move.walls) now().updateWall?.(id, { tabletop: mergeExtra(now().objects?.walls?.[id]?.tabletop, change) });
      for (const { id, height } of move.lights) now().updateLight?.(id, { tabletop: mergeExtra(now().objects?.lights?.[id]?.tabletop, { height }) });
      for (const { id, height } of move.tokens) now().updateToken?.(id, { tabletop: mergeExtra((now().objects?.tokens?.[id] as { tabletop?: unknown } | undefined)?.tabletop, { lightHeight: height }) });
    };
    if (move.walls.length + move.lights.length + move.tokens.length === 0) return;
    // All of it or none: a move half written would leave data.json cleared of what never reached a record.
    const history = view.atlasStore.temporal?.getState();
    if (!history?.untracked) throw TokenWriter.missing('untracked writes');
    const state = view.atlasStore.getState();
    if (move.walls.length > 0 && !state.updateWall) throw TokenWriter.missing('wall update');
    if (move.lights.length > 0 && !state.updateLight) throw TokenWriter.missing('light update');
    if (move.tokens.length > 0 && !state.updateToken) throw TokenWriter.missing('token update');
    history.untracked(write);
    // Atlas's undo puts back the whole records a step changed, as they were: a step from before the move would take
    // what was moved away with it, and Tabletop's data no longer has it. Its older steps on this map are let go, once.
    const after = view.atlasStore.temporal?.getState();
    if (after && after.pastStates.length + after.futureStates.length > 0) after.clear?.();
  }

  /**
   * Writes a scene stack as the levels of its base scene (`stackMove.ts`), which Atlas must hold now (it is not waited
   * for: the caller brought it there). The plan is asked at the write, of the store's state then; null writes
   * nothing. Atlas's own actions do it: the whole scene in one `applyLevelScene`, then each fitted level aligned,
   * which moves that level's records with its image, and the base's level shown. Outside Atlas's history and whole or
   * not at all: a write that breaks puts the scene back as it was. Atlas's older steps on the map are let go, as for
   * `applyExtrasMove`. The plan written.
   */
  async applyStackMove(path: string, plan: (state: AtlasSceneState) => StackPlan | null): Promise<StackPlan | null> {
    const view = this.holder(path);
    if (!view) throw new NotHeldError();
    const history = view.atlasStore.temporal?.getState();
    if (!history?.untracked) throw TokenWriter.missing('untracked writes');
    const state = view.atlasStore.getState();
    if (!state.applyLevelScene || !state.alignLevel) throw TokenWriter.missing('way to write levels');
    const planned = plan(state);
    if (!planned) return null;
    const before = { levels: state.levels, background: state.background, objects: state.objects, exploredMask: state.exploredMask, exploredMasks: state.exploredMasks, levelAlignments: state.levelAlignments, grid: state.grid };
    const viewed = state.viewedLevel ?? null;
    // Read fresh at every write: an action swaps the store's state.
    const now = (): AtlasSceneState => view.atlasStore.getState();
    history.untracked(() => {
      try {
        now().applyLevelScene?.({ ...planned.scene });
        for (const { level, alignment, frame } of planned.aligns) now().alignLevel?.(level, alignment, moveOf(frame));
        now().setViewedLevel?.(planned.baseLevel);
      } catch (error) {
        now().applyLevelScene?.(before);
        now().setViewedLevel?.(viewed);
        throw error;
      }
    });
    const after = view.atlasStore.temporal?.getState();
    if (after && after.pastStates.length + after.futureStates.length > 0) after.clear?.();
    return planned;
  }

  /**
   * Replaces liquids of the map (`liquids.ts`): `remove` are taken off and `add` kept, together in one step of Atlas's
   * history (Atlas has no update for a liquid). A liquid Atlas no longer has is passed over. The ids Atlas gave.
   * Given a plan instead, what to take off and what to add is asked of it at the write, with the liquids Atlas has then.
   * A liquid added with a `glow` gets its light in the same step (lava is linked to it, `lavaLight`, as Atlas links its
   * own); one the level has no room for is not kept, nor its light. The plan's `removeLights` go too.
   */
  async replaceLiquids(path: string, change: readonly string[] | LiquidPlan, adding: ReadonlyArray<Record<string, unknown>> = []): Promise<string[]> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.addLiquids || !state.deleteLiquid) throw TokenWriter.missing('liquids');
    // A plan is made here, on the liquids Atlas has now: what the caller read before may be a write behind.
    const { remove, add, removeLights = [] } = typeof change === 'function' ? change(state.objects?.liquids ?? {}, state.objects?.lights ?? {}) : { remove: change, add: adding };
    const there = remove.filter((id) => Object.hasOwn(state.objects?.liquids ?? {}, id));
    const lightsThere = removeLights.filter((id) => Object.hasOwn(state.objects?.lights ?? {}, id));
    if (there.length === 0 && add.length === 0 && lightsThere.length === 0) return [];
    const glows = add.some((liquid) => liquid.glow !== undefined);
    if ((glows && !state.addLight) || (lightsThere.length > 0 && !state.deleteLight)) throw TokenWriter.missing('lights');
    const view = this.holder(path);
    // Read fresh at every write: an action swaps the store's state.
    const now = (): AtlasSceneState => view?.atlasStore.getState() ?? state;
    return this.asOneStep(path, () => {
      for (const id of there) now().deleteLiquid?.(id);
      for (const id of lightsThere) now().deleteLight?.(id);
      if (add.length === 0) return [];
      const lights: Array<string | null> = [];
      const inputs = add.map(({ glow, ...liquid }) => {
        const light = glow && typeof glow === 'object' ? now().addLight?.({ ...(glow as Record<string, unknown>) }) ?? null : null;
        lights.push(light);
        return light && liquid.liquid === 'lava' ? { ...liquid, lavaLight: light } : liquid;
      });
      const ids = now().addLiquids?.(inputs) ?? [];
      // A level that is full takes the first ones it has room for: the lights of the rest go again.
      for (const light of lights.slice(ids.length)) if (light) now().deleteLight?.(light);
      return ids;
    });
  }

  /**
   * What Atlas's fog actions the writer can use on the map are there, read at once: `add` (Atlas 0.15 has one operation at a
   * time, 0.17+ several), `clear`, `cover` (hide the whole map) and `hideRooms` (the latter two are Atlas 0.17-0.18's), and the
   * fog menu's `reveal`, `hide` and `forget` (Atlas 0.18's: fog revealed from its menu is remembered, hidden again, or forgotten).
   * With Atlas not holding the map yet, all of them are taken to be there (it is asked at the write).
   */
  fogOffers(path: string): { add: boolean; clear: boolean; cover: boolean; hideRooms: boolean; reveal: boolean; hide: boolean; forget: boolean } {
    const state = this.holder(path)?.atlasStore.getState();
    if (!state) return { add: true, clear: true, cover: true, hideRooms: true, reveal: true, hide: true, forget: true };
    return {
      add: typeof state.addFogOperations === 'function' || typeof state.addFogOperation === 'function',
      clear: typeof state.clearFog === 'function',
      cover: typeof state.coverAllFog === 'function',
      hideRooms: typeof state.hideRooms === 'function',
      reveal: typeof state.revealFogGround === 'function',
      hide: typeof state.hideFogArea === 'function',
      forget: typeof state.forgetFogArea === 'function',
    };
  }

  /**
   * The store of the map for a fog write on `level` (the level the board shows). Atlas's fog actions act on the level its
   * own view shows and take no level: a board that shows another one (Atlas has not followed yet) is refused.
   */
  private fogStore(path: string, level: string | null | undefined): AtlasSceneState {
    const state = this.store(path);
    if (level !== undefined && level !== null && (state.levels?.length ?? 0) > 0) {
      const shown = resolveLevel(state.levels as readonly BoardLevel[], state.viewedLevel ?? null);
      if (shown !== level) throw new Error('Atlas shows another level of this scene: wait for it to follow the board');
    }
    return state;
  }

  /**
   * Adds fog operations (Atlas's input shapes: `brush`, `lasso`, `rectangle`, each with `isErasing`) on the level shown, in
   * one step of Atlas's history; they act in the order given, after all the fog there is. The ids Atlas gave.
   */
  async addFog(path: string, operations: ReadonlyArray<Record<string, unknown>>, level?: string | null): Promise<string[]> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (operations.length === 0) return [];
    const view = this.holder(path);
    // Read fresh at every write: an action swaps the store's state.
    const now = (): AtlasSceneState => view?.atlasStore.getState() ?? state;
    if (typeof state.addFogOperations === 'function') return this.asOneStep(path, () => now().addFogOperations?.(operations.map((operation) => ({ ...operation }))) ?? []);
    if (typeof state.addFogOperation !== 'function') throw TokenWriter.missing('fog tool');
    return this.asOneStep(path, () => operations.map((operation) => now().addFogOperation?.({ ...operation }) ?? ''));
  }

  /** Deletes all the fog of the level shown, in one step of Atlas's history (none when there is none). */
  async clearFog(path: string, level?: string | null): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.clearFog !== 'function') throw TokenWriter.missing('way to delete fog');
    state.clearFog();
  }

  /** Hides the whole map of the level shown (`mapRect`: the map as the board draws it); false, and nothing hidden, where Atlas finds no map to cover. */
  async coverAllFog(path: string, mapRect: { x: number; y: number; width: number; height: number } | null, level?: string | null): Promise<boolean> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.coverAllFog !== 'function') throw TokenWriter.missing('way to cover the map');
    return state.coverAllFog(mapRect);
  }

  /**
   * The fog menu's Reveal: takes the fog away under each outline (a body of fog as Atlas's `fogBodyAt` gives it) and remembers it
   * as revealed fog, so that it can be hidden again; one step of Atlas's history. Outlines that enclose nothing are passed over.
   */
  async revealFogGround(path: string, outlines: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>, level?: string | null): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.revealFogGround !== 'function') throw TokenWriter.missing('way to reveal fog');
    state.revealFogGround(outlines);
  }

  /** The fog menu's Hide: brings remembered revealed fog of the level shown back as plain fog, in one step; false for an id that is none. */
  async hideFogArea(path: string, id: string, level?: string | null): Promise<boolean> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.hideFogArea !== 'function') throw TokenWriter.missing('way to hide revealed fog');
    return state.hideFogArea(id);
  }

  /** The fog menu's Delete on revealed ground: forgets remembered revealed fog (it stays revealed), in one step; false for an id that is none. */
  async forgetFogArea(path: string, id: string, level?: string | null): Promise<boolean> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.forgetFogArea !== 'function') throw TokenWriter.missing('way to forget revealed fog');
    return state.forgetFogArea(id);
  }

  /** Paints fog over every room the walls of the level shown enclose that is not hidden yet, in one step; how many rooms there are and how many it hid. */
  async hideRooms(path: string, mapRect: { x: number; y: number; width: number; height: number } | null, coverage?: unknown, level?: string | null): Promise<{ rooms: number; hidden: number }> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.fogStore(path, level);
    if (typeof state.hideRooms !== 'function') throw TokenWriter.missing('way to hide rooms');
    return state.hideRooms(mapRect, coverage);
  }

  /**
   * Writes a map's painted water as liquids (the move off Tabletop's data), outside Atlas's history and whole or not
   * at all: where the level takes fewer than all of them, those it took are taken off again. Atlas's older steps are
   * let go, as for `applyExtrasMove`. The ids Atlas gave.
   */
  async applyWaterMove(path: string, add: ReadonlyArray<Record<string, unknown>>): Promise<string[]> {
    if (this.holder(path) === null) await this.ready(path);
    const view = this.holder(path);
    if (!view) throw new NotHeldError();
    if (add.length === 0) return [];
    const history = view.atlasStore.temporal?.getState();
    if (!history?.untracked) throw TokenWriter.missing('untracked writes');
    const state = view.atlasStore.getState();
    if (!state.addLiquids || !state.deleteLiquid) throw TokenWriter.missing('liquids');
    const ids = history.untracked(() => {
      const made = view.atlasStore.getState().addLiquids?.(add.map((liquid) => ({ ...liquid }))) ?? [];
      if (made.length < add.length) for (const id of made) view.atlasStore.getState().deleteLiquid?.(id);
      return made;
    });
    if (ids.length < add.length) throw new Error('this level holds no more liquids: remove some in Atlas first');
    const after = view.atlasStore.temporal?.getState();
    if (after && after.pastStates.length + after.futureStates.length > 0) after.clear?.();
    return ids;
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

  /**
   * Whether "Forget explored areas" can be done on the map: Atlas's store keeps the explored memory (`setExploredMask`, which
   * the 0.15 floor has). With Atlas not holding the map yet it is taken to be there (it is asked at the write).
   */
  offersForgetExplored(path: string): boolean {
    const state = this.holder(path)?.atlasStore.getState();
    return !state || typeof state.setExploredMask === 'function';
  }

  /**
   * Atlas's "Forget explored areas" (its palette command and the Lighting settings button): the same request Atlas's own
   * views send, `lighting-reset-explored` on the event bus, which its lighting answers as an edit of the memory (an undo step
   * of Atlas's history) when it keeps the memory. Where nothing answered (the lighting is not running here, so the count of
   * edits stood still), the saved memory of the level shown is dropped through Atlas's store, which is what Atlas itself does
   * when it holds no memory to edit (no undo step then, in Atlas too). Atlas 0.19 forgets every floor of the scene: its lighting
   * takes the other floors' saved memories along with the step, so only where nothing answered are they dropped here too.
   */
  async forgetExplored(path: string): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const view = this.holder(path);
    if (!view) throw new NotHeldError();
    const state = view.atlasStore.getState();
    if (typeof state.setExploredMask !== 'function') throw TokenWriter.missing('way to forget explored areas');
    const before = state.exploredEdits;
    const bus = (view as unknown as { serviceManager?: { getEventBus?: () => { emit?: (event: string) => void } | undefined } }).serviceManager?.getEventBus?.();
    if (typeof bus?.emit === 'function') bus.emit('lighting-reset-explored');
    const now = view.atlasStore.getState();
    if (typeof bus?.emit === 'function' && now.exploredEdits !== before) return;
    // Atlas's own level for the memory: the level its view shows; none (the first) on a scene without levels.
    const level = (now.levels?.length ?? 0) > 0 ? now.viewedLevel ?? null : null;
    now.setExploredMask?.(null, level);
    now.forgetOtherLevelsExplored?.();
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
   * Atlas's copy: detached copies of these tokens of the map (the ones on the map, in the order given), nothing written;
   * null when none of the ids is a token on it.
   */
  async tokensToCopy(path: string, ids: readonly string[]): Promise<MapObjectContent | null> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    const content = collectMapObjects({ tokens: (state.objects?.tokens ?? {}) as never, drawings: {}, texts: {}, pins: {} }, ids);
    return countMapObjects(content) > 0 ? content : null;
  }

  /** Atlas's cut: copies the tokens, then takes them off the map in one write (one undo step, auras and all). */
  async cutTokens(path: string, ids: readonly string[]): Promise<MapObjectContent | null> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.removeMapObjects) throw TokenWriter.missing('way to cut tokens');
    const content = await this.tokensToCopy(path, ids);
    if (!content) return null;
    state.removeMapObjects(ids.filter((id) => Object.hasOwn(state.objects?.tokens ?? {}, id)));
    return content;
  }

  /**
   * Atlas's paste: the copies centred on `target` (map pixels), snapped to the map's grid as a drag is and stepping aside
   * from what stands there; one write. Returns the new tokens' ids (Atlas gives them, and numbers them).
   */
  async pasteContent(path: string, content: MapObjectContent, target: { x: number; y: number }): Promise<string[]> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    if (!state.insertMapObjects) throw TokenWriter.missing('way to paste tokens');
    const grid = (state.grid ?? null) as GridState | null;
    const scene = state as unknown as Parameters<typeof levelObjects>[0];
    // What stands on the level shown, for a copy to step aside from (the other kinds are no concern of a token paste).
    const there = levelObjects(scene) as unknown as { tokens?: object; drawings?: object; texts?: object; pins?: object; levelLinks?: object };
    const existing = { tokens: there.tokens ?? {}, drawings: there.drawings ?? {}, texts: there.texts ?? {}, pins: there.pins ?? {}, levelLinks: there.levelLinks };
    const placed = placeMapObjects(content, pasteOffset(content, target, grid), grid, existing as never);
    return state.insertMapObjects(placed);
  }

  /**
   * Atlas's Duplicate: copies of these tokens one diagonal cell aside (stepping on while a copy would sit on an identical
   * token), fresh ids, numbered, in one write (one undo step); Atlas's `duplicateMapObjects` does it when the store has it,
   * else its parts do (`insertMapObjects` with the ported placement). Returns the copies' ids, none when no id is a token.
   */
  async duplicateTokens(path: string, ids: readonly string[]): Promise<string[]> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.store(path);
    const tokens = ids.filter((id) => Object.hasOwn(state.objects?.tokens ?? {}, id));
    if (tokens.length === 0) return [];
    if (state.duplicateMapObjects) return state.duplicateMapObjects(tokens);
    if (!state.insertMapObjects) throw TokenWriter.missing('way to duplicate tokens');
    const content = await this.tokensToCopy(path, tokens);
    if (!content) return [];
    const grid = (state.grid ?? null) as GridState | null;
    const there = levelObjects(state as unknown as Parameters<typeof levelObjects>[0]) as unknown as { tokens?: object; drawings?: object; texts?: object; pins?: object; levelLinks?: object };
    const existing = { tokens: there.tokens ?? {}, drawings: there.drawings ?? {}, texts: there.texts ?? {}, pins: there.pins ?? {}, levelLinks: there.levelLinks };
    return state.insertMapObjects(placeMapObjects(content, duplicateStep(grid), grid, existing as never));
  }

  /** Deletes the token from the map. */
  async remove(path: string, id: string): Promise<void> {
    if (this.holder(path) === null) await this.ready(path);
    const state = this.tokenStore(path, id);
    if (!state.deleteTokens) throw TokenWriter.missing('way to delete a token');
    state.deleteTokens([id]);
  }
}
