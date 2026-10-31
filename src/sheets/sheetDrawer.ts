/**
 * The GM's stat sheet drawer: the selected token's sheet at the board's left edge, where an ability, a save, a skill or
 * a roll in an action's text ("+5", "1d8 + 3") is thrown with the board's dice. A click rolls, Shift-click rolls with
 * advantage and Alt-click (Option) with disadvantage, both at once cancel. A roll physical dice cannot throw (a
 * subtracted die) rolls nothing: the drawer says so. Text only, never markup: the sheet comes from vault notes.
 * Ported from Atlas VTT Connect (MIT, `sheetView.mts`).
 */
import { setSvg } from '../svg';
import { explainFormula, parseFormula } from '../dice/rollRules';
import { drawCard, routeCardRolls, type CardHost } from './atlasCard';
import {
  ABILITY_NAMES, advantageSide, mayHaveAdvantage, modifierOf, sheetRollFormula, sheetRollLabel, signed, textParts,
  type AdvantageSide, type PlayerSheet, type SheetBonus, type SheetRollRef,
} from './sheet';

export interface SheetDrawerOptions {
  /** A roll on the sheet: its formula, what the log calls it and the side it is rolled with, if any. */
  onRoll(formula: string, label: string, advantage?: AdvantageSide): void;
  onOpenChange?(open: boolean): void;
  /** The drawer starts pinned; and it is told when the pin is changed by hand, to keep it. */
  pinned?: boolean;
  onPinChange?(pinned: boolean): void;
  /** Waits until a card has finished drawing; by default until it stops changing. */
  settle?(element: Element): Promise<void>;
}

/** Lucide's `x` (ISC): the drawer's close button. */
const CLOSE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

/** Lucide's `pin` (ISC): the drawer's pin button. */
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

export class SheetDrawer {
  /** Pinned, the drawer stays open when another panel opens (and lies under it); unpinned, it closes then. */
  private pinned = false;
  private readonly pinButton: HTMLButtonElement;
  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly noticeLine: HTMLElement;
  private readonly body: HTMLElement;
  /** Atlas's own card of the stat block, drawn here when this Atlas has one; the text sheet shows when it has not. */
  private readonly cardBox: HTMLElement;
  private card: { host: CardHost; stop: () => void } | null = null;
  private drawing = 0;
  private sheet: PlayerSheet | null = null;
  private disposed = false;

  constructor(private readonly parent: HTMLElement, private readonly options: SheetDrawerOptions) {
    this.root = this.el('div', 'atlas-tabletop-sheet', parent);
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Stat sheet');
    const head = this.el('div', 'atlas-tabletop-sheet__head', this.root);
    this.title = this.el('h3', 'atlas-tabletop-sheet__name', head, 'Stat sheet');
    this.pinButton = this.el('button', 'clickable-icon atlas-tabletop-sheet__pin', head);
    this.pinButton.type = 'button';
    setSvg(this.pinButton, PIN_SVG);
    this.pinButton.addEventListener('click', () => {
      this.setPinned(!this.pinned);
      this.options.onPinChange?.(this.pinned);
    });
    this.setPinned(options.pinned === true);
    const close = this.el('button', 'clickable-icon atlas-tabletop-sheet__close', head);
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    // A fixed icon of this file's, never note text.
    setSvg(close, CLOSE_SVG);
    close.addEventListener('click', () => this.close());
    this.noticeLine = this.el('p', 'atlas-tabletop-sheet__notice', this.root);
    this.noticeLine.setAttribute('role', 'status');
    this.noticeLine.hidden = true;
    this.body = this.el('div', 'atlas-tabletop-sheet__body', this.root);
    this.cardBox = this.el('div', 'atlas-tabletop-sheet__card', this.root);
    this.cardBox.hidden = true;
    // The board under the drawer must not take its presses, wheel or keys; Escape closes it.
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu', 'dblclick']) {
      this.root.addEventListener(type, (event) => event.stopPropagation());
    }
    this.root.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') this.close();
    });
    this.show(null);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get isPinned(): boolean {
    return this.pinned;
  }

  /** Pins the drawer (it stays while other panels open, under them) or lets it go (they close it). */
  setPinned(pinned: boolean): void {
    this.pinned = pinned;
    this.root.classList.toggle('is-pinned', pinned);
    this.pinButton.classList.toggle('is-active', pinned);
    this.pinButton.setAttribute('aria-pressed', String(pinned));
    this.pinButton.setAttribute('aria-label', pinned ? 'Unpin' : 'Pin');
    this.pinButton.title = pinned ? 'Unpin: other panels will close it' : 'Pin: keep it open under other panels';
  }

  /** Another panel opened: an unpinned drawer closes, a pinned one stays. */
  closeUnlessPinned(): void {
    if (!this.pinned) this.close();
  }

  /**
   * The sheet to show (the selected token's); null for none. With `card`, Atlas's own card of the stat block is drawn
   * in its place; the text sheet shows where this Atlas draws none, and while the card is being drawn the drawer says so.
   */
  show(sheet: PlayerSheet | null, card: CardHost | null = null): void {
    if (this.disposed) return;
    this.dropCard();
    this.sheet = sheet;
    this.notice(null);
    this.title.textContent = sheet?.name ?? card?.name ?? 'Stat sheet';
    this.cardBox.hidden = true;
    this.body.hidden = false;
    if (!card) {
      this.body.replaceChildren(...this.text(sheet));
      return;
    }
    const drawing = ++this.drawing;
    this.body.replaceChildren(this.el('p', 'atlas-tabletop-sheet__empty', null, 'Drawing the stat block…'));
    // Drawn in place but unseen (Atlas picks the card's columns from the width it has), on a stage of its own, so a card
    // still drawing for the token before never lands in this one's place.
    const stage = this.el('div', 'atlas-tabletop-sheet__stage', this.cardBox);
    this.cardBox.className = 'atlas-tabletop-sheet__card is-drawing';
    this.cardBox.hidden = false;
    void drawCard(card, stage, this.options.settle).catch(() => false).then((drawn) => {
      // Another token was shown, or the drawer went, meanwhile.
      if (drawing !== this.drawing || this.disposed) { card.dispose(); return; }
      if (!drawn) {
        card.dispose();
        this.cardBox.hidden = true;
        this.cardBox.replaceChildren();
        this.body.replaceChildren(...this.text(sheet));
        return;
      }
      this.cardBox.className = 'atlas-tabletop-sheet__card';
      this.card = { host: card, stop: routeCardRolls(this.cardBox, (formula, label, side) => this.cardRoll(formula, label, side)) };
      this.body.hidden = true;
    });
  }

  /** The text sheet, or what says there is none. */
  private text(sheet: PlayerSheet | null): HTMLElement[] {
    return sheet ? this.content(sheet) : [this.el('p', 'atlas-tabletop-sheet__empty', null, 'Select a token with a stat block to see its sheet.')];
  }

  /** Lets go of the card drawn now and any still being drawn. */
  private dropCard(): void {
    this.drawing += 1;
    this.card?.stop();
    this.card?.host.dispose();
    this.card = null;
    this.cardBox.replaceChildren();
    this.cardBox.hidden = true;
  }

  /** A roll from Atlas's card, as Atlas's dice link names it: the board's dice throw it, or say they cannot. */
  private cardRoll(formula: string, label: string, side?: AdvantageSide): void {
    if (!parseFormula(formula)) {
      this.notice(`Can't roll ${formula}: ${explainFormula(formula) ?? 'these dice cannot throw it.'}`);
      return;
    }
    this.notice(null);
    this.options.onRoll(formula, label, side && mayHaveAdvantage(formula) ? side : undefined);
  }

  /** A short line under the sheet's name; null takes it away. */
  notice(text: string | null): void {
    this.noticeLine.textContent = text ?? '';
    this.noticeLine.hidden = text === null;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    if (this.isOpen || this.disposed) return;
    this.root.hidden = false;
    this.options.onOpenChange?.(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.options.onOpenChange?.(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.close();
    this.dropCard();
    this.disposed = true;
    this.root.remove();
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
    const made = this.parent.ownerDocument.win.createEl(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    into?.appendChild(made);
    return made;
  }

  /** Rolls what `ref` stands for on the sheet shown, when physical dice can throw it. */
  private roll(ref: SheetRollRef, side: AdvantageSide | null): void {
    const sheet = this.sheet;
    const formula = sheet ? sheetRollFormula(sheet, ref) : null;
    if (!sheet || !formula) return;
    // Never a roll other than the one asked for: what the dice cannot throw is not thrown at all.
    if (!parseFormula(formula)) {
      this.notice(`Can't roll ${formula}: ${explainFormula(formula) ?? 'these dice cannot throw it.'}`);
      return;
    }
    this.notice(null);
    this.options.onRoll(formula, sheetRollLabel(sheet, ref), side && mayHaveAdvantage(formula) ? side : undefined);
  }

  private rollButton(ref: SheetRollRef, text: string, title: string): HTMLButtonElement {
    const button = this.el('button', 'atlas-tabletop-sheet__roll', null, text);
    button.type = 'button';
    button.setAttribute('aria-label', `Roll ${title}`);
    button.title = `Roll ${title} (Shift: advantage, Alt: disadvantage)`;
    button.addEventListener('click', (event) => this.roll(ref, advantageSide(event.shiftKey, event.altKey)));
    // Enter and Space roll with the side their modifiers ask for, which a button's own click would drop.
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.roll(ref, advantageSide(event.shiftKey, event.altKey));
    });
    return button;
  }

  /** The sheet as elements: its subtitle, numbers, abilities, saves and skills, lines, and sections with their rolls. */
  private content(sheet: PlayerSheet): HTMLElement[] {
    const doc = this.parent.ownerDocument;
    const parts: HTMLElement[] = [];
    const line = (label: string, value: string): void => {
      const row = this.el('p', 'atlas-tabletop-sheet__line', null);
      row.append(this.el('span', 'atlas-tabletop-sheet__label', null, `${label} `), doc.createTextNode(value));
      parts.push(row);
    };
    if (sheet.subtitle) parts.push(this.el('p', 'atlas-tabletop-sheet__subtitle', null, sheet.subtitle));
    const basics = [['Armor class', sheet.ac], ['Hit points', sheet.hp], ['Speed', sheet.speed]] as const;
    for (const [label, value] of basics) if (value) line(label, value);
    if (sheet.stats) {
      const stats = this.el('div', 'atlas-tabletop-sheet__stats', null);
      sheet.stats.forEach((score, index) => {
        const name = ABILITY_NAMES[index] ?? '';
        const cell = this.el('div', 'atlas-tabletop-sheet__stat', stats);
        this.el('span', 'atlas-tabletop-sheet__stat-name', cell, name);
        this.el('span', 'atlas-tabletop-sheet__stat-score', cell, String(score));
        cell.append(this.rollButton({ kind: 'check', index }, signed(modifierOf(score)), `${name} check`));
      });
      parts.push(stats);
    }
    const bonusRow = (title: string, kind: 'save' | 'skill', list: readonly SheetBonus[]): void => {
      if (list.length === 0) return;
      const row = this.el('div', 'atlas-tabletop-sheet__bonuses', null);
      this.el('span', 'atlas-tabletop-sheet__label', row, title);
      list.forEach((bonus, index) => row.append(this.rollButton({ kind, index }, `${bonus.label} ${signed(bonus.bonus)}`, `${bonus.label}${kind === 'save' ? ' save' : ''}`)));
      parts.push(row);
    };
    bonusRow('Saves', 'save', sheet.saves);
    bonusRow('Skills', 'skill', sheet.skills);
    for (const entry of sheet.lines) line(entry.label, entry.text);
    sheet.sections.forEach((section, sectionIndex) => {
      if (section.title) parts.push(this.el('h4', 'atlas-tabletop-sheet__section', null, section.title));
      section.items.forEach((item, itemIndex) => {
        const paragraph = this.el('p', 'atlas-tabletop-sheet__item', null);
        if (item.name) this.el('strong', '', paragraph, `${item.name}. `);
        for (const part of textParts(item.desc)) {
          if ('roll' in part) {
            const ref: SheetRollRef = { kind: 'text', section: sectionIndex, item: itemIndex, index: part.roll, text: part.text };
            paragraph.append(this.rollButton(ref, part.text, `${item.name || section.title}: ${part.formula}`));
          } else paragraph.append(doc.createTextNode(part.text));
        }
        parts.push(paragraph);
      });
    });
    return parts;
  }
}
