/**
 * The GM's dice tray on the board, opened from the toolbar's Dice button: Atlas's own dice tray, in its look and with
 * its controls. A picture of each die (click adds one, the grip under it takes one back), right-click on a die for its
 * colours (how many of it in each, each added or taken back on its own), Normal / Advantage / Disadvantage when the
 * dice picked allow it, a modifier, the formula, Roll and Clear. Roll lays the dice on the table where the camera looks, for the GM to pick up and throw. Plain DOM; what
 * it picks is `pickedRequest`, which is pure.
 */
import { DIE_TYPES, type DieType } from './kit/faces';
import { defaultDie, MAX_DICE, type DiceRules, type RollRequest } from './rollRules';

export type AdvantageSide = NonNullable<RollRequest['advantage']>;

/** What the tray holds: each die picked, by type, in the colour it is thrown in (null: the pack's), the modifier and the side. */
export interface Pick {
  dice: Partial<Record<DieType, Array<string | null>>>;
  modifier: number;
  advantage?: AdvantageSide;
}

/** Atlas's tray: a modifier from −20 to +20, at most 20 of one die. */
export const MODIFIER_LIMIT = 20;
export const DIE_LIMIT = 20;

/** The tray's dice in Atlas's order: the percentile die last. */
const TRAY_DICE: readonly DieType[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100'];

export function emptyPick(): Pick {
  return { dice: {}, modifier: 0 };
}

/** How many of a die are picked: in every colour, or in `color` (null: the pack's) only. */
export function countOf(pick: Pick, die: DieType, color?: string | null): number {
  const picked = pick.dice[die] ?? [];
  return color === undefined ? picked.length : picked.filter((each) => each === color).length;
}

const pickedCount = (pick: Pick): number => DIE_TYPES.reduce((sum, die) => sum + countOf(pick, die), 0);

/**
 * One more of a die, in `color` (null: the pack's), or one fewer: of that colour when one is named, else the last one
 * added. Never below none, never more than 20 of a die or 20 dice in all.
 */
export function stepDie(pick: Pick, die: DieType, delta: 1 | -1, color?: string | null): Pick {
  const picked = pick.dice[die] ?? [];
  let next: Array<string | null>;
  if (delta > 0) {
    if (pickedCount(pick) >= MAX_DICE || picked.length >= DIE_LIMIT) return pick;
    next = [...picked, color ?? null];
  } else {
    const at = color === undefined ? picked.length - 1 : picked.lastIndexOf(color);
    if (at < 0) return pick;
    next = picked.filter((_each, index) => index !== at);
  }
  const dice = { ...pick.dice };
  if (next.length === 0) delete dice[die];
  else dice[die] = next;
  return { ...pick, dice };
}

export function stepModifier(pick: Pick, delta: 1 | -1): Pick {
  return { ...pick, modifier: Math.max(-MODIFIER_LIMIT, Math.min(MODIFIER_LIMIT, pick.modifier + delta)) };
}

/** Whether advantage or disadvantage applies to the dice picked: exactly one of the collection's default die. */
export function advantageApplies(pick: Pick, rules: DiceRules): boolean {
  const die = defaultDie(rules);
  return die !== null && countOf(pick, die) === 1 && pickedCount(pick) < MAX_DICE;
}

/** The roll the tray lays on the table; null with no dice picked (Roll is off, as in Atlas). */
export function pickedRequest(pick: Pick, rules: DiceRules): RollRequest | null {
  if (pickedCount(pick) === 0) return null;
  const dice: Partial<Record<DieType, number>> = {};
  const dieColors: Partial<Record<DieType, Array<string | null>>> = {};
  for (const die of DIE_TYPES) {
    const picked = pick.dice[die];
    if (!picked?.length) continue;
    dice[die] = picked.length;
    if (picked.some((color) => color !== null)) dieColors[die] = [...picked];
  }
  return {
    dice,
    modifier: pick.modifier,
    ...(Object.keys(dieColors).length > 0 ? { dieColors } : {}),
    ...(pick.advantage && advantageApplies(pick, rules) ? { advantage: pick.advantage } : {}),
  };
}

/** `2d6 + 1d20 + 3`, as Atlas's tray writes it; empty with no dice. */
export function pickFormula(pick: Pick): string {
  const dice = TRAY_DICE.filter((die) => countOf(pick, die) > 0).map((die) => `${countOf(pick, die)}${die}`);
  if (dice.length === 0) return '';
  const formula = dice.join(' + ');
  return pick.modifier === 0 ? formula : `${formula} ${pick.modifier < 0 ? '-' : '+'} ${Math.abs(pick.modifier)}`;
}

export interface DicePickerOptions {
  /** Roll: the dice to lay on the table. */
  onRoll(request: RollRequest): void;
  colors: () => { name: string; color: string }[];
  /** The rules of the board's map: whether advantage applies. */
  rules: () => DiceRules;
  /** A picture of a die of the chosen pack, or null (the button shows its name). */
  picture?(die: DieType): string | null;
  /** The tray opened or closed (the toolbar's button follows). */
  onOpenChange?(open: boolean): void;
}

/** Lucide's `dices` (ISC): the toolbar's Dice button. */
export const DICES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/></svg>';
/** Lucide's `minus` and `plus` (ISC). */
const MINUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

const SIDES: Array<{ value: AdvantageSide | 'normal'; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'advantage', label: 'Advantage' },
  { value: 'disadvantage', label: 'Disadvantage' },
];

export class DicePicker {
  private pick: Pick = emptyPick();
  /** Atlas's tray: positioned over its button by Atlas's own styles. */
  private readonly panel: HTMLElement;
  private readonly faces = new Map<DieType, HTMLButtonElement>();
  private readonly grips = new Map<DieType, HTMLElement>();
  private readonly sides: HTMLElement;
  private readonly sideButtons = new Map<string, HTMLButtonElement>();
  private readonly modifierValue: HTMLElement;
  private readonly lower: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly formula: HTMLElement;
  private readonly roll: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly swatches: HTMLElement;
  private swatchesFor: DieType | null = null;
  private readonly stops: Array<() => void> = [];
  private readonly onOutside = (event: PointerEvent): void => {
    const target = event.target as Node;
    // The Dice button toggles the tray itself.
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
    const button = (className: string, into: HTMLElement, label: string, onClick: () => void, text?: string): HTMLButtonElement => {
      const made = el('button', className, into, text);
      made.type = 'button';
      made.setAttribute('aria-label', label);
      made.addEventListener('click', onClick);
      return made;
    };
    this.panel = el('div', 'atlas-dice-tray atlas-tabletop-dice-picker', parent);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Dice');
    const content = el('div', 'atlas-dice-tray__content', el('div', 'atlas-dice-panel', this.panel));

    const dice = el('div', 'atlas-dice-tray__dice', content);
    for (const die of TRAY_DICE) {
      const cell = el('div', 'atlas-dice-tray__die', dice);
      const face = button('atlas-dice-tray__face', cell, `Add a ${die}`, () => this.change(stepDie(this.pick, die, 1)));
      face.dataset.die = die;
      face.title = `${die} · right-click: colour`;
      face.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        this.showSwatches(die, face);
      });
      this.faces.set(die, face);
      this.grips.set(die, cell);
    }
    this.swatches = el('div', 'atlas-tabletop-dice-swatches', content);
    this.swatches.hidden = true;

    this.sides = el('div', 'atlas-segmented atlas-segmented--fit atlas-dice-tray__advantage', content);
    this.sides.setAttribute('role', 'radiogroup');
    this.sides.setAttribute('aria-label', 'Advantage for the next roll');
    for (const side of SIDES) {
      const option = button('btn btn--ghost btn--sm atlas-segmented__option', this.sides, side.label, () => {
        if (this.sides.getAttribute('aria-disabled') === 'true') return;
        const { advantage: _gone, ...rest } = this.pick;
        this.change(side.value === 'normal' ? rest : { ...rest, advantage: side.value });
      }, side.label);
      option.setAttribute('role', 'radio');
      this.sideButtons.set(side.value, option);
    }

    const modifier = el('div', 'atlas-dice-tray__modifier', content);
    el('span', 'atlas-dice-tray__modifier-label', modifier, 'Modifier');
    this.lower = button('atlas-dice-tray__grip atlas-dice-tray__step', modifier, 'Decrease modifier', () => this.change(stepModifier(this.pick, -1)));
    this.lower.innerHTML = MINUS_SVG;
    this.modifierValue = el('span', 'atlas-dice-tray__modifier-value', modifier);
    this.raise = button('atlas-dice-tray__grip atlas-dice-tray__step', modifier, 'Increase modifier', () => this.change(stepModifier(this.pick, 1)));
    this.raise.innerHTML = PLUS_SVG;

    this.formula = el('p', 'atlas-dice-tray__formula', content);
    this.formula.setAttribute('role', 'status');
    this.formula.setAttribute('aria-live', 'polite');

    const actions = el('div', 'atlas-dice-tray__actions', content);
    this.roll = button('btn btn--default btn--sm atlas-dice-tray__roll', actions, 'Roll', () => {
      const request = pickedRequest(this.pick, this.opts.rules());
      if (!request) return;
      this.opts.onRoll(request);
      // As Atlas's tray: a roll made, the tray is empty again.
      this.change(emptyPick());
    }, 'Roll');
    this.clear = button('btn btn--outline btn--sm', actions, 'Clear', () => this.change(emptyPick()), 'Clear');

    // Presses and keys here are not the board's: no camera drag, no camera keys.
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    // Escape closes it, from the tray or from the button that opened it.
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
    this.keepInView();
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

  /** Atlas's tray stands centred over its button: moved sideways as far as it takes to stay inside the window. */
  private keepInView(): void {
    this.panel.style.removeProperty('--atlas-keep-in-view-x');
    const rect = this.panel.getBoundingClientRect();
    const width = this.parent.ownerDocument.defaultView?.innerWidth ?? rect.right;
    const shift = rect.right > width - 8 ? width - 8 - rect.right : rect.left < 8 ? 8 - rect.left : 0;
    if (shift !== 0) this.panel.style.setProperty('--atlas-keep-in-view-x', `${Math.round(shift)}px`);
  }

  /** What Roll lays on the table now; null with no dice picked. */
  request(): RollRequest | null {
    return pickedRequest(this.pick, this.opts.rules());
  }

  /** The dice's pictures were drawn (again). */
  refreshPictures(): void {
    this.show();
  }

  dispose(): void {
    this.close();
    for (const stop of this.stops) stop();
    this.panel.remove();
  }

  private change(pick: Pick): void {
    this.pick = pick;
    this.show();
    if (!this.swatches.hidden) this.drawSwatches();
  }

  private show(): void {
    const doc = this.parent.ownerDocument;
    const total = pickedCount(this.pick);
    for (const die of TRAY_DICE) {
      const count = countOf(this.pick, die);
      const face = this.faces.get(die)!;
      face.replaceChildren();
      const picture = this.opts.picture?.(die) ?? null;
      if (picture) {
        const img = doc.createElement('img');
        img.className = 'atlas-tabletop-die-picture';
        img.src = picture;
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.draggable = false;
        face.appendChild(img);
      } else {
        const name = doc.createElement('span');
        name.className = 'atlas-tabletop-dice-face-name';
        name.textContent = die;
        face.appendChild(name);
      }
      if (count > 0) {
        const badge = doc.createElement('span');
        badge.className = 'atlas-dice-tray__count';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = String(count);
        face.appendChild(badge);
      }
      // The colours picked for it, as a stripe of their shares under the picture (the pack's own leaves no mark).
      const picked = this.pick.dice[die] ?? [];
      const coloured = picked.some((each) => each !== null);
      face.classList.toggle('has-color', coloured);
      if (coloured) {
        const stops = picked.map((each, index) => `${each ?? 'transparent'} ${(index / picked.length) * 100}% ${((index + 1) / picked.length) * 100}%`);
        face.style.setProperty('--atlas-tabletop-die-colors', `linear-gradient(to right, ${stops.join(', ')})`);
      } else face.style.removeProperty('--atlas-tabletop-die-colors');
      face.disabled = count >= DIE_LIMIT || total >= MAX_DICE;
      face.setAttribute('aria-label', count === 0 ? `Add a ${die}` : `Add a ${die}, ${count} in the tray`);
      // Under each die: the grip that takes one back, or the space it would take.
      const cell = this.grips.get(die)!;
      cell.querySelector('.atlas-dice-tray__grip, .atlas-dice-tray__grip-space')?.remove();
      if (count > 0) {
        const grip = doc.createElement('button');
        grip.type = 'button';
        grip.className = 'atlas-dice-tray__grip';
        grip.setAttribute('aria-label', `Take one ${die} back`);
        grip.innerHTML = MINUS_SVG;
        grip.addEventListener('click', () => this.change(stepDie(this.pick, die, -1)));
        cell.appendChild(grip);
      } else {
        const space = doc.createElement('span');
        space.className = 'atlas-dice-tray__grip-space';
        space.setAttribute('aria-hidden', 'true');
        cell.appendChild(space);
      }
    }
    const applies = advantageApplies(this.pick, this.opts.rules());
    const side = applies ? this.pick.advantage ?? 'normal' : 'normal';
    this.sides.setAttribute('aria-disabled', String(!applies));
    for (const [value, option] of this.sideButtons) {
      const active = value === side;
      option.classList.toggle('atlas-active', active);
      option.setAttribute('aria-checked', String(active));
      option.setAttribute('aria-disabled', String(!applies));
    }
    this.modifierValue.textContent = this.pick.modifier > 0 ? `+${this.pick.modifier}` : String(this.pick.modifier);
    this.lower.disabled = this.pick.modifier <= -MODIFIER_LIMIT;
    this.raise.disabled = this.pick.modifier >= MODIFIER_LIMIT;
    const formula = pickFormula(this.pick);
    const sideName = applies && this.pick.advantage ? SIDES.find((entry) => entry.value === this.pick.advantage)?.label : undefined;
    this.formula.textContent = formula === '' ? 'The tray is empty.' : sideName ? `${formula} · ${sideName}` : formula;
    this.formula.classList.toggle('atlas-dice-tray__formula--empty', formula === '');
    this.roll.disabled = formula === '';
    this.clear.hidden = formula === '' && this.pick.modifier === 0;
  }

  /**
   * A die's colours, under the dice: the pack's own first, then each colour set up, with how many of the die are picked
   * in it. A colour's swatch (or +) adds one of the die in it, − takes one of it back.
   */
  private showSwatches(die: DieType, face: HTMLElement): void {
    if (this.swatchesFor === die && !this.swatches.hidden) { this.hideSwatches(); return; }
    this.swatchesFor = die;
    this.drawSwatches();
    this.swatches.hidden = false;
    face.focus();
  }

  /**
   * The open colour row, drawn again with the counts as they are now: laid out as the dice are, a button for each colour
   * (click adds one of the die in it, its badge says how many), the grip under it taking one back.
   */
  private drawSwatches(): void {
    const die = this.swatchesFor;
    if (!die) return;
    const doc = this.parent.ownerDocument;
    this.swatches.replaceChildren();
    const label = doc.createElement('span');
    label.className = 'atlas-dice-tray__modifier-label';
    label.textContent = `${die} colours`;
    this.swatches.appendChild(label);
    const row = doc.createElement('div');
    row.className = 'atlas-dice-tray__dice atlas-tabletop-dice-colours';
    this.swatches.appendChild(row);
    const full = countOf(this.pick, die) >= DIE_LIMIT || pickedCount(this.pick) >= MAX_DICE;
    const cell = (color: string | null, name: string): void => {
      const count = countOf(this.pick, die, color);
      const made = doc.createElement('div');
      made.className = 'atlas-dice-tray__die atlas-tabletop-dice-colour';
      const face = doc.createElement('button');
      face.type = 'button';
      face.className = `atlas-dice-tray__face atlas-tabletop-dice-colour__face${color ? '' : ' atlas-tabletop-dice-swatch--pack'}`;
      if (color) face.style.setProperty('--atlas-tabletop-swatch', color);
      face.setAttribute('aria-label', count === 0 ? `Add a ${name} ${die}` : `Add a ${name} ${die}, ${count} in the tray`);
      face.title = name;
      face.disabled = full;
      face.addEventListener('click', () => this.change(stepDie(this.pick, die, 1, color)));
      if (count > 0) {
        const badge = doc.createElement('span');
        badge.className = 'atlas-dice-tray__count';
        badge.setAttribute('aria-hidden', 'true');
        badge.textContent = String(count);
        face.appendChild(badge);
      }
      made.appendChild(face);
      if (count > 0) {
        const grip = doc.createElement('button');
        grip.type = 'button';
        grip.className = 'atlas-dice-tray__grip';
        grip.setAttribute('aria-label', `Take a ${name} ${die} back`);
        grip.innerHTML = MINUS_SVG;
        grip.addEventListener('click', () => this.change(stepDie(this.pick, die, -1, color)));
        made.appendChild(grip);
      } else {
        const space = doc.createElement('span');
        space.className = 'atlas-dice-tray__grip-space';
        space.setAttribute('aria-hidden', 'true');
        made.appendChild(space);
      }
      row.appendChild(made);
    };
    cell(null, "The pack's colour");
    for (const entry of this.opts.colors()) cell(entry.color, entry.name);
  }

  private hideSwatches(): void {
    this.swatches.hidden = true;
    this.swatchesFor = null;
  }
}
