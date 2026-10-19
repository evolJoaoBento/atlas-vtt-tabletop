/**
 * What Tabletop reads of a stock Atlas VTT (0.7.x / 0.8.x), which has no extension API: the map views in the workspace
 * (`viewId`, `atlasStore`, `renderer`, `containerEl`), their token sprites and their camera. These are private shapes,
 * so every member is checked before use and a failed check reads as "nothing there" rather than throwing.
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
  readonly size?: number;
  readonly rotation?: number;
  readonly isHidden?: boolean;
  readonly layer?: number;
}

export interface AtlasSceneState {
  mapPath: string | null;
  mapLoaded: boolean;
  isMapLoading: boolean;
  grid?: { size?: number } | null;
  selectedIds?: readonly string[];
  objects: { tokens: Readonly<Record<string, AtlasToken>> };
  remoteView?: unknown;
}

interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

/** A PIXI display object, as far as Tabletop reads one. */
export interface SpriteLike {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
  readonly worldVisible?: boolean;
  readonly alpha: number;
  readonly destroyed?: boolean;
}

interface TokenRendererLike {
  hitTestTokens?(x: number, y: number): string | null;
  getTokenSprites?(): Record<string, SpriteLike | null>;
}

interface ViewportLike {
  readonly destroyed?: boolean;
  readonly scale?: { readonly x: number };
  toScreen?(x: number, y: number): { x: number; y: number };
  toWorld?(point: { x: number; y: number }): { x: number; y: number };
}

export interface AtlasView {
  readonly viewId: string;
  readonly containerEl?: HTMLElement;
  readonly atlasStore: Store<AtlasSceneState>;
  readonly renderer?: {
    getTokenRenderer?(): TokenRendererLike | null | undefined;
    getViewportInstance?(): ViewportLike | null;
    getGridOptions?(): { size?: number } | null;
    laserPointerRenderer?: { canvasEl?: unknown };
    getAppInstance?(): unknown;
  } | null;
}

/** Atlas's PIXI application (PIXI 7), as far as the 3D table uses it. */
export interface PixiAppLike {
  render?(): void;
  readonly renderer: {
    render(...args: unknown[]): unknown;
    readonly events?: { readonly domElement?: unknown; setTargetElement?(element: unknown): void };
  };
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

export const isLoaded = (state: AtlasSceneState): boolean => state.mapLoaded && !state.isMapLoading && typeof state.mapPath === 'string';

function tokenRenderer(view: AtlasView): TokenRendererLike | null {
  try {
    const layer = view.renderer?.getTokenRenderer?.();
    return isObj(layer) ? layer : null;
  } catch {
    return null;
  }
}

export function viewport(view: AtlasView): ViewportLike | null {
  try {
    const port = view.renderer?.getViewportInstance?.() ?? null;
    return isObj(port) && port.destroyed !== true ? port : null;
  } catch {
    return null;
  }
}

/** The view's PIXI application, or null when it is not there or not the shape Tabletop knows. */
export function pixiApp(view: AtlasView): PixiAppLike | null {
  try {
    const found = view.renderer?.getAppInstance?.();
    if (!isObj(found) || !isObj(found.renderer) || typeof found.renderer.render !== 'function') return null;
    return found as unknown as PixiAppLike;
  } catch {
    return null;
  }
}

/** The view's map canvas: the one Atlas's laser pointer draws on, else the largest canvas in the view. */
export function mapCanvas(view: AtlasView): HTMLCanvasElement | null {
  const found = view.renderer?.laserPointerRenderer?.canvasEl;
  // Not `instanceof`: a popout window has its own HTMLCanvasElement.
  if (isObj(found) && found.tagName === 'CANVAS' && (found as unknown as HTMLElement).isConnected) return found as unknown as HTMLCanvasElement;
  let best: HTMLCanvasElement | null = null;
  let area = 0;
  for (const canvas of Array.from(view.containerEl?.querySelectorAll('canvas') ?? [])) {
    if (canvas.classList.contains('atlas-tabletop-overlay')) continue;
    const rect = canvas.getBoundingClientRect();
    if (rect.width * rect.height > area) {
      area = rect.width * rect.height;
      best = canvas;
    }
  }
  return best;
}

/** The token sprites Atlas draws, by token id: their live place, including drags and glides. */
export function tokenSprites(view: AtlasView): Record<string, SpriteLike | null> {
  try {
    const sprites = tokenRenderer(view)?.getTokenSprites?.();
    return isObj(sprites) ? (sprites as Record<string, SpriteLike | null>) : {};
  } catch {
    return {};
  }
}

/** The token under a point of the window (client coordinates), or null. */
export function tokenAt(view: AtlasView, clientX: number, clientY: number): string | null {
  const canvas = mapCanvas(view);
  const layer = tokenRenderer(view);
  const port = viewport(view);
  if (!canvas || !layer?.hitTestTokens || !port?.toWorld) return null;
  try {
    const rect = canvas.getBoundingClientRect();
    const at = port.toWorld({ x: clientX - rect.left, y: clientY - rect.top });
    const id = layer.hitTestTokens(at.x, at.y);
    return id !== null && Object.hasOwn(view.atlasStore.getState().objects.tokens, id) ? id : null;
  } catch {
    return null;
  }
}

/** The map's grid cell size in world pixels. */
export function gridSize(view: AtlasView): number {
  let size: unknown;
  try {
    size = view.renderer?.getGridOptions?.()?.size;
  } catch {
    size = undefined;
  }
  if (typeof size !== 'number' || !(size > 0)) size = view.atlasStore.getState().grid?.size;
  return typeof size === 'number' && size > 0 ? size : 70;
}

/** Atlas's token diameter in world pixels for a token of `sizeInCells` (its `computeTokenPixelSize`). */
export function tokenPixelSize(grid: number, sizeInCells: number | undefined): number {
  const stroke = Math.max(1, Math.round((grid * 4) / 70));
  return (grid - 2 * stroke) * (2 * (sizeInCells ?? 1) - 1);
}

export function tokenLabel(token: AtlasToken): string {
  const name = token.kind === 'character' ? (token.name || token.statblockName || '').trim() : '';
  if (name !== '') return name;
  const file = token.imagePath?.split('/').pop()?.replace(/\.[^.]+$/, '') ?? '';
  return file === '' ? 'Token' : file;
}
