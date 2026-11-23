/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: Atlas's Move/Select group (its button shows the
 * hand, or the flashlight while the laser pointer is on; its menu chooses between the two and holds the laser's
 * colour and size); the local player view (open or close it, and
 * freeze the players' camera while it is open), and the command button, which opens the board's settings in a panel
 * above it, as Atlas's opens its command palette. The panel has the fog of war's height. Plain HTML over the board;
 * keys typed in it stay out of the board's camera keys.
 */

import { FOG_MIN, GROUND_NOISES, MAX_MARGIN, MAX_TILE, type GroundMode, type GroundSettings } from './ground';
import type { LiquidKind, WaterMotion } from './water';
import { setSvg } from '../svg';
import { atlasMeasureControlIcon, atlasMeasureEffectIcon, atlasMeasureIcon, atlasToolIcon, fogIcon, gmViewIcon, helpIcon, historyIcon, modeIcon, peekIcon, waterIcon } from './atlasToolIcons';
import { peekButtonState, type PeekButtonState } from './lightingPeek';
import { FogToolBars } from './fogToolBar';
import type { FogBarActions } from './fogTool';
import { at } from '../atlasPort/atlasText';
import {
  DEFAULT_MEASURE_TOOL, MEASURE_COLOR_SWATCHES, MEASURE_EFFECTS, MEASURE_MODES, colourWithEffect, isMeasureShape,
  measureColorOfSwatch, swatchOfMeasureColor, type MeasureEffect, type MeasureMode, type MeasureShapeKind, type MeasureToolOptions,
} from './measureOptions';
import type { DragDistance } from '../../packages/atlas-shared/src/index';
import { LAVA_STYLES, LIQUID_KINDS, LIQUID_NAMES, LIQUID_TINTS, MOTION_LABELS, WATER_MOTION_KINDS, type LavaStyle, type WaterMotionKind } from './water';
import { DICES_SVG } from '../dice/dicePicker';
import type { LightingChoice } from './look';
import { DEFAULT_EDGES, DEFAULT_SEE_THROUGH_SIZE, readSeeThroughSize, DEFAULT_LAYER_LOOK, type LayerLook, type WallEdges } from './quality';
import { SeeThroughRing, type SeeThroughCircle } from './seeThroughRing';
import { AtlasTooltip, type AtlasTooltipSpec } from './atlasTooltip';
import { t } from '../i18n';
import { LASER_COLORS, LASER_COLOR_HINT, LASER_SIZE_MAX, LASER_SIZE_MIN, type LaserSettings } from './laser';
import { TOOLBAR_BUTTONS, targetModeFor, type ToolbarButtonId, type ToolbarButtonState } from './toolbarButtons';

/** One of Atlas's toolbar tools on the board (src/board/atlasTools.ts decides which and in what order). */
export interface AtlasToolButton {
  id: 'loot' | 'assets' | 'palette';
  /** Atlas's own name for it. */
  label: string;
  /** Its key on the board, as shown ("L", "Shift+A", "Space"). */
  shortcut: string | null;
  /** False while it needs Atlas and Atlas cannot be reached (the button is disabled and says so). */
  enabled(): boolean;
  /** Its window is open. */
  active(): boolean;
  run(): void;
}

/** Atlas 0.17's keyboard shortcuts button on the board: Atlas's shortcut help (`HotkeyHelpWindow`). */
export interface ToolbarHelp {
  /** Atlas's own name for it ("Keyboard shortcuts"). */
  label: string;
  /** Its key on the board, as shown ("?"). */
  shortcut: string | null;
  /** The help is open. */
  active(): boolean;
  open(): void;
}

/**
 * The board's toolbar modes: Play (the game's tools), Edit (building the board) and Cinematic (the GM's cutscenes; only
 * the mode switch and the live toggle show). Play and Edit are remembered; Cinematic is not.
 */
export type BoardMode = 'play' | 'edit' | 'cinematic';

/** A material the paint tool offers: its folder, its name and its thumbnail (null while there is none). */
export interface PaintMaterial { path: string; name: string; thumb: string | null }

/** The paint tool's choice that takes a wall's material off. */
export const UNPAINT = '\u0000unpaint';

export interface ToolbarActions {
  /** The toolbar's mode (null: the board has no modes, every tool shows); choosing one. */
  mode?(): BoardMode | null;
  setMode?(mode: BoardMode): void;
  /** The wall paint tool: the material walls are painted with on click (`UNPAINT` takes it off; null: off), and the materials. */
  painting?(): string | null;
  setPainting?(material: string | null): void;
  materials?(): PaintMaterial[];
  /** Tabletop's undo history of the board's map (Atlas's undo/redo bar). */
  canUndo?(): boolean;
  canRedo?(): boolean;
  undo?(): void;
  redo?(): void;
  /** How tall the fog stands, in grid squares. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** How thick the walls stand, as a share of a grid square. */
  wallThickness(): number;
  setWallThickness(thickness: number): void;
  /** How round the walls' edges are, kept for every board; absent where it is not the GM's to choose. */
  wallEdges?(): WallEdges;
  setWallEdges?(edges: WallEdges): void;
  /** Whether walls between the camera and what it looks at fade out, kept for every board; absent where it is not the GM's to choose. */
  seeThrough?(): boolean;
  setSeeThrough?(on: boolean): void;
  /** Whether dropped tokens and props snap to the grid, kept for every board; absent where it is not the GM's to choose. */
  snap?(): { tokens: boolean; props: boolean };
  setSnap?(kind: 'tokens' | 'props', on: boolean): void;
  seeThroughSize?(): number;
  setSeeThroughSize?(squares: number): void;
  /** Screen position and radius of the see-through window at the pivot (in canvas CSS px), or null in views without a cut. */
  seeThroughCircle?(): SeeThroughCircle | null;
  /** How the image of an elevation layer is drawn; absent where it is not the GM's to choose. */
  layerLook?(): LayerLook;
  setLayerLook?(look: LayerLook): void;
  /** Whether Connect hosts a session: the Template tool shows then. */
  hosting(): boolean;
  /** How many sheets the players' AR table of this map has; null when it has none (absent where it is not the GM's). */
  arTableSheets?(): number | null;
  /** Starts fine-tuning where the players' AR table lies on the map. */
  placeArTable?(): void;
  /** The GM's fog tool (Atlas 0.18's: its button and two bars), in Edit mode; absent where the board has no fog tool. */
  fog?: FogBarActions;
  /** The GM's water brush: painting or erasing (null: off), its radius in grid cells, and how all of the map's water moves. */
  waterTool?(): 'paint' | 'erase' | 'fill' | null;
  setWaterTool?(mode: 'paint' | 'erase' | 'fill' | null): void;
  /** The Shapes tool (Edit mode): raised shapes, roofs and hills, drawn corner by corner on the level shown. */
  /** The ground round the map (the Ground button's panel): the table or a plane to the horizon, its pattern, fog and extra board. */
  ground?(): GroundSettings;
  setGround?(settings: GroundSettings): void;
  /** The saved painted backgrounds that can lie round the map (the Painted ground's choices). */
  backgrounds?(): readonly { folder: string; name: string }[];
  shapeTool?(): boolean;
  setShapeTool?(on: boolean): void;
  /** The water bucket's sensitivity, 0 to 100. */
  waterFill?(): number;
  setWaterFill?(sensitivity: number): void;
  waterBrush?(): number;
  setWaterBrush?(cells: number): void;
  waterMotion?(): WaterMotion;
  setWaterMotion?(motion: WaterMotion): void;
  /** The liquid the brush paints (water, lava, acid); its motion is `waterMotion`'s. */
  liquid?(): LiquidKind;
  setLiquid?(liquid: LiquidKind): void;
  /** The GM's Measure tool (Atlas's): on, its shape/options, choosing a shape (null goes back to Move), clearing kept measures, drag distance and rules. */
  measureOn?(): boolean;
  measureShape?(): MeasureShapeKind;
  selectMeasure?(shape: MeasureShapeKind | null): void;
  measureOptions?(): MeasureToolOptions;
  setMeasureOptions?(changes: Partial<MeasureToolOptions>): void;
  clearMeasures?(): void;
  hasKeptMeasures?(): boolean;
  hasLevels?(): boolean;
  dragDistance?(): DragDistance;
  setDragDistance?(choice: DragDistance): void;
  openMeasureRules?(): void;
  canOpenMeasureRules?(): boolean;
  rangesUnavailable?(): string | null;
  measureShortcut?(): string | null;
  measureKeepShortcut?(): string | null;
  /** The key Atlas opens its dice tray and its dice log with, as shown. */
  diceShortcut?(which: 'diceTray' | 'diceLog'): string | null;
  /** Atlas's GM view switch: whether the board shows the GM's view (off: Atlas's session view, as players see it), throwing it, and its key as shown. Absent where there is no switch. */
  gmView?(): boolean;
  setGmView?(on: boolean): void;
  gmViewShortcut?(): string | null;
  /** Atlas's lighting peek, held from the bar's button (a finger holds no key): starts and ends it. Absent where the board has none. */
  peek?(on: boolean): void;
  /** Whether the pointer is a finger now: the peek button is there only then. */
  coarse?(): boolean;
  templateOn(): boolean;
  templateShape(): string;
  /** Turns the Template tool on with a shape, or off with null. */
  selectTemplate(shape: string | null): void;
  /** Takes every template off the map. */
  clearTemplates(): void;
  playerViewOpen(): boolean;
  togglePlayerView(): void;
  /** Whether the players' camera is frozen; freezing it, or letting it follow again. */
  playerFrozen(): boolean;
  togglePlayerFreeze(): void;
  /** Whether the laser is on; choosing Move/Select or the laser pointer; the laser's colour and size, and changing them. */
  laserOn(): boolean;
  selectTool(tool: 'move' | 'laser'): void;
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** Whether the initiative tracker shows on the board; showing or hiding it. */
  initiativeOpen(): boolean;
  toggleInitiative(): void;
  /** Whether the board's lighting is chosen here (a board of the GM's); the choice now; choosing one. */
  canLight(): boolean;
  lighting(): LightingChoice;
  setLighting(choice: LightingChoice): void;
  /** The miniature look (tilt-shift) and the contact shadows, on or off, kept for every board. */
  tiltShift(): boolean;
  setTiltShift(on: boolean): void;
  occlusion(): boolean;
  setOcclusion(on: boolean): void;
  /** Whether a stat sheet's roll is thrown at once, or its dice lie on the table; changing it. Absent where dice are not the GM's. */
  autoRoll(): boolean;
  setAutoRoll(on: boolean): void;
  /** The board's ambient light (0–1); a new level, shown while the slider moves and kept when it is let go. */
  ambient(): number;
  setAmbient(level: number, keep: boolean): void;
  /** Whether the scene's lighting is on in Atlas; off, the light level cannot be set here. Absent: on. */
  lightingOn?(): boolean;
  /** The colour the daylight is tinted ('#rrggbb'), or null for none; a new one, shown while the picker moves and kept when it is let go; and taking it off. */
  tint(): string | null;
  setTint(color: string, keep: boolean): void;
  resetTint(): void;
  /** Atlas's "Forget explored areas" (its Lighting settings button): the players' memory of what their tokens saw is forgotten. Absent: not the GM's to do. */
  forgetExplored?(): void;
  /** Whether Atlas can do it (a newer Atlas than the floor may be needed). Absent: it can. */
  forgetExploredOffered?(): boolean;
}

/** Lucide's `rotate-ccw` (ISC), the icon of Atlas's Forget explored areas button. */
const FORGET_EXPLORED_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';
/** What the light level's slider says while the scene's lighting is off in Atlas. */
export const LIGHTING_OFF_TITLE = 'Turn on lighting in Atlas to set the light level.';

/** The board's dice picker, dice log and stat sheet, which open from buttons in the toolbar's end slot. */
export interface DiceButton {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

/** The cutscene toggle: the live toggle makes the players follow the GM's camera. */
export interface CinemaButtons {
  live(): boolean;
  toggleLive(): void;
}

/** A button in the toolbar's end slot and the panel it toggles. */
interface EndButton {
  handlers: DiceButton;
  anchor: HTMLElement;
  button: HTMLButtonElement;
}

/** Lucide's `scroll-text` (ISC): the dice log's button. */
const LOG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>';

/** Lucide's `notebook-text` (ISC): the stat sheet's button. */
const SHEET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12H16"/><path d="M9.5 16H14"/></svg>';

/** Lucide's `radio` (ISC): players following the GM's camera. */
const LIVE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19.1"/></svg>';

/** Lucide's `ellipsis` (ISC): the More tools button. */
const MORE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';

/** Lucide's `command` icon (ISC), the glyph of Atlas's command palette button. */
/** Lucide's `brick-wall` icon (ISC): the board settings button, whose panel is about walls and fog first. */
/** Lucide's mountain: the Shapes tool (roofs, hills). */
/** Ground running to the horizon: a horizon line and a grid in perspective (drawn for this button, in Lucide's style). */
const GROUND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7h20"/><path d="m9 7-5 14"/><path d="m15 7 5 14"/><path d="M12 7v14"/><path d="M5.5 15h13"/></svg>';
const SHAPES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>';
const WALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/></svg>';


/** Lucide's `flashlight`, `chevron-down` and `check` icons (ISC): Atlas's laser pointer, its options' chevron, a chosen swatch. */
const LASER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/></svg>';
/** Lucide's `hand` (ISC): Atlas's Move/Select. */
const HAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';
/** Lucide's `lightbulb`, `sunset`, `sun` and `moon` icons (ISC): the lighting choices. */
const LIGHTING_ICONS: Readonly<Record<LightingChoice, string>> = {
  classic: lucide2('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  dusk: lucide2('<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>'),
  day: lucide2('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  night: lucide2('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
};
const lightingLabel = (choice: LightingChoice): string => t(`lighting.${choice}`);
const LIGHTING_ORDER: readonly LightingChoice[] = ['classic', 'dusk', 'day', 'night'];

/** Atlas's Move/Select key, which also switches to the laser pointer and back. */
const MOVE_KEY = 'V';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK_SVG = '<svg class="atlas-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
/** Atlas's slider thumb is a rem across: it stays within the track at either end. */
const THUMB_PX = 16;

/** Lucide's `presentation` and `snowflake` icons (ISC): Atlas's player view, and a frozen camera. */
/** Lucide's shapes: Connect's Template tool. */
const TEMPLATE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>';
/** Lucide's icons Connect's player toolbar shows beside each template shape, and for clearing them. */
const lucide = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const TEMPLATE_SHAPES = [
  ['line', 'Line', lucide('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>')],
  ['circle', 'Circle/Sphere', lucide('<circle cx="12" cy="12" r="10"/>')],
  ['square', 'Square/Cube', lucide('<rect width="18" height="18" x="3" y="3" rx="2"/>')],
  ['cone', 'Cone', lucide('<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>')],
] as const;
const ERASER_SVG = lucide('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>');
/** Lucide icons (ISC) for the Visibility icon bar: scan-eye, circle-dashed, layers, blend, eye-off, list-ordered. */
const SEE_THROUGH_SVG = lucide('<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>');
const WINDOW_SIZE_SVG = lucide('<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>');
const LAYERS_SOLID_SVG = lucide('<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>');
const LAYERS_FADED_SVG = lucide('<circle cx="9" cy="9" r="7"/><circle cx="15" cy="15" r="7"/>');
const LAYERS_HIDDEN_SVG = lucide('<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>');
const INITIATIVE_SVG = lucide('<path d="M10 12h11"/><path d="M10 18h11"/><path d="M10 6h11"/><path d="M4 10h2"/><path d="M4 6h1v4"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>');

function lucide2(body: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** A height typed in the panel: a number of squares from 0, or null when it is not one. */
export function readFogHeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** A wall thickness typed in the board settings, in squares: more than none, at most two squares. */
export function readWallThickness(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 2 ? value : null;
}

export class BoardToolbar {
  private readonly row: HTMLElement;
  /** Where Atlas's turn banner stands: centred above the toolbar (its `atlas-bottom-toolbar-row__above`). */
  readonly turnBannerHost: HTMLElement;
  private readonly bar: HTMLElement;
  /** Atlas 0.17's keyboard shortcuts bar, in the board's bottom-right corner (hidden until `setHelp`). */
  private readonly helpBar: HTMLElement;
  private readonly helpButton: HTMLButtonElement;
  private help: ToolbarHelp | null = null;
  /** Atlas's "More tools": the tools that do not fit a narrow pane move into its menu, in this order of leaving. */
  private readonly moreGroup: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu: HTMLElement;
  private readonly fitOrder: HTMLElement[] = [];
  private readonly fitWatch: ResizeObserver;
  private lastMode: BoardMode | null | undefined = undefined;
  private readonly registeredButtons = new Map<ToolbarButtonId, HTMLButtonElement>();
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  /** The Visibility icon bar above the main toolbar: see-through walls, window size, upper layers, initiative tracker. */
  private readonly viewPanel: HTMLElement;
  private readonly viewButton: HTMLButtonElement;
  private readonly seeThroughGroup: HTMLElement;
  private readonly seeThroughButton: HTMLButtonElement;
  private readonly seeThroughSizeButton: HTMLButtonElement;
  private readonly viewSep1: HTMLElement;
  private readonly layerGroup: HTMLElement;
  private readonly viewSep2: HTMLElement;
  private readonly panelGroup: HTMLElement;
  private readonly initiativeButton: HTMLButtonElement;
  private readonly sheetButton: HTMLButtonElement;
  private readonly seeThroughRing: SeeThroughRing;
  private readonly viewTooltip: AtlasTooltip;
  /** What unwires each control's tooltip (`setTip`), for the ones that are rebuilt. */
  private readonly tipDetach = new Map<HTMLElement, () => void>();
  /** What each control's tooltip says now (`setTip`). */
  private readonly tips = new WeakMap<HTMLElement, AtlasTooltipSpec | (() => AtlasTooltipSpec | null) | null>();
  private sizeMode = false;
  /** Tracks a pointerdown on the canvas during size mode so camera orbit/pan drags keep the bar open. */
  private outsideCanvas: { pointerId: number; x: number; y: number } | null = null;
  /** The Ground button and its panel: the map's background, kept per map (absent without `setGround`). */
  private readonly groundButton: HTMLButtonElement;
  private readonly groundPanel: HTMLElement;
  /** Connect's Template tool, offered only while Connect hosts, and its shapes. */
  private readonly templateButton: HTMLButtonElement;
  private readonly templateGroup: HTMLElement;
  private readonly historyGroup: HTMLElement;
  private readonly undoButton: HTMLButtonElement;
  private readonly redoButton: HTMLButtonElement;
  private readonly waterGroup: HTMLElement;
  /** The fog tool's button (beside Move, as Atlas places it) and its two bars. */
  private readonly fogGroup: HTMLElement;
  private readonly fogButton: HTMLButtonElement;
  private readonly fogBars: FogToolBars | null;
  private fogFace = '';
  private readonly modeGroup: HTMLElement;
  private readonly modeButtons: Array<{ mode: BoardMode; button: HTMLButtonElement }> = [];
  private readonly paintGroup: HTMLElement;
  private readonly shapeGroup: HTMLElement;
  private groundUi: {
    section: HTMLElement; modes: Array<{ value: GroundMode; button: HTMLButtonElement }>; rows: Array<{ row: HTMLElement; modes: GroundMode[] }>;
    water: { kind: HTMLSelectElement; style: HTMLSelectElement; amount: HTMLInputElement; direction: HTMLInputElement; directionRow: HTMLElement; clarity: HTMLInputElement; tint: HTMLInputElement; presets: HTMLElement; makePresets(liquid: LiquidKind): void };
    material: HTMLSelectElement; background: HTMLSelectElement; noise: HTMLSelectElement; strength: HTMLInputElement; strengthValue: HTMLElement;
    fog: HTMLInputElement; fogOn: HTMLInputElement; fogValue: HTMLElement; margin: HTMLInputElement; marginValue: HTMLElement; tile: HTMLInputElement; tileValue: HTMLElement;
  } | null = null;
  private readonly shapeButton: HTMLButtonElement;
  private readonly paintButton: HTMLButtonElement;
  private readonly paintMenuButton: HTMLButtonElement;
  private readonly paintPanel: HTMLElement;
  /** The material the paint tool's button takes up again. */
  private lastPaint: string | null = null;
  private readonly waterButton: HTMLButtonElement;
  /** The Water painter's horizontal Fog-style option bars above the main toolbar (liquids on the left, tools and popovers on the right). */
  private readonly waterPanel: HTMLElement;
  private lastWaterMode: 'paint' | 'erase' | 'fill' = 'paint';
  private readonly waterPopovers: Record<'brush' | 'tint' | 'motion', { trigger: HTMLButtonElement; panel: HTMLElement }>;
  private openWaterPopoverName: 'brush' | 'tint' | 'motion' | null = null;
  private readonly waterSizeDot: HTMLElement;
  private readonly waterTintDot: HTMLElement;
  private readonly waterValues: { brush: HTMLElement; fill: HTMLElement; amount: HTMLElement; direction: HTMLElement; clarity: HTMLElement };
  private waterFillInput: HTMLInputElement | null = null;
  /** What of the brush's bar names its liquid: the mode buttons, the motions, the tint's label and swatches (made for `tintsOf`). */
  private readonly liquidUi: { modes: Map<string, HTMLButtonElement>; motions: Map<WaterMotionKind, HTMLElement>; motionLabel: HTMLElement; tintLabel: HTMLElement; tintGrid: HTMLElement; tintsOf: LiquidKind | null; clarityRow: HTMLElement | null; makeTints(liquid: LiquidKind): void };
  private readonly waterInputs: { brush: HTMLInputElement; amount: HTMLInputElement; direction: HTMLInputElement; directionRow: HTMLElement; clarity: HTMLInputElement; tint: HTMLInputElement; tints: HTMLButtonElement[] };
  private readonly measureGroup: HTMLElement;
  private readonly measureButton: HTMLButtonElement;
  private readonly measureMenuButton: HTMLButtonElement;
  private readonly measurePanel: HTMLElement;
  private readonly measureDragButtons: Array<{ value: DragDistance; button: HTMLButtonElement }> = [];
  private readonly measureRulesButton: HTMLButtonElement;
  /** Atlas's two horizontal Measure bars above the main toolbar: modes on the left, Keep/Players/Look/Clear on the right. */
  private readonly measureBarsPanel: HTMLElement;
  private readonly measureModeButtons: Array<{ mode: MeasureMode; button: HTMLButtonElement }> = [];
  private readonly measureKeepButton: HTMLButtonElement;
  private readonly measurePlayersButton: HTMLButtonElement;
  private readonly measureLookTrigger: HTMLButtonElement;
  private readonly measureLookPanel: HTMLElement;
  private readonly measureLookSwatches: HTMLButtonElement[] = [];
  private readonly measureEffectButtons: Array<{ effect: MeasureEffect | null; button: HTMLButtonElement }> = [];
  private readonly measureClearButton: HTMLButtonElement;
  private measureLookOpen = false;
  private readonly templateMenuButton: HTMLButtonElement;
  private readonly templatePanel: HTMLElement;
  private readonly autoRollToggle: HTMLInputElement;
  private readonly laserButton: HTMLButtonElement;
  /** The lighting button, and the menu above it that chooses the board's lighting. */
  private readonly lightingGroup: HTMLElement;
  private readonly lightingButton: HTMLButtonElement;
  private readonly lightingPanel: HTMLElement;
  private readonly moveItem: HTMLButtonElement;
  private readonly laserItem: HTMLButtonElement;
  private readonly laserMenuButton: HTMLButtonElement;
  private readonly laserPanel: HTMLElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly slider: HTMLElement;
  private readonly sliderRange: HTMLElement;
  private readonly sliderThumb: HTMLElement;
  private readonly sizeValue: HTMLElement;
  private readonly heightInput: HTMLInputElement;
  private readonly thicknessInput: HTMLInputElement;
  private readonly snapToggles: { kind: 'tokens' | 'props'; input: HTMLInputElement }[] = [];
  private readonly edgeButtons: Array<{ value: WallEdges; button: HTMLButtonElement }> = [];
  private readonly layerButtons: Array<{ value: LayerLook; button: HTMLButtonElement }> = [];
  private readonly ambientInput: HTMLInputElement;
  private readonly ambientValue: HTMLElement;
  private readonly tintInput: HTMLInputElement;
  private readonly tintReset: HTMLButtonElement;
  private readonly forgetExploredButton: HTMLButtonElement | null = null;
  private readonly tiltInput: HTMLInputElement;
  private readonly occlusionInput: HTMLInputElement;
  /** Atlas's end slot, and the Dice button in it while the board has dice. */
  private readonly endSlot: HTMLElement;
  /** Atlas's GM view switch, at the bar's last place after "More tools" (its `end` control). */
  private readonly gmViewEnd: HTMLElement;
  private readonly gmViewSwitch: HTMLElement;
  private readonly peekButton: HTMLButtonElement;
  /** The peek button is held down (Atlas's `held`). */
  private peekHeld = false;
  private dice: EndButton | null = null;
  private diceLog: EndButton | null = null;
  private sheetHandlers: DiceButton | null = null;
  /** The cutscenes button and the live toggle, in the end slot after the dice buttons. */
  private cinema: { handlers: CinemaButtons; anchor: HTMLElement; live: HTMLButtonElement } | null = null;
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel.contains(target) && !this.button.contains(target)) this.close();
    if (!this.viewPanel.contains(target) && !this.viewButton.contains(target) && !this.seeThroughRing.contains(target)) {
      if (this.sizeMode && (target as Element | null)?.tagName === 'CANVAS') {
        this.trackOutsideCanvas(event);
      } else {
        this.closeView();
      }
    }
    if (!this.groundPanel.contains(target) && !this.groundButton.contains(target)) this.closeGround();
    if (!this.laserPanel.contains(target) && !this.laserMenuButton.contains(target)) this.closeLaser();
    if (!this.measurePanel.contains(target) && !this.measureMenuButton.contains(target)) this.closeMeasure();
    if (!this.templatePanel.contains(target) && !this.templateMenuButton.contains(target)) this.closeTemplate();
    if (!this.lightingPanel.contains(target) && !this.lightingButton.contains(target)) this.closeLighting();
    if (!this.paintPanel.contains(target) && !this.paintMenuButton.contains(target)) this.closePaint();
    if (this.openWaterPopoverName !== null) {
      const pop = this.waterPopovers[this.openWaterPopoverName];
      if (!pop.panel.contains(target) && !pop.trigger.contains(target)) this.closeWaterPopovers();
    }
    this.fogBars?.pressed(target);
    if (this.measureLookOpen && !this.measureLookPanel.contains(target) && !this.measureLookTrigger.contains(target)) {
      this.closeMeasureLook();
    }
    if (!this.moreMenu.contains(target) && !this.moreButton.contains(target)) this.closeMore();
  };
  private readonly onWaterKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.openWaterPopoverName === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeWaterPopovers();
  };
  private readonly onMeasureKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.measureLookOpen) return;
    event.preventDefault();
    event.stopPropagation();
    this.closeMeasureLook();
  };
  private readonly onOutsideMove = (event: PointerEvent): void => {
    const start = this.outsideCanvas;
    if (!start || event.pointerId !== start.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) this.cancelOutsideCanvas();
  };
  private readonly onOutsideUp = (event: PointerEvent): void => {
    const start = this.outsideCanvas;
    if (!start || event.pointerId !== start.pointerId) return;
    this.cancelOutsideCanvas();
    if (event.type === 'pointerup') this.closeView();
  };
  private readonly onSizeKey = (event: KeyboardEvent): void => {
    if (!this.sizeMode) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.setSizeMode(false);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    let direction = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') direction = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') direction = -1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.5 : 0.1;
    const current = this.actions.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE;
    const next = readSeeThroughSize(Math.round((current + direction * step) * 10) / 10);
    this.actions.setSeeThroughSize?.(next);
    this.updateSizeTooltip();
    this.seeThroughRing.sync();
  };

  constructor(container: HTMLElement, private readonly actions: ToolbarActions) {
    const doc = container.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
      const made = doc.win.createEl(tag);
      made.className = className;
      if (text !== undefined) made.textContent = text;
      parent.appendChild(made);
      return made;
    };

    // Atlas's own class names under a root of Tabletop's: its look is copied in styles.css, without needing its styles.
    this.row = el('div', 'atlas-tabletop-toolbar-row atlas-tabletop-atlas', container);
    this.viewTooltip = new AtlasTooltip(container);
    this.turnBannerHost = el('div', 'atlas-bottom-toolbar-row__above', this.row);
    this.turnBannerHost.setAttribute('aria-live', 'polite');
    // The main toolbar and, as in Atlas 0.17's bottom row, the bars beside it (the keyboard shortcuts bar at its end).
    const line = el('div', 'atlas-tabletop-bar-line', this.row);
    const bar = el('div', 'atlas-vtt-toolbar atlas-main-toolbar atlas-tabletop-toolbar', line);
    this.bar = bar;
    bar.setAttribute('role', 'toolbar');
    // Atlas's ToolButton: a wrapper, a span, and the button itself (a toolbar icon button).
    const toolIn = (parent: HTMLElement, svg: string, onClick: () => void): HTMLButtonElement => {
      const wrapper = el('div', 'atlas-tool-button', parent);
      const span = el('span', '', wrapper);
      span.setCssStyles({ display: 'inline-flex' });
      const made = el('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button', span);
      made.type = 'button';
      setSvg(made, svg);
      made.addEventListener('click', onClick);
      return made;
    };
    this.helpBar = el('div', 'atlas-vtt-toolbar atlas-hotkey-help-bar atlas-tabletop-help-bar', line);
    this.helpBar.hidden = true;
    this.helpButton = toolIn(this.helpBar, helpIcon(), () => this.help?.open());
    const tool = (svg: string, onClick: () => void): HTMLButtonElement => toolIn(bar, svg, onClick);
    // Atlas's Move/Select group: its face is the tool in use (the hand, or the flashlight while the laser is on), and a
    // click on it keeps that tool; the chevron opens the group's menu above it.
    // Atlas's undo/redo bar, first on the bar (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y).
    this.historyGroup = el('div', 'atlas-tool-group atlas-tabletop-history', bar);
    this.undoButton = this.registerButton('undo', toolIn(this.historyGroup, historyIcon('undo'), () => this.actions.undo?.()));
    this.undoButton.setAttribute('aria-label', TOOLBAR_BUTTONS.undo.label);
    this.setTip(this.undoButton, { label: 'Undo', shortcut: 'Ctrl/Cmd + Z' });
    this.redoButton = this.registerButton('redo', toolIn(this.historyGroup, historyIcon('redo'), () => this.actions.redo?.()));
    this.redoButton.setAttribute('aria-label', TOOLBAR_BUTTONS.redo.label);
    this.setTip(this.redoButton, { label: 'Redo', shortcut: 'Ctrl/Cmd + Shift + Z' });
    this.historyGroup.style.display = this.actions.undo ? '' : 'none';
    // The board's modes: Play (the game's tools) and Edit (walls, water, materials, the board's settings).
    this.modeGroup = el('div', 'atlas-tool-group atlas-tabletop-modes', bar);
    for (const [mode, label] of [['play', 'Play mode'], ['edit', 'Edit mode'], ['cinematic', 'Cinematic mode']] as const) {
      const button = this.registerButton(`mode-${mode}`, toolIn(this.modeGroup, modeIcon(mode), () => { if (this.actions.mode?.() !== mode) this.actions.setMode?.(mode); }));
      button.setAttribute('aria-label', label);
      this.setTip(button, { label, subtitle: mode === 'play' ? 'The game\'s tools' : mode === 'edit' ? 'Wall paint, water, and wall heights by Ctrl + drag' : 'Make and run cutscenes' });
      button.dataset.mode = mode;
      this.modeButtons.push({ mode, button });
    }
    const laserGroup = el('div', 'atlas-tool-group', bar);
    this.laserButton = this.registerButton('move', toolIn(laserGroup, HAND_SVG, () => this.actions.selectTool(this.actions.laserOn() ? 'laser' : 'move')));
    const menu = el('div', 'atlas-dropdown-menu', laserGroup);
    this.laserMenuButton = this.registerButton('move-options', el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', menu));
    this.laserMenuButton.type = 'button';
    setSvg(this.laserMenuButton, CHEVRON_SVG);
    this.laserMenuButton.setAttribute('aria-label', TOOLBAR_BUTTONS['move-options'].label);
    this.laserMenuButton.setAttribute('aria-expanded', 'false');
    this.setTip(this.laserMenuButton, { label: t('toolbar.moveOptions') });
    this.laserMenuButton.addEventListener('click', () => (this.laserPanel.hidden ? this.openLaser() : this.closeLaser()));

    // Atlas's laser options (`LaserPointerOptions`): the colour swatches with their hint, and the size slider.
    this.laserPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-laser-options', menu);
    this.laserPanel.hidden = true;
    // Atlas's two tools of the group, as its menu items: a check on the one in use, its icon, its name and key.
    const tools = el('div', 'atlas-dropdown-section', this.laserPanel);
    const item = (svg: string, label: string, choose: () => void): HTMLButtonElement => {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', tools);
      made.type = 'button';
      el('span', 'atlas-dropdown-menu-item__check', made);
      setSvg(made, svg, true);
      el('span', '', made, label);
      el('span', 'atlas-dropdown-menu-item__shortcut', made, MOVE_KEY);
      made.addEventListener('click', () => { choose(); this.closeLaser(); });
      return made;
    };
    this.moveItem = item(HAND_SVG, 'Move/Select', () => this.actions.selectTool('move'));
    this.laserItem = item(LASER_SVG, 'Laser Pointer', () => this.actions.selectTool('laser'));
    const section = el('div', 'atlas-dropdown-section', this.laserPanel);
    const swatchGroup = el('div', 'atlas-dropdown-swatches', section);
    swatchGroup.setAttribute('role', 'group');
    swatchGroup.setAttribute('aria-label', 'Laser colour');
    el('span', 'atlas-dropdown-swatches__label', swatchGroup, 'Laser colour');
    const grid = el('div', 'atlas-swatch-grid', swatchGroup);
    for (const swatch of LASER_COLORS) {
      const button = el('button', 'atlas-swatch', grid);
      button.type = 'button';
      button.style.backgroundColor = swatch.value;
      button.setAttribute('aria-label', swatch.label);
      this.setTip(button, { label: swatch.label });
      button.dataset.value = swatch.value;
      button.addEventListener('click', () => { this.actions.setLaser({ color: swatch.value }); this.showLaser(); });
      this.swatches.push(button);
    }
    el('span', 'atlas-dropdown-swatches__hint', swatchGroup, LASER_COLOR_HINT);
    const sliderRow = el('div', 'atlas-dropdown-slider-row', section);
    const head = el('div', 'atlas-dropdown-slider-row__head', sliderRow);
    el('span', 'atlas-dropdown-label', head, 'Laser size');
    this.sizeValue = el('span', 'atlas-dropdown-slider-row__value', head);
    this.slider = el('span', 'slider-root', sliderRow);
    const track = el('span', 'slider-track', this.slider);
    this.sliderRange = el('span', 'slider-range', track);
    const thumbPlace = el('span', 'atlas-tabletop-slider-thumb-place', this.slider);
    this.sliderThumb = el('span', 'slider-thumb', thumbPlace);
    this.sliderThumb.setAttribute('role', 'slider');
    this.sliderThumb.setAttribute('aria-label', 'Laser size');
    this.sliderThumb.setAttribute('aria-valuemin', String(LASER_SIZE_MIN));
    this.sliderThumb.setAttribute('aria-valuemax', String(LASER_SIZE_MAX));
    this.sliderThumb.tabIndex = 0;
    const setSize = (size: number): void => {
      const value = Math.round(Math.min(LASER_SIZE_MAX, Math.max(LASER_SIZE_MIN, size)));
      if (value === this.actions.laser().size) return;
      this.actions.setLaser({ size: value });
      this.showLaser();
    };
    const fromPointer = (event: PointerEvent): void => {
      const rect = this.slider.getBoundingClientRect();
      // The thumb's centre travels within the track, half a thumb in from each end.
      const share = (event.clientX - rect.left - THUMB_PX / 2) / Math.max(1, rect.width - THUMB_PX);
      setSize(LASER_SIZE_MIN + Math.min(1, Math.max(0, share)) * (LASER_SIZE_MAX - LASER_SIZE_MIN));
    };
    this.slider.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.slider.setPointerCapture?.(event.pointerId);
      this.sliderThumb.focus();
      fromPointer(event);
    });
    this.slider.addEventListener('pointermove', (event) => { if (this.slider.hasPointerCapture?.(event.pointerId)) fromPointer(event); });
    this.sliderThumb.addEventListener('keydown', (event) => {
      const size = this.actions.laser().size;
      const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      if (event.key in steps) setSize(size + steps[event.key]);
      else if (event.key === 'Home') setSize(LASER_SIZE_MIN);
      else if (event.key === 'End') setSize(LASER_SIZE_MAX);
      else return;
      event.preventDefault();
    });
    this.laserPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeLaser(); }
    });
    // Connect's Template tool, as its player toolbar has it: the tool, and a chevron to its shapes and to clearing them.
    // Atlas 0.18's fog tool: one button right after Move/Select, as Atlas's toolbar has it; while it is on, two bars float above the toolbar.
    this.fogGroup = el('div', 'atlas-tool-group atlas-tabletop-fog-group', bar);
    this.fogButton = this.registerButton('fog', toolIn(this.fogGroup, fogIcon('fog'), () => {
      const fog = this.actions.fog;
      if (!fog) return;
      if (fog.state().on) {
        fog.stop();
      } else {
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeMore();
        fog.start();
      }
      this.refresh();
    }));
    this.fogButton.setAttribute('aria-label', at('toolbar.fogTool'));
    this.fogButton.setAttribute('aria-expanded', 'false');
    this.viewTooltip.attach(this.fogButton.parentElement!, () => {
      const eraser = this.actions.fog?.state().mode === 'eraser';
      const shortcut = this.actions.fog?.hotkey();
      return { label: eraser ? at('toolbar.fogEraser') : at('toolbar.fogTool'), ...(shortcut ? { shortcut } : {}) };
    });
    this.fogBars = this.actions.fog ? new FogToolBars(this.row, el, this.viewTooltip, this.actions.fog, () => this.refresh(), (open) => { if (open) this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true); else this.dropOutsideIfClosed(); }) : null;
    this.fogGroup.style.display = this.actions.fog ? '' : 'none';
    // Atlas's Measure tool group (`MeasureToolGroup.tsx`): face shows the active mode, chevron opens drag distance & rules.
    this.measureGroup = el('div', 'atlas-tool-group', bar);
    this.measureButton = this.registerButton('measure', toolIn(this.measureGroup, atlasMeasureIcon('ruler'), () => {
      if (this.actions.measureOn?.()) {
        this.actions.selectMeasure?.(null);
        this.closeMeasureLook();
      } else {
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeDice();
        this.closeMore();
        const mode = this.measureOptions().mode;
        this.actions.selectMeasure?.(isMeasureShape(mode) ? mode : 'ruler');
      }
      this.refresh();
    }));
    this.measureButton.setAttribute('aria-label', TOOLBAR_BUTTONS.measure.label);
    this.viewTooltip.attach(this.measureButton.parentElement!, () => {
      const shortcut = this.actions.measureShortcut?.();
      return { label: TOOLBAR_BUTTONS.measure.label, ...(shortcut ? { shortcut } : {}) };
    });
    const measureMenu = el('div', 'atlas-dropdown-menu', this.measureGroup);
    this.measureMenuButton = this.registerButton('measure-options', el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', measureMenu));
    this.measureMenuButton.type = 'button';
    setSvg(this.measureMenuButton, CHEVRON_SVG);
    this.measureMenuButton.setAttribute('aria-label', t('toolbar.measureOptions'));
    this.measureMenuButton.setAttribute('aria-expanded', 'false');
    this.viewTooltip.attach(this.measureMenuButton, () => ({ label: t('toolbar.measureOptions') }));
    // Atlas styles its menus' segmented choices (the track, the chosen one's pill) inside its plugin scope only.
    this.measurePanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-vtt-plugin atlas-tabletop-measure-options', measureMenu);
    this.measurePanel.hidden = true;
    const dragSection = el('div', 'atlas-dropdown-section', this.measurePanel);
    const dragStack = el('div', 'atlas-dropdown-stack', dragSection);
    const dragControl = el('div', 'atlas-segmented', dragStack);
    dragControl.setAttribute('role', 'radiogroup');
    dragControl.setAttribute('aria-label', t('toolbar.dragDistance'));
    for (const [value, label] of [
      ['always', t('toolbar.dragDistanceAlways')],
      ['combat', t('toolbar.dragDistanceCombat')],
      ['never', t('toolbar.dragDistanceNever')],
    ] as const) {
      const choice = el('button', 'btn btn--ghost atlas-segmented__option', dragControl, label);
      choice.type = 'button';
      choice.setAttribute('role', 'radio');
      choice.dataset.dragDistance = value;
      choice.addEventListener('click', () => {
        this.actions.setDragDistance?.(value);
        this.refresh();
      });
      this.measureDragButtons.push({ value, button: choice });
    }
    // As Atlas's menu: the choices, then what they are for beneath them.
    const dragHint = el('p', 'atlas-dropdown-hint', dragStack, t('toolbar.dragDistance'));
    dragHint.setAttribute('aria-hidden', 'true');
    const rulesSection = el('div', 'atlas-dropdown-section', this.measurePanel);
    this.measureRulesButton = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', rulesSection);
    this.measureRulesButton.type = 'button';
    this.measureRulesButton.dataset.measureAction = 'rules';
    setSvg(this.measureRulesButton, atlasMeasureControlIcon('rules'), true);
    el('span', '', this.measureRulesButton, t('toolbar.measureRules'));
    this.measureRulesButton.addEventListener('click', () => {
      if (this.measureRulesButton.disabled) return;
      this.actions.openMeasureRules?.();
      this.closeMeasure();
    });
    this.measurePanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeMeasure(); }
    });
    this.measureMenuButton.addEventListener('click', () => (this.measurePanel.hidden ? this.openMeasure() : this.closeMeasure()));
    this.measureGroup.style.display = this.actions.selectMeasure ? '' : 'none';

    // Atlas's two horizontal Measure bars above the main toolbar (`MeasureToolBar.tsx`).
    this.measureBarsPanel = el('div', 'atlas-tool-bars atlas-tabletop-measure-bars', this.row);
    this.measureBarsPanel.hidden = true;
    const measureModesBar = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--modes atlas-tabletop-measure-bar', this.measureBarsPanel);
    measureModesBar.setAttribute('role', 'toolbar');
    measureModesBar.setAttribute('aria-label', t('toolbar.measureModes'));
    const measureModeLabel: Record<MeasureMode, string> = {
      ruler: t('toolbar.ruler'),
      circle: t('toolbar.circle'),
      cone: t('toolbar.cone'),
      square: t('measure.shape.square'),
      line: t('measure.shape.line'),
      ranges: t('toolbar.ranges'),
    };
    for (const mode of MEASURE_MODES) {
      const made = toolIn(measureModesBar, atlasMeasureIcon(mode), () => {
        if (made.disabled || !isMeasureShape(mode)) return;
        this.actions.setMeasureOptions?.({ mode });
        this.actions.selectMeasure?.(mode);
        this.refresh();
      });
      made.dataset.measureMode = mode;
      made.setAttribute('aria-label', measureModeLabel[mode]);
      this.viewTooltip.attach(made.parentElement!, () => {
        if (mode !== 'ranges') return { label: measureModeLabel[mode] };
        const why = this.actions.rangesUnavailable?.() ?? t('toolbar.rangesNoRules');
        return { label: measureModeLabel[mode], subtitle: why ?? t('toolbar.rangesTip') };
      });
      this.measureModeButtons.push({ mode, button: made });
    }
    const measureToolsBar = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--tools atlas-tabletop-measure-bar', this.measureBarsPanel);
    measureToolsBar.setAttribute('role', 'toolbar');
    measureToolsBar.setAttribute('aria-label', t('toolbar.measureChoices'));
    this.measureKeepButton = toolIn(measureToolsBar, atlasMeasureControlIcon('pin'), () => {
      this.actions.setMeasureOptions?.({ keep: !this.measureOptions().keep });
      this.refresh();
    });
    this.measureKeepButton.classList.add('atlas-tool-bar__choice');
    this.measureKeepButton.dataset.measureChoice = 'keep';
    this.measureKeepButton.setAttribute('aria-label', t('toolbar.measureKeep'));
    this.viewTooltip.attach(this.measureKeepButton.parentElement!, () => {
      const shortcut = this.actions.measureKeepShortcut?.();
      return { label: t('toolbar.measureKeep'), subtitle: t('toolbar.measureKeepTip'), ...(shortcut ? { shortcut } : {}) };
    });
    this.measurePlayersButton = toolIn(measureToolsBar, atlasMeasureControlIcon('eye'), () => {
      this.actions.setMeasureOptions?.({ players: !this.measureOptions().players });
      this.refresh();
    });
    this.measurePlayersButton.classList.add('atlas-tool-bar__choice');
    this.measurePlayersButton.dataset.measureChoice = 'players';
    this.measurePlayersButton.setAttribute('aria-label', t('toolbar.measurePlayers'));
    this.viewTooltip.attach(this.measurePlayersButton.parentElement!, () => ({ label: t('toolbar.measurePlayers') }));

    // Look popover: colour swatches (accent first, map colours without black) + effect chips.
    const lookMenu = el('div', 'atlas-dropdown-menu atlas-tabletop-measure-look-anchor', measureToolsBar);
    const lookWrap = el('div', 'atlas-tool-button', lookMenu);
    const lookSpan = el('span', '', lookWrap);
    lookSpan.setCssStyles({ display: 'inline-flex' });
    this.measureLookTrigger = el('button', 'btn btn--ghost btn--icon btn--toolbar atlas-tabletop-tool-button', lookSpan);
    this.measureLookTrigger.type = 'button';
    this.measureLookTrigger.dataset.measureChoice = 'look';
    this.measureLookTrigger.setAttribute('aria-label', t('measure.look'));
    this.measureLookTrigger.setAttribute('aria-expanded', 'false');
    this.measureLookTrigger.addEventListener('click', () => this.toggleMeasureLook());
    this.viewTooltip.attach(lookSpan, () => ({ label: t('measure.look') }));
    this.measureLookPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-tabletop-measure-look-popover', lookMenu);
    this.measureLookPanel.hidden = true;
    this.measureLookPanel.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.measureLookPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeMeasureLook(); }
    });
    const lookSection = el('div', 'atlas-dropdown-section', this.measureLookPanel);
    const colorSwatches = el('div', 'atlas-dropdown-swatches', lookSection);
    colorSwatches.setAttribute('role', 'group');
    colorSwatches.setAttribute('aria-label', t('toolbar.colour'));
    el('span', 'atlas-dropdown-swatches__label', colorSwatches, t('toolbar.colour'));
    const colorGrid = el('div', 'atlas-swatch-grid', colorSwatches);
    for (const swatch of MEASURE_COLOR_SWATCHES) {
      const label = t(swatch.labelKey);
      const made = el('button', 'atlas-swatch', colorGrid);
      made.type = 'button';
      made.style.backgroundColor = swatch.value;
      made.dataset.swatch = swatch.value;
      made.setAttribute('aria-label', label);
      this.viewTooltip.attach(made, () => ({ label }));
      made.addEventListener('click', () => {
        this.actions.setMeasureOptions?.({ color: measureColorOfSwatch(swatch.value) });
        this.closeMeasureLook();
        this.refresh();
      });
      this.measureLookSwatches.push(made);
    }
    const effectSwatches = el('div', 'atlas-dropdown-swatches', lookSection);
    el('span', 'atlas-dropdown-swatches__label', effectSwatches, t('measure.effect'));
    const effectGrid = el('div', 'atlas-light-popover__kinds atlas-light-popover__kinds--square', effectSwatches);
    effectGrid.setAttribute('role', 'group');
    effectGrid.setAttribute('aria-label', t('measure.effect'));
    const effectNames: Record<MeasureEffect, string> = {
      fire: t('measure.effect.fire'),
      frost: t('measure.effect.frost'),
      lightning: t('measure.effect.lightning'),
      mist: t('measure.effect.mist'),
      radiance: t('measure.effect.radiance'),
      shadow: t('measure.effect.shadow'),
    };
    for (const effect of [null, ...MEASURE_EFFECTS] as const) {
      const name = effect ? effectNames[effect] : t('measure.effect.none');
      const made = el('button', 'atlas-light-kind', effectGrid);
      made.type = 'button';
      made.dataset.measureEffect = effect ?? 'none';
      made.setAttribute('aria-label', name);
      setSvg(made, atlasMeasureEffectIcon(effect ?? 'none'));
      this.viewTooltip.attach(made, () => ({ label: name }));
      made.addEventListener('click', () => {
        const current = this.measureOptions();
        if (effect === null) {
          this.actions.setMeasureOptions?.({ effect: null });
        } else {
          this.actions.setMeasureOptions?.({ effect, color: colourWithEffect(current.color, current.effect, effect) });
        }
        // Selecting an effect leaves the Look dropdown open so the user can adjust the colour.
        this.refresh();
      });
      this.measureEffectButtons.push({ effect, button: made });
    }

    this.measureClearButton = toolIn(measureToolsBar, atlasMeasureControlIcon('trash'), () => {
      if (this.measureClearButton.disabled) return;
      this.actions.clearMeasures?.();
      this.refresh();
    });
    this.measureClearButton.dataset.measureChoice = 'clear';
    this.measureClearButton.setAttribute('aria-label', t('toolbar.measureClear'));
    this.viewTooltip.attach(this.measureClearButton.parentElement!, () => {
      const anyKept = this.actions.hasKeptMeasures?.() === true;
      const levelled = this.actions.hasLevels?.() === true;
      const subtitle = anyKept
        ? (levelled ? t('toolbar.measureClearTip') : t('toolbar.measureClearAllTip'))
        : (levelled ? t('toolbar.measureNothingKeptOnLevel') : t('toolbar.measureNothingKept'));
      return { label: t('toolbar.measureClear'), subtitle };
    });

    // The water brush: single button on the main toolbar; while active, Fog-style horizontal bars float above the toolbar.
    this.waterGroup = el('div', 'atlas-tool-group', bar);
    this.waterButton = this.registerButton('water', toolIn(this.waterGroup, waterIcon('tool'), () => {
      if (this.actions.waterTool?.()) {
        this.actions.setWaterTool?.(null);
        this.closeWater();
      } else {
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeMore();
        this.actions.setWaterTool?.(this.lastWaterMode);
      }
      this.refresh();
    }));
    this.waterButton.setAttribute('aria-label', TOOLBAR_BUTTONS.water.label);
    this.waterButton.setAttribute('aria-expanded', 'false');
    this.viewTooltip.attach(this.waterButton.parentElement!, () => {
      const liquid = this.actions.liquid?.() ?? 'water';
      return { label: LIQUID_NAMES[liquid], subtitle: 'Paint, fill or erase water, lava and acid' };
    });
    // Fog-style two-pill tool bar above the main toolbar: liquids on the left (filled), tools & popovers on the right (tinted).
    this.waterPanel = el('div', 'atlas-tool-bars atlas-tabletop-water-bars atlas-tabletop-water-options', this.row);
    this.waterPanel.hidden = true;
    const liquidBar = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--modes atlas-tabletop-water-bar', this.waterPanel);
    liquidBar.setAttribute('role', 'toolbar');
    liquidBar.setAttribute('aria-label', 'Liquid');
    const liquidSubtitles: Record<LiquidKind, string> = {
      water: 'Clear flowing water',
      lava: 'Glowing molten lava',
      acid: 'Bubbling caustic acid',
    };
    for (const liquid of LIQUID_KINDS) {
      const made = toolIn(liquidBar, waterIcon(liquid), () => {
        this.actions.setLiquid?.(liquid);
        this.refresh();
      });
      made.dataset.liquid = liquid;
      made.setAttribute('aria-label', LIQUID_NAMES[liquid]);
      this.viewTooltip.attach(made.parentElement!, () => ({ label: LIQUID_NAMES[liquid], subtitle: liquidSubtitles[liquid] }));
    }
    const toolsBar = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--tools atlas-tabletop-water-bar', this.waterPanel);
    toolsBar.setAttribute('role', 'toolbar');
    toolsBar.setAttribute('aria-label', 'Liquid tools');
    const modeButtons = new Map<string, HTMLButtonElement>();
    for (const [mode, label, tip, shortcut] of [
      ['paint', 'Paint water', 'Drag on the map to paint', 'Alt to erase'],
      ['fill', 'Fill water', 'Click an area to fill it · Shift + click dries', undefined],
      ['erase', 'Erase liquids', 'Drag to remove any painted liquid', undefined],
    ] as const) {
      const made = toolIn(toolsBar, waterIcon(mode), () => {
        this.lastWaterMode = mode;
        this.actions.setWaterTool?.(mode);
        this.refresh();
      });
      made.classList.add('atlas-tool-bar__choice');
      made.dataset.water = mode;
      made.setAttribute('aria-label', label);
      modeButtons.set(mode, made);
      this.viewTooltip.attach(made.parentElement!, () => {
        const name = LIQUID_NAMES[this.actions.liquid?.() ?? 'water'].toLowerCase();
        const currentLabel = mode === 'erase' ? 'Erase liquids' : `${mode === 'paint' ? 'Paint' : 'Fill'} ${name}`;
        return { label: currentLabel, subtitle: tip, ...(shortcut ? { shortcut } : {}) };
      });
    }
    const waterSep = el('div', 'atlas-tabletop-view-bar__sep', toolsBar);
    waterSep.setAttribute('aria-hidden', 'true');
    const makePopover = (
      name: 'brush' | 'tint' | 'motion',
      ariaLabel: string,
      align: 'center' | 'right',
    ): { trigger: HTMLButtonElement; panel: HTMLElement } => {
      const menu = el('div', 'atlas-dropdown-menu atlas-tabletop-water-popover-anchor', toolsBar);
      const wrap = el('div', 'atlas-tool-button', menu);
      const span = el('span', '', wrap);
      const trigger = el('button', 'btn btn--ghost btn--icon btn--toolbar atlas-tabletop-tool-button atlas-tool-bar__choice', span);
      trigger.type = 'button';
      trigger.dataset.waterPopover = name;
      trigger.setAttribute('aria-label', ariaLabel);
      trigger.setAttribute('aria-expanded', 'false');
      trigger.addEventListener('click', () => this.toggleWaterPopover(name));
      const alignClass = align === 'right' ? 'atlas-dropdown-content--right' : 'atlas-tabletop-water-popover--center';
      const panel = el('div', `atlas-dropdown-content atlas-dropdown-content--top ${alignClass} atlas-tabletop-water-popover atlas-tabletop-water-popover--${name}`, menu);
      panel.hidden = true;
      panel.addEventListener('pointerdown', (event) => event.stopPropagation());
      panel.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); this.closeWaterPopovers(); }
      });
      return { trigger, panel };
    };
    const slider = (parent: HTMLElement, label: string, min: number, max: number, step: number): { input: HTMLInputElement; row: HTMLElement; value: HTMLElement } => {
      const row = el('label', 'atlas-tabletop-water-slider', parent);
      const head = el('div', 'atlas-tabletop-water-slider__head', row);
      el('span', 'atlas-tabletop-palette__label', head, label);
      const value = el('span', 'atlas-tabletop-water-slider__value', head, '');
      const input = el('input', 'atlas-tabletop-palette__range', row);
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.setAttribute('aria-label', label);
      return { input, row, value };
    };
    // Popover 1: Brush size (growing dot, matching Atlas's FogToolBar) + Fill sensitivity.
    const brushPop = makePopover('brush', 'Brush size and fill sensitivity', 'center');
    this.waterSizeDot = el('span', 'atlas-fog-size-dot', brushPop.trigger);
    this.viewTooltip.attach(brushPop.trigger.parentElement!, () => {
      if (this.actions.waterTool?.() === 'fill') {
        return { label: 'Fill sensitivity', subtitle: `${Math.round(this.actions.waterFill?.() ?? 30)}% · Shift + click dries` };
      }
      const size = this.actions.waterBrush?.() ?? 1;
      return { label: 'Brush size', subtitle: `${size} ${size === 1 ? 'square' : 'squares'}`, shortcut: 'Ctrl+Scroll' };
    });
    const brushSection = el('div', 'atlas-dropdown-section atlas-tabletop-water-sliders', brushPop.panel);
    const brush = slider(brushSection, 'Brush size', 0.25, 6, 0.25);
    brush.input.addEventListener('input', () => {
      this.actions.setWaterBrush?.(Number(brush.input.value));
      this.syncWaterBar();
    });
    // The bucket: how near a colour must be to the one clicked to be filled with it.
    const fill = slider(brushSection, 'Fill sensitivity', 0, 100, 1);
    this.setTip(fill.row, { label: 'Fill sensitivity', subtitle: 'How far from the colour clicked the bucket spreads (Shift + click dries)' });
    fill.input.addEventListener('input', () => {
      this.actions.setWaterFill?.(Number(fill.input.value));
      this.syncWaterBar();
    });
    this.waterFillInput = fill.input;
    // Popover 2: Tint & clarity (colour dot icon, matching Atlas's DrawToolBar).
    const tintPop = makePopover('tint', 'Tint and clarity', 'center');
    this.waterTintDot = el('span', 'atlas-tool-bar__dot', tintPop.trigger);
    this.viewTooltip.attach(tintPop.trigger.parentElement!, () => {
      const name = LIQUID_NAMES[this.actions.liquid?.() ?? 'water'].toLowerCase();
      return { label: 'Tint & clarity', subtitle: `All ${name} on this map` };
    });
    const change = (patch: Partial<WaterMotion>): void => { const current = this.actions.waterMotion?.(); if (current) this.actions.setWaterMotion?.({ ...current, ...patch }); };
    const look = el('div', 'atlas-dropdown-section', tintPop.panel);
    const tintGroup = el('div', 'atlas-dropdown-swatches', look);
    tintGroup.setAttribute('role', 'group');
    tintGroup.setAttribute('aria-label', 'Water tint');
    const tintLabel = el('span', 'atlas-dropdown-swatches__label', tintGroup, 'Tint (all water on this map)');
    const tintGrid = el('div', 'atlas-swatch-grid', tintGroup);
    const tints: HTMLButtonElement[] = [];
    // The swatches are the liquid's own presets: made again when the brush's liquid changes.
    const makeTints = (liquid: LiquidKind): void => {
      this.forgetTips(tintGrid);
      tintGrid.replaceChildren();
      tints.length = 0;
      for (const preset of LIQUID_TINTS[liquid]) {
        const button = el('button', 'atlas-swatch', tintGrid);
        button.type = 'button';
        button.style.backgroundColor = preset.tint;
        button.setAttribute('aria-label', preset.name);
        this.setTip(button, { label: preset.name });
        button.dataset.tint = preset.tint;
        button.addEventListener('click', () => { change({ tint: preset.tint }); this.refresh(); });
        tints.push(button);
      }
    };
    makeTints('water');
    const tintRow = el('label', 'atlas-tabletop-palette__field atlas-tabletop-water-tint-row', look);
    el('span', 'atlas-tabletop-palette__label', tintRow, 'Custom tint');
    const waterTint = el('input', 'atlas-tabletop-palette__color', tintRow);
    waterTint.type = 'color';
    waterTint.setAttribute('aria-label', 'Custom tint');
    waterTint.addEventListener('input', () => { change({ tint: waterTint.value.toLowerCase() }); this.refresh(); });
    const claritySection = el('div', 'atlas-dropdown-section atlas-tabletop-water-sliders', tintPop.panel);
    const clarity = slider(claritySection, 'Clarity', 0, 100, 1);
    clarity.input.addEventListener('input', () => { change({ clarity: Number(clarity.input.value) / 100 }); this.syncWaterBar(); });
    // Popover 3: Motion, movement, flow direction & lava type (More `...`, matching Atlas's FogToolBar).
    const motionPop = makePopover('motion', 'Motion and style', 'right');
    setSvg(motionPop.trigger, waterIcon('more'));
    this.viewTooltip.attach(motionPop.trigger.parentElement!, () => {
      const liquid = this.actions.liquid?.() ?? 'water';
      const current = this.actions.waterMotion?.();
      const label = current ? MOTION_LABELS[liquid][current.kind] : 'Motion';
      const detail = liquid === 'lava'
        ? (LAVA_STYLES.find((s) => s.value === (current?.style ?? 'crust'))?.label ?? 'Crusted flow')
        : `${Math.round((current?.amount ?? 0.5) * 100)}%`;
      return { label: 'Motion & style', subtitle: `${label} · ${detail}` };
    });
    const motion = el('div', 'atlas-dropdown-section', motionPop.panel);
    const motionLabel = el('div', 'atlas-dropdown-label', motion, 'Motion (all water on this map)');
    const motionNames = new Map<WaterMotionKind, HTMLElement>();
    for (const kind of WATER_MOTION_KINDS) {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', motion);
      made.type = 'button';
      made.dataset.motion = kind;
      el('span', 'atlas-dropdown-menu-item__check', made);
      motionNames.set(kind, el('span', '', made, MOTION_LABELS.water[kind]));
      made.addEventListener('click', () => {
        const current = this.actions.waterMotion?.();
        if (current) this.actions.setWaterMotion?.({ ...current, kind });
        this.refresh();
      });
    }
    const motionSection = el('div', 'atlas-dropdown-section atlas-tabletop-water-sliders', motionPop.panel);
    const amount = slider(motionSection, 'Movement', 0, 100, 1);
    amount.input.addEventListener('input', () => { const current = this.actions.waterMotion?.(); if (current) this.actions.setWaterMotion?.({ ...current, amount: Number(amount.input.value) / 100 }); this.syncWaterBar(); });
    const direction = slider(motionSection, 'Flow direction', 0, 359, 1);
    direction.input.addEventListener('input', () => { const current = this.actions.waterMotion?.(); if (current) this.actions.setWaterMotion?.({ ...current, direction: Number(direction.input.value) }); this.syncWaterBar(); });
    // What kind of lava the brush paints (shown while it paints lava).
    const lavaStyles = el('div', 'atlas-dropdown-section atlas-tabletop-lava-styles', motionPop.panel);
    el('div', 'atlas-dropdown-label', lavaStyles, 'Lava type');
    for (const style of LAVA_STYLES) {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', lavaStyles);
      made.type = 'button';
      made.dataset.lavaStyle = style.value;
      this.setTip(made, { label: style.label, subtitle: style.hint });
      el('span', 'atlas-dropdown-menu-item__check', made);
      el('span', '', made, style.label);
      made.addEventListener('click', () => {
        const current = this.actions.waterMotion?.();
        if (current) this.actions.setWaterMotion?.({ ...current, style: style.value });
        this.refresh();
      });
    }
    this.waterPopovers = { brush: brushPop, tint: tintPop, motion: motionPop };
    this.waterValues = { brush: brush.value, fill: fill.value, amount: amount.value, direction: direction.value, clarity: clarity.value };
    this.liquidUi = { modes: modeButtons, motions: motionNames, motionLabel, tintLabel, tintGrid, tintsOf: 'water', clarityRow: clarity.row, makeTints };
    this.waterInputs = { brush: brush.input, amount: amount.input, direction: direction.input, directionRow: direction.row, clarity: clarity.input, tint: waterTint, tints };
    this.waterGroup.style.display = this.actions.setWaterTool ? '' : 'none';
    // Wall paint: a click paints the wall under it with the material chosen (Shift: the whole wall), until Esc or a right-click.
    // The Shapes tool: corners on the level's floor, each at its own height (roofs, hills).
    this.shapeGroup = el('div', 'atlas-tool-group', bar);
    this.shapeButton = this.registerButton('shapes', toolIn(this.shapeGroup, SHAPES_SVG, () => { this.actions.setShapeTool?.(this.actions.shapeTool?.() !== true); this.refresh(); }));
    this.shapeButton.setAttribute('aria-label', TOOLBAR_BUTTONS.shapes.label);
    this.setTip(this.shapeButton, { label: TOOLBAR_BUTTONS.shapes.label, subtitle: 'Draw roofs and hills corner by corner, each corner at its own height' });
    this.shapeGroup.style.display = this.actions.setShapeTool ? '' : 'none';
    this.paintGroup = el('div', 'atlas-tool-group', bar);
    this.paintButton = this.registerButton('paint', toolIn(this.paintGroup, modeIcon('paint'), () => {
      if (this.actions.painting?.()) this.actions.setPainting?.(null);
      else if (this.lastPaint) this.actions.setPainting?.(this.lastPaint);
      else this.openPaint();
      this.refresh();
    }));
    this.paintButton.setAttribute('aria-label', TOOLBAR_BUTTONS.paint.label);
    this.setTip(this.paintButton, { label: TOOLBAR_BUTTONS.paint.label, subtitle: 'Paint walls with a material (Esc or right-click stops)' });
    const paintMenu = el('div', 'atlas-dropdown-menu', this.paintGroup);
    this.paintMenuButton = this.registerButton('paint-options', el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', paintMenu));
    this.paintMenuButton.type = 'button';
    setSvg(this.paintMenuButton, CHEVRON_SVG);
    this.paintMenuButton.setAttribute('aria-label', TOOLBAR_BUTTONS['paint-options'].label);
    this.setTip(this.paintMenuButton, { label: TOOLBAR_BUTTONS['paint-options'].label });
    this.paintPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-paint-options', paintMenu);
    this.paintPanel.hidden = true;
    this.paintMenuButton.addEventListener('click', () => (this.paintPanel.hidden ? this.openPaint() : this.closePaint()));
    this.paintPanel.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closePaint(); } });
    this.paintGroup.style.display = this.actions.setPainting ? '' : 'none';
    this.templateGroup = el('div', 'atlas-tool-group', bar);
    this.templateButton = this.registerButton('template', toolIn(this.templateGroup, TEMPLATE_SVG, () => this.actions.selectTemplate(this.actions.templateOn() ? null : this.actions.templateShape())));
    this.templateButton.setAttribute('aria-label', TOOLBAR_BUTTONS.template.label);
    this.setTip(this.templateButton, { label: TOOLBAR_BUTTONS.template.label, subtitle: 'Players see it' });
    const templateMenu = el('div', 'atlas-dropdown-menu', this.templateGroup);
    this.templateMenuButton = this.registerButton('template-options', el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', templateMenu));
    this.templateMenuButton.type = 'button';
    setSvg(this.templateMenuButton, CHEVRON_SVG);
    this.templateMenuButton.setAttribute('aria-label', TOOLBAR_BUTTONS['template-options'].label);
    this.setTip(this.templateMenuButton, { label: TOOLBAR_BUTTONS['template-options'].label });
    this.templatePanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-template-options', templateMenu);
    this.templatePanel.hidden = true;
    const shapes = el('div', 'atlas-dropdown-section', this.templatePanel);
    const entry = (parent: HTMLElement, svg: string, label: string, choose: () => void, shape?: string): void => {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', parent);
      made.type = 'button';
      if (shape) made.dataset.shape = shape;
      el('span', 'atlas-dropdown-menu-item__check', made);
      setSvg(made, svg, true);
      el('span', '', made, label);
      made.addEventListener('click', () => { choose(); this.closeTemplate(); });
    };
    for (const [shape, label, svg] of TEMPLATE_SHAPES) entry(shapes, svg, label, () => this.actions.selectTemplate(shape), shape);
    entry(el('div', 'atlas-dropdown-section', this.templatePanel), ERASER_SVG, 'Clear templates', () => this.actions.clearTemplates());
    this.templateMenuButton.addEventListener('click', () => (this.templatePanel.hidden ? this.openTemplate() : this.closeTemplate()));
    // The board's lighting, chosen here: the classic look or the painted one under a dusk, day or night sky.
    this.lightingGroup = el('div', 'atlas-dropdown-menu', bar);
    this.lightingButton = this.registerButton('lighting', toolIn(this.lightingGroup, LIGHTING_ICONS.classic, () => (this.lightingPanel.hidden ? this.openLighting() : this.closeLighting())));
    this.lightingButton.setAttribute('aria-expanded', 'false');
    this.lightingPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-lighting-options', this.lightingGroup);
    this.lightingPanel.hidden = true;
    this.lightingPanel.setAttribute('role', 'menu');
    const choices = el('div', 'atlas-dropdown-section', this.lightingPanel);
    for (const choice of LIGHTING_ORDER) {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', choices);
      made.type = 'button';
      made.dataset.lighting = choice;
      el('span', 'atlas-dropdown-menu-item__check', made);
      setSvg(made, LIGHTING_ICONS[choice], true);
      el('span', '', made, lightingLabel(choice));
      made.addEventListener('click', () => { this.actions.setLighting(choice); this.closeLighting(); this.refresh(); });
    }
    // The board's own daylight: in the dark only Atlas's lights show the map.
    const light = el('div', 'atlas-tabletop-palette__section atlas-tabletop-lighting-extra', this.lightingPanel);
    const ambient = el('label', 'atlas-tabletop-palette__field', light);
    el('span', 'atlas-tabletop-palette__label', ambient, t('lighting.ambient'));
    this.ambientInput = el('input', 'atlas-tabletop-palette__range', ambient);
    this.ambientInput.type = 'range';
    this.ambientInput.min = '0';
    this.ambientInput.max = '100';
    this.ambientInput.step = '1';
    this.ambientInput.setAttribute('aria-label', t('lighting.ambient'));
    this.ambientValue = el('span', 'atlas-tabletop-palette__unit', ambient, '');
    el('div', 'atlas-tabletop-palette__hint', light, t('lighting.ambientHint'));
    // A tint over the daylight, with a button that takes it off.
    const tint = el('label', 'atlas-tabletop-palette__field', light);
    el('span', 'atlas-tabletop-palette__label', tint, t('lighting.tint'));
    this.tintInput = el('input', 'atlas-tabletop-palette__color', tint);
    this.tintInput.type = 'color';
    this.tintInput.setAttribute('aria-label', t('lighting.tint'));
    this.tintReset = el('button', 'atlas-tabletop-palette__button', tint, t('lighting.tintReset'));
    this.tintReset.type = 'button';
    this.tintInput.addEventListener('input', () => { this.actions.setTint(this.tintInput.value, false); this.tintReset.disabled = false; });
    this.tintInput.addEventListener('change', () => this.actions.setTint(this.tintInput.value, true));
    this.tintReset.addEventListener('click', (event) => {
      event.preventDefault();
      this.actions.resetTint();
      this.tintInput.value = '#ffffff';
      this.tintReset.disabled = true;
    });
    el('div', 'atlas-tabletop-palette__hint', light, t('lighting.tintHint'));
    const level = (keep: boolean): void => {
      const value = Number(this.ambientInput.value) / 100;
      this.ambientValue.textContent = `${Math.round(value * 100)}%`;
      this.actions.setAmbient(value, keep);
    };
    this.ambientInput.addEventListener('input', () => level(false));
    this.ambientInput.addEventListener('change', () => level(true));
    // The two extra looks: each a checkbox, kept for every board.
    const toggleIn = (label: string, hint: string, change: (on: boolean) => void): HTMLInputElement => {
      const field = el('label', 'atlas-tabletop-palette__field', light);
      const box = el('input', 'atlas-tabletop-palette__check', field);
      box.type = 'checkbox';
      el('span', 'atlas-tabletop-palette__label', field, label);
      this.setTip(field, { label, subtitle: hint });
      box.addEventListener('change', () => change(box.checked));
      return box;
    };
    // Atlas's Lighting settings button, as Atlas draws it: a ghost button with the rotate icon in the settings' action row.
    if (this.actions.forgetExplored) {
      const actions = el('div', 'atlas-setting-actions', light);
      const forget = el('button', 'btn btn--ghost btn--sm', actions);
      forget.type = 'button';
      forget.dataset.lightingAction = 'forget-explored';
      setSvg(forget, FORGET_EXPLORED_SVG, true);
      el('span', '', forget, at('sceneLight.forgetExplored'));
      forget.addEventListener('click', () => { this.actions.forgetExplored?.(); this.closeLighting(); });
      this.forgetExploredButton = forget;
    }
    this.tiltInput = toggleIn(t('lighting.tilt'), t('lighting.tiltHint'), (on) => this.actions.setTiltShift(on));
    this.occlusionInput = toggleIn(t('lighting.occlusion'), t('lighting.occlusionHint'), (on) => this.actions.setOcclusion(on));
    this.lightingPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeLighting(); }
    });
    // Players are shown scenes with the eye on Atlas's scene tabs over the board: no player view or freeze button here.
    this.groundButton = this.registerButton('ground', tool(GROUND_SVG, () => (this.groundPanel.hidden ? this.openGround() : this.closeGround())));
    this.groundButton.setAttribute('aria-label', TOOLBAR_BUTTONS.ground.label);
    this.setTip(this.groundButton, { label: TOOLBAR_BUTTONS.ground.label, subtitle: 'The map board, or a plane or water to the horizon; fog and extra board' });
    this.groundButton.setAttribute('aria-expanded', 'false');
    if (!this.actions.setGround) (this.groundButton.closest('.atlas-tool-button') as HTMLElement).style.display = 'none';
    this.button = this.registerButton('board-settings', tool(WALL_SVG, () => (this.panel.hidden ? this.open() : this.close())));
    this.viewButton = this.registerButton('visibility', tool(modeIcon('view'), () => (this.viewPanel.hidden ? this.openView() : this.closeView())));
    this.viewButton.setAttribute('aria-label', TOOLBAR_BUTTONS.visibility.label);
    this.viewButton.setAttribute('aria-expanded', 'false');
    this.viewTooltip.attach(this.viewButton.parentElement!, () => ({
      label: 'Visibility',
      subtitle: 'See-through walls, upper layers, initiative tracker',
    }));
    // Atlas's end slot, where Connect puts its buttons as it does in Atlas's own toolbar; Atlas's styles apply inside it.
    this.endSlot = el('div', 'atlas-toolbar-end atlas-vtt-plugin atlas-tabletop-extensions', bar);
    this.button.setAttribute('aria-label', TOOLBAR_BUTTONS['board-settings'].label);
    this.setTip(this.button, { label: TOOLBAR_BUTTONS['board-settings'].label });
    this.button.setAttribute('aria-expanded', 'false');

    this.panel = el('div', 'atlas-tabletop-palette', this.row);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Board settings');
    el('div', 'atlas-tabletop-palette__title', this.panel, 'Board settings');
    this.groundPanel = el('div', 'atlas-tabletop-palette atlas-tabletop-ground-panel', this.row);
    this.groundPanel.hidden = true;
    this.groundPanel.setAttribute('role', 'dialog');
    this.groundPanel.setAttribute('aria-label', 'Ground');
    el('div', 'atlas-tabletop-palette__title', this.groundPanel, 'Ground');
    this.viewPanel = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tabletop-view-bar', this.row);
    this.viewPanel.hidden = true;
    this.viewPanel.setAttribute('role', 'toolbar');
    this.viewPanel.setAttribute('aria-label', 'Visibility');
    // Group 1: see-through walls toggle and on-board window-size ring.
    this.seeThroughGroup = el('div', 'atlas-tool-group', this.viewPanel);
    this.seeThroughButton = this.registerButton('see-through', toolIn(this.seeThroughGroup, SEE_THROUGH_SVG, () => {
      this.actions.setSeeThrough?.(!(this.actions.seeThrough?.() ?? false));
      this.syncViewBar();
    }));
    this.seeThroughButton.setAttribute('aria-label', 'See-through walls: walls between the camera and what you look at fade out');
    this.seeThroughButton.dataset.visibility = 'see-through';
    this.viewTooltip.attach(this.seeThroughButton.parentElement!, () => ({
      label: 'See-through walls',
      subtitle: 'Walls between the camera and pivot fade out',
    }));
    this.seeThroughSizeButton = this.registerButton('see-through-size', toolIn(this.seeThroughGroup, WINDOW_SIZE_SVG, () => {
      this.setSizeMode(!this.sizeMode);
    }));
    this.seeThroughSizeButton.dataset.visibility = 'see-through-size';
    this.viewTooltip.attach(this.seeThroughSizeButton.parentElement!, () => {
      const squares = readSeeThroughSize(this.actions.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE);
      return this.seeThroughSizeButton.disabled
        ? { label: 'Window size', subtitle: 'Unavailable in first-person or AR view' }
        : { label: 'Window size', subtitle: `${squares.toFixed(1)} squares · Drag ring edge on board (at pivot)` };
    });
    this.viewSep1 = el('div', 'atlas-tabletop-view-bar__sep', this.viewPanel);
    this.viewSep1.setAttribute('aria-hidden', 'true');
    // Group 2: upper layers look (solid, faded, hidden).
    this.layerGroup = el('div', 'atlas-tool-group', this.viewPanel);
    this.layerGroup.setAttribute('role', 'group');
    this.layerGroup.setAttribute('aria-label', 'Upper layers');
    for (const [value, svg, label, subtitle] of [
      ['solid', LAYERS_SOLID_SVG, 'Upper layers: solid', undefined],
      ['faded', LAYERS_FADED_SVG, 'Upper layers: faded', 'Half see-through'],
      ['transparent', LAYERS_HIDDEN_SVG, 'Upper layers: hidden', undefined],
    ] as const) {
      const button = this.registerButton(`layers-${value}`, toolIn(this.layerGroup, svg, () => {
        this.actions.setLayerLook?.(value);
        this.showLayerLook(value);
      }));
      button.setAttribute('aria-label', subtitle ? `${label} (${subtitle.toLowerCase()})` : label);
      button.dataset.layerLook = value;
      this.viewTooltip.attach(button.parentElement!, () => ({ label, ...(subtitle ? { subtitle } : {}) }));
      this.layerButtons.push({ value, button });
    }
    this.viewSep2 = el('div', 'atlas-tabletop-view-bar__sep', this.viewPanel);
    this.viewSep2.setAttribute('aria-hidden', 'true');
    // Group 3: board side panels (initiative tracker and stat sheet).
    this.panelGroup = el('div', 'atlas-tool-group', this.viewPanel);
    this.initiativeButton = this.registerButton('initiative', toolIn(this.panelGroup, INITIATIVE_SVG, () => {
      this.actions.toggleInitiative();
      this.syncViewBar();
    }));
    this.initiativeButton.setAttribute('aria-label', 'Initiative tracker (I)');
    this.initiativeButton.dataset.visibility = 'initiative';
    this.viewTooltip.attach(this.initiativeButton.parentElement!, () => ({
      label: 'Initiative tracker',
      shortcut: 'I',
    }));
    this.sheetButton = this.registerButton('sheet', toolIn(this.panelGroup, SHEET_SVG, () => {
      this.dice?.handlers.close();
      this.diceLog?.handlers.close();
      this.sheetHandlers?.toggle();
      this.refresh();
    }));
    this.sheetButton.setAttribute('aria-label', 'Stat sheet');
    this.sheetButton.dataset.visibility = 'sheet';
    this.viewTooltip.attach(this.sheetButton.parentElement!, () => ({
      label: 'Stat sheet',
      subtitle: 'Selected token\'s sheet and dice log',
    }));
    this.sheetButton.closest<HTMLElement>('.atlas-tool-button')?.toggleAttribute('hidden', true);
    this.seeThroughRing = new SeeThroughRing(container, {
      circle: () => this.actions.seeThroughCircle?.() ?? null,
      enabled: () => this.actions.seeThrough?.() === true,
      size: () => this.actions.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE,
      setSize: (squares) => {
        this.actions.setSeeThroughSize?.(squares);
        this.updateSizeTooltip();
      },
      onClose: () => this.setSizeMode(false),
    });
    const fog = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', fog, 'Walls and fog: size and shape');
    const field = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', field, 'Default wall height');
    this.heightInput = el('input', 'atlas-tabletop-palette__input', field);
    this.heightInput.type = 'text';
    this.heightInput.inputMode = 'decimal';
    this.heightInput.setAttribute('aria-label', 'Default wall height in squares');
    el('span', 'atlas-tabletop-palette__unit', field, 'squares');
    const thick = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', thick, 'Wall thickness');
    this.thicknessInput = el('input', 'atlas-tabletop-palette__input', thick);
    this.thicknessInput.type = 'text';
    this.thicknessInput.inputMode = 'decimal';
    this.thicknessInput.setAttribute('aria-label', 'Wall thickness in squares');
    el('span', 'atlas-tabletop-palette__unit', thick, 'squares');
    // The players' AR table: where their printed marker sheets lie on the map, fine-tuned here only.
    this.tableSection = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', this.tableSection, 'AR table');
    this.tableHint = el('div', 'atlas-tabletop-palette__hint', this.tableSection, '');
    this.tableButton = el('button', 'atlas-tabletop-palette__choice', this.tableSection, 'Fine-tune the AR table…');
    this.tableButton.type = 'button';
    this.setTip(this.tableButton, { label: 'Fine-tune the AR table', subtitle: 'Shows the players\' printed sheets on the map with handles: drag them to where the map should lie on the table.' });
    this.tableButton.addEventListener('click', () => { this.close(); this.actions.placeArTable?.(); });
    // Snap to grid: tokens and props each on their own.
    const snapping = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', snapping, 'Snap to grid');
    for (const [kind, label, hint] of [['tokens', 'Snap tokens', "The map's own Snap to grid (the same as Atlas's): a dropped token goes to the middle of its square. Off: it stays where it is dropped."], ['props', 'Snap props', 'On its own, whatever the map snaps tokens to: a dropped prop goes to the middle of its square. Off: it stays where it is dropped.']] as const) {
      const row = el('label', 'atlas-tabletop-palette__field', snapping);
      const input = el('input', 'atlas-tabletop-palette__check', row);
      input.type = 'checkbox';
      input.dataset.snap = kind;
      el('span', 'atlas-tabletop-palette__label', row, label);
      this.setTip(row, { label, subtitle: hint });
      input.addEventListener('change', () => this.actions.setSnap?.(kind, input.checked));
      this.snapToggles.push({ kind, input });
    }
    // Ground (its own panel): the map on its table, or a plane or water to the horizon round it; extra board either way.
    if (this.actions.setGround) {
      const section = el('div', 'atlas-tabletop-palette__section', this.groundPanel);
      const change = (edit: Partial<GroundSettings>): void => { const now = this.actions.ground?.(); if (now) this.actions.setGround?.({ ...now, ...edit }); this.fillGround(); };
      // Six choices: the label above them, and they wrap (in one row they ran past the panel's edge).
      const modeRow = el('div', 'atlas-tabletop-palette__field atlas-tabletop-palette__field--stacked', section);
      el('span', 'atlas-tabletop-palette__label', modeRow, 'Background');
      const choices = el('span', 'atlas-tabletop-palette__choices atlas-tabletop-ground-modes', modeRow);
      choices.setAttribute('role', 'group');
      choices.setAttribute('aria-label', 'Ground round the map');
      const modes: Array<{ value: GroundMode; button: HTMLButtonElement }> = [];
      for (const [value, label, hint] of [['board', 'Map board', 'The map on its table, framed.'], ['horizon', 'Horizon plane', 'The map lies on a plane running to the horizon, tiled with a material and shaped by a pattern past the board.'], ['water', 'Water plane', 'The map lies on water running to the horizon, moving as painted water does.'], ['lava', 'Lava plane', 'The map lies on lava running to the horizon, glowing and moving as painted lava does.'], ['acid', 'Acid plane', 'The map lies on acid running to the horizon, bubbling and moving as painted acid does.'], ['painted', 'Painted', 'The map lies on a background painted in the Tabletop Gallery']] as const) {
        const button = el('button', 'atlas-tabletop-palette__choice', choices, label);
        button.type = 'button';
        this.setTip(button, { label, subtitle: hint });
        button.addEventListener('click', () => change({ mode: value }));
        modes.push({ value, button });
      }
      const rows: Array<{ row: HTMLElement; modes: GroundMode[] }> = [];
      const ON_LAND: GroundMode[] = ['horizon'], ON_WATER: GroundMode[] = ['water', 'lava', 'acid'], CLEAR: GroundMode[] = ['water', 'acid'], BEYOND: GroundMode[] = ['horizon', 'water', 'lava', 'acid', 'painted'], ALWAYS: GroundMode[] = ['board', 'horizon', 'water', 'lava', 'acid', 'painted'], PAINTED: GroundMode[] = ['painted'];
      const selectRow = (label: string, aria: string, modes: GroundMode[]): HTMLSelectElement => {
        const row = el('label', 'atlas-tabletop-palette__field', section);
        el('span', 'atlas-tabletop-palette__label', row, label);
        const select = el('select', 'dropdown atlas-tabletop-palette__select', row);
        select.setAttribute('aria-label', aria);
        rows.push({ row, modes });
        return select;
      };
      const rangeRow = (label: string, aria: string, max: number, modes: GroundMode[]): { input: HTMLInputElement; value: HTMLElement } => {
        const row = el('label', 'atlas-tabletop-palette__field', section);
        el('span', 'atlas-tabletop-palette__label', row, label);
        const input = el('input', 'atlas-tabletop-palette__range', row);
        input.type = 'range';
        input.min = '0';
        input.max = String(max);
        input.step = '1';
        input.setAttribute('aria-label', aria);
        const value = el('span', 'atlas-tabletop-palette__unit', row);
        rows.push({ row, modes });
        return { input, value };
      };
      const material = selectRow('Ground material', 'Material the ground is tiled with', ON_LAND);
      material.addEventListener('change', () => {
        const now = this.actions.ground?.();
        if (!now) return;
        const { material: _old, ...rest } = now;
        this.actions.setGround?.(material.value ? { ...rest, material: material.value } : rest);
        this.fillGround();
      });
      const background = selectRow('Painted background', 'Painted background', PAINTED);
      background.addEventListener('change', () => {
        const now = this.actions.ground?.();
        if (!now) return;
        const { background: _old, ...rest } = now;
        this.actions.setGround?.(background.value ? { ...rest, background: background.value } : rest);
        this.fillGround();
      });
      const tile = rangeRow('Tile size', 'Squares one tile of the ground material spans', MAX_TILE, [...ON_LAND, 'painted']);
      tile.input.min = '1';
      tile.input.addEventListener('change', () => change({ tile: Number(tile.input.value) }));
      tile.input.addEventListener('input', () => { tile.value.textContent = `${tile.input.value} sq`; });
      const noise = selectRow('Pattern', 'Height pattern past the board', ON_LAND);
      for (const one of GROUND_NOISES) { const option = el('option', '', noise, one.label); option.value = one.value; }
      noise.addEventListener('change', () => change({ noise: noise.value as GroundSettings['noise'] }));
      const strength = rangeRow('Pattern strength', 'Height pattern strength', 100, ON_LAND);
      // The water, lava or acid: the same settings as the painted liquid, each its own.
      const liquidOf = (mode: GroundMode): LiquidKind | null => (mode === 'water' || mode === 'lava' || mode === 'acid' ? mode : null);
      const waterChange = (edit: Partial<WaterMotion>): void => {
        const now = this.actions.ground?.();
        const liquid = now ? liquidOf(now.mode) : null;
        if (now && liquid) this.actions.setGround?.({ ...now, [liquid]: { ...now[liquid], ...edit } });
        this.fillGround();
      };
      const lavaStyle = selectRow('Lava type', 'What kind of lava it is', ['lava']);
      for (const style of LAVA_STYLES) { const option = el('option', '', lavaStyle, style.label); option.value = style.value; }
      this.setTip(lavaStyle, () => { const style = LAVA_STYLES.find((one) => one.value === lavaStyle.value); return { label: 'Lava type', ...(style ? { subtitle: style.hint } : {}) }; });
      lavaStyle.addEventListener('change', () => waterChange({ style: lavaStyle.value as LavaStyle }));
      const kind = selectRow('Moves', 'How the liquid moves', ON_WATER);
      for (const value of WATER_MOTION_KINDS) { const option = el('option', '', kind, MOTION_LABELS.water[value]); option.value = value; }
      kind.addEventListener('change', () => waterChange({ kind: kind.value as WaterMotion['kind'] }));
      const amount = rangeRow('Movement', 'How much the liquid moves', 100, ON_WATER);
      amount.input.addEventListener('change', () => waterChange({ amount: Number(amount.input.value) / 100 }));
      const direction = rangeRow('Direction', 'Where the liquid runs, in degrees', 359, ON_WATER);
      direction.input.addEventListener('change', () => waterChange({ direction: Number(direction.input.value) }));
      const clarity = rangeRow('Clarity', 'How clear the liquid is', 100, CLEAR);
      clarity.input.addEventListener('change', () => waterChange({ clarity: Number(clarity.input.value) / 100 }));
      const tintRow = el('label', 'atlas-tabletop-palette__field', section);
      el('span', 'atlas-tabletop-palette__label', tintRow, 'Tint');
      const tint = el('input', 'atlas-tabletop-palette__color', tintRow);
      tint.type = 'color';
      tint.setAttribute('aria-label', 'Liquid tint');
      tint.addEventListener('change', () => waterChange({ tint: tint.value.toLowerCase() }));
      rows.push({ row: tintRow, modes: ON_WATER });
      // The liquid's own presets, made again for each liquid.
      const presetRow = el('div', 'atlas-tabletop-palette__field atlas-tabletop-palette__field--stacked', section);
      el('span', 'atlas-tabletop-palette__label', presetRow, 'Presets');
      const presets = el('span', 'atlas-swatch-grid atlas-tabletop-ground-tints', presetRow);
      presets.setAttribute('role', 'group');
      presets.setAttribute('aria-label', 'Liquid tint presets');
      rows.push({ row: presetRow, modes: ON_WATER });
      const makePresets = (liquid: LiquidKind): void => {
        this.forgetTips(presets);
        presets.replaceChildren();
        for (const preset of LIQUID_TINTS[liquid]) {
          const button = el('button', 'atlas-swatch', presets);
          button.type = 'button';
          button.style.backgroundColor = preset.tint;
          button.setAttribute('aria-label', preset.name);
          this.setTip(button, { label: preset.name });
          button.dataset.tint = preset.tint;
          button.addEventListener('click', () => waterChange({ tint: preset.tint }));
        }
        presets.dataset.liquid = liquid;
      };
      strength.input.addEventListener('change', () => change({ strength: Number(strength.input.value) / 100 }));
      strength.input.addEventListener('input', () => { strength.value.textContent = `${strength.input.value}%`; });
      // Distance fog: off, or from thin (80) to thick (100); the plane runs a little past where it hides everything.
      const fogRow = rangeRow('Distance fog', 'Distance fog', 100, BEYOND);
      fogRow.input.min = String(FOG_MIN);
      const fogOn = el('input', 'atlas-tabletop-palette__check', fogRow.input.closest('label')!);
      fogOn.type = 'checkbox';
      fogOn.setAttribute('aria-label', 'Distance fog on');
      fogRow.input.before(fogOn);
      fogOn.addEventListener('change', () => change({ fog: fogOn.checked ? Number(fogRow.input.value) || FOG_MIN : 0 }));
      fogRow.input.addEventListener('change', () => change({ fog: Number(fogRow.input.value) }));
      fogRow.input.addEventListener('input', () => { fogRow.value.textContent = fogRow.input.value; });
      const margin = rangeRow('Extra board', 'Extra board round the map, in squares', MAX_MARGIN, ALWAYS);
      margin.input.addEventListener('change', () => change({ margin: Number(margin.input.value) }));
      margin.input.addEventListener('input', () => { margin.value.textContent = `${margin.input.value} sq`; });
      this.setTip(margin.input.closest('label')!, { label: 'Extra board', subtitle: 'Room round the map where minis can stand, in squares each way.' });
      this.groundUi = { section, modes, rows, water: { kind, style: lavaStyle, amount: amount.input, direction: direction.input, directionRow: direction.input.closest('label')!, clarity: clarity.input, tint, presets, makePresets }, material, background, noise, strength: strength.input, strengthValue: strength.value, fog: fogRow.input, fogOn, fogValue: fogRow.value, margin: margin.input, marginValue: margin.value, tile: tile.input, tileValue: tile.value };
    }
    const edges = el('div', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', edges, 'Wall edges');
    const edgeChoices = el('span', 'atlas-tabletop-palette__choices', edges);
    edgeChoices.setAttribute('role', 'group');
    edgeChoices.setAttribute('aria-label', 'How round the edges of walls and doors are');
    for (const [value, label] of [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']] as const) {
      const button = el('button', 'atlas-tabletop-palette__choice', edgeChoices, label);
      button.type = 'button';
      // Applies at once: the choice shows as chosen now, and the walls follow.
      button.addEventListener('click', () => {
        this.actions.setWallEdges?.(value);
        this.showEdges(value);
      });
      this.edgeButtons.push({ value, button });
    }
    this.setTip(edges, { label: 'Wall edges', subtitle: 'Sharp is a plain box; Soft rounds the edges a little so they catch the light; Rounded is more pillowy. Walls are drawn with more triangles when rounded.' });
    el('div', 'atlas-tabletop-palette__hint', fog, 'Walls without a height of their own stand this many grid squares tall, and so does the fog painted in Atlas (0 lays the fog flat on the map).');
    const dice = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', dice, t('dice.heading'));
    const auto = el('label', 'atlas-tabletop-palette__field', dice);
    this.autoRollToggle = el('input', 'atlas-tabletop-palette__check', auto);
    this.autoRollToggle.type = 'checkbox';
    el('span', 'atlas-tabletop-palette__label', auto, t('dice.autoRoll'));
    this.setTip(auto, { label: t('dice.autoRoll'), subtitle: t('dice.autoRollHint') });
    this.autoRollToggle.addEventListener('change', () => this.actions.setAutoRoll(this.autoRollToggle.checked));
    const apply = (): void => {
      const height = readFogHeight(this.heightInput.value);
      this.heightInput.toggleAttribute('aria-invalid', height === null);
      if (height !== null) this.actions.setFogHeight(height);
    };
    this.heightInput.addEventListener('change', apply);
    this.thicknessInput.addEventListener('change', () => {
      const thickness = readWallThickness(this.thicknessInput.value);
      this.thicknessInput.toggleAttribute('aria-invalid', thickness === null);
      if (thickness !== null) this.actions.setWallThickness(thickness);
    });
    this.viewPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeView(); }
    });
    this.groundPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeGround(); }
    });
    this.panel.addEventListener('keydown', (event) => {
      // Typing here must not move the camera.
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      else if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    // Atlas's "More tools": when the pane is too narrow for the bar, the tools farthest from the Move group go into this
    // menu, one by one, and come back as the pane widens.
    this.moreGroup = el('div', 'atlas-dropdown-menu atlas-tabletop-more', bar);
    this.moreButton = this.registerButton('more', toolIn(this.moreGroup, MORE_SVG, () => (this.moreMenu.hidden ? this.openMore() : this.closeMore())));
    this.moreButton.setAttribute('aria-label', t('toolbar.more'));
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.setTip(this.moreButton, { label: t('toolbar.more') });
    this.moreMenu = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--right atlas-tabletop-more-menu', this.moreGroup);
    this.moreMenu.hidden = true;
    this.moreGroup.hidden = true;
    this.moreGroup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.moreMenu.hidden) { event.preventDefault(); event.stopPropagation(); this.closeMore(); }
    });
    // Atlas's GM view switch (`MainToolbar.tsx`): a switch, named "GM view" whatever its state, its tooltip saying what each state is.
    // It keeps the bar's last place, after "More tools", and never goes into that menu.
    this.gmViewEnd = el('div', 'atlas-toolbar-end', bar);
    const gmViewName = el('span', '', this.gmViewEnd);
    gmViewName.hidden = true;
    // `hidden` is only the browser's own display:none, which any host or theme rule that sets a display on spans overrides (Obsidian's did,
    // and the name showed beside the switch); an inline !important is out of every stylesheet's reach, and aria-labelledby still reads it.
    gmViewName.style.setProperty('display', 'none', 'important');
    gmViewName.id = 'atlas-tabletop-gm-view-name';
    // Atlas's peek button (`PeekButton.tsx`), before the switch: a finger holds it where a keyboard holds the peek key. Its name is its label alone, no tooltip.
    this.peekButton = el('button', 'btn btn--toolbar btn--icon btn--toolbar atlas-peek-button', this.gmViewEnd);
    this.peekButton.type = 'button';
    this.peekButton.setAttribute('aria-label', at('toolbar.peek'));
    this.peekButton.setAttribute('aria-pressed', 'false');
    this.peekButton.hidden = true;
    setSvg(this.peekButton, peekIcon());
    const peek = (on: boolean): void => {
      if (this.peekHeld === on) return;
      this.peekHeld = on;
      this.actions.peek?.(on);
      this.refresh();
    };
    this.peekButton.addEventListener('pointerdown', (event) => {
      if ((this.actions.gmView?.() ?? true) === false || event.button !== 0) return;
      // The press is captured, so a finger that slides off the button still ends the peek when it lifts.
      try { this.peekButton.setPointerCapture(event.pointerId); } catch { /* a press the system has taken away */ }
      peek(true);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.peekButton.addEventListener(type, () => peek(false));
    this.peekButton.addEventListener('contextmenu', (event) => event.preventDefault());
    this.gmViewSwitch = el('div', 'atlas-toggle', this.gmViewEnd);
    this.gmViewSwitch.setAttribute('role', 'switch');
    this.gmViewSwitch.setAttribute('aria-labelledby', gmViewName.id);
    this.gmViewSwitch.tabIndex = 0;
    this.registerButton('gm-view', this.gmViewSwitch as unknown as HTMLButtonElement);
    const flipGmView = (): void => { this.actions.setGmView?.(!(this.actions.gmView?.() ?? true)); this.refresh(); };
    this.gmViewSwitch.addEventListener('click', flipGmView);
    this.gmViewSwitch.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      flipGmView();
    });
    this.viewTooltip.attach(this.gmViewSwitch, () => {
      const on = this.actions.gmView?.() ?? true;
      return { label: at(on ? 'toolbar.gmView' : 'toolbar.sessionView', { key: this.actions.gmViewShortcut?.() ?? '' }) };
    });
    // Left to right as they stand; they leave from the right.
    this.fitOrder.push(laserGroup, this.fogGroup, this.measureGroup, this.waterGroup, this.paintGroup, this.templateGroup, this.lightingGroup, this.groundButton.closest('.atlas-tool-button') as HTMLElement, this.button.closest('.atlas-tool-button') as HTMLElement, this.viewButton.closest('.atlas-tool-button') as HTMLElement, this.endSlot);
    this.fitWatch = new (doc.defaultView ?? window).ResizeObserver(() => this.fit());
    this.fitWatch.observe(container);
    // Presses on the bar and the panel are not the board's: no camera drag, no deselecting.
    for (const part of [bar, this.helpBar, this.panel, this.viewPanel, this.groundPanel, this.waterPanel, this.measureBarsPanel, ...(this.fogBars ? [this.fogBars.panel] : [])]) part.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.refresh();
  }

  /** Shows the player view's state: open or not, its camera frozen or not (the freeze button only while it is open). */
  refresh(): void {
    this.refreshAtlasTools();
    this.refreshHelp();
    this.refreshCinema();
    // Connect's Template tool, while it hosts: the shapes show with the tool on.
    const hosting = this.actions.hosting();
    const templateOn = hosting && this.actions.templateOn();
    this.templateGroup.style.display = hosting ? '' : 'none';
    if (!hosting) this.closeTemplate();
    this.templateButton.classList.toggle('is-active', templateOn);
    this.templateButton.setAttribute('aria-pressed', String(templateOn));
    for (const choice of this.templatePanel.querySelectorAll<HTMLElement>('[data-shape]')) {
      const check = choice.querySelector('.atlas-dropdown-menu-item__check')!;
      const chosen = choice.dataset.shape === this.actions.templateShape();
      setSvg(check, chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
    }
    // Each mode shows its own tools; Undo/Redo and Move are in both. Without modes, every tool shows.
    const mode = this.actions.mode?.() ?? null;
    this.modeGroup.style.display = mode === null ? 'none' : '';
    for (const { mode: one, button } of this.modeButtons) {
      button.classList.toggle('is-active', one === mode);
      button.setAttribute('aria-pressed', String(one === mode));
      // Cinematic is the GM's (the board has cutscenes to offer).
      if (one === 'cinematic') (button.closest('.atlas-tool-button') as HTMLElement).style.display = this.cinema ? '' : 'none';
    }
    const cinematic = mode === 'cinematic';
    const editing = mode === null || mode === 'edit';
    const playing = mode === null || mode === 'play';
    this.bar.classList.toggle('atlas-tabletop-bar--cinematic', cinematic);
    const show = (part: HTMLElement | null | undefined, on: boolean): void => { if (part) part.classList.toggle('atlas-tabletop-off-mode', !on); };
    show(this.measureGroup, playing);
    show(this.templateGroup, playing);
    show(this.endSlot, playing || cinematic);
    this.syncGmView(mode);
    show(this.atlasGroup, playing);
    show(this.waterGroup, editing);
    show(this.fogGroup, editing);
    show(this.lightingGroup, editing);
    show(this.paintGroup, editing);
    show(this.shapeGroup, editing);
    // Out of Edit mode the Shapes tool is put down.
    if (!editing && this.actions.shapeTool?.() === true) this.actions.setShapeTool?.(false);
    const shaping = this.actions.shapeTool?.() === true;
    this.shapeButton.classList.toggle('is-active', shaping);
    this.shapeButton.setAttribute('aria-pressed', String(shaping));
    show(this.button.closest<HTMLElement>('.atlas-tool-button'), editing);
    show(this.groundButton.closest<HTMLElement>('.atlas-tool-button'), editing);
    if (!playing) { this.closeTemplate(); this.closeMeasure(); this.closeDice(); }
    if (!editing) { this.close(); this.closeGround(); this.closeWater(); this.closePaint(); this.closeLighting(); }
    if (cinematic) this.closeView();
    const painting = this.actions.painting?.() ?? null;
    if (painting) this.lastPaint = painting;
    this.paintButton.classList.toggle('is-active', painting !== null);
    this.paintButton.setAttribute('aria-pressed', String(painting !== null));
    setSvg(this.paintButton, modeIcon(painting === UNPAINT ? 'unpaint' : 'paint'));
    for (const card of this.paintPanel.querySelectorAll<HTMLElement>('[data-material]')) card.classList.toggle('is-active', card.dataset.material === painting);
    this.undoButton.disabled = this.actions.canUndo?.() !== true;
    this.redoButton.disabled = this.actions.canRedo?.() !== true;
    this.syncWaterBar();
    this.syncFogBar();
    this.syncMeasureBar();
    const canLight = this.actions.canLight();
    this.lightingGroup.style.display = canLight ? '' : 'none';
    if (!canLight) this.closeLighting();
    const lighting = this.actions.lighting();
    setSvg(this.lightingButton, LIGHTING_ICONS[lighting]);
    this.lightingButton.setAttribute('aria-label', t('lighting.title', { mode: lightingLabel(lighting) }));
    this.setTip(this.lightingButton, { label: t('lighting.title', { mode: lightingLabel(lighting) }) });
    for (const choice of this.lightingPanel.querySelectorAll<HTMLElement>('[data-lighting]')) {
      const check = choice.querySelector('.atlas-dropdown-menu-item__check')!;
      setSvg(check, choice.dataset.lighting === lighting ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
    }
    for (const end of this.ends()) {
      const open = end.handlers.isOpen();
      end.button.classList.toggle('is-active', open);
      end.button.setAttribute('aria-expanded', String(open));
    }
    const laser = this.actions.laserOn();
    // The group's face is always the tool in use, as Atlas's is while one of its tools is.
    setSvg(this.laserButton, laser ? LASER_SVG : HAND_SVG);
    // One tool in use at a time, as on Atlas's toolbar: the group is lit unless the Measure tool is.
    this.laserButton.classList.toggle('is-active', this.actions.measureOn?.() !== true && !this.actions.waterTool?.() && !this.actions.painting?.() && this.actions.fog?.state().on !== true);
    this.laserButton.setAttribute('aria-label', laser ? 'Laser Pointer' : 'Move/Select');
    this.setTip(this.laserButton, { label: laser ? 'Laser Pointer' : 'Move/Select', shortcut: MOVE_KEY });
    for (const [entry, chosen] of [[this.moveItem, !laser], [this.laserItem, laser]] as const) {
      const check = entry.querySelector('.atlas-dropdown-menu-item__check')!;
      setSvg(check, chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
      entry.setAttribute('aria-checked', String(chosen));
    }
    if (!this.viewPanel.hidden || this.sizeMode) {
      this.syncViewBar();
    } else if (this.actions.setSeeThroughSize !== undefined && this.actions.seeThroughCircle !== undefined) {
      const canCut = this.actions.seeThroughCircle() !== null;
      this.seeThroughSizeButton.disabled = !canCut;
      this.updateSizeTooltip(!canCut);
    }
    if (mode !== this.lastMode) {
      this.lastMode = mode;
      this.fit();
    }
  }

  get isOpen(): boolean {
    return !this.panel.hidden || !this.viewPanel.hidden || !this.groundPanel.hidden || !this.laserPanel.hidden || !this.lightingPanel.hidden || !this.moreMenu.hidden || this.ends().some((end) => end.handlers.isOpen()) || this.sheetHandlers?.isOpen() === true;
  }

  /** The end slot's buttons there now: Dice (and Dice log if mounted standalone). */
  private ends(): EndButton[] {
    return [this.dice, this.diceLog].filter((end): end is EndButton => end !== null);
  }

  /**
   * Puts the Dice button in Atlas's end slot (before what Connect puts there), or takes it away with null. Returns the
   * place the picker opens from: above the button, inside the slot's `atlas-vtt-plugin` root.
   */
  setDice(handlers: DiceButton | null): HTMLElement | null {
    this.dice?.anchor.remove();
    this.dice = null;
    if (!handlers) return null;
    this.dice = this.endButton('Dice', DICES_SVG, handlers, 'atlas-tabletop-dice-menu', null, () => this.keyedTip('Dice tray', this.actions.diceShortcut?.('diceTray')));
    this.registerButton('dice', this.dice.button);
    return this.dice.anchor;
  }

  /** Puts the dice log's button next to the Dice button (or first in the end slot without one); null takes it away. */
  setDiceLog(handlers: DiceButton | null): HTMLElement | null {
    this.diceLog?.anchor.remove();
    this.diceLog = null;
    if (!handlers) return null;
    this.diceLog = this.endButton('Dice log', LOG_SVG, handlers, 'atlas-tabletop-dice-log-menu', () => this.dice?.anchor ?? null, () => this.keyedTip('Dice log', this.actions.diceShortcut?.('diceLog')));
    this.registerButton('dice-log', this.diceLog.button);
    return this.diceLog.anchor;
  }

  /** Wires the Stat sheet button in the Visibility bar; null hides it. */
  setSheet(handlers: DiceButton | null): HTMLElement | null {
    this.sheetHandlers = handlers;
    this.sheetButton.closest<HTMLElement>('.atlas-tool-button')?.toggleAttribute('hidden', handlers === null);
    if (handlers) {
      const open = handlers.isOpen();
      this.sheetButton.classList.toggle('is-active', open);
      this.sheetButton.setAttribute('aria-pressed', String(open));
    } else {
      this.sheetButton.classList.remove('is-active');
      this.sheetButton.setAttribute('aria-pressed', 'false');
    }
    return handlers ? this.viewPanel : null;
  }

  /**
   * Puts the toggle "Players follow my camera" in the end slot (after the dice buttons); it shows only while a session
   * hosts. It also makes the Cinematic mode button available. Null takes them away. Returns where it sits.
   */
  setCinema(handlers: CinemaButtons | null): HTMLElement | null {
    this.cinema?.anchor.remove();
    this.cinema = null;
    if (!handlers) { this.refresh(); return null; }
    const doc = this.row.ownerDocument;
    const anchor = doc.win.createDiv();
    anchor.className = 'atlas-tabletop-cinema-tools';
    anchor.setCssStyles({ display: 'flex', alignItems: 'center', gap: 'inherit' });
    const make = (label: string, svg: string, click: () => void): HTMLButtonElement => {
      const wrapper = doc.win.createDiv();
      wrapper.className = 'atlas-tool-button';
      const span = doc.win.createSpan();
      span.setCssStyles({ display: 'inline-flex' });
      const button = doc.win.createEl('button');
      button.className = 'btn btn--toolbar btn--icon atlas-tabletop-tool-button';
      button.type = 'button';
      setSvg(button, svg);
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => {
        this.closeDice();
        click();
        this.refresh();
      });
      span.appendChild(button);
      wrapper.appendChild(span);
      anchor.appendChild(wrapper);
      this.setTip(button, { label });
      return button;
    };
    const live = this.registerButton('cinema-live', make('Players follow my camera', LIVE_SVG, () => handlers.toggleLive()));
    this.cinema = { handlers, anchor, live };
    const beside = (this.diceLog ?? this.dice)?.anchor ?? null;
    if (beside) beside.after(anchor);
    else this.endSlot.prepend(anchor);
    this.refresh();
    return anchor;
  }

  /** The live toggle follows the session: shown while one hosts, pressed while the players follow. */
  private refreshCinema(): void {
    if (!this.cinema) return;
    const { live, handlers } = this.cinema;
    const hosting = this.actions.hosting();
    const on = hosting && handlers.live();
    (live.closest('.atlas-tool-button') as HTMLElement).style.display = hosting ? '' : 'none';
    // Its box goes too: an empty box would still take a gap in the end slot, a wider space before the command button.
    this.cinema.anchor.style.display = hosting ? 'flex' : 'none';
    live.classList.toggle('is-active', on);
    live.setAttribute('aria-pressed', String(on));
  }

  /** What the toolbar's controls do (Atlas's command palette offers the same, src/palette/tabletopCommands.ts). */
  get boardActions(): ToolbarActions {
    return this.actions;
  }

  /** Registers a toolbar button against `TOOLBAR_BUTTONS` so DOM, `goTo`, and palette stay in lockstep. */
  private registerButton(id: ToolbarButtonId, button: HTMLButtonElement): HTMLButtonElement {
    button.dataset.toolbarId = id;
    this.registeredButtons.set(id, button);
    return button;
  }

  /** Foreign buttons added into the end slot by other plugins (e.g. Connect). */
  private extraEndSlotButtons(): Array<{ id: string; label: string; button: HTMLButtonElement }> {
    const out: Array<{ id: string; label: string; button: HTMLButtonElement }> = [];
    let index = 0;
    for (const button of this.endSlot.querySelectorAll<HTMLButtonElement>('button')) {
      if (button.dataset.toolbarId) continue;
      if (button.hidden || button.style.display === 'none' || button.disabled) continue;
      const label = (button.getAttribute('aria-label') || button.title || button.textContent || '').trim();
      if (!label) continue;
      out.push({ id: `end-slot:${index++}:${label}`, label, button });
    }
    return out;
  }

  /** Live toolbar state read by `toolbarButtonEntries` to list every available toolbar button in the command palette. */
  toolbarState(): ToolbarButtonState {
    const atlasEntries = this.commandButton ? [...this.atlasButtons, this.commandButton] : this.atlasButtons;
    return {
      actions: this.actions,
      hasDice: this.dice !== null,
      hasDiceLog: this.diceLog !== null,
      hasSheet: this.sheetHandlers !== null,
      sheetOpen: this.sheetHandlers?.isOpen() === true,
      hasCinema: this.cinema !== null,
      cinemaLive: this.cinema !== null && this.actions.hosting() && this.cinema.handlers.live(),
      hasMore: !this.moreGroup.hidden,
      atlasTools: atlasEntries.map(({ tool }) => ({
        id: tool.id,
        label: tool.label,
        enabled: tool.enabled(),
        active: tool.active(),
      })),
      extraEndButtons: this.extraEndSlotButtons().map(({ id, label }) => ({ id, label })),
    };
  }

  /**
   * Jumps to a toolbar button by registry id: switches board mode first when the button belongs to another mode,
   * lets `refresh()` close the old mode's panels, then activates or opens the target button's tool/panel/toggle.
   */
  goTo(id: string): boolean {
    if (id.startsWith('end-slot:')) {
      const targetMode = targetModeFor(['play'], this.actions.mode?.() ?? null);
      if (targetMode !== null) {
        this.actions.setMode?.(targetMode);
        this.refresh();
      }
      const found = this.extraEndSlotButtons().find((entry) => entry.id === id);
      if (!found) return false;
      found.button.click();
      this.refresh();
      return true;
    }
    if (!Object.hasOwn(TOOLBAR_BUTTONS, id)) return false;
    const buttonId = id as ToolbarButtonId;
    const spec = TOOLBAR_BUTTONS[buttonId];
    if (!spec.available(this.toolbarState())) return false;
    const targetMode = targetModeFor(spec.modes, this.actions.mode?.() ?? null);
    if (targetMode !== null) {
      this.actions.setMode?.(targetMode);
      this.refresh();
    }
    switch (buttonId) {
      case 'undo':
        this.actions.undo?.();
        break;
      case 'redo':
        this.actions.redo?.();
        break;
      case 'mode-play':
        if (this.actions.mode?.() !== 'play') this.actions.setMode?.('play');
        break;
      case 'mode-edit':
        if (this.actions.mode?.() !== 'edit') this.actions.setMode?.('edit');
        break;
      case 'mode-cinematic':
        if (this.cinema && this.actions.mode?.() !== 'cinematic') this.actions.setMode?.('cinematic');
        break;
      case 'move':
        this.actions.selectTool('move');
        break;
      case 'laser':
        this.actions.selectTool('laser');
        break;
      case 'move-options':
        this.openLaser();
        break;
      case 'measure':
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeDice();
        this.closeMore();
        if (!this.actions.measureOn?.()) {
          const nextMode = this.measureOptions().mode;
          this.actions.selectMeasure?.(isMeasureShape(nextMode) ? nextMode : 'ruler');
        }
        break;
      case 'measure-options':
        this.openMeasure();
        break;
      case 'template':
        if (this.actions.hosting() && !this.actions.templateOn()) this.actions.selectTemplate(this.actions.templateShape());
        break;
      case 'template-options':
        if (this.actions.hosting()) this.openTemplate();
        break;
      case 'water':
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeMore();
        if (!this.actions.waterTool?.()) this.actions.setWaterTool?.(this.lastWaterMode);
        break;
      case 'fog':
        this.close();
        this.closeGround();
        this.closeView();
        this.closeLaser();
        this.closeLighting();
        this.closePaint();
        this.closeMeasure();
        this.closeTemplate();
        this.closeMore();
        if (this.actions.fog && !this.actions.fog.state().on) this.actions.fog.start();
        break;
      case 'shapes':
        if (this.actions.shapeTool?.() !== true) this.actions.setShapeTool?.(true);
        break;
      case 'paint':
        if (!this.actions.painting?.()) {
          if (this.lastPaint) this.actions.setPainting?.(this.lastPaint);
          else this.openPaint();
        }
        break;
      case 'paint-options':
        this.openPaint();
        break;
      case 'lighting':
        if (this.actions.canLight()) this.openLighting();
        break;
      case 'ground':
        if (this.actions.setGround) this.openGround();
        break;
      case 'board-settings':
        this.open();
        break;
      case 'visibility':
        this.openView();
        break;
      case 'see-through':
        this.actions.setSeeThrough?.(!(this.actions.seeThrough?.() ?? false));
        break;
      case 'see-through-size':
        this.openView();
        this.setSizeMode(true);
        break;
      case 'layers-solid':
        this.actions.setLayerLook?.('solid');
        break;
      case 'layers-faded':
        this.actions.setLayerLook?.('faded');
        break;
      case 'layers-transparent':
        this.actions.setLayerLook?.('transparent');
        break;
      case 'initiative':
        this.actions.toggleInitiative();
        break;
      case 'sheet':
        if (this.sheetHandlers) {
          this.dice?.handlers.close();
          this.diceLog?.handlers.close();
          this.sheetHandlers.toggle();
        }
        break;
      case 'dice':
        if (this.dice) {
          this.close();
          this.closeView();
          this.closeLaser();
          this.closeTemplate();
          this.closeLighting();
          this.closeMeasure();
          this.diceLog?.handlers.close();
          this.sheetHandlers?.close();
          if (!this.dice.handlers.isOpen()) this.dice.handlers.toggle();
        }
        break;
      case 'dice-log':
        if (this.diceLog) {
          this.close();
          this.closeView();
          this.closeLaser();
          this.closeTemplate();
          this.closeLighting();
          this.closeMeasure();
          this.dice?.handlers.close();
          this.sheetHandlers?.close();
          if (!this.diceLog.handlers.isOpen()) this.diceLog.handlers.toggle();
        }
        break;
      case 'cinema-live':
        if (this.cinema && this.actions.hosting()) {
          this.closeDice();
          this.cinema.handlers.toggleLive();
        }
        break;
      case 'atlas-loot':
      case 'atlas-assets': {
        const toolId = buttonId === 'atlas-loot' ? 'loot' : 'assets';
        const found = this.atlasButtons.find((entry) => entry.tool.id === toolId);
        if (found && found.tool.enabled()) found.tool.run();
        break;
      }
      case 'atlas-palette':
        // The palette closes itself when the command runs; nothing else to open.
        break;
      case 'more':
        if (!this.moreGroup.hidden) this.openMore();
        break;
      case 'gm-view':
        this.actions.setGmView?.(!(this.actions.gmView?.() ?? true));
        break;
    }
    this.refresh();
    return true;
  }

  /** Atlas's Play-mode toolbar tools (random tables, asset manager), in their group before the end slot. */
  private atlasGroup: HTMLElement | null = null;
  private atlasButtons: Array<{ tool: AtlasToolButton; button: HTMLButtonElement }> = [];
  /** Atlas's command palette button: always rightmost (after More tools), shown in every mode and never overflowed. */
  private commandSlot: HTMLElement | null = null;
  private commandButton: { tool: AtlasToolButton; button: HTMLButtonElement } | null = null;

  /** Shows these Atlas tools: random tables and asset manager in Play mode, command palette rightmost in every mode. */
  /**
   * Atlas 0.17's keyboard shortcuts button, in its own bar beside the toolbar: what it opens, its name and key. Null takes
   * the bar away (a board without Atlas's shortcut help).
   */
  setHelp(help: ToolbarHelp | null): void {
    const first = this.help === null && help !== null;
    this.help = help;
    this.helpBar.hidden = help === null;
    if (help) {
      this.helpButton.setAttribute('aria-label', help.label);
      if (first) this.viewTooltip.attach(this.helpButton.parentElement!, () => ({ label: this.help?.label ?? '', ...(this.help?.shortcut ? { shortcut: this.help.shortcut } : {}) }));
    }
    this.refreshHelp();
    this.fit();
  }

  private refreshHelp(): void {
    const on = this.help?.active() === true;
    this.helpButton.classList.toggle('is-active', on);
    this.helpButton.setAttribute('aria-pressed', String(on));
  }

  setAtlasTools(tools: readonly AtlasToolButton[]): void {
    const doc = this.row.ownerDocument;
    const groupTools = tools.filter((tool) => tool.id !== 'palette');
    const paletteTool = tools.find((tool) => tool.id === 'palette') ?? null;
    if (!this.atlasGroup) {
      this.atlasGroup = doc.win.createDiv();
      this.atlasGroup.className = 'atlas-tabletop-atlas-tools';
      this.atlasGroup.setCssStyles({ display: 'flex', alignItems: 'center', gap: 'inherit' });
      this.bar.insertBefore(this.atlasGroup, this.endSlot);
      this.fitOrder.splice(this.fitOrder.indexOf(this.endSlot), 0, this.atlasGroup);
    }
    const makeAtlasButton = (parent: HTMLElement, tool: AtlasToolButton, extraClass = ''): { tool: AtlasToolButton; button: HTMLButtonElement } => {
      const wrapper = doc.win.createDiv();
      wrapper.className = extraClass ? `atlas-tool-button ${extraClass}` : 'atlas-tool-button';
      const span = doc.win.createSpan();
      span.setCssStyles({ display: 'inline-flex' });
      const button = this.registerButton(`atlas-${tool.id}`, doc.win.createEl('button'));
      button.className = 'btn btn--toolbar btn--icon atlas-tabletop-tool-button';
      button.type = 'button';
      button.dataset.atlasTool = tool.id;
      setSvg(button, atlasToolIcon(tool.id));
      button.addEventListener('click', () => { if (tool.enabled()) tool.run(); this.refresh(); });
      span.appendChild(button);
      wrapper.appendChild(span);
      parent.appendChild(wrapper);
      return { tool, button };
    };
    this.forgetTips(this.atlasGroup);
    if (this.commandSlot) this.forgetTips(this.commandSlot);
    this.atlasGroup.replaceChildren();
    this.atlasButtons = groupTools.map((tool) => makeAtlasButton(this.atlasGroup!, tool));
    this.atlasGroup.hidden = groupTools.length === 0;
    this.commandSlot?.remove();
    this.commandSlot = null;
    this.commandButton = null;
    if (paletteTool) {
      const made = makeAtlasButton(this.bar, paletteTool, 'atlas-tabletop-command');
      this.commandSlot = made.button.closest('.atlas-tool-button') as HTMLElement;
      // The GM view switch keeps the bar's last place, after even the Command palette.
      this.bar.insertBefore(this.commandSlot, this.gmViewEnd);
      this.commandButton = made;
    }
    this.refresh();
    this.fit();
  }

  /** Shows which Atlas tool is open, and which need Atlas. */
  private refreshAtlasTools(): void {
    const entries = this.commandButton ? [...this.atlasButtons, this.commandButton] : this.atlasButtons;
    for (const { tool, button } of entries) {
      const enabled = tool.enabled();
      const label = enabled ? tool.label : `${tool.label} (${t('atlasTools.needsAtlas')})`;
      button.disabled = !enabled;
      button.classList.toggle('is-active', tool.active());
      button.setAttribute('aria-pressed', String(tool.active()));
      button.setAttribute('aria-label', label);
      this.setTip(button, { label: tool.label, ...(enabled ? {} : { subtitle: t('atlasTools.needsAtlas') }), ...(tool.shortcut ? { shortcut: tool.shortcut } : {}) });
    }
  }

  /**
   * Gives a control Atlas's tooltip (the browser's plain `title` never shows on the toolbar), or takes it away with null.
   * A spec may be a function when the words change; a tool button's tooltip stands on the span Atlas wraps it in, so a
   * disabled one still shows it.
   */
  private setTip(control: HTMLElement, spec: AtlasTooltipSpec | (() => AtlasTooltipSpec | null) | null): void {
    control.removeAttribute('title');
    const fresh = !this.tips.has(control);
    this.tips.set(control, spec);
    if (fresh) {
      const wrap = control.parentElement;
      const trigger = wrap?.tagName === 'SPAN' && wrap.parentElement?.classList.contains('atlas-tool-button') ? wrap : control;
      this.tipDetach.set(control, this.viewTooltip.attach(trigger, () => { const now = this.tips.get(control) ?? null; return typeof now === 'function' ? now() : now; }));
    } else {
      this.viewTooltip.refresh();
    }
  }

  /** A tooltip's words: the name, and its key as a keycap when it has one. */
  private keyedTip(label: string, shortcut: string | null | undefined): AtlasTooltipSpec {
    return shortcut ? { label, shortcut } : { label };
  }

  /** Takes the tooltips off every control inside `root`, which the caller is about to rebuild. */
  private forgetTips(root: HTMLElement): void {
    for (const [control, detach] of this.tipDetach) {
      if (!root.contains(control)) continue;
      detach();
      this.tipDetach.delete(control);
      this.tips.delete(control);
    }
  }

  /** A button in the end slot that opens its panel, the other toolbar panels (and the other end slot panels) shut. */
  private endButton(label: string, svg: string, handlers: DiceButton, className: string, after: (() => HTMLElement | null) | null, tip?: () => AtlasTooltipSpec): EndButton {
    const doc = this.row.ownerDocument;
    const anchor = doc.win.createDiv();
    anchor.className = `atlas-dropdown-menu ${className}`;
    const wrapper = doc.win.createDiv();
    wrapper.className = 'atlas-tool-button';
    const span = doc.win.createSpan();
    span.setCssStyles({ display: 'inline-flex' });
    const button = doc.win.createEl('button');
    button.className = 'btn btn--toolbar btn--icon atlas-tabletop-tool-button';
    button.type = 'button';
    setSvg(button, svg);
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-expanded', 'false');
    const made: EndButton = { handlers, anchor, button };
    button.addEventListener('click', () => {
      this.close();
      this.closeView();
      this.closeLaser();
      this.closeTemplate();
      this.closeLighting();
      for (const other of this.ends()) if (other !== made) other.handlers.close();
      this.sheetHandlers?.close();
      handlers.toggle();
      this.refresh();
    });
    span.appendChild(button);
    wrapper.appendChild(span);
    anchor.appendChild(wrapper);
    this.setTip(button, tip ?? { label });
    // Next to the button before it when that is there, else first in the slot.
    const beside = after?.() ?? null;
    if (beside) beside.after(anchor);
    else this.endSlot.prepend(anchor);
    this.refresh();
    return made;
  }

  closeDice(): void {
    for (const end of this.ends()) end.handlers.close();
    this.sheetHandlers?.close();
  }

  /** Shows the laser's options above the toolbar. */
  openLaser(): void {
    this.close();
    this.closeView();
    this.closeDice();
    this.showLaser();
    this.laserPanel.hidden = false;
    this.laserMenuButton.classList.add('atlas-is-active');
    this.laserMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  openTemplate(): void {
    this.closeView();
    this.closeLaser();
    this.closeDice();
    this.templatePanel.hidden = false;
    this.templateMenuButton.classList.add('atlas-is-active');
    this.templateMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  /**
   * Fits the bar to the pane: every tool back on the bar, then, while the bar is wider than the pane, the farthest tool
   * moves into the More tools menu. The Move group never leaves.
   */
  fit(): void {
    // The keyboard shortcuts bar stands in the board's bottom-right corner while the toolbar stays centred: the toolbar
    // keeps clear of it on both sides. Where even the smallest toolbar would not fit so, the bar steps aside (its key,
    // ?, still opens the help).
    this.helpBar.classList.remove('is-squeezed');
    if (!this.fitBar(this.helpBar.hidden ? 0 : 2 * (this.helpBar.getBoundingClientRect().width + 8)) && !this.helpBar.hidden) {
      this.helpBar.classList.add('is-squeezed');
      this.fitBar(0);
    }
  }

  /** Moves the tools farthest from Move into "More tools" until the bar fits beside `beside` px; false if it cannot. */
  private fitBar(beside: number): boolean {
    const room = Math.max(0, this.row.parentElement?.clientWidth ?? 0) - 32 - beside;
    if (room <= 0) return true;
    const wasOpen = !this.moreMenu.hidden;
    for (const item of this.fitOrder) this.bar.insertBefore(item, this.moreGroup);
    this.moreGroup.hidden = true;
    let moved = 0;
    for (let at = this.fitOrder.length - 1; at > 0 && this.bar.getBoundingClientRect().width > room; at--) {
      // The More button itself takes room once something is in it.
      this.moreGroup.hidden = false;
      this.moreMenu.prepend(this.fitOrder[at]);
      moved++;
    }
    if (moved === 0) this.closeMore();
    else if (wasOpen) this.moreMenu.hidden = false;
    this.moreGroup.hidden = moved === 0;
    return this.bar.getBoundingClientRect().width <= room;
  }

  openMore(): void {
    this.close();
    this.closeView();
    this.closeDice();
    this.closeLaser();
    this.closeLighting();
    this.moreMenu.hidden = false;
    this.moreButton.classList.add('is-active');
    this.moreButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeMore(): void {
    if (this.moreMenu.hidden) return;
    this.moreMenu.hidden = true;
    this.moreButton.classList.remove('is-active');
    this.moreButton.setAttribute('aria-expanded', 'false');
  }

  /** Shows the lighting choices above the toolbar. */
  openLighting(): void {
    this.close();
    this.closeView();
    this.closeWater();
    this.closeLaser();
    this.closeTemplate();
    this.closeDice();
    this.ambientInput.value = String(Math.round(this.actions.ambient() * 100));
    this.ambientValue.textContent = `${this.ambientInput.value}%`;
    // The light level is Atlas's scene lighting: with that off there is no level to set.
    const lit = this.actions.lightingOn?.() ?? true;
    this.ambientInput.disabled = !lit;
    this.setTip(this.ambientInput, lit ? null : { label: t('lighting.ambient'), subtitle: LIGHTING_OFF_TITLE });
    // Atlas disables Forget explored areas while its lighting is off; a map Atlas cannot do it on says so.
    if (this.forgetExploredButton) {
      const offered = this.actions.forgetExploredOffered?.() ?? true;
      this.forgetExploredButton.disabled = !lit || !offered;
      this.setTip(this.forgetExploredButton, offered ? null : { label: this.forgetExploredButton.textContent?.trim() ?? '', subtitle: t('fog.needsNewerAtlas') });
    }
    this.tintInput.value = this.actions.tint() ?? '#ffffff';
    this.tintReset.disabled = this.actions.tint() === null;
    this.tiltInput.checked = this.actions.tiltShift();
    this.occlusionInput.checked = this.actions.occlusion();
    this.lightingPanel.hidden = false;
    this.lightingButton.classList.add('is-active');
    this.lightingButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeLighting(): void {
    if (this.lightingPanel.hidden) return;
    this.lightingPanel.hidden = true;
    this.lightingButton.classList.remove('is-active');
    this.lightingButton.setAttribute('aria-expanded', 'false');
    this.syncWaterBar();
  }

  /** The paint tool's materials, as the library has them now: each a card; and taking a wall's material off. */
  openPaint(): void {
    this.close();
    this.closeView();
    this.closeLaser();
    this.closeLighting();
    this.closeWater();
    const doc = this.paintPanel.ownerDocument;
    this.forgetTips(this.paintPanel);
    this.paintPanel.replaceChildren();
    const hint = doc.createElement('div');
    hint.className = 'atlas-tabletop-palette__hint';
    hint.textContent = 'Click a wall or door to paint it (Shift: the whole wall). Esc or right-click stops.';
    const grid = doc.createElement('div');
    grid.className = 'atlas-tabletop-paint-grid';
    const card = (path: string, name: string, thumb: string | null, icon: string | null): void => {
      const made = doc.createElement('button');
      made.type = 'button';
      made.className = 'atlas-tabletop-paint-card';
      made.dataset.material = path;
      this.setTip(made, { label: name, subtitle: path === UNPAINT ? 'Take the material off walls' : path });
      const face = doc.createElement('span');
      face.className = 'atlas-tabletop-paint-thumb';
      if (thumb) { const img = doc.createElement('img'); img.src = thumb; img.alt = ''; img.draggable = false; face.appendChild(img); }
      else if (icon) setSvg(face, icon);
      const label = doc.createElement('span');
      label.className = 'atlas-tabletop-paint-name';
      label.textContent = name;
      made.append(face, label);
      made.addEventListener('click', () => { this.actions.setPainting?.(path); this.closePaint(); this.refresh(); });
      grid.appendChild(made);
    };
    card(UNPAINT, 'No material', null, modeIcon('unpaint'));
    const materials = this.actions.materials?.() ?? [];
    for (const material of materials) card(material.path, material.name, material.thumb, null);
    this.paintPanel.append(hint, grid);
    if (materials.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'atlas-tabletop-palette__hint';
      empty.textContent = 'No materials yet: import a Poly Haven zip in the Tabletop gallery.';
      this.paintPanel.appendChild(empty);
    }
    this.paintPanel.hidden = false;
    this.paintMenuButton.classList.add('atlas-is-active');
    this.paintMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
    this.refresh();
  }

  closePaint(): void {
    if (this.paintPanel.hidden) return;
    this.paintPanel.hidden = true;
    this.paintMenuButton.classList.remove('atlas-is-active');
    this.paintMenuButton.setAttribute('aria-expanded', 'false');
    this.syncWaterBar();
  }

  /** Opens or closes one of the Water bar's compact popovers (brush size, tint, motion). */
  private toggleWaterPopover(name: 'brush' | 'tint' | 'motion'): void {
    if (this.openWaterPopoverName === name) {
      this.closeWaterPopovers();
      return;
    }
    this.closeWaterPopovers();
    this.viewTooltip.hide();
    const pop = this.waterPopovers[name];
    pop.panel.hidden = false;
    pop.trigger.classList.add('atlas-is-active');
    pop.trigger.setAttribute('aria-expanded', 'true');
    this.openWaterPopoverName = name;
    this.syncWaterBar();
    const doc = this.row.ownerDocument;
    doc.addEventListener('pointerdown', this.onOutside, true);
    doc.addEventListener('keydown', this.onWaterKey, true);
  }

  /** Closes whichever Water bar popover is open, leaving the horizontal Water bar itself visible. */
  private closeWaterPopovers(): void {
    if (this.openWaterPopoverName === null) return;
    const pop = this.waterPopovers[this.openWaterPopoverName];
    pop.panel.hidden = true;
    pop.trigger.classList.remove('atlas-is-active');
    pop.trigger.setAttribute('aria-expanded', 'false');
    this.openWaterPopoverName = null;
    this.row.ownerDocument.removeEventListener('keydown', this.onWaterKey, true);
    this.dropOutsideIfClosed();
  }

  /** Syncs the Water button, its Fog-style horizontal bars, and popover controls with the board's current water state. */
  private syncWaterBar(): void {
    const mode = this.actions.mode?.() ?? null;
    const editing = mode === null || mode === 'edit';
    const waterMode = this.actions.waterTool?.() ?? null;
    if (waterMode) this.lastWaterMode = waterMode;
    this.waterButton.classList.toggle('is-active', waterMode !== null);
    this.waterButton.setAttribute('aria-pressed', String(waterMode !== null));
    const showBar = editing && waterMode !== null
      && this.viewPanel.hidden && this.panel.hidden && this.groundPanel.hidden
      && this.paintPanel.hidden && this.lightingPanel.hidden;
    if (!showBar) {
      this.closeWaterPopovers();
      if (!this.waterPanel.hidden) this.viewTooltip.hide();
    }
    this.waterPanel.hidden = !showBar;
    this.waterButton.setAttribute('aria-expanded', String(showBar));
    const liquid = this.actions.liquid?.() ?? 'water';
    for (const choice of this.waterPanel.querySelectorAll<HTMLButtonElement>('[data-liquid]')) {
      const active = choice.dataset.liquid === liquid;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
    }
    for (const choice of this.waterPanel.querySelectorAll<HTMLButtonElement>('[data-water]')) {
      const active = choice.dataset.water === waterMode;
      choice.classList.toggle('is-active', active);
      choice.setAttribute('aria-pressed', String(active));
    }
    this.nameLiquid(liquid);
    const tick = (on: boolean): string => (on ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
    const motion = this.actions.waterMotion?.();
    for (const choice of this.waterPanel.querySelectorAll<HTMLElement>('[data-lava-style]')) setSvg(choice.querySelector('.atlas-dropdown-menu-item__check')!, tick(choice.dataset.lavaStyle === (motion?.style ?? 'crust')));
    for (const choice of this.waterPanel.querySelectorAll<HTMLElement>('[data-motion]')) setSvg(choice.querySelector('.atlas-dropdown-menu-item__check')!, tick(choice.dataset.motion === motion?.kind));
    if (motion) {
      const amountPct = Math.round(motion.amount * 100);
      const dirDeg = Math.round(motion.direction);
      const clarityPct = Math.round(motion.clarity * 100);
      this.waterInputs.amount.value = String(amountPct);
      this.waterValues.amount.textContent = `${amountPct}%`;
      this.waterInputs.direction.value = String(dirDeg);
      this.waterValues.direction.textContent = `${dirDeg}°`;
      this.waterInputs.directionRow.style.display = motion.kind === 'flow' || motion.kind === 'waves' ? '' : 'none';
      this.waterInputs.clarity.value = String(clarityPct);
      this.waterValues.clarity.textContent = liquid === 'lava' ? 'Opaque' : `${clarityPct}%`;
      this.waterTintDot.style.backgroundColor = motion.tint;
      if (this.waterInputs.tint.value.toLowerCase() !== motion.tint) this.waterInputs.tint.value = motion.tint;
      for (const swatch of this.waterInputs.tints) {
        const chosen = swatch.dataset.tint === motion.tint;
        swatch.classList.toggle('atlas-swatch--active', chosen);
        swatch.setAttribute('aria-pressed', String(chosen));
        setSvg(swatch, chosen ? CHECK_SVG : '');
      }
    }
    const brushSize = this.actions.waterBrush?.() ?? 1;
    this.waterInputs.brush.value = String(brushSize);
    this.waterValues.brush.textContent = `${brushSize} sq`;
    // Scales from 4 px to 16 px like Atlas's FogToolBar BrushSizeDot.
    const share = Math.max(0, Math.min(1, (brushSize - 0.25) / (6 - 0.25)));
    const dot = Math.round(4 + share * 12);
    this.waterSizeDot.style.width = `${dot}px`;
    this.waterSizeDot.style.height = `${dot}px`;
    const fillPct = Math.round(this.actions.waterFill?.() ?? 30);
    if (this.waterFillInput) this.waterFillInput.value = String(fillPct);
    this.waterValues.fill.textContent = `${fillPct}%`;
    this.viewTooltip.refresh();
  }

  /** Syncs the GM view switch with the board's look: on in GM view, off in session view; there in Play and Edit mode, where the board has one. */
  private syncGmView(mode: BoardMode | null): void {
    // Play and Edit mode (a board without modes, which has no GM's view to switch, shows none).
    const offered = this.actions.gmView !== undefined && this.actions.setGmView !== undefined && (mode === 'play' || mode === 'edit');
    this.gmViewEnd.hidden = !offered;
    const on = this.actions.gmView?.() ?? true;
    this.syncPeek(mode, on);
    if (!offered) return;
    const state = on ? 'on' : 'off';
    this.gmViewSwitch.setAttribute('aria-checked', String(on));
    this.gmViewSwitch.replaceChildren();
    const doc = this.gmViewSwitch.ownerDocument;
    const track = doc.createElement('div');
    track.className = `atlas-toggle__switch atlas-toggle__switch--${state}`;
    const thumb = doc.createElement('div');
    thumb.className = `atlas-toggle__thumb atlas-toggle__thumb--${state}`;
    track.appendChild(thumb);
    this.gmViewSwitch.appendChild(track);
    setSvg(thumb, gmViewIcon(on));
    const key = this.actions.gmViewShortcut?.() ?? '';
    this.gmViewSwitch.setAttribute('aria-label', at('toolbar.gmView', { key }));
    this.gmViewEnd.querySelector('span')!.textContent = at('toolbar.gmView', { key });
  }

  /** Syncs the lighting peek's button: there for a finger, in Play and Edit mode; held while pressed, and taking no press in session view. */
  private syncPeek(mode: BoardMode | null, gmView: boolean): void {
    const stateOf = (): PeekButtonState => peekButtonState({ coarse: this.actions.coarse?.() === true, mode, hasPeek: this.actions.peek !== undefined && this.actions.gmView !== undefined, gmView, held: this.peekHeld });
    // The view left the GM's picture, or the button went, while it was held: the peek ends with it.
    const before = stateOf();
    if (this.peekHeld && (!before.shown || before.disabled)) { this.peekHeld = false; this.actions.peek?.(false); }
    const state = stateOf();
    this.peekButton.hidden = !state.shown;
    this.peekButton.setAttribute('aria-pressed', String(state.pressed));
    if (state.disabled) this.peekButton.setAttribute('aria-disabled', 'true'); else this.peekButton.removeAttribute('aria-disabled');
    this.peekButton.classList.toggle('is-active', state.pressed);
    this.peekButton.classList.toggle('atlas-tool-button--disabled', state.disabled);
  }

  /** Syncs the Fog Tool button (its face is the mode in use) and its two bars with the fog tool. */
  private syncFogBar(): void {
    const fog = this.actions.fog;
    if (!fog || !this.fogBars) return;
    const state = fog.state();
    const mode = this.actions.mode?.() ?? null;
    const editing = mode === null || mode === 'edit';
    const face = state.mode === 'eraser' ? 'eraser' : 'fog';
    if (this.fogFace !== face) {
      this.fogFace = face;
      setSvg(this.fogButton, fogIcon(face));
      this.fogButton.setAttribute('aria-label', face === 'eraser' ? at('toolbar.fogEraser') : at('toolbar.fogTool'));
    }
    this.fogButton.classList.toggle('is-active', state.on);
    this.fogButton.setAttribute('aria-pressed', String(state.on));
    const showBar = editing && state.on
      && this.viewPanel.hidden && this.panel.hidden && this.groundPanel.hidden
      && this.paintPanel.hidden && this.lightingPanel.hidden;
    this.fogBars.show(showBar);
    this.fogButton.setAttribute('aria-expanded', String(showBar));
    this.viewTooltip.refresh();
  }

  closeWater(): void {
    this.closeWaterPopovers();
    if (this.waterPanel.hidden) return;
    this.waterPanel.hidden = true;
    this.waterButton.setAttribute('aria-expanded', 'false');
    this.viewTooltip.hide();
  }

  /** Current Measure tool options (with `DEFAULT_MEASURE_TOOL` fallback). */
  private measureOptions(): MeasureToolOptions {
    const base = this.actions.measureOptions?.();
    if (base) return base;
    return { ...DEFAULT_MEASURE_TOOL, mode: this.actions.measureShape?.() ?? DEFAULT_MEASURE_TOOL.mode };
  }

  /** Opens or closes the Measure bar's Look dropdown (colours and effects). */
  private toggleMeasureLook(): void {
    if (this.measureLookOpen) {
      this.closeMeasureLook();
      return;
    }
    this.viewTooltip.hide();
    this.measureLookPanel.hidden = false;
    this.measureLookTrigger.classList.add('atlas-is-active');
    this.measureLookTrigger.setAttribute('aria-expanded', 'true');
    this.measureLookOpen = true;
    this.syncMeasureBar();
    const doc = this.row.ownerDocument;
    doc.addEventListener('pointerdown', this.onOutside, true);
    doc.addEventListener('keydown', this.onMeasureKey, true);
  }

  /** Closes the Measure bar's Look dropdown, keeping the horizontal Measure bars open. */
  private closeMeasureLook(): void {
    if (!this.measureLookOpen) return;
    this.measureLookPanel.hidden = true;
    this.measureLookTrigger.classList.remove('atlas-is-active');
    this.measureLookTrigger.setAttribute('aria-expanded', 'false');
    this.measureLookOpen = false;
    this.row.ownerDocument.removeEventListener('keydown', this.onMeasureKey, true);
    this.dropOutsideIfClosed();
  }

  /** Syncs the Measure toolbar face, chevron dropdown, and two horizontal bars with current state. */
  private syncMeasureBar(): void {
    const mode = this.actions.mode?.() ?? null;
    const playing = mode === null || mode === 'play';
    const measureOn = this.actions.measureOn?.() === true;
    const opts = this.measureOptions();
    const activeMode: MeasureMode = isMeasureShape(opts.mode) ? opts.mode : 'ruler';

    // Toolbar face shows the active mode's icon and pressed state.
    setSvg(this.measureButton, atlasMeasureIcon(activeMode));
    this.measureButton.classList.toggle('is-active', measureOn);
    this.measureButton.setAttribute('aria-pressed', String(measureOn));

    // Chevron dropdown: drag distance segmented control + Measurement rules.
    const drag = this.actions.dragDistance?.() ?? 'always';
    for (const { value, button } of this.measureDragButtons) {
      const chosen = value === drag;
      button.classList.toggle('atlas-active', chosen);
      button.setAttribute('aria-checked', String(chosen));
    }
    const canRules = this.actions.openMeasureRules !== undefined && this.actions.canOpenMeasureRules?.() !== false;
    this.measureRulesButton.disabled = !canRules;
    this.setTip(this.measureRulesButton, canRules ? null : { label: t('toolbar.measureRules'), subtitle: t('toolbar.measureRulesAtlasOnly') });

    // Horizontal bars above toolbar while Measure is chosen and no modal panel covers them.
    const showBar = playing && measureOn
      && this.viewPanel.hidden && this.panel.hidden && this.groundPanel.hidden
      && this.paintPanel.hidden && this.lightingPanel.hidden;
    if (!showBar) {
      this.closeMeasureLook();
      if (!this.measureBarsPanel.hidden) this.viewTooltip.hide();
    }
    this.measureBarsPanel.hidden = !showBar;
    this.measureButton.setAttribute('aria-expanded', String(showBar));

    // Bar 1: modes in Atlas order.
    const rangesWhy = this.actions.rangesUnavailable?.() ?? t('toolbar.rangesNoRules');
    for (const { mode: one, button } of this.measureModeButtons) {
      const unavailable = one === 'ranges' && rangesWhy !== null;
      const active = !unavailable && one === activeMode;
      button.disabled = unavailable;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    // Bar 2: Keep, Players see it, Look (dot or effect glyph), Clear.
    this.measureKeepButton.classList.toggle('is-active', opts.keep);
    this.measureKeepButton.setAttribute('aria-pressed', String(opts.keep));
    setSvg(this.measurePlayersButton, atlasMeasureControlIcon(opts.players ? 'eye' : 'eyeOff'));
    this.measurePlayersButton.classList.toggle('is-active', opts.players);
    this.measurePlayersButton.setAttribute('aria-pressed', String(opts.players));

    const swatchColor = swatchOfMeasureColor(opts.color);
    this.measureLookTrigger.replaceChildren();
    if (opts.effect) {
      setSvg(this.measureLookTrigger, atlasMeasureEffectIcon(opts.effect));
      const svg = this.measureLookTrigger.querySelector('svg');
      if (svg) svg.style.color = swatchColor;
    } else {
      const dot = this.measureLookTrigger.ownerDocument.createElement('span');
      dot.className = 'atlas-tool-bar__dot';
      dot.style.backgroundColor = swatchColor;
      this.measureLookTrigger.appendChild(dot);
    }
    for (const swatch of this.measureLookSwatches) {
      const chosen = swatch.dataset.swatch?.toLowerCase() === swatchColor.toLowerCase();
      swatch.classList.toggle('atlas-swatch--active', chosen);
      swatch.setAttribute('aria-pressed', String(chosen));
      setSvg(swatch, chosen ? CHECK_SVG : '');
    }
    const effectGrid = this.measureLookPanel.querySelector<HTMLElement>('.atlas-light-popover__kinds');
    if (effectGrid) effectGrid.style.setProperty('--atlas-light-tint', swatchColor);
    for (const { effect, button } of this.measureEffectButtons) {
      const chosen = effect === opts.effect;
      button.setAttribute('aria-pressed', String(chosen));
    }

    const anyKept = this.actions.hasKeptMeasures?.() === true;
    this.measureClearButton.disabled = !anyKept;
    this.viewTooltip.refresh();
  }

  openMeasure(): void {
    this.close();
    this.closeView();
    this.closeGround();
    this.closeLaser();
    this.closeLighting();
    this.closePaint();
    this.closeTemplate();
    this.closeDice();
    this.closeMore();
    this.closeMeasureLook();
    this.syncMeasureBar();
    this.measurePanel.hidden = false;
    this.measureMenuButton.classList.add('atlas-is-active');
    this.measureMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeMeasure(): void {
    if (this.measurePanel.hidden) return;
    this.measurePanel.hidden = true;
    this.measureMenuButton.classList.remove('atlas-is-active');
    this.measureMenuButton.setAttribute('aria-expanded', 'false');
    this.dropOutsideIfClosed();
  }

  closeTemplate(): void {
    if (this.templatePanel.hidden) return;
    this.templatePanel.hidden = true;
    this.templateMenuButton.classList.remove('atlas-is-active');
    this.templateMenuButton.setAttribute('aria-expanded', 'false');
  }

  closeLaser(): void {
    if (this.laserPanel.hidden) return;
    this.laserPanel.hidden = true;
    this.laserMenuButton.classList.remove('atlas-is-active');
    this.laserMenuButton.setAttribute('aria-expanded', 'false');
    this.dropOutsideIfClosed();
  }

  /** The options as the laser is set now: the chosen swatch ticked, the size. */
  private showLaser(): void {
    const { color, size } = this.actions.laser();
    for (const swatch of this.swatches) {
      const chosen = swatch.dataset.value?.toLowerCase() === color.toLowerCase();
      swatch.classList.toggle('atlas-swatch--active', chosen);
      swatch.setAttribute('aria-pressed', String(chosen));
      setSvg(swatch, chosen ? CHECK_SVG : '');
    }
    const share = (size - LASER_SIZE_MIN) / (LASER_SIZE_MAX - LASER_SIZE_MIN);
    this.sliderRange.setCssStyles({ left: '0' });
    this.sliderRange.style.right = `${(1 - share) * 100}%`;
    // As Radix places its thumb: along the track, kept inside it at both ends.
    (this.sliderThumb.parentElement as HTMLElement).style.left = `calc(${share * 100}% + ${THUMB_PX / 2 - share * THUMB_PX}px)`;
    this.sliderThumb.setAttribute('aria-valuenow', String(size));
    this.sizeValue.textContent = `${size}px`;
  }

  /** Hides the whole toolbar (a Connect player's board, whose tab has its own). */
  setHidden(hidden: boolean): void {
    this.row.hidden = hidden;
    // The row lays itself out as flex, which `hidden` alone does not undo.
    this.row.style.display = hidden ? 'none' : '';
    if (hidden) { this.close(); this.closeView(); }
  }

  /** Marks the chosen wall edges in the settings. */
  private showEdges(chosen: WallEdges): void {
    for (const { value, button } of this.edgeButtons) button.classList.toggle('is-active', value === chosen);
    for (const { value, button } of this.edgeButtons) button.setAttribute('aria-pressed', String(value === chosen));
  }

  private showLayerLook(chosen: LayerLook): void {
    for (const { value, button } of this.layerButtons) {
      button.classList.toggle('is-active', value === chosen);
      button.setAttribute('aria-pressed', String(value === chosen));
    }
  }

  open(): void {
    this.closeLaser();
    this.closeView();
    this.closeWater();
    this.closeGround();
    // The panels of the end slot (the dice tray, the log, an unpinned sheet) give way to this one.
    this.closeDice();
    this.fill();
    this.panel.hidden = false;
    this.button.classList.add('is-active');
    this.button.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
    this.heightInput.focus();
    this.heightInput.select();
  }

  /** Shows the Visibility icon bar above the toolbar. */
  openView(): void {
    this.close();
    this.closeGround();
    this.closeLaser();
    this.closeLighting();
    this.closePaint();
    this.closeWater();
    this.closeMeasure();
    this.closeTemplate();
    this.closeMore();
    for (const end of this.ends()) end.handlers.close();
    this.viewPanel.hidden = false;
    this.viewButton.classList.add('is-active');
    this.viewButton.setAttribute('aria-expanded', 'true');
    this.syncViewBar();
    this.syncMeasureBar();
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeView(): void {
    this.setSizeMode(false);
    this.cancelOutsideCanvas();
    this.viewTooltip.hide();
    if (this.viewPanel.hidden) return;
    this.viewPanel.hidden = true;
    this.viewButton.classList.remove('is-active');
    this.viewButton.setAttribute('aria-expanded', 'false');
    this.syncWaterBar();
    this.syncMeasureBar();
    this.dropOutsideIfClosed();
  }

  /** Keeps the on-board see-through resize ring aligned with the camera's pivot while size mode is active. */
  syncOverlay(): void {
    if (!this.sizeMode) return;
    this.seeThroughRing.sync();
  }

  /** Starts or ends on-board window-size mode (the draggable circle on the canvas). */
  private setSizeMode(on: boolean): void {
    const doc = this.row.ownerDocument;
    if (on) {
      if (this.actions.setSeeThroughSize === undefined || this.actions.seeThroughCircle === undefined) return;
      if (!this.seeThroughRing.setOpen(true)) return;
      this.sizeMode = true;
      doc.addEventListener('keydown', this.onSizeKey, true);
    } else {
      if (!this.sizeMode && !this.seeThroughRing.isOpen) return;
      this.sizeMode = false;
      this.seeThroughRing.setOpen(false);
      doc.removeEventListener('keydown', this.onSizeKey, true);
      this.cancelOutsideCanvas();
    }
    this.seeThroughSizeButton.classList.toggle('is-active', this.sizeMode);
    this.seeThroughSizeButton.setAttribute('aria-pressed', String(this.sizeMode));
    this.updateSizeTooltip();
  }

  private updateSizeTooltip(unavailable = this.seeThroughSizeButton.disabled): void {
    const squares = readSeeThroughSize(this.actions.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE);
    const label = unavailable
      ? `Window size: ${squares.toFixed(1)} squares (unavailable in first-person or AR view)`
      : `Window size: ${squares.toFixed(1)} squares — drag the circle's edge on the board (shown at the pivot)`;
    this.seeThroughSizeButton.setAttribute('aria-label', label);
    this.viewTooltip.refresh();
  }

  /** Refreshes the Visibility bar's buttons and groups from the board's current actions and camera view. */
  private syncViewBar(): void {
    const hasSeeThrough = this.actions.setSeeThrough !== undefined;
    const seeThroughWrapper = this.seeThroughButton.closest<HTMLElement>('.atlas-tool-button');
    seeThroughWrapper?.toggleAttribute('hidden', !hasSeeThrough);
    const seeThroughOn = this.actions.seeThrough?.() === true;
    this.seeThroughButton.classList.toggle('is-active', seeThroughOn);
    this.seeThroughButton.setAttribute('aria-pressed', String(seeThroughOn));

    const hasSize = this.actions.setSeeThroughSize !== undefined && this.actions.seeThroughCircle !== undefined;
    const sizeWrapper = this.seeThroughSizeButton.closest<HTMLElement>('.atlas-tool-button');
    sizeWrapper?.toggleAttribute('hidden', !hasSize);
    const canCut = hasSize && this.actions.seeThroughCircle?.() !== null;
    if (!canCut && this.sizeMode) this.setSizeMode(false);
    this.seeThroughSizeButton.disabled = !canCut;
    this.seeThroughSizeButton.classList.toggle('is-active', this.sizeMode);
    this.seeThroughSizeButton.setAttribute('aria-pressed', String(this.sizeMode));
    this.updateSizeTooltip(!canCut);
    this.seeThroughGroup.hidden = !hasSeeThrough && !hasSize;

    const hasLayers = this.actions.setLayerLook !== undefined;
    this.layerGroup.hidden = !hasLayers;
    this.showLayerLook(this.actions.layerLook?.() ?? DEFAULT_LAYER_LOOK);

    const initiativeOpen = this.actions.initiativeOpen();
    this.initiativeButton.classList.toggle('is-active', initiativeOpen);
    this.initiativeButton.setAttribute('aria-pressed', String(initiativeOpen));

    const hasSheet = this.sheetHandlers !== null;
    this.sheetButton.closest<HTMLElement>('.atlas-tool-button')?.toggleAttribute('hidden', !hasSheet);
    const sheetOpen = this.sheetHandlers?.isOpen() === true;
    this.sheetButton.classList.toggle('is-active', sheetOpen);
    this.sheetButton.setAttribute('aria-pressed', String(sheetOpen));

    this.viewSep1.hidden = this.seeThroughGroup.hidden || this.layerGroup.hidden;
    this.viewSep2.hidden = this.seeThroughGroup.hidden && this.layerGroup.hidden;
    if (this.sizeMode) this.seeThroughRing.sync();
  }

  private trackOutsideCanvas(event: PointerEvent): void {
    this.cancelOutsideCanvas();
    this.outsideCanvas = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    const doc = this.row.ownerDocument;
    doc.addEventListener('pointermove', this.onOutsideMove, true);
    doc.addEventListener('pointerup', this.onOutsideUp, true);
    doc.addEventListener('pointercancel', this.onOutsideUp, true);
  }

  private cancelOutsideCanvas(): void {
    if (!this.outsideCanvas) return;
    this.outsideCanvas = null;
    const doc = this.row.ownerDocument;
    doc.removeEventListener('pointermove', this.onOutsideMove, true);
    doc.removeEventListener('pointerup', this.onOutsideUp, true);
    doc.removeEventListener('pointercancel', this.onOutsideUp, true);
  }

  private dropOutsideIfClosed(): void {
    if (this.panel.hidden && this.viewPanel.hidden && this.groundPanel.hidden && this.laserPanel.hidden && this.measurePanel.hidden && this.lightingPanel.hidden && this.paintPanel.hidden && this.openWaterPopoverName === null && this.fogBars?.popoverOpen !== true && !this.measureLookOpen && this.templatePanel.hidden && this.moreMenu.hidden) {
      this.row.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
    }
  }

  /** Shows the Ground panel above the toolbar: the map's background, as it is set now. */
  openGround(): void {
    this.close();
    this.closeView();
    this.closeWater();
    this.closeLaser();
    this.closeDice();
    this.fillGround();
    this.groundPanel.hidden = false;
    this.groundButton.classList.add('is-active');
    this.groundButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeGround(): void {
    if (this.groundPanel.hidden) return;
    this.groundPanel.hidden = true;
    this.groundButton.classList.remove('is-active');
    this.groundButton.setAttribute('aria-expanded', 'false');
    this.syncWaterBar();
  }

  /** The two panels' fields as the board has them now. */
  private readonly tableSection: HTMLElement;
  private readonly tableHint: HTMLElement;
  private readonly tableButton: HTMLButtonElement;

  /** The Ground section as the map's settings are now (the material list read again: the gallery may have more). */
  /** The brush's bar named for its liquid: its modes, motions and tint, the liquid's presets, no clarity for lava. */
  private nameLiquid(liquid: LiquidKind): void {
    const ui = this.liquidUi;
    const name = LIQUID_NAMES[liquid].toLowerCase();
    ui.modes.get('paint')!.setAttribute('aria-label', `Paint ${name}`);
    ui.modes.get('fill')!.setAttribute('aria-label', `Fill ${name}`);
    for (const [kind, label] of ui.motions) label.textContent = MOTION_LABELS[liquid][kind];
    ui.motionLabel.textContent = `Motion (all ${name} on this map)`;
    ui.tintLabel.textContent = `Tint (all ${name} on this map)`;
    this.waterButton.setAttribute('aria-label', liquid === 'water' ? 'Water' : `Water (${name})`);
    if (ui.tintsOf !== liquid) { ui.makeTints(liquid); ui.tintsOf = liquid; }
    // Only lava has kinds.
    const styles = this.waterPanel.querySelector<HTMLElement>('.atlas-tabletop-lava-styles');
    if (styles) styles.hidden = liquid !== 'lava';
    // Lava is never clear: the row stays, shown off, so the menu keeps its shape.
    if (ui.clarityRow) {
      ui.clarityRow.classList.toggle('is-disabled', liquid === 'lava');
      ui.clarityRow.querySelector('input')!.disabled = liquid === 'lava';
    }
  }

  private fillGround(): void {
    const ui = this.groundUi;
    const ground = this.actions.ground?.();
    if (!ui || !ground) return;
    for (const { value, button } of ui.modes) { button.classList.toggle('is-active', value === ground.mode); button.setAttribute('aria-pressed', String(value === ground.mode)); }
    for (const { row, modes } of ui.rows) row.hidden = !modes.includes(ground.mode);
    // The liquid to the horizon's own settings (the water's while the mode is no liquid).
    const liquid: LiquidKind = ground.mode === 'lava' || ground.mode === 'acid' ? ground.mode : 'water';
    const motion = ground[liquid];
    for (const option of ui.water.kind.options) option.textContent = MOTION_LABELS[liquid][option.value as WaterMotionKind];
    ui.water.kind.value = motion.kind;
    ui.water.style.value = ground.lava.style ?? 'crust';
    ui.water.amount.value = String(Math.round(motion.amount * 100));
    ui.water.direction.value = String(Math.round(motion.direction));
    if (ground.mode === liquid) ui.water.directionRow.hidden = motion.kind !== 'flow' && motion.kind !== 'waves';
    ui.water.clarity.value = String(Math.round(motion.clarity * 100));
    ui.water.tint.value = motion.tint;
    if (ui.water.presets.dataset.liquid !== liquid) ui.water.makePresets(liquid);
    for (const swatch of ui.water.presets.querySelectorAll<HTMLElement>('[data-tint]')) swatch.classList.toggle('atlas-swatch--active', swatch.dataset.tint === motion.tint);
    const doc = ui.material.ownerDocument;
    ui.material.replaceChildren();
    const plain = doc.createElement('option');
    plain.value = '';
    plain.textContent = 'Plain ground';
    ui.material.append(plain);
    for (const one of this.actions.materials?.() ?? []) { const option = doc.createElement('option'); option.value = one.path; option.textContent = one.name; ui.material.append(option); }
    ui.material.value = ground.material ?? '';
    ui.background.replaceChildren();
    const choose = doc.createElement('option');
    choose.value = '';
    choose.textContent = 'Choose a background…';
    ui.background.append(choose);
    for (const one of this.actions.backgrounds?.() ?? []) { const option = doc.createElement('option'); option.value = one.folder; option.textContent = one.name; ui.background.append(option); }
    // A folder no longer in the list shows "Choose a background…", not a blank select.
    ui.background.value = [...ui.background.options].some((option) => option.value === ground.background) ? ground.background ?? '' : '';
    ui.noise.value = ground.noise;
    ui.strength.value = String(Math.round(ground.strength * 100));
    ui.strengthValue.textContent = `${ui.strength.value}%`;
    ui.fogOn.checked = ground.fog > 0;
    ui.fog.disabled = ground.fog <= 0;
    if (ground.fog > 0) ui.fog.value = String(ground.fog);
    ui.fogValue.textContent = ground.fog <= 0 ? 'off' : String(ground.fog);
    ui.margin.value = String(ground.margin);
    ui.marginValue.textContent = `${ground.margin} sq`;
    ui.tile.value = String(ground.tile);
    ui.tileValue.textContent = `${ground.tile} sq`;
  }

  private fill(): void {
    const sheets = this.actions.arTableSheets?.() ?? null;
    this.tableSection.hidden = this.actions.placeArTable === undefined;
    this.tableButton.disabled = sheets === null;
    this.tableHint.textContent = sheets === null
      ? 'None yet: a player sends one from their phone (AR menu, Send this table to the GM).'
      : `${sheets} sheet${sheets === 1 ? '' : 's'} surveyed by the players.`;    this.heightInput.value = String(this.actions.fogHeight());
    this.heightInput.removeAttribute('aria-invalid');
    this.thicknessInput.value = String(this.actions.wallThickness());
    this.thicknessInput.removeAttribute('aria-invalid');
    this.showEdges(this.actions.wallEdges?.() ?? DEFAULT_EDGES);
    const snap = this.actions.snap?.() ?? { tokens: true, props: true };
    for (const { kind, input } of this.snapToggles) { input.checked = snap[kind]; input.closest('.atlas-tabletop-palette__section')?.toggleAttribute('hidden', this.actions.setSnap === undefined); }
    this.edgeButtons[0]?.button.closest('.atlas-tabletop-palette__field')?.toggleAttribute('hidden', this.actions.setWallEdges === undefined);
    this.autoRollToggle.checked = this.actions.autoRoll();
  }

  close(): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.button.classList.remove('is-active');
    this.button.setAttribute('aria-expanded', 'false');
    this.syncWaterBar();
    this.dropOutsideIfClosed();
  }

  dispose(): void {
    this.close();
    this.closeView();
    this.closeWater();
    this.closeMeasure();
    this.closeMeasureLook();
    this.closeGround();
    this.closeLaser();
    this.row.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
    this.row.ownerDocument.removeEventListener('keydown', this.onWaterKey, true);
    this.fogBars?.dispose();
    this.row.ownerDocument.removeEventListener('keydown', this.onMeasureKey, true);
    this.seeThroughRing.dispose();
    this.viewTooltip.dispose();
    this.setDice(null);
    this.setDiceLog(null);
    this.setSheet(null);
    this.setCinema(null);
    this.fitWatch.disconnect();
    this.row.remove();
  }
}
