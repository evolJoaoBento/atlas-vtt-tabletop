/**
 * A Connect player's tools on the board, as Connect's 2D view has them: Move (the board's own token drags), Measure
 * (line, circle or cone, shown while dragged), Template (a lasting line, circle, square or cone; a tap on one of the
 * player's own takes it off), Laser (points sent in batches with their timing) and Ping (a click). Points are on the
 * map, in pixels; this decides, the board draws (`marks.ts`) and Connect sends what it returns.
 */
type Point = { x: number; y: number };

export type PlayerTool = 'move' | 'measure' | 'template' | 'laser' | 'ping';
export type MeasureShape = 'line' | 'circle' | 'cone';
export type TemplateShape = 'line' | 'circle' | 'square' | 'cone';

export interface TemplateMark {
  id: string;
  owner: string;
  shape: TemplateShape;
  start: Point;
  end: Point;
  color: string;
}

export type TemplateChange = { add: { shape: TemplateShape; start: Point; end: Point } } | { remove: string } | { clear: true };

export type ToolAction =
  | { type: 'ping'; x: number; y: number }
  | { type: 'template'; change: TemplateChange }
  | { type: 'laser'; points: Point[]; dt: number[]; lifted: boolean; color: string };

/** How often a laser stroke's points go, in milliseconds. */
export const LASER_FLUSH_MS = 50;
/** How far from a template's edge a tap still hits it, in map pixels. */
const TAP_SLACK = 6;

/** A square's side: the drag's longer reach, so it grows from `start` towards the pointer. */
function squareSide(start: Point, end: Point): number {
  return Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
}

/** The corners of a square from `start` (one corner) towards `end`. */
export function squareCorners(start: Point, end: Point): Point[] {
  const side = squareSide(start, end);
  const x = start.x + (end.x < start.x ? -side : side);
  const y = start.y + (end.y < start.y ? -side : side);
  return [{ x: start.x, y: start.y }, { x, y: start.y }, { x, y }, { x: start.x, y }];
}

/** The outline of a cone from `start` towards `end`, opening by `angle` radians: its apex and arc. */
export function conePoints(start: Point, end: Point, angle: number, segments = 24): Point[] {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const direction = Math.atan2(end.y - start.y, end.x - start.x);
  const points: Point[] = [{ x: start.x, y: start.y }];
  for (let index = 0; index <= segments; index++) {
    const at = direction - angle / 2 + (angle * index) / segments;
    points.push({ x: start.x + Math.cos(at) * length, y: start.y + Math.sin(at) * length });
  }
  return points;
}

/** Whether `point` falls on a template, within `slack` of it. */
export function templateHit(template: Pick<TemplateMark, 'shape' | 'start' | 'end'>, point: Point, slack: number, coneAngle: number): boolean {
  const { start, end } = template;
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const distance = Math.hypot(point.x - start.x, point.y - start.y);
  if (template.shape === 'circle') return distance <= length + slack;
  if (template.shape === 'square') {
    const corners = squareCorners(start, end);
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    return point.x >= Math.min(...xs) - slack && point.x <= Math.max(...xs) + slack && point.y >= Math.min(...ys) - slack && point.y <= Math.max(...ys) + slack;
  }
  if (template.shape === 'cone') {
    if (distance > length + slack) return false;
    if (distance <= slack) return true;
    const direction = Math.atan2(end.y - start.y, end.x - start.x);
    const angle = Math.atan2(point.y - start.y, point.x - start.x);
    const off = Math.abs(Math.atan2(Math.sin(angle - direction), Math.cos(angle - direction)));
    return off <= coneAngle / 2 + slack / Math.max(distance, 1);
  }
  if (length === 0) return distance <= slack;
  const along = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)));
  return Math.hypot(point.x - (start.x + along * (end.x - start.x)), point.y - (start.y + along * (end.y - start.y))) <= slack;
}

export class PlayerToolState {
  tool: PlayerTool = 'move';
  shape: MeasureShape = 'line';
  templateShape: TemplateShape = 'circle';
  laserColor = '';
  coneAngle = Math.PI / 2;
  /** The GM's tools: a tap erases anyone's template, not only the player's own. */
  eraseAny = false;
  private templates: TemplateMark[] = [];
  private self: string | null = null;
  private drag: { start: Point; end: Point } | null = null;
  private stroke: { points: Point[]; dt: number[]; last: number; flushed: number } | null = null;

  select(tool: PlayerTool): void {
    this.tool = tool === this.tool && tool !== 'move' ? 'move' : tool;
    this.drag = null;
  }

  selectShape(shape: MeasureShape): void {
    this.shape = shape;
    this.tool = 'measure';
  }

  selectTemplateShape(shape: TemplateShape): void {
    this.templateShape = shape;
    this.tool = 'template';
  }

  selectLaserColor(color: string): void {
    this.laserColor = color;
  }

  setPlayers(_order: readonly string[], self: string | null): void {
    this.self = self;
  }

  receiveTemplates(templates: readonly TemplateMark[]): void {
    this.templates = templates.map((template) => ({ ...template, start: { ...template.start }, end: { ...template.end } }));
  }

  get shown(): readonly TemplateMark[] {
    return this.templates;
  }

  ownTemplates(): boolean {
    return this.self !== null && this.templates.some((template) => template.owner === this.self);
  }

  clearOwn(): ToolAction[] {
    return this.ownTemplates() ? [{ type: 'template', change: { clear: true } }] : [];
  }

  /** Whether a press with the current tool is the tool's (not the camera's). */
  get takesPress(): boolean {
    return this.tool !== 'move';
  }

  down(point: Point, now: number): void {
    if (this.tool === 'laser') {
      this.stroke = { points: [{ ...point }], dt: [0], last: now, flushed: now };
      return;
    }
    this.drag = { start: { ...point }, end: { ...point } };
  }

  move(point: Point, now: number): ToolAction[] {
    if (this.tool === 'laser' && this.stroke) {
      this.stroke.points.push({ ...point });
      this.stroke.dt.push(now - this.stroke.last);
      this.stroke.last = now;
      return now - this.stroke.flushed >= LASER_FLUSH_MS ? this.flush(now, false) : [];
    }
    if (this.drag) this.drag.end = { ...point };
    return [];
  }

  /** The press ended at `point`; `moved` says whether it was a drag rather than a click. */
  up(point: Point, now: number, moved: boolean): ToolAction[] {
    if (this.tool === 'laser' && this.stroke) {
      if (point.x !== this.stroke.points.at(-1)?.x || point.y !== this.stroke.points.at(-1)?.y) {
        this.stroke.points.push({ ...point });
        this.stroke.dt.push(now - this.stroke.last);
      }
      const actions = this.flush(now, true);
      this.stroke = null;
      return actions;
    }
    const drag = this.drag;
    this.drag = null;
    if (!drag) return [];
    if (this.tool === 'ping') return moved ? [] : [{ type: 'ping', x: point.x, y: point.y }];
    if (this.tool === 'template') {
      if (!moved) {
        const own = [...this.templates].reverse().find((template) => (this.eraseAny || template.owner === this.self) && templateHit(template, point, TAP_SLACK, this.coneAngle));
        return own ? [{ type: 'template', change: { remove: own.id } }] : [];
      }
      return [{ type: 'template', change: { add: { shape: this.templateShape, start: drag.start, end: { ...point } } } }];
    }
    return [];
  }

  cancel(): void {
    this.drag = null;
    this.stroke = null;
  }

  /** What the board draws of the gesture under way. */
  overlay(): { measure: { shape: MeasureShape; start: Point; end: Point } | null; draft: { shape: TemplateShape; start: Point; end: Point } | null } {
    const drag = this.drag;
    return {
      measure: drag && this.tool === 'measure' ? { shape: this.shape, start: drag.start, end: drag.end } : null,
      draft: drag && this.tool === 'template' ? { shape: this.templateShape, start: drag.start, end: drag.end } : null,
    };
  }

  private flush(now: number, lifted: boolean): ToolAction[] {
    const stroke = this.stroke;
    if (!stroke) return [];
    const action: ToolAction = { type: 'laser', points: stroke.points, dt: stroke.dt, lifted, color: this.laserColor };
    stroke.points = [];
    stroke.dt = [];
    stroke.flushed = now;
    return action.points.length > 0 || lifted ? [action] : [];
  }
}
