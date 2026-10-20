/**
 * The gallery (a view of its own, opened by the "Open minis gallery" command) with two tabs, Minis and Props, and the
 * picker "Assign mini…" opens from a token's menu on the 3D board. They show a library's GLBs as cards with a drawn
 * thumbnail, and import more: by the Import button or by dropping .glb files on them. Clicking a prop puts it on the
 * 3D board last used.
 */
import { ItemView, Menu, Modal, Notice, setIcon, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { MiniLibrary } from './library';

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

/** Asks for .glb files with the system's file picker. */
export function pickFiles(doc: Document): Promise<File[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.glb,model/gltf-binary';
    input.multiple = true;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.click();
  });
}

/** Lets `zone` take dropped .glb files. */
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
}

/** Draws the cards of a library's GLBs into `grid`. */
function drawGrid(grid: HTMLElement, library: MiniLibrary, options: GridOptions): void {
  grid.empty();
  const needle = options.filter.trim().toLowerCase();
  const files = library.list().filter((file) => needle === '' || file.basename.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle));
  if (files.length === 0) {
    grid.createDiv({
      cls: 'atlas-tabletop-empty',
      text: library.list().length === 0 ? `No ${library.kind.many} yet. Import .glb files, or drop them here or in ${library.folderPath}.` : `No ${library.kind.one} matches.`,
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
  }
}

type GalleryTab = 'minis' | 'props';

export class GalleryView extends ItemView {
  private tab: GalleryTab = 'minis';
  private filter = '';
  private body: HTMLElement | null = null;
  private stops: Array<() => void> = [];

  constructor(leaf: WorkspaceLeaf, private readonly minis: MiniLibrary, private readonly props: MiniLibrary, private readonly placeProp: (glb: string) => void) {
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
    const buttons = (['minis', 'props'] as const).map((tab) => {
      const button = tabs.createEl('button', { cls: 'atlas-tabletop-tab', text: tab === 'minis' ? 'Minis' : 'Props' });
      button.addEventListener('click', () => { this.tab = tab; this.filter = ''; this.draw(); sync(); });
      return { tab, button };
    });
    const sync = (): void => { for (const { tab, button } of buttons) button.toggleClass('is-active', tab === this.tab); };
    sync();
    this.body = root.createDiv({ cls: 'atlas-tabletop-gallery-body' });
    this.stops.push(this.minis.onChange(() => { if (this.tab === 'minis') this.redraw(); }));
    this.stops.push(this.props.onChange(() => { if (this.tab === 'props') this.redraw(); }));
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
    const library = this.library;
    const bar = body.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: `Search ${library.kind.many}…`, cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; this.redraw(); });
    const button = bar.createEl('button', { cls: 'mod-cta', text: 'Import GLB' });
    button.addEventListener('click', async () => importWithNotice(library, await pickFiles(body.ownerDocument)));
    const hint = this.tab === 'minis'
      ? `Drop .glb files here. Minis live in ${library.folderPath}. On a 3D board, right-click a token and choose "Assign mini…".`
      : `Drop .glb files here. Props live in ${library.folderPath}. Click a prop, then click the 3D board to put it there; Ctrl + drag moves it.`;
    body.createDiv({ cls: 'atlas-tabletop-hint', text: hint });
    this.grid = body.createDiv({ cls: 'atlas-tabletop-grid' });
    acceptDrops(body, library);
    this.redraw();
  }

  private redraw(): void {
    if (!this.grid) return;
    const library = this.library;
    drawGrid(this.grid, library, {
      filter: this.filter,
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
}

/** "Assign mini…": picks a mini for a token, with its size and turn. */
export class MiniPicker extends Modal {
  private filter = '';
  private selected: string | null;
  private scale: number;
  private turn: number;
  private stop: (() => void) | null = null;

  constructor(
    app: App,
    private readonly library: MiniLibrary,
    private readonly tokenName: string,
    current: PickResult | null,
    private readonly done: (result: PickResult) => void,
  ) {
    super(app);
    this.selected = current?.mini ?? null;
    this.scale = current?.scale ?? 1;
    this.turn = current?.turn ?? 0;
  }

  onOpen(): void {
    this.modalEl.addClass('atlas-tabletop-picker');
    this.setTitle(`Mini for ${this.tokenName}`);
    const root = this.contentEl;
    const bar = root.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: 'Search minis…', cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; redraw(); });
    const importButton = bar.createEl('button', { text: 'Import GLB' });
    importButton.addEventListener('click', async () => {
      const added = await importWithNotice(this.library, await pickFiles(root.ownerDocument));
      if (added.length === 1) this.selected = added[0]!;
      redraw();
    });
    const grid = root.createDiv({ cls: 'atlas-tabletop-grid' });
    acceptDrops(root, this.library);

    const controls = root.createDiv({ cls: 'atlas-tabletop-controls' });
    const slider = (label: string, min: number, max: number, stepBy: number, value: number, show: (v: number) => string, set: (v: number) => void): void => {
      const row = controls.createDiv({ cls: 'atlas-tabletop-slider' });
      row.createSpan({ text: label });
      const input = row.createEl('input', { type: 'range', attr: { min: String(min), max: String(max), step: String(stepBy) } });
      input.value = String(value);
      const out = row.createSpan({ cls: 'atlas-tabletop-slider-value', text: show(value) });
      input.addEventListener('input', () => { const v = Number(input.value); set(v); out.setText(show(v)); });
    };
    slider('Size', 0.3, 3, 0.05, this.scale, (v) => `${Math.round(v * 100)}%`, (v) => { this.scale = v; });
    slider('Turn', 0, 345, 15, this.turn, (v) => `${v}°`, (v) => { this.turn = v; });

    const buttons = root.createDiv({ cls: 'modal-button-container' });
    const place = buttons.createEl('button', { cls: 'mod-cta', text: 'Assign' });
    buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    place.addEventListener('click', () => this.finish());

    const redraw = (): void => {
      place.disabled = this.selected === null;
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

  private finish(): void {
    if (!this.selected) return;
    const result = { mini: this.selected, scale: this.scale, turn: this.turn };
    this.close();
    this.done(result);
  }

  onClose(): void {
    this.stop?.();
    this.contentEl.empty();
  }
}
