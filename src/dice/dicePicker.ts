/**
 * The GM's dice picker on the board, opened from the toolbar's Dice button, laid out like Interactive Dice's controls
 * panel in Atlas's menu look: a count per die type (click or + adds one, − takes one off), a die's colour from its
 * right-click, a flat modifier, Clear, and Roll (a gentle toss). A die (or Roll) dragged out of the picker onto the
 * board is thrown the way the pointer went. Plain DOM; what it picks is `pickedRequest`, which is pure.
 */
import { DIE_TYPES, type DieType } from './kit/faces';
import { defaultDie, MAX_DICE, type DiceRules, type RollRequest } from './rollRules';
import { DRAG_PX, FLICK_MS, GENTLE, type Flick } from './throwInput';

/** What the picker holds: how many of each die, the modifier, and the colour a die type is thrown in. */
export interface Pick {
  counts: Partial<Record<DieType, number>>;
  modifier: number;
  colors: Partial<Record<DieType, string>>;
}

export const MODIFIER_LIMIT = 99;

/** The picker's dice in Atlas's order: the percentile die last. */
const PICKER_DICE: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

export function emptyPick(): Pick {
  return { counts: {}, modifier: 0, colors: {} };
}

const pickedCount = (pick: Pick): number => DIE_TYPES.reduce((sum, die) => sum + (pick.counts[die] ?? 0), 0);

/** One more (or fewer) of a die: never below none, never more than 20 dice in all. */
export function stepDie(pick: Pick, die: DieType, delta: 1 | -1): Pick {
  const now = pick.counts[die] ?? 0;
  if (delta > 0 && pickedCount(pick) >= MAX_DICE) return pick;
  const next = Math.max(0, now + delta);
  const counts = { ...pick.counts };
  if (next === 0) delete counts[die];
  else counts[die] = next;
  return { ...pick, counts };
}

export function stepModifier(pick: Pick, delta: 1 | -1): Pick {
  return { ...pick, modifier: Math.max(-MODIFIER_LIMIT, Math.min(MODIFIER_LIMIT, pick.modifier + delta)) };
}

/** The roll the picker throws: the dice picked, else one of the collection's default die (a d20 failing that). */
export function pickedRequest(pick: Pick, rules: DiceRules): RollRequest {
  const dice = pickedCount(pick) > 0 ? { ...pick.counts } : { [defaultDie(rules) ?? 'd20']: 1 };
  const colors: Partial<Record<DieType, string>> = {};
  for (const die of Object.keys(dice) as DieType[]) if (pick.colors[die]) colors[die] = pick.colors[die];
  return { dice, modifier: pick.modifier, ...(Object.keys(colors).length > 0 ? { colors } : {}) };
}

/** `2d6+1d20+3`: the picked dice and the modifier, as the formula bar shows them. */
export function pickFormula(pick: Pick): string {
  const dice = PICKER_DICE.filter((die) => pick.counts[die]).map((die) => `${pick.counts[die]}${die}`).join('+');
  const modifier = pick.modifier === 0 ? '' : `${pick.modifier > 0 ? '+' : '−'}${Math.abs(pick.modifier)}`;
  return `${dice}${modifier}`;
}

export interface DicePickerOptions {
  onRoll(request: RollRequest, flick: Flick): void;
  onClear(): void;
  colors: () => { name: string; color: string }[];
  /** The rules of the board's map: Roll with nothing picked throws its default die. */
  rules: () => DiceRules;
  /** The picker opened or closed (the toolbar's button follows). */
  onOpenChange?(open: boolean): void;
}

/** Lucide's `dices` (ISC): the toolbar's Dice button. */
export const DICES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></svg>';
const MINUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';


export class DicePicker {
  private pick: Pick = emptyPick();
  private readonly panel: HTMLElement;
  private readonly badges = new Map<DieType, HTMLElement>();
  private readonly dieButtons = new Map<DieType, HTMLButtonElement>();
  private readonly modifierValue: HTMLElement;
  private readonly formula: HTMLElement;
  private readonly swatches: HTMLElement;
  private swatchesFor: DieType | null = null;
  private readonly stops: Array<() => void> = [];
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    // The Dice button toggles the picker itself.
    if (!this.panel.contains(target) && !this.panel.parentElement?.contains(target)) this.close();
  };

  constructor(private readonly parent: HTMLElement, private readonly opts: DicePickerOptions) {
    const doc = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
      const made = doc.createElement(tag);
      made.className = className;
      if (text !== undefined) made.textContent = text;
      into.appendChild(made);
      return made;
    };
    const iconButton = (into: HTMLElement, svg: string, label: string, onClick: () => void): HTMLButtonElement => {
      const made = el('button', 'btn btn--ghost btn--icon btn--sm atlas-tabletop-dice-step', into);
      made.type = 'button';
      made.innerHTML = svg;
      made.setAttribute('aria-label', label);
      made.title = label;
      made.addEventListener('click', onClick);
      return made;
    };
    this.panel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-tabletop-dice-picker', parent);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Dice');

    const diceSection = el('div', 'atlas-dropdown-section', this.panel);
    el('span', 'atlas-dropdown-label', diceSection, 'Dice');
    const grid = el('div', 'atlas-tabletop-dice-grid', diceSection);
    for (const die of PICKER_DICE) {
      const cell = el('div', 'atlas-tabletop-dice-cell', grid);
      const button = el('button', 'btn btn--ghost atlas-tabletop-dice-die', cell);
      button.type = 'button';
      button.dataset.die = die;
      button.setAttribute('aria-label', `${die}: click to add, right-click for its colour, drag onto the board to throw`);
      button.title = `${die}: click to add · right-click: colour · drag onto the board: throw`;
      el('span', 'atlas-tabletop-dice-die__name', button, die);
      this.badges.set(die, el('span', 'atlas-tabletop-dice-die__badge', button));
      this.dieButtons.set(die, button);
      this.throwable(button, () => this.add(die, 1), () => {
        // Dragged out: the picked roll, with this die in it.
        const pick = this.pick.counts[die] ? this.pick : stepDie(this.pick, die, 1);
        return pickedRequest(pick, this.opts.rules());
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.showSwatches(die, button);
      });
      const steps = el('div', 'atlas-tabletop-dice-steps', cell);
      iconButton(steps, MINUS_SVG, `One fewer ${die}`, () => this.add(die, -1));
      iconButton(steps, PLUS_SVG, `One more ${die}`, () => this.add(die, 1));
    }
    this.swatches = el('div', 'atlas-tabletop-dice-swatches', diceSection);
    this.swatches.hidden = true;

    const modifierSection = el('div', 'atlas-dropdown-section', this.panel);
    const modifierRow = el('div', 'atlas-tabletop-dice-modifier', modifierSection);
    el('span', 'atlas-dropdown-label', modifierRow, 'Modifier');
    iconButton(modifierRow, MINUS_SVG, 'Lower the modifier', () => this.change(stepModifier(this.pick, -1)));
    this.modifierValue = el('span', 'atlas-tabletop-dice-modifier__value', modifierRow);
    iconButton(modifierRow, PLUS_SVG, 'Raise the modifier', () => this.change(stepModifier(this.pick, 1)));

    const bar = el('div', 'atlas-dropdown-section atlas-tabletop-dice-bar', this.panel);
    this.formula = el('span', 'atlas-tabletop-dice-formula', bar);
    const clear = iconButton(bar, TRASH_SVG, 'Clear the dice', () => {
      this.change(emptyPick());
      this.opts.onClear();
    });
    clear.classList.add('atlas-tabletop-dice-clear');
    const roll = el('button', 'btn btn--primary btn--sm atlas-tabletop-dice-roll', bar, 'Roll');
    roll.type = 'button';
    roll.title = 'Roll · drag onto the board to throw';
    this.throwable(roll, () => this.opts.onRoll(this.request(), GENTLE), () => this.request());
    el('div', 'atlas-dropdown-swatches__hint atlas-tabletop-dice-hint', this.panel, 'Drag a die onto the board to throw it. Click a die caught on an edge to throw it again.');

    // Presses and keys here are not the board's: no camera drag, no camera keys.
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    // Escape closes it, from the picker or from the button that opened it.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    this.panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') escape(event); else event.stopPropagation(); });
    parent.addEventListener('keydown', escape);
    this.stops.push(() => parent.removeEventListener('keydown', escape));
    this.show();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.show();
    this.panel.hidden = false;
    this.parent.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
    this.opts.onOpenChange?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.hideSwatches();
    this.parent.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
    this.opts.onOpenChange?.(false);
  }

  /** What Roll throws now. */
  request(): RollRequest {
    return pickedRequest(this.pick, this.opts.rules());
  }

  dispose(): void {
    this.close();
    for (const stop of this.stops) stop();
    this.panel.remove();
  }

  private add(die: DieType, delta: 1 | -1): void {
    const next = stepDie(this.pick, die, delta);
    if (next === this.pick) {
      // Full: the die says so for a moment.
      const button = this.dieButtons.get(die);
      button?.classList.add('is-at-limit');
      this.parent.ownerDocument.defaultView?.setTimeout(() => button?.classList.remove('is-at-limit'), 1200);
      return;
    }
    this.change(next);
  }

  private change(pick: Pick): void {
    this.pick = pick;
    this.show();
  }

  private show(): void {
    for (const die of DIE_TYPES) {
      const count = this.pick.counts[die] ?? 0;
      const badge = this.badges.get(die)!;
      badge.textContent = count > 0 ? String(count) : '';
      badge.hidden = count === 0;
      const button = this.dieButtons.get(die)!;
      button.classList.toggle('is-selected', count > 0);
      const color = this.pick.colors[die];
      button.style.setProperty('--atlas-tabletop-die-color', color ?? 'transparent');
      button.classList.toggle('has-color', color !== undefined);
    }
    this.modifierValue.textContent = `${this.pick.modifier > 0 ? '+' : this.pick.modifier < 0 ? '−' : ''}${Math.abs(this.pick.modifier)}`;
    const formula = pickFormula(this.pick);
    this.formula.textContent = formula ? `${formula} · ${pickedCount(this.pick)}/${MAX_DICE}` : `No dice: Roll throws a ${defaultDie(this.opts.rules()) ?? 'd20'}`;
  }

  /** The colours a die can be thrown in, under the dice; the pack's own colour first. */
  private showSwatches(die: DieType, button: HTMLElement): void {
    if (this.swatchesFor === die && !this.swatches.hidden) { this.hideSwatches(); return; }
    const doc = this.parent.ownerDocument;
    this.swatchesFor = die;
    this.swatches.replaceChildren();
    const label = doc.createElement('span');
    label.className = 'atlas-dropdown-swatches__label';
    label.textContent = `${die} colour`;
    this.swatches.appendChild(label);
    const grid = doc.createElement('div');
    grid.className = 'atlas-swatch-grid';
    this.swatches.appendChild(grid);
    const swatch = (color: string | undefined, name: string): void => {
      const made = doc.createElement('button');
      made.type = 'button';
      made.className = `atlas-swatch${color ? '' : ' atlas-tabletop-dice-swatch--pack'}`;
      if (color) made.style.backgroundColor = color;
      made.setAttribute('aria-label', `${name} ${die}`);
      made.title = name;
      const chosen = this.pick.colors[die] === color;
      made.classList.toggle('atlas-swatch--active', chosen);
      made.setAttribute('aria-pressed', String(chosen));
      made.addEventListener('click', () => {
        const colors = { ...this.pick.colors };
        if (color) colors[die] = color;
        else delete colors[die];
        this.change({ ...this.pick, colors });
        this.hideSwatches();
        button.focus();
      });
      grid.appendChild(made);
    };
    swatch(undefined, "The pack's colour");
    for (const entry of this.opts.colors()) swatch(entry.color, entry.name);
    this.swatches.hidden = false;
  }

  private hideSwatches(): void {
    this.swatches.hidden = true;
    this.swatchesFor = null;
  }

  /**
   * A press on `element`: a click runs `click`; a drag let go outside the picker throws `request()` with the
   * pointer's flick (its last stretch of movement before letting go).
   */
  private throwable(element: HTMLElement, click: () => void, request: () => RollRequest): void {
    let press: { id: number; x: number; y: number; dragged: boolean; samples: Array<{ x: number; y: number; t: number }> } | null = null;
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      press = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false, samples: [{ x: event.clientX, y: event.clientY, t: event.timeStamp }] };
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.id) return;
      press.samples.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
      if (press.samples.length > 32) press.samples.shift();
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > DRAG_PX) press.dragged = true;
      element.classList.toggle('is-dragging', press.dragged);
    };
    const up = (event: PointerEvent): void => {
      if (!press || event.pointerId !== press.id) return;
      const done = press;
      press = null;
      element.classList.remove('is-dragging');
      if (!done.dragged) { click(); return; }
      const rect = this.panel.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (inside) return;
      const last = { x: event.clientX, y: event.clientY, t: event.timeStamp };
      const from = done.samples.find((sample) => last.t - sample.t <= FLICK_MS) ?? last;
      this.opts.onRoll(request(), { dx: last.x - from.x, dy: last.y - from.y, ms: Math.max(1, last.t - from.t) });
    };
    const cancel = (): void => {
      press = null;
      element.classList.remove('is-dragging');
    };
    // The press is the picker's own: a click is told apart from a drag here, so the button's click event is not used.
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', cancel);
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      click();
    });
    this.stops.push(() => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', cancel);
    });
  }
}
