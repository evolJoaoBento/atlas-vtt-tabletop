/**
 * The Shapes tool of the GM's board, in Edit mode: raised shapes (roofs, hills) drawn on the level shown
 * (`terrainShapes.ts`). A click on the floor starts a shape and each further click adds a corner to its outline (at
 * the last corner's height); clicking its first corner, Enter or Escape finishes it. A click inside the shape picked
 * adds a corner there, at the surface's height. A corner is dragged to move it, Ctrl + dragged to raise or lower it
 * (Shift: quarter squares), its height typed in the panel; Delete takes it out. The board gives the floor point and
 * the pick; the shapes are kept by the host (the board data), and drawn by the board from them and `edited`.
 */
import * as THREE from 'three';
import { pointInOutline, pointOf, shapeHeightAt, withAdded, withoutPoint, withPoint, type PointRef, type ShapePoint, type TerrainShape } from './terrainShapes';

export interface ShapeEditorDeps {
  /** World units to a grid square. */
  cell(): number;
  /** The shapes of the level shown, as kept. */
  shapes(): readonly TerrainShape[];
  /** The point of the level's floor under the pointer, in its pixels. */
  floorAt(clientX: number, clientY: number): { x: number; y: number } | null;
  /** The handle under the pointer, of those given. */
  pick(clientX: number, clientY: number, objects: THREE.Object3D[]): THREE.Object3D | null;
  /** Keeps a shape (a new one, or the one of its id). */
  save(shape: TerrainShape): void;
  remove(id: string): void;
  /** What is drawn changed: the board draws again (the shape being edited with it). */
  changed(): void;
}

type Drag = { kind: 'move' | 'height'; shape: string; ref: PointRef; x: number; y: number; start: number; moved: boolean };

const HEIGHT_PER_PX = 0.02;
const DRAG_PX = 4;

export class ShapeEditor {
  readonly object3d = new THREE.Group();
  private on = false;
  /** The shape being drawn (its outline still open), and the one picked with its picked corner. */
  private drawing: string | null = null;
  private selected: { shape: string; ref: PointRef | null } | null = null;
  /** A shape changed here and not yet kept (a corner dragged, a shape of fewer than three corners). */
  private edit: TerrainShape | null = null;
  private drag: Drag | null = null;
  private handles: THREE.Mesh[] = [];
  private readonly lines = new THREE.Group();
  private readonly panel: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly heightInput: HTMLInputElement;
  private readonly finishButton: HTMLButtonElement;
  private readonly cornerButton: HTMLButtonElement;
  private readonly shapeButton: HTMLButtonElement;

  constructor(container: HTMLElement, private readonly deps: ShapeEditorDeps) {
    this.object3d.name = 'shape-editor';
    this.object3d.add(this.lines);
    this.object3d.visible = false;
    const doc = container.ownerDocument;
    this.panel = doc.createElement('div');
    this.panel.className = 'atlas-tabletop-shapes-panel';
    this.panel.hidden = true;
    const title = doc.createElement('div');
    title.className = 'atlas-tabletop-shapes-panel__title';
    title.textContent = 'Shapes';
    this.hint = doc.createElement('div');
    this.hint.className = 'atlas-tabletop-shapes-panel__hint';
    const row = doc.createElement('label');
    row.className = 'atlas-tabletop-shapes-panel__row';
    row.append('Height (squares) ');
    this.heightInput = doc.createElement('input');
    this.heightInput.type = 'number';
    this.heightInput.step = '0.25';
    this.heightInput.setAttribute('aria-label', 'Corner height in squares');
    this.heightInput.addEventListener('change', () => this.typedHeight());
    row.append(this.heightInput);
    const buttons = doc.createElement('div');
    buttons.className = 'atlas-tabletop-shapes-panel__buttons';
    const button = (label: string, act: () => void): HTMLButtonElement => {
      const b = doc.createElement('button');
      b.textContent = label;
      b.addEventListener('click', () => act());
      buttons.append(b);
      return b;
    };
    this.finishButton = button('Finish shape', () => this.finish());
    this.cornerButton = button('Delete corner', () => this.deleteCorner());
    this.shapeButton = button('Delete shape', () => this.deleteShape());
    this.shapeButton.classList.add('mod-warning');
    this.panel.append(title, this.hint, row, buttons);
    // Presses on the panel are its own (not the board's).
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.panel.addEventListener('keydown', (event) => event.stopPropagation());
    container.append(this.panel);
  }

  get active(): boolean {
    return this.on;
  }

  setActive(on: boolean): void {
    if (this.on === on) return;
    if (!on) this.finish();
    this.on = on;
    this.drag = null;
    if (!on) { this.selected = null; this.edit = null; }
    this.object3d.visible = on;
    this.panel.hidden = !on;
    this.refresh();
  }

  /** The shape being changed here, to be drawn in place of the kept one (or as a new one). */
  get edited(): TerrainShape | null {
    return this.edit;
  }

  /** The shapes as they are drawn: the kept ones, with the one being edited in place of its kept self. */
  merged(kept: readonly TerrainShape[]): TerrainShape[] {
    const edit = this.edit;
    if (!edit) return [...kept];
    const out = kept.map((shape) => (shape.id === edit.id ? edit : shape));
    if (!kept.some((shape) => shape.id === edit.id)) out.push(edit);
    return out.filter((shape) => shape.outline.length >= 3);
  }

  private shape(id: string | null | undefined): TerrainShape | null {
    if (!id) return null;
    if (this.edit?.id === id) return this.edit;
    return this.deps.shapes().find((shape) => shape.id === id) ?? null;
  }

  /** Keeps a shape once it has an outline (three corners or more); a smaller one stays here until it does. */
  private keep(shape: TerrainShape): void {
    if (shape.outline.length >= 3) {
      this.edit = null;
      this.deps.save(shape);
    } else this.edit = shape;
    this.refresh();
    this.deps.changed();
  }

  // ── Input from the board ────────────────────────────────────────────────

  /** A press on the board while the tool is on: true when it was the tool's. */
  down(clientX: number, clientY: number, button: number, ctrl: boolean): boolean {
    if (!this.on || button !== 0) return false;
    const handle = this.deps.pick(clientX, clientY, this.handles);
    if (handle) {
      const shapeId = handle.userData.shape as string;
      const ref = handle.userData.ref as PointRef;
      const shape = this.shape(shapeId);
      // The first corner of a shape being drawn closes it.
      if (this.drawing === shapeId && ref.list === 'outline' && ref.index === 0 && shape && shape.outline.length >= 3) {
        this.finish();
        return true;
      }
      this.selected = { shape: shapeId, ref };
      const point = shape ? pointOf(shape, ref) : null;
      this.drag = { kind: ctrl ? 'height' : 'move', shape: shapeId, ref, x: clientX, y: clientY, start: point?.h ?? 0, moved: false };
      this.refresh();
      return true;
    }
    const at = this.deps.floorAt(clientX, clientY);
    if (!at) return true;
    const drawing = this.shape(this.drawing);
    if (drawing) {
      const last = drawing.outline[drawing.outline.length - 1];
      const next = withAdded(drawing, 'outline', { x: at.x, y: at.y, h: last?.h ?? 0 });
      this.selected = { shape: next.id, ref: { list: 'outline', index: next.outline.length - 1 } };
      this.keep(next);
      return true;
    }
    const picked = this.shape(this.selected?.shape);
    if (picked && pointInOutline(picked.outline, at.x, at.y)) {
      const next = withAdded(picked, 'inner', { x: at.x, y: at.y, h: shapeHeightAt(picked, at.x, at.y) ?? 0 });
      this.selected = { shape: next.id, ref: { list: 'inner', index: next.inner.length - 1 } };
      this.keep(next);
      return true;
    }
    const id = `shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const fresh: TerrainShape = { id, outline: [{ x: at.x, y: at.y, h: 0 }], inner: [] };
    this.drawing = id;
    this.selected = { shape: id, ref: { list: 'outline', index: 0 } };
    this.keep(fresh);
    return true;
  }

  /** The pointer moved: a corner being dragged follows it. */
  move(clientX: number, clientY: number, shift: boolean): boolean {
    const drag = this.drag;
    if (!drag) return false;
    if (!drag.moved && Math.hypot(clientX - drag.x, clientY - drag.y) < DRAG_PX) return true;
    drag.moved = true;
    const shape = this.shape(drag.shape);
    if (!shape) return true;
    let change: Partial<ShapePoint>;
    if (drag.kind === 'height') {
      let h = drag.start + (drag.y - clientY) * HEIGHT_PER_PX;
      if (shift) h = Math.round(h * 4) / 4;
      change = { h: Math.round(h * 100) / 100 };
    } else {
      const at = this.deps.floorAt(clientX, clientY);
      if (!at) return true;
      change = { x: at.x, y: at.y };
    }
    this.edit = withPoint(shape, drag.ref, change);
    this.refresh();
    this.deps.changed();
    return true;
  }

  /** The press let go: a dragged corner is kept where it is. */
  up(): boolean {
    const drag = this.drag;
    if (!drag) return false;
    this.drag = null;
    if (drag.moved && this.edit?.id === drag.shape) this.keep(this.edit);
    return true;
  }

  /** A key while the tool is on: Enter or Escape finish the shape drawn (Escape then lets go of the pick); Delete takes the picked corner out. */
  key(key: string): boolean {
    if (!this.on) return false;
    if (key === 'enter') { this.finish(); return true; }
    if (key === 'escape') {
      if (this.drawing) this.finish();
      else if (this.selected) { this.selected = null; this.refresh(); }
      else return false;
      return true;
    }
    if (key === 'delete' || key === 'backspace') { this.deleteCorner(); return true; }
    return false;
  }

  /** The shapes kept changed (or the level shown): handles drawn again. */
  refresh(): void {
    const cell = this.deps.cell();
    for (const handle of this.handles) { handle.removeFromParent(); handle.geometry.dispose(); (handle.material as THREE.Material).dispose(); }
    this.handles = [];
    for (const line of [...this.lines.children]) { line.removeFromParent(); (line as THREE.Line).geometry.dispose(); ((line as THREE.Line).material as THREE.Material).dispose(); }
    const shapes = this.merged(this.deps.shapes());
    const small = this.edit && this.edit.outline.length < 3 ? [this.edit] : [];
    if (this.on) {
      for (const shape of [...shapes, ...small]) {
        const picked = this.selected?.shape === shape.id;
        const outline = shape.outline.map((p) => new THREE.Vector3(p.x, p.h * cell + 0.5, p.y));
        if (outline.length >= 2) {
          const geometry = new THREE.BufferGeometry().setFromPoints(this.drawing === shape.id ? outline : [...outline, outline[0]]);
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: picked ? 0xffd166 : 0xffffff, depthTest: false, transparent: true, opacity: picked ? 1 : 0.6 }));
          line.renderOrder = 998;
          this.lines.add(line);
        }
        for (const list of ['outline', 'inner'] as const) {
          shape[list].forEach((p, index) => {
            const chosen = picked && this.selected?.ref?.list === list && this.selected.ref.index === index;
            const handle = new THREE.Mesh(
              new THREE.SphereGeometry(cell * (chosen ? 0.16 : 0.12), 12, 8),
              new THREE.MeshBasicMaterial({ color: chosen ? 0xffd166 : list === 'outline' ? 0xffffff : 0x7ec8ff, depthTest: false, transparent: true }),
            );
            handle.position.set(p.x, p.h * cell, p.y);
            handle.renderOrder = 999;
            handle.userData.shape = shape.id;
            handle.userData.ref = { list, index } satisfies PointRef;
            this.handles.push(handle);
            this.object3d.add(handle);
          });
        }
      }
    }
    this.showPanel();
  }

  private showPanel(): void {
    const shape = this.shape(this.selected?.shape);
    const point = shape && this.selected?.ref ? pointOf(shape, this.selected.ref) : null;
    this.hint.textContent = this.drawing
      ? 'Click to add corners round the shape; click its first corner (or Enter) to finish.'
      : shape
        ? 'Click inside to add a corner (a ridge, a peak). Drag a corner to move it, Ctrl + drag to raise it.'
        : 'Click the floor to start a shape (a roof, a hill).';
    this.heightInput.disabled = point === null;
    if (point && this.panel.ownerDocument.activeElement !== this.heightInput) this.heightInput.value = String(Math.round(point.h * 100) / 100);
    if (!point) this.heightInput.value = '';
    this.finishButton.hidden = this.drawing === null;
    this.cornerButton.disabled = point === null;
    this.shapeButton.disabled = shape === null;
  }

  private typedHeight(): void {
    const shape = this.shape(this.selected?.shape);
    const ref = this.selected?.ref;
    const h = Number(this.heightInput.value);
    if (!shape || !ref || !Number.isFinite(h)) return;
    this.keep(withPoint(shape, ref, { h }));
  }

  /** The shape drawn is done; one of fewer than three corners is dropped. */
  finish(): void {
    const id = this.drawing;
    this.drawing = null;
    if (id && this.edit?.id === id && this.edit.outline.length < 3) { this.edit = null; this.selected = null; this.deps.changed(); }
    this.refresh();
  }

  private deleteCorner(): void {
    const shape = this.shape(this.selected?.shape);
    const ref = this.selected?.ref;
    if (!shape || !ref) return;
    const next = withoutPoint(shape, ref);
    this.selected = { shape: shape.id, ref: null };
    if (next.outline.length < 3 && this.drawing !== shape.id) { this.deleteShape(); return; }
    this.keep(next);
  }

  private deleteShape(): void {
    const shape = this.shape(this.selected?.shape);
    if (!shape) return;
    if (this.drawing === shape.id) this.drawing = null;
    if (this.edit?.id === shape.id) this.edit = null;
    this.selected = null;
    this.deps.remove(shape.id);
    this.refresh();
    this.deps.changed();
  }

  dispose(): void {
    this.setActive(false);
    for (const handle of this.handles) { handle.geometry.dispose(); (handle.material as THREE.Material).dispose(); }
    this.panel.remove();
    this.object3d.removeFromParent();
  }
}
