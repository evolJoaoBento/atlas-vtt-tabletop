/**
 * A Connect player's tools on the board, as Connect's 2D view has them: Move (the board's own token drags), Measure
 * (line, circle or cone, shown while dragged), Template (a lasting line, circle, square or cone; a tap on one of the
 * player's own takes it off), Laser (points sent in batches with their timing) and Ping (a click). Points are on the
 * map, in pixels; this decides, the board draws (`marks.ts`) and Connect sends what it returns.
 *
 * A lasting template is one of Atlas's kept measures, and lies as Atlas shapes it (`shapedArea`, `packages/atlas-shared`):
 * a circle around its first point, a cone from it, a square from the middle of its near side, a line as wide as it says.
 */
import { DEFAULT_CONE_END, shapedArea, type ShapedArea } from '../../packages/atlas-shared/src/index';
import type { Spell, SpellAbout } from './spells';
import type { SpellRules } from './spellRules';

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
  /** A line's width, map pixels; a line without one is a thin stroke. */
  width?: number;
  /** A leg of a kept ruler: a thin line, no area. */
  ruler?: true;
  /** What the measure is: someone's template (also when unsaid), or an area made in Atlas (no tap takes it off). */
  kind?: 'template' | 'area';
  /** What Atlas keeps from its players (a hidden measure, one that started on a token they do not see): drawn for the GM alone. */
  gmOnly?: true;
}

export type TemplateChange = { add: { shape: TemplateShape; start: Point; end: Point } } | { remove: string } | { clear: true };

/** A spell cast through a token's eyes (`spells.ts`), one of the caster's taken off, or all of theirs. */
/** A spell cast (for the GM's ask `request`), one taken off, the player's cleared, or an ask turned down. */
export type SpellChange = { add: Spell; request?: string; rules?: SpellRules; name?: string; about?: SpellAbout } | { remove: string } | { clear: true } | { decline: string };

export type ToolAction =
  | { type: 'ping'; x: number; y: number }
  | { type: 'spell'; change: SpellChange }
  | { type: 'template'; change: TemplateChange }
  | { type: 'laser'; points: Point[]; dt: number[]; lifted: boolean; color: string };

/** How often a laser stroke's points go, in milliseconds. */
export const LASER_FLUSH_MS = 50;
/** How far from a template's edge a tap still hits it, in map pixels. */
const TAP_SLACK = 6;

type Shaped = Pick<TemplateMark, 'shape' | 'start' | 'end'> & Partial<Pick<TemplateMark, 'width' | 'ruler'>>;

/** A template's area as Atlas shapes it (`coneAngle` in radians); null for a thin line (a ruler's leg, a line without a width) and for one without a size. */
export function templateArea(template: Shaped, coneAngle: number): ShapedArea | null {
  if (template.ruler || (template.shape === 'line' && !(template.width !== undefined && template.width > 0))) return null;
  return shapedArea(
    { shape: template.shape, points: [template.start, template.end], ...(template.width !== undefined ? { width: template.width } : {}) },
    { coneAngle: (coneAngle * 180) / Math.PI, coneEnd: DEFAULT_CONE_END, lineWidth: template.width ?? 0 },
  );
}

function toSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const run = dx * dx + dy * dy;
  const along = run === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / run));
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

/** Whether `point` falls on a template: in its area, or within `slack` of its edge (of the line, for a thin one). */
export function templateHit(template: Shaped, point: Point, slack: number, coneAngle: number): boolean {
  const area = templateArea(template, coneAngle);
  if (!area) return toSegment(point, template.start, template.end) <= slack;
  if (area.contains(point)) return true;
  if (!(slack > 0)) return false;
  if (template.shape === 'circle') return Math.hypot(point.x - template.start.x, point.y - template.start.y) <= area.reach + slack;
  // Atlas's own points are untyped in the shared copy.
  const rings = area.rings as ReadonlyArray<readonly Point[]>;
  return rings.some((ring) => ring.some((corner, index) => toSegment(point, corner, ring[(index + 1) % ring.length]) <= slack));
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

  /** The player (or GM) these tools draw for, as Connect named them; null before it has. */
  get selfId(): string | null {
    return this.self;
  }

  ownTemplates(): boolean {
    return this.self !== null && this.templates.some((template) => template.owner === this.self && template.kind !== 'area');
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
        const own = [...this.templates].reverse().find((template) => template.kind !== 'area' && (this.eraseAny || template.owner === this.self) && templateHit(template, point, TAP_SLACK, this.coneAngle));
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
