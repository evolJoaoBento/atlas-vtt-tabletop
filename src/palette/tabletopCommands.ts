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
  /** A settings page of the palette (Atlas's own kind: the entry opens it in place of the list); `id` is the page's. */
  page?: boolean;
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
    case 'water': actions.setWaterTool?.('paint'); break;
    case 'shapes': actions.setShapeTool?.(true); break;
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
    // Its page is the Tabletop Settings entry below.
    if (entry.id === 'board-settings') continue;
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

  // The players' AR table, once a phone has sent one: the board shows its sheets with handles to drag into place.
  if (actions.placeArTable && (actions.arTableSheets?.() ?? null) !== null) {
    commands.push({
      id: 'tabletop-ar-table',
      label: t('arTable.fineTune'),
      icon: 'scan',
      keywords: ['ar', 'augmented', 'reality', 'table', 'sheets', 'phone', 'fine-tune', 'place', 'calibrate', 'align'],
      run: () => actions.placeArTable?.(),
    });
  }

  // Tabletop's own settings page (what the Board settings panel held), in the Settings section as Atlas's pages are.
  commands.push({
    id: 'tabletop-settings',
    label: t('tabletopSettings.entry'),
    icon: 'settings',
    keywords: ['walls', 'edges', 'fog', 'height', 'thickness', 'snap', 'dice', 'auto', 'roll', 'board', 'tabletop', 'visibility', 'see-through', 'window', 'upper', 'layers', 'initiative', 'tracker', 'look', 'grade', 'halo'],
    page: true,
  });

  return commands;
}
