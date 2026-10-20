/**
 * Saves what the board changes on a map: a token moved, a token copied (Alt-drag), a token's HP or stress edited.
 * Atlas never re-reads a map file it has open: its next save writes what it holds, which would undo a change written
 * to the file behind its back. So while an Atlas view has the map open (and has it loaded), the change goes through
 * Atlas's own store actions, which Atlas shows and saves; otherwise the file is edited, changing only what changed
 * and writing it back the way Atlas writes it (`JSON.stringify`, no indentation).
 */
import type { AtlasSceneState, AtlasView } from '../atlas';
import type { Meter } from './mapModel';

type RawToken = Record<string, unknown> & { x?: number; y?: number; imagePath?: string; instanceNumber?: number };
type MapFile = { state?: { objects?: { tokens?: Record<string, RawToken> } } };
export type MeterField = 'hp' | 'stress';

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

/** The changes Atlas makes for a meter edit: HP as `{current, max}`, stress in the form the token keeps it. */
function meterUpdates(token: RawToken, field: MeterField, meter: Meter): Record<string, unknown> {
  if (field === 'hp') {
    const old = token.hp;
    const max = typeof old === 'object' && old !== null ? (old as Meter).max : 100;
    return { hp: { current: meter.current, max: meter.max }, ...(meter.max !== max ? { maxHpOverridden: true } : {}) };
  }
  const old = token.stress;
  if (typeof old === 'object' && old !== null) {
    return { stress: { current: meter.current, max: meter.max }, ...(meter.max !== (old as Meter).max ? { maxStressOverridden: true } : {}) };
  }
  const max = typeof token.maxStress === 'number' && token.maxStress > 0 ? token.maxStress : 10;
  return { stress: meter.current, maxStress: meter.max, ...(meter.max !== max ? { maxStressOverridden: true } : {}) };
}

/** The map file's text with a token's HP or stress set. */
export function setMeterInText(text: string, id: string, field: MeterField, meter: Meter): string {
  const file = JSON.parse(text) as MapFile;
  const token = tokenOf(file, id);
  Object.assign(token, meterUpdates(token, field, meter));
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

  /** Sets the token's HP or stress. */
  async meter(path: string, id: string, field: MeterField, meter: Meter): Promise<'atlas' | 'file'> {
    const state = this.atlas(path, id);
    if (state) {
      if (!state.updateToken) throw TokenWriter.missing('token update');
      state.updateToken(id, meterUpdates(state.objects.tokens[id] as unknown as RawToken, field, meter));
      return 'atlas';
    }
    await this.deps.process(path, (text) => setMeterInText(text, id, field, meter));
    return 'file';
  }
}
