// Stand-ins for the copied command palette's pages that are Atlas's (react/components/command-palette/*Panel.tsx and the
// map image replacement, Atlas 0.15.0, AGPL-3.0): their settings live on Atlas's 2D map or in Atlas's own settings, so each
// page says so and opens Atlas's own palette on the same page.
import { Notice } from 'obsidian';
import { paletteHost } from '../../palette/paletteHost';

function AtlasPage({ page }: { page: string }) {
  return (
    <div className="atlas-command-settings-panel">
      <p className="setting-item-description">These settings are Atlas's: they open in Atlas's command palette.</p>
      <button className="mod-cta" onClick={() => paletteHost()?.openInAtlas(page)}>Open in Atlas</button>
    </div>
  );
}

export const SceneSnapshotsPanel = (_props: unknown) => <AtlasPage page="scene-snapshots" />;
export const SceneLevelsPanel = (_props: unknown) => <AtlasPage page="scene-levels" />;
// Atlas 0.14's lighting page: the light, darkness and vision of Atlas's scene (the board has its own lighting entries).
export const LightingSettingsPanel = (_props: unknown) => <AtlasPage page="lighting-settings" />;

export async function pickMapImage(..._args: unknown[]): Promise<void> {
  new Notice("Tabletop: replace the map image in Atlas.");
  paletteHost()?.openInAtlas('replace-map-image');
}

/** Atlas's table mode (the player view as a table TV) is Atlas's window: the board has its own player view. */
export function toggleTableMode(..._args: unknown[]): void {
  paletteHost()?.openInAtlas();
}

export function startFloorPositioning(..._args: unknown[]): void {
  paletteHost()?.openInAtlas('scene-levels');
}

export async function replaceMapImage(..._args: unknown[]): Promise<void> {}
