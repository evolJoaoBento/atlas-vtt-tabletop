/**
 * The one place Tabletop reaches Atlas's running instances for the tools it shares with Atlas's toolbar (random tables,
 * asset manager, command palette). Atlas has no public API, so every member is duck-typed, checked before use and listed in
 * `scripts/check-atlas-members.mjs`. Nothing here constructs an Atlas service: Tabletop uses Atlas's own running ones (its
 * asset service through a map view, its settings service on the plugin), so there is never a second writer on Atlas's files.
 * Without Atlas every member answers "nothing" (null, false, Atlas's defaults) and none throws.
 */
import type { App, WorkspaceLeaf } from 'obsidian';
import { isAtlasView, mapViews, tabViewOf } from './atlas';
import { readToolbarLayout, resolveToolbarLayout, type ToolbarLayout } from './atlasPort/toolbarLayout';

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
  [member: string]: unknown;
}

/** Atlas's map hotkeys for the three shared tools, and their defaults (`keyboard/mapHotkeys.ts` @ 0.12.0). */
export type SharedHotkey = 'lootRoller' | 'assets' | 'palette' | 'undo' | 'redo' | 'redoAlt';
const DEFAULT_HOTKEYS: Record<SharedHotkey, string> = { lootRoller: 'l', assets: 'a', palette: 'Space', undo: 'Mod+z', redo: 'Mod+Shift+z', redoAlt: 'Mod+y' };

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
    return typeof key === 'string' && key !== '' ? key : DEFAULT_HOTKEYS[id];
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
