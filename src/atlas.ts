/**
 * What Tabletop reads of a stock Atlas VTT (0.7.x / 0.8.x), which has no extension API: the map views open in the
 * workspace and their store. These are private shapes, so every member is checked before use and a failed check reads
 * as "nothing there" rather than throwing.
 */
import type { App } from 'obsidian';

export const ATLAS_VIEW_TYPE = 'atlas-vtt';

export interface AtlasToken {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly kind?: string;
  readonly name?: string | null;
  readonly statblockName?: string | null;
  readonly imagePath?: string;
}

export interface AtlasSceneState {
  mapPath: string | null;
  /** False, or loading, while Atlas reads a map in: it is not saving then. */
  mapLoaded?: boolean;
  isMapLoading?: boolean;
  objects: { tokens: Readonly<Record<string, AtlasToken>> };
  remoteView?: unknown;
  /** Atlas's own actions: change a token, add one (Atlas numbers it), delete some; Atlas saves the map. */
  updateToken?: (id: string, updates: Record<string, unknown>) => void;
  addToken?: (data: Record<string, unknown>) => string;
  deleteTokens?: (ids: string[]) => void;
  /** Atlas's initiative tracker: its state, opening it, and its actions (0.8.0's; an older Atlas lacks some). */
  initiative?: { entries: Array<{ id: string; tokenId: string }> };
  initiativeTrackerOpen?: boolean;
  setInitiativeTrackerOpen?: (open: boolean) => void;
  addToInitiative?: (entry: Record<string, unknown>) => string;
  removeFromInitiative?: (id: string, defeated?: ReadonlySet<string>) => void;
  updateInitiativeEntry?: (id: string, updates: Record<string, unknown>) => void;
  rollAllInitiative?: (roll?: string, fromStatblocks?: ReadonlyMap<string, number>) => void;
  rollEntryInitiative?: (id: string, roll?: string, fromStatblock?: number | null) => void;
  /** Atlas 0.9 passes the entry ids of the `defeated` by. */
  nextTurn?: (defeated?: ReadonlySet<string>) => void;
  previousTurn?: (defeated?: ReadonlySet<string>) => void;
  reorderInitiative?: (fromIndex: number, toIndex: number) => void;
  moveToFront?: (id: string) => void;
  moveToBack?: (id: string) => void;
  startCombat?: (rules?: unknown, defeated?: ReadonlySet<string>) => void;
  endCombat?: () => void;
  setInitiativeSitsOut?: (id: string, sitsOut: boolean) => void;
  resetInitiative?: () => void;
  /** Atlas's doors: open or shut one (a locked one stays shut), lock or unlock one. */
  toggleDoor?: (id: string) => void;
  setDoorLocked?: (id: string, locked: boolean) => void;
}

interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

export interface AtlasView {
  readonly viewId: string;
  readonly atlasStore: Store<AtlasSceneState>;
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
/** A zustand store is a function with `getState` and `subscribe` attached. */
const isStore = (value: unknown): value is Record<string, unknown> => (typeof value === 'object' || typeof value === 'function') && value !== null;

export function isAtlasView(view: unknown): view is AtlasView {
  if (!isObj(view)) return false;
  const { viewId, atlasStore } = view;
  return typeof viewId === 'string' && isStore(atlasStore) && typeof atlasStore.getState === 'function' && typeof atlasStore.subscribe === 'function';
}

/** The GM's open map views; a player's remote view is left out. */
export function mapViews(app: App): AtlasView[] {
  const found: AtlasView[] = [];
  for (const leaf of app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
    const { view } = leaf;
    if (isAtlasView(view) && view.atlasStore.getState().remoteView == null) found.push(view);
  }
  return found;
}

/** A token's name for menus: a character's name, else its art's file name. */
export function tokenLabel(token: AtlasToken): string {
  const name = token.kind === 'character' ? (token.name || token.statblockName || '').trim() : '';
  if (name !== '') return name;
  const file = token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  return file === '' ? 'Token' : file;
}
