/**
 * Casting a spell through a token's eyes (`spells.ts`): a toolbar along the bottom of the view, in place of Connect's
 * while the eyes are open, showing one step of a cast at a time.
 *
 * - At rest: Cast a spell (F), Clear my spells, Leave.
 * - The choice: the shape (sphere, cube, cylinder, cone, wall), where it starts (from the caster, or at a point they
 *   see) and its sizes in squares (a wall's thickness, height and longest run); Aim.
 * - Aiming: the shape follows the view (from the caster) or the crosshair (at a point). A click (a tap on Place) sets
 *   it. A wall takes two: its ends, the second no farther than its longest run.
 * - At a point, the shape can then be moved and turned with the handles round it (arrows and rings, `spellGizmo.ts`);
 *   Next.
 * - The confirmation: what it is and what it hits; Cast sends it.
 *
 * Its damage (fire, cold, ... `spellEffects.ts` draws each) is picked with the shape, or at the confirmation; it stays
 * for the next cast.
 *
 * The GM may ask a token for a spell (`SpellRequest`): its shape, start and sizes set. The toolbar then asks the player,
 * in or out of the eyes: Aim (into the token's eyes, straight to aiming it) or Decline. The choice is skipped; the
 * rest goes as above, and Cast answers the ask.
 *
 * Where the board has spell notes to search (`book`: Obsidian's boards, never the web player's), Find a spell opens the
 * search (`spellPicker.ts`): the spell picked sets the shape, its sizes and its damage, and its words stay open over
 * the view while it is aimed. An ask carrying a spell's words shows them first, open, foldable (`SpellAboutCard`).
 *
 * Throughout, the board draws the shape and outlines what it hits (`preview`). Pure DOM over the board; the board gives
 * it the view, the aim and the handles (`SpellCasterHost`).
 */
import type { SpellRules } from './spellRules';
import * as THREE from 'three';
import { clampWallEnd, DAMAGE_NAMES, DAMAGE_TYPES, isDamageType, spellLabel, SPELL_SHAPES, type DamageType, type Spell, type SpellAbout, type SpellAsk, type SpellFrom, type SpellRequest, type SpellShape } from './spells';
import { SEARCH_ICON, SpellAboutCard, SpellPicker, type SpellBook } from './spellPicker';

export interface SpellCasterHost {
  readonly root: HTMLElement;
  /** A square, map pixels. */
  cell(): number;
  /** A cone's opening, radians. */
  coneAngle(): number;
  /** The token seen through. */
  caster(): string | null;
  /** The eye (board space) and the view's turn, or null outside the eyes. */
  eye(): { position: THREE.Vector3; turn: THREE.Quaternion } | null;
  /** The point of the board under the crosshair (board space), or null. */
  aim(): THREE.Vector3 | null;
  /** Draws the shape being cast (null: none), and says what it hits (names, as the caster sees them). */
  preview(spell: Spell | null): string[];
  /** Puts the handles round the spell set at a point (null: takes them away). */
  handles(spell: Spell | null): void;
  /** Sends the spell; `request` the GM's ask it answers. */
  cast(spell: Spell, request?: string, rules?: SpellRules, words?: { name: string; about?: SpellAbout }): boolean;
  /** Turns down the GM's ask. */
  decline(request: string): void;
  /** Goes into the token's eyes, for an ask of it; false when it cannot. */
  enter(tokenId: string): boolean;
  /** A token's name, as the player sees it. */
  tokenName(tokenId: string): string;
  /** Whether the caster has spells on the scene, and takes them all off. */
  hasOwn(): boolean;
  clearOwn(): void;
  /** Whether the view is turned by a held mouse (pointer lock): a click places then. */
  locked(): boolean;
  lock(on: boolean): void;
  /** Whether the last press was a finger (it aims with a drag and Place). */
  touch(): boolean;
  leave(): void;
  wake(): void;
  /** The spell notes to search; absent or null where there are none (the web player board). */
  book?(): SpellBook | null;
  /** Feet a square (the scene's unit distance). */
  unitDistance?(): number;
}

type Stage = 'idle' | 'form' | 'aim' | 'adjust' | 'confirm';

interface Choice {
  shape: SpellShape;
  from: SpellFrom;
  /** Squares: radius (sphere, cylinder), side (cube), length (cone), thickness (wall). */
  size: number;
  /** Squares: a cylinder's length, a wall's height. */
  length: number;
  /** Squares: a wall's longest run. */
  longest: number;
  /** A cone's opening, radians, when the GM's ask sets it. */
  angle?: number;
}

/** The damage picked (kept across casts and asks); null: none. */
let lastDamage: DamageType | null = null;

const SHAPE_NAMES: Record<SpellShape, string> = { sphere: 'Sphere', cube: 'Cube', cylinder: 'Cylinder', cone: 'Cone', wall: 'Wall' };
/** Squares each shape starts at: a sphere's radius, a cube's side, a beam a square across and long, a wall a square thick. */
const SIZES: Record<SpellShape, { size: number; length: number }> = {
  sphere: { size: 4, length: 4 }, cube: { size: 4, length: 4 }, cylinder: { size: 1, length: 12 }, cone: { size: 6, length: 4 }, wall: { size: 1, length: 4 },
};

/** The toolbar's icons (24 × 24, drawn in the text colour). */
const ICONS: Record<string, string> = {
  sphere: '<circle cx="12" cy="12" r="8"/><ellipse cx="12" cy="12" rx="8" ry="3"/>',
  cube: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
  cylinder: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>',
  cone: '<path d="M12 3 5 18.5M12 3l7 15.5"/><ellipse cx="12" cy="18.5" rx="7" ry="2.5"/>',
  wall: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M3 10h18M3 14h18M9 6v4M15 10v4M9 14v4"/>',
  self: '<circle cx="12" cy="7" r="3.5"/><path d="M5 21c0-4 3.1-7 7-7s7 3 7 7"/>',
  point: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  spark: '<path d="M12 2.5 14 10l7.5 2-7.5 2-2 7.5-2-7.5-7.5-2 7.5-2z"/>',
  aim: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  eraser: '<path d="m7 21-4-4 10-10 8 8-6 6z"/><path d="M7 21h14M9 11l6 6"/>',
  leave: '<path d="M14 4h5v16h-5"/><path d="M10 8 6 12l4 4M6 12h10"/>',
  minus: '<path d="M6 12h12"/>',
  search: SEARCH_ICON,
  plus: '<path d="M12 6v12M6 12h12"/>',
};

/** An ask in words: its name, shape and sizes in squares, where it starts. */
function askWords(request: SpellRequest, cell: number): string {
  const { ask } = request;
  const sq = (pixels: number): string => String(Math.round((pixels / cell) * 100) / 100);
  const sizes = ask.shape === 'wall'
    ? `${sq(ask.size)} thick, ${sq(ask.length)} high${ask.longest !== undefined ? `, up to ${sq(ask.longest)} long` : ''}`
    : ask.shape === 'cylinder' ? `radius ${sq(ask.size)}, length ${sq(ask.length)}`
      : `${ask.shape === 'cube' ? 'side' : ask.shape === 'cone' ? 'length' : 'radius'} ${sq(ask.size)}`;
  const start = ask.shape === 'wall' ? '' : ask.from === 'self' ? ', from them' : ', at a point';
  return `${ask.name ? `${ask.name} (` : ''}${SHAPE_NAMES[ask.shape]}, ${sizes} sq${start}${ask.name ? ')' : ''}`;
}

const sizeName = (choice: Choice): string => {
  switch (choice.shape) {
    case 'sphere': return 'Radius';
    case 'cube': return 'Side';
    case 'cylinder': return 'Radius';
    case 'cone': return 'Length';
    case 'wall': return 'Thick';
  }
};

export class SpellCaster {
  private stage: Stage = 'idle';
  private choice: Choice = { shape: 'sphere', from: 'point', ...SIZES.sphere, longest: 12 };
  /** The sizes last set for each shape, kept while another is picked. */
  private readonly sizes: Record<SpellShape, { size: number; length: number }> = structuredClone(SIZES);
  /** The shape set (at a point: where the click put it, as moved and turned since; from the caster: as aimed). */
  private set: Spell | null = null;
  /** A wall's first end, once clicked. */
  private wallStart: { x: number; y: number; h: number } | null = null;
  private hits: string[] = [];
  private readonly bar: HTMLElement;
  private readonly cross: HTMLElement;
  private shown = false;
  /** What the GM asks of the player's tokens; the one being cast. */
  private asks: SpellRequest[] = [];
  private asked: SpellRequest | null = null;
  /** The spell search, while open. */
  private picker: SpellPicker | null = null;
  /** The words of the spell being cast (picked, or the ask's), or of the ask offered. */
  private readonly card: SpellAboutCard;
  /** The spell picked from the notes, while it is cast: its name and words. */
  private chosen: { name: string; about: SpellAbout } | null = null;
  /** What the spell picked does beyond its shape (`spellRules.ts`), sent with the cast. */
  private rules: SpellRules | null = null;

  /** The rules of the spell being cast (the ask's, else the one picked): its drawing shows them while it is aimed. */
  get currentRules(): SpellRules | null {
    return this.asked?.ask.rules ?? this.rules;
  }

  constructor(private readonly host: SpellCasterHost) {
    const doc = host.root.ownerDocument;
    this.cross = doc.createElement('div');
    this.cross.className = 'atlas-tabletop-crosshair';
    this.bar = doc.createElement('div');
    this.bar.className = 'atlas-tabletop-spellbar';
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', 'Spells');
    this.bar.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (this.stage === 'idle') this.host.leave(); else this.back();
    });
    // Presses on the bar are its own, not the board's.
    this.bar.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.bar.addEventListener('wheel', (event) => event.stopPropagation());
    for (const element of [this.cross, this.bar]) { element.hidden = true; host.root.append(element); }
    this.card = new SpellAboutCard(host.root);
  }

  /** Whether spells can be searched here. */
  get canSearch(): boolean {
    return (this.host.book?.() ?? null) !== null;
  }

  /** Whether the search is open: for tests, and the board's keys. */
  get searching(): SpellPicker | null {
    return this.picker?.isOpen ? this.picker : null;
  }

  /** The spell card: for tests. */
  get spellCard(): SpellAboutCard {
    return this.card;
  }

  /** Opens the search (Find a spell): the spell picked is aimed at once, its words over the view. */
  openSearch(): SpellPicker | null {
    const book = this.host.book?.() ?? null;
    if (!book || !this.shown) return null;
    if (this.picker?.isOpen) return this.picker;
    if (this.stage !== 'idle' && this.stage !== 'form') this.cancel();
    if (this.host.locked()) this.host.lock(false);
    const cell = this.host.cell();
    this.picker = new SpellPicker(this.host.root, {
      book, title: 'Find a spell', cell: () => cell, unitDistance: () => this.host.unitDistance?.() ?? 5,
      changed: (ask) => {
        if (!ask) { this.host.preview(null); this.host.wake(); return; }
        // While it is picked: the shape as it would go, from here.
        this.useAsk(ask);
        this.host.preview(this.aimed());
        this.host.wake();
      },
      actions: [
        { label: 'Aim', primary: true, run: (ask, entry) => {
          this.useAsk(ask);
          this.chosen = entry && ask.about ? { name: entry.note.name, about: ask.about } : null;
          this.picker?.close();
          this.go('aim');
        } },
        { label: 'Cancel', run: () => this.picker?.close() },
      ],
      closed: () => { this.picker = null; this.drawCard(); this.draw(); },
    });
    this.draw();
    return this.picker;
  }

  /** The shape, sizes and damage an ask (or the search) sets. */
  private useAsk(ask: SpellAsk): void {
    const cell = this.host.cell();
    this.choice = {
      shape: ask.shape, from: ask.shape === 'wall' ? 'point' : ask.from, size: ask.size / cell, length: ask.length / cell,
      longest: ask.longest !== undefined ? ask.longest / cell : 12, ...(ask.angle !== undefined ? { angle: ask.angle } : {}),
    };
    lastDamage = ask.effect ?? null;
    this.rules = ask.rules ?? null;
  }

  /** The card shows the words of the spell being cast, else of the ask offered. */
  private drawCard(): void {
    const offer = this.stage === 'idle' && !this.picker ? this.asks[0] ?? null : null;
    const asked = this.asked?.ask.about ? { name: this.asked.ask.name ?? 'Spell', about: this.asked.ask.about } : null;
    const offered = offer?.ask.about ? { name: offer.ask.name ?? 'Spell', about: offer.ask.about } : null;
    const words = this.stage !== 'idle' ? asked ?? this.chosen : offered;
    this.card.show(words?.name ?? null, words?.about ?? null);
  }

  /** Whether a cast is under way (a click on the board places it while aiming). */
  get busy(): boolean {
    return this.stage !== 'idle';
  }

  get aiming(): boolean {
    return this.stage === 'aim';
  }

  /** The spell set at a point, while it is moved and turned by its handles. */
  get adjusting(): Spell | null {
    return this.stage === 'adjust' ? this.set : null;
  }

  /** The handles moved or turned the spell. */
  adjusted(spell: Spell): void {
    if (this.stage !== 'adjust') return;
    this.set = spell;
    this.hits = this.host.preview(spell);
    this.drawText();
    this.host.wake();
  }

  /** What the GM asks of the player's tokens now: one no longer asked stops being cast. */
  ask(list: readonly SpellRequest[]): void {
    this.asks = [...list];
    if (this.asked && !list.some((each) => each.id === this.asked!.id)) this.cancel();
    else this.draw();
  }

  /** The ask the toolbar offers, or is casting. */
  get request(): SpellRequest | null {
    return this.asked ?? this.asks[0] ?? null;
  }

  /** Aim on an ask: into the token's eyes, its shape and sizes as the GM set them, straight to aiming. */
  takeAsk(request: SpellRequest): void {
    if (!this.host.enter(request.tokenId)) return;
    const cell = this.host.cell();
    const { ask } = request;
    this.choice = {
      shape: ask.shape, from: ask.shape === 'wall' ? 'point' : ask.from, size: ask.size / cell, length: ask.length / cell,
      longest: ask.longest !== undefined ? ask.longest / cell : 1e6, ...(ask.angle !== undefined ? { angle: ask.angle } : {}),
    };
    if (ask.effect) lastDamage = ask.effect;
    this.asked = request;
    this.go('aim');
  }

  private declineAsk(request: SpellRequest): void {
    this.host.decline(request.id);
    this.asks = this.asks.filter((each) => each.id !== request.id);
    if (this.asked?.id === request.id) this.cancel(); else this.draw();
  }

  /** The eyes opened or closed: the toolbar shows with them. */
  show(on: boolean): void {
    if (this.shown === on) return;
    this.shown = on;
    if (!on) { this.picker?.close(); this.cancel(); }
    this.draw();
  }

  /** Each frame through the eyes: the shape aimed follows the view. */
  frame(): void {
    if (this.stage !== 'aim') return;
    const spell = this.aimed();
    const hits = this.host.preview(spell);
    if (hits.join('\n') !== this.hits.join('\n')) {
      this.hits = hits;
      this.drawText();
    }
  }

  /** A click on the board (or Place): sets what is aimed. True when it was taken. */
  click(): boolean {
    if (this.stage !== 'aim') return false;
    const spell = this.aimed();
    if (!spell) return true;
    if (this.choice.shape === 'wall' && !this.wallStart) {
      this.wallStart = { ...spell.at };
      this.draw();
      return true;
    }
    this.set = spell;
    this.go(this.choice.shape === 'wall' || this.choice.from === 'self' ? 'confirm' : 'adjust');
    return true;
  }

  /** One step back (Escape): from the confirmation to the step before, else the cast stops. */
  back(): void {
    if (this.stage === 'confirm') {
      if (this.choice.shape !== 'wall' && this.choice.from === 'point') { this.go('adjust'); return; }
      this.wallStart = null;
      this.go('aim');
      return;
    }
    if (this.stage === 'adjust' || (this.stage === 'aim' && this.wallStart)) {
      this.wallStart = null;
      this.go('aim');
      return;
    }
    if (this.stage === 'aim' && !this.asked) { this.chosen = null; this.go('form'); return; }
    this.cancel();
  }

  /** Opens the choice (F, or the toolbar's button). */
  open(): void {
    if (this.shown && this.stage === 'idle') this.go('form');
  }

  /** The mouse held or let go, or the spells changed: the toolbar follows. */
  refresh(): void {
    this.draw();
  }

  cancel(): void {
    if (this.asked) {
      // Back from an ask: the choice is the player's own again.
      this.asked = null;
      this.choice = { shape: this.choice.shape, from: this.choice.from, ...this.sizes[this.choice.shape], longest: 12 };
    }
    this.chosen = null;
    this.rules = null;
    this.set = null;
    this.wallStart = null;
    this.hits = [];
    this.host.preview(null);
    this.host.handles(null);
    this.stage = 'idle';
    this.draw();
  }

  dispose(): void {
    this.picker?.close();
    this.card.dispose();
    this.cross.remove();
    this.bar.remove();
  }

  private go(stage: Stage): void {
    this.stage = stage;
    if (stage === 'aim') {
      this.set = null;
      this.host.lock(true);
    } else if (this.host.locked()) {
      this.host.lock(false);
    }
    if (stage === 'adjust' || stage === 'confirm') this.hits = this.host.preview(this.set);
    if (stage === 'form' || stage === 'idle') { this.hits = []; this.host.preview(null); }
    this.host.handles(stage === 'adjust' ? this.set : null);
    this.draw();
    this.host.wake();
  }

  /** The shape as the view aims it now; null when the crosshair is on nothing. */
  private aimed(): Spell | null {
    const eye = this.host.eye();
    if (!eye) return null;
    const cell = this.host.cell();
    const { shape, from } = this.choice;
    const euler = new THREE.Euler().setFromQuaternion(eye.turn, 'YXZ');
    const common = {
      shape, from, yaw: euler.y, pitch: 0, roll: 0, size: this.choice.size * cell, length: 0, angle: this.choice.angle ?? this.host.coneAngle(),
      ...(lastDamage ? { effect: lastDamage } : {}),
      ...(this.host.caster() ? { caster: this.host.caster()! } : {}),
    };
    if (shape === 'wall') {
      const point = this.host.aim();
      if (!point) return null;
      const floor = { x: point.x, y: point.z, h: Math.max(0, point.y) };
      const start = this.wallStart ?? floor;
      const end = this.wallStart ? clampWallEnd(start, { x: floor.x, y: floor.y }, this.choice.longest * cell) : { x: floor.x + 1e-3, y: floor.y };
      return { ...common, from: 'point', at: { ...start }, to: end, yaw: 0, length: this.choice.length * cell };
    }
    const length = shape === 'cylinder' ? this.choice.length * cell : 0;
    if (from === 'self') {
      // From the caster: the way they look, up and down too.
      return { ...common, at: { x: eye.position.x, y: eye.position.z, h: eye.position.y }, pitch: euler.x, length };
    }
    const point = this.host.aim();
    if (!point) return null;
    // At a point: square to the view's heading; a cylinder stands up.
    return { ...common, at: { x: point.x, y: point.z, h: point.y }, pitch: shape === 'cylinder' ? Math.PI / 2 : 0, length };
  }

  // ---- The toolbar ----

  private make(tag: string, cls?: string, text?: string): HTMLElement {
    const element = this.host.root.ownerDocument.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  private icon(name: string): SVGSVGElement {
    const doc = this.host.root.ownerDocument;
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = ICONS[name] ?? '';
    return svg;
  }

  /** A toolbar button: an icon, its name on hover (and spoken), and words beside the icon when `words`. */
  private button(label: string, icon: string, run: () => void, options: { words?: string; pressed?: boolean; primary?: boolean } = {}): HTMLButtonElement {
    const button = this.make('button', 'atlas-tabletop-spellbar__button') as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.dataset.label = label;
    button.append(this.icon(icon));
    if (options.words) button.append(this.make('span', '', options.words));
    if (options.pressed !== undefined) {
      button.setAttribute('aria-pressed', String(options.pressed));
      button.classList.toggle('is-active', options.pressed);
    }
    if (options.primary) button.classList.add('is-primary');
    button.addEventListener('click', (event) => { event.stopPropagation(); run(); });
    return button;
  }

  private group(...children: HTMLElement[]): HTMLElement {
    const group = this.make('div', 'atlas-tabletop-spellbar__group');
    group.append(...children);
    return group;
  }

  /** The damage's picker: none, or one of D&D's types; a change shows on the shape at once. */
  private damagePicker(): HTMLElement {
    const field = this.make('label', 'atlas-tabletop-spellbar__size atlas-tabletop-spellbar__damage');
    field.append(this.make('span', 'atlas-tabletop-spellbar__size-name', 'Damage'));
    const select = this.make('select') as HTMLSelectElement;
    select.dataset.spellField = 'effect';
    select.setAttribute('aria-label', 'Damage type');
    const none = this.make('option', '', 'None') as HTMLOptionElement;
    none.value = '';
    select.append(none, ...DAMAGE_TYPES.map((type) => {
      const option = this.make('option', '', DAMAGE_NAMES[type]) as HTMLOptionElement;
      option.value = type;
      return option;
    }));
    select.value = lastDamage ?? '';
    select.addEventListener('change', () => {
      lastDamage = isDamageType(select.value) ? select.value : null;
      if (this.set) {
        const { effect: _old, ...rest } = this.set;
        this.set = lastDamage ? { ...rest, effect: lastDamage } : rest;
        this.hits = this.host.preview(this.set);
        if (this.stage === 'adjust') this.host.handles(this.set);
      }
      this.host.wake();
    });
    select.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    field.append(select);
    return field;
  }

  /** A size in squares, with steps of a half either way. */
  private stepper(label: string, key: 'size' | 'length' | 'longest'): HTMLElement {
    const field = this.make('label', 'atlas-tabletop-spellbar__size');
    field.append(this.make('span', 'atlas-tabletop-spellbar__size-name', label));
    const input = this.make('input') as HTMLInputElement;
    input.type = 'number';
    input.min = '0.5';
    input.max = '100';
    input.step = '0.5';
    input.value = String(this.choice[key]);
    input.dataset.spellField = key;
    input.setAttribute('aria-label', `${label} in squares`);
    const take = (value: number): void => {
      if (!Number.isFinite(value) || value <= 0 || value > 100) return;
      this.choice = { ...this.choice, [key]: value };
    };
    input.addEventListener('input', () => take(Number(input.value)));
    input.addEventListener('keydown', (event) => { if (event.key !== 'Escape') event.stopPropagation(); });
    const step = (by: number): void => {
      const value = Math.max(0.5, Math.min(100, Math.round((this.choice[key] + by) * 2) / 2));
      take(value);
      input.value = String(value);
    };
    field.append(this.button(`Less ${label.toLowerCase()}`, 'minus', () => step(-0.5)), input, this.button(`More ${label.toLowerCase()}`, 'plus', () => step(0.5)));
    field.append(this.make('span', 'atlas-tabletop-spellbar__unit', 'sq'));
    return field;
  }

  private draw(): void {
    this.drawCard();
    const eyes = this.shown;
    const offer = this.stage === 'idle' ? this.asks[0] ?? null : null;
    // The search open: the toolbar waits under it.
    this.bar.classList.toggle('is-under', this.picker !== null);
    this.cross.hidden = !eyes || (this.stage !== 'idle' && this.stage !== 'aim');
    // An ask shows out of the eyes too, at the top of the view.
    this.bar.hidden = !eyes && !offer;
    this.bar.classList.toggle('is-ask', offer !== null && !eyes);
    this.bar.dataset.stage = offer ? 'ask' : this.stage;
    if (!eyes && !offer) return;
    if (offer && !eyes) {
      this.bar.replaceChildren(...this.offerParts(offer));
      return;
    }
    const parts: HTMLElement[] = [];
    const touch = this.host.touch();
    const locked = this.host.locked();
    const back = this.button(locked ? 'Back (Esc)' : 'Back', 'back', () => this.back());
    const cancel = this.button('Cancel', 'close', () => this.cancel());
    switch (this.stage) {
      case 'idle': {
        if (offer) parts.push(...this.offerParts(offer));
        const cast = this.button(touch ? 'Cast a spell' : 'Cast a spell (F)', 'spark', () => this.go('form'), { words: 'Cast', primary: true });
        parts.push(this.canSearch ? this.group(this.button('Find a spell', 'search', () => this.openSearch(), { words: 'Find' }), cast) : this.group(cast));
        if (this.host.hasOwn()) parts.push(this.group(this.button('Clear my spells', 'eraser', () => { this.host.clearOwn(); this.draw(); })));
        parts.push(this.group(this.button(locked ? 'Leave (Esc)' : 'Leave', 'leave', () => this.host.leave())));
        if (!touch) parts.push(this.make('span', 'atlas-tabletop-spellbar__text', locked ? 'F: cast · right click: free the mouse' : 'Click the view to look around'));
        break;
      }
      case 'form': {
        if (this.canSearch) parts.push(this.group(this.button('Find a spell', 'search', () => this.openSearch())));
        parts.push(this.group(...SPELL_SHAPES.map((shape) => this.button(SHAPE_NAMES[shape], shape, () => {
          this.sizes[this.choice.shape] = { size: this.choice.size, length: this.choice.length };
          this.choice = { ...this.choice, shape, ...this.sizes[shape] };
          this.draw();
        }, { pressed: this.choice.shape === shape }))));
        if (this.choice.shape !== 'wall') {
          parts.push(this.group(
            this.button('From me', 'self', () => { this.choice = { ...this.choice, from: 'self' }; this.draw(); }, { pressed: this.choice.from === 'self' }),
            this.button('At a point', 'point', () => { this.choice = { ...this.choice, from: 'point' }; this.draw(); }, { pressed: this.choice.from === 'point' }),
          ));
        }
        const sizes = [this.stepper(sizeName(this.choice), 'size')];
        if (this.choice.shape === 'cylinder') sizes.push(this.stepper('Length', 'length'));
        if (this.choice.shape === 'wall') sizes.push(this.stepper('High', 'length'), this.stepper('Longest', 'longest'));
        parts.push(this.group(...sizes));
        parts.push(this.group(this.damagePicker()));
        parts.push(this.group(this.button('Aim', 'aim', () => this.go('aim'), { words: 'Aim', primary: true }), cancel));
        break;
      }
      case 'aim': {
        parts.push(this.make('span', 'atlas-tabletop-spellbar__text'));
        const actions: HTMLElement[] = [];
        if (!locked) actions.push(this.button('Place', 'check', () => this.click(), { words: 'Place', primary: true }));
        actions.push(back);
        parts.push(this.group(...actions));
        break;
      }
      case 'adjust':
        parts.push(this.make('span', 'atlas-tabletop-spellbar__text'));
        parts.push(this.group(this.button('Next', 'check', () => this.go('confirm'), { words: 'Next', primary: true }), back, cancel));
        break;
      case 'confirm':
        parts.push(this.make('span', 'atlas-tabletop-spellbar__text'));
        parts.push(this.group(this.damagePicker()));
        parts.push(this.group(
          this.button('Cast', 'spark', () => {
            const spell = this.set;
            const request = this.asked?.id;
            const own = this.asked?.ask.rules ?? this.rules ?? undefined;
            const named = this.asked?.ask.name ?? this.chosen?.name;
            const rules = own ? { ...own, ...(named ? { name: named } : {}) } : undefined;
            const about = this.asked?.ask.about ?? this.chosen?.about;
            const words = named ? { name: named, ...(about ? { about } : {}) } : undefined;
            if (!spell || !this.host.cast(spell, request, rules, words)) return;
            if (request !== undefined) this.asks = this.asks.filter((each) => each.id !== request);
            this.cancel();
          }, { words: 'Cast', primary: true }),
          back, cancel,
        ));
        break;
    }
    this.bar.replaceChildren(...parts);
    this.drawText();
  }

  /** An ask offered: what the GM asks of which token, Aim and Decline. */
  private offerParts(request: SpellRequest): HTMLElement[] {
    const words = this.make('span', 'atlas-tabletop-spellbar__ask', `GM asks ${this.host.tokenName(request.tokenId)}: ${askWords(request, this.host.cell())}`);
    const more = this.asks.length > 1 ? [this.make('span', 'atlas-tabletop-spellbar__more', `+${this.asks.length - 1}`)] : [];
    return [this.group(words, ...more), this.group(
      this.button('Aim the spell asked', 'aim', () => this.takeAsk(request), { words: 'Aim', primary: true }),
      this.button('Decline', 'close', () => this.declineAsk(request), { words: 'Decline' }),
    )];
  }

  /** The words of the step: what to do, and what the shape hits. */
  private drawText(): void {
    const text = this.bar.querySelector<HTMLElement>('.atlas-tabletop-spellbar__text');
    if (!text || this.stage === 'idle') return;
    const hits = this.hits.length === 0 ? 'hits nothing you see' : `hits ${this.hits.length}: ${this.hits.join(', ')}`;
    let words = this.asked ? `${this.asked.ask.name ?? 'Asked'} · ` : this.chosen ? `${this.chosen.name} · ` : '';
    if (this.stage === 'aim') {
      const wall = this.choice.shape === 'wall';
      const what = wall ? (this.wallStart ? 'the wall\'s other end' : 'where the wall starts') : this.choice.from === 'self' ? 'which way it goes' : 'its middle';
      words += `${this.host.locked() ? 'Click' : 'Aim and Place'} to set ${what} · ${hits}`;
    } else if (this.stage === 'adjust') {
      words += `Drag the arrows to move it, the rings to turn it (Shift: freely) · ${hits}`;
    } else if (this.stage === 'confirm' && this.set) {
      words += `${spellLabel(this.set, this.host.cell())} sq${this.set.from === 'self' && this.set.shape !== 'wall' ? ', from you' : ''} · ${hits}`;
    }
    text.textContent = words;
    text.dataset.hits = String(this.hits.length);
  }
}
