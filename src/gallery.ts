/**
 * The minis gallery (a view of its own, opened by the "Open minis gallery" command) and the picker "Place mini…" opens
 * from a token's menu. Both show the GLBs in the minis folder as cards with a drawn thumbnail, and both import more:
 * by the Import button or by dropping .glb files on them.
 */
import { ItemView, Menu, Modal, Notice, setIcon, type App, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { MiniLibrary } from './library';

export const GALLERY_VIEW_TYPE = 'atlas-tabletop-gallery';

/** Imports `files` and tells the user how it went. */
export async function importWithNotice(library: MiniLibrary, files: readonly File[]): Promise<string[]> {
  if (files.length === 0) return [];
  const { added, failed } = await library.import(files);
  if (added.length > 0) new Notice(`Tabletop: imported ${added.length} mini${added.length === 1 ? '' : 's'} into ${library.folderPath}.`);
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

/** Draws the cards of the minis into `grid`. */
function drawGrid(grid: HTMLElement, library: MiniLibrary, options: GridOptions): void {
  grid.empty();
  const needle = options.filter.trim().toLowerCase();
  const files = library.list().filter((file) => needle === '' || file.basename.toLowerCase().includes(needle) || file.path.toLowerCase().includes(needle));
  if (files.length === 0) {
    grid.createDiv({
      cls: 'atlas-tabletop-empty',
      text: library.list().length === 0 ? `No minis yet. Import .glb files, or drop them here or in ${library.folderPath}.` : 'No mini matches.',
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
      if (url) thumb.createEl('img', { attr: { src: url, alt: file.basename, draggable: 'false' } });
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

export class GalleryView extends ItemView {
  private filter = '';
  private grid: HTMLElement | null = null;
  private stop: (() => void) | null = null;

  constructor(leaf: WorkspaceLeaf, private readonly library: MiniLibrary) {
    super(leaf);
  }

  getViewType(): string { return GALLERY_VIEW_TYPE; }
  getDisplayText(): string { return 'Minis gallery'; }
  getIcon(): string { return 'box'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('atlas-tabletop-gallery');
    const bar = root.createDiv({ cls: 'atlas-tabletop-bar' });
    const search = bar.createEl('input', { type: 'search', placeholder: 'Search minis…', cls: 'atlas-tabletop-search' });
    search.addEventListener('input', () => { this.filter = search.value; this.redraw(); });
    const button = bar.createEl('button', { cls: 'mod-cta', text: 'Import GLB' });
    button.addEventListener('click', async () => importWithNotice(this.library, await pickFiles(root.ownerDocument)));
    root.createDiv({ cls: 'atlas-tabletop-hint', text: `Drop .glb files here. Minis live in ${this.library.folderPath}. Right-click a token on a map and choose "Place mini…".` });
    this.grid = root.createDiv({ cls: 'atlas-tabletop-grid' });
    acceptDrops(root, this.library);
    this.stop = this.library.onChange(() => this.redraw());
    this.redraw();
  }

  async onClose(): Promise<void> {
    this.stop?.();
    this.stop = null;
  }

  private redraw(): void {
    if (!this.grid) return;
    drawGrid(this.grid, this.library, {
      filter: this.filter,
      onMenu: (file, event) => {
        const menu = new Menu();
        menu.addItem((item) => item.setTitle('Reveal in navigation').setIcon('folder-open').onClick(() => {
          const explorer = this.app.workspace.getLeavesOfType('file-explorer')[0]?.view as { revealInFolder?(file: TFile): void } | undefined;
          explorer?.revealInFolder?.(file);
        }));
        menu.addItem((item) => item.setTitle('Delete mini').setIcon('trash').setWarning(true).onClick(() => {
          new ConfirmModal(this.app, `Delete ${file.name}? Tokens using it lose their mini. The file goes to the trash.`, () => {
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

/** "Place mini…": picks a mini for a token, with its size and turn. */
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
    this.setTitle(`Place mini on ${this.tokenName}`);
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
    const place = buttons.createEl('button', { cls: 'mod-cta', text: 'Place' });
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
