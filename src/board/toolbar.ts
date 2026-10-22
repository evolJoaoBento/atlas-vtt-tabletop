/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: Atlas's Move/Select group (its button shows the
 * hand, or the flashlight while the laser pointer is on; its menu chooses between the two and holds the laser's
 * colour and size); the local player view (open or close it, and
 * freeze the players' camera while it is open), and the command button, which opens the board's settings in a panel
 * above it, as Atlas's opens its command palette. The panel has the fog of war's height. Plain HTML over the board;
 * keys typed in it stay out of the board's camera keys.
 */

import { DICES_SVG } from '../dice/dicePicker';
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
  /** Takes every template off the map. */
  clearTemplates(): void;
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

/** The board's dice picker and dice log, which open from buttons in the toolbar's end slot. */
export interface DiceButton {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
}

/** A button in the toolbar's end slot and the panel it toggles. */
interface EndButton {
  handlers: DiceButton;
  anchor: HTMLElement;
  button: HTMLButtonElement;
}

/** Lucide's `scroll-text` (ISC): the dice log's button. */
const LOG_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 12h-5"/><path d="M15 8h-5"/><path d="M19 17V5a2 2 0 0 0-2-2H4"/><path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"/></svg>';

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
/** Lucide's shapes: Connect's Template tool. */
const TEMPLATE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/></svg>';
/** Lucide's icons Connect's player toolbar shows beside each template shape, and for clearing them. */
const lucide = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const TEMPLATE_SHAPES = [
  ['line', 'Line', lucide('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>')],
  ['circle', 'Circle/Sphere', lucide('<circle cx="12" cy="12" r="10"/>')],
  ['square', 'Square/Cube', lucide('<rect width="18" height="18" x="3" y="3" rx="2"/>')],
  ['cone', 'Cone', lucide('<path d="M13.73 4a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>')],
] as const;
const ERASER_SVG = lucide('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>');

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
  /** Connect's Template tool, offered only while Connect hosts, and its shapes. */
  private readonly templateButton: HTMLButtonElement;
  private readonly templateGroup: HTMLElement;
  private readonly templateMenuButton: HTMLButtonElement;
  private readonly templatePanel: HTMLElement;
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
  private readonly heightInput: HTMLInputElement;
  private readonly thicknessInput: HTMLInputElement;
  private readonly initiativeToggle: HTMLInputElement;
  private readonly ambientInput: HTMLInputElement;
  private readonly ambientValue: HTMLElement;
  /** Atlas's end slot, and the Dice button in it while the board has dice. */
  private readonly endSlot: HTMLElement;
  private dice: EndButton | null = null;
  private diceLog: EndButton | null = null;
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel.contains(target) && !this.button.contains(target)) this.close();
    if (!this.laserPanel.contains(target) && !this.laserMenuButton.contains(target)) this.closeLaser();
    if (!this.templatePanel.contains(target) && !this.templateMenuButton.contains(target)) this.closeTemplate();
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
    const bar = el('div', 'atlas-vtt-toolbar atlas-main-toolbar atlas-tabletop-toolbar', this.row);
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
    // Connect's Template tool, as its player toolbar has it: the tool, and a chevron to its shapes and to clearing them.
    this.templateGroup = el('div', 'atlas-tool-group', bar);
    this.templateButton = toolIn(this.templateGroup, TEMPLATE_SVG, () => this.actions.selectTemplate(this.actions.templateOn() ? null : this.actions.templateShape()));
    this.templateButton.setAttribute('aria-label', 'Template');
    this.templateButton.title = 'Template (players see it)';
    const templateMenu = el('div', 'atlas-dropdown-menu', this.templateGroup);
    this.templateMenuButton = el('button', 'btn btn--ghost btn--icon atlas-dropdown-trigger btn--toolbar', templateMenu);
    this.templateMenuButton.type = 'button';
    this.templateMenuButton.innerHTML = CHEVRON_SVG;
    this.templateMenuButton.setAttribute('aria-label', 'Template options');
    this.templateMenuButton.title = 'Template options';
    this.templatePanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-template-options', templateMenu);
    this.templatePanel.hidden = true;
    const shapes = el('div', 'atlas-dropdown-section', this.templatePanel);
    const entry = (parent: HTMLElement, svg: string, label: string, choose: () => void, shape?: string): void => {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', parent);
      made.type = 'button';
      if (shape) made.dataset.shape = shape;
      el('span', 'atlas-dropdown-menu-item__check', made);
      made.insertAdjacentHTML('beforeend', svg);
      el('span', '', made, label);
      made.addEventListener('click', () => { choose(); this.closeTemplate(); });
    };
    for (const [shape, label, svg] of TEMPLATE_SHAPES) entry(shapes, svg, label, () => this.actions.selectTemplate(shape), shape);
    entry(el('div', 'atlas-dropdown-section', this.templatePanel), ERASER_SVG, 'Clear templates', () => this.actions.clearTemplates());
    this.templateMenuButton.addEventListener('click', () => (this.templatePanel.hidden ? this.openTemplate() : this.closeTemplate()));
    // Players are shown scenes with the eye on Atlas's scene tabs over the board: no player view or freeze button here.
    this.button = tool(COMMAND_SVG, () => (this.panel.hidden ? this.open() : this.close()));
    // Atlas's end slot, where Connect puts its buttons as it does in Atlas's own toolbar; Atlas's styles apply inside it.
    this.endSlot = el('div', 'atlas-toolbar-end atlas-vtt-plugin atlas-tabletop-extensions', bar);
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
    this.templateGroup.style.display = hosting ? '' : 'none';
    if (!hosting) this.closeTemplate();
    this.templateButton.classList.toggle('is-active', templateOn);
    this.templateButton.setAttribute('aria-pressed', String(templateOn));
    for (const choice of this.templatePanel.querySelectorAll<HTMLElement>('[data-shape]')) {
      const check = choice.querySelector('.atlas-dropdown-menu-item__check')!;
      const chosen = choice.dataset.shape === this.actions.templateShape();
      check.innerHTML = chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '';
    }
    for (const end of [this.dice, this.diceLog]) {
      if (!end) continue;
      const open = end.handlers.isOpen();
      end.button.classList.toggle('is-active', open);
      end.button.setAttribute('aria-expanded', String(open));
    }
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
  }

  get isOpen(): boolean {
    return !this.panel.hidden || !this.laserPanel.hidden || this.dice?.handlers.isOpen() === true || this.diceLog?.handlers.isOpen() === true;
  }

  /**
   * Puts the Dice button in Atlas's end slot (before what Connect puts there), or takes it away with null. Returns the
   * place the picker opens from: above the button, inside the slot's `atlas-vtt-plugin` root.
   */
  setDice(handlers: DiceButton | null): HTMLElement | null {
    this.dice?.anchor.remove();
    this.dice = null;
    if (!handlers) return null;
    this.dice = this.endButton('Dice', DICES_SVG, handlers, 'atlas-tabletop-dice-menu', null);
    return this.dice.anchor;
  }

  /** Puts the dice log's button next to the Dice button (or first in the end slot without one); null takes it away. */
  setDiceLog(handlers: DiceButton | null): HTMLElement | null {
    this.diceLog?.anchor.remove();
    this.diceLog = null;
    if (!handlers) return null;
    this.diceLog = this.endButton('Dice log', LOG_SVG, handlers, 'atlas-tabletop-dice-log-menu', () => this.dice?.anchor ?? null);
    return this.diceLog.anchor;
  }

  /** A button in the end slot that opens a panel above itself, the other toolbar panels (and the other dice panel) shut. */
  private endButton(label: string, svg: string, handlers: DiceButton, className: string, after: (() => HTMLElement | null) | null): EndButton {
    const doc = this.row.ownerDocument;
    const anchor = doc.createElement('div');
    anchor.className = `atlas-dropdown-menu ${className}`;
    const wrapper = doc.createElement('div');
    wrapper.className = 'atlas-tool-button';
    const span = doc.createElement('span');
    span.style.display = 'inline-flex';
    const button = doc.createElement('button');
    button.className = 'btn btn--toolbar btn--icon atlas-tabletop-tool-button';
    button.type = 'button';
    button.innerHTML = svg;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-expanded', 'false');
    const made: EndButton = { handlers, anchor, button };
    button.addEventListener('click', () => {
      this.close();
      this.closeLaser();
      this.closeTemplate();
      for (const other of [this.dice, this.diceLog]) if (other && other !== made) other.handlers.close();
      handlers.toggle();
      this.refresh();
    });
    span.appendChild(button);
    wrapper.appendChild(span);
    anchor.appendChild(wrapper);
    // Next to the Dice button when it is there, else first in the slot.
    const beside = after?.() ?? null;
    if (beside) beside.after(anchor);
    else this.endSlot.prepend(anchor);
    this.refresh();
    return made;
  }

  closeDice(): void {
    this.dice?.handlers.close();
    this.diceLog?.handlers.close();
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

  openTemplate(): void {
    this.closeLaser();
    this.templatePanel.hidden = false;
    this.templateMenuButton.classList.add('atlas-is-active');
    this.templateMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeTemplate(): void {
    if (this.templatePanel.hidden) return;
    this.templatePanel.hidden = true;
    this.templateMenuButton.classList.remove('atlas-is-active');
    this.templateMenuButton.setAttribute('aria-expanded', 'false');
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
    this.setDice(null);
    this.setDiceLog(null);
    this.row.remove();
  }
}
