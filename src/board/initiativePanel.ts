/**
 * Atlas's initiative tracker on the 3D board: Atlas 0.20's GM tracker (`InitiativeTracker`, `InitiativeCard`, its header and
 * turn controls) drawn as a row across the top of the board, Baldur's Gate fashion, instead of Atlas's column at the right
 * edge. The markup and class names are Atlas's own (`atlas-initiative-panel--row`, `atlas-initiative-card--tile`, `__art`,
 * `__marks`, the wound red rising in the art, the side headings and the round over the row's end), so Atlas's live styles give
 * the look; Tabletop's `styles.css` only places the row on the board. A card shows its token's art with the copy number and
 * the eye of a combatant hidden from players on its top left, its number on its top right and the skull when defeated; in a fight by
 * sides the cards stand under their side's name and have no number. A card's click shows its token, a drag reorders, a
 * right-click opens its menu, and its number or Edit Initiative opens the popup with the total and the GM's modifier. Roll,
 * Start or End combat and the options (at the row's start) and the turn's arrows (at its end) float below it while the pointer
 * is near; the round stands over the row's end.
 *
 * The panel only draws and reports: `host` gives the tracker, the tokens and the rules, and carries out each change.
 */
import type { MenuEntry } from './atlasMenu';
import {
  SIDE_LABELS, fightSides, initiativeEdit, listedBySides, modifierText, otherSide, sideLabel, sideOf, sortedEntries,
  type InitiativeAction, type InitiativeEntry, type InitiativeRules, type InitiativeSide, type InitiativeState,
} from './initiative';
import type { BoardToken, TokenSettings } from './mapModel';
import { at } from '../atlasPort/atlasText';
import { t } from '../atlasPort/shims/i18n';
import { isDefeated, visibleResources, type ResourceDefinition } from './resources';
import { woundShare } from '../atlasPort/app/initiative/woundShare';
import { turnColor } from '../atlasPort/app/initiative/turnColor';
import { TURN_KEY_ATTRIBUTE, adoptGhosts, ghostsOf, playTurnMotion, snapshotTurn } from '../atlasPort/app/initiative/motion/turnMotion';
import { scrollWithin } from '../atlasPort/app/utils/scrollWithin';
import { TURN_FLASH_MS } from '../atlasPort/app/services/playerInitiativeList';

export interface InitiativePanelHost {
  /** The tracker as Atlas (or the map file) holds it now. */
  state(): InitiativeState;
  rules(): InitiativeRules;
  tokens(): readonly BoardToken[];
  /**
   * Whether the token is still on the map, as Atlas holds it (or the file): a combatant whose token was deleted while
   * Atlas's own tracker was closed keeps its entry, which Atlas drops once its tracker shows again; it gets no card.
   * Asked only of entries that name a token (Atlas 0.18's party members and enemies have none and always get a card).
   */
  hasToken(tokenId: string): boolean;
  tokenSettings(): TokenSettings;
  definitions(): readonly ResourceDefinition[];
  /** A vault image's URL. */
  imageUrl(path: string): string;
  /** Hands `apply` the `object-view-box` that shows an image's art without its transparent margins (Atlas's `withArtViewBox`); absent: the whole image. */
  artViewBox?(imagePath: string, apply: (viewBox: string) => void): void;
  /** Draws an Obsidian (Lucide) icon into an element. */
  icon(element: HTMLElement, name: string): void;
  /** Rolls everyone, or one combatant, with their statblocks' modifiers. */
  roll(entryId?: string): void;
  act(action: InitiativeAction): void;
  /** Whether Atlas (when it holds the map) offers the change; always in the file. */
  offers(action: 'reset' | 'sitsOut' | 'resetNumbers'): boolean;
  setHidden(tokenId: string, hidden: boolean): void;
  setSide(tokenId: string, side: InitiativeSide): void;
  /** Shows the token: the camera goes to it. */
  showToken(tokenId: string): void;
  /**
   * Atlas's compact view (0.18's `showsCompactInitiative`): the tracker as one line per combatant. Absent where the Atlas in
   * use has no such setting.
   */
  compact?(): boolean;
  /** The rows of Atlas's tracker options menu the Atlas in use can carry out (Compact view, Turn banner); none, no options button. */
  options?(): MenuEntry[];
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
  /** The list was drawn once: a turn first seen then is no turn beginning. */
  private drawn = false;
  /** When the turn the list shows began, while its holder flashes. */
  private flashedAt: number | null = null;
  /** Called when the tracker opens or closes: the players' list in the player window follows it. */
  onOpenChange: (() => void) | null = null;

  constructor(container: HTMLElement, private readonly host: InitiativePanelHost) {
    this.doc = container.ownerDocument;
    this.root = this.el('div', 'atlas-tabletop-atlas atlas-vtt-plugin atlas-tabletop-initiative', container);
    this.panel = this.el('div', 'tabletop-initiative-tracker', this.root);
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
    this.onOpenChange?.();
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
    const shown = entries.filter((entry) => this.listed(entry));
    // What the list was before: where it was scrolled, and where each card stood (the cards glide from there)
    const before = this.panel.querySelector<HTMLElement>('.atlas-initiative-panel__list');
    const scrollLeft = before?.scrollLeft ?? 0;
    const stood = snapshotTurn(before);
    const ghosts = ghostsOf(before);
    this.panel.replaceChildren();
    const compact = this.host.compact?.() === true;
    this.panel.className = [
      'atlas-initiative-panel atlas-initiative-panel--row atlas-initiative-tracker tabletop-initiative-tracker',
      compact && 'atlas-initiative-tracker--named atlas-initiative-tracker--compact',
    ].filter(Boolean).join(' ');

    // Its surface is a layer of its own, so a theme's ivy can lie behind it; near it, its bars show
    this.el('div', 'atlas-initiative-panel__surface', this.panel).setAttribute('aria-hidden', 'true');
    this.el('div', 'atlas-initiative-tracker__reach', this.panel).setAttribute('aria-hidden', 'true');
    this.header(state, rules, bySides, entries.length === 0);

    // The turn the list shows: it flashes where it begins, and stays in view
    const turn = state.isActive ? `${state.round}:${state.sides?.active ?? state.entries.find((entry) => entry.isActive)?.id ?? ''}` : '';
    const turnMoved = turn !== this.shownTurn;
    // The turn passing on (or back) wraps the cards round the row; a fight starting or ending only rearranges them
    const turnPassed = turnMoved && turn !== '' && this.shownTurn !== '';
    if (turnMoved && turn && this.drawn) this.flashedAt = performance.now();
    this.shownTurn = turn;
    this.drawn = true;

    const content = this.el('div', 'atlas-initiative-panel__list', this.panel);
    content.setAttribute('role', 'list');
    if (shown.length === 0) this.el('p', 'tabletop-initiative-tracker__empty', content, 'Right-click a token to add it');
    // `index` is the card's place among all combatants, which is what a drag reorders.
    const sides = fightSides(state, rules);
    const card = (entry: InitiativeEntry, index: number, parent: HTMLElement): void => {
      if (this.listed(entry)) this.card(entry, index, parent, tokens, bySides, compact, sides);
    };
    if (shown.length > 0 && bySides) {
      // Atlas 0.9 may name sides of its own and order them: the sections follow the fight's order.
      const named = state.sides?.order ?? rules.sides ?? [];
      for (const side of sides) {
        const active = state.sides?.active === side;
        const section = this.el('section', `atlas-initiative-side${active ? ' atlas-initiative-side--active' : ''}`, content);
        if (active) section.setAttribute('aria-current', 'true');
        this.el('h4', 'atlas-initiative-side__label', section, sideLabel(side, named));
        entries.forEach((entry, index) => { if (this.sideOfEntry(entry, tokens, sides) === side) card(entry, index, section); });
      }
    } else if (shown.length > 0) {
      entries.forEach((entry, index) => card(entry, index, content));
    }
    // The turn's holder lights up once, taken up where it was when the list is drawn again meanwhile
    const flashing = this.flashedAt === null ? null : performance.now() - this.flashedAt;
    if (state.isActive && flashing !== null && flashing < TURN_FLASH_MS) {
      for (const holder of content.querySelectorAll<HTMLElement>('.atlas-initiative-card--active, .atlas-initiative-side--active .atlas-initiative-card:not(.atlas-initiative-card--sitting-out)')) {
        holder.classList.add('atlas-initiative-card--turn-flash');
        holder.style.setProperty('--atlas-turn-flash-delay', `${-Math.round(flashing)}ms`);
      }
    }

    // The shade over the row's start, once it is scrolled; at its end the round, else a shade while more lies beyond
    this.el('div', 'atlas-initiative-panel__top-shade', this.panel).setAttribute('aria-hidden', 'true');
    if (state.isActive) this.el('div', 'atlas-initiative-panel__round', this.panel, t('playerInit.round', { round: state.round }));
    else this.el('div', 'atlas-initiative-panel__bottom-shade', this.panel).setAttribute('aria-hidden', 'true');
    if (state.isActive) this.turnControls();

    // The list is drawn anew: it is put back where it was at once (not glided there from the start), once the panel
    // around it is whole and the list has its width.
    content.setCssStyles({ scrollBehavior: 'auto' });
    content.scrollLeft = scrollLeft;
    content.setCssStyles({ scrollBehavior: '' });
    adoptGhosts(content, ghosts);
    // The cards glide from where they stood to their places as the turn passes, a reorder going straight there
    playTurnMotion(content, stood, { wrap: turnPassed });

    // The turn stays in view in a row wider than the panel: its card, or the start of its side.
    if (turnMoved && turn) {
      const target = content.querySelector<HTMLElement>('.atlas-initiative-side--active') ?? content.querySelector<HTMLElement>('.atlas-initiative-card--active');
      if (target) scrollWithin(content, target, target.classList.contains('atlas-initiative-side') ? 'start' : 'nearest', 0, 'x');
    }
  }

  /** The bar at the row's start (Atlas's `InitiativeTrackerHeader`, floating above its column): Roll, Start or End combat and the options. */
  private header(state: InitiativeState, rules: InitiativeRules, bySides: boolean, empty: boolean): void {
    const bar = this.el('div', 'atlas-initiative-tracker__float atlas-initiative-tracker__float--top', this.panel);
    // Nothing is rolled where the sides take turns.
    if (!bySides) this.button(bar, 'dices', 'Roll initiative', empty, () => this.host.roll());
    if (!state.isActive) this.button(bar, 'swords', 'Start combat', empty, () => this.host.act({ type: 'start', rules }));
    else this.button(bar, '', 'End combat', false, () => this.host.act({ type: 'end' }), 'atlas-initiative-tracker__btn--end').appendChild(this.truce());
    // Atlas 0.18's options button (the ellipsis, last): its menu holds the Compact view and Turn banner switches and, as Atlas 0.18
    // moved them there, Reset initiative (numbers emptied, everyone kept) and Clear initiative. An Atlas without the switches keeps
    // the two as buttons, as before; each is offered only where Atlas has it.
    const switches = this.host.options?.() ?? [];
    const offersReset = this.host.offers('resetNumbers');
    const offersClear = this.host.offers('reset');
    if (switches.length === 0) {
      if (offersReset) this.button(bar, 'rotate-ccw', at('initiative.resetNumbers'), empty, () => this.host.act({ type: 'resetNumbers' }));
      if (offersClear) this.button(bar, 'trash-2', at('initiative.clear'), empty, () => this.host.act({ type: 'reset' }));
    } else {
      const button = this.button(bar, 'ellipsis', at('initiative.options'), false, () => {
        const rect = button.getBoundingClientRect();
        this.host.menu(() => this.optionsMenu(), { x: rect.left, y: rect.bottom });
      }, 'tabletop-initiative-tracker__btn--options');
      button.setAttribute('aria-haspopup', 'menu');
    }
  }

  /** The bar at the row's end during a fight (Atlas's `InitiativeTurnControls`, floating below its column): the previous and next turn. */
  private turnControls(): void {
    const bar = this.el('div', 'atlas-initiative-tracker__float atlas-initiative-tracker__float--bottom', this.panel);
    this.button(bar, 'chevron-left', 'Previous turn', false, () => this.host.act({ type: 'previous' }), this.pressed === 'prev' ? 'atlas-initiative-tracker__btn--pressed' : '');
    this.button(bar, 'chevron-right', 'Next turn', false, () => this.host.act({ type: 'next' }), this.pressed === 'next' ? 'atlas-initiative-tracker__btn--pressed' : '');
  }

  /** Whether the entry gets a card: one without a token (a party member, an enemy) always does. */
  private listed(entry: InitiativeEntry): boolean {
    return entry.tokenId === undefined || this.host.hasToken(entry.tokenId);
  }

  /** Atlas's side for an entry: a party member is the players'; a token's own; an enemy without a token the opponents'. */
  private sideOfEntry(entry: InitiativeEntry, tokens: ReadonlyMap<string, BoardToken>, known: readonly string[]): string {
    if (entry.partyMemberId !== undefined) return 'players';
    return sideOf(entry.tokenId === undefined ? undefined : tokens.get(entry.tokenId), known);
  }

  /** A combatant's card (Atlas's `InitiativeCard`): a tile filled with its token's art, or the compact list's line. */
  private card(entry: InitiativeEntry, index: number, parent: HTMLElement, tokens: Map<string, BoardToken>, bySides: boolean, compact: boolean, sides: readonly string[]): void {
    const token = entry.tokenId === undefined ? undefined : tokens.get(entry.tokenId);
    const definitions = this.host.definitions();
    const defeated = token !== undefined && token.kind === 'character' && isDefeated(token, definitions);
    // A hidden token's entry, or one the GM hid, is left out of the players' list
    const hidden = token?.hidden === true || entry.hiddenFromPlayers === true;
    const name = token?.name || entry.name;
    const classes = [
      'atlas-initiative-card',
      !compact && 'atlas-initiative-card--tile',
      this.sideOfEntry(entry, tokens, sides) === 'players' && 'atlas-initiative-card--ally',
      entry.isActive && !bySides && 'atlas-initiative-card--active',
      defeated && 'atlas-initiative-card--defeated',
      hidden && 'atlas-initiative-card--hidden',
      token?.offMap === true && 'atlas-initiative-card--off-map',
      entry.sitsOut && 'atlas-initiative-card--sitting-out',
      entry.delayed && 'atlas-initiative-card--delayed',
    ].filter(Boolean).join(' ');
    const card = this.el('div', classes, parent);
    card.draggable = true;
    card.setAttribute('role', 'listitem');
    card.setAttribute('aria-roledescription', 'initiative card');
    card.setAttribute('aria-label', name);
    card.setAttribute(TURN_KEY_ATTRIBUTE, entry.id);
    card.dataset.entry = entry.id;
    // Its turn flashes in its token's ring colour
    const flash = turnColor(token);
    if (flash) card.style.setProperty('--atlas-turn-color', flash);

    // The life it lost rises in red over its art (`woundShare`, of the resources that defeat it)
    const lost = token ? woundShare(visibleResources(token, definitions, [], 'gm').filter(({ definition }) => definition.defeatedWhenSpent)) : null;
    const art = (frame: HTMLElement, imagePath: string): void => {
      const img = this.el('img', '', frame);
      img.src = this.host.imageUrl(imagePath);
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';
      // Its art alone, where the image has transparent margins, so it fills the card
      this.host.artViewBox?.(imagePath, (viewBox) => img.style.setProperty('--atlas-art-view-box', viewBox));
      if (lost !== null) this.el('div', 'atlas-initiative-wound', frame).style.setProperty('--atlas-wound', String(lost));
      frame.setAttribute('aria-hidden', 'true');
    };
    const imagePath = token?.imagePath ?? entry.imagePath;
    // Its badge number and what the players do not see of it, at the art's corner or beside the name
    const marks = (parent: HTMLElement): void => {
      const badge = this.instanceBadge(token);
      if (badge !== null) this.el('span', 'atlas-initiative-card__instance-badge', parent, String(badge));
      if (hidden) {
        const eye = this.el('span', 'atlas-initiative-card__hidden-badge', parent);
        eye.setAttribute('aria-label', 'Hidden from players');
        this.icon(eye, 'eye-off');
      }
    };
    if (compact) {
      // The compact line: the token's art faded in from the right end, the name beside the number, the marks last.
      if (imagePath) art(this.el('div', `atlas-initiative-card__backdrop${token?.showRing === false ? ' atlas-initiative-card__backdrop--framed' : ''}`, card), imagePath);
      const line = this.el('span', 'atlas-initiative-card__marks', card);
      if (defeated) this.icon(this.el('span', 'atlas-initiative-card__defeated-mark', line), 'skull');
      marks(line);
    } else {
      if (imagePath) art(this.el('div', `atlas-initiative-card__art${token?.showRing === false ? ' atlas-initiative-card__art--framed' : ''}`, card), imagePath);
      else this.icon(this.el('div', 'atlas-initiative-card__avatar', card), entry.isNPC ? 'bot' : 'user');
      if (defeated) this.icon(this.el('div', 'atlas-initiative-card__defeated-overlay', card), 'skull');
      marks(this.el('span', 'atlas-initiative-card__marks', card));
    }
    if (compact) this.el('span', 'atlas-initiative-card__name', card, name).setAttribute('aria-hidden', 'true');

    // A combatant added and not yet rolled (Atlas 0.9's `awaitingInitiative`) shows an empty slot; by cards, its card.
    const dealt = typeof entry.card === 'number' ? entry.card : null;
    if (!bySides) {
      const empty = dealt === null && entry.awaitingInitiative === true;
      const number = this.el('button', `atlas-initiative-card__initiative${empty ? ' atlas-initiative-card__initiative--empty' : ''}`, card, dealt !== null ? String(dealt) : empty ? '–' : String(entry.initiative));
      number.type = 'button';
      number.setAttribute('aria-label', empty ? 'Type a number' : `Edit initiative ${entry.initiative}`);
      number.addEventListener('click', (event) => { event.stopPropagation(); this.openPopup(entry, card); });
    }

    // A combatant without a token has none to show.
    if (entry.tokenId !== undefined) {
      const tokenId = entry.tokenId;
      card.addEventListener('click', () => this.host.showToken(tokenId));
    }
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
      const first = event.clientX < rect.left + rect.width / 2;
      card.classList.toggle('tabletop-initiative-card--drop-before', first);
      card.classList.toggle('tabletop-initiative-card--drop-after', !first);
      this.dragOver = index;
    });
    card.addEventListener('dragleave', () => card.classList.remove('tabletop-initiative-card--drop-before', 'tabletop-initiative-card--drop-after'));
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      card.classList.remove('tabletop-initiative-card--drop-before', 'tabletop-initiative-card--drop-after');
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

  /** The options menu (Atlas 0.18's `initiativeTrackerOptions`), read again whenever it redraws: the host's switches, then Reset and Clear. */
  private optionsMenu(): MenuEntry[] {
    const empty = this.host.state().entries.length === 0;
    const rows: MenuEntry[] = [];
    if (this.host.offers('resetNumbers')) {
      rows.push({ type: 'item', label: at('initiative.resetNumbers'), icon: 'rotate-ccw', description: at('initiative.resetNumbersHint'), disabled: empty, onClick: () => this.host.act({ type: 'resetNumbers' }) });
    }
    if (this.host.offers('reset')) {
      rows.push({ type: 'item', label: at('initiative.clear'), icon: 'trash-2', destructive: true, disabled: empty, onClick: () => this.host.act({ type: 'reset' }) });
    }
    return [...(this.host.options?.() ?? []), ...(rows.length > 0 ? [{ type: 'separator' } as MenuEntry] : []), ...rows];
  }

  /** The card's menu (Atlas's `initiativeCardMenu`), read again whenever the menu redraws. */
  private cardMenu(entryId: string, card: HTMLElement): MenuEntry[] {
    const state = this.host.state();
    const entry = state.entries.find((candidate) => candidate.id === entryId);
    if (!entry) return [];
    const rules = this.host.rules();
    const bySides = listedBySides(state, rules);
    const token = entry.tokenId === undefined ? undefined : this.host.tokens().find((candidate) => candidate.id === entry.tokenId);
    const tokenId = entry.tokenId;
    const hidden = token?.hidden ?? false;
    // A token on one of the two built-in sides moves to the other; one on a side Atlas 0.9 named is moved in Atlas.
    const own = sideOf(token, fightSides(state, rules));
    const other = own === 'players' || own === 'opponents' ? otherSide(own) : null;
    const item = (label: string, onClick: () => void): MenuEntry => ({ type: 'item', label, onClick });
    return [
      ...(bySides ? [] : [item('Roll Initiative', () => this.host.roll(entry.id))]),
      item('Move to Front', () => this.host.act({ type: 'front', id: entry.id })),
      item('Move to Back', () => this.host.act({ type: 'back', id: entry.id })),
      ...(bySides
        ? [
          ...(other && tokenId !== undefined ? [item(`Move to ${SIDE_LABELS[other]}`, () => this.host.setSide(tokenId!, other))] : []),
          ...(state.isActive && this.host.offers('sitsOut')
            ? [item(entry.sitsOut ? 'Act This Round' : 'Sit Out This Round', () => this.host.act({ type: 'sitsOut', id: entry.id, sitsOut: !entry.sitsOut }))]
            : []),
        ]
        : [item('Edit Initiative', () => this.openPopup(entry, card))]),
      ...(tokenId !== undefined ? [item(hidden ? 'Show to Players' : 'Hide from Players', () => this.host.setHidden(tokenId, !hidden))] : []),
      { type: 'item', label: 'Remove from Initiative', destructive: true, onClick: () => this.host.act({ type: 'remove', id: entry.id }) },
    ];
  }

  /** Atlas's edit popup: the total and the GM's own modifier, left of the card; Enter saves, Escape or a click away cancels. */
  private openPopup(entry: InitiativeEntry, card: HTMLElement): void {
    this.closePopup();
    const view = this.doc.defaultView ?? window;
    const anchor = card.getBoundingClientRect();
    const padding = 16;
    // On the page's body, as Atlas portals it, under Tabletop's root for its styles.
    const layer = this.el('div', 'atlas-tabletop-atlas', this.doc.body);
    const backdrop = this.el('div', 'tabletop-initiative-edit-backdrop', layer);
    const popup = this.el('div', 'tabletop-initiative-edit-popup', layer);
    popup.setCssStyles({ position: 'fixed' });
    // Below the card, centred on it and kept on the page: the row stands at the board's top.
    popup.style.top = `${anchor.bottom + padding}px`;
    const fields = this.el('div', 'tabletop-initiative-edit-popup__fields', popup);
    const field = (caption: string, value: string, extra: string, placeholder: string): HTMLInputElement => {
      const label = this.el('label', 'tabletop-initiative-edit-popup__field', fields);
      this.el('span', 'tabletop-initiative-edit-popup__caption', label, caption);
      const input = this.el('input', `tabletop-initiative-edit-popup__input${extra}`, label);
      input.type = 'number';
      input.value = value;
      input.placeholder = placeholder;
      return input;
    };
    const total = field('Initiative', String(entry.initiative), '', '0');
    const modifier = field('Modifier', modifierText(entry), ' tabletop-initiative-edit-popup__input--modifier', 'auto');
    this.el('span', 'tabletop-initiative-edit-popup__hint', popup, 'Enter to save · Esc to cancel');
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
    popup.style.left = `${Math.max(padding, Math.min(view.innerWidth - popup.offsetWidth - padding, anchor.left + anchor.width / 2 - popup.offsetWidth / 2))}px`;
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

  /** A button of one of the bars above and below the row: Atlas's ghost icon button. */
  private button(parent: HTMLElement, icon: string, tooltip: string, disabled: boolean, onClick: () => void, extra = ''): HTMLButtonElement {
    const button = this.el('button', `btn btn--ghost btn--icon atlas-initiative-tracker__btn${extra ? ` ${extra}` : ''}`, parent);
    button.type = 'button';
    button.disabled = disabled;
    if (tooltip) {
      button.setAttribute('aria-label', tooltip);
      button.setAttribute('data-tooltip-position', 'bottom');
    }
    if (icon) this.icon(button, icon);
    button.addEventListener('click', (event) => { event.stopPropagation(); onClick(); });
    return button;
  }

  private truce(): SVGSVGElement {
    const svg = this.doc.win.createSvg('svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('aria-hidden', 'true');
    const path = this.doc.win.createSvg('path');
    path.setAttribute('d', TRUCE_PATH);
    svg.appendChild(path);
    return svg;
  }

  private icon(element: HTMLElement, name: string): void {
    this.host.icon(element, name);
  }

  private el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
    const made = this.doc.win.createEl(tag);
    if (className) made.className = className;
    if (text !== undefined) made.textContent = text;
    parent.appendChild(made);
    return made;
  }
}
