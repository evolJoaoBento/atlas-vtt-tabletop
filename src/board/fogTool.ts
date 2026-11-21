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
import { FogPreview } from './fogPreview';

export type { FogShape, FogToolId } from '../atlasPort/fogToolChoices';

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

/** The keys held during a press, as the gesture gets them: Alt is the tool's (it flips painting and erasing). */
export interface FogKeys {
  shift: boolean;
  ctrl: boolean;
}

/** What a gesture under way shows on the ground. */
export type FogPreviewSpec =
  | { kind: 'brush'; points: readonly FogPoint[]; radius: number }
  | { kind: 'polygons'; polygons: ReadonlyArray<ReadonlyArray<FogPoint>> };

/** One shape's press, drag and release. */
export interface FogGesture {
  readonly active: boolean;
  /** A press at `at` in map pixels; false where this shape does not begin. */
  down(at: FogPoint, keys: FogKeys, brushRadius: number): boolean;
  move(at: FogPoint, keys: FogKeys): void;
  /** The release: what to commit (nothing: an empty list). The gesture is over. */
  up(at: FogPoint, keys: FogKeys): FogShapeInput[];
  cancel(): void;
  preview(): FogPreviewSpec | null;
}

/** A brush stroke: every point the pointer passes (a tap is one point), with the brush's radius at the press. */
export class BrushGesture implements FogGesture {
  private points: FogPoint[] = [];
  private radius = DEFAULT_FOG_TOOL.brushSize;
  private drawing = false;

  get active(): boolean { return this.drawing; }

  down(at: FogPoint, _keys: FogKeys, brushRadius: number): boolean {
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
}

/** The gesture a shape is drawn with; null for one that has none yet. */
export function gestureFor(shape: FogShape): FogGesture | null {
  return shape === 'brush' ? new BrushGesture() : null;
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
}

export class FogTool {
  private onNow = false;
  private modeNow: FogToolId = 'fog';
  private shapeNow: FogShape = DEFAULT_FOG_TOOL.shape;
  private sizeNow: number = DEFAULT_FOG_TOOL.brushSize;
  /** Alt is held: a stroke does the other thing. */
  private flipped = false;
  private gesture: FogGesture | null = null;
  private ring: { dark: THREE.Mesh; light: THREE.Mesh } | null = null;
  private ringKey = '';
  private readonly preview: FogPreview;
  /** Where the pointer last was on screen, and over the ground; null once it left the canvas. */
  private pointer: { x: number; y: number } | null = null;
  private pointerAt: FogPoint | null = null;
  /** The preview of a stroke that was committed stays until the fog drawn holds it (`fogDrawn`), or this timer. */
  private holding: ReturnType<typeof setTimeout> | null = null;
  private heldKey = '';

  constructor(private readonly deps: FogToolDeps) {
    this.preview = new FogPreview(deps.parent, () => deps.canvas());
  }

  get on(): boolean { return this.onNow; }
  get mode(): FogToolId { return this.modeNow; }
  get shape(): FogShape { return this.shapeNow; }
  get brushSize(): number { return this.sizeNow; }
  /** A shape is under way. */
  get drawing(): boolean { return this.gesture?.active === true; }
  /** The ring's meshes (for tests): the dark line and the light one. */
  get rings(): { dark: THREE.Mesh; light: THREE.Mesh } | null { return this.ring; }
  /** Whether a stroke made now erases: the eraser does, and Alt makes a stroke do the other thing. */
  get erasing(): boolean { return fogStrokeErases(this.modeNow, this.flipped); }

  /** Takes the tool up (as `mode`, else as it was left), or puts it down. */
  setOn(on: boolean, mode?: FogToolId): void {
    if (mode) this.modeNow = mode;
    if (on === this.onNow) { if (on) this.refreshRing(); this.deps.changed(); return; }
    this.onNow = on;
    if (!on) {
      this.cancel();
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
    this.deps.changed();
  }

  /** Atlas's fog key: opens the tool, and while it is open turns it between fog and eraser. */
  toggleMode(): void {
    this.setMode(this.modeNow === 'fog' ? 'eraser' : 'fog');
  }

  setShape(shape: FogShape): void {
    if (shape === this.shapeNow) return;
    this.cancel();
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
    this.deps.wake();
    this.deps.changed();
  }

  /** A press: begins the shape under the pointer; false where nothing begins (the tool is off, the shape has no gesture yet). */
  down(clientX: number, clientY: number, keys: FogKeys, alt: boolean): boolean {
    if (!this.onNow) return false;
    const at = this.deps.boardPoint(clientX, clientY);
    const gesture = gestureFor(this.shapeNow);
    const size = this.deps.mapSize();
    if (!at || !gesture || !size) return false;
    this.setFlipped(alt);
    if (!gesture.down(at, keys, this.sizeNow)) return false;
    this.releaseHold();
    this.gesture = gesture;
    this.pointer = { x: clientX, y: clientY };
    this.pointerAt = at;
    this.preview.begin(size.width, size.height, this.erasing);
    this.drawPreview(null);
    this.refreshRing();
    return true;
  }

  /** The pointer moved (also while it only hovers): the ring follows it, a shape under way grows. */
  move(clientX: number, clientY: number, keys: FogKeys, alt: boolean): void {
    if (!this.onNow) return;
    this.setFlipped(alt);
    this.pointer = { x: clientX, y: clientY };
    const at = this.deps.boardPoint(clientX, clientY);
    this.pointerAt = at;
    if (at && this.gesture?.active) {
      const before = this.previewLast();
      this.gesture.move(at, keys);
      this.drawPreview(before);
    }
    this.refreshRing();
  }

  /** The release: commits what the shape under way covers. */
  up(clientX: number, clientY: number, keys: FogKeys, alt: boolean): void {
    const gesture = this.gesture;
    if (!gesture) return;
    this.setFlipped(alt);
    const at = this.deps.boardPoint(clientX, clientY) ?? this.pointerAt;
    this.gesture = null;
    const shapes = at ? gesture.up(at, keys) : (gesture.cancel(), []);
    if (shapes.length === 0) { this.preview.clear(); return; }
    const isErasing = this.erasing;
    // The preview stays, as it is, until the fog volume holds the stroke (it would flicker off and on again): held before
    // the write, which may be drawn at once.
    this.heldKey = this.deps.fogKey();
    this.holding = setTimeout(() => this.releaseHold(), 2000);
    this.deps.commit(shapes.map((shape) => ({ ...shape, isErasing }) as FogOperationInput));
  }

  /** Drops the shape under way without committing it. */
  cancel(): void {
    this.gesture?.cancel();
    this.gesture = null;
    this.releaseHold();
  }

  /** The pointer left the canvas: the ring goes (a shape under way goes on). */
  leave(): void {
    this.pointer = null;
    this.pointerAt = null;
    this.hideRing();
  }

  /** The board drew the fog the store holds (or the stroke was not kept): the stroke's preview is no longer needed. */
  fogDrawn(): void {
    if (this.holding !== null && this.deps.fogKey() !== this.heldKey) this.releaseHold();
  }

  /** The stroke was refused or is lost: its preview goes at once. */
  failed(): void {
    this.releaseHold();
  }

  /** Once a frame: the ring keeps its width on screen and its place under a pointer that rests while the camera moves. */
  frame(): void {
    if (this.onNow && this.pointer) this.refreshRing(true);
  }

  dispose(): void {
    this.cancel();
    this.preview.dispose();
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
    if (!this.drawing) this.preview.clear();
    this.deps.wake();
  }

  /** The count of points the stroke under way had before the pointer moved, to draw only what it added. */
  private previewLast(): FogPoint | null {
    const spec = this.gesture?.preview();
    return spec?.kind === 'brush' ? spec.points[spec.points.length - 1] ?? null : null;
  }

  private drawPreview(before: FogPoint | null): void {
    const spec = this.gesture?.preview();
    if (!spec) return;
    if (spec.kind === 'brush') {
      const last = spec.points[spec.points.length - 1];
      if (last) this.preview.brush(before ?? last, last, spec.radius);
    } else {
      this.preview.polygons(spec.polygons);
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
