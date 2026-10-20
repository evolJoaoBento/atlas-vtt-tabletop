/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: for now its command button alone, which opens
 * the board's settings in a panel above it, as Atlas's opens its command palette. The panel has the fog of war's
 * height. Plain HTML over the board; keys typed in it stay out of the board's camera keys.
 */

export interface ToolbarActions {
  /** How tall the fog stands, in grid squares. */
  fogHeight(): number;
  setFogHeight(height: number): void;
}

/** Lucide's `command` icon (ISC), the glyph of Atlas's command palette button. */
const COMMAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

/** A height typed in the panel: a number of squares from 0, or null when it is not one. */
export function readFogHeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export class BoardToolbar {
  private readonly row: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly heightInput: HTMLInputElement;
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel.contains(target) && !this.button.contains(target)) this.close();
  };

  constructor(container: HTMLElement, private readonly actions: ToolbarActions) {
    const doc = container.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
      const made = doc.createElement(tag);
      made.className = className;
      if (text !== undefined) made.textContent = text;
      parent.appendChild(made);
      return made;
    };

    this.row = el('div', 'atlas-tabletop-toolbar-row', container);
    const bar = el('div', 'atlas-tabletop-toolbar', this.row);
    bar.setAttribute('role', 'toolbar');
    this.button = el('button', 'atlas-tabletop-tool-button', bar);
    this.button.type = 'button';
    this.button.innerHTML = COMMAND_SVG;
    this.button.setAttribute('aria-label', 'Board settings');
    this.button.title = 'Board settings';
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => (this.panel.hidden ? this.open() : this.close()));

    this.panel = el('div', 'atlas-tabletop-palette', this.row);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Board settings');
    el('div', 'atlas-tabletop-palette__title', this.panel, 'Board settings');
    const fog = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', fog, 'Fog of war');
    const field = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', field, 'Fog height');
    this.heightInput = el('input', 'atlas-tabletop-palette__input', field);
    this.heightInput.type = 'text';
    this.heightInput.inputMode = 'decimal';
    this.heightInput.setAttribute('aria-label', 'Fog height in squares');
    el('span', 'atlas-tabletop-palette__unit', field, 'squares');
    el('div', 'atlas-tabletop-palette__hint', fog, 'The fog painted in Atlas stands this many grid squares tall. 0 lays it flat on the map.');
    const apply = (): void => {
      const height = readFogHeight(this.heightInput.value);
      this.heightInput.toggleAttribute('aria-invalid', height === null);
      if (height !== null) this.actions.setFogHeight(height);
    };
    this.heightInput.addEventListener('change', apply);
    this.panel.addEventListener('keydown', (event) => {
      // Typing here must not move the camera.
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      else if (event.key === 'Escape') { event.preventDefault(); this.close(); }
    });
    // Presses on the bar and the panel are not the board's: no camera drag, no deselecting.
    for (const part of [bar, this.panel]) part.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    this.heightInput.value = String(this.actions.fogHeight());
    this.heightInput.removeAttribute('aria-invalid');
    this.panel.hidden = false;
    this.button.classList.add('is-active');
    this.button.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
    this.heightInput.focus();
    this.heightInput.select();
  }

  close(): void {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.button.classList.remove('is-active');
    this.button.setAttribute('aria-expanded', 'false');
    this.row.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
  }

  dispose(): void {
    this.close();
    this.row.remove();
  }
}
