/**
 * The background editor: where the GM paints a background's terrain, materials and heights, and saves it. On the left
 * the saved backgrounds; in the middle the painting canvas with its tools and palette; on the right the background's
 * settings (patterns, heights, liquids).
 *
 * The canvas shows one layer in its colours and the others faintly under it. The map's footprint is shaded in the
 * middle so the GM sees which part of the picture the board stands on. The wheel zooms, a right-drag pans.
 *
 * A stroke or a fill is one undo step. A changed background is not left, replaced or duplicated without asking
 * (Save / Discard / Cancel, in a bar inside the editor).
 */

import { BACKGROUND_SIZE, MAX_MATERIALS, TERRAINS, type BackgroundLayers, type BackgroundSettings, readBackgroundSettings } from './backgroundData';
import { planeReach } from '../board/ground';
import { buildSettingsPanel,type SettingsPanel } from './backgroundSettingsPanel';
import type { BackgroundStore } from './backgroundStore';
import { LayerHistory, floodFill, paintStroke, type PixelBox } from './layerPaint';
import { BRUSH_COLORS, renderPropBrushPanel } from './propBrushPanel';

/** What the editor needs from the plugin around it. */
export interface BackgroundEditorHost {
  store: BackgroundStore;
  /** The ground materials of the gallery a material slot can be picked from. */
  materials(): { path: string; name: string; thumb: string | null }[];
  /** The props (3D models) of the gallery a prop brush can scatter. */
  props(): { path: string; name: string; thumb: string | null }[];
  /** A picture address for a saved thumbnail (a `thumb.png` path from the store's list); null when there is none. */
  thumbnail?(path: string): Promise<string | null>;
}

type LayerName = 'terrain' | 'material' | 'height' | 'props';
type Tool = 'brush' | 'eraser' | 'fill';

/** How wide the map is in the picture, in pixels: the picture spans twice the plane's reach (at its thinnest fog) in map widths (`backgroundFrame` lays it so). */
export const MAP_FOOTPRINT = BACKGROUND_SIZE / (2 * planeReach(80, 1));
/** The colours the material slots are shown in (0 is plain ground). */
const MATERIAL_COLORS = ['#7a7a7a', '#d9822b', '#3b8ed0', '#c94f8a', '#7bc043'];
const LAYERS: readonly { id: LayerName; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'material', label: 'Material' },
  { id: 'height', label: 'Height' },
  { id: 'props', label: 'Props' },
];
const TOOLS: readonly { id: Tool; label: string }[] = [
  { id: 'brush', label: 'Brush' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'fill', label: 'Fill' },
];
const MAX_ZOOM = 16;

function rgbOf(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Three bytes per index: the colour each terrain / material number is shown in. */
function colorTable(entries: readonly (readonly [number, string])[], fallback: string): Uint8Array {
  const table = new Uint8Array(256 * 3);
  const base = rgbOf(fallback);
  for (let i = 0; i < 256; i++) table.set(base, i * 3);
  for (const [index, color] of entries) table.set(rgbOf(color), index * 3);
  return table;
}
const TERRAIN_RGB = colorTable(TERRAINS.map((t) => [t.index, t.color] as const), TERRAINS[0].color);
const MATERIAL_RGB = colorTable(MATERIAL_COLORS.map((c, i) => [i, c] as const), MATERIAL_COLORS[0]);
/** The colour of each prop brush number (0, no brush, is never looked up). */
const BRUSH_RGB = colorTable(BRUSH_COLORS.map((c, i) => [i + 1, c] as const), BRUSH_COLORS[0]);

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class BackgroundEditor {
  private readonly root: HTMLElement;
  private readonly doc: Document;
  private readonly canvas: HTMLCanvasElement;
  private readonly wrap: HTMLElement;
  private readonly paintCanvas: HTMLCanvasElement;
  private readonly paintCtx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly listEl: HTMLElement;
  private readonly listHead: HTMLElement;
  private readonly toolsEl: HTMLElement;
  private readonly paletteEl: HTMLElement;
  private readonly unsavedEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly heightGroup: HTMLElement;
  private readonly heightLabel: HTMLElement;
  private readonly panel: SettingsPanel;
  private readonly resize: ResizeObserver;
  private readonly unsubscribe: () => void;

  private folderPath: string | null = null;
  private background: BackgroundLayers | null = null;
  private config: BackgroundSettings = readBackgroundSettings(undefined);
  private histories: Record<LayerName, LayerHistory> | null = null;
  private changed = false;
  /** Counts every edit, so a save can tell whether something was changed while it was being written. */
  private edits = 0;
  private disposed = false;
  private openCount = 0;
  private listCount = 0;
  private frame = 0;

  private layer: LayerName = 'terrain';
  private tool: Tool = 'brush';
  private terrainId = 'plains';
  private slot = 0;
  /** The prop brush painted with on the Props layer (1 to 6), or 0 when there is none. */
  private brush = 0;
  private radius = 24;
  private heightValue = 200;
  private soft = true;

  private viewState = { scale: 1, x: 0, y: 0, fit: 1, moved: false };
  private hover: { x: number; y: number } | null = null;
  private stroke: { history: LayerHistory; layer: Uint8Array; last: { x: number; y: number } } | null = null;
  private pan: { x: number; y: number; vx: number; vy: number } | null = null;
  private pending: (() => Promise<void>) | null = null;
  /** Set while the unsaved-changes bar waits for an answer to `requestLeave`; called when that answer is Cancel or a failed Save. */
  private leaveCancel: (() => void) | null = null;
  private naming: { kind: 'new' } | { kind: 'rename'; folder: string } | null = null;
  private deleting = false;
  private message: { text: string; error: boolean } | null = null;

  constructor(container: HTMLElement, private readonly host: BackgroundEditorHost) {
    this.doc = container.ownerDocument;
    this.root = this.el(container, 'div', 'atlas-tabletop-bg');
    this.root.tabIndex = -1;
    const left = this.el(this.root, 'div', 'atlas-tabletop-bg-left');
    this.listHead = this.el(left, 'div', 'atlas-tabletop-bg-listhead');
    this.listEl = this.el(left, 'div', 'atlas-tabletop-bg-list');
    const middle = this.el(this.root, 'div', 'atlas-tabletop-bg-middle');
    this.unsavedEl = this.el(middle, 'div', 'atlas-tabletop-bg-unsaved');
    this.unsavedEl.hidden = true;
    this.toolsEl = this.el(middle, 'div', 'atlas-tabletop-bg-tools');
    this.wrap = this.el(middle, 'div', 'atlas-tabletop-bg-canvaswrap');
    this.canvas = this.el(this.wrap, 'canvas', 'atlas-tabletop-bg-canvas');
    this.paletteEl = this.el(middle, 'div', 'atlas-tabletop-bg-palette');
    const right = this.el(this.root, 'div', 'atlas-tabletop-bg-right');

    this.paintCanvas = this.doc.createElement('canvas');
    this.paintCanvas.width = BACKGROUND_SIZE;
    this.paintCanvas.height = BACKGROUND_SIZE;
    const paintCtx = this.paintCanvas.getContext('2d');
    if (!paintCtx) throw new Error('No canvas');
    this.paintCtx = paintCtx;
    this.image = paintCtx.createImageData(BACKGROUND_SIZE, BACKGROUND_SIZE);
    this.pixels = new Uint32Array(this.image.data.buffer);

    // The tool row.
    const { heightGroup, heightLabel, statusEl } = this.buildTools();
    this.heightGroup = heightGroup;
    this.heightLabel = heightLabel;
    this.statusEl = statusEl;
    this.panel = buildSettingsPanel(right, () => this.config, () => this.settingsChanged(), (layer, value) => this.clearIndex(layer, value));
    this.bindCanvas();
    this.root.addEventListener('keydown', (event) => this.onKey(event));
    this.resize = new ResizeObserver(() => this.resized());
    this.resize.observe(this.wrap);
    this.unsubscribe = host.store.onChange(() => { void this.refreshList(); });
    this.renderListHead();
    this.renderPalette();
    this.syncUi();
    void this.refreshList();
  }

  // ── What a test (or the gallery) may look at ──────────────────────────────────────────────────────────────────

  /** The open background's folder, or null when none is open. */
  get folder(): string | null { return this.folderPath; }
  /** The painted layers being edited, or null when no background is open. */
  get layers(): BackgroundLayers | null { return this.background; }
  /** The settings being edited. */
  get settings(): BackgroundSettings { return this.config; }
  /** Whether there is anything changed since the background was opened or saved. */
  get dirty(): boolean { return this.changed; }
  /** How the picture sits in the canvas: its zoom, the zoom that fits it, and where its top-left corner is (canvas pixels). */
  get view(): { scale: number; fit: number; x: number; y: number } {
    const { scale, fit, x, y } = this.viewState;
    return { scale, fit, x, y };
  }

  /** Where a picture pixel is on the screen (page coordinates). */
  clientOf(px: number, py: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = rect.width / Math.max(1, this.canvas.width);
    return { x: rect.left + (this.viewState.x + px * this.viewState.scale) * k, y: rect.top + (this.viewState.y + py * this.viewState.scale) * k };
  }

  /** Shows the whole picture, centred. */
  fitView(): void {
    const { width, height } = this.canvas;
    const fit = Math.max(0.01, Math.min(width, height) / BACKGROUND_SIZE * 0.98);
    this.viewState = { scale: fit, fit, x: (width - BACKGROUND_SIZE * fit) / 2, y: (height - BACKGROUND_SIZE * fit) / 2, moved: false };
    this.invalidate();
  }

  // ── Opening, saving, closing ─────────────────────────────────────────────────────────────────────────────────

  /** Opens a saved background for painting (null shows an empty editor). Nothing here asks about unsaved changes: that is the list's job. */
  async open(folder: string | null): Promise<void> {
    const count = ++this.openCount;
    this.cancelStroke();
    if (folder === null) { this.clear(); return; }
    this.say('Loading...');
    let loaded: Awaited<ReturnType<BackgroundStore['load']>>;
    try { loaded = await this.host.store.load(folder); } catch (error) {
      if (count === this.openCount) this.say(`Could not open it: ${messageOf(error)}`, true);
      return;
    }
    if (count !== this.openCount || this.disposed) return;
    if (!loaded) { this.clear(); this.say('That background is gone.', true); return; }
    this.folderPath = folder;
    this.background = loaded.layers;
    this.config = loaded.settings;
    this.histories = { terrain: new LayerHistory(loaded.layers.size), material: new LayerHistory(loaded.layers.size), height: new LayerHistory(loaded.layers.size), props: new LayerHistory(loaded.layers.size) };
    this.changed = false;
    this.slot = 0;
    this.brush = loaded.settings.props.length ? 1 : 0;
    this.terrainId = 'plains';
    this.message = null;
    this.shade({ x0: 0, y0: 0, x1: loaded.layers.size - 1, y1: loaded.layers.size - 1 });
    this.panel.render();
    this.fitView();
    this.renderPalette();
    this.syncUi();
    void this.refreshList();
  }

  /** Writes the layers, settings and thumbnail of the open background. */
  async save(): Promise<void> {
    if (!this.folderPath || !this.background) return;
    this.say('Saving...');
    const edits = this.edits;
    try {
      await this.host.store.save(this.folderPath, this.config, this.background);
      // Whatever was painted while it was being written is still unsaved.
      if (edits === this.edits) { this.changed = false; this.message = { text: 'Saved.', error: false }; } else this.message = null;
    } catch (error) {
      this.say(`Could not save: ${messageOf(error)}`, true);
    }
    this.syncUi();
  }

  /** Takes the editor away. */
  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.resize.disconnect();
    cancelAnimationFrame(this.frame);
    this.root.remove();
  }

  private clear(): void {
    this.folderPath = null;
    this.background = null;
    this.histories = null;
    this.config = readBackgroundSettings(undefined);
    this.changed = false;
    this.paintCtx.clearRect(0, 0, BACKGROUND_SIZE, BACKGROUND_SIZE);
    this.panel.render();
    this.renderPalette();
    this.fitView();
    this.syncUi();
    void this.refreshList();
  }

  /** Runs `action` now, or after the user has answered the unsaved-changes bar. */
  private guard(action: () => Promise<void>): void {
    if (!this.changed) { void action(); return; }
    this.abandonLeave();
    this.pending = action;
    this.renderUnsaved();
  }

  // ── Building the pieces ──────────────────────────────────────────────────────────────────────────────────────

  private el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
    const made = this.doc.createElement(tag);
    if (cls) made.className = cls;
    if (text !== undefined) made.textContent = text;
    parent.appendChild(made);
    return made;
  }

  private button(parent: HTMLElement, text: string, data: Record<string, string>, onClick: () => void, cls = ''): HTMLButtonElement {
    const made = this.el(parent, 'button', cls, text);
    made.type = 'button';
    for (const [key, value] of Object.entries(data)) made.dataset[key] = value;
    made.addEventListener('click', onClick);
    return made;
  }

  private buildTools(): { heightGroup: HTMLElement; heightLabel: HTMLElement; statusEl: HTMLElement } {
    const row = this.toolsEl;
    const layers = this.el(row, 'div', 'atlas-tabletop-bg-group');
    for (const { id, label } of LAYERS) this.button(layers, label, { bgLayer: id }, () => this.setLayer(id));
    const tools = this.el(row, 'div', 'atlas-tabletop-bg-group');
    for (const { id, label } of TOOLS) this.button(tools, label, { bgTool: id }, () => { this.tool = id; this.syncUi(); });
    const size = this.el(row, 'label', 'atlas-tabletop-bg-slider');
    this.el(size, 'span', undefined, 'Brush size');
    const brush = this.el(size, 'input');
    brush.type = 'range';
    brush.min = '1';
    brush.max = '150';
    brush.value = String(this.radius);
    brush.dataset.bgBrush = '';
    brush.addEventListener('input', () => { this.radius = clamp(Number(brush.value) || 1, 1, 150); this.invalidate(); });
    const heightGroup = this.el(row, 'div', 'atlas-tabletop-bg-group atlas-tabletop-bg-heightgroup');
    const height = this.el(heightGroup, 'label', 'atlas-tabletop-bg-slider');
    const heightLabel = this.el(height, 'span');
    const heightInput = this.el(height, 'input');
    heightInput.type = 'range';
    heightInput.min = '0';
    heightInput.max = '255';
    heightInput.value = String(this.heightValue);
    heightInput.dataset.bgHeightValue = '';
    heightInput.addEventListener('input', () => { this.heightValue = clamp(Number(heightInput.value) || 0, 0, 255); this.syncUi(); });
    const soft = this.el(heightGroup, 'label', 'atlas-tabletop-bg-check');
    const box = this.el(soft, 'input');
    box.type = 'checkbox';
    box.checked = this.soft;
    box.addEventListener('change', () => { this.soft = box.checked; });
    this.el(soft, 'span', undefined, 'Soft');
    const file = this.el(row, 'input');
    file.type = 'file';
    file.accept = 'image/*';
    file.hidden = true;
    file.addEventListener('change', () => {
      const picked = file.files?.[0];
      file.value = '';
      if (picked) void this.importHeightmap(picked);
    });
    this.button(row, 'Import heightmap', { bgAction: 'import' }, () => file.click());
    this.button(row, 'Undo', { bgAction: 'undo' }, () => this.step(false));
    this.button(row, 'Redo', { bgAction: 'redo' }, () => this.step(true));
    this.button(row, 'Save', { bgAction: 'save' }, () => { void this.save(); }, 'mod-cta');
    const statusEl = this.el(row, 'span', 'atlas-tabletop-bg-status');
    return { heightGroup, heightLabel, statusEl };
  }

  private say(text: string, error = false): void {
    this.message = { text, error };
    this.syncUi();
  }

  /** Brings every button, label and mark in line with the state. */
  private syncUi(): void {
    const open = !!this.background;
    for (const b of this.toolsEl.querySelectorAll<HTMLButtonElement>('[data-bg-layer]')) { b.classList.toggle('is-active', b.dataset.bgLayer === this.layer); b.disabled = !open; }
    for (const b of this.toolsEl.querySelectorAll<HTMLButtonElement>('[data-bg-tool]')) { b.classList.toggle('is-active', b.dataset.bgTool === this.tool); b.disabled = !open; }
    const history = this.histories?.[this.layer];
    const undo = this.toolsEl.querySelector<HTMLButtonElement>('[data-bg-action="undo"]');
    const redo = this.toolsEl.querySelector<HTMLButtonElement>('[data-bg-action="redo"]');
    const importButton = this.toolsEl.querySelector<HTMLButtonElement>('[data-bg-action="import"]');
    const save = this.toolsEl.querySelector<HTMLButtonElement>('[data-bg-action="save"]');
    if (undo) undo.disabled = !history?.canUndo || !!this.stroke;
    if (redo) redo.disabled = !history?.canRedo || !!this.stroke;
    if (importButton) importButton.disabled = !open;
    if (save) save.disabled = !open || !this.changed;
    this.heightGroup.hidden = this.layer !== 'height';
    const { low, high } = this.config.height;
    const squares = low + (this.heightValue / 255) * (high - low);
    this.heightLabel.textContent = `Height ${this.heightValue} (${squares.toFixed(1)} sq)`;
    this.statusEl.textContent = this.message?.text ?? (open ? (this.changed ? 'Unsaved changes' : '') : 'Pick or create a background.');
    this.statusEl.classList.toggle('is-error', !!this.message?.error);
    this.statusEl.classList.toggle('is-dirty', this.changed && !this.message);
    this.renderListHead();
    this.invalidate();
  }

  private setLayer(layer: LayerName): void {
    if (this.stroke || !this.background) return;
    this.layer = layer;
    this.shade({ x0: 0, y0: 0, x1: this.background.size - 1, y1: this.background.size - 1 });
    this.renderPalette();
    this.syncUi();
  }

  private settingsChanged(): void {
    this.markDirty();
    const custom = /^custom(\d)$/.exec(this.terrainId);
    if (custom && Number(custom[1]) > this.config.patterns.length) this.terrainId = 'plains';
    this.renderPalette();
    this.syncUi();
  }

  /** Sets every pixel of `layer` that holds `value` to 0 (plains / no brush), as one undo step of that layer. */
  private clearIndex(layer: 'terrain' | 'props', value: number): void {
    const layers = this.background;
    const history = this.histories?.[layer];
    if (!layers || !history || this.stroke) return;
    const data = layers[layer];
    history.begin(data);
    for (let i = 0; i < data.length; i++) if (data[i] === value) data[i] = 0;
    const box = history.commit(data);
    if (box) { this.shade(box); this.markDirty(); }
  }

  /** Brushes were added or removed: the picture shows what is painted with the ones that remain. */
  private brushesChanged(): void {
    this.markDirty();
    this.brush = clamp(this.brush, this.config.props.length ? 1 : 0, this.config.props.length);
    if (this.background) this.shade({ x0: 0, y0: 0, x1: this.background.size - 1, y1: this.background.size - 1 });
    this.renderPalette();
    this.syncUi();
  }

  private markDirty(): void {
    this.changed = true;
    this.edits++;
    this.message = null;
  }

  // ── The palette: terrain types, or the material slots ────────────────────────────────────────────────────────

  private renderPalette(): void {
    const box = this.paletteEl;
    box.textContent = '';
    box.classList.toggle('is-props', this.layer === 'props');
    if (!this.background) return;
    if (this.layer === 'terrain') {
      for (const t of TERRAINS) {
        const custom = /^custom(\d)$/.exec(t.id);
        const pattern = custom ? this.config.patterns[Number(custom[1]) - 1] : undefined;
        const chip = this.button(box, '', { bgTerrain: t.id }, () => { this.terrainId = t.id; this.renderPalette(); }, 'atlas-tabletop-bg-swatch');
        const dot = this.el(chip, 'span', 'atlas-tabletop-bg-swatch__dot');
        dot.style.background = t.color;
        this.el(chip, 'span', undefined, pattern?.name ?? t.label);
        chip.disabled = !!custom && !pattern;
        chip.classList.toggle('is-active', t.id === this.terrainId);
      }
    } else if (this.layer === 'material') {
      this.renderSlots(box);
    } else if (this.layer === 'props') {
      renderPropBrushPanel(box, {
        brushes: () => this.config.props,
        props: () => this.host.props(),
        selected: () => this.brush,
        select: (brush) => { this.brush = brush; this.renderPalette(); },
        clear: (brush) => this.clearIndex('props', brush),
        edited: () => { this.markDirty(); this.syncUi(); },
        restructured: () => this.brushesChanged(),
      });
    } else {
      this.el(box, 'p', 'atlas-tabletop-bg-hint', 'Paint with the height value above: lighter is higher, darker is lower. Soft makes the brush blend into what is there.');
    }
  }

  private renderSlots(box: HTMLElement): void {
    const library = this.host.materials();
    for (let slot = 0; slot <= MAX_MATERIALS; slot++) {
      const path = slot === 0 ? null : this.config.materials[slot - 1] ?? null;
      const name = slot === 0 ? 'Plain ground' : path ? library.find((m) => m.path === path)?.name ?? baseName(path) : 'Empty slot';
      const cell = this.el(box, 'div', 'atlas-tabletop-bg-slot');
      const chip = this.button(cell, '', { bgMaterial: String(slot) }, () => { this.slot = slot; this.renderPalette(); }, 'atlas-tabletop-bg-swatch');
      const dot = this.el(chip, 'span', 'atlas-tabletop-bg-swatch__dot');
      dot.style.background = MATERIAL_COLORS[slot];
      this.el(chip, 'span', undefined, name);
      chip.disabled = slot > 0 && !path;
      chip.classList.toggle('is-active', slot === this.slot);
      if (slot === 0) continue;
      // Only the next empty slot can be filled: the used ones stay in a row, so a painted number keeps its meaning.
      const pick = this.el(cell, 'select', 'atlas-tabletop-bg-slotpick');
      pick.dataset.bgSlot = String(slot);
      pick.disabled = slot - 1 > this.config.materials.length;
      this.el(pick, 'option', undefined, path ? 'Change material...' : 'Pick a material...').value = '';
      const known = new Set(library.map((m) => m.path));
      for (const m of [...library, ...(path && !known.has(path) ? [{ path, name: baseName(path), thumb: null }] : [])]) this.el(pick, 'option', undefined, m.name).value = m.path;
      pick.value = path ?? '';
      pick.addEventListener('change', () => {
        if (!pick.value) return;
        this.config.materials[slot - 1] = pick.value;
        this.slot = slot;
        this.settingsChanged();
      });
    }
  }

  // ── The list of saved backgrounds ────────────────────────────────────────────────────────────────────────────

  private renderListHead(): void {
    const head = this.listHead;
    head.textContent = '';
    const open = !!this.folderPath;
    if (this.deleting && this.folderPath) {
      this.el(head, 'span', 'atlas-tabletop-bg-ask', `Delete "${baseName(this.folderPath)}"?`);
      this.button(head, 'Delete', { bgAction: 'confirm-delete' }, () => { void this.remove(); }, 'mod-warning');
      this.button(head, 'Keep', { bgAction: 'cancel-delete' }, () => { this.deleting = false; this.renderListHead(); });
      return;
    }
    this.button(head, 'New', { bgAction: 'new' }, () => this.startNew());
    this.button(head, 'Duplicate', { bgAction: 'duplicate' }, () => this.duplicate()).disabled = !open;
    this.button(head, 'Rename', { bgAction: 'rename' }, () => { if (this.folderPath) { this.naming = { kind: 'rename', folder: this.folderPath }; void this.refreshList(); } }).disabled = !open;
    this.button(head, 'Delete', { bgAction: 'delete' }, () => { this.deleting = true; this.renderListHead(); }).disabled = !open;
  }

  private async refreshList(): Promise<void> {
    const count = ++this.listCount;
    let items: { folder: string; name: string; thumb: string }[];
    try { items = await this.host.store.list(); } catch (error) { this.say(`Could not list the backgrounds: ${messageOf(error)}`, true); return; }
    if (count !== this.listCount || this.disposed) return;
    const list = this.listEl;
    list.textContent = '';
    let focus: HTMLInputElement | null = null;
    if (this.naming?.kind === 'new') {
      const card = this.el(list, 'div', 'atlas-tabletop-bg-card is-naming');
      focus = this.nameInput(card, 'New background', (name) => this.create(name));
    }
    for (const item of items) {
      const card = this.el(list, 'div', 'atlas-tabletop-bg-card');
      card.dataset.folder = item.folder;
      card.classList.toggle('is-active', item.folder === this.folderPath);
      const thumb = this.el(card, 'img', 'atlas-tabletop-bg-card__thumb');
      thumb.alt = '';
      void this.host.thumbnail?.(item.thumb).then((url) => { if (url) thumb.src = url; }, () => undefined);
      if (this.naming?.kind === 'rename' && this.naming.folder === item.folder) {
        focus = this.nameInput(card, item.name, (name) => this.rename(item.folder, name));
      } else {
        this.el(card, 'span', 'atlas-tabletop-bg-card__name', item.name);
      }
      card.addEventListener('click', () => { if (item.folder !== this.folderPath) this.guard(() => this.open(item.folder)); });
    }
    if (!items.length && !this.naming) this.el(list, 'p', 'atlas-tabletop-bg-hint', 'No backgrounds yet. Press New.');
    focus?.focus();
    focus?.select();
  }

  /** A text box for a name: Enter keeps it, Escape drops it. */
  private nameInput(card: HTMLElement, initial: string, commit: (name: string) => Promise<void>): HTMLInputElement {
    const input = this.el(card, 'input', 'atlas-tabletop-bg-name-input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = initial;
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { this.naming = null; void this.refreshList(); return; }
      if (event.key !== 'Enter') return;
      const name = input.value.trim();
      this.naming = null;
      if (!name) { void this.refreshList(); return; }
      void commit(name).catch((error) => this.say(messageOf(error), true));
    });
    return input;
  }

  /** Starts naming a new background, as its New button does. */
  startNew(): void {
    this.naming = { kind: 'new' };
    void this.refreshList();
  }

  private async create(name: string): Promise<void> {
    const folder = await this.host.store.create(name);
    this.guard(() => this.open(folder));
  }

  private async rename(folder: string, name: string): Promise<void> {
    const target = await this.host.store.rename(folder, name);
    if (folder === this.folderPath) {
      this.folderPath = target;
      this.config.name = baseName(target);
    }
    await this.refreshList();
  }

  private duplicate(): void {
    const folder = this.folderPath;
    if (!folder) return;
    this.guard(async () => {
      try { await this.open(await this.host.store.duplicate(folder, `${baseName(folder)} copy`)); } catch (error) {
        this.say(`Could not duplicate it: ${messageOf(error)}`, true);
      }
    });
  }

  private async remove(): Promise<void> {
    const folder = this.folderPath;
    this.deleting = false;
    if (!folder) return;
    try {
      await this.host.store.remove(folder);
      await this.open(null);
    } catch (error) {
      this.say(`Could not delete it: ${messageOf(error)}`, true);
    }
  }

  /** Answers a waiting `requestLeave` with "stay". */
  private abandonLeave(): void {
    const cancel = this.leaveCancel;
    this.leaveCancel = null;
    cancel?.();
  }

  /**
   * For whoever is about to take the editor away (a tab change): resolves true at once when nothing is unsaved, otherwise
   * shows the Save / Discard / Cancel bar and resolves true after Save or Discard, false on Cancel (or a failed Save).
   */
  requestLeave(): Promise<boolean> {
    if (!this.changed) return Promise.resolve(true);
    this.abandonLeave();
    return new Promise<boolean>((resolve) => {
      this.leaveCancel = () => { this.pending = null; this.unsavedEl.hidden = true; resolve(false); };
      this.pending = async () => { this.leaveCancel = null; resolve(true); };
      this.renderUnsaved();
    });
  }

  private renderUnsaved(): void {
    const bar = this.unsavedEl;
    bar.textContent = '';
    bar.hidden = false;
    this.el(bar, 'span', undefined, `"${this.folderPath ? baseName(this.folderPath) : ''}" has unsaved changes.`);
    const done = (): (() => Promise<void>) | null => { const action = this.pending; this.pending = null; bar.hidden = true; return action; };
    this.button(bar, 'Save', { bgUnsaved: 'save' }, () => { const action = done(); void this.save().then(() => (this.changed ? this.abandonLeave() : action?.())); }, 'mod-cta');
    this.button(bar, 'Discard', { bgUnsaved: 'discard' }, () => { const action = done(); this.changed = false; void action?.(); });
    this.button(bar, 'Cancel', { bgUnsaved: 'cancel' }, () => { done(); this.abandonLeave(); });
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** Colours the pixels of `box` for the layer on show (the others faint) and puts them on the picture canvas. */
  private shade(box: PixelBox): void {
    const layers = this.background;
    if (!layers) return;
    const { size, terrain, material, height, props } = layers;
    const brushes = this.config.props.length;
    const out = this.pixels;
    const layer = this.layer;
    for (let j = box.y0; j <= box.y1; j++) {
      for (let i = box.x0; i <= box.x1; i++) {
        const k = j * size + i;
        const t = terrain[k] * 3, m = material[k] * 3;
        let r: number, g: number, b: number;
        if (layer === 'terrain') {
          r = TERRAIN_RGB[t]; g = TERRAIN_RGB[t + 1]; b = TERRAIN_RGB[t + 2];
          if (material[k]) { r = (r * 4 + MATERIAL_RGB[m]) / 5; g = (g * 4 + MATERIAL_RGB[m + 1]) / 5; b = (b * 4 + MATERIAL_RGB[m + 2]) / 5; }
        } else if (layer === 'material') {
          r = (TERRAIN_RGB[t] + MATERIAL_RGB[m] * 3) / 4; g = (TERRAIN_RGB[t + 1] + MATERIAL_RGB[m + 1] * 3) / 4; b = (TERRAIN_RGB[t + 2] + MATERIAL_RGB[m + 2] * 3) / 4;
        } else if (layer === 'props') {
          // A number above the brushes that exist is what a removed brush left: it shows as no brush.
          const p = props[k] <= brushes ? props[k] * 3 : 0;
          if (p) { r = (TERRAIN_RGB[t] + BRUSH_RGB[p] * 3) / 4; g = (TERRAIN_RGB[t + 1] + BRUSH_RGB[p + 1] * 3) / 4; b = (TERRAIN_RGB[t + 2] + BRUSH_RGB[p + 2] * 3) / 4; } else { r = TERRAIN_RGB[t] * 0.6; g = TERRAIN_RGB[t + 1] * 0.6; b = TERRAIN_RGB[t + 2] * 0.6; }
        } else {
          const h = height[k] * 3;
          r = (TERRAIN_RGB[t] + h) / 4; g = (TERRAIN_RGB[t + 1] + h) / 4; b = (TERRAIN_RGB[t + 2] + h) / 4;
        }
        out[k] = 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
      }
    }
    this.paintCtx.putImageData(this.image, 0, 0, box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1);
    this.invalidate();
  }

  private invalidate(): void {
    if (this.frame || this.disposed) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private resized(): void {
    const width = Math.max(1, Math.round(this.wrap.clientWidth));
    const height = Math.max(1, Math.round(this.wrap.clientHeight));
    if (width === this.canvas.width && height === this.canvas.height) return;
    const previous = this.viewState;
    const oldWidth = this.canvas.width, oldHeight = this.canvas.height;
    this.canvas.width = width;
    this.canvas.height = height;
    if (previous.moved) {
      this.viewState = { ...previous, x: previous.x + (width - oldWidth) / 2, y: previous.y + (height - oldHeight) / 2 };
      this.viewState.fit = Math.max(0.01, Math.min(width, height) / BACKGROUND_SIZE * 0.98);
      this.invalidate();
    } else {
      this.fitView();
    }
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    const { scale, x, y } = this.viewState;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#14110f';
    ctx.fillRect(0, 0, width, height);
    if (!this.background) {
      ctx.fillStyle = '#8a8580';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick a background from the list, or press New.', width / 2, height / 2);
      return;
    }
    ctx.setTransform(scale, 0, 0, scale, x, y);
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(this.paintCanvas, 0, 0);
    // The map's footprint, in the middle.
    const side = MAP_FOOTPRINT;
    const corner = (BACKGROUND_SIZE - side) / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(corner, corner, side, side);
    ctx.lineWidth = 4 / scale;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.strokeRect(corner, corner, side, side);
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.strokeRect(corner, corner, side, side);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${13 / scale}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Map', corner, corner - 3 / scale);
    // The brush.
    if (this.hover && this.tool !== 'fill') {
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, this.radius, 0, Math.PI * 2);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.stroke();
      ctx.lineWidth = 0.75 / scale;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ── Painting ─────────────────────────────────────────────────────────────────────────────────────────────────

  private toPixel(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / Math.max(1, rect.width);
    return { x: ((event.clientX - rect.left) * k - this.viewState.x) / this.viewState.scale, y: ((event.clientY - rect.top) * k - this.viewState.y) / this.viewState.scale };
  }

  /** The number the tools write on the layer on show, or null when it cannot be painted (a material slot with nothing in it). */
  private paintValue(): number | null {
    if (this.tool === 'eraser') return this.layer === 'height' ? 128 : 0;
    if (this.layer === 'height') return this.heightValue;
    if (this.layer === 'props') {
      if (this.brush < 1 || this.brush > this.config.props.length) { this.say('Add a brush and pick it first.', true); return null; }
      return this.brush;
    }
    if (this.layer === 'material') {
      if (this.slot > 0 && !this.config.materials[this.slot - 1]) { this.say('Pick a material for that slot first.', true); return null; }
      return this.slot;
    }
    return TERRAINS.find((t) => t.id === this.terrainId)?.index ?? 0;
  }

  private bindCanvas(): void {
    const canvas = this.canvas;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => this.onDown(event));
    canvas.addEventListener('pointermove', (event) => this.onMove(event));
    canvas.addEventListener('pointerup', (event) => this.onUp(event));
    canvas.addEventListener('pointercancel', (event) => this.onUp(event));
    canvas.addEventListener('pointerleave', () => { this.hover = null; this.invalidate(); });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
  }

  private onDown(event: PointerEvent): void {
    if (!this.background || !this.histories) return;
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.pan = { x: event.clientX, y: event.clientY, vx: this.viewState.x, vy: this.viewState.y };
      return;
    }
    if (event.button !== 0 || this.stroke || this.pan) return;
    const value = this.paintValue();
    if (value === null) return;
    const point = this.toPixel(event);
    const layer = this.background[this.layer];
    const history = this.histories[this.layer];
    this.canvas.setPointerCapture(event.pointerId);
    history.begin(layer);
    if (this.tool === 'fill') {
      const box = floodFill(layer, this.background.size, point.x, point.y, value);
      this.finish(history, layer, box);
      return;
    }
    this.stroke = { history, layer, last: point };
    this.shadeBox(paintStroke(layer, this.background.size, point, point, this.radius, value, this.softNow()));
    this.syncUi();
  }

  private softNow(): boolean {
    return this.layer === 'height' && this.soft;
  }

  private onMove(event: PointerEvent): void {
    const point = this.toPixel(event);
    this.hover = point;
    if (this.pan) {
      const rect = this.canvas.getBoundingClientRect();
      const k = this.canvas.width / Math.max(1, rect.width);
      this.viewState.x = this.pan.vx + (event.clientX - this.pan.x) * k;
      this.viewState.y = this.pan.vy + (event.clientY - this.pan.y) * k;
      this.viewState.moved = true;
    } else if (this.stroke && this.background) {
      const value = this.paintValue();
      if (value !== null) this.shadeBox(paintStroke(this.stroke.layer, this.background.size, this.stroke.last, point, this.radius, value, this.softNow(), true));
      this.stroke.last = point;
    }
    this.invalidate();
  }

  private onUp(event: PointerEvent): void {
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (this.pan && (event.button === 2 || event.button === 1 || event.type === 'pointercancel')) { this.pan = null; return; }
    const stroke = this.stroke;
    if (!stroke) return;
    this.stroke = null;
    this.finish(stroke.history, stroke.layer, null);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (!this.background) return;
    const rect = this.canvas.getBoundingClientRect();
    const k = this.canvas.width / Math.max(1, rect.width);
    const sx = (event.clientX - rect.left) * k, sy = (event.clientY - rect.top) * k;
    const v = this.viewState;
    const next = clamp(v.scale * Math.exp(-event.deltaY * 0.0015), v.fit * 0.5, MAX_ZOOM);
    v.x = sx - (sx - v.x) * (next / v.scale);
    v.y = sy - (sy - v.y) * (next / v.scale);
    v.scale = next;
    v.moved = true;
    this.invalidate();
  }

  /** Ends a stroke or a fill: it becomes one undo step when it changed anything. */
  private finish(history: LayerHistory, layer: Uint8Array, filled: PixelBox | null): void {
    const box = history.commit(layer);
    if (box) { this.shadeBox(box); this.markDirty(); } else if (filled) this.shadeBox(filled);
    this.syncUi();
  }

  private shadeBox(box: PixelBox | null): void {
    if (box) this.shade(box);
  }

  private cancelStroke(): void {
    if (this.stroke) { this.stroke.history.cancel(); this.stroke = null; }
    this.pan = null;
  }

  private step(redo: boolean): void {
    if (!this.background || !this.histories || this.stroke) return;
    const history = this.histories[this.layer];
    const layer = this.background[this.layer];
    const box = redo ? history.redo(layer) : history.undo(layer);
    if (box) { this.shade(box); this.markDirty(); }
    this.syncUi();
  }

  private onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    // A field being typed in or chosen from has its own undo and keys: the editor's shortcuts stay out of it.
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === 'z') { event.preventDefault(); this.step(event.shiftKey); } else if (key === 'y') { event.preventDefault(); this.step(true); } else if (key === 's') { event.preventDefault(); void this.save(); }
  }

  /** Reads a picture as the height layer: grey is the average of red, green and blue, the picture stretched to the layer. One undo step. */
  private async importHeightmap(file: File): Promise<void> {
    const layers = this.background;
    const histories = this.histories;
    if (!layers || !histories || this.stroke) return;
    let grey: Uint8Array;
    try {
      const bitmap = await createImageBitmap(file, { colorSpaceConversion: 'none' });
      const canvas = this.doc.createElement('canvas');
      canvas.width = layers.size;
      canvas.height = layers.size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('No canvas');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bitmap, 0, 0, layers.size, layers.size);
      bitmap.close();
      const data = ctx.getImageData(0, 0, layers.size, layers.size).data;
      grey = new Uint8Array(layers.size * layers.size);
      for (let i = 0; i < grey.length; i++) grey[i] = Math.round((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3);
    } catch (error) {
      this.say(`Could not read that picture: ${messageOf(error)}`, true);
      return;
    }
    if (layers !== this.background || this.stroke) return;
    histories.height.begin(layers.height);
    layers.height.set(grey);
    const box = histories.height.commit(layers.height);
    this.layer = 'height';
    this.shade({ x0: 0, y0: 0, x1: layers.size - 1, y1: layers.size - 1 });
    if (box) this.markDirty();
    this.renderPalette();
    this.say(box ? 'Heightmap imported. Undo takes it back.' : 'That heightmap matches the heights already there.');
  }
}
