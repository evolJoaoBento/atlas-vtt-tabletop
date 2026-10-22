/**
 * The GM's dice log: every roll Atlas logs on the board's map (Tabletop's own and Atlas's toolbar rolls), newest first,
 * at most 50, in a panel above the toolbar's Log button, and a card over the board for 4 s on each new roll. Rolls come
 * as Atlas's stock `dice-rolled` rolls and are read defensively: anything not shaped like one is dropped.
 */

/** One logged roll, as the log and the toast show it. */
export interface LogEntry {
  id: string;
  who: string;
  /** The ability the roll was made for (a statblock's, or a player's sheet roll). */
  label?: string;
  formula: string;
  /** At most 100 dice are kept. */
  dice: { die: string; value: number; dropped?: boolean; colour?: string }[];
  /** How many more dice the roll had than are kept. */
  more?: number;
  total: number;
  crit?: 'success' | 'failure';
  time: number;
}

export const LOG_LIMIT = 50;
/** What one roll may take to show: anyone's roll can arrive on the bus. */
export const MAX_SHOWN_DICE = 100;
const MAX_SCANNED_DICE = 1000;
const MAX_WHO = 64;
const MAX_LABEL = 64;
const MAX_FORMULA = 80;
/** Cards over the board at once; the oldest goes for a new one. */
export const MAX_TOASTS = 3;
/** How long a roll's card shows over the board. */
export const TOAST_MS = 4000;

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

let made = 0;

/** A stock roll as a log entry; null when it is not shaped like one. */
export function logEntryOf(roll: unknown): LogEntry | null {
  if (!isObject(roll) || typeof roll.formula !== 'string' || typeof roll.total !== 'number' || !Number.isFinite(roll.total)) return null;
  if (!Array.isArray(roll.rolls) || roll.rolls.length === 0) return null;
  // A die that does not read is skipped; the roll stays when at least one does.
  const dice: LogEntry['dice'] = [];
  let read = 0;
  for (const die of roll.rolls.slice(0, MAX_SCANNED_DICE)) {
    if (!isObject(die) || typeof die.die !== 'string' || typeof die.value !== 'number' || !Number.isFinite(die.value)) continue;
    read++;
    if (dice.length >= MAX_SHOWN_DICE) continue;
    const colour = text(die.colour);
    dice.push({ die: clip(die.die, 8), value: die.value, ...(die.dropped === true ? { dropped: true } : {}), ...(colour ? { colour: clip(colour, 32) } : {}) });
  }
  if (read === 0) return null;
  const more = read - dice.length + Math.max(0, roll.rolls.length - MAX_SCANNED_DICE);
  const time = typeof roll.timestamp === 'number' && Number.isFinite(roll.timestamp) ? roll.timestamp : Date.now();
  const source = isObject(roll.source) ? roll.source : null;
  // Any source may name the ability: a statblock roll, or a player's sheet roll Connect publishes as a toolbar roll.
  const label = source ? text(source.abilityName) : undefined;
  const crit = roll.crit === 'high' || roll.crit === 'success' ? 'success' : roll.crit === 'low' || roll.crit === 'failure' ? 'failure' : undefined;
  return {
    id: clip(text(roll.id) ?? `roll_${time}_${made++}`, 128),
    who: clip(text(roll.rolledBy) ?? 'GM', MAX_WHO),
    ...(label ? { label: clip(label, MAX_LABEL) } : {}),
    formula: clip(roll.formula, MAX_FORMULA),
    dice,
    ...(more > 0 ? { more } : {}),
    total: roll.total,
    ...(crit ? { crit } : {}),
    time,
  };
}

/** The log with `entry` first and at most 50 kept; the same list when it already has the roll. */
export function withEntry(list: readonly LogEntry[], entry: LogEntry): readonly LogEntry[] {
  if (list.some((have) => have.id === entry.id)) return list;
  return [entry, ...list].slice(0, LOG_LIMIT);
}

export interface DiceLogOptions {
  /** Where the toast cards go (the board); the panel's parent by default. */
  toastParent?: HTMLElement;
  /** The panel opened or closed (the toolbar's button follows). */
  onOpenChange?(open: boolean): void;
}

/** A die at its highest face reads as max, at 1 as min (as Atlas's log marks them). */
function extreme(die: LogEntry['dice'][number]): 'max' | 'min' | null {
  if (die.value === Number(die.die.slice(1))) return 'max';
  return die.value === 1 ? 'min' : null;
}

export class DiceLogPanel {
  private list: readonly LogEntry[] = [];
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly timers = new Set<number>();
  private disposed = false;
  private readonly escape: (event: KeyboardEvent) => void;
  private readonly onOutside = (event: PointerEvent): void => {
    // The Log button toggles the panel itself.
    if (!this.panel.parentElement?.contains(event.target as Node)) this.close();
  };

  constructor(private readonly parent: HTMLElement, private readonly options: DiceLogOptions = {}) {
    const doc = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement, content?: string): HTMLElementTagNameMap[K] => {
      const made = doc.createElement(tag);
      made.className = className;
      if (content !== undefined) made.textContent = content;
      into.appendChild(made);
      return made;
    };
    this.panel = el('div', 'atlas-dropdown-content atlas-dropdown-content--top atlas-tabletop-dice-log', parent);
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Dice log');
    const section = el('div', 'atlas-dropdown-section', this.panel);
    el('span', 'atlas-dropdown-label', section, 'Dice log');
    this.empty = el('p', 'atlas-tabletop-dice-log__empty', section, 'No rolls yet');
    this.body = el('ol', 'atlas-tabletop-dice-log__list', section);
    this.body.setAttribute('aria-label', 'Rolls');
    // Presses and keys here are not the board's: no camera drag, no camera keys; Escape closes it.
    this.panel.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') this.close(); event.stopPropagation(); });
    // Escape closes it from the button that opened it too.
    this.escape = (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    parent.addEventListener('keydown', this.escape);
    this.toasts = el('div', 'atlas-tabletop-dice-toasts', options.toastParent ?? parent);
    this.toasts.hidden = true;
    this.toasts.setAttribute('aria-live', 'polite');
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** The entries, newest first. */
  get entries(): readonly LogEntry[] {
    return this.list;
  }

  /** A new roll: first in the log, and a card over the board for 4 s. */
  add(entry: LogEntry): void {
    if (this.disposed) return;
    const next = withEntry(this.list, entry);
    if (next === this.list) return;
    this.list = next;
    // Only the new row is made; the rows past 50 go.
    this.empty.hidden = true;
    this.body.prepend(this.row(entry));
    while (this.body.childElementCount > LOG_LIMIT) this.body.lastElementChild?.remove();
    this.toast(entry);
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen || this.disposed) return;
    this.panel.hidden = false;
    this.parent.ownerDocument.addEventListener('pointerdown', this.onOutside, true);
    this.options.onOpenChange?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.parent.ownerDocument.removeEventListener('pointerdown', this.onOutside, true);
    this.options.onOpenChange?.(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.disposed = true;
    this.parent.removeEventListener('keydown', this.escape);
    const win = this.parent.ownerDocument.defaultView ?? window;
    for (const timer of this.timers) win.clearTimeout(timer);
    this.timers.clear();
    this.panel.remove();
    this.toasts.remove();
  }

  private make<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement | null, content?: string): HTMLElementTagNameMap[K] {
    const made = this.parent.ownerDocument.createElement(tag);
    made.className = className;
    if (content !== undefined) made.textContent = content;
    into?.appendChild(made);
    return made;
  }

  /** The roller, the ability, the formula and the total; the dice below. */
  private row(entry: LogEntry): HTMLElement {
    const item = this.make('li', `atlas-tabletop-dice-log__entry${entry.crit ? ` is-crit-${entry.crit}` : ''}`, null);
    this.make('span', 'atlas-tabletop-dice-log__who', item, entry.label ? `${entry.who} · ${entry.label}` : entry.who);
    const summary = this.make('div', 'atlas-tabletop-dice-log__summary', item);
    this.make('span', 'atlas-tabletop-dice-log__formula', summary, entry.formula);
    this.make('span', 'atlas-tabletop-dice-log__eq', summary, '=');
    this.make('span', 'atlas-tabletop-dice-log__total', summary, String(entry.total));
    item.appendChild(this.dice(entry, 'atlas-tabletop-dice-log__dice'));
    return item;
  }

  private dice(entry: LogEntry, className: string): HTMLElement {
    const list = this.make('div', className, null);
    for (const die of entry.dice) {
      const mark = die.dropped ? ' is-dropped' : extreme(die) === 'max' ? ' is-max' : extreme(die) === 'min' ? ' is-min' : '';
      const badge = this.make('span', `atlas-tabletop-dice-log__die${mark}`, list, String(die.value));
      badge.title = die.die;
      if (die.colour) badge.style.setProperty('--die-tag-colour', die.colour);
    }
    if (entry.more) this.make('span', 'atlas-tabletop-dice-log__more', list, `+${entry.more} more`);
    return list;
  }

  /** The roll as a card over the board, as Atlas's result card: the roller, the ability, the dice and a hero total. */
  private toast(entry: LogEntry): void {
    const card = this.make('div', `atlas-tabletop-dice-card${entry.crit ? ` is-crit-${entry.crit}` : ''}`, null);
    card.setAttribute('role', 'status');
    const content = this.make('div', 'atlas-tabletop-dice-card__content', card);
    this.make('span', 'atlas-tabletop-dice-card__who', content, entry.who);
    if (entry.label) this.make('span', 'atlas-tabletop-dice-card__label', content, entry.label);
    this.make('span', 'atlas-tabletop-dice-card__formula', content, entry.formula);
    content.appendChild(this.dice(entry, 'atlas-tabletop-dice-card__dice'));
    this.make('span', 'atlas-tabletop-dice-card__total', card, String(entry.total));
    while (this.toasts.childElementCount >= MAX_TOASTS) this.toasts.firstElementChild?.remove();
    this.toasts.appendChild(card);
    this.toasts.hidden = false;
    const win = this.parent.ownerDocument.defaultView ?? window;
    const timer = win.setTimeout(() => {
      this.timers.delete(timer);
      card.remove();
      if (this.toasts.childElementCount === 0) this.toasts.hidden = true;
    }, TOAST_MS);
    this.timers.add(timer);
  }
}
