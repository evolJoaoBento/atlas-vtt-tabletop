/**
 * Where the points of the fog tool's rectangle and polygon land on this map (Atlas 0.18's `pixi/fog/FogSnapping.ts`, with
 * `atlasPort/app/fog/fogSnap.ts`): on a wall's end, a point of the grid, a wall, within 10 screen pixels, in that order;
 * else the grid's nearest point while its Snap is on. The guide shows what a point snapped to.
 */
import { NO_SNAP, snapHeldPoint, snapPoint, type FogSnap, type FogSnapCandidates } from '../atlasPort/app/fog/fogSnap';
import type { FogKeys, FogPoint } from './fogGesture';
import type { FogWall } from './fogWalls';

/** Screen pixels: how near the pointer must be to a corner, a wall's end or an edge to land on it. */
export const SNAP_REACH = 10;

/** What the guide shows: a place, and the line it lies on where it snapped to one. */
export interface FogGuideMark {
  readonly point: FogPoint;
  readonly from?: FogPoint;
  readonly to?: FogPoint;
}

export interface FogSnappingDeps {
  /** The grid points snap to: null while the grid's Snap is off or there is no grid. */
  grid(): { type: string; size: number; offsetX: number; offsetY: number } | null;
  walls(): readonly FogWall[];
  /** Map pixels that are `px` screen pixels at `at`. */
  reach(at: FogPoint, px: number): number;
  guide(mark: FogGuideMark | null): void;
}

export class FogSnapping {
  constructor(private readonly deps: FogSnappingDeps) {}

  /** Where a corner for the pointer at `at` lands; `from` is the polygon's corner before it, which Constrain holds the edge to eighths of a turn from. */
  corner(at: FogPoint, keys: FogKeys, from: FogPoint | null = null): FogPoint {
    const held = keys.shift && from ? from : null;
    const candidates: FogSnapCandidates = keys.ctrl ? NO_SNAP : { grid: this.deps.grid() as FogSnapCandidates['grid'], walls: this.deps.walls() };
    const reach = this.deps.reach(at, SNAP_REACH);
    return this.shown(held ? snapHeldPoint(held, at, candidates, reach) : snapPoint(at, candidates, reach));
  }

  /** Shows a place a point will land on that is no snap of the map's: the corner a polygon closes on. */
  mark(point: FogPoint | null): void {
    this.deps.guide(point ? { point } : null);
  }

  clear(): void {
    this.deps.guide(null);
  }

  private shown(snap: FogSnap): FogPoint {
    this.deps.guide(snap.to);
    return snap.point;
  }
}
