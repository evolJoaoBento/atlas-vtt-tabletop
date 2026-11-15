// Stand-in for Atlas's react/hooks/useSystemPresets.ts @ 0.15.0 (AGPL-3.0) in the copies. Atlas's preset files are opened by
// its plugin (no copy can reach them), so the board reads the collection's own rarity words and no game system preset's.
import type { App } from 'obsidian';
type SystemPreset = never;

interface SystemPresets {
  service: null;
  presets: SystemPreset[];
}

export function useSystemPresets(_app: App | undefined): SystemPresets {
  return { service: null, presets: [] };
}
