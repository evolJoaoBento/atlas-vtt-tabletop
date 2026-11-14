/**
 * Tabletop's own settings as entries of Atlas's command palette on the board, under its Settings tab: the board's
 * lighting (as the toolbar's lighting menu) and the board settings (as the toolbar's board settings panel). Each entry
 * runs the same action as its toolbar control. Pure: the palette's stand-in (src/atlasPort/shims/tabletopCommands.tsx)
 * draws them with Atlas's icons.
 */
import { t } from '../i18n';
import type { ToolbarActions } from '../board/toolbar';

export interface TabletopCommand {
  id: string;
  label: string;
  /** A lucide icon name the stand-in draws. */
  icon: 'sun' | 'sunset' | 'moon' | 'lamp' | 'blur' | 'shadow' | 'bricks' | 'eye' | 'layers' | 'sight' | 'swords' | 'dice' | 'settings';
  keywords?: string[];
  /** A switch or a choice: whether it is on now. */
  active?: boolean;
  run?(): void;
  submenu?: TabletopCommand[];
}

const choice = <T extends string>(id: string, label: string, icon: TabletopCommand['icon'], current: T | undefined, value: T, set: ((value: T) => void) | undefined, refresh: () => void): TabletopCommand => ({
  id, label, icon, active: current === value, run: () => { set?.(value); refresh(); },
});

/** The entries for a board; `refresh` redraws its toolbar after one ran. */
export function tabletopCommands(actions: ToolbarActions, refresh: () => void): TabletopCommand[] {
  const commands: TabletopCommand[] = [];
  if (actions.canLight()) {
    const lighting = actions.lighting();
    commands.push({
      id: 'tabletop-lighting', label: 'Tabletop: lighting', icon: 'sun', keywords: ['light', 'sky', 'day', 'night', 'dusk', 'shadows', 'tilt', 'board'],
      submenu: [
        choice('tabletop-lighting-classic', t('lighting.classic'), 'lamp', lighting, 'classic', (value) => actions.setLighting(value), refresh),
        choice('tabletop-lighting-dusk', t('lighting.dusk'), 'sunset', lighting, 'dusk', (value) => actions.setLighting(value), refresh),
        choice('tabletop-lighting-day', t('lighting.day'), 'sun', lighting, 'day', (value) => actions.setLighting(value), refresh),
        choice('tabletop-lighting-night', t('lighting.night'), 'moon', lighting, 'night', (value) => actions.setLighting(value), refresh),
        { id: 'tabletop-lighting-tilt', label: t('lighting.tilt'), icon: 'blur', active: actions.tiltShift(), run: () => { actions.setTiltShift(!actions.tiltShift()); refresh(); } },
        { id: 'tabletop-lighting-occlusion', label: t('lighting.occlusion'), icon: 'shadow', active: actions.occlusion(), run: () => { actions.setOcclusion(!actions.occlusion()); refresh(); } },
      ],
    });
  }
  const board: TabletopCommand[] = [];
  if (actions.setWallEdges) {
    const edges = actions.wallEdges?.();
    for (const [value, label] of [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']] as const) {
      board.push(choice(`tabletop-edges-${value}`, `Wall edges: ${label}`, 'bricks', edges, value, actions.setWallEdges, refresh));
    }
  }
  if (actions.setSeeThrough) {
    const on = actions.seeThrough?.() === true;
    board.push({ id: 'tabletop-see-through', label: 'See-through walls', icon: 'eye', active: on, run: () => { actions.setSeeThrough?.(!on); refresh(); } });
  }
  if (actions.setLayerLook) {
    const look = actions.layerLook?.();
    for (const [value, label] of [['solid', 'Solid'], ['faded', 'Faded'], ['transparent', 'Hidden']] as const) {
      board.push(choice(`tabletop-layers-${value}`, `Upper layers: ${label}`, 'layers', look, value, actions.setLayerLook, refresh));
    }
  }
  board.push({ id: 'tabletop-initiative', label: 'Initiative tracker', icon: 'swords', active: actions.initiativeOpen(), run: () => { actions.toggleInitiative(); refresh(); } });
  board.push({ id: 'tabletop-auto-roll', label: t('dice.autoRoll'), icon: 'dice', active: actions.autoRoll(), run: () => { actions.setAutoRoll(!actions.autoRoll()); refresh(); } });
  const mode = actions.mode?.() ?? null;
  if (mode !== null && actions.setMode) {
    const next = mode === 'edit' ? 'play' : 'edit';
    commands.push({ id: 'tabletop-mode', label: next === 'edit' ? 'Tabletop: edit mode' : 'Tabletop: play mode', icon: 'swords', keywords: ['edit', 'play', 'build', 'mode', 'toolbar'], run: () => { actions.setMode?.(next); refresh(); } });
  }
  commands.push({ id: 'tabletop-board-settings', label: 'Tabletop: board settings', icon: 'settings', keywords: ['walls', 'fog', 'layers', 'sight', 'initiative', 'dice', 'board'], submenu: board });
  return commands;
}
