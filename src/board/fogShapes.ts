/**
 * The fog tool's shapes beside the brush, as gestures (`fogGesture.ts`): Rectangle, Lasso, Polygon, Cells and Room. They
 * are Atlas 0.18's `pixi/fog/FogDrag.ts`, `FogPolygon.ts` and `FogRoomClick.ts` over its pure logic (`atlasPort/app/fog`):
 * the same strokes, snapping, constraints and rules; only the drawing is the board's (`fogMarks.ts`).
 */
import { CellStroke, cellShapes, cellsOnSegment, hasCells } from '../atlasPort/app/fog/fogCells';
import { squaredCorner } from '../atlasPort/app/fog/fogConstrain';
import { outlineRings } from '../atlasPort/app/fog/fogKeyhole';
import { PolygonDraft } from '../atlasPort/app/fog/fogPolygon';
import { roomAt, type RoomCorners } from '../atlasPort/app/fog/fogRooms';
import { strokePolygons } from '../atlasPort/app/lighting/exploredEdits';
import { ShapeStroke, type StrokeShape } from '../atlasPort/app/tools/shapeStroke';
import { at as atlasText } from '../atlasPort/atlasText';
import type { FogEnv, FogGesture, FogKeys, FogMarks, FogPoint, FogPreviewSpec, FogShapeInput } from './fogGesture';

const same = (a: FogPoint, b: FogPoint): boolean => a.x === b.x && a.y === b.y;
const rectangleRing = (shape: Extract<StrokeShape, { type: 'rectangle' }>): FogPoint[] => [
  { x: shape.x, y: shape.y }, { x: shape.x + shape.width, y: shape.y }, { x: shape.x + shape.width, y: shape.y + shape.height }, { x: shape.x, y: shape.y + shape.height },
];
/** A shape the gesture hands over: Atlas's strokes are plain data, copied so the stroke's own arrays may go on. */
function shapeInput(shape: StrokeShape): FogShapeInput {
  if (shape.type === 'rectangle') return { ...shape };
  return { ...shape, points: shape.points.map(({ x, y }) => ({ x, y })) } as FogShapeInput;
}

/** The fog a shape leaves as polygons that do not overlap (the preview sheet's even-odd fill is then right). */
export function shapePolygons(shape: FogShapeInput): FogPoint[][] {
  return strokePolygons(shape as StrokeShape);
}

/** The rectangle: drag; the first corner snaps; Constrain makes a square. */
export class RectangleGesture implements FogGesture {
  private readonly stroke = new ShapeStroke();
  private placed: FogPoint | null = null;
  private lastAt: FogPoint | null = null;

  constructor(private readonly env: FogEnv) {
    this.stroke.mode = 'rectangle';
  }

  get active(): boolean { return this.stroke.active; }

  down(at: FogPoint, keys: FogKeys): boolean {
    this.cancel();
    this.placed = this.env.snapping.corner(at, keys);
    this.lastAt = at;
    this.stroke.begin(this.placed);
    return true;
  }

  move(at: FogPoint, keys: FogKeys): void {
    if (!this.stroke.active || !this.placed) return;
    this.lastAt = at;
    const corner = this.env.snapping.corner(at, keys);
    const squared = keys.shift ? squaredCorner(this.placed, corner) : corner;
    // A square's corner lies where the square puts it, on nothing of the map's.
    if (!same(squared, corner)) this.env.snapping.clear();
    this.stroke.extend(squared);
  }

  up(): FogShapeInput[] {
    const shape = this.stroke.finish();
    this.placed = null;
    this.env.snapping.clear();
    return shape ? [shapeInput(shape)] : [];
  }

  hover(at: FogPoint, keys: FogKeys): void {
    this.env.snapping.corner(at, keys);
  }

  rekey(keys: FogKeys): void {
    if (this.stroke.active && this.lastAt) this.move(this.lastAt, keys);
  }

  rest(): void { this.env.snapping.clear(); }

  cancel(): void {
    this.stroke.cancel();
    this.placed = null;
    this.env.snapping.clear();
  }

  preview(): FogPreviewSpec | null {
    const shape = this.stroke.shape();
    return shape ? { kind: 'polygons', polygons: strokePolygons(shape) } : null;
  }

  marks(): FogMarks | null {
    const shape = this.stroke.shape();
    return shape?.type === 'rectangle' ? { paths: [{ points: rectangleRing(shape), closed: true }] } : null;
  }
}

/** The lasso: free drag, closed on release; fewer than three points leave nothing. */
export class LassoGesture implements FogGesture {
  private readonly stroke = new ShapeStroke();

  constructor() {
    this.stroke.mode = 'lasso';
  }

  get active(): boolean { return this.stroke.active; }

  down(at: FogPoint): boolean {
    this.stroke.begin(at);
    return true;
  }

  move(at: FogPoint): void {
    this.stroke.extend(at);
  }

  up(): FogShapeInput[] {
    const shape = this.stroke.finish();
    return shape ? [shapeInput(shape)] : [];
  }

  cancel(): void { this.stroke.cancel(); }

  preview(): FogPreviewSpec | null {
    const shape = this.stroke.shape();
    return shape ? { kind: 'polygons', polygons: strokePolygons(shape) } : null;
  }

  marks(): FogMarks | null {
    const points = this.stroke.outline();
    return points.length >= 2 ? { paths: [{ points, closed: true }] } : null;
  }
}

/** Cells: drag outlines the cells passed, release fills them (a square grid's row runs, a hex each). */
export class CellsGesture implements FogGesture {
  private readonly cells = new CellStroke();
  /** The cell outlined under a resting pointer, with the key it was made for. */
  private hovered: { key: string; ring: FogPoint[] } | null = null;

  constructor(private readonly env: FogEnv) {}

  get active(): boolean { return this.cells.active; }

  down(at: FogPoint): boolean {
    const grid = this.env.grid() as never;
    if (!hasCells(grid)) return false;
    this.hovered = null;
    this.cells.begin(grid, at);
    return this.cells.active;
  }

  move(at: FogPoint): void {
    this.cells.extend(at);
  }

  up(): FogShapeInput[] {
    return this.cells.finish().map(shapeInput);
  }

  hover(at: FogPoint): void {
    const grid = this.env.grid() as never;
    const [cell] = hasCells(grid) ? cellShapes(grid, cellsOnSegment(grid, at, at)) : [];
    const first = cell?.points[0];
    const key = cell && first ? `${first.x},${first.y}` : '';
    if (key === (this.hovered?.key ?? '')) return;
    this.hovered = cell && first ? { key, ring: cell.points.map(({ x, y }) => ({ x, y })) } : null;
  }

  rest(): void { this.hovered = null; }

  cancel(): void {
    this.cells.cancel();
    this.hovered = null;
  }

  preview(): FogPreviewSpec | null {
    if (!this.cells.active) return null;
    return { kind: 'polygons', polygons: this.cells.shapes().flatMap((shape) => strokePolygons(shape as StrokeShape)) };
  }

  marks(): FogMarks | null {
    if (this.cells.active) return { paths: this.cells.shapes().map((shape) => ({ points: shape.points, closed: true })) };
    return this.hovered ? { paths: [{ points: this.hovered.ring, closed: true }] } : null;
  }
}

/** Screen pixels a press may move and still be a click in a room. */
const CLICK_SLOP = 4;
/** A second press this soon after the first, in the same place, is a double click (ms). */
const DOUBLE_CLICK_MS = 500;
/** Screen pixels a second press may land from the first. */
const DOUBLE_CLICK_SLACK = 6;

/** The polygon: click corners; Enter, a click on the first corner or a double click closes; Backspace takes a corner back. */
export class PolygonGesture implements FogGesture {
  private readonly draft = new PolygonDraft();
  private cursor: FogPoint | null = null;
  private pointer: { at: FogPoint; keys: FogKeys } | null = null;
  private closed: FogShapeInput[] = [];
  private last: { at: FogPoint; time: number } | null = null;
  /** The press that is down placed a corner (it is taken back if the press is lost, `dropPress`). */
  private placed = false;

  constructor(private readonly env: FogEnv, private readonly now: () => number = () => performance.now()) {}

  get active(): boolean { return this.draft.active; }

  /** Whether a press on `at` closes the polygon: on its first corner (Atlas's `closesDraft`: three corners at least). */
  private closesOn(at: FogPoint): boolean {
    const corners = this.draft.corners;
    if (corners.length < 3) return false;
    const first = corners[0]!;
    return Math.hypot(at.x - first.x, at.y - first.y) <= this.env.reach(at, 10);
  }

  private doubleClick(screen: FogPoint): boolean {
    const last = this.last;
    const time = this.now();
    const second = last !== null && time - last.time <= DOUBLE_CLICK_MS && Math.hypot(screen.x - last.at.x, screen.y - last.at.y) <= DOUBLE_CLICK_SLACK;
    this.last = second ? null : { at: { x: screen.x, y: screen.y }, time };
    return second;
  }

  down(at: FogPoint, keys: FogKeys, _radius: number, screen: FogPoint): boolean {
    const second = this.doubleClick(screen);
    this.placed = false;
    if (this.active && (second || this.closesOn(at))) {
      // Corners that make no area yet: the press places none, and the polygon goes on.
      this.close();
      return true;
    }
    const began = !this.active;
    const corner = this.env.snapping.corner(at, keys, this.draft.last);
    if (!this.draft.add(corner) && began) return true;
    this.placed = true;
    this.pointer = { at: { x: at.x, y: at.y }, keys };
    this.cursor = corner;
    return true;
  }

  move(at: FogPoint, keys: FogKeys): void {
    this.pointer = { at: { x: at.x, y: at.y }, keys };
    if (!this.active) {
      this.env.snapping.corner(at, keys);
      return;
    }
    const first = this.draft.first;
    if (first && this.closesOn(at)) {
      this.cursor = first;
      this.env.snapping.mark(first);
    } else {
      this.cursor = this.env.snapping.corner(at, keys, this.draft.last);
    }
  }

  hover(at: FogPoint, keys: FogKeys): void { this.move(at, keys); }

  up(): FogShapeInput[] { this.placed = false; return []; }

  /** Atlas's `dropDrag`: a polygon between its clicks stays; the corner the lost press placed goes. */
  dropPress(): void {
    if (!this.placed) return;
    this.placed = false;
    this.key('Backspace');
  }

  rekey(keys: FogKeys): void {
    if (this.active && this.pointer) this.move(this.pointer.at, keys);
  }

  key(key: 'Enter' | 'Backspace'): boolean {
    if (!this.active) return false;
    if (key === 'Enter') this.close();
    else {
      this.draft.takeBack();
      if (!this.active) this.end();
      else if (this.pointer) this.move(this.pointer.at, this.pointer.keys);
    }
    return true;
  }

  take(): FogShapeInput[] {
    const done = this.closed;
    this.closed = [];
    return done;
  }

  rest(): void { if (!this.active) this.env.snapping.clear(); }

  cancel(): void {
    this.draft.drop();
    this.closed = [];
    this.end();
  }

  private close(): void {
    const outline = this.draft.close();
    if (!outline) return;
    this.end();
    this.closed.push({ type: 'lasso', points: outline.map(({ x, y }) => ({ x, y })) });
  }

  private end(): void {
    this.cursor = null;
    this.env.snapping.clear();
  }

  preview(): FogPreviewSpec | null {
    if (!this.active) return null;
    const outline = this.draft.outlineWith(this.cursor);
    return { kind: 'polygons', polygons: outline ? [outline] : [] };
  }

  marks(): FogMarks | null {
    const corners = this.draft.corners;
    const first = corners[0];
    if (!first) return null;
    const next = this.cursor;
    const edges = next ? [...corners, next] : [...corners];
    const end = next ?? corners[corners.length - 1]!;
    return {
      paths: [{ points: edges, closed: false }],
      ...(corners.length >= 2 && end !== first && { faint: [[end, first] as [FogPoint, FogPoint]] }),
      dots: corners,
      ring: first,
    };
  }
}

/** The room: hover outlines the room the walls enclose, a click (within 4 screen pixels) fills it. */
export class RoomGesture implements FogGesture {
  private pressed: FogPoint | null = null;
  private shown: RoomCorners | null = null;

  constructor(private readonly env: FogEnv) {}

  get active(): boolean { return this.pressed !== null; }

  private at(world: FogPoint): RoomCorners | null {
    const rect = this.env.mapRect();
    return rect ? roomAt(world, this.env.walls() as never, rect, this.env.cellSize()) : null;
  }

  down(_at: FogPoint, _keys: FogKeys, _radius: number, screen: FogPoint): boolean {
    this.pressed = { x: screen.x, y: screen.y };
    return true;
  }

  move(at: FogPoint, _keys: FogKeys, screen: FogPoint): void {
    if (this.pressed && Math.hypot(screen.x - this.pressed.x, screen.y - this.pressed.y) >= CLICK_SLOP) this.pressed = null;
    this.shown = this.at(at);
  }

  hover(at: FogPoint, keys: FogKeys, screen: FogPoint): void { this.move(at, keys, screen); }

  up(at: FogPoint): FogShapeInput[] {
    const clicked = this.pressed !== null;
    this.pressed = null;
    if (!clicked) return [];
    const room = this.at(at);
    if (!room) {
      this.env.notice(atlasText('fog.roomNotEnclosed'));
      return [];
    }
    return [{ type: 'lasso', points: room.map(({ x, y }) => ({ x, y })) }];
  }

  rest(): void { this.shown = null; }

  cancel(): void {
    this.pressed = null;
    this.shown = null;
  }

  preview(): FogPreviewSpec | null { return null; }

  marks(): FogMarks | null {
    if (!this.shown || this.shown.length < 3) return null;
    // A room round a room is outlined along its own walls and the inner room's, not along the slit between them.
    const rings = outlineRings(this.shown as never);
    return rings.length > 0 ? { paths: rings.map((ring) => ({ points: ring, closed: true, alpha: 1 })), accent: true } : null;
  }
}
