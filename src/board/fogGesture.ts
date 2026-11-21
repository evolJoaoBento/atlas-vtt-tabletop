/**
 * What a shape of the fog tool is to the tool: a `FogGesture` takes the pointer in map pixels with the keys held and gives
 * back what it will leave (`preview`), the lines that mark it (`marks`) and, when it ends, the shapes to commit.
 */
import type { FogWall } from './fogWalls';
import type { FogSnapping } from './fogSnapping';

export interface FogPoint {
  x: number;
  y: number;
}

/** A fog operation as Atlas's `addFogOperations` takes it (`FogOperationInput`). */
export type FogOperationInput =
  | { type: 'brush'; points: FogPoint[]; brushRadius: number; isErasing: boolean }
  | { type: 'lasso'; points: FogPoint[]; isErasing: boolean; area?: Record<string, never> }
  | { type: 'rectangle'; x: number; y: number; width: number; height: number; isErasing: boolean; area?: Record<string, never> };

/** A shape a gesture finished, before the tool says whether it erases. */
export type FogShapeInput = Omit<Extract<FogOperationInput, { type: 'brush' }>, 'isErasing'> | Omit<Extract<FogOperationInput, { type: 'lasso' }>, 'isErasing'> | Omit<Extract<FogOperationInput, { type: 'rectangle' }>, 'isErasing'>;

/**
 * The keys that change where a point lands, as the tool's Snap and Constrain switches read them (Atlas's `placeKeysWith`):
 * `shift` a square or a polygon edge in eighths of a turn, `ctrl` a point where the pointer is (no snapping).
 */
export interface FogKeys {
  shift: boolean;
  ctrl: boolean;
}

/** What a gesture under way shows on the ground as the fog it leaves. */
export type FogPreviewSpec =
  | { kind: 'brush'; points: readonly FogPoint[]; radius: number }
  | { kind: 'polygons'; polygons: ReadonlyArray<ReadonlyArray<FogPoint>> };

/** The lines a gesture marks the ground with (Atlas's outlines): in the tool's colour, or the theme's accent. */
export interface FogMarks {
  /** Stroked lines: 2 px over a 4 px dark one; `alpha` is the line's (0.6 as Atlas's marks, 1 for a room's outline). */
  paths: Array<{ points: readonly FogPoint[]; closed: boolean; alpha?: number }>;
  /** The edge that would close a polygon, faint. */
  faint?: Array<[FogPoint, FogPoint]>;
  /** A polygon's corners, as dots; and the first one, ringed. */
  dots?: readonly FogPoint[];
  ring?: FogPoint;
  /** In the theme's accent instead of the tool's colour. */
  accent?: boolean;
}

/** What the shapes need of the board: snapping, the grid, the walls, the map. */
export interface FogEnv {
  readonly snapping: FogSnapping;
  /** The grid whose cells the Cells shape follows; null without a cell size. */
  grid(): { type: string; size: number; offsetX: number; offsetY: number } | null;
  walls(): readonly FogWall[];
  /** The map as drawn, for rooms; null while its size is not known. */
  mapRect(): { x: number; y: number; width: number; height: number } | null;
  /** The grid cell's width in map pixels. */
  cellSize(): number;
  /** Map pixels that are `px` screen pixels at `at`. */
  reach(at: FogPoint, px: number): number;
  notice(text: string): void;
}

/** One shape's press, drag and release. */
export interface FogGesture {
  /** A press is down, or (a polygon) corners wait for the next. */
  readonly active: boolean;
  /** A press at `at` in map pixels (`screen`: client pixels); false where this shape does not begin. */
  down(at: FogPoint, keys: FogKeys, brushRadius: number, screen: FogPoint): boolean;
  move(at: FogPoint, keys: FogKeys, screen: FogPoint): void;
  /** The release: what to commit (nothing: an empty list). A polygon stays active. */
  up(at: FogPoint, keys: FogKeys, screen: FogPoint): FogShapeInput[];
  /** The pointer moves with no press (the guide, the cell or room under it). */
  hover?(at: FogPoint, keys: FogKeys, screen: FogPoint): void;
  /** Shift, Ctrl or Cmd went down or up: the point under a resting pointer lands as the keys now say. */
  rekey?(keys: FogKeys): void;
  /** Enter or Backspace: true where the gesture took the key. */
  key?(key: 'Enter' | 'Backspace'): boolean;
  /** Shapes the last press or key closed (a polygon); they are handed over once. */
  take?(): FogShapeInput[];
  /** Nothing is pointed at any more: the guide, the cell or room outlined go. */
  rest?(): void;
  cancel(): void;
  preview(): FogPreviewSpec | null;
  marks(): FogMarks | null;
}
