/**
 * The GM's fog tool on the 3D board (Atlas 0.18's fog tool): its choices (fog or eraser, the shape, the brush's size), the
 * brush's ring on the ground, and the gesture that turns a press-drag-release into fog operations for Atlas's store.
 * The fog itself is Atlas's (`state.objects.fog`): the tool only hands operations to the host (`FogHost`), which writes them
 * through the writer, and the board draws the fog the store then holds.
 *
 * Shapes: each shape is a `FogGesture` (`gestureFor`). Stage 1 has the brush; a shape without a gesture is chosen and does
 * nothing yet. A gesture takes the pointer as `down`/`move`/`up` in map pixels with the keys held, gives its preview
 * (`FogPreviewSpec`: a brush stroke, or polygons), and on `up` the shapes to commit; the tool adds `isErasing` (Alt flips it,
 * read at the release as Atlas does) and sends them in one step. Pure of the board: it draws into the `parent` it is given.
 */
import * as THREE from 'three';
import { clampBrushSize, DEFAULT_FOG_TOOL, fogStrokeErases, steppedBrushSize, type FogShape, type FogToolId } from '../atlasPort/fogToolChoices';
import { outlineRings } from '../atlasPort/app/fog/fogKeyhole';
import { snapOverride } from '../atlasPort/app/types/toolSwitches';
import type { FogEnv, FogGesture, FogKeys, FogOperationInput, FogPoint, FogPreviewSpec, FogShapeInput } from './fogGesture';
import { FogMarksView } from './fogMarks';
import { FogPreview } from './fogPreview';
import { CellsGesture, LassoGesture, PolygonGesture, RectangleGesture, RoomGesture, shapePolygons } from './fogShapes';
import { FogSnapping } from './fogSnapping';
import type { FogWall } from './fogWalls';

export type { FogShape, FogToolId } from '../atlasPort/fogToolChoices';
export type { FogGesture, FogKeys, FogMarks, FogOperationInput, FogPoint, FogPreviewSpec, FogShapeInput } from './fogGesture';

/** A brush stroke: every point the pointer passes (a tap is one point), with the brush's radius at the press. */
export class BrushGesture implements FogGesture {
  private points: FogPoint[] = [];
  private radius = DEFAULT_FOG_TOOL.brushSize;
  private drawing = false;

  get active(): boolean { return this.drawing; }

  down(at: FogPoint, _keys: FogKeys, brushRadius: number, _screen?: FogPoint): boolean {
    this.drawing = true;
    this.radius = brushRadius;
    this.points = [{ x: at.x, y: at.y }];
    return true;
  }

  move(at: FogPoint, _keys?: FogKeys): void {
    if (!this.drawing) return;
    const last = this.points[this.points.length - 1]!;
    // A pointer that has not moved a map pixel adds nothing.
    if (Math.hypot(at.x - last.x, at.y - last.y) < 1) return;
    this.points.push({ x: at.x, y: at.y });
  }

  up(at: FogPoint, keys: FogKeys): FogShapeInput[] {
    if (!this.drawing) return [];
    this.move(at);
    const shape: FogShapeInput = { type: 'brush', points: this.points, brushRadius: this.radius };
    this.cancel();
    return [shape];
  }

  cancel(): void {
    this.drawing = false;
    this.points = [];
  }

  preview(): FogPreviewSpec | null {
    return this.drawing ? { kind: 'brush', points: this.points, radius: this.radius } : null;
  }

  marks(): null { return null; }
}

/** The ring's lines in screen pixels, as Atlas's `FogCursorPreview` draws them: the dark one under the light one. */
const DARK_LINE = { width: 4, alpha: 0.55 } as const;
const LIGHT_LINE = { width: 1.5, alpha: 0.95 } as const;
const RING_PAINT = '#ffffff';
const RING_ERASE = '#ff4444';
const RING_HEIGHT = 0.5;
const RING_SEGMENTS = 96;

export interface FogToolDeps {
  /** Where the tool's marks join the scene. */
  parent: THREE.Object3D;
  /** A canvas for the stroke's preview. */
  canvas(): HTMLCanvasElement;
  /** The point of the ground under a screen point, in map pixels; null off the ground. */
  boardPoint(clientX: number, clientY: number): FogPoint | null;
  /** How many map pixels one screen pixel is at `at` (the camera's distance and field of view). */
  unitsPerPixel(at: FogPoint): number;
  /** A key of the fog the board draws now (it changes when the fog does): a committed stroke's preview stays until it does. */
  fogKey(): string;
  /** The map's size in map pixels once known. */
  mapSize(): { width: number; height: number } | null;
  /** Hands the finished shapes to the host (the tool has set `isErasing`). */
  commit(operations: FogOperationInput[]): void;
  /** The tool changed what the toolbar shows. */
  changed(): void;
  /** Asks for a frame. */
  wake(): void;
  /** The map's walls as Atlas's segments (`fogWalls`): snapping and rooms read them. */
  walls(): readonly FogWall[];
  /** The grid: its cells, and whether its Snap is on; null without one. */
  grid(): { type: string; size: number; offsetX: number; offsetY: number; snap: boolean } | null;
  /** The map as the board draws it (for rooms); null while its size is not known. */
  mapRect(): { x: number; y: number; width: number; height: number } | null;
  /** Atlas's notice. */
  notice(text: string): void;
  /** The tool's Snap or Constrain switch. */
  switchOn(id: 'fogSnap' | 'fogConstrain'): boolean;
  /** The theme's accent as a colour (the room's outline, the snap guide). */
  accent(): string;
}

export class FogTool {
  private onNow = false;
  private modeNow: FogToolId = 'fog';
  private shapeNow: FogShape = DEFAULT_FOG_TOOL.shape;
  private sizeNow: number = DEFAULT_FOG_TOOL.brushSize;
  /** Alt is held: a stroke does the other thing. */
  private flipped = false;
  /** The gesture under way (a press is down, or a polygon waits for its next corner). */
  private gesture: FogGesture | null = null;
  /** One gesture per shape, made when first used: a polygon's corners live across presses. */
  private readonly gestures: Partial<Record<FogShape, FogGesture>> = {};
  private ring: { dark: THREE.Mesh; light: THREE.Mesh } | null = null;
  private ringKey = '';
  private readonly preview: FogPreview;
  private readonly marks: FogMarksView;
  /** What the open fog menu acts on, outlined in the theme's accent (Atlas's `FogMenuTarget`); the fog it was opened on is `targetKey`. */
  private readonly target: FogMarksView;
  private targetKey: string | null = null;
  private readonly env: FogEnv;
  /** The preview sheet is begun for the shape under way. */
  private sheetOn = false;
  /** What the sheet shows as (erasing, wash): a press that would show as the other thing begins it anew. */
  private sheetKind = '';
  /** The polygons of the shapes committed and not yet in the fog volume: a shape's preview is drawn over them. */
  private heldPolygons: FogPoint[][][] = [];
  /** Where the pointer last was on screen, and over the ground; null once it left the canvas. */
  private pointer: { x: number; y: number } | null = null;
  private pointerAt: FogPoint | null = null;
  /** The keys held at the last pointer or key event (Shift, Ctrl or Cmd), before the tool's switches read them. */
  private held: FogKeys = { shift: false, ctrl: false };
  /** The preview of a stroke that was committed stays until the fog drawn holds it (`fogDrawn`), or this timer. */
  private holding: ReturnType<typeof setTimeout> | null = null;
  private heldKey = '';

  constructor(private readonly deps: FogToolDeps) {
    this.preview = new FogPreview(deps.parent, () => deps.canvas());
    this.marks = new FogMarksView(deps.parent, () => deps.accent());
    this.target = new FogMarksView(deps.parent, () => deps.accent());
    const snapping = new FogSnapping({
      grid: () => { const grid = deps.grid(); return grid && grid.snap && grid.size > 0 ? grid : null; },
      walls: () => deps.walls(),
      reach: (at, px) => px * deps.unitsPerPixel(at),
      guide: (mark) => { this.marks.setGuide(mark, this.pixel()); deps.wake(); },
    });
    this.env = {
      snapping,
      grid: () => { const grid = deps.grid(); return grid && grid.size > 0 ? grid : null; },
      walls: () => deps.walls(),
      mapRect: () => deps.mapRect(),
      cellSize: () => deps.grid()?.size ?? 0,
      reach: (at, px) => px * deps.unitsPerPixel(at),
      notice: (text) => deps.notice(text),
    };
  }

  get on(): boolean { return this.onNow; }
  get mode(): FogToolId { return this.modeNow; }
  get shape(): FogShape { return this.shapeNow; }
  get brushSize(): number { return this.sizeNow; }
  /** A shape is under way (a press is down, or a polygon has corners placed). */
  get drawing(): boolean { return this.gesture?.active === true; }
  /** The ring's meshes (for tests): the dark line and the light one. */
  get rings(): { dark: THREE.Mesh; light: THREE.Mesh } | null { return this.ring; }
  /** The marks' view (for tests). */
  get markView(): FogMarksView { return this.marks; }
  /** The mark of what the fog menu acts on (for tests). */
  get targetView(): FogMarksView { return this.target; }
  /** The preview sheet (for tests). */
  get sheet(): FogPreview { return this.preview; }
  /** Whether a stroke made now erases: the eraser does, and Alt makes a stroke do the other thing. */
  get erasing(): boolean { return fogStrokeErases(this.modeNow, this.flipped); }

  /** Takes the tool up (as `mode`, else as it was left), or puts it down. */
  setOn(on: boolean, mode?: FogToolId): void {
    if (mode) this.modeNow = mode;
    if (on === this.onNow) { if (on) this.refreshRing(); this.deps.changed(); return; }
    this.onNow = on;
    if (!on) {
      this.cancel();
      this.showTarget(null);
      this.clearMarks();
      this.flipped = false;
      this.hideRing();
    } else {
      this.refreshRing();
    }
    this.deps.changed();
  }

  setMode(mode: FogToolId): void {
    this.modeNow = mode;
    this.refreshRing();
    this.showMarks();
    this.deps.changed();
  }

  /** Atlas's fog key: opens the tool, and while it is open turns it between fog and eraser. */
  toggleMode(): void {
    this.setMode(this.modeNow === 'fog' ? 'eraser' : 'fog');
  }

  setShape(shape: FogShape): void {
    if (shape === this.shapeNow) return;
    this.cancel();
    this.clearMarks();
    this.shapeNow = shape;
    this.refreshRing();
    this.deps.changed();
  }

  setBrushSize(size: number): void {
    const next = clampBrushSize(size);
    if (next === this.sizeNow) return;
    this.sizeNow = next;
    this.refreshRing();
    this.deps.changed();
  }

  /** The brush one step larger (`direction` 1) or smaller (-1): Atlas's `,` and `.`; a held key takes the finer step. */
  stepBrush(direction: 1 | -1, held: boolean): void {
    this.setBrushSize(steppedBrushSize(this.sizeNow, direction, held));
  }

  /** Alt is held or let go: a stroke now does the other thing, also the one under way. */
  setFlipped(flipped: boolean): void {
    if (flipped === this.flipped) return;
    this.flipped = flipped;
    this.refreshRing();
    this.preview.setErasing(this.erasing);
    this.preview.setWash(this.washes);
    this.showMarks();
    this.deps.wake();
    this.deps.changed();
  }

  /** The keys of a press as the shapes read them: Constrain and Snap as the tool's switches say, each turned around while its key is held (Atlas's `placeKeysWith`). */
  private resolve(held: FogKeys): FogKeys {
    return { shift: snapOverride(this.deps.switchOn('fogConstrain'), held.shift), ctrl: !snapOverride(this.deps.switchOn('fogSnap'), held.ctrl) };
  }

  /** The gesture of a shape. */
  private gestureOf(shape: FogShape): FogGesture {
    return (this.gestures[shape] ??= shape === 'rectangle' ? new RectangleGesture(this.env)
      : shape === 'lasso' ? new LassoGesture()
        : shape === 'polygon' ? new PolygonGesture(this.env)
          : shape === 'cells' ? new CellsGesture(this.env)
            : shape === 'room' ? new RoomGesture(this.env)
              : new BrushGesture());
  }

  /** An erasing shape that is no brush shows a wash, not fog. */
  private get washes(): boolean { return this.erasing && this.shapeNow !== 'brush'; }

  /** A press: begins the shape under the pointer, or places the polygon's next corner; false where nothing begins (the tool is off, no cells without a grid). */
  down(clientX: number, clientY: number, held: FogKeys, alt: boolean): boolean {
    if (!this.onNow) return false;
    const at = this.deps.boardPoint(clientX, clientY);
    const gesture = this.gestureOf(this.shapeNow);
    const size = this.deps.mapSize();
    if (!at || !size) return false;
    this.setFlipped(alt);
    this.held = held;
    if (!gesture.down(at, this.resolve(held), this.sizeNow, { x: clientX, y: clientY })) return false;
    // The stroke committed before waits for the fog volume (`fogDrawn`): this one is drawn over it, not in its place, unless it shows as the other thing.
    if (this.holding === null || this.sheetKind !== this.kindNow()) this.releaseHold();
    this.gesture = gesture;
    this.pointer = { x: clientX, y: clientY };
    this.pointerAt = at;
    this.settle(gesture, null);
    this.refreshRing();
    return true;
  }

  /** The pointer moved (also while it only hovers): the ring follows it, a shape under way grows, a resting one shows its guide. */
  move(clientX: number, clientY: number, held: FogKeys, alt: boolean): void {
    if (!this.onNow) return;
    this.setFlipped(alt);
    this.held = held;
    this.pointer = { x: clientX, y: clientY };
    const at = this.deps.boardPoint(clientX, clientY);
    this.pointerAt = at;
    if (at) {
      const keys = this.resolve(held);
      const screen = { x: clientX, y: clientY };
      if (this.gesture?.active) {
        const before = this.previewLast();
        this.gesture.move(at, keys, screen);
        this.drawPreview(before);
      } else {
        this.gestureOf(this.shapeNow).hover?.(at, keys, screen);
      }
      this.showMarks();
    }
    this.refreshRing();
  }

  /** The release: commits what the shape under way covers (a polygon waits for its next corner). */
  up(clientX: number, clientY: number, held: FogKeys, alt: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.setFlipped(alt);
    this.held = held;
    const at = this.deps.boardPoint(clientX, clientY) ?? this.pointerAt;
    const shapes = at ? gesture.up(at, this.resolve(held), { x: clientX, y: clientY }) : (gesture.cancel(), []);
    this.settle(gesture, shapes);
  }

  /**
   * A key of a shape under way: Enter closes a polygon, Backspace (or the map's undo, `undo`) takes its last corner back.
   * True where the shape took it; a key held down repeats and is still the shape's.
   */
  key(key: string, repeat: boolean, undo = false): boolean {
    const gesture = this.gesture;
    if (!this.onNow || !gesture?.active || !gesture.key) return false;
    const name = key === 'Enter' ? 'Enter' : key === 'Backspace' || undo ? 'Backspace' : null;
    if (!name) return false;
    if (repeat) return true;
    if (!gesture.key(name)) return false;
    this.settle(gesture, []);
    return true;
  }

  /** Shift, Ctrl or Cmd went down or up: the point under a resting pointer lands as the keys now say. */
  rekey(held: FogKeys): void {
    this.held = held;
    const gesture = this.gesture;
    if (!this.onNow || !gesture?.active || !gesture.rekey) return;
    gesture.rekey(this.resolve(held));
    this.drawPreview(null);
    this.showMarks();
  }

  /** What a press, a release or a key left: the shapes it closed are committed, the preview and the marks are drawn anew. */
  private settle(gesture: FogGesture, released: FogShapeInput[] | null): void {
    const shapes = [...(released ?? []), ...(gesture.take?.() ?? [])];
    if (shapes.length > 0) this.commit(shapes);
    if (!gesture.active) {
      this.gesture = null;
      if (shapes.length === 0 && this.holding === null) this.clearSheet();
    } else {
      this.drawPreview(null);
    }
    this.showMarks();
  }

  private commit(shapes: FogShapeInput[]): void {
    const isErasing = this.erasing;
    // A shape that is no brush shows what it leaves (the polygon's last corner under the pointer was no corner).
    if (shapes.some((shape) => shape.type !== 'brush')) {
      const polygons = shapes.flatMap(shapePolygons);
      this.drawSheet(polygons, this.heldPolygons);
      this.heldPolygons.push(polygons);
    }
    // The preview stays, as it is, until the fog volume holds the stroke (it would flicker off and on again): held before
    // the write, which may be drawn at once.
    this.heldKey = this.deps.fogKey();
    if (this.holding !== null) clearTimeout(this.holding);
    this.holding = setTimeout(() => this.releaseHold(), 3000);
    this.deps.commit(shapes.map((shape) => ({ ...shape, isErasing }) as FogOperationInput));
  }

  /**
   * The press under way is lost (a second finger comes, the pointer is cancelled): a brush, rectangle, lasso or the cells and room
   * under it are dropped, a polygon keeps its corners (less the one this press placed), as Atlas's `dropDrag`.
   */
  dropPress(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    if (!gesture.dropPress) { this.cancel(); return; }
    gesture.dropPress();
    this.settle(gesture, []);
  }

  /** Drops the shape under way without committing it (a polygon's corners too). */
  cancel(): void {
    this.gesture?.cancel();
    this.gesture = null;
    this.releaseHold();
    this.showMarks();
  }

  /** The pointer left the canvas: the ring goes (a shape under way goes on), and what a resting pointer showed. */
  leave(): void {
    this.pointer = null;
    this.pointerAt = null;
    this.hideRing();
    if (!this.gesture) this.clearMarks();
  }

  /**
   * The fog menu is open on `outlines` (the body of fog or the revealed fog its entries act on), or closed (null): they are marked
   * in the theme's accent for as long as it is open, and go when the fog changes.
   */
  showTarget(outlines: ReadonlyArray<ReadonlyArray<FogPoint>> | null): void {
    const rings = (outlines ?? []).flatMap((outline) => (outline.length >= 3 ? outlineRings(outline) : []));
    this.targetKey = rings.length > 0 ? this.deps.fogKey() : null;
    if (rings.length === 0) this.target.clear();
    else this.target.setMarks({ paths: rings.map((ring) => ({ points: ring, closed: true, alpha: 1 })), accent: true }, false, this.pixel());
    this.deps.wake();
  }

  /** The board drew the fog the store holds (or the stroke was not kept): the stroke's preview is no longer needed. */
  fogDrawn(): void {
    if (this.targetKey !== null && this.deps.fogKey() !== this.targetKey) this.showTarget(null);
    if (this.holding !== null && this.deps.fogKey() !== this.heldKey) this.releaseHold();
  }

  /** The stroke was refused or is lost: its preview goes at once. */
  failed(): void {
    this.releaseHold();
  }

  /** Once a frame: the ring and the marks keep their width on screen and the ring its place under a pointer that rests while the camera moves. */
  frame(): void {
    if (!this.onNow) return;
    if (this.pointer) this.refreshRing(true);
    this.marks.frame(this.pixel());
    this.target.frame(this.pixel());
  }

  dispose(): void {
    this.cancel();
    this.preview.dispose();
    this.marks.dispose();
    this.target.dispose();
    if (this.ring) {
      for (const mesh of [this.ring.dark, this.ring.light]) {
        this.deps.parent.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
    }
    this.ring = null;
  }

  private releaseHold(): void {
    if (this.holding !== null) { clearTimeout(this.holding); this.holding = null; }
    this.heldPolygons = [];
    if (!this.drawing) this.clearSheet();
    this.deps.wake();
  }

  private kindNow(): string { return `${this.erasing}:${this.washes}`; }

  private clearSheet(): void {
    this.sheetOn = false;
    this.preview.clear();
  }

  /** Map units per screen pixel where the pointer is (else at the middle of the map). */
  private pixel(): number {
    const size = this.deps.mapSize();
    const at = this.pointerAt ?? (size ? { x: size.width / 2, y: size.height / 2 } : { x: 0, y: 0 });
    const px = this.deps.unitsPerPixel(at);
    return px > 0 && Number.isFinite(px) ? px : 1;
  }

  /** Shows the lines of the shape under way, or of the one a resting pointer is over. */
  private showMarks(): void {
    const gesture = this.gesture ?? (this.onNow ? this.gestureOf(this.shapeNow) : null);
    this.marks.setMarks(gesture?.marks() ?? null, this.erasing, this.pixel());
    this.deps.wake();
  }

  private clearMarks(): void {
    for (const gesture of Object.values(this.gestures)) gesture?.rest?.();
    this.marks.clear();
    this.deps.wake();
  }

  /** The count of points the stroke under way had before the pointer moved, to draw only what it added. */
  private previewLast(): FogPoint | null {
    const spec = this.gesture?.preview();
    return spec?.kind === 'brush' ? spec.points[spec.points.length - 1] ?? null : null;
  }

  /** Begins the preview sheet over the map where it is not begun. */
  private ensureSheet(): boolean {
    const size = this.deps.mapSize();
    if (!size) return false;
    if (!this.sheetOn) {
      this.preview.begin(size.width, size.height, this.erasing);
      this.sheetOn = true;
      this.sheetKind = this.kindNow();
    }
    this.preview.setErasing(this.erasing);
    this.preview.setWash(this.washes);
    return true;
  }

  private drawSheet(polygons: ReadonlyArray<ReadonlyArray<FogPoint>>, behind: ReadonlyArray<ReadonlyArray<ReadonlyArray<FogPoint>>> = this.heldPolygons): void {
    if (!this.ensureSheet()) return;
    this.preview.polygons(polygons, behind);
    this.deps.wake();
  }

  private drawPreview(before: FogPoint | null): void {
    const spec: FogPreviewSpec | null | undefined = this.gesture?.preview();
    if (!spec) return;
    if (spec.kind === 'brush') {
      if (!this.ensureSheet()) return;
      const last = spec.points[spec.points.length - 1];
      if (last) this.preview.brush(before ?? last, last, spec.radius);
    } else {
      this.drawSheet(spec.polygons);
    }
    this.deps.wake();
  }

  private hideRing(): void {
    if (this.ring?.light.visible) {
      this.ring.light.visible = false;
      this.ring.dark.visible = false;
      this.deps.wake();
    }
  }

  /** Places the ring at the pointer, as large as the brush and as wide on screen as Atlas's, in the colour of what a stroke does. */
  private refreshRing(follow = false): void {
    if (!this.onNow || this.shapeNow !== 'brush' || !this.pointer) { this.hideRing(); return; }
    const at = follow || !this.pointerAt ? this.deps.boardPoint(this.pointer.x, this.pointer.y) : this.pointerAt;
    if (!at) { this.hideRing(); return; }
    this.pointerAt = at;
    const px = this.deps.unitsPerPixel(at);
    if (!(px > 0) || !Number.isFinite(px)) return;
    if (!this.ring) {
      const make = (order: number): THREE.Mesh => {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
        mesh.renderOrder = order;
        mesh.raycast = () => {};
        mesh.name = 'fog-ring';
        this.deps.parent.add(mesh);
        return mesh;
      };
      this.ring = { dark: make(20), light: make(21) };
    }
    const { dark, light } = this.ring;
    // Rebuilt only when the brush or the screen scale changed by a share of a percent.
    const key = `${this.sizeNow}:${Math.round(px * 100)}`;
    if (key !== this.ringKey) {
      this.ringKey = key;
      const band = (line: { width: number }): THREE.BufferGeometry => {
        const half = (line.width * px) / 2;
        return new THREE.RingGeometry(Math.max(0, this.sizeNow - half), this.sizeNow + half, RING_SEGMENTS).rotateX(-Math.PI / 2);
      };
      dark.geometry.dispose();
      light.geometry.dispose();
      dark.geometry = band(DARK_LINE);
      light.geometry = band(LIGHT_LINE);
    }
    (dark.material as THREE.MeshBasicMaterial).color.set('#000000');
    (dark.material as THREE.MeshBasicMaterial).opacity = DARK_LINE.alpha;
    (light.material as THREE.MeshBasicMaterial).color.set(this.erasing ? RING_ERASE : RING_PAINT);
    (light.material as THREE.MeshBasicMaterial).opacity = LIGHT_LINE.alpha;
    for (const mesh of [dark, light]) {
      mesh.position.set(at.x, RING_HEIGHT, at.y);
      mesh.visible = true;
    }
    // A frame is being drawn already; anything else asks for one.
    if (!follow) this.deps.wake();
  }
}

/** What Atlas's fog actions the host can do now (an older Atlas lacks some: the matching control is disabled). */
export interface FogOffers {
  add: boolean;
  clear: boolean;
  cover: boolean;
  hideRooms: boolean;
  /** The fog menu's Reveal, and Hide and Delete on revealed ground (Atlas 0.18). */
  reveal: boolean;
  hide: boolean;
  forget: boolean;
}

/** The fog tool's switches (Atlas 0.18's tool switches): what Ctrl or Cmd and Shift are to a keyboard. */
export type FogSwitchId = 'fogSnap' | 'fogConstrain';

/** The board's fog tool as its host gives it: Atlas's store through the writer, Atlas's settings, notices. */
export interface FogHost {
  offers(): FogOffers;
  /** Writes the operations on the level shown, in one step; settles once kept or refused (a refusal is the host's to tell). */
  add(operations: FogOperationInput[]): Promise<unknown> | void;
  clear(): Promise<unknown> | void;
  /** Hides the whole map (`rect`: the map as the board draws it); false: nothing to cover. */
  cover(rect: { x: number; y: number; width: number; height: number } | null): Promise<boolean> | boolean;
  hideRooms(rect: { x: number; y: number; width: number; height: number } | null): Promise<{ rooms: number; hidden: number }> | { rooms: number; hidden: number };
  /** The fog menu: reveals the bodies of fog (outlines) remembering them, hides a remembered revealed fog again (its id), forgets it. */
  reveal(outlines: ReadonlyArray<ReadonlyArray<FogPoint>>): Promise<unknown> | void;
  hide(id: string): Promise<unknown> | void;
  forget(id: string): Promise<unknown> | void;
  /** Atlas's "Fog opacity in GM view" (0.1 to 1) where Atlas has it (0.17+), else null; and setting it. */
  gmOpacity?(): number | null;
  setGmOpacity?(opacity: number): void;
  /** Atlas's tool switches where it has them; else the board keeps them. */
  switchOn?(id: FogSwitchId): boolean | null;
  setSwitch?(id: FogSwitchId, on: boolean): boolean;
  /** The keys of Atlas's smaller and larger brush, as shown. */
  brushKeys?(): string;
  /** Atlas's own notice. */
  notice(text: string): void;
}

/** What the fog tool's bars ask of the board. */
export interface FogBarActions {
  state(): { on: boolean; mode: FogToolId; shape: FogShape; brushSize: number };
  /** Takes the tool up (as `mode`, else as it was left). */
  start(mode?: FogToolId): void;
  stop(): void;
  setMode(mode: FogToolId): void;
  setShape(shape: FogShape): void;
  setBrushSize(size: number): void;
  /** The map's grid cell in map pixels, 0 without a grid. */
  cellSize(): number;
  hasWalls(): boolean;
  levelled(): boolean;
  anyFog(): boolean;
  offers(): FogOffers;
  cover(): void;
  clear(): void;
  hideRooms(): void;
  /** Atlas's GM fog opacity (0.1 to 1), null where Atlas cannot be reached or lacks it; setting it. */
  gmOpacity(): number | null;
  setGmOpacity(opacity: number): void;
  switchOn(id: FogSwitchId): boolean;
  setSwitch(id: FogSwitchId, on: boolean): void;
  brushKeys(): string;
  /** The key of Atlas's fog tool as shown ("F"), null when it has none. */
  hotkey(): string | null;
}
