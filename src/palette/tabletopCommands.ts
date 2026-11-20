/**
 * Tabletop's own commands in Atlas's command palette on the board, under its Settings tab: every available toolbar
 * button (from `src/board/toolbarButtons.ts`, switching modes when needed) plus the lighting and board-settings
 * submenus (for quick preset / toggle choices that live inside those panels). Pure: `src/atlasPort/shims/tabletopCommands.tsx`
 * draws them with Lucide icons.
 */
import { t } from '../i18n';
import type { ToolbarActions } from '../board/toolbar';
import {
  toolbarButtonEntries,
  type ToolbarButtonState,
  type ToolbarCommandIcon,
} from '../board/toolbarButtons';

export interface TabletopCommand {
  id: string;
  label: string;
  /** A lucide icon name the stand-in draws. */
  icon: ToolbarCommandIcon;
  keywords?: string[];
  /** A switch or a choice: whether it is on now. */
  active?: boolean;
  run?(): void;
  submenu?: TabletopCommand[];
}

/** Optional toolbar bridge so palette entries can inspect attached end-slot/atlas buttons and jump via `goTo`. */
export interface ToolbarCommandHost {
  state(): ToolbarButtonState;
  goTo(id: string): boolean;
}

const choice = <T extends string>(
  id: string,
  label: string,
  icon: ToolbarCommandIcon,
  current: T | undefined,
  value: T,
  set: ((value: T) => void) | undefined,
  refresh: () => void,
): TabletopCommand => ({
  id, label, icon, active: current === value, run: () => { set?.(value); refresh(); },
});

/** Fallback availability when called without a live `BoardToolbar` (e.g. pure unit tests). */
function fallbackState(actions: ToolbarActions): ToolbarButtonState {
  return {
    actions,
    hasDice: false,
    hasDiceLog: false,
    hasSheet: false,
    hasCinema: false,
    cinemaLive: false,
    hasMore: false,
    atlasTools: [],
  };
}

/** Fallback action runner when called without a live `BoardToolbar`. */
function fallbackRun(id: string, actions: ToolbarActions, refresh: () => void): void {
  switch (id) {
    case 'undo': actions.undo?.(); break;
    case 'redo': actions.redo?.(); break;
    case 'mode-play': actions.setMode?.('play'); break;
    case 'mode-edit': actions.setMode?.('edit'); break;
    case 'mode-cinematic': actions.setMode?.('cinematic'); break;
    case 'move': actions.selectTool('move'); break;
    case 'laser': actions.selectTool('laser'); break;
    case 'measure': actions.selectMeasure?.(actions.measureShape?.() ?? 'line'); break;
    case 'template': actions.selectTemplate(actions.templateShape()); break;
    case 'water': actions.setWaterTool?.('paint'); break;
    case 'shapes': actions.setShapeTool?.(true); break;
    case 'see-through': actions.setSeeThrough?.(!(actions.seeThrough?.() ?? false)); break;
    case 'layers-solid': actions.setLayerLook?.('solid'); break;
    case 'layers-faded': actions.setLayerLook?.('faded'); break;
    case 'layers-transparent': actions.setLayerLook?.('transparent'); break;
    case 'initiative': actions.toggleInitiative(); break;
    default: break;
  }
  refresh();
}

/** The entries for a board; `refresh` redraws its toolbar after one ran. */
export function tabletopCommands(actions: ToolbarActions, refresh: () => void, host?: ToolbarCommandHost): TabletopCommand[] {
  const commands: TabletopCommand[] = [];
  const state = host ? host.state() : fallbackState(actions);
  const runButton = (id: string): void => {
    if (host) {
      host.goTo(id);
    } else {
      fallbackRun(id, actions, refresh);
    }
  };

  // Every available toolbar button from the single registry (switches mode when needed).
  for (const entry of toolbarButtonEntries(state)) {
    commands.push({
      id: `tabletop-toolbar-${entry.id}`,
      label: entry.label,
      icon: entry.icon,
      keywords: entry.keywords,
      ...(entry.active !== undefined ? { active: entry.active } : {}),
      run: () => runButton(entry.id),
    });
  }

  // Lighting quick-presets submenu (Classic/Dusk/Day/Night, Miniature look, Contact shadows).
  if (actions.canLight()) {
    const lighting = actions.lighting();
    commands.push({
      id: 'tabletop-lighting',
      label: 'Tabletop: lighting',
      icon: 'sun',
      keywords: ['light', 'sky', 'day', 'night', 'dusk', 'shadows', 'tilt', 'board', 'presets'],
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

  // Board settings quick-options submenu (panel-internal settings not already standalone toolbar buttons: wall edges, auto-roll).
  const board: TabletopCommand[] = [];
  if (actions.setWallEdges) {
    const edges = actions.wallEdges?.();
    for (const [value, label] of [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']] as const) {
      board.push(choice(`tabletop-edges-${value}`, `Wall edges: ${label}`, 'bricks', edges, value, actions.setWallEdges, refresh));
    }
  }
  board.push({ id: 'tabletop-auto-roll', label: t('dice.autoRoll'), icon: 'dice', active: actions.autoRoll(), run: () => { actions.setAutoRoll(!actions.autoRoll()); refresh(); } });
  commands.push({
    id: 'tabletop-board-settings',
    label: 'Tabletop: board settings',
    icon: 'settings',
    keywords: ['walls', 'edges', 'fog', 'dice', 'auto', 'roll', 'board'],
    submenu: board,
  });

  return commands;
}
