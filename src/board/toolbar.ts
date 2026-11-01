/**
 * The 3D board's toolbar, at the bottom of the board in Atlas's look: Atlas's Move/Select group (its button shows the
 * hand, or the flashlight while the laser pointer is on; its menu chooses between the two and holds the laser's
 * colour and size); the local player view (open or close it, and
 * freeze the players' camera while it is open), and the command button, which opens the board's settings in a panel
 * above it, as Atlas's opens its command palette. The panel has the fog of war's height. Plain HTML over the board;
 * keys typed in it stay out of the board's camera keys.
 */

import { setSvg } from '../svg';
import { DICES_SVG } from '../dice/dicePicker';
import type { LightingChoice } from './look';
import { DEFAULT_EDGES, DEFAULT_SEE_THROUGH_SIZE, MAX_SEE_THROUGH_SIZE, MIN_SEE_THROUGH_SIZE, readSeeThroughSize, DEFAULT_LAYER_LOOK, type LayerLook, type WallEdges } from './quality';
import { t } from '../i18n';
import { LASER_COLORS, LASER_COLOR_HINT, LASER_SIZE_MAX, LASER_SIZE_MIN, type LaserSettings } from './laser';

export interface ToolbarActions {
  /** How tall the fog stands, in grid squares. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** How thick the walls stand, as a share of a grid square. */
  wallThickness(): number;
  setWallThickness(thickness: number): void;
  /** How round the walls' edges are, kept for every board; absent where it is not the GM's to choose. */
  wallEdges?(): WallEdges;
  setWallEdges?(edges: WallEdges): void;
  /** Whether walls between the camera and what it looks at fade out, kept for every board; absent where it is not the GM's to choose. */
  seeThrough?(): boolean;
  setSeeThrough?(on: boolean): void;
  seeThroughSize?(): number;
  setSeeThroughSize?(squares: number): void;
  /** How the image of an elevation layer is drawn; absent where it is not the GM's to choose. */
  layerLook?(): LayerLook;
  setLayerLook?(look: LayerLook): void;
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
  /** Whether the board's lighting is chosen here (a board of the GM's); the choice now; choosing one. */
  canLight(): boolean;
  lighting(): LightingChoice;
  setLighting(choice: LightingChoice): void;
  /** The miniature look (tilt-shift) and the contact shadows, on or off, kept for every board. */
  tiltShift(): boolean;
  setTiltShift(on: boolean): void;
  occlusion(): boolean;
  setOcclusion(on: boolean): void;
  /** Whether a stat sheet's roll is thrown at once, or its dice lie on the table; changing it. Absent where dice are not the GM's. */
  autoRoll(): boolean;
  setAutoRoll(on: boolean): void;
  /** The board's ambient light (0–1); a new level, shown while the slider moves and kept when it is let go. */
  ambient(): number;
  setAmbient(level: number, keep: boolean): void;
}

/** The board's dice picker, dice log and stat sheet, which open from buttons in the toolbar's end slot. */
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

/** Lucide's `notebook-text` (ISC): the stat sheet's button. */
const SHEET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9.5 8h5"/><path d="M9.5 12H16"/><path d="M9.5 16H14"/></svg>';

/** Lucide's `ellipsis` (ISC): the More tools button. */
const MORE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';

/** Lucide's `command` icon (ISC), the glyph of Atlas's command palette button. */
/** Lucide's `brick-wall` icon (ISC): the board settings button, whose panel is about walls and fog first. */
const WALL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 9v6"/><path d="M16 15v6"/><path d="M16 3v6"/><path d="M3 15h18"/><path d="M3 9h18"/><path d="M8 15v6"/><path d="M8 3v6"/></svg>';

const COMMAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>';

/** Lucide's `flashlight`, `chevron-down` and `check` icons (ISC): Atlas's laser pointer, its options' chevron, a chosen swatch. */
const LASER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12z"/><line x1="6" x2="18" y1="6" y2="6"/><line x1="12" x2="12" y1="12" y2="12"/></svg>';
/** Lucide's `hand` (ISC): Atlas's Move/Select. */
const HAND_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';
/** Lucide's `lightbulb`, `sunset`, `sun` and `moon` icons (ISC): the lighting choices. */
const LIGHTING_ICONS: Readonly<Record<LightingChoice, string>> = {
  classic: lucide2('<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>'),
  dusk: lucide2('<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>'),
  day: lucide2('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  night: lucide2('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
};
const lightingLabel = (choice: LightingChoice): string => t(`lighting.${choice}`);
const LIGHTING_ORDER: readonly LightingChoice[] = ['classic', 'dusk', 'day', 'night'];

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

function lucide2(body: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

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
  private readonly bar: HTMLElement;
  /** Atlas's "More tools": the tools that do not fit a narrow pane move into its menu, in this order of leaving. */
  private readonly moreGroup: HTMLElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu: HTMLElement;
  private readonly fitOrder: HTMLElement[] = [];
  private readonly fitWatch: ResizeObserver;
  private readonly panel: HTMLElement;
  private readonly button: HTMLButtonElement;
  /** Connect's Template tool, offered only while Connect hosts, and its shapes. */
  private readonly templateButton: HTMLButtonElement;
  private readonly templateGroup: HTMLElement;
  private readonly templateMenuButton: HTMLButtonElement;
  private readonly templatePanel: HTMLElement;
  private readonly autoRollToggle: HTMLInputElement;
  private readonly laserButton: HTMLButtonElement;
  /** The lighting button, and the menu above it that chooses the board's lighting. */
  private readonly lightingGroup: HTMLElement;
  private readonly lightingButton: HTMLButtonElement;
  private readonly lightingPanel: HTMLElement;
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
  private readonly seeThroughToggle: HTMLInputElement;
  private readonly seeThroughSizeInput: HTMLInputElement;
  private readonly seeThroughSizeValue: HTMLElement;
  private readonly edgeButtons: Array<{ value: WallEdges; button: HTMLButtonElement }> = [];
  private readonly layerButtons: Array<{ value: LayerLook; button: HTMLButtonElement }> = [];
  private readonly initiativeToggle: HTMLInputElement;
  private readonly ambientInput: HTMLInputElement;
  private readonly ambientValue: HTMLElement;
  private readonly tiltInput: HTMLInputElement;
  private readonly occlusionInput: HTMLInputElement;
  /** Atlas's end slot, and the Dice button in it while the board has dice. */
  private readonly endSlot: HTMLElement;
  private dice: EndButton | null = null;
  private diceLog: EndButton | null = null;
  private sheet: EndButton | null = null;
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!this.panel.contains(target) && !this.button.contains(target)) this.close();
    if (!this.laserPanel.contains(target) && !this.laserMenuButton.contains(target)) this.closeLaser();
    if (!this.templatePanel.contains(target) && !this.templateMenuButton.contains(target)) this.closeTemplate();
    if (!this.lightingPanel.contains(target) && !this.lightingButton.contains(target)) this.closeLighting();
    if (!this.moreMenu.contains(target) && !this.moreButton.contains(target)) this.closeMore();
  };

  constructor(container: HTMLElement, private readonly actions: ToolbarActions) {
    const doc = container.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
      const made = doc.win.createEl(tag);
      made.className = className;
      if (text !== undefined) made.textContent = text;
      parent.appendChild(made);
      return made;
    };

    // Atlas's own class names under a root of Tabletop's: its look is copied in styles.css, without needing its styles.
    this.row = el('div', 'atlas-tabletop-toolbar-row atlas-tabletop-atlas', container);
    const bar = el('div', 'atlas-vtt-toolbar atlas-main-toolbar atlas-tabletop-toolbar', this.row);
    this.bar = bar;
    bar.setAttribute('role', 'toolbar');
    // Atlas's ToolButton: a wrapper, a span, and the button itself (a toolbar icon button).
    const toolIn = (parent: HTMLElement, svg: string, onClick: () => void): HTMLButtonElement => {
      const wrapper = el('div', 'atlas-tool-button', parent);
      const span = el('span', '', wrapper);
      span.setCssStyles({ display: 'inline-flex' });
      const made = el('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button', span);
      made.type = 'button';
      setSvg(made, svg);
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
    setSvg(this.laserMenuButton, CHEVRON_SVG);
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
      setSvg(made, svg, true);
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
      if (event.key in steps) setSize(size + steps[event.key]);
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
    setSvg(this.templateMenuButton, CHEVRON_SVG);
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
      setSvg(made, svg, true);
      el('span', '', made, label);
      made.addEventListener('click', () => { choose(); this.closeTemplate(); });
    };
    for (const [shape, label, svg] of TEMPLATE_SHAPES) entry(shapes, svg, label, () => this.actions.selectTemplate(shape), shape);
    entry(el('div', 'atlas-dropdown-section', this.templatePanel), ERASER_SVG, 'Clear templates', () => this.actions.clearTemplates());
    this.templateMenuButton.addEventListener('click', () => (this.templatePanel.hidden ? this.openTemplate() : this.closeTemplate()));
    // The board's lighting, chosen here: the classic look or the painted one under a dusk, day or night sky.
    this.lightingGroup = el('div', 'atlas-dropdown-menu', bar);
    this.lightingButton = toolIn(this.lightingGroup, LIGHTING_ICONS.classic, () => (this.lightingPanel.hidden ? this.openLighting() : this.closeLighting()));
    this.lightingButton.setAttribute('aria-expanded', 'false');
    this.lightingPanel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--left atlas-tabletop-lighting-options', this.lightingGroup);
    this.lightingPanel.hidden = true;
    this.lightingPanel.setAttribute('role', 'menu');
    const choices = el('div', 'atlas-dropdown-section', this.lightingPanel);
    for (const choice of LIGHTING_ORDER) {
      const made = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item', choices);
      made.type = 'button';
      made.dataset.lighting = choice;
      el('span', 'atlas-dropdown-menu-item__check', made);
      setSvg(made, LIGHTING_ICONS[choice], true);
      el('span', '', made, lightingLabel(choice));
      made.addEventListener('click', () => { this.actions.setLighting(choice); this.closeLighting(); this.refresh(); });
    }
    // The board's own daylight: in the dark only Atlas's lights show the map.
    const light = el('div', 'atlas-tabletop-palette__section atlas-tabletop-lighting-extra', this.lightingPanel);
    const ambient = el('label', 'atlas-tabletop-palette__field', light);
    el('span', 'atlas-tabletop-palette__label', ambient, t('lighting.ambient'));
    this.ambientInput = el('input', 'atlas-tabletop-palette__range', ambient);
    this.ambientInput.type = 'range';
    this.ambientInput.min = '0';
    this.ambientInput.max = '100';
    this.ambientInput.step = '1';
    this.ambientInput.setAttribute('aria-label', t('lighting.ambient'));
    this.ambientValue = el('span', 'atlas-tabletop-palette__unit', ambient, '');
    el('div', 'atlas-tabletop-palette__hint', light, t('lighting.ambientHint'));
    const level = (keep: boolean): void => {
      const value = Number(this.ambientInput.value) / 100;
      this.ambientValue.textContent = `${Math.round(value * 100)}%`;
      this.actions.setAmbient(value, keep);
    };
    this.ambientInput.addEventListener('input', () => level(false));
    this.ambientInput.addEventListener('change', () => level(true));
    // The two extra looks: each a checkbox, kept for every board.
    const toggleIn = (label: string, hint: string, change: (on: boolean) => void): HTMLInputElement => {
      const field = el('label', 'atlas-tabletop-palette__field', light);
      const box = el('input', 'atlas-tabletop-palette__check', field);
      box.type = 'checkbox';
      el('span', 'atlas-tabletop-palette__label', field, label);
      field.title = hint;
      box.addEventListener('change', () => change(box.checked));
      return box;
    };
    this.tiltInput = toggleIn(t('lighting.tilt'), t('lighting.tiltHint'), (on) => this.actions.setTiltShift(on));
    this.occlusionInput = toggleIn(t('lighting.occlusion'), t('lighting.occlusionHint'), (on) => this.actions.setOcclusion(on));
    this.lightingPanel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closeLighting(); }
    });
    // Players are shown scenes with the eye on Atlas's scene tabs over the board: no player view or freeze button here.
    this.button = tool(WALL_SVG, () => (this.panel.hidden ? this.open() : this.close()));
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
    const edges = el('div', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', edges, 'Wall edges');
    const edgeChoices = el('span', 'atlas-tabletop-palette__choices', edges);
    edgeChoices.setAttribute('role', 'group');
    edgeChoices.setAttribute('aria-label', 'How round the edges of walls and doors are');
    for (const [value, label] of [['sharp', 'Sharp'], ['soft', 'Soft'], ['round', 'Round']] as const) {
      const button = el('button', 'atlas-tabletop-palette__choice', edgeChoices, label);
      button.type = 'button';
      // Applies at once: the choice shows as chosen now, and the walls follow.
      button.addEventListener('click', () => {
        this.actions.setWallEdges?.(value);
        this.showEdges(value);
      });
      this.edgeButtons.push({ value, button });
    }
    edges.title = 'Sharp is a plain box; Soft rounds the edges a little so they catch the light; Rounded is more pillowy. Walls are drawn with more triangles when rounded.';
    const through = el('label', 'atlas-tabletop-palette__field', fog);
    this.seeThroughToggle = el('input', 'atlas-tabletop-palette__check', through);
    this.seeThroughToggle.type = 'checkbox';
    el('span', 'atlas-tabletop-palette__label', through, 'See-through walls');
    through.title = 'Walls between the camera and the point it turns around fade out, so they never hide what you are looking at.';
    this.seeThroughToggle.addEventListener('change', () => this.actions.setSeeThrough?.(this.seeThroughToggle.checked));
    const sizeField = el('label', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', sizeField, 'Window size');
    this.seeThroughSizeInput = el('input', 'atlas-tabletop-palette__range', sizeField);
    this.seeThroughSizeInput.type = 'range';
    this.seeThroughSizeInput.min = String(MIN_SEE_THROUGH_SIZE);
    this.seeThroughSizeInput.max = String(MAX_SEE_THROUGH_SIZE);
    this.seeThroughSizeInput.step = '0.1';
    this.seeThroughSizeInput.setAttribute('aria-label', 'How wide the see-through window is, in grid squares');
    this.seeThroughSizeValue = el('span', 'atlas-tabletop-palette__unit', sizeField, '');
    this.seeThroughSizeInput.addEventListener('input', () => {
      const squares = readSeeThroughSize(Number(this.seeThroughSizeInput.value));
      this.seeThroughSizeValue.textContent = `${squares.toFixed(1)} sq`;
      this.actions.setSeeThroughSize?.(squares);
    });
    const layers = el('div', 'atlas-tabletop-palette__field', fog);
    el('span', 'atlas-tabletop-palette__label', layers, 'Upper layers');
    const layerChoices = el('span', 'atlas-tabletop-palette__choices', layers);
    layerChoices.setAttribute('role', 'group');
    layerChoices.setAttribute('aria-label', 'How the floor image of a map stacked above another is drawn');
    for (const [value, label] of [['solid', 'Solid'], ['faded', 'Faded'], ['transparent', 'Hidden']] as const) {
      const button = el('button', 'atlas-tabletop-palette__choice', layerChoices, label);
      button.type = 'button';
      button.addEventListener('click', () => {
        this.actions.setLayerLook?.(value);
        this.showLayerLook(value);
      });
      this.layerButtons.push({ value, button });
    }
    layers.title = 'Maps stacked above another (set in the file menu of a map): Solid draws their image whole, Faded half see-through, Hidden draws only their walls, props and minis. Transparent parts of the image always show what is below.';
    el('div', 'atlas-tabletop-palette__hint', fog, 'Walls without a height of their own stand this many grid squares tall, and so does the fog painted in Atlas (0 lays the fog flat on the map).');
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
    const dice = el('div', 'atlas-tabletop-palette__section', this.panel);
    el('div', 'atlas-tabletop-palette__heading', dice, t('dice.heading'));
    const auto = el('label', 'atlas-tabletop-palette__field', dice);
    this.autoRollToggle = el('input', 'atlas-tabletop-palette__check', auto);
    this.autoRollToggle.type = 'checkbox';
    el('span', 'atlas-tabletop-palette__label', auto, t('dice.autoRoll'));
    auto.title = t('dice.autoRollHint');
    this.autoRollToggle.addEventListener('change', () => this.actions.setAutoRoll(this.autoRollToggle.checked));
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
    // Atlas's "More tools": when the pane is too narrow for the bar, the tools farthest from the Move group go into this
    // menu, one by one, and come back as the pane widens.
    this.moreGroup = el('div', 'atlas-dropdown-menu atlas-tabletop-more', bar);
    this.moreButton = toolIn(this.moreGroup, MORE_SVG, () => (this.moreMenu.hidden ? this.openMore() : this.closeMore()));
    this.moreButton.setAttribute('aria-label', t('toolbar.more'));
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.title = t('toolbar.more');
    this.moreMenu = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-dropdown-content--right atlas-tabletop-more-menu', this.moreGroup);
    this.moreMenu.hidden = true;
    this.moreGroup.hidden = true;
    this.moreGroup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.moreMenu.hidden) { event.preventDefault(); event.stopPropagation(); this.closeMore(); }
    });
    // Left to right as they stand; they leave from the right.
    this.fitOrder.push(laserGroup, this.templateGroup, this.lightingGroup, this.button.closest('.atlas-tool-button') as HTMLElement, this.endSlot);
    this.fitWatch = new (doc.defaultView ?? window).ResizeObserver(() => this.fit());
    this.fitWatch.observe(container);
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
      setSvg(check, chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
    }
    const canLight = this.actions.canLight();
    this.lightingGroup.style.display = canLight ? '' : 'none';
    if (!canLight) this.closeLighting();
    const lighting = this.actions.lighting();
    setSvg(this.lightingButton, LIGHTING_ICONS[lighting]);
    this.lightingButton.setAttribute('aria-label', t('lighting.title', { mode: lightingLabel(lighting) }));
    this.lightingButton.title = t('lighting.title', { mode: lightingLabel(lighting) });
    for (const choice of this.lightingPanel.querySelectorAll<HTMLElement>('[data-lighting]')) {
      const check = choice.querySelector('.atlas-dropdown-menu-item__check')!;
      setSvg(check, choice.dataset.lighting === lighting ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
    }
    for (const end of this.ends()) {
      const open = end.handlers.isOpen();
      end.button.classList.toggle('is-active', open);
      end.button.setAttribute('aria-expanded', String(open));
    }
    const laser = this.actions.laserOn();
    // The group's face is always the tool in use, as Atlas's is while one of its tools is.
    setSvg(this.laserButton, laser ? LASER_SVG : HAND_SVG);
    this.laserButton.classList.add('is-active');
    this.laserButton.setAttribute('aria-label', laser ? 'Laser Pointer' : 'Move/Select');
    this.laserButton.title = `${laser ? 'Laser Pointer' : 'Move/Select'} (${MOVE_KEY})`;
    for (const [entry, chosen] of [[this.moveItem, !laser], [this.laserItem, laser]] as const) {
      const check = entry.querySelector('.atlas-dropdown-menu-item__check')!;
      setSvg(check, chosen ? CHECK_SVG.replace('class="atlas-swatch-check"', 'class="atlas-dropdown-menu-item__tick"') : '');
      entry.setAttribute('aria-checked', String(chosen));
    }
  }

  get isOpen(): boolean {
    return !this.panel.hidden || !this.laserPanel.hidden || !this.lightingPanel.hidden || !this.moreMenu.hidden || this.ends().some((end) => end.handlers.isOpen());
  }

  /** The end slot's buttons there now: Dice, its log and the stat sheet. */
  private ends(): EndButton[] {
    return [this.dice, this.diceLog, this.sheet].filter((end): end is EndButton => end !== null);
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

  /** Puts the stat sheet's button after the dice log's (or the Dice button's); null takes it away. */
  setSheet(handlers: DiceButton | null): HTMLElement | null {
    this.sheet?.anchor.remove();
    this.sheet = null;
    if (!handlers) return null;
    this.sheet = this.endButton('Stat sheet', SHEET_SVG, handlers, 'atlas-tabletop-sheet-menu', () => this.diceLog?.anchor ?? this.dice?.anchor ?? null);
    return this.sheet.anchor;
  }

  /** A button in the end slot that opens its panel, the other toolbar panels (and the other end slot panels) shut. */
  private endButton(label: string, svg: string, handlers: DiceButton, className: string, after: (() => HTMLElement | null) | null): EndButton {
    const doc = this.row.ownerDocument;
    const anchor = doc.win.createDiv();
    anchor.className = `atlas-dropdown-menu ${className}`;
    const wrapper = doc.win.createDiv();
    wrapper.className = 'atlas-tool-button';
    const span = doc.win.createSpan();
    span.setCssStyles({ display: 'inline-flex' });
    const button = doc.win.createEl('button');
    button.className = 'btn btn--toolbar btn--icon atlas-tabletop-tool-button';
    button.type = 'button';
    setSvg(button, svg);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.setAttribute('aria-expanded', 'false');
    const made: EndButton = { handlers, anchor, button };
    button.addEventListener('click', () => {
      this.close();
      this.closeLaser();
      this.closeTemplate();
      this.closeLighting();
      for (const other of this.ends()) if (other !== made) other.handlers.close();
      handlers.toggle();
      this.refresh();
    });
    span.appendChild(button);
    wrapper.appendChild(span);
    anchor.appendChild(wrapper);
    // Next to the button before it when that is there, else first in the slot.
    const beside = after?.() ?? null;
    if (beside) beside.after(anchor);
    else this.endSlot.prepend(anchor);
    this.refresh();
    return made;
  }

  closeDice(): void {
    for (const end of this.ends()) end.handlers.close();
  }

  /** Shows the laser's options above the toolbar. */
  openLaser(): void {
    this.close();
    this.closeDice();
    this.showLaser();
    this.laserPanel.hidden = false;
    this.laserMenuButton.classList.add('atlas-is-active');
    this.laserMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  openTemplate(): void {
    this.closeLaser();
    this.closeDice();
    this.templatePanel.hidden = false;
    this.templateMenuButton.classList.add('atlas-is-active');
    this.templateMenuButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  /**
   * Fits the bar to the pane: every tool back on the bar, then, while the bar is wider than the pane, the farthest tool
   * moves into the More tools menu. The Move group never leaves.
   */
  fit(): void {
    const room = Math.max(0, this.row.parentElement?.clientWidth ?? 0) - 32;
    if (room <= 0) return;
    const wasOpen = !this.moreMenu.hidden;
    for (const item of this.fitOrder) this.bar.insertBefore(item, this.moreGroup);
    this.moreGroup.hidden = true;
    let moved = 0;
    for (let at = this.fitOrder.length - 1; at > 0 && this.bar.getBoundingClientRect().width > room; at--) {
      // The More button itself takes room once something is in it.
      this.moreGroup.hidden = false;
      this.moreMenu.prepend(this.fitOrder[at]);
      moved++;
    }
    if (moved === 0) this.closeMore();
    else if (wasOpen) this.moreMenu.hidden = false;
    this.moreGroup.hidden = moved === 0;
  }

  openMore(): void {
    this.close();
    this.closeDice();
    this.closeLaser();
    this.closeLighting();
    this.moreMenu.hidden = false;
    this.moreButton.classList.add('is-active');
    this.moreButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeMore(): void {
    if (this.moreMenu.hidden) return;
    this.moreMenu.hidden = true;
    this.moreButton.classList.remove('is-active');
    this.moreButton.setAttribute('aria-expanded', 'false');
  }

  /** Shows the lighting choices above the toolbar. */
  openLighting(): void {
    this.close();
    this.closeLaser();
    this.closeTemplate();
    this.closeDice();
    this.ambientInput.value = String(Math.round(this.actions.ambient() * 100));
    this.ambientValue.textContent = `${this.ambientInput.value}%`;
    this.tiltInput.checked = this.actions.tiltShift();
    this.occlusionInput.checked = this.actions.occlusion();
    this.lightingPanel.hidden = false;
    this.lightingButton.classList.add('is-active');
    this.lightingButton.setAttribute('aria-expanded', 'true');
    this.row.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
  }

  closeLighting(): void {
    if (this.lightingPanel.hidden) return;
    this.lightingPanel.hidden = true;
    this.lightingButton.classList.remove('is-active');
    this.lightingButton.setAttribute('aria-expanded', 'false');
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
      setSvg(swatch, chosen ? CHECK_SVG : '');
    }
    const share = (size - LASER_SIZE_MIN) / (LASER_SIZE_MAX - LASER_SIZE_MIN);
    this.sliderRange.setCssStyles({ left: '0' });
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

  /** Marks the chosen wall edges in the settings. */
  private showEdges(chosen: WallEdges): void {
    for (const { value, button } of this.edgeButtons) button.classList.toggle('is-active', value === chosen);
    for (const { value, button } of this.edgeButtons) button.setAttribute('aria-pressed', String(value === chosen));
  }

  private showLayerLook(chosen: LayerLook): void {
    for (const { value, button } of this.layerButtons) {
      button.classList.toggle('is-active', value === chosen);
      button.setAttribute('aria-pressed', String(value === chosen));
    }
  }

  open(): void {
    this.closeLaser();
    // The panels of the end slot (the dice tray, the log, an unpinned sheet) give way to this one.
    this.closeDice();
    this.heightInput.value = String(this.actions.fogHeight());
    this.heightInput.removeAttribute('aria-invalid');
    this.thicknessInput.value = String(this.actions.wallThickness());
    this.thicknessInput.removeAttribute('aria-invalid');
    this.showEdges(this.actions.wallEdges?.() ?? DEFAULT_EDGES);
    this.seeThroughToggle.checked = this.actions.seeThrough?.() ?? false;
    this.seeThroughToggle.closest('.atlas-tabletop-palette__field')?.toggleAttribute('hidden', this.actions.setSeeThrough === undefined);
    const squares = this.actions.seeThroughSize?.() ?? DEFAULT_SEE_THROUGH_SIZE;
    this.seeThroughSizeInput.value = String(squares);
    this.seeThroughSizeValue.textContent = `${squares.toFixed(1)} sq`;
    this.seeThroughSizeInput.closest('.atlas-tabletop-palette__field')?.toggleAttribute('hidden', this.actions.setSeeThroughSize === undefined);
    this.edgeButtons[0]?.button.closest('.atlas-tabletop-palette__field')?.toggleAttribute('hidden', this.actions.setWallEdges === undefined);
    this.showLayerLook(this.actions.layerLook?.() ?? DEFAULT_LAYER_LOOK);
    this.layerButtons[0]?.button.closest('.atlas-tabletop-palette__field')?.toggleAttribute('hidden', this.actions.setLayerLook === undefined);
    this.initiativeToggle.checked = this.actions.initiativeOpen();
    this.autoRollToggle.checked = this.actions.autoRoll();
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
    this.setSheet(null);
    this.fitWatch.disconnect();
    this.row.remove();
  }
}
