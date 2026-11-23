/**
 * The popover of a kept measurement the GM edits (Atlas's `MeasurePopover.tsx`, `MeasureLook.tsx`, `SwitchRow.tsx`), in Atlas's
 * markup and classes, beside its handle on the board. What it holds, top to bottom: its colour, an area's look (the effect
 * chips), its switches (players see it; an area's also whether walls stop it; a line's width) and, last, what is done with it:
 * an area's tokens selected, and the measurement deleted. Every control writes at once, one undo step each.
 *
 * It is one popover: opening another measurement moves it there. Left out of Atlas's: the light an area gives and its
 * flicker, and a circle that follows the token it lies on (`docs/BACKLOG.md`).
 */
import { MAX_LINE_WIDTH, MEASURE_COLOR_SWATCHES, MEASURE_EFFECTS, colourWithEffect, measureColorOfSwatch, swatchOfMeasureColor, type MeasureEffect } from './measureOptions';
import type { MeasureRecord } from '../../packages/atlas-host/src/spellMeasure';
import { t } from '../i18n';
import { setSvg } from '../svg';
import { atlasMeasureControlIcon, atlasMeasureEffectIcon } from './atlasToolIcons';

const CHECK_SVG = '<svg class="atlas-swatch-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const MINUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const POINTER_CLICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/></svg>';

/** What the popover reads of the board and writes to it. */
export interface MeasurePopoverDeps {
  /** The map's cell size, map pixels. */
  cell(): number;
  /** Atlas can change a kept measurement (its `updateMeasure`); without, the popover has the Delete only. */
  canUpdate(): boolean;
  update(id: string, changes: Record<string, unknown>): void;
  remove(id: string): void;
  /** How many tokens lie in the area, and the selecting of them. */
  tokensIn(id: string): number;
  selectTokens(id: string): void;
  /** The line's width has been chosen (cells): the tool makes its next line as wide. */
  lineWidthChosen(cells: number): void;
  /** A width in cells, written as the board writes a distance. */
  distanceText(cells: number): string;
  close(): void;
}


function make<K extends keyof HTMLElementTagNameMap>(parent: Element | null, tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const doc = (parent?.ownerDocument ?? document) as Document;
  const made = doc.createElement(tag);
  if (cls) made.className = cls;
  if (text !== undefined) made.textContent = text;
  parent?.appendChild(made);
  return made;
}

let nextId = 0;

export class MeasurePopover {
  /** The element that stands over the board: Tabletop's root, inside which Atlas's restated styles hold. */
  readonly element: HTMLElement;
  private readonly panel: HTMLElement;
  private shownId: string | null = null;
  private shownKey = '';

  constructor(private readonly parent: HTMLElement, private readonly deps: MeasurePopoverDeps) {
    this.element = make(parent, 'div', 'atlas-tabletop-atlas atlas-tabletop-atlas-ui atlas-tabletop-measure-popover');
    this.element.hidden = true;
    this.panel = make(this.element, 'section', 'atlas-light-popover atlas-measure-popover');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', t('measure.popover'));
    this.panel.tabIndex = -1;
    this.panel.addEventListener('keydown', (event) => this.key(event));
    // A press in it is its own: the board hears none of it.
    for (const type of ['pointerdown', 'pointerup', 'click', 'contextmenu', 'wheel'] as const) this.panel.addEventListener(type, (event) => event.stopPropagation());
  }

  get id(): string | null {
    return this.shownId;
  }

  get isOpen(): boolean {
    return this.shownId !== null;
  }

  contains(target: EventTarget | null): boolean {
    return target instanceof Node && this.panel.contains(target);
  }

  /** Shows the popover of measurement `id` as it is now (`record`); built again only when the measurement is another or has changed. */
  show(id: string, record: MeasureRecord & Record<string, unknown>): void {
    const key = JSON.stringify([id, record.shape, record.color, record.effect, record.hidden, record.walls, record.width, this.deps.canUpdate(), this.deps.tokensIn(id)]);
    const moved = this.shownId !== id;
    this.shownId = id;
    this.element.hidden = false;
    if (key === this.shownKey) return;
    this.shownKey = key;
    // A control being used keeps its focus through the rebuild its own write causes.
    const focus = this.panel.ownerDocument.activeElement;
    const restore = focus instanceof HTMLElement && this.panel.contains(focus) ? focus.dataset.control ?? null : null;
    this.panel.replaceChildren();
    this.build(id, record);
    if (restore) this.panel.querySelector<HTMLElement>(`[data-control="${restore}"]`)?.focus();
    else if (moved) this.panel.focus({ preventScroll: true });
  }

  hide(): void {
    this.shownId = null;
    this.shownKey = '';
    this.element.hidden = true;
    this.panel.replaceChildren();
  }

  /** Puts the popover beside its handle at screen point (`x`, `y`) of the board (pixels from the board's top left), kept inside `area` and clear of `inset`. */
  place(x: number, y: number, area: { width: number; height: number }, inset: { top: number; bottom: number }): void {
    const width = this.panel.offsetWidth || 272;
    const height = this.panel.offsetHeight || 200;
    const gap = 12 + 10;
    const margin = 8;
    // Right of the badge where there is room, else left; level with it, kept in the free part of the board.
    let left = x + gap;
    if (left + width > area.width - margin) left = x - gap - width;
    left = Math.max(margin, Math.min(area.width - width - margin, left));
    const top = Math.max(inset.top + margin, Math.min(area.height - inset.bottom - height - margin, y - 20));
    this.panel.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      this.deps.close();
      return;
    }
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]') !== null;
    if ((event.key === 'Delete' || event.key === 'Backspace') && !typing && this.shownId !== null) {
      event.stopPropagation();
      event.preventDefault();
      this.deps.remove(this.shownId);
      return;
    }
    // Keys its controls use themselves never reach the board's shortcuts.
    if ([' ', 'Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) event.stopPropagation();
  }

  private build(id: string, record: MeasureRecord & Record<string, unknown>): void {
    const { deps } = this;
    const area = record.shape !== 'ruler';
    const color = typeof record.color === 'string' ? record.color : null;
    if (deps.canUpdate()) {
      this.swatches(id, color);
      if (area) this.effects(id, record, color);
      const section = make(this.panel, 'div', 'atlas-light-popover__section');
      this.switchRow(section, t('toolbar.measurePlayers'), 'players', record.hidden !== true, (players) => deps.update(id, { hidden: players ? undefined : true }));
      if (area) this.switchRow(section, t('measure.stopsAtWalls'), 'walls', record.walls !== false, (stops) => deps.update(id, { walls: stops ? undefined : false }));
      if (record.shape === 'line') this.lineWidth(section, id, record);
    } else {
      make(this.panel, 'p', 'atlas-light-popover__hint', t('measure.needsNewerAtlas'));
    }
    const actions = make(this.panel, 'div', 'atlas-light-popover__section atlas-light-popover__actions');
    if (area) this.selectTokens(actions, id); else make(actions, 'span');
    const remove = make(actions, 'button', 'btn btn--ghost btn--sm atlas-light-popover__delete');
    remove.type = 'button';
    remove.dataset.control = 'delete';
    setSvg(remove, atlasMeasureControlIcon('trash'));
    make(remove, 'span', '', t('common.delete'));
    remove.addEventListener('click', () => deps.remove(id));
  }

  private swatches(id: string, color: string | null): void {
    const group = make(this.panel, 'div', 'atlas-dropdown-swatches');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t('toolbar.colour'));
    const grid = make(group, 'div', 'atlas-swatch-grid');
    const chosen = swatchOfMeasureColor(color).toLowerCase();
    for (const swatch of MEASURE_COLOR_SWATCHES) {
      const label = t(swatch.labelKey);
      const button = make(grid, 'button', 'atlas-swatch');
      button.type = 'button';
      button.style.backgroundColor = swatch.value;
      button.dataset.swatch = swatch.value;
      button.dataset.control = `swatch-${swatch.value}`;
      button.title = label;
      button.setAttribute('aria-label', label);
      const active = swatch.value.toLowerCase() === chosen;
      button.classList.toggle('atlas-swatch--active', active);
      button.setAttribute('aria-pressed', String(active));
      if (active) setSvg(button, CHECK_SVG);
      button.addEventListener('click', () => this.deps.update(id, { color: measureColorOfSwatch(swatch.value) ?? undefined }));
    }
  }

  private effects(id: string, record: MeasureRecord & Record<string, unknown>, color: string | null): void {
    const effect = (MEASURE_EFFECTS as readonly string[]).includes(record.effect as string) ? (record.effect as MeasureEffect) : null;
    const chips = make(this.panel, 'div', 'atlas-light-popover__kinds atlas-light-popover__kinds--square');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', t('measure.effect'));
    chips.style.setProperty('--atlas-light-badge', 'var(--background-primary)');
    chips.style.setProperty('--atlas-light-tint', color ?? 'var(--interactive-accent)');
    const names: Record<MeasureEffect, string> = {
      fire: t('measure.effect.fire'), frost: t('measure.effect.frost'), lightning: t('measure.effect.lightning'),
      mist: t('measure.effect.mist'), radiance: t('measure.effect.radiance'), shadow: t('measure.effect.shadow'),
    };
    for (const choice of [null, ...MEASURE_EFFECTS] as const) {
      const name = choice ? names[choice] : t('measure.effect.none');
      const button = make(chips, 'button', 'atlas-light-kind');
      button.type = 'button';
      button.dataset.measureEffect = choice ?? 'none';
      button.dataset.control = `effect-${choice ?? 'none'}`;
      button.title = name;
      button.setAttribute('aria-label', name);
      button.setAttribute('aria-pressed', String(choice === effect));
      setSvg(button, atlasMeasureEffectIcon(choice ?? 'none'));
      // Atlas's `effectChoice` (without the light the board has no way to give): the look with the colour it starts with; none takes the look away.
      button.addEventListener('click', () => this.deps.update(id, choice === null ? { effect: undefined } : { effect: choice, color: colourWithEffect(color, effect, choice) ?? undefined }));
    }
  }

  private switchRow(parent: HTMLElement, label: string, name: string, value: boolean, onChange: (value: boolean) => void): void {
    const row = make(parent, 'div', 'atlas-light-popover__flicker');
    const labelId = `atlas-tabletop-measure-switch-${nextId++}`;
    const text = make(row, 'span', '', label);
    text.id = labelId;
    const state = value ? 'on' : 'off';
    const toggle = make(row, 'div', 'atlas-toggle');
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(value));
    toggle.setAttribute('aria-labelledby', labelId);
    toggle.dataset.control = `switch-${name}`;
    toggle.tabIndex = 0;
    const track = make(toggle, 'div', `atlas-toggle__switch atlas-toggle__switch--${state}`);
    make(track, 'div', `atlas-toggle__thumb atlas-toggle__thumb--${state}`);
    const flip = (): void => onChange(!value);
    toggle.addEventListener('click', flip);
    toggle.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      flip();
    });
  }

  /** How wide a line is, in whole cells. */
  private lineWidth(parent: HTMLElement, id: string, record: MeasureRecord & Record<string, unknown>): void {
    const cell = this.deps.cell();
    const wide = typeof record.width === 'number' && record.width > 0 ? record.width : cell;
    const cells = cell > 0 ? Math.min(MAX_LINE_WIDTH, Math.max(1, Math.round(wide / cell))) : 1;
    const row = make(parent, 'div', 'atlas-light-popover__flicker');
    const labelId = `atlas-tabletop-measure-width-${nextId++}`;
    make(row, 'span', '', t('measure.width')).id = labelId;
    const stepper = make(row, 'div', 'atlas-dungeon-stepper');
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-labelledby', labelId);
    const change = (next: number): void => {
      this.deps.update(id, { width: next * cell });
      this.deps.lineWidthChosen(next);
    };
    const step = (label: string, svg: string, next: number, off: boolean, control: string): void => {
      const button = make(stepper, 'button', 'btn btn--ghost btn--icon atlas-dungeon-stepper__button');
      button.type = 'button';
      button.title = label;
      button.dataset.control = control;
      button.setAttribute('aria-label', label);
      button.disabled = off || cell <= 0;
      setSvg(button, svg);
      button.addEventListener('click', () => change(next));
    };
    step(t('measure.narrower'), MINUS, cells - 1, cells <= 1, 'width-less');
    make(stepper, 'output', 'atlas-dungeon-stepper__value', this.deps.distanceText(cells)).setAttribute('aria-live', 'polite');
    step(t('measure.wider'), PLUS, cells + 1, cells >= MAX_LINE_WIDTH, 'width-more');
  }

  private selectTokens(parent: HTMLElement, id: string): void {
    const count = this.deps.tokensIn(id);
    const button = make(parent, 'button', 'btn btn--ghost btn--sm');
    button.type = 'button';
    button.dataset.control = 'select-tokens';
    button.disabled = count === 0;
    setSvg(button, POINTER_CLICK);
    make(button, 'span', '', t('measure.selectTokens'));
    if (count === 0) button.title = t('measure.noTokens');
    button.addEventListener('click', () => { this.deps.selectTokens(id); this.deps.close(); });
  }

  destroy(): void {
    this.element.remove();
  }
}


