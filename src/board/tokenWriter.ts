/**
 * Saves what the board changes on a map: a token moved, copied (Alt-drag), killed, reset, hidden or shown, given or
 * relieved of a condition, deleted, put in or taken out of the initiative; a resource stepped or edited.
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

type RawToken = Record<string, unknown> & { x?: number; y?: number; imagePath?: string; instanceNumber?: number };
type MapFile = { state?: { objects?: { tokens?: Record<string, RawToken> }; initiative?: InitiativeState } };
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

/** The map file's text without a token. */
export function deleteTokenInText(text: string, id: string): string {
  const file = JSON.parse(text) as MapFile;
  tokenOf(file, id);
  delete tokensOf(file)[id];
  return JSON.stringify(file);
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
      const changes = change(live as ResourceHolder & Record<string, unknown>);
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
