/**
 * Atlas's initiative tracker (0.8.0's `InitiativeTracker`, `InitiativeCard`, `EditInitiativePopup` and the card's
 * menu, `initiativeCardMenu`) on the 3D board, one to one: the panel at the board's right edge with Roll, Start or End
 * combat and Clear above, a card per combatant (its portrait in its ring, the skull when defeated, its copy number,
 * the eye when hidden from players, its number, the bars of the resources that defeat it), and the turn's arrows and
 * round below. In a fight by sides the cards stand under their side's name and have no number. A card's click shows
 * its token, a drag reorders, a right-click opens its menu, and Edit Initiative opens the popup with the total and
 * the GM's modifier. Atlas's class names (styled in styles.css as Atlas styles them) under Tabletop's root.
 *
 * The panel only draws and reports: `host` gives the tracker, the tokens and the rules, and carries out each change.
 */
import type { MenuEntry } from './atlasMenu';
import {
  SIDE_LABELS, initiativeEdit, listedBySides, modifierText, otherSide, sideOf, sidesInOrder, sortedEntries,
  type InitiativeAction, type InitiativeEntry, type InitiativeRules, type InitiativeSide, type InitiativeState,
} from './initiative';
import type { BoardToken, TokenSettings } from './mapModel';
import { isDefeated, resourceColor, visibleResources, type ResourceDefinition } from './resources';

export interface InitiativePanelHost {
  /** The tracker as Atlas (or the map file) holds it now. */
  state(): InitiativeState;
  rules(): InitiativeRules;
  tokens(): readonly BoardToken[];
  /**
   * Whether the token is still on the map, as Atlas holds it (or the file): a combatant whose token was deleted while
   * Atlas's own tracker was closed keeps its entry, which Atlas drops once its tracker shows again; it gets no card.
   */
  hasToken(tokenId: string): boolean;
  tokenSettings(): TokenSettings;
  definitions(): readonly ResourceDefinition[];
  /** A vault image's URL. */
  imageUrl(path: string): string;
  /** Draws an Obsidian (Lucide) icon into an element. */
  icon(element: HTMLElement, name: string): void;
  /** Rolls everyone, or one combatant, with their statblocks' modifiers. */
  roll(entryId?: string): void;
  act(action: InitiativeAction): void;
  /** Whether Atlas (when it holds the map) offers the change; always in the file. */
  offers(action: 'reset' | 'sitsOut'): boolean;
  setHidden(tokenId: string, hidden: boolean): void;
  setSide(tokenId: string, side: InitiativeSide): void;
  /** Shows the token: the camera goes to it. */
  showToken(tokenId: string): void;
  /** Opens Atlas's context menu at the pointer. */
  menu(entries: () => MenuEntry[], at: { x: number; y: number }): void;
}

/** Truce by Delapouite from game-icons.net (CC BY 3.0): Atlas's End combat flag. */
const TRUCE_PATH =
  'M145.3 23.89L89.27 257.7c5.62-4.9 12.93-5.8 19.63-4.4l54-225.21zm37 6.1l-57 231.41c1 .8 1.9 1.8 2.7 2.7 39.2-14 117.2-32 127.1 32.2 15.2 99.1 96.8 135.8 148.9 114.8-27.8-99.6 87.6-116.8 70.7-205.1 0 0-111 26.4-131.6-90.6-23.5-58.14-101.6-103.33-160.8-85.41zM101.4 270.9c-6.91 22.3-10.68 51.2.6 67.9 5.4 30.1 34 51.5 49.4 57.5-12.2 4.6-24.8 2.8-35.4-3.3-5.6 11.4-18.71 17.5-29.76 21 7.21 8.8 15.46 16.7 23.96 22.4 4.3 18.2 7.3 41.8 12.7 56.9h114.7c-31.7-18.6-56.8-42-61.3-69.9 8.6-18.2 10.5-46.2-.5-70.9-14.8-22.7-54.9-22.9-61.1-48.3-2.5-11.2 5.2-40.6-13.3-33.3zm-41.38 13c-7.17 1.5-11.98 8.3-10.24 14.7 8.66 1 17.82 2.2 26.53 3.8.38-4.1 1-8.2 1.73-12-6.18-2.5-12.48-4.8-18.02-6.5zm-16.91 32.2c-7.45 1.7-10.55 12.4-3.69 15.7 13.81.8 28.8 2.6 40.96 4.9-2-5-3.24-10.1-3.9-15.3-10.35-2.2-22.62-4.3-33.37-5.3zm-3.18 33.5c-8.95 5.5.2 16.2 4.7 18 15.57 2 29.64 2.7 41.1-1.8 4.51-2.5 4.29-4.4 2.89-8.3-16.82-3.7-33.26-6.4-48.69-7.9zm57.96 29.7c-12.54 8.9-32.12 8.5-44.89 7.4 1.64 6 7.89 9 10.92 10.2 9.37 3.7 22.37-1.1 33.47-8.4 3.21-2.7 4.51-8.7.5-9.2zm-45.46 32.2l-13.18 54.9 17.5 4.2 13-54.3c-6.59-.5-11.94-2.1-17.32-4.8z';

/** How long a turn key's press shows on its arrow, as Atlas shows it. */
const PRESS_MS = 150;

export class InitiativePanel {
  private readonly doc: Document;
  private readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private open = false;
  private dragFrom: number | null = null;
  private dragOver: number | null = null;
  private pressed: 'prev' | 'next' | null = null;
  private pressTimer: number | null = null;
  /** The edit popup's layer on the page, as Atlas puts it on its document's body. */
  private popup: HTMLElement | null = null;
  /** The turn the list last scrolled to, so it scrolls only when the turn moves. */
  private shownTurn = '';

  constructor(container: HTMLElement, private readonly host: InitiativePanelHost) {
    this.doc = container.ownerDocument;
    this.root = this.el('div', 'atlas-tabletop-atlas atlas-tabletop-initiative', container);
    this.panel = this.el('div', 'atlas-initiative-tracker', this.root);
    // The board under the panel must not take its clicks, drags or wheel.
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu', 'dblclick']) {
      this.panel.addEventListener(type, (event) => event.stopPropagation());
    }
    this.root.hidden = true;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    if (!open) this.closePopup();
    this.render();
  }

  /** A turn key's press, shown on its arrow for a moment. */
  press(which: 'prev' | 'next'): void {
    this.pressed = which;
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.pressTimer = window.setTimeout(() => { this.pressed = null; this.pressTimer = null; this.render(); }, PRESS_MS);
    this.render();
  }

  dispose(): void {
    if (this.pressTimer !== null) window.clearTimeout(this.pressTimer);
    this.closePopup();
    this.root.remove();
  }

  /** Draws the tracker again as the host has it now. */
  render(): void {
    if (!this.open) return;
    const state = this.host.state();
    const rules = this.host.rules();
    const bySides = listedBySides(state, rules);
    const entries = sortedEntries(state);
    const tokens = new Map(this.host.tokens().map((token) => [token.id, token]));
    const shown = entries.filter((entry) => this.host.hasToken(entry.tokenId));
    const scrollTop = this.panel.querySelector('.atlas-initiative-tracker__content')?.scrollTop ?? 0;
    this.panel.replaceChildren();

    const controls = this.el('div', 'atlas-initiative-tracker__controls', this.panel);
    // Nothing is rolled where the sides take turns.
    if (!bySides) this.button(controls, 'dices', 'Roll initiative', entries.length === 0, () => this.host.roll());
    if (!state.isActive) this.button(controls, 'swords', 'Start combat', entries.length === 0, () => this.host.act({ type: 'start', rules }));
    else this.button(controls, '', 'End combat', false, () => this.host.act({ type: 'end' }), 'atlas-initiative-tracker__btn--end').appendChild(this.truce());
    if (this.host.offers('reset')) this.button(controls, 'trash-2', 'Clear initiative', entries.length === 0, () => this.host.act({ type: 'reset' }));

    const content = this.el('div', 'atlas-initiative-tracker__content', this.panel);
    content.setAttribute('role', 'list');
    if (shown.length === 0) this.el('p', 'atlas-initiative-tracker__empty', content, 'Right-click a token to add it');
    // `index` is the card's place among all combatants, which is what a drag reorders.
    const card = (entry: InitiativeEntry, index: number, parent: HTMLElement): void => {
      if (this.host.hasToken(entry.tokenId)) this.card(entry, index, parent, tokens, bySides);
    };
    if (shown.length > 0 && bySides) {
      for (const side of sidesInOrder(state.sides?.first ?? rules.firstSide)) {
        const section = this.el('section', `atlas-initiative-side${state.sides?.active === side ? ' atlas-initiative-side--active' : ''}`, content);
        if (state.sides?.active === side) section.setAttribute('aria-current', 'true');
        this.el('h4', 'atlas-initiative-side__label', section, SIDE_LABELS[side]);
        entries.forEach((entry, index) => { if (sideOf(tokens.get(entry.tokenId)) === side) card(entry, index, section); });
      }
    } else if (shown.length > 0) {
      entries.forEach((entry, index) => card(entry, index, content));
    }

    const turns = this.el('div', 'atlas-initiative-tracker__turn-controls', this.panel);
    this.button(turns, 'chevron-up', '', !state.isActive, () => this.host.act({ type: 'previous' }), this.pressed === 'prev' ? 'atlas-initiative-tracker__btn--pressed' : '');
    this.el('span', 'atlas-initiative-tracker__round', turns, state.isActive ? `R${state.round}` : '—');
    this.button(turns, 'chevron-down', '', !state.isActive, () => this.host.act({ type: 'next' }), this.pressed === 'next' ? 'atlas-initiative-tracker__btn--pressed' : '');
    // The list is drawn anew: it is put back where it was at once (not glided there from the top), once the panel
    // around it is whole and the list has its height.
    content.style.scrollBehavior = 'auto';
    content.scrollTop = scrollTop;
    content.style.scrollBehavior = '';

    // The turn stays in view in a list longer than the panel: its card, or the top of its side.
    const turn = state.isActive ? `${state.round}:${state.sides?.active ?? state.entries.find((entry) => entry.isActive)?.id ?? ''}` : '';
    if (turn !== this.shownTurn) {
      this.shownTurn = turn;
      const target = content.querySelector<HTMLElement>('.atlas-initiative-side--active') ?? content.querySelector<HTMLElement>('.atlas-initiative-card--active');
      if (turn && target) this.scrollWithin(content, target, target.classList.contains('atlas-initiative-side') ? 'start' : 'nearest');
    }
  }

  private card(entry: InitiativeEntry, index: number, parent: HTMLElement, tokens: Map<string, BoardToken>, bySides: boolean): void {
    const token = tokens.get(entry.tokenId);
    const definitions = this.host.definitions();
    const defeated = token !== undefined && token.kind === 'character' && isDefeated(token, definitions);
    const hidden = token?.hidden === true;
    const classes = [
      'atlas-initiative-card',
      entry.isActive && !bySides && 'atlas-initiative-card--active',
      defeated && 'atlas-initiative-card--defeated',
      hidden && 'atlas-initiative-card--hidden',
      entry.sitsOut && 'atlas-initiative-card--sitting-out',
    ].filter(Boolean).join(' ');
    const card = this.el('div', classes, parent);
    card.draggable = true;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-roledescription', 'initiative card');
    card.dataset.entry = entry.id;

    this.icon(this.el('div', 'atlas-initiative-card__drag-handle', card), 'grip-vertical');
    const avatar = this.el('div', 'atlas-initiative-card__avatar-wrapper', card);
    const imagePath = token?.imagePath ?? entry.imagePath;
    if (imagePath) {
      const portrait = this.el('div', `atlas-token-portrait ${token?.showRing === false ? 'atlas-token-portrait--unframed' : ''} atlas-initiative-card__portrait`, avatar);
      const art = this.el('div', 'atlas-token-image-wrapper', portrait);
      const img = this.el('img', '', art);
      img.src = this.host.imageUrl(imagePath);
      img.alt = token?.name ?? entry.name;
      img.draggable = false;
      img.decoding = 'async';
      if (token?.showRing !== false) {
        const ring = this.el('div', 'atlas-token-ring', portrait);
        if (token?.ringColor) ring.style.setProperty('--atlas-token-ring-color', token.ringColor);
      }
    } else {
      this.icon(this.el('div', 'atlas-initiative-card__avatar', avatar), entry.isNPC ? 'bot' : 'user');
    }
    if (defeated) this.icon(this.el('div', 'atlas-initiative-card__defeated-overlay', avatar), 'skull');
    const badge = this.instanceBadge(token);
    if (badge !== null) this.el('span', 'atlas-initiative-card__instance-badge', avatar, String(badge));
    if (hidden) {
      const eye = this.el('span', 'atlas-initiative-card__hidden-badge', avatar);
      eye.setAttribute('aria-label', 'Hidden from players');
      eye.setAttribute('data-tooltip-position', 'left');
      this.icon(eye, 'eye-off');
    }
    if (!bySides) this.el('span', 'atlas-initiative-card__initiative', card, String(entry.initiative));

    const bars = token ? visibleResources(token, definitions, [], 'gm').filter(({ definition }) => definition.defeatedWhenSpent) : [];
    if (bars.length > 0) {
      const list = this.el('div', 'atlas-initiative-card__resources', card);
      for (const { definition, value } of bars) {
        const bar = this.el('div', 'atlas-initiative-card__hp-bar', list);
        bar.setAttribute('role', 'meter');
        bar.setAttribute('aria-label', definition.name);
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuenow', String(value.current));
        bar.setAttribute('aria-valuemax', String(value.max));
        const fill = this.el('div', 'atlas-initiative-card__hp-fill', bar);
        fill.style.width = `${Math.max(0, Math.min(100, value.max > 0 ? (value.current / value.max) * 100 : 0))}%`;
        fill.style.setProperty('--atlas-resource-color', resourceColor(definition, value));
      }
    }

    card.addEventListener('click', () => this.host.showToken(entry.tokenId));
    card.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.host.menu(() => this.cardMenu(entry.id, card), { x: event.clientX, y: event.clientY });
    });
    card.addEventListener('dragstart', (event) => {
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      }
      this.dragFrom = index;
    });
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const rect = card.getBoundingClientRect();
      const above = event.clientY < rect.top + rect.height / 2;
      card.classList.toggle('atlas-initiative-card--drop-above', above);
      card.classList.toggle('atlas-initiative-card--drop-below', !above);
      this.dragOver = index;
    });
    card.addEventListener('dragleave', () => card.classList.remove('atlas-initiative-card--drop-above', 'atlas-initiative-card--drop-below'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('atlas-initiative-card--drop-above', 'atlas-initiative-card--drop-below');
      this.endDrag();
    });
    card.addEventListener('dragend', () => { this.dragFrom = null; this.dragOver = null; });
  }

  /** As Atlas: a drop moves the dragged card to the place of the card it was dropped on. */
  private endDrag(): void {
    const { dragFrom: from, dragOver: to } = this;
    this.dragFrom = null;
    this.dragOver = null;
    if (from !== null && to !== null && from !== to) this.host.act({ type: 'reorder', from, to });
  }

  /** The card's menu (Atlas's `initiativeCardMenu`), read again whenever the menu redraws. */
  private cardMenu(entryId: string, card: HTMLElement): MenuEntry[] {
    const state = this.host.state();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return [];
    const bySides = listedBySides(state, this.host.rules());
    const token = this.host.tokens().find((candidate) => candidate.id === entry.tokenId);
    const hidden = token?.hidden ?? false;
    const other = otherSide(sideOf(token));
    const item = (label: string, onClick: () => void): MenuEntry => ({ type: 'item', label, onClick });
    return [
      ...(bySides ? [] : [item('Roll Initiative', () => this.host.roll(entry.id))]),
      item('Move to Front', () => this.host.act({ type: 'front', id: entry.id })),
      item('Move to Back', () => this.host.act({ type: 'back', id: entry.id })),
      ...(bySides
        ? [
          item(`Move to ${SIDE_LABELS[other]}`, () => this.host.setSide(entry.tokenId, other)),
          ...(state.isActive && this.host.offers('sitsOut')
            ? [item(entry.sitsOut ? 'Act This Round' : 'Sit Out This Round', () => this.host.act({ type: 'sitsOut', id: entry.id, sitsOut: !entry.sitsOut }))]
            : []),
        ]
        : [item('Edit Initiative', () => this.openPopup(entry, card))]),
      item(hidden ? 'Show to Players' : 'Hide from Players', () => this.host.setHidden(entry.tokenId, !hidden)),
      { type: 'item', label: 'Remove from Initiative', destructive: true, onClick: () => this.host.act({ type: 'remove', id: entry.id }) },
    ];
  }

  /** Atlas's edit popup: the total and the GM's own modifier, left of the card; Enter saves, Escape or a click away cancels. */
  private openPopup(entry: InitiativeEntry, card: HTMLElement): void {
    this.closePopup();
    const view = this.doc.defaultView ?? window;
    const anchor = card.getBoundingClientRect();
    const padding = 16;
    const height = 72;
    const top = Math.max(padding, Math.min(view.innerHeight - height - padding, anchor.top + anchor.height / 2 - height / 2));
    // On the page's body, as Atlas portals it, under Tabletop's root for its styles.
    const layer = this.el('div', 'atlas-tabletop-atlas', this.doc.body);
    const backdrop = this.el('div', 'atlas-initiative-edit-backdrop', layer);
    const popup = this.el('div', 'atlas-initiative-edit-popup', layer);
    popup.style.position = 'fixed';
    popup.style.top = `${top}px`;
    popup.style.right = `${view.innerWidth - anchor.left + padding}px`;
    const fields = this.el('div', 'atlas-initiative-edit-popup__fields', popup);
    const field = (caption: string, value: string, extra: string, placeholder: string): HTMLInputElement => {
      const label = this.el('label', 'atlas-initiative-edit-popup__field', fields);
      this.el('span', 'atlas-initiative-edit-popup__caption', label, caption);
      const input = this.el('input', `atlas-initiative-edit-popup__input${extra}`, label);
      input.type = 'number';
      input.value = value;
      input.placeholder = placeholder;
      return input;
    };
    const total = field('Initiative', String(entry.initiative), '', '0');
    const modifier = field('Modifier', modifierText(entry), ' atlas-initiative-edit-popup__input--modifier', 'auto');
    this.el('span', 'atlas-initiative-edit-popup__hint', popup, 'Enter to save · Esc to cancel');
    const confirm = (): void => {
      this.host.act({ type: 'edit', id: entry.id, changes: initiativeEdit(total.value, modifier.value) });
      this.closePopup();
    };
    popup.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); confirm(); }
      else if (event.key === 'Escape') { event.preventDefault(); this.closePopup(); }
    });
    for (const type of ['pointerdown', 'pointerup', 'wheel', 'contextmenu']) popup.addEventListener(type, (event) => event.stopPropagation());
    popup.addEventListener('click', (event) => event.stopPropagation());
    backdrop.addEventListener('pointerdown', (event) => event.stopPropagation());
    backdrop.addEventListener('click', () => this.closePopup());
    this.popup = layer;
    view.setTimeout(() => { total.focus(); total.select(); }, 50);
  }

  private closePopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  /** The copy number, when two or more tokens share its art and the map shows the numbers. */
  private instanceBadge(token: BoardToken | undefined): number | null {
    if (!token?.instanceNumber || !this.host.tokenSettings().showInstanceBadges) return null;
    const same = this.host.tokens().filter((other) => other.imagePath === token.imagePath).length;
    return same >= 2 ? token.instanceNumber : null;
  }

  /** Scrolls `list` so `target` shows, without scrolling anything around it. */
  private scrollWithin(list: HTMLElement, target: HTMLElement, block: 'start' | 'nearest'): void {
    const top = target.offsetTop - list.offsetTop;
    const bottom = top + target.offsetHeight;
    if (block === 'start') list.scrollTop = top;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  private button(parent: HTMLElement, icon: string, tooltip: string, disabled: boolean, onClick: () => void, extra = ''): HTMLButtonElement {
    const button = this.el('button', `clickable-icon atlas-initiative-tracker__btn${extra ? ` ${extra}` : ''}`, parent);
    button.type = 'button';
    button.disabled = disabled;
    if (tooltip) {
      button.setAttribute('aria-label', tooltip);
      button.setAttribute('data-tooltip-position', 'left');
    }
    if (icon) this.icon(button, icon);
    button.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
    return button;
  }

  private truce(): SVGSVGElement {
    const svg = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', TRUCE_PATH);
    svg.appendChild(path);
    return svg;
  }

  private icon(element: HTMLElement, name: string): void {
    this.host.icon(element, name);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
    const made = this.doc.createElement(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    parent.appendChild(made);
    return made;
  }
}
