/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: Atlas's Move/Select group (its button shows the
 * hand, or the flashlight while the laser pointer is on; its menu chooses between the two and holds the laser's
 * colour and size); the local player view (open or close it, and
 * freeze the players' camera while it is open), and the command button, which opens the board's settings in a panel
 * above it, as Atlas's opens its command palette. The panel has the fog of war's height. Plain HTML over the board;
 * keys typed in it stay out of the board's camera keys.
 */

import { LASER_COLORS, LASER_COLOR_HINT, LASER_SIZE_MAX, LASER_SIZE_MIN, type LaserSettings } from './laser';

export interface ToolbarActions {
  /** How tall the fog stands, in grid squares. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** How thick the walls stand, as a share of a grid square. */
  wallThickness(): number;
  setWallThickness(thickness: number): void;
  /** Whether Connect hosts a session: the Template tool shows then. */
  hosting(): boolean;
  templateOn(): boolean;
  templateShape(): string;
  /** Turns the Template tool on with a shape, or off with null. */
  selectTemplate(shape: string | null): void;
  playerViewOpen(): boolean;
  togglePlayerView(): void;
  /** Whether the players' camera is frozen; freezing it, or letting it follow again. */
  playerFrozen(): boolean;
  togglePlayerFreeze(): void;
  /** Whether the laser is on; choosing Move/Select or the laser pointer; the laser's colour and size, and changing them. */
  laserOn(): boolean;
  selectTool(tool: 'move' | 'laser'): void;
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** Whether the initiative tracker shows on the board; showing or hiding it. */
  initiativeOpen(): boolean;
  toggleInitiative(): void;
  /** The board's ambient light (0–1); a new level, shown while the slider moves and kept when it is let go. */
  ambient(): number;
  setAmbient(level: number, keep: boolean): void;
}

/** Lucide's `command` icon (ISC), the glyph of Atlas's command palette button. */
const COMMAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

/** Lucide's `flashlight`, `chevron-down` and `check` icons (ISC): Atlas's laser pointer, its options' chevron, a chosen swatch. */
const LASER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/></svg>';
/** Lucide's `hand` (ISC): Atlas's Move/Select. */
const HAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';
/** Atlas's Move/Select key, which also switches to the laser pointer and back. */
const MOVE_KEY = 'V';
const CHEVRON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1rem;height:1rem"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK_SVG = '<svg class="atlas-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
/** Atlas's slider thumb is a rem across: it stays within the track at either end. */
const THUMB_PX = 16;

/** Lucide's `presentation` and `snowflake` icons (ISC): Atlas's player view, and a frozen camera. */
const PLAYER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>';
/** Lucide's shapes: Connect's Template tool. */
const TEMPLATE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>';
const TEMPLATE_SHAPES = [['line', 'Line'], ['circle', 'Circle'], ['square', 'Square'], ['cone', 'Cone']] as const;
const FREEZE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/></svg>';

/** A height typed in the panel: a number of squares from 0, or null when it is not one. */
export function readFogHeight(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/** A wall thickness typed in the board settings, in squares: more than none, at most two squares. */
export function readWallThickness(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 2 ? value : null;
}

export class BoardToolbar {
  private readonly row: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly playerButton: HTMLButtonElement;
  /** Connect's Template tool, offered only while Connect hosts, and its shapes. */
  private readonly templateButton: HTMLButtonElement;
  private readonly templateShapes: HTMLElement;
  private readonly laserButton: HTMLButtonElement;
  private readonly moveItem: HTMLButtonElement;
  private readonly laserItem: HTMLButtonElement;
  private readonly laserMenuButton: HTMLButtonElement;
  private readonly laserPanel: HTMLElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly slider: HTMLElement;
  private readonly sliderRange: HTMLElement;
  private readonly sliderThumb: HTMLElement;
  private readonly sizeValue: HTMLElement;
  private readonly freezeButton: HTMLButtonElement;
  private readonly heightInput: HTMLInputElement;
  private readonly thicknessInput: HTMLInputElement;
  private readonly initiativeToggle: HTMLInputElement;
  private readonly ambientInput: HTMLInputElement;
  private readonly ambientValue: HTMLElement;
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
    const bar = el('div', 'atlas-vtt-toolbar atlas-tabletop-toolbar', this.row);
    bar.setAttribute('role', 'toolbar');
    // Atlas's ToolButton: a wrapper, a span, and the button itself (a toolbar icon button).
    const toolIn = (parent: HTMLElement, svg: string, onClick: () => void): HTMLButtonElement => {
      const wrapper = el('div', 'atlas-tool-button', parent);
      const span = el('span', '', wrapper);
      span.style.display = 'inline-flex';
      const made = el('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button', span);
      made.type = 'button';
      made.innerHTML = svg;
      made.addEventListener('click', onClick);
      return made;
    };
    const tool = (svg: string, onClick: () => void): HTMLButtonElement => toolIn(bar, svg, onClick);
    // Atlas's Move/Select group: its face is the tool in use (the hand, or the flashlight while the laser is on), and a
    // click on it keeps that tool; the chevron opens the group's menu above it.
    const laserGroup = el('div', 'atlas-tool-group', bar);
    this.laserButton = toolIn(laserGroup, HAND_SVG, () => this.actions.selectTool(this.actions.laserOn() ? 'laser' : 'move'));
    const menu = el('div', 'atlas-dropdown-menu', laserGroup);
    this.laserMenuButton = el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', menu);
    this.laserMenuButton.type = 'button';
    this.laserMenuButton.innerHTML = CHEVRON_SVG;
    this.laserMenuButton.setAttribute('aria-label', 'Move options');
    this.laserMenuButton.setAttribute('aria-expanded', 'false');
    this.laserMenuButton.title = 'Move options';
    this.laserMenuButton.addEventListener('click', () => (this.laserPanel.hidden ? this.openLaser() : this.closeLaser()));

    // Atlas's laser options (`LaserPointerOptions`): the colour swatches with their hint, and the size slider.
    this.laserPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-laser-options', menu);
    this.laserPanel.hidden = true;
    // Atlas's two tools of the group, as its menu items: a check on the one in use, its icon, its name and key.
    const tools = el('div', 'atlas-dropdown-section', this.laserPanel);
    const item = (svg: string, label: string, choose: () => void): HTMLButtonElement => {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', tools);
      made.type = 'button';
      el('span', 'atlas-dropdown-menu-item__check', made);
      made.insertAdjacentHTML('beforeend', svg);
      el('span', '', made, label);
      el('span', 'atlas-dropdown-menu-item__shortcut', made, MOVE_KEY);
      made.addEventListener('click', () => { choose(); this.closeLaser(); });
      return made;
    };
    this.moveItem = item(HAND_SVG, 'Move/Select', () => this.actions.selectTool('move'));
    this.laserItem = item(LASER_SVG, 'Laser Pointer', () => this.actions.selectTool('laser'));
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
    this.templateButton = tool(TEMPLATE_SVG, () => this.actions.selectTemplate(this.actions.templateOn() ? null : this.actions.templateShape()));
    this.templateButton.setAttribute('aria-label', 'Template');
    this.templateButton.title = 'Template (players see it)';
    this.templateShapes = el('div', 'atlas-tabletop-template-shapes', bar);
    for (const [shape, label] of TEMPLATE_SHAPES) {
      const choice = el('button', 'btn btn--ghost btn--sm atlas-tabletop-template-shape', this.templateShapes, label);
      choice.type = 'button';
      choice.dataset.shape = shape;
      choice.addEventListener('click', () => this.actions.selectTemplate(shape));
    }
    this.playerButton = tool(PLAYER_SVG, () => this.actions.togglePlayerView());
    this.freezeButton = tool(FREEZE_SVG, () => this.actions.togglePlayerFreeze());
    this.button = tool(COMMAND_SVG, () => (this.panel.hidden ? this.open() : this.close()));
    this.button.setAttribute('aria-label', 'Board settings');
    this.button.title = 'Board settings';
    this.button.setAttribute('aria-expanded', 'false');

    this.panel = el('div', 'atlas-tabletop-palette', this.row);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Board settings');
    el('div', 'atlas-tabletop-palette__title', this.panel, 'Board settings');
    const fog = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', fog, 'Walls and fog');
    const field = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', field, 'Default wall height');
    this.heightInput = el('input', 'atlas-tabletop-palette__input', field);
    this.heightInput.type = 'text';
    this.heightInput.inputMode = 'decimal';
    this.heightInput.setAttribute('aria-label', 'Default wall height in squares');
    el('span', 'atlas-tabletop-palette__unit', field, 'squares');
    const thick = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', thick, 'Wall thickness');
    this.thicknessInput = el('input', 'atlas-tabletop-palette__input', thick);
    this.thicknessInput.type = 'text';
    this.thicknessInput.inputMode = 'decimal';
    this.thicknessInput.setAttribute('aria-label', 'Wall thickness in squares');
    el('span', 'atlas-tabletop-palette__unit', thick, 'squares');
    el('div', 'atlas-tabletop-palette__hint', fog, 'Walls without a height of their own stand this many grid squares tall, and so does the fog painted in Atlas (0 lays the fog flat on the map).');
    // The board's own daylight: in the dark only Atlas's lights show the map.
    const lighting = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', lighting, 'Lighting');
    const ambient = el('label', 'atlas-tabletop-palette__field', lighting);
    el('span', 'atlas-tabletop-palette__label', ambient, 'Ambient light');
    this.ambientInput = el('input', 'atlas-tabletop-palette__range', ambient);
    this.ambientInput.type = 'range';
    this.ambientInput.min = '0';
    this.ambientInput.max = '100';
    this.ambientInput.step = '1';
    this.ambientInput.setAttribute('aria-label', 'Ambient light');
    this.ambientValue = el('span', 'atlas-tabletop-palette__unit', ambient, '');
    el('div', 'atlas-tabletop-palette__hint', lighting, "Lower it and the map goes dark: Atlas's lights shine in it. Right-click a light's bulb to set how high it hangs.");
    const level = (keep: boolean): void => {
      const value = Number(this.ambientInput.value) / 100;
      this.ambientValue.textContent = `${Math.round(value * 100)}%`;
      this.actions.setAmbient(value, keep);
    };
    this.ambientInput.addEventListener('input', () => level(false));
    this.ambientInput.addEventListener('change', () => level(true));
    // Atlas's command palette shows or hides its initiative tracker; so does this, and its I key.
    const initiative = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', initiative, 'Initiative tracker');
    const toggle = el('label', 'atlas-tabletop-palette__field', initiative);
    this.initiativeToggle = el('input', 'atlas-tabletop-palette__check', toggle);
    this.initiativeToggle.type = 'checkbox';
    el('span', 'atlas-tabletop-palette__label', toggle, 'Show initiative tracker (I)');
    this.initiativeToggle.addEventListener('change', () => {
      if (this.initiativeToggle.checked !== this.actions.initiativeOpen()) this.actions.toggleInitiative();
    });
    const apply = (): void => {
      const height = readFogHeight(this.heightInput.value);
      this.heightInput.toggleAttribute('aria-invalid', height === null);
      if (height !== null) this.actions.setFogHeight(height);
    };
    this.heightInput.addEventListener('change', apply);
    this.thicknessInput.addEventListener('change', () => {
      const thickness = readWallThickness(this.thicknessInput.value);
      this.thicknessInput.toggleAttribute('aria-invalid', thickness === null);
      if (thickness !== null) this.actions.setWallThickness(thickness);
    });
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
    // Connect's Template tool, while it hosts: the shapes show with the tool on.
    const hosting = this.actions.hosting();
    const templateOn = hosting && this.actions.templateOn();
    (this.templateButton.closest('.atlas-tool-button') as HTMLElement).style.display = hosting ? '' : 'none';
    this.templateButton.classList.toggle('is-active', templateOn);
    this.templateButton.setAttribute('aria-pressed', String(templateOn));
    this.templateShapes.style.display = templateOn ? '' : 'none';
    for (const choice of this.templateShapes.querySelectorAll<HTMLElement>('button')) choice.classList.toggle('is-active', choice.dataset.shape === this.actions.templateShape());
    const laser = this.actions.laserOn();
    // The group's face is always the tool in use, as Atlas's is while one of its tools is.
    this.laserButton.innerHTML = laser ? LASER_SVG : HAND_SVG;
    this.laserButton.classList.add('is-active');
    this.laserButton.setAttribute('aria-label', laser ? 'Laser Pointer' : 'Move/Select');
    this.laserButton.title = `${laser ? 'Laser Pointer' : 'Move/Select'} (${MOVE_KEY})`;
    for (const [entry, chosen] of [[this.moveItem, !laser], [this.laserItem, laser]] as const) {
      const check = entry.querySelector('.atlas-dropdown-menu-item__check')!;
      check.innerHTML = chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '';
      entry.setAttribute('aria-checked', String(chosen));
    }
    const open = this.actions.playerViewOpen();
    const frozen = open && this.actions.playerFrozen();
    const label = (button: HTMLButtonElement, text: string): void => {
      button.setAttribute('aria-label', text);
      button.title = text;
    };
    label(this.playerButton, open ? 'Close the player view' : 'Open the player view');
    this.playerButton.classList.toggle('is-active', open);
    this.playerButton.setAttribute('aria-pressed', String(open));
    // The wrapper is hidden, so the bar's last visible child (whose end corners follow the bar's) is the right one.
    (this.freezeButton.closest('.atlas-tool-button') as HTMLElement).hidden = !open;
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

  /** Hides the whole toolbar (a Connect player's board, whose tab has its own). */
  setHidden(hidden: boolean): void {
    this.row.hidden = hidden;
    // The row lays itself out as flex, which `hidden` alone does not undo.
    this.row.style.display = hidden ? 'none' : '';
    if (hidden) this.close();
  }

  open(): void {
    this.closeLaser();
    this.heightInput.value = String(this.actions.fogHeight());
    this.heightInput.removeAttribute('aria-invalid');
    this.thicknessInput.value = String(this.actions.wallThickness());
    this.thicknessInput.removeAttribute('aria-invalid');
    this.initiativeToggle.checked = this.actions.initiativeOpen();
    this.ambientInput.value = String(Math.round(this.actions.ambient() * 100));
    this.ambientValue.textContent = `${this.ambientInput.value}%`;
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
