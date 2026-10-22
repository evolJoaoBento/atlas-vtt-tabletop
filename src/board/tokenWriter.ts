/**
 * Saves what the board changes on a map: a token moved, copied (Alt-drag), killed, reset, hidden or shown, given or
 * relieved of a condition, deleted, put in or taken out of the initiative; a resource stepped or edited; and what the
 * initiative tracker does (turns, rolls, the order, a fight started or ended).
 * Atlas never re-reads a map file it has open: its next save writes what it holds, which would undo a change written
 * to the file behind its back. So while an Atlas view has the map open (and has it loaded), the change goes through
 * Atlas's own store actions, which Atlas shows and saves; otherwise the file is edited, changing only what changed
 * and writing it back the way Atlas writes it (`JSON.stringify`, no indentation).
 *
 * Resources are changed the way Atlas 0.8 changes them: on its memory form (`resources`, `overriddenMax`), converted
 * from and back to the file's fields with Atlas's own rules (`resources.ts`). An older Atlas holds the file's fields in
 * its store too, and is given those.
 */
import type { AtlasSceneState, AtlasView } from '../atlas';
import {
  defeatedResources, initiativeVitals, resourceUpdate, tokenFromFile, tokenToFile,
  type ResourceDefinition, type ResourceHolder, type ResourceValue,
} from './resources';
import { addToInitiative, initiativeEntryFor, initiativeId, removeFromInitiative, type InitiativeState } from './tokenEdits';
import { applyInitiative, fileCannotRun, readInitiative, type InitiativeAction } from './initiative';

type RawToken = Record<string, unknown> & { x?: number; y?: number; imagePath?: string; instanceNumber?: number };
type RawWall = Record<string, unknown> & { type?: string; closed?: boolean; locked?: boolean };
type MapFile = { state?: { objects?: { tokens?: Record<string, RawToken>; walls?: Record<string, RawWall> }; initiative?: InitiativeState } };
/**
 * What a change does to a token, given it as Atlas holds it in memory (its resources as `resources`): the fields it
 * sets, `undefined` for one it deletes; null when it changes nothing. `resources` and `overriddenMax` are written in
 * the form the map file (or an older Atlas) keeps them.
 */
export type TokenChange = (token: ResourceHolder & Record<string, unknown>) => Record<string, unknown> | null;
type ResourceChange = TokenChange;

function tokensOf(file: MapFile): Record<string, RawToken> {
  const tokens = file.state?.objects?.tokens;
  if (!tokens) throw new Error('this map has no tokens');
  return tokens;
}

function tokenOf(file: MapFile, id: string): RawToken {
  const token = tokensOf(file)[id];
  if (!token) throw new Error(`no token ${id} on this map`);
  return token;
}

/** The map file's text with one token moved. Throws when the token is not on the map. */
export function moveTokenInText(text: string, id: string, x: number, y: number): string {
  const file = JSON.parse(text) as MapFile;
  const token = tokenOf(file, id);
  token.x = x;
  token.y = y;
  return JSON.stringify(file);
}

/** The lowest copy number from 1 no token with the same art holds, as Atlas numbers copies. */
function nextInstanceNumber(tokens: Record<string, RawToken>, imagePath: string | undefined): number {
  const taken = new Set(Object.values(tokens).filter((token) => token.imagePath === imagePath).map((token) => token.instanceNumber));
  let next = 1;
  while (taken.has(next)) next++;
  return next;
}

/** The map file's text with a copy of a token, under a new id, at (x, y). */
export function copyTokenInText(text: string, id: string, newId: string, x: number, y: number): string {
  const file = JSON.parse(text) as MapFile;
  const tokens = tokensOf(file);
  const source = tokenOf(file, id);
  const copy: RawToken = { ...structuredClone(source), id: newId, x, y, instanceNumber: nextInstanceNumber(tokens, source.imagePath) };
  tokens[newId] = copy;
  return JSON.stringify(file);
}

/** The fields an older Atlas (and every map file) keeps a token's resources in. */
const FILE_FIELDS = ['hp', 'stress', 'maxStress', 'hope', 'statblockResources', 'maxHpOverridden', 'maxStressOverridden', 'overriddenMax'];

/** Whether a token is in the file's form (an older Atlas's store, or a file) rather than Atlas 0.8's memory form. */
const inFileForm = (token: Record<string, unknown>): boolean => !('resources' in token) && FILE_FIELDS.some((field) => field in token);

/** Sets one resource: `edit` turns the value the token holds into the new one. */
function setResource(key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): ResourceChange {
  return (token) => {
    const stored = token.resources?.[key];
    if (!stored) throw new Error(`the token has no ${key}`);
    return resourceUpdate(token, key, edit(stored), maxEdited);
  };
}

const kill = (definitions: readonly ResourceDefinition[]): ResourceChange => (token) => {
  const resources = defeatedResources(token, definitions);
  return resources ? { resources } : null;
};

/** The map file's text with `change` made to a token's resources, its initiative entry's copy of them kept up. */
function changeInText(text: string, id: string, change: ResourceChange): string {
  const file = JSON.parse(text) as MapFile;
  const tokens = tokensOf(file);
  const held = tokenFromFile(tokenOf(file, id));
  const changes = change(held);
  if (!changes) return text;
  const next: Record<string, unknown> = { ...held, ...changes };
  for (const [field, value] of Object.entries(next)) if (value === undefined) delete next[field];
  tokens[id] = tokenToFile(next) as RawToken;
  const entries = file.state?.initiative?.entries;
  if (Array.isArray(entries)) {
    file.state!.initiative!.entries = entries.map((entry) => (
      typeof entry === 'object' && entry !== null && entry.tokenId === id ? { ...entry, ...initiativeVitals(next) } : entry
    ));
  }
  return JSON.stringify(file);
}

/** The map file's text with one resource of a token set; `edit` gets the value the file holds. */
export function setResourceInText(text: string, id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): string {
  return changeInText(text, id, setResource(key, edit, maxEdited));
}

/** The map file's text with a token killed: every resource that defeats it spent. */
export function killTokenInText(text: string, id: string, definitions: readonly ResourceDefinition[]): string {
  return changeInText(text, id, kill(definitions));
}

/** The map file's text with a token put in the initiative (as Atlas adds it), or taken out. */
export function initiativeInText(text: string, id: string, join: boolean, entryId: string): string {
  const file = JSON.parse(text) as MapFile;
  const raw = tokenOf(file, id);
  const state = file.state!;
  if (join) {
    // The file keeps the token's vitals beside its entry, as Atlas writes them.
    const entry = { ...initiativeEntryFor(raw as Parameters<typeof initiativeEntryFor>[0]), ...initiativeVitals(tokenFromFile(raw)) };
    state.initiative = addToInitiative(state.initiative, entry, entryId);
  } else if (state.initiative) {
    state.initiative = removeFromInitiative(state.initiative, id);
  }
  return JSON.stringify(file);
}

/** The map file's text without a token, nor its place in the initiative (Atlas's tracker drops it too). */
export function deleteTokenInText(text: string, id: string): string {
  const file = JSON.parse(text) as MapFile;
  tokenOf(file, id);
  delete tokensOf(file)[id];
  if (file.state?.initiative) file.state.initiative = removeFromInitiative(file.state.initiative, id);
  return JSON.stringify(file);
}

/** The map file's text with the initiative tracker changed as `action` says; `random` rolls the dice. */
export function initiativeActionInText(text: string, action: InitiativeAction, random: () => number = Math.random): string {
  const file = JSON.parse(text) as MapFile;
  if (!file.state) throw new Error('not an Atlas map');
  const before = readInitiative(file.state.initiative);
  const refused = fileCannotRun(before, action);
  if (refused) throw new Error(`${refused} runs only in Atlas: open the map in Atlas to play it`);
  const after = applyInitiative(before, action, random);
  file.state.initiative = after;
  // A combatant kept beside the map (Atlas 0.9) goes with its entry, as in Atlas: nothing else shows it.
  const tokens = file.state.objects?.tokens;
  if (tokens && (action.type === 'remove' || action.type === 'reset')) {
    const kept = new Set(after.entries.map((entry) => entry.tokenId));
    for (const entry of before.entries) {
      if (!kept.has(entry.tokenId) && tokens[entry.tokenId]?.offMap === true) delete tokens[entry.tokenId];
    }
    if (action.type === 'reset') for (const [id, token] of Object.entries(tokens)) if (token.offMap === true) delete tokens[id];
  }
  return JSON.stringify(file);
}

/** The map file's door, or an error when there is none by that id. */
function doorOf(file: MapFile, id: string): RawWall {
  const wall = file.state?.objects?.walls?.[id];
  if (!wall || (wall.type !== 'door' && wall.type !== 'secret-door')) throw new Error(`no door ${id} on this map`);
  return wall;
}

/** The map file's text with a door opened or shut, as Atlas's `toggleDoor` does: a locked door stays shut. */
export function toggleDoorInText(text: string, id: string): string {
  const file = JSON.parse(text) as MapFile;
  const door = doorOf(file, id);
  if (door.locked === true) return text;
  door.closed = !(door.closed ?? true);
  return JSON.stringify(file);
}

/** The map file's text with a door locked (and so shut) or unlocked, as Atlas's `setDoorLocked` does. */
export function lockDoorInText(text: string, id: string, locked: boolean): string {
  const file = JSON.parse(text) as MapFile;
  const door = doorOf(file, id);
  if (locked) {
    door.locked = true;
    door.closed = true;
  } else {
    delete door.locked;
  }
  return JSON.stringify(file);
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

export interface TokenWriterDeps {
  /** The open Atlas map views. */
  views: () => AtlasView[];
  /** Edits a vault file in place (`app.vault.process`). */
  process: (path: string, edit: (text: string) => string) => Promise<unknown>;
}

export class TokenWriter {
  constructor(private readonly deps: TokenWriterDeps) {}

  /**
   * The Atlas store holding the map, loaded and holding the token. While Atlas is still reading the map in it saves
   * nothing, and a token it does not hold it cannot change: then the file is written instead, so nothing is dropped.
   */
  private atlas(path: string, id: string): AtlasSceneState | null {
    for (const view of this.deps.views()) {
      const state = view.atlasStore.getState();
      const ready = state.mapLoaded !== false && state.isMapLoading !== true && Object.hasOwn(state.objects?.tokens ?? {}, id);
      if (state.mapPath === path && ready) return state;
    }
    return null;
  }

  /** The Atlas view holding the map, loaded; null when none does. */
  holder(path: string): AtlasView | null {
    for (const view of this.deps.views()) {
      const state = view.atlasStore.getState();
      if (state.mapPath === path && state.mapLoaded !== false && state.isMapLoading !== true) return view;
    }
    return null;
  }

  /** Atlas holds the map but not the action needed: writing the file would be undone by its next save. */
  private static missing(action: string): Error {
    return new Error(`Atlas has this map open but offers no ${action} here; change it in Atlas`);
  }

  /** Moves the token; says whether Atlas took the move or the file was written. */
  async move(path: string, id: string, x: number, y: number): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      if (!state.updateToken) throw TokenWriter.missing('token update');
      state.updateToken(id, { x, y });
      return 'atlas';
    }
    await this.deps.process(path, (text) => moveTokenInText(text, id, x, y));
    return 'file';
  }

  /** Copies the token to (x, y) under `newId` (Atlas numbers the copy). */
  async copy(path: string, id: string, newId: string, x: number, y: number): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      if (!state.addToken) throw TokenWriter.missing('way to add a token');
      const source = structuredClone(state.objects.tokens[id]) as unknown as RawToken;
      delete source.instanceNumber;
      state.addToken({ ...source, id: newId, x, y });
      return 'atlas';
    }
    await this.deps.process(path, (text) => copyTokenInText(text, id, newId, x, y));
    return 'file';
  }

  /**
   * Changes a token's resources through Atlas's store: Atlas 0.8 holds them in memory as `resources` (it writes the
   * file's fields only when saving, from those), an older Atlas as the file's fields.
   */
  private changeInAtlas(state: AtlasSceneState, id: string, change: ResourceChange): void {
    if (!state.updateToken) throw TokenWriter.missing('token update');
    const live = state.objects.tokens[id] as unknown as Record<string, unknown>;
    if (!inFileForm(live)) {
      const changes = change(live);
      if (changes) state.updateToken(id, changes);
      return;
    }
    const held = tokenFromFile(live);
    const changes = change(held);
    if (!changes) return;
    const { resources: _resources, overriddenMax: _overriddenMax, ...others } = changes;
    const touchesResources = 'resources' in changes || 'overriddenMax' in changes;
    const fileForm = tokenToFile({ ...held, ...changes }) as Record<string, unknown>;
    const resourceFields = touchesResources ? Object.fromEntries(FILE_FIELDS.filter((field) => field in fileForm).map((field) => [field, fileForm[field]])) : {};
    state.updateToken(id, { ...others, ...resourceFields });
  }

  private async change(path: string, id: string, change: ResourceChange): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      this.changeInAtlas(state, id, change);
      return 'atlas';
    }
    await this.deps.process(path, (text) => changeInText(text, id, change));
    return 'file';
  }

  /**
   * Sets one of the token's resources: `edit` gets the value Atlas (or the file) holds now, so steps made in quick
   * succession add up even before the board has read them back.
   */
  resource(path: string, id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): Promise<'atlas' | 'file'> {
    return this.change(path, id, setResource(key, edit, maxEdited));
  }

  /** Changes the token as `change` says (a condition, hidden or shown, Reset), through Atlas or in the file. */
  update(path: string, id: string, change: TokenChange): Promise<'atlas' | 'file'> {
    return this.change(path, id, change);
  }

  /**
   * Puts the token in Atlas's initiative tracker, or takes it out. Through Atlas, its tracker opens too, as Atlas's
   * menu opens it.
   */
  async initiative(path: string, id: string, join: boolean): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      if (!state.addToInitiative || !state.removeFromInitiative) throw TokenWriter.missing('initiative tracker');
      if (state.initiativeTrackerOpen === false) state.setInitiativeTrackerOpen?.(true);
      const entry = state.initiative?.entries.find((candidate) => candidate.tokenId === id);
      const token = state.objects.tokens[id] as unknown as Parameters<typeof initiativeEntryFor>[0];
      if (join && !entry) state.addToInitiative(initiativeEntryFor(token));
      else if (!join && entry) state.removeFromInitiative(entry.id);
      return 'atlas';
    }
    const entryId = initiativeId();
    await this.deps.process(path, (text) => initiativeInText(text, id, join, entryId));
    return 'file';
  }

  /**
   * Changes the initiative tracker as `action` says: through Atlas's own tracker actions (Atlas rolls its own dice), or
   * in the file with `random`'s.
   */
  async initiativeAction(path: string, action: InitiativeAction, random: () => number = Math.random): Promise<'atlas' | 'file'> {
    const view = this.holder(path);
    if (view) {
      if (!sendToAtlas(view.atlasStore.getState(), action)) throw TokenWriter.missing('such initiative action');
      return 'atlas';
    }
    await this.deps.process(path, (text) => initiativeActionInText(text, action, random));
    return 'file';
  }

  /** Whether the tracker can do `action` on this map: always in the file; through Atlas, when Atlas offers it. */
  offers(path: string, action: 'reset' | 'sitsOut'): boolean {
    const state = this.holder(path)?.atlasStore.getState();
    if (!state) return true;
    return action === 'reset' ? typeof state.resetInitiative === 'function' : typeof state.setInitiativeSitsOut === 'function';
  }

  /** Opens or shuts a door (a locked one stays shut): through Atlas, or in the file. */
  async toggleDoor(path: string, id: string): Promise<'atlas' | 'file'> {
    const view = this.holder(path);
    if (view) {
      const state = view.atlasStore.getState();
      if (!state.toggleDoor) throw TokenWriter.missing('door action');
      state.toggleDoor(id);
      return 'atlas';
    }
    await this.deps.process(path, (text) => toggleDoorInText(text, id));
    return 'file';
  }

  /** Locks a door (shutting it) or unlocks it. */
  async lockDoor(path: string, id: string, locked: boolean): Promise<'atlas' | 'file'> {
    const view = this.holder(path);
    if (view) {
      const state = view.atlasStore.getState();
      if (!state.setDoorLocked) throw TokenWriter.missing('door lock');
      state.setDoorLocked(id, locked);
      return 'atlas';
    }
    await this.deps.process(path, (text) => lockDoorInText(text, id, locked));
    return 'file';
  }

  /** Kills the token, as Atlas's Kill does: every resource that defeats it spent. */
  kill(path: string, id: string, definitions: readonly ResourceDefinition[]): Promise<'atlas' | 'file'> {
    return this.change(path, id, kill(definitions));
  }

  /** Deletes the token from the map. */
  async remove(path: string, id: string): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      if (!state.deleteTokens) throw TokenWriter.missing('way to delete a token');
      state.deleteTokens([id]);
      return 'atlas';
    }
    await this.deps.process(path, (text) => deleteTokenInText(text, id));
    return 'file';
  }
}
