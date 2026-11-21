/**
 * The fog tool's two bars above the main toolbar while the tool is on (Atlas 0.18's `FogToolBar`), in Atlas's own words,
 * order and tooltips: the modes (Fog, Eraser); then the shapes, the brush size, Cover all, Delete all fog and the More menu
 * (the GM's fog opacity, Snap and Constrain, Hide all rooms). Only the board's Edit mode shows them. What cannot be chosen
 * now is shown disabled with its reason as the tooltip, so nothing moves when a choice changes.
 */
import { at } from '../atlasPort/atlasText';
import { DEFAULT_GM_FOG_OPACITY, GM_FOG_OPACITY_RANGE } from '../atlasPort/gmFogOpacity';
import { DEFAULT_FOG_TOOL, FOG_BRUSH_SIZES, type FogShape, type FogToolId } from '../atlasPort/fogToolChoices';
import { setSvg } from '../svg';
import { t } from '../i18n';
import { fogIcon, type FogIconId } from './atlasToolIcons';
import type { AtlasTooltip } from './atlasTooltip';
import type { FogBarActions } from './fogTool';

type MakeElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string) => HTMLElementTagNameMap[K];

/** The dot on the size button, in pixels: as small and as large as the button's icon may be (Atlas's `SIZE_DOT`). */
const SIZE_DOT = { min: 4, max: 16 } as const;

const SHAPES: ReadonlyArray<{ value: FogShape; icon: FogIconId; label: () => string; tip?: () => string }> = [
  { value: 'brush', icon: 'brush', label: () => at('toolbar.brush') },
  { value: 'rectangle', icon: 'rectangle', label: () => at('toolbar.rectangle'), tip: () => at('fog.rectangleTip') },
  { value: 'polygon', icon: 'polygon', label: () => at('fog.polygon'), tip: () => at('fog.polygonTip') },
  { value: 'lasso', icon: 'lasso', label: () => at('toolbar.lasso') },
  { value: 'cells', icon: 'cells', label: () => at('fog.cells'), tip: () => at('fog.cellsTip') },
  { value: 'room', icon: 'room', label: () => at('fog.room'), tip: () => at('fog.roomTip') },
];

const MODES: ReadonlyArray<{ value: FogToolId; icon: FogIconId; label: () => string; tip: () => string }> = [
  { value: 'fog', icon: 'fog', label: () => at('fog.fog'), tip: () => at('fog.fogTip') },
  { value: 'eraser', icon: 'eraser', label: () => at('fog.eraser'), tip: () => at('fog.eraserTip') },
];

export class FogToolBars {
  /** Both bars, side by side above the toolbar; hidden while the tool is off. */
  readonly panel: HTMLElement;
  private readonly modeButtons = new Map<FogToolId, HTMLButtonElement>();
  private readonly shapeButtons = new Map<FogShape, HTMLButtonElement>();
  private readonly sizeButton: HTMLButtonElement;
  private readonly sizeDot: HTMLElement;
  private readonly sizePanel: HTMLElement;
  private readonly sizeInput: HTMLInputElement;
  private readonly sizeValue: HTMLElement;
  private readonly coverButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly morePanel: HTMLElement;
  private readonly opacityRow: HTMLElement;
  private readonly opacityInput: HTMLInputElement;
  private readonly opacityValue: HTMLElement;
  private readonly switches = new Map<'fogSnap' | 'fogConstrain', HTMLElement>();
  private readonly roomsItem: HTMLButtonElement;
  private readonly roomsHolder: HTMLElement;
  private open: 'size' | 'more' | null = null;
  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.open === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.closePopovers();
  };

  constructor(parent: HTMLElement, private readonly el: MakeElement, private readonly tooltip: AtlasTooltip, private readonly actions: FogBarActions, private readonly refresh: () => void, private readonly onPopover: (open: boolean) => void) {
    this.panel = el('div', 'atlas-tool-bars atlas-tabletop-fog-bars atlas-tabletop-fog-options', parent);
    this.panel.hidden = true;
    const modes = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--modes atlas-tabletop-fog-bar', this.panel);
    modes.setAttribute('role', 'toolbar');
    modes.setAttribute('aria-label', at('fog.modes'));
    for (const mode of MODES) {
      const made = this.button(modes, mode.icon, () => this.actions.setMode(mode.value), () => ({ label: mode.label(), subtitle: mode.tip() }), mode.label());
      made.dataset.fogMode = mode.value;
      this.modeButtons.set(mode.value, made);
    }
    const tools = el('div', 'atlas-vtt-toolbar atlas-tool-bar atlas-tool-bar--tools atlas-tabletop-fog-bar', this.panel);
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', at('fog.tools'));
    for (const shape of SHAPES) {
      const made = this.button(tools, shape.icon, () => this.actions.setShape(shape.value), () => {
        const why = this.unavailable(shape.value);
        const subtitle = why ?? shape.tip?.();
        return { label: shape.label(), ...(subtitle !== undefined ? { subtitle } : {}) };
      }, shape.label(), true);
      made.dataset.fogShape = shape.value;
      this.shapeButtons.set(shape.value, made);
    }
    // The brush's size: a dot that grows with the brush, and a slider above it.
    const sizeMenu = el('div', 'atlas-dropdown-menu atlas-tabletop-fog-popover-anchor', tools);
    const sizeWrap = el('div', 'atlas-tool-button', sizeMenu);
    const sizeSpan = el('span', '', sizeWrap);
    sizeSpan.setCssStyles({ display: 'inline-flex' });
    this.sizeButton = el('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button atlas-tool-bar__choice', sizeSpan);
    this.sizeButton.type = 'button';
    this.sizeButton.dataset.fogPopover = 'size';
    this.sizeButton.setAttribute('aria-label', at('fog.brushSize'));
    this.sizeButton.setAttribute('aria-haspopup', 'menu');
    this.sizeButton.setAttribute('aria-expanded', 'false');
    this.sizeDot = el('span', 'atlas-fog-size-dot', this.sizeButton);
    this.sizeButton.addEventListener('click', () => { if (this.state().shape === 'brush') this.toggle('size'); });
    this.tooltip.attach(sizeSpan, () => {
      const brush = this.state().shape === 'brush';
      return { label: at('fog.brushSize'), ...(brush ? {} : { subtitle: at('fog.brushSizeNeedsBrush') }), shortcut: this.actions.brushKeys() };
    });
    this.sizePanel = this.popover(sizeMenu, 'size', 'center');
    const sizeSection = el('div', 'atlas-dropdown-section', this.sizePanel);
    const size = this.sliderRow(sizeSection, at('fog.brushSize'), FOG_BRUSH_SIZES.min, FOG_BRUSH_SIZES.max, 1);
    this.sizeInput = size.input;
    this.sizeValue = size.value;
    this.sizeInput.addEventListener('input', () => { this.actions.setBrushSize(Number(this.sizeInput.value)); this.refresh(); });
    this.breakIn(tools);
    this.coverButton = this.button(tools, 'cover', () => this.actions.cover(), () => this.coverTip(), at('fog.coverAll'));
    this.coverButton.dataset.fogAction = 'cover';
    this.deleteButton = this.button(tools, 'delete', () => this.actions.clear(), () => this.deleteTip(), at('fog.deleteAll'));
    this.deleteButton.dataset.fogAction = 'delete';
    this.breakIn(tools);
    // More: the fog's opacity in the GM's view, the two switches a keyboard holds a key for, and hiding every room.
    const moreMenu = el('div', 'atlas-dropdown-menu atlas-tabletop-fog-popover-anchor', tools);
    const moreWrap = el('div', 'atlas-tool-button', moreMenu);
    const moreSpan = el('span', '', moreWrap);
    moreSpan.setCssStyles({ display: 'inline-flex' });
    this.moreButton = el('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button', moreSpan);
    this.moreButton.type = 'button';
    this.moreButton.dataset.fogPopover = 'more';
    this.moreButton.setAttribute('aria-label', at('fog.more'));
    this.moreButton.setAttribute('aria-haspopup', 'menu');
    this.moreButton.setAttribute('aria-expanded', 'false');
    setSvg(this.moreButton, fogIcon('more'));
    this.moreButton.addEventListener('click', () => this.toggle('more'));
    this.tooltip.attach(moreSpan, () => ({ label: at('fog.more') }));
    this.morePanel = this.popover(moreMenu, 'more', 'right');
    const opacitySection = el('div', 'atlas-dropdown-section', this.morePanel);
    const opacity = this.sliderRow(opacitySection, at('fog.gmOpacity'), Math.round(GM_FOG_OPACITY_RANGE.min * 100), Math.round(GM_FOG_OPACITY_RANGE.max * 100), 5);
    this.opacityRow = opacity.row;
    this.opacityInput = opacity.input;
    this.opacityValue = opacity.value;
    this.opacityInput.addEventListener('input', () => { this.actions.setGmOpacity(Number(this.opacityInput.value) / 100); this.sync(); });
    const switchSection = el('div', 'atlas-dropdown-section', this.morePanel);
    this.switchRow(switchSection, 'fogSnap', at('toolbar.snap'));
    this.switchRow(switchSection, 'fogConstrain', at('toolbar.constrain'));
    const roomsSection = el('div', 'atlas-dropdown-section', this.morePanel);
    this.roomsHolder = el('div', '', roomsSection);
    // Where the row cannot be used it says why, as Atlas's `LabelTooltip` does.
    this.tooltip.attach(this.roomsHolder, () => ({ label: this.roomsWhy() ?? at('fog.hideRooms') }));
    this.roomsItem = el('button', 'btn btn--ghost btn--sm atlas-dropdown-menu-item atlas-dropdown-menu-item--flush', this.roomsHolder);
    this.roomsItem.type = 'button';
    this.roomsItem.dataset.fogAction = 'rooms';
    const roomsIcon = el('span', '', this.roomsItem);
    setSvg(roomsIcon, fogIcon('rooms'));
    el('span', '', this.roomsItem, at('fog.hideRooms'));
    this.roomsItem.addEventListener('click', () => { this.actions.hideRooms(); this.closePopovers(); });
  }

  private state(): ReturnType<FogBarActions['state']> {
    return this.actions.state();
  }

  /** A bar button as Atlas's `ToolButton` makes it: a wrapper, a span and the button, its tooltip on the span. */
  private button(parent: HTMLElement, icon: FogIconId, onClick: () => void, spec: () => { label: string; subtitle?: string; shortcut?: string }, label: string, choice = false): HTMLButtonElement {
    const wrapper = this.el('div', 'atlas-tool-button', parent);
    const span = this.el('span', '', wrapper);
    span.setCssStyles({ display: 'inline-flex' });
    const made = this.el('button', `btn btn--toolbar btn--icon atlas-tabletop-tool-button${choice ? ' atlas-tool-bar__choice' : ''}`, span);
    made.type = 'button';
    made.setAttribute('aria-label', label);
    setSvg(made, fogIcon(icon));
    made.addEventListener('click', () => { if (made.getAttribute('aria-disabled') !== 'true') onClick(); });
    this.tooltip.attach(span, spec);
    return made;
  }

  private breakIn(parent: HTMLElement): void {
    this.el('span', 'atlas-tool-bar__break', parent).setAttribute('aria-hidden', 'true');
  }

  private popover(menu: HTMLElement, name: 'size' | 'more', align: 'center' | 'right'): HTMLElement {
    const alignClass = align === 'right' ? 'atlas-dropdown-content--right' : 'atlas-tabletop-fog-popover--center';
    const panel = this.el('div', `atlas-dropdown-content atlas-dropdown-content--top ${alignClass} atlas-tabletop-fog-popover atlas-tabletop-fog-popover--${name}`, menu);
    panel.hidden = true;
    panel.setAttribute('role', 'menu');
    panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    panel.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.closePopovers(); }
    });
    return panel;
  }

  /** Atlas's `DropdownSliderRow`: the name and the value over the track. */
  private sliderRow(parent: HTMLElement, label: string, min: number, max: number, step: number): { row: HTMLElement; input: HTMLInputElement; value: HTMLElement } {
    const row = this.el('div', 'atlas-dropdown-slider-row', parent);
    const head = this.el('div', 'atlas-dropdown-slider-row__head', row);
    this.el('span', 'atlas-dropdown-label', head, label);
    const value = this.el('span', 'atlas-dropdown-slider-row__value', head, '');
    const input = this.el('input', 'atlas-tabletop-palette__range', row);
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.setAttribute('aria-label', label);
    return { row, input, value };
  }

  /** Atlas's `ToolSwitchRow` / `DropdownToggleRow`: a row with a switch that its text names. */
  private switchRow(parent: HTMLElement, id: 'fogSnap' | 'fogConstrain', label: string): void {
    const row = this.el('div', 'atlas-dropdown-toggle-row', parent);
    const text = this.el('span', 'atlas-dropdown-toggle-row__label', row, label);
    text.id = `atlas-tabletop-fog-${id}`;
    const toggle = this.el('div', 'atlas-toggle', row);
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-labelledby', text.id);
    toggle.tabIndex = 0;
    toggle.dataset.fogSwitch = id;
    const flip = (): void => { this.actions.setSwitch(id, !this.actions.switchOn(id)); this.sync(); };
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      flip();
    });
    this.switches.set(id, toggle);
  }

  private unavailable(shape: FogShape): string | null {
    if (shape === 'cells' && this.actions.cellSize() <= 0) return at('fog.cellsNeedGrid');
    if (shape === 'room' && !this.actions.hasWalls()) return this.actions.levelled() ? at('fog.roomNeedsLevelWalls') : at('fog.roomNeedsWalls');
    return null;
  }

  private coverTip(): { label: string; subtitle: string } {
    const offered = this.actions.offers().cover;
    return { label: at('fog.coverAll'), subtitle: offered ? (this.actions.levelled() ? at('fog.coverLevelTip') : at('fog.coverAllTip')) : t('fog.needsNewerAtlas') };
  }

  private deleteTip(): { label: string; subtitle: string } {
    const levelled = this.actions.levelled();
    const subtitle = !this.actions.offers().clear ? t('fog.needsNewerAtlas')
      : this.actions.anyFog() ? (levelled ? at('fog.deleteLevelTip') : at('fog.deleteAllTip'))
        : (levelled ? at('fog.noFogOnLevel') : at('fog.noFog'));
    return { label: at('fog.deleteAll'), subtitle };
  }

  private toggle(name: 'size' | 'more'): void {
    if (this.open === name) { this.closePopovers(); return; }
    this.closePopovers();
    this.tooltip.hide();
    const panel = name === 'size' ? this.sizePanel : this.morePanel;
    const trigger = name === 'size' ? this.sizeButton : this.moreButton;
    panel.hidden = false;
    trigger.classList.add('atlas-is-active');
    trigger.setAttribute('aria-expanded', 'true');
    this.open = name;
    this.sync();
    this.panel.ownerDocument.addEventListener('keydown', this.onKey, true);
    this.onPopover(true);
  }

  /** Closes whichever popover is open, leaving the bars. */
  closePopovers(): void {
    if (this.open === null) return;
    const name = this.open;
    this.open = null;
    (name === 'size' ? this.sizePanel : this.morePanel).hidden = true;
    const trigger = name === 'size' ? this.sizeButton : this.moreButton;
    trigger.classList.remove('atlas-is-active');
    trigger.setAttribute('aria-expanded', 'false');
    this.panel.ownerDocument.removeEventListener('keydown', this.onKey, true);
    this.onPopover(false);
  }

  /** A press outside the bars' popovers closes the one that is open. */
  pressed(target: Node): void {
    if (this.open === null) return;
    const panel = this.open === 'size' ? this.sizePanel : this.morePanel;
    const trigger = this.open === 'size' ? this.sizeButton : this.moreButton;
    if (!panel.contains(target) && !trigger.contains(target)) this.closePopovers();
  }

  get popoverOpen(): boolean {
    return this.open !== null;
  }

  /** Shows or hides the bars (`show`: the tool is on, in Edit mode, with no other panel open) and brings every control up to date. */
  show(show: boolean): void {
    if (!show) {
      this.closePopovers();
      if (!this.panel.hidden) this.tooltip.hide();
    }
    this.panel.hidden = !show;
    if (show) this.sync();
  }

  private disable(button: HTMLElement, disabled: boolean): void {
    button.classList.toggle('atlas-tool-button--disabled', disabled);
    if (disabled) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
  }

  /** Brings the controls up to date with the tool's choices and the map. */
  sync(): void {
    const state = this.state();
    for (const [mode, button] of this.modeButtons) {
      button.classList.toggle('is-active', mode === state.mode);
      button.setAttribute('aria-pressed', String(mode === state.mode));
    }
    // A shape that can no longer be chosen (the map lost its grid, the level its walls) gives way to the first one.
    if (this.unavailable(state.shape) !== null) this.actions.setShape(DEFAULT_FOG_TOOL.shape);
    const shape = this.state().shape;
    for (const [one, button] of this.shapeButtons) {
      button.classList.toggle('is-active', one === shape);
      button.setAttribute('aria-pressed', String(one === shape));
      this.disable(button, this.unavailable(one) !== null);
    }
    const brush = shape === 'brush';
    if (!brush && this.open === 'size') this.closePopovers();
    this.disable(this.sizeButton, !brush);
    const size = this.state().brushSize;
    const share = (size - FOG_BRUSH_SIZES.min) / (FOG_BRUSH_SIZES.max - FOG_BRUSH_SIZES.min);
    const dot = Math.round(SIZE_DOT.min + share * (SIZE_DOT.max - SIZE_DOT.min));
    this.sizeDot.style.width = `${dot}px`;
    this.sizeDot.style.height = `${dot}px`;
    if (this.sizeInput.value !== String(size)) this.sizeInput.value = String(size);
    const cell = this.actions.cellSize();
    this.sizeValue.textContent = cell > 0 ? at('fog.cellCount', { count: Math.round((20 * size) / cell) / 10 }) : '';
    const offers = this.actions.offers();
    this.disable(this.coverButton, !offers.cover);
    this.disable(this.deleteButton, !offers.clear || !this.actions.anyFog());
    const opacity = this.actions.gmOpacity();
    this.opacityRow.classList.toggle('atlas-dropdown-slider-row--disabled', opacity === null);
    this.opacityInput.disabled = opacity === null;
    this.opacityRow.title = opacity === null ? t('fog.needsNewerAtlas') : '';
    const percent = Math.round((opacity ?? DEFAULT_GM_FOG_OPACITY) * 100);
    if (this.opacityInput.value !== String(percent)) this.opacityInput.value = String(percent);
    this.opacityValue.textContent = `${percent}%`;
    for (const [id, toggle] of this.switches) {
      const on = this.actions.switchOn(id);
      toggle.setAttribute('aria-checked', String(on));
      const state2 = on ? 'on' : 'off';
      toggle.replaceChildren();
      const sw = this.el('div', `atlas-toggle__switch atlas-toggle__switch--${state2}`, toggle);
      const thumb = this.el('div', `atlas-toggle__thumb atlas-toggle__thumb--${state2}`, sw);
      setSvg(thumb, fogIcon(on ? 'on' : 'off'));
    }
    const rooms = this.actions.hasWalls() && offers.hideRooms;
    this.roomsItem.disabled = !rooms;
  }

  /** Why Hide all rooms cannot be used now, or null. */
  private roomsWhy(): string | null {
    if (!this.actions.offers().hideRooms) return t('fog.needsNewerAtlas');
    if (!this.actions.hasWalls()) return this.actions.levelled() ? at('fog.roomNeedsLevelWalls') : at('fog.roomNeedsWalls');
    return null;
  }

  dispose(): void {
    this.panel.ownerDocument.removeEventListener('keydown', this.onKey, true);
  }
}
