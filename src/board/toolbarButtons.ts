/**
 * Single registry of the 3D board's toolbar buttons: each button's id, label, icon, mode(s), search keywords and
 * availability rule. Both `BoardToolbar` (for DOM registration and `goTo`) and `tabletopCommands` (for Atlas's command
 * palette) read this module, so no button on the toolbar can be missing from the palette. Pure.
 */
import { t } from '../i18n';
import { at } from '../atlasPort/atlasText';
import type { BoardMode, ToolbarActions } from './toolbar';
import type { LightingChoice } from './look';
import { LIQUID_NAMES } from './water';

/** Every icon name rendered by `src/atlasPort/shims/tabletopCommands.tsx`. */
export type ToolbarCommandIcon =
  | 'sun' | 'sunset' | 'moon' | 'lamp' | 'blur' | 'shadow' | 'bricks'
  | 'eye' | 'eye-off' | 'layers' | 'blend' | 'sight' | 'circle-dashed'
  | 'swords' | 'hammer' | 'clapperboard' | 'dice' | 'scroll' | 'notebook'
  | 'list-ordered' | 'settings' | 'undo' | 'redo' | 'hand' | 'flashlight'
  | 'sliders' | 'ruler' | 'shapes' | 'waves' | 'mountain' | 'paint-roller'
  | 'cloud' | 'ground' | 'radio' | 'coin' | 'image' | 'command' | 'ellipsis' | 'plug' | 'scan' | 'paintbrush' | 'volume';

export const TOOLBAR_BUTTON_IDS = [
  'undo',
  'redo',
  'mode-play',
  'mode-edit',
  'mode-cinematic',
  'move',
  'laser',
  'move-options',
  'fog',
  'measure',
  'measure-options',
  'water',
  'shapes',
  'paint',
  'paint-options',
  'lighting',
  'ground',
  'sheet',
  'dice',
  'dice-log',
  'cinema-live',
  'atlas-loot',
  'atlas-assets',
  'atlas-palette',
  'more',
  'gm-view',
] as const;

export type ToolbarButtonId = (typeof TOOLBAR_BUTTON_IDS)[number];

/** Live state read to decide which toolbar buttons are currently available and active. */
export interface ToolbarButtonState {
  actions: ToolbarActions;
  hasDice: boolean;
  hasDiceLog: boolean;
  hasSheet: boolean;
  sheetOpen?: boolean;
  hasCinema: boolean;
  cinemaLive: boolean;
  hasMore: boolean;
  atlasTools: readonly { id: 'loot' | 'assets' | 'palette'; label: string; enabled: boolean; active: boolean }[];
  /** Foreign buttons added into the toolbar's end slot (e.g. Connect's own buttons). */
  extraEndButtons?: readonly { id: string; label: string }[];
}

export interface ToolbarButtonSpec {
  readonly id: ToolbarButtonId;
  readonly label: string;
  labelOf?(state: ToolbarButtonState): string;
  readonly icon: ToolbarCommandIcon;
  /** Modes where this button lives (`'all'` means every mode). First entry is switched to when chosen from another mode. */
  readonly modes: 'all' | readonly BoardMode[];
  readonly keywords: readonly string[];
  keywordsOf?(state: ToolbarButtonState): readonly string[];
  available(state: ToolbarButtonState): boolean;
  /** True for toggles/choices that show a checkmark in the palette. */
  readonly toggle?: boolean;
  active?(state: ToolbarButtonState): boolean;
}

/** A resolved toolbar command entry ready for the command palette. */
export interface ResolvedToolbarButton {
  readonly id: string;
  readonly label: string;
  readonly icon: ToolbarCommandIcon;
  readonly keywords: string[];
  /** Mode to switch to before running, or null when already in a mode that has this button. */
  readonly switchTo: BoardMode | null;
  readonly active?: boolean;
}

export const MODE_LABELS: Readonly<Record<BoardMode, string>> = {
  play: 'Play mode',
  edit: 'Edit mode',
  cinematic: 'Cinematic mode',
};

const MODE_KEYWORDS: Readonly<Record<BoardMode, readonly string[]>> = {
  play: ['play', 'play mode'],
  edit: ['edit', 'edit mode'],
  cinematic: ['cinematic', 'cinematic mode', 'cutscene'],
};

const lightingName = (choice: LightingChoice): string => t(`lighting.${choice}`);

/** Returns the mode to switch to when choosing a button of `modes` from `current`, or null if no switch is needed. */
export function targetModeFor(modes: 'all' | readonly BoardMode[], current: BoardMode | null): BoardMode | null {
  if (current === null || modes === 'all' || modes.includes(current)) return null;
  return modes[0] ?? null;
}

const atlasToolOf = (state: ToolbarButtonState, id: 'loot' | 'assets' | 'palette') =>
  state.atlasTools.find((tool) => tool.id === id);

export const TOOLBAR_BUTTONS: Readonly<Record<ToolbarButtonId, ToolbarButtonSpec>> = {
  undo: {
    id: 'undo', label: 'Undo', icon: 'undo', modes: ['play', 'edit'],
    keywords: ['undo', 'history', 'back'],
    available: ({ actions }) => actions.undo !== undefined,
  },
  redo: {
    id: 'redo', label: 'Redo', icon: 'redo', modes: ['play', 'edit'],
    keywords: ['redo', 'history', 'forward'],
    available: ({ actions }) => actions.redo !== undefined,
  },
  'mode-play': {
    id: 'mode-play', label: 'Play mode', icon: 'swords', modes: 'all',
    keywords: ['play', 'mode', 'game', 'toolbar'],
    available: ({ actions }) => actions.mode !== undefined && actions.mode() !== null && actions.setMode !== undefined,
    toggle: true,
    active: ({ actions }) => actions.mode?.() === 'play',
  },
  'mode-edit': {
    id: 'mode-edit', label: 'Edit mode', icon: 'hammer', modes: 'all',
    keywords: ['edit', 'mode', 'build', 'toolbar'],
    available: ({ actions }) => actions.mode !== undefined && actions.mode() !== null && actions.setMode !== undefined,
    toggle: true,
    active: ({ actions }) => actions.mode?.() === 'edit',
  },
  'mode-cinematic': {
    id: 'mode-cinematic', label: 'Cinematic mode', icon: 'clapperboard', modes: 'all',
    keywords: ['cinematic', 'cutscene', 'mode', 'movie', 'toolbar'],
    available: ({ actions, hasCinema }) => hasCinema && actions.mode !== undefined && actions.mode() !== null && actions.setMode !== undefined,
    toggle: true,
    active: ({ actions }) => actions.mode?.() === 'cinematic',
  },
  move: {
    id: 'move', label: 'Move/Select', icon: 'hand', modes: ['play', 'edit'],
    keywords: ['move', 'select', 'hand', 'tool'],
    available: () => true,
  },
  laser: {
    id: 'laser', label: 'Laser Pointer', icon: 'flashlight', modes: ['play', 'edit'],
    keywords: ['laser', 'pointer', 'beam', 'move'],
    available: () => true,
  },
  'move-options': {
    id: 'move-options', label: 'Move options', icon: 'sliders', modes: ['play', 'edit'],
    keywords: ['move', 'options', 'laser', 'colour', 'color', 'size'],
    available: () => true,
  },
  fog: {
    id: 'fog', label: at('toolbar.fogTool'), icon: 'cloud', modes: ['edit'],
    keywords: ['fog', 'fog of war', 'cover', 'reveal', 'hide', 'eraser', 'brush', 'rooms'],
    keywordsOf: ({ actions }) => (actions.fog?.state().mode === 'eraser' ? [at('toolbar.fogEraser')] : []),
    available: ({ actions }) => actions.fog !== undefined,
    toggle: true,
    active: ({ actions }) => actions.fog?.state().on === true,
  },
  measure: {
    id: 'measure', label: 'Measure', icon: 'ruler', modes: ['play'],
    keywords: ['measure', 'ruler', 'circle', 'cone', 'square', 'line', 'ranges', 'distance'],
    available: ({ actions }) => actions.selectMeasure !== undefined,
  },
  'measure-options': {
    id: 'measure-options', label: t('toolbar.measureOptions'), icon: 'sliders', modes: ['play'],
    keywords: ['measure', 'tool', 'options', 'drag', 'distance', 'rules'],
    available: ({ actions }) => actions.selectMeasure !== undefined,
  },
  water: {
    id: 'water', label: 'Water', icon: 'waves', modes: ['edit'],
    keywords: ['water', 'lava', 'acid', 'liquid', 'paint', 'brush', 'fill', 'erase'],
    keywordsOf: ({ actions }) => {
      const liquid = actions.liquid?.() ?? 'water';
      return liquid === 'water' ? [] : [`Water (${LIQUID_NAMES[liquid].toLowerCase()})`, LIQUID_NAMES[liquid]];
    },
    available: ({ actions }) => actions.setWaterTool !== undefined,
  },
  shapes: {
    id: 'shapes', label: 'Shapes', icon: 'mountain', modes: ['edit'],
    keywords: ['shapes', 'roof', 'hill', 'terrain', 'draw'],
    available: ({ actions }) => actions.setShapeTool !== undefined,
  },
  paint: {
    id: 'paint', label: 'Paint walls', icon: 'paint-roller', modes: ['edit'],
    keywords: ['paint', 'walls', 'material', 'texture'],
    available: ({ actions }) => actions.setPainting !== undefined,
  },
  'paint-options': {
    id: 'paint-options', label: 'Materials', icon: 'paint-roller', modes: ['edit'],
    keywords: ['materials', 'paint', 'walls', 'texture', 'options'],
    available: ({ actions }) => actions.setPainting !== undefined,
  },
  lighting: {
    id: 'lighting', label: 'Lighting', icon: 'sun', modes: ['edit'],
    keywords: ['lighting', 'light', 'sky', 'day', 'night', 'dusk', 'classic', 'ambient', 'tint'],
    keywordsOf: ({ actions }) => [t('lighting.title', { mode: lightingName(actions.lighting()) })],
    available: ({ actions }) => actions.canLight(),
  },
  ground: {
    id: 'ground', label: 'Background', icon: 'ground', modes: ['edit'],
    keywords: ['ground', 'horizon', 'background', 'fog', 'board', 'plane'],
    available: ({ actions }) => actions.setGround !== undefined,
  },
  sheet: {
    // No toolbar button: this command alone opens the drawer.
    id: 'sheet', label: 'Stat sheet', icon: 'notebook', modes: ['play'],
    keywords: ['stat', 'sheet', 'character', 'monster', 'dice', 'log'],
    // A plain command, not a toggle: Atlas's palette draws a toggle's checkbox where its icon would be.
    available: ({ hasSheet }) => hasSheet,
  },
  dice: {
    id: 'dice', label: 'Dice tray', icon: 'dice', modes: ['play'],
    keywords: ['dice', 'tray', 'roll', 'picker'],
    available: ({ hasDice }) => hasDice,
  },
  'dice-log': {
    id: 'dice-log', label: 'Dice log', icon: 'scroll', modes: ['play'],
    keywords: ['dice', 'log', 'history', 'rolls'],
    available: ({ hasDiceLog }) => hasDiceLog,
  },
  'cinema-live': {
    id: 'cinema-live', label: 'Players follow my camera', icon: 'radio', modes: ['play', 'cinematic'],
    keywords: ['players', 'follow', 'camera', 'live', 'cinematic', 'cutscene'],
    available: ({ actions, hasCinema }) => hasCinema && actions.hosting(),
    toggle: true,
    active: ({ cinemaLive }) => cinemaLive,
  },
  'atlas-loot': {
    id: 'atlas-loot', label: 'Random tables', icon: 'coin', modes: ['play'],
    labelOf: (state) => atlasToolOf(state, 'loot')?.label ?? 'Random tables',
    keywords: ['random', 'tables', 'loot', 'roller'],
    available: (state) => atlasToolOf(state, 'loot')?.enabled === true,
  },
  'atlas-assets': {
    id: 'atlas-assets', label: 'Asset manager', icon: 'image', modes: ['play'],
    labelOf: (state) => atlasToolOf(state, 'assets')?.label ?? 'Asset manager',
    keywords: ['asset', 'manager', 'tokens', 'maps', 'scenes'],
    available: (state) => atlasToolOf(state, 'assets')?.enabled === true,
  },
  'atlas-palette': {
    id: 'atlas-palette', label: 'Command Palette', icon: 'command', modes: 'all',
    labelOf: (state) => atlasToolOf(state, 'palette')?.label ?? 'Command Palette',
    keywords: ['command', 'palette', 'search'],
    available: (state) => atlasToolOf(state, 'palette')?.enabled === true,
  },
  'gm-view': {
    id: 'gm-view', label: 'GM view', icon: 'eye', modes: ['play', 'edit'],
    keywords: ['gm', 'view', 'session', 'players', 'player view', 'fog', 'hidden', 'preview'],
    available: ({ actions }) => actions.gmView !== undefined && actions.setGmView !== undefined,
    toggle: true,
    active: ({ actions }) => actions.gmView?.() !== false,
  },
  more: {
    id: 'more', label: 'More tools', icon: 'ellipsis', modes: ['play', 'edit'],
    keywords: ['more', 'tools', 'overflow'],
    available: ({ hasMore }) => hasMore,
  },
};

/** Resolves every currently available toolbar button into a palette-ready entry, with mode suffix when switching mode. */
export function toolbarButtonEntries(state: ToolbarButtonState): ResolvedToolbarButton[] {
  const current = state.actions.mode?.() ?? null;
  const entries: ResolvedToolbarButton[] = [];
  for (const id of TOOLBAR_BUTTON_IDS) {
    const spec = TOOLBAR_BUTTONS[id];
    if (!spec.available(state)) continue;
    const baseLabel = spec.labelOf?.(state) ?? spec.label;
    const switchTo = targetModeFor(spec.modes, current);
    const label = switchTo ? `${baseLabel} · ${MODE_LABELS[switchTo]}` : baseLabel;
    const modeWords = spec.modes === 'all' ? [] : spec.modes.flatMap((mode) => MODE_KEYWORDS[mode]);
    const extraWords = spec.keywordsOf?.(state) ?? [];
    const keywords = [...new Set([...spec.keywords, ...extraWords, ...modeWords])];
    entries.push({
      id,
      label,
      icon: spec.icon,
      keywords,
      switchTo,
      ...(spec.toggle ? { active: spec.active?.(state) === true } : {}),
    });
  }
  for (const extra of state.extraEndButtons ?? []) {
    const switchTo = targetModeFor(['play'], current);
    const label = switchTo ? `${extra.label} · ${MODE_LABELS[switchTo]}` : extra.label;
    entries.push({
      id: extra.id,
      label,
      icon: 'plug',
      keywords: [extra.label.toLowerCase(), ...MODE_KEYWORDS.play],
      switchTo,
    });
  }
  return entries;
}
