/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: the laser pointer, with Atlas's options for it
 * (its colour and size) beside it; the local player view (open or close it, and
 * freeze the players' camera while it is open), and the command button, which opens the board's settings in a panel
 * above it, as Atlas's opens its command palette. The panel has the fog of war's height. Plain HTML over the board;
 * keys typed in it stay out of the board's camera keys.
 */

import { LASER_COLORS, LASER_COLOR_HINT, LASER_SIZE_MAX, LASER_SIZE_MIN, type LaserSettings } from './laser';

export interface ToolbarActions {
  /** How tall the fog stands, in grid squares. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  playerViewOpen(): boolean;
  togglePlayerView(): void;
  /** Whether the players' camera is frozen; freezing it, or letting it follow again. */
  playerFrozen(): boolean;
  togglePlayerFreeze(): void;
  /** Whether the laser is on; turning it on or off; its colour and size, and changing them. */
  laserOn(): boolean;
  toggleLaser(): void;
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
}

/** Lucide's `command` icon (ISC), the glyph of Atlas's command palette button. */
const COMMAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

/** Lucide's `flashlight`, `chevron-down` and `check` icons (ISC): Atlas's laser pointer, its options' chevron, a chosen swatch. */
const LASER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/></svg>';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK_SVG = '<svg class="atlas-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
/** Atlas's slider thumb is a rem across: it stays within the track at either end. */
const THUMB_PX = 16;

/** Lucide's `presentation` and `snowflake` icons (ISC): Atlas's player view, and a frozen camera. */
const PLAYER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>';
const FREEZE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/></svg>';

/** A height typed in the panel: a number of squares from 0, or null when it is not one. */
export function readFogHeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export class BoardToolbar {
  private readonly row: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly playerButton: HTMLButtonElement;
  private readonly laserButton: HTMLButtonElement;
  private readonly laserMenuButton: HTMLButtonElement;
  private readonly laserPanel: HTMLElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly slider: HTMLElement;
  private readonly sliderRange: HTMLElement;
  private readonly sliderThumb: HTMLElement;
  private readonly sizeValue: HTMLElement;
  private readonly freezeButton: HTMLButtonElement;
  private readonly heightInput: HTMLInputElement;
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel.contains(target) && !this.button.contains(target)) this.close();
    if (!this.laserPanel.contains(target) && !this.laserMenuButton.contains(target)) this.closeLaser();
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

    // Atlas's own class names under a root of Tabletop's: its look is copied in styles.css, without needing its styles.
    this.row = el('div', 'atlas-tabletop-toolbar-row atlas-tabletop-atlas', container);
    const bar = el('div', 'atlas-tabletop-toolbar', this.row);
    bar.setAttribute('role', 'toolbar');
    const tool = (svg: string, onClick: () => void): HTMLButtonElement => {
      const made = el('button', 'atlas-tabletop-tool-button', bar);
      made.type = 'button';
      made.innerHTML = svg;
      made.addEventListener('click', onClick);
      return made;
    };
    // The laser and its options, as Atlas's tool group: the tool, and a chevron opening its options above it.
    const laserGroup = el('div', 'atlas-tool-group', bar);
    this.laserButton = el('button', 'atlas-tabletop-tool-button', laserGroup);
    this.laserButton.type = 'button';
    this.laserButton.innerHTML = LASER_SVG;
    this.laserButton.addEventListener('click', () => this.actions.toggleLaser());
    const menu = el('div', 'atlas-dropdown-menu', laserGroup);
    this.laserMenuButton = el('button', 'atlas-dropdown-trigger btn--toolbar', menu);
    this.laserMenuButton.type = 'button';
    this.laserMenuButton.innerHTML = CHEVRON_SVG;
    this.laserMenuButton.setAttribute('aria-label', 'Laser options');
    this.laserMenuButton.setAttribute('aria-expanded', 'false');
    this.laserMenuButton.title = 'Laser options';
    this.laserMenuButton.addEventListener('click', () => (this.laserPanel.hidden ? this.openLaser() : this.closeLaser()));

    // Atlas's laser options (`LaserPointerOptions`): the colour swatches with their hint, and the size slider.
    this.laserPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-laser-options', menu);
    this.laserPanel.hidden = true;
    const section = el('div', 'atlas-dropdown-section', this.laserPanel);
    const swatchGroup = el('div', 'atlas-dropdown-swatches', section);
    swatchGroup.setAttribute('role', 'group');
    swatchGroup.setAttribute('aria-label', 'Laser colour');
    el('span', 'atlas-dropdown-swatches__label', swatchGroup, 'Laser colour');
    const grid = el('div', 'atlas-swatch-grid', swatchGroup);
    for (const swatch of LASER_COLORS) {
      const button = el('button', 'atlas-swatch', grid);
      button.type = 'button';
      button.style.backgroundColor = swatch.value;
      button.setAttribute('aria-label', swatch.label);
      button.title = swatch.label;
      button.dataset.value = swatch.value;
      button.addEventListener('click', () => { this.actions.setLaser({ color: swatch.value }); this.showLaser(); });
      this.swatches.push(button);
    }
    el('span', 'atlas-dropdown-swatches__hint', swatchGroup, LASER_COLOR_HINT);
    const sliderRow = el('div', 'atlas-dropdown-slider-row', section);
    const head = el('div', 'atlas-dropdown-slider-row__head', sliderRow);
    el('span', 'atlas-dropdown-label', head, 'Laser size');
    this.sizeValue = el('span', 'atlas-dropdown-slider-row__value', head);
    this.slider = el('span', 'slider-root', sliderRow);
    const track = el('span', 'slider-track', this.slider);
    this.sliderRange = el('span', 'slider-range', track);
    const thumbPlace = el('span', 'atlas-tabletop-slider-thumb-place', this.slider);
    this.sliderThumb = el('span', 'slider-thumb', thumbPlace);
    this.sliderThumb.setAttribute('role', 'slider');
    this.sliderThumb.setAttribute('aria-label', 'Laser size');
    this.sliderThumb.setAttribute('aria-valuemin', String(LASER_SIZE_MIN));
    this.sliderThumb.setAttribute('aria-valuemax', String(LASER_SIZE_MAX));
    this.sliderThumb.tabIndex = 0;
    const setSize = (size: number): void => {
      const value = Math.round(Math.min(LASER_SIZE_MAX, Math.max(LASER_SIZE_MIN, size)));
      if (value === this.actions.laser().size) return;
      this.actions.setLaser({ size: value });
      this.showLaser();
    };
    const fromPointer = (event: PointerEvent): void => {
      const rect = this.slider.getBoundingClientRect();
      // The thumb's centre travels within the track, half a thumb in from each end.
      const share = (event.clientX - rect.left - THUMB_PX / 2) / Math.max(1, rect.width - THUMB_PX);
      setSize(LASER_SIZE_MIN + Math.min(1, Math.max(0, share)) * (LASER_SIZE_MAX - LASER_SIZE_MIN));
    };
    this.slider.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.slider.setPointerCapture?.(event.pointerId);
      this.sliderThumb.focus();
      fromPointer(event);
    });
    this.slider.addEventListener('pointermove', (event) => { if (this.slider.hasPointerCapture?.(event.pointerId)) fromPointer(event); });
    this.sliderThumb.addEventListener('keydown', (event) => {
      const size = this.actions.laser().size;
      const steps: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      if (event.key in steps) setSize(size + steps[event.key]!);
      else if (event.key === 'Home') setSize(LASER_SIZE_MIN);
      else if (event.key === 'End') setSize(LASER_SIZE_MAX);
      else return;
      event.preventDefault();
    });
    this.laserPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeLaser(); }
    });
    this.playerButton = tool(PLAYER_SVG, () => this.actions.togglePlayerView());
    this.freezeButton = tool(FREEZE_SVG, () => this.actions.togglePlayerFreeze());
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
    this.refresh();
  }

  /** Shows the player view's state: open or not, its camera frozen or not (the freeze button only while it is open). */
  refresh(): void {
    const laser = this.actions.laserOn();
    this.laserButton.classList.toggle('is-active', laser);
    this.laserButton.setAttribute('aria-pressed', String(laser));
    this.laserButton.setAttribute('aria-label', laser ? 'Turn the laser pointer off' : 'Laser pointer');
    this.laserButton.title = laser ? 'Turn the laser pointer off (Esc)' : 'Laser pointer';
    const open = this.actions.playerViewOpen();
    const frozen = open && this.actions.playerFrozen();
    const label = (button: HTMLButtonElement, text: string): void => {
      button.setAttribute('aria-label', text);
      button.title = text;
    };
    label(this.playerButton, open ? 'Close the player view' : 'Open the player view');
    this.playerButton.classList.toggle('is-active', open);
    this.playerButton.setAttribute('aria-pressed', String(open));
    this.freezeButton.hidden = !open;
    label(this.freezeButton, frozen ? "Let the players' camera follow yours" : "Freeze the players' camera here");
    this.freezeButton.classList.toggle('is-active', frozen);
    this.freezeButton.setAttribute('aria-pressed', String(frozen));
  }

  get isOpen(): boolean {
    return !this.panel.hidden || !this.laserPanel.hidden;
  }

  /** Shows the laser's options above the toolbar. */
  openLaser(): void {
    this.close();
    this.showLaser();
    this.laserPanel.hidden = false;
    this.laserMenuButton.classList.add('atlas-is-active');
    this.laserMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeLaser(): void {
    if (this.laserPanel.hidden) return;
    this.laserPanel.hidden = true;
    this.laserMenuButton.classList.remove('atlas-is-active');
    this.laserMenuButton.setAttribute('aria-expanded', 'false');
    if (this.panel.hidden) this.row.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
  }

  /** The options as the laser is set now: the chosen swatch ticked, the size. */
  private showLaser(): void {
    const { color, size } = this.actions.laser();
    for (const swatch of this.swatches) {
      const chosen = swatch.dataset.value?.toLowerCase() === color.toLowerCase();
      swatch.classList.toggle('atlas-swatch--active', chosen);
      swatch.setAttribute('aria-pressed', String(chosen));
      swatch.innerHTML = chosen ? CHECK_SVG : '';
    }
    const share = (size - LASER_SIZE_MIN) / (LASER_SIZE_MAX - LASER_SIZE_MIN);
    this.sliderRange.style.left = '0';
    this.sliderRange.style.right = `${(1 - share) * 100}%`;
    // As Radix places its thumb: along the track, kept inside it at both ends.
    (this.sliderThumb.parentElement as HTMLElement).style.left = `calc(${share * 100}% + ${THUMB_PX / 2 - share * THUMB_PX}px)`;
    this.sliderThumb.setAttribute('aria-valuenow', String(size));
    this.sizeValue.textContent = `${size}px`;
  }

  open(): void {
    this.closeLaser();
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
    if (this.laserPanel.hidden) this.row.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
  }

  dispose(): void {
    this.close();
    this.closeLaser();
    this.row.remove();
  }
}
