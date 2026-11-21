/**
 * The icons of Atlas's toolbar buttons, exactly as Atlas draws them (`packages/components/toolbar/toolbarControls.tsx`):
 * Atlas's own coin mark (copied) and lucide-react at Atlas's version, rendered once to SVG markup for the board's toolbar.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Ban, Brush, Circle, CircleHelp, Clapperboard, Check, Cloud, CloudFog, CloudOff, Command, DoorOpen, Droplets, Eraser, Eye, EyeOff, Flame, FlaskConical, Grid3x3, Hammer,
  ImageIcon, Lasso, LayoutGrid, Moon, MoreHorizontal, PaintBucket, PaintRoller, Paintbrush, Pentagon, Pin, Redo2, Ruler, Slash, SlidersHorizontal, Snowflake,
  Square, Sun, Swords, Target, Trash2, Triangle, Undo2, Waves, X, Zap,
} from 'lucide-react';
import { CoinIcon } from '../atlasPort/app/react/components/CoinIcon';
import type { MeasureEffect } from '../atlasPort/app/measure/measureEffects';
import type { MeasureMode } from '../atlasPort/app/measure/measureTypes';
import type { AtlasToolId } from './atlasTools';

let icons: Record<AtlasToolId, string> | null = null;

/** Atlas's Measure tool modes (`measureToolChoices.ts`): Ruler, Circle, Cone, Square, Line, Ranges. */
export type MeasureIconId = 'tool' | MeasureMode;
let measure: Record<MeasureIconId, string> | null = null;
export function atlasMeasureIcon(id: MeasureIconId): string {
  measure ??= {
    tool: renderToStaticMarkup(<Ruler />),
    ruler: renderToStaticMarkup(<Ruler />),
    circle: renderToStaticMarkup(<Circle />),
    cone: renderToStaticMarkup(<Triangle />),
    square: renderToStaticMarkup(<Square />),
    line: renderToStaticMarkup(<Slash />),
    ranges: renderToStaticMarkup(<Target />),
  };
  return measure[id];
}

/** Atlas's Measure bar controls (`MeasureToolBar.tsx` and `MeasureToolGroup.tsx`). */
export type MeasureControlIconId = 'pin' | 'eye' | 'eyeOff' | 'trash' | 'rules';
let measureControl: Record<MeasureControlIconId, string> | null = null;
export function atlasMeasureControlIcon(id: MeasureControlIconId): string {
  measureControl ??= {
    pin: renderToStaticMarkup(<Pin />),
    eye: renderToStaticMarkup(<Eye />),
    eyeOff: renderToStaticMarkup(<EyeOff />),
    trash: renderToStaticMarkup(<Trash2 />),
    rules: renderToStaticMarkup(<SlidersHorizontal />),
  };
  return measureControl[id];
}

/** Atlas's Measure effect glyphs (`MeasureEffectChips.tsx`): None plus the six effects. */
export type MeasureEffectIconId = 'none' | MeasureEffect;
let measureEffect: Record<MeasureEffectIconId, string> | null = null;
export function atlasMeasureEffectIcon(id: MeasureEffectIconId): string {
  measureEffect ??= {
    none: renderToStaticMarkup(<Ban className="atlas-light-glyph" aria-hidden="true" />),
    fire: renderToStaticMarkup(<Flame className="atlas-light-glyph" aria-hidden="true" />),
    frost: renderToStaticMarkup(<Snowflake className="atlas-light-glyph" aria-hidden="true" />),
    lightning: renderToStaticMarkup(<Zap className="atlas-light-glyph" aria-hidden="true" />),
    mist: renderToStaticMarkup(<CloudFog className="atlas-light-glyph" aria-hidden="true" />),
    radiance: renderToStaticMarkup(<Sun className="atlas-light-glyph" aria-hidden="true" />),
    shadow: renderToStaticMarkup(<Moon className="atlas-light-glyph" aria-hidden="true" />),
  };
  return measureEffect[id];
}

/** The water brush's icons (lucide, as Atlas's FogToolBar): its face, liquids, brush modes and more menu. */
export type WaterIconId = 'tool' | 'paint' | 'erase' | 'fill' | 'water' | 'lava' | 'acid' | 'more';
let water: Record<WaterIconId, string> | null = null;
export function waterIcon(id: WaterIconId): string {
  water ??= {
    tool: renderToStaticMarkup(<Waves />),
    paint: renderToStaticMarkup(<Brush />),
    erase: renderToStaticMarkup(<Eraser />),
    fill: renderToStaticMarkup(<PaintBucket />),
    water: renderToStaticMarkup(<Droplets />),
    lava: renderToStaticMarkup(<Flame />),
    acid: renderToStaticMarkup(<FlaskConical />),
    more: renderToStaticMarkup(<MoreHorizontal />),
  };
  return water[id];
}

/** The fog tool's icons (lucide, as Atlas's `FogToolBar` and `fogToolChoices.ts` use them): the button's two faces, the shapes, the actions, the menu. */
export type FogIconId = 'fog' | 'eraser' | 'brush' | 'rectangle' | 'polygon' | 'lasso' | 'cells' | 'room' | 'cover' | 'delete' | 'more' | 'rooms' | 'on' | 'off';
let fog: Record<FogIconId, string> | null = null;
export function fogIcon(id: FogIconId): string {
  fog ??= {
    fog: renderToStaticMarkup(<Cloud />),
    eraser: renderToStaticMarkup(<Eraser />),
    brush: renderToStaticMarkup(<Paintbrush />),
    rectangle: renderToStaticMarkup(<Square />),
    polygon: renderToStaticMarkup(<Pentagon />),
    lasso: renderToStaticMarkup(<Lasso />),
    cells: renderToStaticMarkup(<Grid3x3 />),
    room: renderToStaticMarkup(<DoorOpen />),
    cover: renderToStaticMarkup(<PaintBucket />),
    delete: renderToStaticMarkup(<CloudOff />),
    more: renderToStaticMarkup(<MoreHorizontal />),
    rooms: renderToStaticMarkup(<LayoutGrid />),
    on: renderToStaticMarkup(<Check className="atlas-toggle__icon" />),
    off: renderToStaticMarkup(<X className="atlas-toggle__icon" />),
  };
  return fog[id];
}

/** The board's three modes (Play, Edit, Cinematic) and the wall paint tool (painting, taking a material off). */
let modes: Record<'play' | 'edit' | 'cinematic' | 'paint' | 'unpaint' | 'view', string> | null = null;
export function modeIcon(id: 'play' | 'edit' | 'cinematic' | 'paint' | 'unpaint' | 'view'): string {
  modes ??= { play: renderToStaticMarkup(<Swords />), edit: renderToStaticMarkup(<Hammer />), cinematic: renderToStaticMarkup(<Clapperboard />), paint: renderToStaticMarkup(<PaintRoller />), unpaint: renderToStaticMarkup(<Eraser />), view: renderToStaticMarkup(<Eye />) };
  return modes[id];
}

/** Atlas's undo/redo bar's icons (`UndoRedoControls.tsx`). */
let history: Record<'undo' | 'redo', string> | null = null;
export function historyIcon(id: 'undo' | 'redo'): string {
  history ??= { undo: renderToStaticMarkup(<Undo2 />), redo: renderToStaticMarkup(<Redo2 />) };
  return history[id];
}

/** Atlas 0.17's keyboard shortcuts button (its bar beside the toolbar): lucide's `circle-help`. */
let help: string | null = null;
export function helpIcon(): string {
  help ??= renderToStaticMarkup(<CircleHelp />);
  return help;
}

export function atlasToolIcon(id: AtlasToolId): string {
  icons ??= {
    loot: renderToStaticMarkup(<CoinIcon />),
    assets: renderToStaticMarkup(<ImageIcon />),
    palette: renderToStaticMarkup(<Command />),
  };
  return icons[id];
}
