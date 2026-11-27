// Atlas source: src/app/react/components/command-palette/types.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type React from 'react';

export interface CommandOption {
  id: string;
  icon: React.ReactNode | null;
  label: string;
  keywords?: string[];
  shortcut?: string;
  section: string;
  action?: () => void;
  isToggle?: boolean;
  isActive?: boolean;
  hasSubmenu?: boolean;
  submenu?: CommandOption[];
}

/** Pages the palette expands into in place of its command list. */
export const SETTINGS_PANEL_IDS = [
  'scene-snapshots',
  'scene-levels',
  'grid-settings',
  'token-settings',
  'widget-settings',
  'local-player-view-settings',
  'dice-settings',
  'experimental-features',
  'graphics-settings',
  'lighting-settings',
  // Tabletop's own pages, in the palette like Atlas's.
  'tabletop-settings',
  'tabletop-sound-settings',
] as const;

export type SettingsPanelId = (typeof SETTINGS_PANEL_IDS)[number];

export function isSettingsPanelId(id: string | null): id is SettingsPanelId {
  return id !== null && (SETTINGS_PANEL_IDS as readonly string[]).includes(id);
}
