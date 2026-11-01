/**
 * How hard the board works to look good, set in Tabletop's settings: the resolution it draws at (and how far it may
 * drop it when the frame rate falls), antialiasing, how sharp the shadows are, and whether minis cast real shadows
 * or a soft blob under them. Pure.
 */

import type { Sky } from './look';
import { DEFAULT_LAYER_TICK } from './layerRuler';
import { DEFAULT_SIGHT_MODE, DEFAULT_SIGHT_STYLE, type SightMode, type SightStyle } from './lineOfSight';

export type Quality = 'low' | 'medium' | 'high';

/** How round the edges of walls and doors are. */
export type WallEdges = 'sharp' | 'soft' | 'round';
/** The radius of each, as a share of a grid square (a thin wall is rounded less). */
export const EDGE_SHARE: Readonly<Record<WallEdges, number>> = { sharp: 0, soft: 0.025, round: 0.06 };
export const DEFAULT_EDGES: WallEdges = 'soft';

export function readEdges(value: unknown): WallEdges {
  return value === 'sharp' || value === 'soft' || value === 'round' ? value : DEFAULT_EDGES;
}

/** How the image of a map stacked above another (an elevation layer) is drawn: whole, see-through, or only what stands on it. */
export type LayerLook = 'solid' | 'faded' | 'transparent';
export const DEFAULT_LAYER_LOOK: LayerLook = 'solid';
/** How much of a faded layer's image is left. */
export const FADED_LAYER_OPACITY = 0.5;

export function readLayerLook(value: unknown): LayerLook {
  return value === 'solid' || value === 'faded' || value === 'transparent' ? value : DEFAULT_LAYER_LOOK;
}

export interface QualityPreset {
  /** The drawing resolution, as a share of the screen's pixels: the best it starts at, and the least it drops to. */
  maxPixelRatio: number;
  minPixelRatio: number;
  antialias: boolean;
  shadowMapSize: number;
  /** A real shadow drawn from the model, or a soft blob under it (much cheaper for a heavy model). */
  miniShadows: 'real' | 'blob';
  /** How many of Atlas's lights (the nearest the camera's target) cast shadows; each costs six shadow drawings. */
  lightShadows: number;
  /** Cuts a texture tile of a displaced wall is given, in each direction (0: walls stay flat; the height map still shifts the texture). Part of the preset, not an own setting. */
  displaceCuts: number;
  /** The miniature look: a blur towards the top and bottom edges (tiltShift.ts). Its own setting, not the preset's. */
  tiltShift: boolean;
  /** Contact shadows: darker creases where walls, minis and props meet the floor (postFx.ts). Its own setting too. */
  occlusion: boolean;
  /** The painted lighting: a warm key and cool fill, a tone mapper, softer shadows, a vignette (look.ts). Its own setting too. */
  painted: boolean;
  /** The painted sky's palette (look.ts). */
  sky: Sky;
  /** How round walls' edges are (an own setting too). */
  edges: WallEdges;
  /** Walls between the camera and what it looks at fade out (cutaway.ts). An own setting too. */
  seeThrough: boolean;
  /** How wide that window is, in grid squares. */
  seeThroughSize: number;
  /** How the floor image of an elevation layer is drawn. An own setting too. */
  layerLook: LayerLook;
  /** Pieces behind walls and shut doors, from the tokens that see, are hidden: from the players' view, or from the GM's board too (lineOfSight.ts). An own setting too. */
  lineOfSight: SightMode;
  /** How line of sight is judged: by rays from each viewer, or cinematically, by whole rooms. An own setting too. */
  sightStyle: SightStyle;
  /** The height ruler of a stack of scenes has a dash every this many squares. An own setting too. */
  layerTick: number;
}

export const DEFAULT_SEE_THROUGH_SIZE = 1.2;
export const MIN_SEE_THROUGH_SIZE = 0.5;
export const MAX_SEE_THROUGH_SIZE = 4;

/** A stored see-through width, kept within what the slider offers. */
export function readSeeThroughSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_SEE_THROUGH_SIZE, Math.max(MIN_SEE_THROUGH_SIZE, value)) : DEFAULT_SEE_THROUGH_SIZE;
}

export const QUALITY: Readonly<Record<Quality, QualityPreset>> = {
  low: { maxPixelRatio: 1, minPixelRatio: 0.6, antialias: false, shadowMapSize: 1024, miniShadows: 'blob', lightShadows: 0, displaceCuts: 0, tiltShift: false, occlusion: false, painted: false, sky: 'dusk', edges: DEFAULT_EDGES, seeThrough: false, seeThroughSize: DEFAULT_SEE_THROUGH_SIZE, layerLook: DEFAULT_LAYER_LOOK, lineOfSight: DEFAULT_SIGHT_MODE, sightStyle: DEFAULT_SIGHT_STYLE, layerTick: DEFAULT_LAYER_TICK },
  medium: { maxPixelRatio: 1.5, minPixelRatio: 0.75, antialias: true, shadowMapSize: 2048, miniShadows: 'blob', lightShadows: 2, displaceCuts: 8, tiltShift: false, occlusion: false, painted: false, sky: 'dusk', edges: DEFAULT_EDGES, seeThrough: false, seeThroughSize: DEFAULT_SEE_THROUGH_SIZE, layerLook: DEFAULT_LAYER_LOOK, lineOfSight: DEFAULT_SIGHT_MODE, sightStyle: DEFAULT_SIGHT_STYLE, layerTick: DEFAULT_LAYER_TICK },
  high: { maxPixelRatio: 2, minPixelRatio: 1, antialias: true, shadowMapSize: 4096, miniShadows: 'real', lightShadows: 4, displaceCuts: 16, tiltShift: false, occlusion: false, painted: false, sky: 'dusk', edges: DEFAULT_EDGES, seeThrough: false, seeThroughSize: DEFAULT_SEE_THROUGH_SIZE, layerLook: DEFAULT_LAYER_LOOK, lineOfSight: DEFAULT_SIGHT_MODE, sightStyle: DEFAULT_SIGHT_STYLE, layerTick: DEFAULT_LAYER_TICK },
};

/** A preset with the miniature look, the contact shadows and the painted lighting on or off. */
export function withLooks(preset: QualityPreset, looks: { tiltShift: boolean; occlusion: boolean; painted: boolean; sky: Sky; edges?: WallEdges; seeThrough?: boolean; seeThroughSize?: number; layerLook?: LayerLook; lineOfSight?: SightMode; sightStyle?: SightStyle; layerTick?: number }): QualityPreset {
  const edges = looks.edges ?? preset.edges;
  const seeThrough = looks.seeThrough ?? preset.seeThrough;
  const seeThroughSize = looks.seeThroughSize ?? preset.seeThroughSize;
  const layerLook = looks.layerLook ?? preset.layerLook;
  const lineOfSight = looks.lineOfSight ?? preset.lineOfSight;
  const sightStyle = looks.sightStyle ?? preset.sightStyle;
  const layerTick = looks.layerTick ?? preset.layerTick;
  return preset.tiltShift === looks.tiltShift && preset.occlusion === looks.occlusion && preset.painted === looks.painted && preset.sky === looks.sky && preset.edges === edges && preset.seeThrough === seeThrough && preset.seeThroughSize === seeThroughSize && preset.layerLook === layerLook && preset.lineOfSight === lineOfSight && preset.sightStyle === sightStyle && preset.layerTick === layerTick ? preset : { ...preset, ...looks, edges, seeThrough, seeThroughSize, layerLook, lineOfSight, sightStyle, layerTick };
}

export const DEFAULT_QUALITY: Quality = 'medium';

export function readQuality(value: unknown): Quality {
  return value === 'low' || value === 'medium' || value === 'high' ? value : DEFAULT_QUALITY;
}

/** Below this the board is falling behind (40 fps); above this it has room to spare (55 fps). */
const SLOW_FRAME = 1 / 40;
const FAST_FRAME = 1 / 55;
/** How long it must fall behind before the resolution drops, and have room before it rises again, in seconds. */
const SLOW_FOR = 0.5;
const FAST_FOR = 3;
/** A longer gap is the board resting between frames, not a slow frame. */
const GAP = 0.25;
const STEP = 0.25;
const SMOOTHING = 0.1;

/**
 * Adaptive resolution: fed the time between frames drawn one after another, it lowers the drawing resolution a step
 * when the board falls behind and raises it again once there is room, within the preset's range.
 */
export class ResolutionGovernor {
  ratio: number;
  private readonly best: number;
  private average = 0;
  private slow = 0;
  private fast = 0;

  constructor(private readonly preset: QualityPreset, deviceRatio: number) {
    this.best = Math.max(preset.minPixelRatio, Math.min(preset.maxPixelRatio, deviceRatio));
    this.ratio = this.best;
  }

  /** One frame took `dt` seconds after the last; returns the new ratio when it changes. */
  sample(dt: number): number | null {
    if (!(dt > 0) || dt > GAP) return null;
    this.average = this.average === 0 ? dt : this.average + (dt - this.average) * SMOOTHING;
    if (this.average > SLOW_FRAME) {
      this.slow += dt;
      this.fast = 0;
    } else if (this.average < FAST_FRAME) {
      this.fast += dt;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    let next = this.ratio;
    if (this.slow >= SLOW_FOR) next = Math.max(this.preset.minPixelRatio, this.ratio - STEP);
    else if (this.fast >= FAST_FOR) next = Math.min(this.best, this.ratio + STEP);
    else return null;
    this.slow = 0;
    this.fast = 0;
    next = Math.round(next * 100) / 100;
    if (next === this.ratio) return null;
    this.ratio = next;
    return next;
  }
}
