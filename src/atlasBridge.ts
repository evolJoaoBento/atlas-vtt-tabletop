/**
 * The one place Tabletop reaches Atlas's running instances for the tools it shares with Atlas's toolbar (random tables,
 * asset manager, command palette). Atlas has no public API, so every member is duck-typed, checked before use and listed in
 * `scripts/check-atlas-members.mjs`. Nothing here constructs an Atlas service: Tabletop uses Atlas's own running ones (its
 * asset service through a map view, its settings service on the plugin), so there is never a second writer on Atlas's files.
 * Without Atlas every member answers "nothing" (null, false, Atlas's defaults) and none throws.
 */
import type { App, WorkspaceLeaf } from 'obsidian';
import { isAtlasView, mapViews, tabViewOf } from './atlas';
import { isMovementSpeed, parseMovementRules, readDragDistance, type DragDistance, type MovementRules } from '../packages/atlas-shared/src/index';
import { readToolbarLayout, resolveToolbarLayout, type ToolbarLayout } from './atlasPort/toolbarLayout';
import { DEFAULT_MAP_HOTKEYS, type MapHotkeyId } from './atlasPort/app/keyboard/mapHotkeys';
import { readGmFogOpacity } from './atlasPort/gmFogOpacity';

/** Atlas's asset manager tabs (its global window also takes these). */
export type AssetTab = 'scenes' | 'maps' | 'encounters' | 'tokens' | 'party';

/** A collection's settings as Atlas keeps them; only what Tabletop reads is typed, the rest passes through. */
export interface AtlasCollectionSettings {
  readonly [key: string]: unknown;
}

/** The members of Atlas's `AssetService` Tabletop uses. */
export interface AtlasAssetService {
  getCollectionForMap(mapFilePath: string): string | null;
  getCollectionSettings(collectionId: string): AtlasCollectionSettings;
  updateCollectionSettings(collectionId: string, settings: Partial<AtlasCollectionSettings>): Promise<void>;
  [member: string]: unknown;
}

/** The members of Atlas's `SettingsService` Tabletop uses. */
export interface AtlasSettingsService {
  getToolbarLayout?(): unknown;
  getHotkeys?(): Record<string, string>;
  getLaserPointerSettings?(): unknown;
  setLaserPointerSettings?(changes: Record<string, unknown>): void;
  getDragDistance?(): unknown;
  /** Atlas 0.17-0.18's fog opacity in the GM's view (0.1 to 1), kept per device. */
  getGmFogOpacity?(): unknown;
  setGmFogOpacity?(opacity: number): void;
  setDragDistance?(choice: DragDistance): void;
  getDiceVolume?(): unknown;
  onChange?(listener: () => void): () => void;
  [member: string]: unknown;
}

/** One of Atlas's map hotkeys (`keyboard/mapHotkeys.ts`, copied in `atlasPort`); its default is Atlas's own. */
export type SharedHotkey = MapHotkeyId;

interface AtlasPlugin {
  settingsService?: unknown;
  globalAssetManager?: { open?(tab?: string): void };
  manifest?: { version?: string };
}

export interface AtlasBridgeOptions {
  /** Runs `fn` every `ms` until the returned stop is called (a test passes its own clock). */
  every?(ms: number, fn: () => void): () => void;
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export class AtlasBridge {
  constructor(private readonly app: App, private readonly options: AtlasBridgeOptions = {}) {}

  private plugin(): AtlasPlugin | null {
    const plugin = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['atlas-vtt'];
    return isObj(plugin) ? plugin as AtlasPlugin : null;
  }

  loaded(): boolean {
    return this.plugin() !== null;
  }

  /** The installed Atlas's version; null without Atlas. */
  version(): string | null {
    if (!this.loaded()) return null;
    const manifests = (this.app as unknown as { plugins?: { manifests?: Record<string, { version?: string } | undefined> } }).plugins?.manifests;
    return manifests?.['atlas-vtt']?.version ?? this.plugin()?.manifest?.version ?? null;
  }

  /** Atlas's running asset service (a singleton every map view shares), reached through a map view; null without one. */
  assetService(): AtlasAssetService | null {
    for (const view of mapViews(this.app)) {
      const manager = (view as unknown as { serviceManager?: { getAssetService?(): unknown } }).serviceManager;
      const service = typeof manager?.getAssetService === 'function' ? manager.getAssetService() : null;
      if (isObj(service) && typeof service.getCollectionForMap === 'function' && typeof service.getCollectionSettings === 'function') {
        return service as AtlasAssetService;
      }
    }
    return null;
  }

  settings(): AtlasSettingsService | null {
    const service = this.plugin()?.settingsService;
    return isObj(service) ? service as AtlasSettingsService : null;
  }

  collectionFor(mapPath: string): string | null {
    try { return this.assetService()?.getCollectionForMap(mapPath) ?? null; } catch { return null; }
  }

  collectionSettings(collectionId: string): AtlasCollectionSettings | null {
    try { return this.assetService()?.getCollectionSettings(collectionId) ?? null; } catch { return null; }
  }

  /** Changes a collection's settings through Atlas's own service; false when Atlas cannot be reached (nothing written). */
  async updateCollectionSettings(collectionId: string, settings: Partial<AtlasCollectionSettings>): Promise<boolean> {
    const service = this.assetService();
    if (!service || typeof service.updateCollectionSettings !== 'function') return false;
    await service.updateCollectionSettings(collectionId, settings);
    return true;
  }

  /** Atlas's toolbar as the GM arranged it (its default without Atlas or a saved layout). */
  toolbarLayout(): ToolbarLayout {
    const settings = this.settings();
    let stored: unknown = {};
    try { stored = typeof settings?.getToolbarLayout === 'function' ? settings.getToolbarLayout() : {}; } catch { stored = {}; }
    return resolveToolbarLayout(readToolbarLayout(stored));
  }

  /** The key Atlas opens a shared tool with: the GM's rebinding, else Atlas's default. */
  hotkey(id: SharedHotkey): string | null {
    const settings = this.settings();
    let keys: Record<string, string> = {};
    try { keys = typeof settings?.getHotkeys === 'function' ? settings.getHotkeys() ?? {} : {}; } catch { keys = {}; }
    const key = keys[id];
    return typeof key === 'string' && key !== '' ? key : DEFAULT_MAP_HOTKEYS[id] ?? null;
  }

  /** Atlas's laser pointer as the GM set it (its colour and size, for every map); null without Atlas, or one that has none. */
  laser(): { color: string; size: number } | null {
    const settings = this.settings();
    let stored: unknown = null;
    try { stored = typeof settings?.getLaserPointerSettings === 'function' ? settings.getLaserPointerSettings() : null; } catch { stored = null; }
    return isObj(stored) && typeof stored.color === 'string' && typeof stored.size === 'number' ? { color: stored.color, size: stored.size } : null;
  }

  /** Changes Atlas's laser pointer; false when Atlas is not there to keep it. */
  setLaser(changes: { color?: string; size?: number }): boolean {
    const settings = this.settings();
    if (typeof settings?.setLaserPointerSettings !== 'function') return false;
    try { settings.setLaserPointerSettings({ ...changes }); } catch { return false; }
    return true;
  }

  /** When a dragged token shows its distance (Atlas 0.15's setting: always, only in a fight, never); `always` without Atlas. */
  dragDistance(): DragDistance {
    const settings = this.settings();
    let choice: unknown = undefined;
    try { choice = typeof settings?.getDragDistance === 'function' ? settings.getDragDistance() : undefined; } catch { choice = undefined; }
    return readDragDistance(choice);
  }

  /** Changes when a dragged token shows its distance in Atlas; false when Atlas is not there to keep it. */
  setDragDistance(choice: DragDistance): boolean {
    const settings = this.settings();
    if (typeof settings?.setDragDistance !== 'function') return false;
    try { settings.setDragDistance(choice); } catch { return false; }
    return true;
  }

  /**
   * The movement of the map at `mapPath` as Atlas's own drag ruler reads it (Atlas 0.15, the view holding the map):
   * the collection's rules with its game system's applied, and a token's speed (its own, its statblock's, the rules').
   * Null where no Atlas view holds the map, or its renderer has none.
   */
  movementFor(mapPath: string): { rules: MovementRules; speedOf(token: unknown): number | null } | null {
    for (const view of mapViews(this.app)) {
      if (view.atlasStore.getState().mapPath !== mapPath) continue;
      const call = (target: unknown, method: string, ...args: unknown[]): unknown => {
        if (!isObj(target) || typeof target[method] !== 'function') return undefined;
        try { return (target[method] as (...a: unknown[]) => unknown).apply(target, args); } catch { return undefined; }
      };
      const renderer = call(call(call((view as unknown as { serviceManager?: unknown }).serviceManager, 'getRendererService'), 'getRenderer'), 'getTokenRenderer');
      const ruler = isObj(renderer) ? renderer.dragRuler : undefined;
      const movement = isObj(ruler) ? ruler.movement : undefined;
      if (!isObj(movement)) return null;
      const rules = parseMovementRules(call(movement, 'rules'));
      if (!rules) return null;
      return {
        rules,
        speedOf: (token) => {
          // A statblock's speed is known once Atlas read it: it is asked for first, as Atlas's canvas does on a press; the
          // ruler redraws as the drag goes on, and reads it once it is there.
          call(movement, 'prepare', [token]);
          const speed = call(movement, 'speedOf', token);
          return isMovementSpeed(speed) && Number.isFinite(speed) ? speed : null;
        },
      };
    }
    return null;
  }

  /** How loud Atlas plays dice (0 to 1, its "Dice volume"); 1 without Atlas. */
  /** Atlas's dice look (`getDiceLook`: its global dice colour and font), as Atlas hands it; null without it. */
  diceLook(): unknown {
    const settings = this.settings();
    try { return typeof settings?.getDiceLook === 'function' ? settings.getDiceLook() : null; } catch { return null; }
  }

  diceVolume(): number {
    const settings = this.settings();
    let volume: unknown = 1;
    try { volume = typeof settings?.getDiceVolume === 'function' ? settings.getDiceVolume() : 1; } catch { volume = 1; }
    return typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : 1;
  }

  /** How opaque Atlas shows fog to the GM (0.1 to 1, "Fog opacity in GM view"); null without Atlas or in one that has no such setting. */
  gmFogOpacity(): number | null {
    const settings = this.settings();
    let value: unknown = null;
    try { value = typeof settings?.getGmFogOpacity === 'function' ? settings.getGmFogOpacity() : null; } catch { value = null; }
    return typeof value === 'number' && Number.isFinite(value) ? readGmFogOpacity(value) : null;
  }

  /** Sets Atlas's fog opacity in the GM's view; false when Atlas has no such setting. */
  setGmFogOpacity(opacity: number): boolean {
    const settings = this.settings();
    if (typeof settings?.setGmFogOpacity !== 'function') return false;
    try { settings.setGmFogOpacity(readGmFogOpacity(opacity)); } catch { return false; }
    return true;
  }

  /** Hears every change of Atlas's settings; returns the stop (which does nothing without Atlas). */
  onSettingsChange(listener: () => void): () => void {
    const settings = this.settings();
    if (typeof settings?.onChange !== 'function') return () => undefined;
    try {
      const stop = settings.onChange(() => listener());
      return typeof stop === 'function' ? stop : () => undefined;
    } catch {
      return () => undefined;
    }
  }

  /** Opens Atlas's own asset manager window (it needs no map view); false without Atlas. */
  openGlobalAssetManager(tab?: AssetTab): boolean {
    const manager = this.plugin()?.globalAssetManager;
    if (typeof manager?.open !== 'function') return false;
    manager.open(tab);
    return true;
  }

  /**
   * Runs an Atlas command against the map view holding `mapPath` (Atlas's commands act on its active view), then gives the
   * focus back to `back`. False when no Atlas view holds the map or the command did not run.
   */
  runInAtlas(mapPath: string, commandId: string, back: WorkspaceLeaf): boolean {
    const found = tabViewOf(this.app, mapPath);
    if (!found || !isAtlasView(found.view)) return false;
    const commands = (this.app as unknown as { commands?: { executeCommandById?(id: string): boolean } }).commands;
    if (typeof commands?.executeCommandById !== 'function') return false;
    this.app.workspace.setActiveLeaf(found.leaf, { focus: false });
    let ran = false;
    try { ran = commands.executeCommandById(commandId) === true; } finally { this.app.workspace.setActiveLeaf(back, { focus: true }); }
    return ran;
  }

  /** Calls `listener` once when Atlas loads (at once if it already has); returns a stop. */
  onLoaded(listener: () => void): () => void {
    if (this.loaded()) { listener(); return () => {}; }
    const every = this.options.every ?? ((ms: number, fn: () => void) => { const id = window.setInterval(fn, ms); return () => window.clearInterval(id); });
    const stop = every(1500, () => {
      if (!this.loaded()) return;
      stop();
      listener();
    });
    return stop;
  }
}
