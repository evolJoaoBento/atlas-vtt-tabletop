/**
 * The gallery (a view of its own, opened by the "Open minis gallery" command) with three tabs, Minis, Props and
 * Materials, and the picker "Assign mini…" opens from a token's menu on the 3D board. Minis and props show a library's
 * GLBs as cards with a drawn thumbnail, and import more: by the Import button or by dropping .glb files (or HeroForge and TaleSpire exports) on them.
 * Clicking a prop puts it on the 3D board last used. Materials show their colour map, import Poly Haven's zips (or
 * its maps, or a folder of them), and are dragged onto a wall or door of a 3D board to paint it.
 */
import { ItemView, Menu, Modal, Notice, setIcon, type App, type TFile, type TFolder, type WorkspaceLeaf } from 'obsidian';
import type { MiniBase } from './assignments';
import type { MiniLibrary } from './library';
import { MiniPreview } from './miniPreview';
import { MINI_DRAG_TYPE, MINI_TEXT_PREFIX } from './assignments';
import { MATERIAL_DRAG_TYPE, MATERIAL_TEXT_PREFIX, type MaterialLibrary } from './materials';
import { DEFAULT_TUNING, MAX_DEPTH, MAX_DISPLACE, MAX_OCCLUSION, MAX_RELIEF, MAX_TEXTURE_SCALE, MIN_TEXTURE_SCALE, tuningOf, type MaterialSettings, type MaterialTuning } from './materialMaps';
import { MaterialPreview } from './materialPreview';

export const GALLERY_VIEW_TYPE = 'atlas-tabletop-gallery';

/** Imports `files` and tells the user how it went. */
export async function importWithNotice(library: MiniLibrary, files: readonly File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const { added, failed } = await library.import(files);
  const { one, many } = library.kind;
  if (added.length > 0) new Notice(`Tabletop: imported ${added.length} ${added.length === 1 ? one : many} into ${library.folderPath}.`);
  for (const { name, reason } of failed) new Notice(`Tabletop: could not import ${name}: ${reason}`, 8000);
  return added;
}

/** Asks for .glb files (or HeroForge Unity3D exports, or zips of them) with the system's file picker. */
export function pickFiles(doc: Document): Promise<File[]> {
  return new Promise((resolve) => {
    const input = doc.win.createEl('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary,.unity3d,.tsmod,.zip';
    input.multiple = true;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}

/** Lets `zone` take dropped .glb, .unity3d, .tsMod and .zip files. */
function acceptDrops(zone: HTMLElement, library: MiniLibrary): void {
  const has = (event: DragEvent): boolean => Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file');
  zone.addEventListener('dragover', (event) => {
    if (!has(event)) return;
    event.preventDefault();
    zone.addClass('is-dropping');
  });
  zone.addEventListener('dragleave', () => zone.removeClass('is-dropping'));
  zone.addEventListener('drop', (event) => {
    zone.removeClass('is-dropping');
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void importWithNotice(library, files);
  });
}

interface GridOptions {
  filter: string;
  selected?: string | null;
  onPick?(file: TFile): void;
  onMenu?(file: TFile, event: MouseEvent): void;
  /** Cards that can be dragged out, onto a token on the 3D board. */
  draggable?: boolean;
}

/** Draws the cards of a library's GLBs into `grid`. */
function drawGrid(grid: HTMLElement, library: MiniLibrary, options: GridOptions): void {
  grid.empty();
  const needle = options.filter.trim().toLowerCase();
  const files = library.list().filter((file) => needle === '' || file.basename.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle));
  if (files.length === 0) {
    grid.createDiv({
      cls: 'atlas-tabletop-empty',
      text: library.list().length === 0 ? `No ${library.kind.many} yet. Import .glb, HeroForge .unity3d or TaleSpire .tsMod files, or drop them here or in ${library.folderPath}.` : `No ${library.kind.one} matches.`,
    });
    return;
  }
  for (const file of files) {
    const card = grid.createDiv({ cls: 'atlas-tabletop-card', attr: { title: file.path, tabindex: '0', role: 'button' } });
    if (options.selected === file.path) card.addClass('is-selected');
    const thumb = card.createDiv({ cls: 'atlas-tabletop-thumb is-loading' });
    card.createDiv({ cls: 'atlas-tabletop-name', text: file.basename });
    void library.thumbnail(file.path).then((url) => {
      thumb.removeClass('is-loading');
      if (url) {
        thumb.createEl('img', { attr: { src: url, alt: file.basename, draggable: 'false' } });
        // A heavy GLB is drawn thinned: say so, so it can be re-exported lighter.
        void library.load(file.path).then((model) => {
          if (model.simplifiedFrom === null) return;
          const k = (n: number): string => `${Math.round(n / 1000)}k`;
          card.addClass('is-heavy');
          card.createDiv({ cls: 'atlas-tabletop-heavy', text: `${k(model.simplifiedFrom)} → ${k(model.triangles)} triangles` });
          card.setAttr('title', `${file.path}
This model has ${model.simplifiedFrom.toLocaleString()} triangles; Tabletop draws it thinned to ${model.triangles.toLocaleString()}. Export it lighter for the best look.`);
        }, () => undefined);
      }
      else {
        thumb.addClass('is-broken');
        setIcon(thumb, 'file-warning');
        void library.load(file.path).catch((error: unknown) => card.setAttr('title', `${file.path}\n${error instanceof Error ? error.message : String(error)}`));
      }
    });
    if (options.onPick) {
      const pick = (): void => options.onPick?.(file);
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); } });
    }
    if (options.onMenu) card.addEventListener('contextmenu', (event) => { event.preventDefault(); options.onMenu?.(file, event); });
    if (options.draggable) {
      card.draggable = true;
      card.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData(MINI_DRAG_TYPE, file.path);
        event.dataTransfer.setData('text/plain', MINI_TEXT_PREFIX + file.path);
        event.dataTransfer.effectAllowed = 'copy';
        const image = thumb.querySelector('img');
        if (image) event.dataTransfer.setDragImage(image, 24, 24);
      });
    }
  }
}

type GalleryTab = 'minis' | 'props' | 'materials';

/** Imports materials and tells the user how it went. */
async function importMaterials(library: MaterialLibrary, files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  const { added, failed } = await library.import(files);
  if (added.length > 0) new Notice(`Tabletop: imported ${added.length} ${added.length === 1 ? 'material' : 'materials'} into ${library.folderPath}.`);
  for (const { name, reason } of failed) new Notice(`Tabletop: could not import ${name}: ${reason}`, 8000);
}

/** Asks for material files (Poly Haven zips, or their maps), or with `folder` for a folder of maps. */
function pickMaterialFiles(doc: Document, folder: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = doc.win.createEl('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) input.webkitdirectory = true;
    else input.accept = '.zip,.jpg,.jpeg,.png,.webp';
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}

export class GalleryView extends ItemView {
  private tab: GalleryTab = 'minis';
  private filter = '';
  private body: HTMLElement | null = null;
  private stops: Array<() => void> = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly minis: MiniLibrary,
    private readonly props: MiniLibrary,
    private readonly materials: MaterialLibrary,
    private readonly placeProp: (glb: string) => void,
    /** A material clicked: the board used last paints walls with it on click. */
    private readonly paintWith: (material: string) => void = () => undefined,
  ) {
    super(leaf);
  }

  getViewType(): string { return GALLERY_VIEW_TYPE; }
  getDisplayText(): string { return 'Tabletop gallery'; }
  getIcon(): string { return 'box'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('atlas-tabletop-gallery');
    const tabs = root.createDiv({ cls: 'atlas-tabletop-tabs' });
    const names: Record<GalleryTab, string> = { minis: 'Minis', props: 'Props', materials: 'Materials' };
    const buttons = (['minis', 'props', 'materials'] as const).map((tab) => {
      const button = tabs.createEl('button', { cls: 'atlas-tabletop-tab', text: names[tab] });
      button.addEventListener('click', () => { this.tab = tab; this.filter = ''; this.draw(); sync(); });
      return { tab, button };
    });
    const sync = (): void => { for (const { tab, button } of buttons) button.toggleClass('is-active', tab === this.tab); };
    sync();
    this.body = root.createDiv({ cls: 'atlas-tabletop-gallery-body' });
    this.stops.push(this.minis.onChange(() => { if (this.tab === 'minis') this.redraw(); }));
    this.stops.push(this.props.onChange(() => { if (this.tab === 'props') this.redraw(); }));
    this.stops.push(this.materials.onChange(() => { if (this.tab === 'materials') this.redraw(); }));
    this.draw();
  }

  async onClose(): Promise<void> {
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  private get library(): MiniLibrary {
    return this.tab === 'minis' ? this.minis : this.props;
  }

  private grid: HTMLElement | null = null;

  /** Builds the open tab: its search, its import button, its hint and its cards. */
  private draw(): void {
    const body = this.body;
    if (!body) return;
    body.empty();
    if (this.tab === 'materials') { this.drawMaterials(body); return; }
    const library = this.library;
    const bar = body.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: `Search ${library.kind.many}…`, cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; this.redraw(); });
    const button = bar.createEl('button', { cls: 'mod-cta', text: 'Import GLB' });
    button.addEventListener('click', () => { void pickFiles(body.ownerDocument).then((files) => importWithNotice(library, files)); });
    const hint = this.tab === 'minis'
      ? `Drop .glb files (or a HeroForge or TaleSpire export) here. Minis live in ${library.folderPath}. On a 3D board, right-click a token and choose "Assign mini…".`
      : `Drop .glb files (or a HeroForge or TaleSpire export) here. Props live in ${library.folderPath}. Click a prop, then click the 3D board to put it there; Ctrl + drag moves it.`;
    body.createDiv({ cls: 'atlas-tabletop-hint', text: hint });
    this.grid = body.createDiv({ cls: 'atlas-tabletop-grid' });
    acceptDrops(body, library);
    this.redraw();
  }

  /** The Materials tab: Poly Haven's zips or maps imported, and cards to drag onto a wall. */
  private drawMaterials(body: HTMLElement): void {
    const library = this.materials;
    const bar = body.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: 'Search materials…', cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; this.redraw(); });
    const doc = body.ownerDocument;
    bar.createEl('button', { cls: 'mod-cta', text: 'Import zip or maps' }).addEventListener('click', () => { void pickMaterialFiles(doc, false).then((files) => importMaterials(library, files)); });
    bar.createEl('button', { text: 'Import folder' }).addEventListener('click', () => { void pickMaterialFiles(doc, true).then((files) => importMaterials(library, files)); });
    body.createDiv({
      cls: 'atlas-tabletop-hint',
      text: `Import a texture set as Poly Haven gives it (the zip, or its colour, normal, roughness and AO maps). Materials live in ${library.folderPath}. Drag one onto a wall or door of a 3D board to paint that segment, or click it and then click walls on the board (Esc stops); hold Shift to paint the whole wall.`,
    });
    this.grid = body.createDiv({ cls: 'atlas-tabletop-grid' });
    body.addEventListener('dragover', (event) => {
      if (!Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')) return;
      event.preventDefault();
      body.addClass('is-dropping');
    });
    body.addEventListener('dragleave', () => body.removeClass('is-dropping'));
    body.addEventListener('drop', (event) => {
      body.removeClass('is-dropping');
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void importMaterials(library, files);
    });
    this.redraw();
  }

  private redrawMaterials(grid: HTMLElement): void {
    grid.empty();
    const library = this.materials;
    const needle = this.filter.trim().toLowerCase();
    const all = library.list();
    const folders = all.filter((folder) => needle === '' || folder.name.toLowerCase().includes(needle));
    if (folders.length === 0) {
      grid.createDiv({ cls: 'atlas-tabletop-empty', text: all.length === 0 ? `No materials yet. Import a Poly Haven zip, or drop one here.` : 'No material matches.' });
      return;
    }
    for (const folder of folders) {
      const card = grid.createDiv({ cls: 'atlas-tabletop-card atlas-tabletop-material', attr: { title: `${folder.path}\nDrag onto a wall or door, or click it and then click walls (Shift: the whole wall)`, draggable: 'true' } });
      const thumb = card.createDiv({ cls: 'atlas-tabletop-thumb' });
      const url = library.thumbnail(folder.path);
      if (url) thumb.createEl('img', { attr: { src: url, alt: folder.name, draggable: 'false' } });
      else setIcon(thumb, 'image-off');
      card.createDiv({ cls: 'atlas-tabletop-name', text: folder.name });
      card.addEventListener('dragstart', (event) => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData(MATERIAL_DRAG_TYPE, folder.path);
        event.dataTransfer.setData('text/plain', MATERIAL_TEXT_PREFIX + folder.path);
        event.dataTransfer.effectAllowed = 'copy';
        const image = thumb.querySelector('img');
        if (image) event.dataTransfer.setDragImage(image, 24, 24);
      });
      card.addEventListener('click', () => this.paintWith(folder.path));
      card.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.materialMenu(folder, event);
      });
    }
  }

  private materialMenu(folder: TFolder, event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('Edit material…').setIcon('pencil').onClick(() => { new MaterialModal(this.app, this.materials, folder).open(); }));
    menu.addItem((item) => item.setTitle('Reveal in navigation').setIcon('folder-open').onClick(() => {
      const explorer = this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as { revealInFolder?(file: TFolder): void } | undefined;
      explorer?.revealInFolder?.(folder);
    }));
    menu.addItem((item) => item.setTitle('Delete material').setIcon('trash').setWarning(true).onClick(() => {
      new ConfirmModal(this.app, `Delete ${folder.name}? Walls painted with it lose their paint. The folder goes to the trash.`, () => {
        void this.app.fileManager.trashFile(folder);
      }).open();
    }));
    menu.showAtMouseEvent(event);
  }

  private redraw(): void {
    if (!this.grid) return;
    if (this.tab === 'materials') { this.redrawMaterials(this.grid); return; }
    const library = this.library;
    drawGrid(this.grid, library, {
      filter: this.filter,
      ...(this.tab === 'minis' ? { draggable: true } : {}),
      ...(this.tab === 'props' ? { onPick: (file: TFile) => this.placeProp(file.path) } : {}),
      onMenu: (file, event) => {
        const menu = new Menu();
        if (this.tab === 'props') menu.addItem((item) => item.setTitle('Place on board').setIcon('map-pin').onClick(() => this.placeProp(file.path)));
        menu.addItem((item) => item.setTitle('Reveal in navigation').setIcon('folder-open').onClick(() => {
          const explorer = this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as { revealInFolder?(file: TFile): void } | undefined;
          explorer?.revealInFolder?.(file);
        }));
        const { one } = library.kind;
        const warning = this.tab === 'minis' ? 'Tokens using it lose their mini.' : 'Boards using it lose the prop.';
        menu.addItem((item) => item.setTitle(`Delete ${one}`).setIcon('trash').setWarning(true).onClick(() => {
          new ConfirmModal(this.app, `Delete ${file.name}? ${warning} The file goes to the trash.`, () => {
            void this.app.fileManager.trashFile(file);
          }).open();
        }));
        menu.showAtMouseEvent(event);
      },
    });
  }
}

/** Edits a material: how many grid squares one tile of its texture covers, shown on a preview of the tile. */
class MaterialModal extends Modal {
  private preview: MaterialPreview | null = null;

  constructor(app: App, private readonly library: MaterialLibrary, private readonly folder: TFolder) {
    super(app);
  }

  async onOpen(): Promise<void> {
    this.setTitle(`Edit ${this.folder.name}`);
    this.modalEl.addClass('atlas-tabletop-material-modal');
    const root = this.contentEl;
    const settings = await this.library.settings(this.folder.path);
    let scale = settings.scale;
    const tuning: MaterialTuning = tuningOf(settings);
    // A wall two squares tall and four long, drawn as the board draws it, lit from the side: the light follows the pointer.
    const canvas = root.createEl('canvas', { cls: 'atlas-tabletop-material-preview' });
    const flat = root.createDiv({ cls: 'atlas-tabletop-material-preview', attr: { hidden: '' } });
    const url = this.library.thumbnail(this.folder.path);
    if (url) flat.style.backgroundImage = `url("${url}")`;
    // What the material came with: relief and depth read differently without a normal or a height map.
    let what = { normal: true, height: true };
    const preview = new MaterialPreview(canvas);
    this.preview = preview;
    if (preview.ok) {
      try {
        const editing = await this.library.loadForEditing(this.folder.path);
        preview.show(editing.loaded, tuning, scale);
        what = { normal: editing.loaded.hasNormal, height: editing.loaded.hasHeight };
      } catch (error) {
        preview.ok = false;
        new Notice(`Tabletop: could not draw ${this.folder.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!preview.ok) {
      // No 3D preview: the texture flat, at the chosen scale (four squares wide, so a tile is a quarter of it per square).
      canvas.hidden = true;
      flat.hidden = false;
    }
    // Hovering moves the light; dragging turns the camera (right-drag or Shift-drag pans), the wheel zooms, a double click starts over.
    let drag: { x: number; y: number; pan: boolean } | null = null;
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('pointerdown', (event) => {
      drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.button === 1 || event.shiftKey };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (drag) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.pan) preview.pan(dx, dy); else preview.orbit(dx, dy);
        return;
      }
      const box = canvas.getBoundingClientRect();
      preview.lightAt((event.clientX - box.left) / Math.max(1, box.width), (event.clientY - box.top) / Math.max(1, box.height));
    });
    const release = (): void => { drag = null; };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      preview.zoom(event.deltaY > 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => preview.resetView());
    root.createDiv({ cls: 'atlas-tabletop-hint', text: 'Move the pointer over the wall to move the light (a light from the side shows the relief best). Drag to turn the view, right-drag or Shift-drag to move it, scroll to zoom, double-click to start over.' });

    const slider = (label: string, unit: string, hint: string, low: number, high: number, step: number, read: () => number, write: (value: number) => void, wide = high): { show: () => void } => {
      const row = root.createDiv({ cls: 'atlas-tabletop-slider' });
      row.createSpan({ text: label });
      const range = row.createEl('input', { type: 'range', attr: { min: String(low), max: String(wide), step: String(step) } });
      const number = row.createEl('input', { type: 'number', cls: 'atlas-tabletop-material-scale', attr: { min: String(low), max: String(high), step: String(step) } });
      row.createSpan({ cls: 'atlas-tabletop-slider-value', text: unit });
      root.createDiv({ cls: 'atlas-tabletop-hint', text: hint });
      const show = (): void => {
        range.value = String(Math.min(wide, read()));
        number.value = String(Math.round(read() * 100) / 100);
      };
      range.addEventListener('input', () => { write(Number(range.value)); show(); });
      number.addEventListener('change', () => {
        const value = Number(number.value);
        if (Number.isFinite(value)) write(Math.min(high, Math.max(low, value)));
        show();
      });
      show();
      return { show };
    };
    const controls = [
      slider('Texture scale', 'squares per tile', 'How many grid squares one tile of the texture covers on a wall or door. Bigger stretches it, smaller repeats it more.',
        MIN_TEXTURE_SCALE, MAX_TEXTURE_SCALE, 0.05, () => scale, (value) => {
          scale = value;
          preview.retile(scale);
          flat.style.backgroundSize = `${scale * 25}% ${scale * 50}%`;
        }, 8),
      slider('Relief', '× as made', what.normal ? 'How strongly the texture stands out: bumps, grooves and mortar lines. 0 is flat, 1 is as the texture was made; more makes it deeper.'
        : `This material has no normal map. Above 1, relief is worked out from its ${what.height ? 'height map' : 'colours (light is high, dark is low)'}; at 1 or less it stays flat.`,
        0, MAX_RELIEF, 0.05, () => tuning.relief, (value) => { tuning.relief = value; preview.tune(tuning); }),
      slider('Crevices', '× as made', 'How dark the creases and gaps are, from the texture\'s occlusion map (a material without one is not changed).',
        0, MAX_OCCLUSION, 0.05, () => tuning.occlusion, (value) => { tuning.occlusion = value; preview.tune(tuning); }),
      slider('Depth', '0 flat, 1 deep', what.height ? 'How deep the surface is: the texture shifts as the camera moves, so bricks stand proud of their mortar. Turn the view in the preview to see it. Costs some speed on big maps.'
        : 'Needs a height (displacement) map, like the _disp_ file Poly Haven gives; this material has none.',
        0, MAX_DEPTH, 0.05, () => tuning.depth, (value) => { tuning.depth = value; preview.tune(tuning); }),
      slider('Displacement', '0 none, 1 deep', what.height ? 'Pushes the wall itself in where the height map is low, so mortar lines and gaps really recede and the surface profile shows from the side. Walls with it are cut into many more triangles: heavy on maps with very many walls.'
        : 'Needs a height (displacement) map, like the _disp_ file Poly Haven gives; this material has none.',
        0, MAX_DISPLACE, 0.05, () => tuning.displace, (value) => { tuning.displace = value; preview.tune(tuning); }),
      slider('Outward', '0 sinks in, 1 stands out', what.height ? 'Which way Depth and Displacement go. At 0 the height-map white is the wall surface and the dark parts sink in; at 1 the dark parts are the surface and the high parts stand out of the wall (bricks proud of their mortar, studs). In between, a bit of both.'
        : 'Needs a height (displacement) map, like the _disp_ file Poly Haven gives; this material has none.',
        0, 1, 0.05, () => tuning.outward, (value) => { tuning.outward = value; preview.tune(tuning); }),
      slider('Shine', '0 matte, 1 glossy', 'Glossy light glints on the relief and picks it out. Matte stone or plaster wants none; wet rock or polished marble wants some.',
        0, 1, 0.05, () => tuning.shine, (value) => { tuning.shine = value; preview.tune(tuning); }),
    ];
    flat.style.backgroundSize = `${scale * 25}% ${scale * 50}%`;
    const buttons = root.createDiv({ cls: 'modal-button-container' });
    buttons.createEl('button', { text: 'Reset texture' }).addEventListener('click', () => {
      Object.assign(tuning, DEFAULT_TUNING);
      preview.tune(tuning);
      for (const control of controls) control.show();
    });
    buttons.createEl('button', { cls: 'mod-cta', text: 'Save' }).addEventListener('click', () => {
      const next: MaterialSettings = { scale };
      // What stays as made is not written.
      if (tuning.relief !== DEFAULT_TUNING.relief) next.relief = tuning.relief;
      if (tuning.occlusion !== DEFAULT_TUNING.occlusion) next.occlusion = tuning.occlusion;
      if (tuning.shine !== DEFAULT_TUNING.shine) next.shine = tuning.shine;
      if (tuning.depth !== DEFAULT_TUNING.depth) next.depth = tuning.depth;
      if (tuning.displace !== DEFAULT_TUNING.displace) next.displace = tuning.displace;
      if (tuning.outward !== DEFAULT_TUNING.outward) next.outward = tuning.outward;
      void this.library.saveSettings(this.folder.path, next).then(() => this.close(), (error: unknown) => new Notice(`Tabletop: could not save ${this.folder.name}: ${error instanceof Error ? error.message : String(error)}`));
    });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.preview?.dispose();
    this.preview = null;
    this.contentEl.empty();
  }
}

class ConfirmModal extends Modal {
  constructor(app: App, private readonly message: string, private readonly yes: () => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl('p', { text: this.message });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { text: 'Delete', cls: 'mod-warning' }).addEventListener('click', () => { this.close(); this.yes(); });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }
}

export interface PickResult {
  mini: string;
  scale: number;
  turn: number;
  /** The base under the mini; absent means none. */
  base?: MiniBase;
}

/** "Assign mini…": picks a mini for a token, with its size and turn. */
export class MiniPicker extends Modal {
  private filter = '';
  private selected: string | null;
  private scale: number;
  private turn: number;
  private base: MiniBase;
  private preview: MiniPreview | null = null;
  private previewed: string | null = null;
  private stop: (() => void) | null = null;

  constructor(
    app: App,
    private readonly library: MiniLibrary,
    private readonly tokenName: string,
    current: PickResult | null,
    private readonly done: (result: PickResult) => void,
    /** A picker for something else than a token's mini (a door's prop): its title and button, and no size or turn. */
    private readonly options: { title?: string; action?: string; fitted?: boolean } = {},
  ) {
    super(app);
    this.selected = current?.mini ?? null;
    this.scale = current?.scale ?? 1;
    this.turn = current?.turn ?? 0;
    this.base = current?.base ?? 'none';
  }

  onOpen(): void {
    this.modalEl.addClass('atlas-tabletop-picker');
    this.setTitle(this.options.title ?? `Mini for ${this.tokenName}`);
    const root = this.contentEl;
    const bar = root.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: `Search ${this.library.kind.many}…`, cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; redraw(); });
    const importButton = bar.createEl('button', { text: 'Import GLB' });
    importButton.addEventListener('click', () => {
      void (async () => {
        const added = await importWithNotice(this.library, await pickFiles(root.ownerDocument));
        if (added.length === 1) this.selected = added[0]!;
        redraw();
      })();
    });
    const grid = root.createDiv({ cls: 'atlas-tabletop-grid' });
    acceptDrops(root, this.library);

    // Below the cards: a square showing the mini on its token, and the controls that change it.
    const lower = root.createDiv({ cls: 'atlas-tabletop-picker-lower' });
    if (!this.options.fitted) {
      const frame = lower.createDiv({ cls: 'atlas-tabletop-preview' });
      const canvas = frame.createEl('canvas', { cls: 'atlas-tabletop-preview__canvas', attr: { 'aria-label': 'The mini on its token' } });
      this.preview = new MiniPreview(canvas);
      if (!this.preview.ok) { this.preview = null; frame.remove(); }
    }
    const controls = lower.createDiv({ cls: 'atlas-tabletop-picker-controls' });
    const slider = (label: string, min: number, max: number, stepBy: number, value: number, show: (v: number) => string, set: (v: number) => void): void => {
      const row = controls.createDiv({ cls: 'atlas-tabletop-slider' });
      row.createSpan({ text: label });
      const input = row.createEl('input', { type: 'range', attr: { min: String(min), max: String(max), step: String(stepBy) } });
      input.value = String(value);
      const out = row.createSpan({ cls: 'atlas-tabletop-slider-value', text: show(value) });
      input.addEventListener('input', () => { const v = Number(input.value); set(v); out.setText(show(v)); });
    };
    // A fitted prop takes its size and turn from what it fits.
    if (!this.options.fitted) {
      slider('Size', 0.3, 3, 0.05, this.scale, (v) => `${Math.round(v * 100)}%`, (v) => { this.scale = v; this.showPreview(); });
      slider('Turn', 0, 345, 15, this.turn, (v) => `${v}°`, (v) => { this.turn = v; this.showPreview(); });
      // A model with no base of its own (a TaleSpire creature) stands on one drawn under it.
      const baseRow = controls.createDiv({ cls: 'atlas-tabletop-slider' });
      baseRow.createSpan({ text: 'Base' });
      const choice = baseRow.createEl('select');
      for (const [value, text] of [['none', 'None'], ['round', 'Round'], ['square', 'Square']] as const) choice.createEl('option', { value, text });
      choice.value = this.base;
      choice.addEventListener('change', () => { this.base = choice.value as MiniBase; this.showPreview(); });
    }

    const buttons = root.createDiv({ cls: 'modal-button-container' });
    const place = buttons.createEl('button', { cls: 'mod-cta', text: this.options.action ?? 'Assign' });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    place.addEventListener('click', () => this.finish());

    const redraw = (): void => {
      place.disabled = this.selected === null;
      this.loadPreview();
      drawGrid(grid, this.library, {
        filter: this.filter,
        selected: this.selected,
        onPick: (file) => {
          if (this.selected === file.path) { this.finish(); return; }
          this.selected = file.path;
          redraw();
        },
      });
    };
    this.stop = this.library.onChange(redraw);
    redraw();
    search.focus();
  }

  /** The preview shows the chosen mini once its model is read (and nothing while none is chosen). */
  private loadPreview(): void {
    const preview = this.preview;
    const path = this.selected;
    if (!preview || path === this.previewed) return;
    this.previewed = path;
    if (!path) { preview.setMini(null); return; }
    void this.library.load(path).then(
      (model) => { if (this.preview === preview && this.selected === path) { preview.setMini(model); this.showPreview(); } },
      () => { if (this.preview === preview && this.selected === path) preview.setMini(null); },
    );
  }

  private showPreview(): void {
    this.preview?.set({ scale: this.scale, turn: this.turn, base: this.base });
  }

  private finish(): void {
    if (!this.selected) return;
    const result: PickResult = { mini: this.selected, scale: this.scale, turn: this.turn, ...(this.base !== 'none' ? { base: this.base } : {}) };
    this.close();
    this.done(result);
  }

  onClose(): void {
    this.stop?.();
    this.preview?.dispose();
    this.preview = null;
    this.contentEl.empty();
  }
}
