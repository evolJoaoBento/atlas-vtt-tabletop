/**
 * The icons of Atlas's toolbar buttons, exactly as Atlas draws them (`packages/components/toolbar/toolbarControls.tsx`):
 * Atlas's own coin mark (copied) and lucide-react at Atlas's version, rendered once to SVG markup for the board's toolbar.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { Brush, Circle, Clapperboard, Command, Eraser, Eye, Hammer, ImageIcon, PaintBucket, PaintRoller, Redo2, Ruler, Swords, Triangle, Undo2, Waves } from 'lucide-react';
import { CoinIcon } from '../atlasPort/app/react/components/CoinIcon';
import type { AtlasToolId } from './atlasTools';

let icons: Record<AtlasToolId, string> | null = null;

/** Atlas's Measure tool group's icons (`MeasureToolGroup.tsx`): its face and its three shapes. */
let measure: Record<'tool' | 'line' | 'circle' | 'cone', string> | null = null;
export function atlasMeasureIcon(id: 'tool' | 'line' | 'circle' | 'cone'): string {
  measure ??= {
    tool: renderToStaticMarkup(<Ruler />), line: renderToStaticMarkup(<Ruler />),
    circle: renderToStaticMarkup(<Circle />), cone: renderToStaticMarkup(<Triangle />),
  };
  return measure[id];
}

/** The water brush's icons (lucide, as Atlas's other tools): its face, painting and erasing. */
let water: Record<'tool' | 'paint' | 'erase' | 'fill', string> | null = null;
export function waterIcon(id: 'tool' | 'paint' | 'erase' | 'fill'): string {
  water ??= { tool: renderToStaticMarkup(<Waves />), paint: renderToStaticMarkup(<Brush />), erase: renderToStaticMarkup(<Eraser />), fill: renderToStaticMarkup(<PaintBucket />) };
  return water[id];
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

export function atlasToolIcon(id: AtlasToolId): string {
  icons ??= {
    loot: renderToStaticMarkup(<CoinIcon />),
    assets: renderToStaticMarkup(<ImageIcon />),
    palette: renderToStaticMarkup(<Command />),
  };
  return icons[id];
}
