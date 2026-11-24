/**
 * The Background menu's painted-background chooser: a button that reads like Atlas's select (a small picture of the current
 * pick, its name, the up/down chevron) and opens a scrollable grid of every saved background, a thumbnail and name each.
 * The grid floats over the board (not inside the menu, which scrolls and would clip it) and closes on its own: a pick,
 * Escape and a press outside close it and nothing else.
 */

/** A painted background the picker offers: its vault folder, its name and its thumbnail address (null: none saved). */
export interface PaintedChoice { folder: string; name: string; thumb?: string | null }

const CHEVRONS = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';
const CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const NONE_LABEL = 'Choose a background…';
const PLUS = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
/** The add tile's name. */
export const NEW_BACKGROUND_LABEL = 'Add background';

export class PaintedPicker {
  readonly trigger: HTMLButtonElement;
  private readonly thumb: HTMLElement;
  private readonly label: HTMLElement;
  private readonly popup: HTMLElement;
  private items: readonly PaintedChoice[] = [];
  private current = '';
  private openNow = false;
  private readonly outside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.popup.contains(target) && !this.trigger.contains(target)) this.close(false);
  };

  /**
   * `area` is the board's view the grid must stay inside, `host` the toolbar element it is mounted in (it carries Atlas's
   * styles and colours); `onPick` gets the chosen folder; `onAdd`, when given, is the last tile's: making a new background.
   */
  constructor(parent: HTMLElement, private readonly area: () => HTMLElement | null, private readonly host: HTMLElement, private readonly onPick: (folder: string) => void, private readonly beforeOpen: () => void = () => undefined, private readonly onAdd: (() => void) | null = null) {
    const doc = parent.ownerDocument;
    this.trigger = doc.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'atlas-tabletop-painted-trigger';
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.thumb = doc.createElement('span');
    this.thumb.className = 'atlas-tabletop-painted-trigger__thumb';
    this.label = doc.createElement('span');
    this.label.className = 'atlas-tabletop-painted-trigger__label';
    this.label.textContent = NONE_LABEL;
    const chevron = doc.createElement('span');
    chevron.className = 'atlas-tabletop-painted-trigger__chevron';
    chevron.innerHTML = CHEVRONS;
    this.trigger.append(this.thumb, this.label, chevron);
    parent.append(this.trigger);
    this.popup = doc.createElement('div');
    this.popup.className = 'atlas-dropdown-content atlas-vtt-plugin atlas-tabletop-painted-popup';
    this.popup.setAttribute('role', 'listbox');
    this.popup.setAttribute('aria-label', 'Painted backgrounds');
    this.popup.hidden = true;
    this.trigger.addEventListener('click', () => (this.openNow ? this.close() : this.open()));
    this.trigger.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); this.open(); }
    });
    this.popup.addEventListener('keydown', (event) => this.key(event));
  }

  /** The popup's element, for the toolbar's outside-press check (a press in it is not a press outside the menu). */
  get element(): HTMLElement { return this.popup; }

  get isOpen(): boolean { return this.openNow; }

  /** The list and the pick as they are now (a folder not in the list reads as no pick); redrawn live while the grid is open. */
  set(items: readonly PaintedChoice[], current: string): void {
    this.items = items;
    this.current = items.some((one) => one.folder === current) ? current : '';
    const chosen = items.find((one) => one.folder === this.current);
    this.label.textContent = chosen ? chosen.name : NONE_LABEL;
    this.trigger.classList.toggle('is-empty', !chosen);
    this.thumb.replaceChildren();
    this.thumb.classList.toggle('is-empty', !chosen?.thumb);
    if (chosen?.thumb) this.thumb.append(this.image(chosen.thumb));
    if (this.openNow) this.draw(this.focused());
  }

  open(): void {
    const area = this.area();
    if (!area || this.openNow) return;
    this.beforeOpen();
    this.openNow = true;
    if (this.popup.parentElement !== this.host) this.host.append(this.popup);
    this.popup.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.draw(null);
    this.place();
    this.options()[Math.max(0, this.items.findIndex((one) => one.folder === this.current))]?.focus();
    this.trigger.ownerDocument.addEventListener('pointerdown', this.outside, true);
  }

  close(refocus = true): void {
    if (!this.openNow) return;
    this.openNow = false;
    this.popup.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.ownerDocument.removeEventListener('pointerdown', this.outside, true);
    if (refocus) this.trigger.focus();
  }

  dispose(): void {
    this.close(false);
    this.popup.remove();
  }

  private image(src: string): HTMLImageElement {
    const img = this.trigger.ownerDocument.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    return img;
  }

  private options(): HTMLElement[] { return [...this.popup.querySelectorAll<HTMLElement>('[role="option"]')]; }

  private focused(): string | null { return (this.popup.ownerDocument.activeElement as HTMLElement | null)?.dataset?.folder ?? null; }

  private draw(keepFocus: string | null): void {
    const doc = this.popup.ownerDocument;
    this.popup.replaceChildren();
    for (const one of this.items) {
      const option = doc.createElement('button');
      option.type = 'button';
      option.className = 'atlas-tabletop-painted-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(one.folder === this.current));
      option.setAttribute('aria-label', one.name);
      option.dataset.folder = one.folder;
      option.tabIndex = -1;
      const pic = doc.createElement('span');
      pic.className = 'atlas-tabletop-painted-option__thumb';
      pic.classList.toggle('is-empty', !one.thumb);
      if (one.thumb) pic.append(this.image(one.thumb));
      const mark = doc.createElement('span');
      mark.className = 'atlas-tabletop-painted-option__check';
      mark.innerHTML = CHECK;
      pic.append(mark);
      const name = doc.createElement('span');
      name.className = 'atlas-tabletop-painted-option__name';
      name.textContent = one.name;
      option.append(pic, name);
      option.addEventListener('click', () => { this.close(); this.onPick(one.folder); });
      this.popup.append(option);
    }
    if (this.onAdd) {
      // The add tile: a dashed thumbnail with a plus, after the saved ones, reached by the keys as they are.
      const add = doc.createElement('button');
      add.type = 'button';
      add.className = 'atlas-tabletop-painted-option atlas-tabletop-painted-option--add';
      add.setAttribute('role', 'option');
      add.setAttribute('aria-selected', 'false');
      add.setAttribute('aria-label', NEW_BACKGROUND_LABEL);
      add.tabIndex = -1;
      const pic = doc.createElement('span');
      pic.className = 'atlas-tabletop-painted-option__thumb';
      pic.innerHTML = PLUS;
      const name = doc.createElement('span');
      name.className = 'atlas-tabletop-painted-option__name';
      name.textContent = NEW_BACKGROUND_LABEL;
      add.append(pic, name);
      const onAdd = this.onAdd;
      add.addEventListener('click', () => { this.close(false); onAdd(); });
      this.popup.append(add);
    }
    if (!this.items.length && !this.onAdd) {
      const empty = doc.createElement('p');
      empty.className = 'atlas-tabletop-painted-popup__empty';
      empty.textContent = 'No painted backgrounds yet.';
      this.popup.append(empty);
    }
    if (keepFocus) this.options().find((option) => option.dataset.folder === keepFocus)?.focus();
  }

  /** Above the trigger when there is room, else below; never past the board's sides or top. */
  private place(): void {
    const area = this.area();
    if (!area) return;
    // Vertically the board's view, sideways the toolbar's own width (the pane), and never past the window.
    const view = area.getBoundingClientRect();
    const across = this.host.getBoundingClientRect();
    const win = this.trigger.ownerDocument.defaultView;
    const bounds = {
      left: Math.max(across.left, view.left, 0),
      right: Math.min(across.right, view.right, win?.innerWidth ?? Infinity),
      top: Math.max(view.top, 0),
      bottom: Math.min(view.bottom, win?.innerHeight ?? Infinity),
    };
    const at = this.trigger.getBoundingClientRect();
    const popup = this.popup;
    popup.style.maxHeight = '';
    popup.style.left = '0px';
    popup.style.top = '0px';
    const gap = 6, edge = 8;
    popup.style.width = '';
    popup.style.width = `${Math.min(popup.offsetWidth, Math.max(120, bounds.right - bounds.left - 2 * edge))}px`;
    const width = popup.offsetWidth;
    const room = { above: at.top - bounds.top - edge - gap, below: bounds.bottom - at.bottom - edge - gap };
    const natural = Math.min(popup.scrollHeight, 296);
    const above = room.above >= Math.min(natural, 150) || room.above >= room.below;
    const height = Math.max(96, Math.min(natural, above ? room.above : room.below));
    popup.style.maxHeight = `${Math.floor(height)}px`;
    const shown = popup.offsetHeight;
    const top = above ? at.top - gap - shown : at.bottom + gap;
    const left = Math.min(Math.max(at.right - width, bounds.left + edge), bounds.right - edge - width);
    // Coordinates are the popup's own containing block's, whichever ancestor that is.
    const parent = popup.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    popup.style.left = `${Math.round(left - parent.left)}px`;
    popup.style.top = `${Math.round(Math.max(bounds.top + edge, top) - parent.top)}px`;
  }

  private key(event: KeyboardEvent): void {
    event.stopPropagation();
    const options = this.options();
    const at = options.indexOf(this.popup.ownerDocument.activeElement as HTMLElement);
    const columns = this.columns();
    const move = (to: number): void => {
      event.preventDefault();
      const next = options[Math.min(options.length - 1, Math.max(0, to))];
      next?.focus();
      next?.scrollIntoView({ block: 'nearest' });
    };
    switch (event.key) {
      case 'Escape': event.preventDefault(); this.close(); break;
      case 'ArrowRight': move(at + 1); break;
      case 'ArrowLeft': move(at - 1); break;
      case 'ArrowDown': move(at + columns); break;
      case 'ArrowUp': move(at - columns); break;
      case 'Home': move(0); break;
      case 'End': move(options.length - 1); break;
      case 'Enter': case ' ': event.preventDefault(); if (at >= 0) options[at]!.click(); break;
      case 'Tab': event.preventDefault(); this.close(); break;
    }
  }

  /** How many tiles lie in a row now (the first row's tiles share one top). */
  private columns(): number {
    const options = this.options();
    if (options.length === 0) return 1;
    const top = options[0]!.offsetTop;
    const n = options.findIndex((option) => option.offsetTop !== top);
    return n === -1 ? options.length : n;
  }
}
