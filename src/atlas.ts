/**
 * What Tabletop reads of a stock Atlas VTT (0.7 to 0.11), which has no extension API: the map views open in the
 * workspace and their store. These are private shapes, so every member is checked before use and a failed check reads
 * as "nothing there" rather than throwing.
 */
import type { App, WorkspaceLeaf } from 'obsidian';

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
  objects: {
    tokens: Readonly<Record<string, AtlasToken>>;
    /** Atlas 0.15's kept measures, walls and map features, by id. */
    measures?: Readonly<Record<string, Record<string, unknown>>>;
    walls?: Readonly<Record<string, Record<string, unknown>>>;
    lights?: Readonly<Record<string, Record<string, unknown>>>;
    /** Atlas's water, lava and acid: outlines with holes. */
    liquids?: Readonly<Record<string, Record<string, unknown>>>;
    mapFeatures?: Readonly<Record<string, Record<string, unknown>>>;
  };
  /** Atlas 0.10's levels (floors) and the one this view shows; an older Atlas has neither. */
  levels?: ReadonlyArray<{ id: string }>;
  viewedLevel?: string | null;
  /** The rest of what a scene's levels are made of (Atlas's `LevelScene`): the first level's image, what players explored by level, each fitted level's alignment. */
  background?: string | null;
  grid?: Record<string, unknown> | null;
  exploredMask?: string | null;
  exploredMasks?: Record<string, string>;
  levelAlignments?: Record<string, unknown>;
  /** Writes a whole edit of the levels in one step: the levels, the first level's image, every record, the explored memory, the alignments. */
  applyLevelScene?: (scene: Record<string, unknown>) => void;
  /** Fits a level's image to the scene's grid; `move` takes what stands on that level alone along. */
  alignLevel?: (levelId: string, alignment: unknown, move?: (point: { x: number; y: number }) => { x: number; y: number }) => void;
  setViewedLevel?: (id: string | null) => void;
  remoteView?: unknown;
  /** Atlas 0.14's scene lighting: whether it is on, the light level and its colour, set as Atlas's lighting page sets them. */
  lighting?: { enabled?: boolean; ambient?: number; ambientColor?: string };
  setSceneLighting?: (changes: { enabled?: boolean; ambient?: number; ambientColor?: string | undefined }) => void;
  /** Atlas's own actions: change a token, add one (Atlas numbers it), delete some; Atlas saves the map. */
  updateToken?: (id: string, updates: Record<string, unknown>) => void;
  /** Several tokens in one step (one undo): `[{ id, changes }]`. */
  updateTokens?: (updates: Array<{ id: string; changes: Record<string, unknown> }>) => void;
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
  /** Atlas 0.18: ends the fight, empties every number and keeps everyone in the tracker. */
  resetInitiativeNumbers?: () => void;
  /** Atlas's doors: open or shut one (a locked one stays shut), lock or unlock one. */
  toggleDoor?: (id: string) => void;
  setDoorLocked?: (id: string, locked: boolean) => void;
  /** Atlas's own Snap to grid for the map's tokens. */
  setSnapToGrid?: (on: boolean) => void;
  /** Changes a wall's fields; a field given as undefined is removed. */
  updateWall?: (id: string, changes: Record<string, unknown>) => void;
  /** Atlas 0.15's kept measures: keep one (its id; null when the level holds no more), change one, take one off. */
  addMeasure?: (data: Record<string, unknown>) => string | null;
  updateMeasure?: (id: string, changes: Record<string, unknown>) => void;
  deleteMeasure?: (id: string) => void;
  /** Atlas's liquids: add some (their ids; a level that is full takes no more, and gives no id for those), take one off. There is no update. */
  addLiquids?: (data: ReadonlyArray<Record<string, unknown>>) => string[];
  deleteLiquid?: (id: string) => void;
  /** Changes a placed light's fields; a field given as undefined is removed. */
  updateLight?: (id: string, changes: Record<string, unknown>) => void;
  /** Atlas's placed lights: place one (its id), take one off. */
  addLight?: (data: Record<string, unknown>) => string;
  deleteLight?: (id: string) => void;
  /** Atlas's walls and map features, as its own tools make them: add one (its id), take some off. */
  addWall?: (data: Record<string, unknown>) => string;
  deleteWalls?: (ids: string[]) => void;
  addMapFeatures?: (data: ReadonlyArray<Record<string, unknown>>) => string[];
  deleteMapFeature?: (id: string) => void;
  /** Changes a pin's fields (Atlas's pin menu: `readable`); a field given as undefined is removed. */
  updateNotePin?: (id: string, changes: Record<string, unknown>) => void;
}

/** Atlas's undo history (zundo's, on its store): `transaction` makes every write of `fn` one step, `untracked` none. */
export interface AtlasTemporal {
  getState(): {
    pastStates: readonly unknown[];
    futureStates: readonly unknown[];
    undo(): void;
    redo(): void;
    transaction?<T>(fn: () => T): T;
    untracked?<T>(fn: () => T): T;
    /** Whether an undo or a redo is being applied right now. */
    isTravelling?(): boolean;
    /** Forgets every step. */
    clear?(): void;
  };
}

interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
  temporal?: AtlasTemporal;
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

/** A map view's scene tabs, as Atlas keeps them (`tabMetaStore`). */
export interface AtlasSceneTab { id: string; filePath: string; displayName: string; isLoaded?: boolean; isDirty?: boolean }

/** A map view with its scene tabs, and what Atlas's own tab bar does with them; the last two only where Atlas has them. */
export interface AtlasTabView extends AtlasView {
  readonly tabMetaStore: Store<{ tabs: AtlasSceneTab[]; activeTabId: string | null }>;
  switchToTab(tabId: string): Promise<void>;
  closeTab?(tabId: string): Promise<void>;
  openSceneBrowser?(): void;
}

export function hasTabs(view: AtlasView): view is AtlasTabView {
  const tabs = (view as { tabMetaStore?: unknown }).tabMetaStore;
  return isStore(tabs) && typeof tabs.getState === 'function' && typeof (view as { switchToTab?: unknown }).switchToTab === 'function';
}

/** The open map view whose scene tabs hold `mapPath` (the one with it loaded first), and its leaf; null when none. */
export function tabViewOf(app: App, mapPath: string): { view: AtlasTabView; leaf: WorkspaceLeaf } | null {
  let found: { view: AtlasTabView; leaf: WorkspaceLeaf } | null = null;
  for (const leaf of app.workspace.getLeavesOfType(ATLAS_VIEW_TYPE)) {
    const { view } = leaf;
    if (!isAtlasView(view) || view.atlasStore.getState().remoteView != null || !hasTabs(view)) continue;
    if (view.atlasStore.getState().mapPath === mapPath) return { view, leaf };
    if (!found && view.tabMetaStore.getState().tabs.some((tab) => tab.filePath === mapPath)) found = { view, leaf };
  }
  return found;
}

/** Atlas's presented scene (the eye on its tabs): read, and followed. */
export function presentedSceneOf(app: App): { get(): { tabId: string; filePath: string; levelId?: string } | null; onChange(listener: () => void): () => void; set?(scene: { tabId: string; filePath: string; levelId?: string } | null): void } | null {
  const scene = (app as unknown as { plugins?: { plugins?: Record<string, { presentedScene?: unknown } | undefined> } }).plugins?.plugins?.['atlas-vtt']?.presentedScene as
    { get?: unknown; onChange?: unknown } | undefined;
  return scene && typeof scene.get === 'function' && typeof scene.onChange === 'function'
    ? scene as { get(): { tabId: string; filePath: string; levelId?: string } | null; onChange(listener: () => void): () => void; set?(scene: { tabId: string; filePath: string; levelId?: string } | null): void }
    : null;
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
