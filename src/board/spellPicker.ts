/**
 * Finding a spell in the spell notes (`spellNotes.ts`) on the 3D board: a search box, the spells that match (each with
 * its level and where it comes from: the 2014 or 2024 SRD, a homebrew folder), and the one picked shown in full: its
 * level line, its properties (range, area, damage, save, ...), its description. Under it the area to cast, from the
 * spell and changeable (its shape, where it starts, its sizes in squares, its damage's look); a spell without an area
 * starts as a plain sphere, set by hand. The caller's buttons go at the bottom (Aim, Send to the player, ...).
 *
 * Also the spell's words alone, as the player gets them with an ask (`SpellAboutCard`): open first, folded to a small
 * button, opened again. Pure DOM over the board; no Obsidian (the web player board has it too, without the search).
 */
import { DAMAGE_NAMES, DAMAGE_TYPES, isDamageType, SPELL_SHAPES, type DamageType, type SpellAbout, type SpellAsk, type SpellFrom, type SpellShape } from './spells';
import { aboutOf, askFromNote, levelWords, type SpellNote } from './spellNotes';
import { readSpellRules, WALL_LOOKS, type SpellRules } from './spellRules';

/** A spell note found: its path (its id), what it says, and where it comes from (its folder's name). */
export interface SpellEntry {
  id: string;
  note: SpellNote;
  source: string;
}

/** The spell notes a board can search (the vault's, on Obsidian). */
export interface SpellBook {
  search(query: string, limit?: number): Promise<SpellEntry[]>;
}

/** The words of a spell's description as text: paragraphs, with bold and italic; nothing else is made into markup. */
export function renderSpellText(parent: HTMLElement, markdown: string): void {
  const doc = parent.ownerDocument;
  for (const block of markdown.split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(text);
    const p = doc.createElement('p');
    if (heading) p.className = 'atlas-tabletop-spellpicker__heading';
    inline(p, (heading ? heading[1] : text).replace(/\s*\n\s*/g, ' '));
    parent.append(p);
  }
}

/** Bold (`**x**`), italic (`*x*`, `_x_`) and both (`***x***`) as elements; the rest as plain text. */
function inline(parent: HTMLElement, text: string): void {
  const doc = parent.ownerDocument;
  const regex = /(\*\*\*|\*\*|\*|_)(?=\S)(.+?)(?<=\S)\1/g;
  let last = 0;
  for (let match = regex.exec(text); match; match = regex.exec(text)) {
    if (match.index > last) parent.append(doc.createTextNode(text.slice(last, match.index)));
    const mark = match[1];
    const element = doc.createElement(mark === '**' ? 'strong' : 'em');
    if (mark === '***') {
      const strong = doc.createElement('strong');
      strong.textContent = match[2];
      element.append(strong);
    } else {
      element.textContent = match[2];
    }
    parent.append(element);
    last = match.index + match[0].length;
  }
  if (last < text.length) parent.append(doc.createTextNode(text.slice(last)));
}

/** A spell's words: its name, level line, properties and description. */
export function aboutElement(doc: Document, name: string, about: SpellAbout): HTMLElement {
  const root = doc.createElement('div');
  root.className = 'atlas-tabletop-spellabout';
  const title = doc.createElement('div');
  title.className = 'atlas-tabletop-spellabout__name';
  title.textContent = name;
  const line = doc.createElement('div');
  line.className = 'atlas-tabletop-spellabout__line';
  line.textContent = about.line;
  const grid = doc.createElement('dl');
  grid.className = 'atlas-tabletop-spellabout__props';
  for (const [label, value] of about.properties) {
    const dt = doc.createElement('dt');
    dt.textContent = label;
    const dd = doc.createElement('dd');
    dd.textContent = value;
    grid.append(dt, dd);
  }
  const text = doc.createElement('div');
  text.className = 'atlas-tabletop-spellabout__text';
  renderSpellText(text, about.text);
  root.append(title, line, grid, text);
  return root;
}

const BOOK = '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>';
const FOLD = '<path d="M6 12h12"/>';
const CLOSE = '<path d="M6 6l12 12M18 6 6 18"/>';
const SEARCH = '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>';

function svg(doc: Document, paths: string): SVGSVGElement {
  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = paths;
  return icon;
}

export const SEARCH_ICON = SEARCH;

/**
 * A spell's words, over the board's top left: open when shown (the first thing the player sees with an ask), folded
 * to a small button with its name by its fold button, opened again by that.
 */
export class SpellAboutCard {
  readonly element: HTMLElement;
  private folded = false;
  private shown: { name: string; about: SpellAbout } | null = null;

  constructor(private readonly root: HTMLElement) {
    this.element = root.ownerDocument.createElement('div');
    this.element.className = 'atlas-tabletop-spellcard';
    this.element.hidden = true;
    this.element.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.element.addEventListener('wheel', (event) => event.stopPropagation());
    root.append(this.element);
  }

  /** Shows a spell's words, open (a spell other than the one shown); null hides them. */
  show(name: string | null, about: SpellAbout | null): void {
    if (!name || !about) {
      this.shown = null;
      this.element.hidden = true;
      return;
    }
    if (this.shown?.name !== name || this.shown.about.text !== about.text) this.folded = false;
    this.shown = { name, about };
    this.draw();
  }

  get isFolded(): boolean {
    return this.folded;
  }

  fold(folded: boolean): void {
    this.folded = folded;
    this.draw();
  }

  private draw(): void {
    const shown = this.shown;
    const doc = this.root.ownerDocument;
    this.element.hidden = !shown;
    if (!shown) return;
    this.element.classList.toggle('is-folded', this.folded);
    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.className = 'atlas-tabletop-spellcard__toggle';
    toggle.addEventListener('click', (event) => { event.stopPropagation(); this.fold(!this.folded); });
    if (this.folded) {
      toggle.setAttribute('aria-label', `Show ${shown.name}`);
      toggle.append(svg(doc, BOOK), Object.assign(doc.createElement('span'), { textContent: shown.name }));
      this.element.replaceChildren(toggle);
      return;
    }
    toggle.setAttribute('aria-label', 'Fold the spell');
    toggle.dataset.label = 'Fold';
    toggle.append(svg(doc, FOLD));
    const body = aboutElement(doc, shown.name, shown.about);
    body.prepend(toggle);
    this.element.replaceChildren(body);
  }

  dispose(): void {
    this.element.remove();
  }
}

/** The area being set, in squares, as the picker's fields show it. */
interface Draft {
  name: string;
  shape: SpellShape;
  from: SpellFrom;
  size: number;
  length: number;
  longest: number;
  effect: DamageType | null;
  rules: SpellRules | null;
}

const SHAPE_NAMES: Record<SpellShape, string> = { sphere: 'Sphere', cube: 'Cube', cylinder: 'Cylinder / line', cone: 'Cone', wall: 'Wall' };
const SIZE_NAMES: Record<SpellShape, string> = { sphere: 'Radius', cube: 'Side', cylinder: 'Radius', cone: 'Length', wall: 'Thick' };
const PLAIN: Draft = { name: '', shape: 'sphere', from: 'point', size: 4, length: 0, longest: 12, effect: null, rules: null };

export interface SpellPickerAction {
  label: string;
  primary?: boolean;
  warning?: boolean;
  /** Takes the ask set (a name and an area always), the spell picked (null: none). */
  run(ask: SpellAsk, entry: SpellEntry | null): void;
}

export interface SpellPickerOptions {
  book: SpellBook;
  title: string;
  /** A square: map pixels, and feet (the scene's unit distance). */
  cell(): number;
  unitDistance(): number;
  /** The area being set changed (the board draws it); null when the picker closes. */
  changed?(ask: SpellAsk | null): void;
  actions: SpellPickerAction[];
  /** A note under the title, e.g. what is waiting. */
  note?: string;
  closed?(): void;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The search, the spell picked and its area, over the board: see the module's words. */
export class SpellPicker {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private readonly preview: HTMLElement;
  private results: SpellEntry[] = [];
  private picked: SpellEntry | null = null;
  private index = -1;
  private draft: Draft = { ...PLAIN };
  private searched = 0;
  private open = true;

  constructor(private readonly root: HTMLElement, private readonly options: SpellPickerOptions) {
    const doc = root.ownerDocument;
    this.element = doc.createElement('div');
    this.element.className = 'atlas-tabletop-spellpicker';
    this.element.setAttribute('role', 'dialog');
    this.element.setAttribute('aria-label', options.title);
    for (const type of ['pointerdown', 'wheel', 'contextmenu'] as const) this.element.addEventListener(type, (event) => event.stopPropagation());
    this.element.addEventListener('keydown', (event) => this.key(event));
    const head = doc.createElement('div');
    head.className = 'atlas-tabletop-spellpicker__head';
    const title = doc.createElement('div');
    title.className = 'atlas-tabletop-spellpicker__title';
    title.textContent = options.title;
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'atlas-tabletop-spellpicker__close';
    close.setAttribute('aria-label', 'Close');
    close.append(svg(doc, CLOSE));
    close.addEventListener('click', () => this.close());
    head.append(title, close);
    const field = doc.createElement('label');
    field.className = 'atlas-tabletop-spellpicker__search';
    field.append(svg(doc, SEARCH));
    this.input = doc.createElement('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search spells…';
    this.input.setAttribute('aria-label', 'Search spells');
    this.input.dataset.spellSearch = '';
    this.input.addEventListener('input', () => void this.search());
    field.append(this.input);
    const body = doc.createElement('div');
    body.className = 'atlas-tabletop-spellpicker__body';
    this.list = doc.createElement('div');
    this.list.className = 'atlas-tabletop-spellpicker__list';
    this.list.setAttribute('role', 'listbox');
    this.preview = doc.createElement('div');
    this.preview.className = 'atlas-tabletop-spellpicker__preview';
    body.append(this.list, this.preview);
    this.element.append(head);
    if (options.note) this.element.append(Object.assign(doc.createElement('div'), { className: 'atlas-tabletop-spellpicker__note', textContent: options.note }));
    this.element.append(field, body);
    root.append(this.element);
    this.drawPreview();
    void this.search();
    this.input.focus();
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** For tests: the names listed. */
  get names(): string[] {
    return this.results.map((entry) => entry.note.name);
  }

  /** Types in the search (tests, and a start from a spell's name). */
  async find(query: string): Promise<void> {
    this.input.value = query;
    await this.search();
  }

  /** Picks the result at `index`. */
  choose(index: number): void {
    const entry = this.results[index];
    if (!entry) return;
    this.index = index;
    this.picked = entry;
    const ask = askFromNote(entry.note, this.options.unitDistance(), this.options.cell());
    const cell = this.options.cell();
    this.draft = ask
      ? {
        name: entry.note.name, shape: ask.shape, from: ask.from, size: round(ask.size / cell), length: round(ask.length / cell),
        longest: ask.longest !== undefined ? round(ask.longest / cell) : 12, effect: ask.effect ?? null, rules: null,
      }
      : {
        ...PLAIN, name: entry.note.name, effect: entry.note.damage?.type ?? null,
        // A spell with no area that moves or makes something (Misty Step, Spiritual Weapon): a small mark where it goes.
        ...(entry.note.rules?.teleport || entry.note.rules?.summon || entry.note.rules?.portal ? { size: 0.5 } : {}),
        // A wall spell with no area of its own (Wall of Force) starts as a wall: a tenth of a square thick, two high.
        ...(entry.note.rules?.wall ? { shape: 'wall' as const, from: 'point' as const, size: 0.1, length: 2, longest: 12 } : {}),
      };
    this.draft = { ...this.draft, rules: entry.note.rules };
    this.drawList();
    this.drawPreview();
    this.options.changed?.(this.ask());
  }

  /** The ask the picker sets now. */
  ask(): SpellAsk {
    const cell = this.options.cell();
    const draft = this.draft;
    const name = (draft.name || this.input.value).trim().slice(0, 60);
    return {
      ...(name ? { name } : {}),
      shape: draft.shape, from: draft.shape === 'wall' ? 'point' : draft.from, size: draft.size * cell,
      length: draft.shape === 'wall' || draft.shape === 'cylinder' ? draft.length * cell : 0,
      ...(draft.shape === 'wall' ? { longest: draft.longest * cell } : {}),
      ...(draft.effect ? { effect: draft.effect } : {}),
      ...(this.picked ? { about: aboutOf(this.picked.note) } : {}),
      ...(draft.rules ? { rules: draft.rules } : {}),
    };
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.element.remove();
    this.options.changed?.(null);
    this.options.closed?.();
  }

  private key(event: KeyboardEvent): void {
    // The board's keys stay the board's; the picker's own are these.
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.target !== this.input) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (this.results.length === 0) return;
      const next = this.index < 0 ? 0 : (this.index + (event.key === 'ArrowDown' ? 1 : -1) + this.results.length) % this.results.length;
      this.choose(next);
      this.list.children[next]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!this.picked && this.results.length > 0) { this.choose(0); return; }
      const primary = this.options.actions.find((action) => action.primary) ?? this.options.actions[0];
      if (primary) this.run(primary);
    }
  }

  private run(action: SpellPickerAction): void {
    const ask = this.ask();
    const entry = this.picked;
    action.run(ask, entry);
  }

  private async search(): Promise<void> {
    const token = ++this.searched;
    const found = await this.options.book.search(this.input.value, 40);
    if (token !== this.searched || !this.open) return;
    this.results = found;
    this.index = this.picked ? found.findIndex((entry) => entry.id === this.picked!.id) : -1;
    this.drawList();
  }

  private drawList(): void {
    const doc = this.root.ownerDocument;
    if (this.results.length === 0) {
      const empty = doc.createElement('div');
      empty.className = 'atlas-tabletop-spellpicker__empty';
      empty.textContent = this.input.value.trim() ? 'No spell note by that name.' : 'No spell notes found: put them in a folder named with "Spells".';
      this.list.replaceChildren(empty);
      return;
    }
    this.list.replaceChildren(...this.results.map((entry, index) => {
      const row = doc.createElement('button');
      row.type = 'button';
      row.className = 'atlas-tabletop-spellpicker__row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(index === this.index));
      row.classList.toggle('is-picked', index === this.index);
      const name = doc.createElement('span');
      name.className = 'atlas-tabletop-spellpicker__name';
      name.textContent = entry.note.name;
      const meta = doc.createElement('span');
      meta.className = 'atlas-tabletop-spellpicker__meta';
      meta.textContent = `${levelWords(entry.note.level)} · ${entry.source}${entry.note.area ? '' : ' · no area'}`;
      row.append(name, meta);
      row.addEventListener('click', () => this.choose(index));
      row.addEventListener('dblclick', () => {
        const primary = this.options.actions.find((action) => action.primary);
        if (primary) this.run(primary);
      });
      return row;
    }));
  }

  private drawPreview(): void {
    const doc = this.root.ownerDocument;
    const parts: HTMLElement[] = [];
    if (this.picked) {
      parts.push(aboutElement(doc, this.picked.note.name, aboutOf(this.picked.note)));
      if (!this.picked.note.area) parts.push(Object.assign(doc.createElement('div'), { className: 'atlas-tabletop-spellpicker__note', textContent: 'This spell has no area: set one below, or cast it as it is.' }));
    } else {
      parts.push(Object.assign(doc.createElement('div'), { className: 'atlas-tabletop-spellpicker__empty', textContent: 'Pick a spell to see it, or set an area below.' }));
    }
    const scroll = doc.createElement('div');
    scroll.className = 'atlas-tabletop-spellpicker__words';
    scroll.append(...parts);
    this.preview.replaceChildren(scroll, this.areaFields(), this.rulesFields(), this.buttons());
  }

  /** The area's fields: shape, start, sizes in squares, damage. */
  private areaFields(): HTMLElement {
    const doc = this.root.ownerDocument;
    const row = doc.createElement('div');
    row.className = 'atlas-tabletop-spellpicker__area';
    const changed = (): void => this.options.changed?.(this.ask());
    const select = (label: string, key: 'shape' | 'from' | 'effect', options: Array<[string, string]>, value: string): HTMLElement => {
      const field = doc.createElement('label');
      field.append(Object.assign(doc.createElement('span'), { textContent: label }));
      const input = doc.createElement('select');
      input.dataset.spellField = key;
      for (const [id, name] of options) input.append(Object.assign(doc.createElement('option'), { value: id, textContent: name }));
      input.value = value;
      input.addEventListener('change', () => {
        if (key === 'shape') { this.draft = { ...this.draft, shape: input.value as SpellShape }; this.drawPreview(); }
        else if (key === 'from') this.draft = { ...this.draft, from: input.value as SpellFrom };
        else this.draft = { ...this.draft, effect: isDamageType(input.value) ? input.value : null };
        changed();
      });
      field.append(input);
      return field;
    };
    const number = (label: string, key: 'size' | 'length' | 'longest'): HTMLElement => {
      const field = doc.createElement('label');
      field.append(Object.assign(doc.createElement('span'), { textContent: label }));
      const input = doc.createElement('input');
      input.type = 'number';
      input.min = '0.5';
      input.max = '100';
      input.step = '0.5';
      input.value = String(this.draft[key]);
      input.dataset.spellField = key;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value <= 0 || value > 100) return;
        this.draft = { ...this.draft, [key]: value };
        changed();
      });
      field.append(input, Object.assign(doc.createElement('span'), { className: 'atlas-tabletop-spellpicker__unit', textContent: 'sq' }));
      return field;
    };
    row.append(select('Shape', 'shape', SPELL_SHAPES.map((shape) => [shape, SHAPE_NAMES[shape]]), this.draft.shape));
    if (this.draft.shape !== 'wall') row.append(select('Starts', 'from', [['self', 'From the caster'], ['point', 'At a point']], this.draft.from));
    row.append(number(SIZE_NAMES[this.draft.shape], 'size'));
    if (this.draft.shape === 'cylinder') row.append(number('Length', 'length'));
    if (this.draft.shape === 'wall') row.append(number('High', 'length'), number('Longest', 'longest'));
    row.append(select('Damage', 'effect', [['', 'None'], ...DAMAGE_TYPES.map((type): [string, string] => [type, DAMAGE_NAMES[type]])], this.draft.effect ?? ''));
    return row;
  }

  /**
   * What the spell does beyond its shape (`spellRules.ts`), set from its note and changed here for this cast: a wall,
   * obscuring, darkness, light, difficult terrain, a push or pull, a teleport, a gate, a summons.
   */
  private rulesFields(): HTMLElement {
    const doc = this.root.ownerDocument;
    const box = doc.createElement('details');
    box.className = 'atlas-tabletop-spellpicker__rules';
    const rules = this.draft.rules ?? {};
    box.open = Object.keys(rules).length > 0;
    const summary = doc.createElement('summary');
    summary.textContent = Object.keys(rules).length > 0 ? `Effects: ${rulesWords(rules)}` : 'Effects';
    box.append(summary);
    const grid = doc.createElement('div');
    grid.className = 'atlas-tabletop-spellpicker__area';
    const fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const read = (): void => {
      const value = (key: string): string => fields.get(key)?.value.trim() ?? '';
      const on = (key: string): boolean => (fields.get(key) as HTMLInputElement | undefined)?.checked === true;
      const number = (key: string): number | undefined => { const text = value(key); const n = Number(text); return text && Number.isFinite(n) ? n : undefined; };
      const raw: Record<string, unknown> = {};
      if (value('wall')) raw.wall = { look: value('wall'), blocks: value('blocks') || 'both' };
      if (on('obscure')) raw.obscure = true;
      if (on('dark')) raw.dark = true;
      if (on('difficult')) raw.difficult = true;
      const bright = number('bright') ?? 0;
      const dim = number('dim') ?? 0;
      if (bright + dim > 0) raw.light = { bright, dim };
      if (number('push')) raw.push = number('push');
      if (number('teleport')) raw.teleport = number('teleport');
      if (value('portal')) raw.portal = value('portal');
      if (value('summon')) raw.summon = { name: value('summon'), count: number('count') ?? 1 };
      this.draft = { ...this.draft, rules: readSpellRules(raw) };
      summary.textContent = this.draft.rules ? `Effects: ${rulesWords(this.draft.rules)}` : 'Effects';
      this.options.changed?.(this.ask());
    };
    const labelled = (label: string, input: HTMLInputElement | HTMLSelectElement, key: string, unit?: string): HTMLElement => {
      const field = doc.createElement('label');
      field.append(Object.assign(doc.createElement('span'), { textContent: label }));
      input.dataset.spellRule = key;
      input.addEventListener(input instanceof HTMLSelectElement || (input as HTMLInputElement).type === 'checkbox' ? 'change' : 'input', read);
      fields.set(key, input);
      field.append(input);
      if (unit) field.append(Object.assign(doc.createElement('span'), { className: 'atlas-tabletop-spellpicker__unit', textContent: unit }));
      return field;
    };
    const select = (options: Array<[string, string]>, value: string): HTMLSelectElement => {
      const input = doc.createElement('select');
      for (const [id, name] of options) input.append(Object.assign(doc.createElement('option'), { value: id, textContent: name }));
      input.value = value;
      return input;
    };
    const text = (value: string, kind: 'text' | 'number' | 'checkbox', checked = false): HTMLInputElement => {
      const input = doc.createElement('input');
      input.type = kind;
      if (kind === 'checkbox') input.checked = checked; else input.value = value;
      if (kind === 'number') input.step = '5';
      return input;
    };
    const look = (WALL_LOOKS as readonly string[]).map((id): [string, string] => [id, id.charAt(0).toUpperCase() + id.slice(1)]);
    grid.append(
      labelled('Wall', select([['', 'None'], ...look], rules.wall?.look ?? ''), 'wall'),
      labelled('Stops', select([['both', 'Bodies and sight'], ['move', 'Bodies'], ['sight', 'Sight']], rules.wall?.blocks ?? 'both'), 'blocks'),
      labelled('Obscures', text('', 'checkbox', rules.obscure === true), 'obscure'),
      labelled('Darkness', text('', 'checkbox', rules.dark === true), 'dark'),
      labelled('Difficult', text('', 'checkbox', rules.difficult === true), 'difficult'),
      labelled('Light', text(rules.light ? String(rules.light.bright) : '', 'number'), 'bright', 'ft'),
      labelled('Dim', text(rules.light ? String(rules.light.dim) : '', 'number'), 'dim', 'ft'),
      labelled('Push', text(rules.push !== undefined ? String(rules.push) : '', 'number'), 'push', 'ft'),
      labelled('Teleport', text(rules.teleport !== undefined ? String(rules.teleport) : '', 'number'), 'teleport', 'ft'),
      labelled('Gate', text(rules.portal ?? '', 'text'), 'portal'),
      labelled('Summon', text(rules.summon?.name ?? '', 'text'), 'summon'),
      labelled('Count', text(String(rules.summon?.count ?? 1), 'number'), 'count'),
    );
    (fields.get('count') as HTMLInputElement).step = '1';
    box.append(grid);
    return box;
  }

  private buttons(): HTMLElement {
    const doc = this.root.ownerDocument;
    const row = doc.createElement('div');
    row.className = 'atlas-tabletop-spellpicker__actions';
    for (const action of this.options.actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      if (action.primary) button.className = 'mod-cta';
      if (action.warning) button.className = 'mod-warning';
      button.addEventListener('click', () => this.run(action));
      row.append(button);
    }
    return row;
  }
}

/** The rules in a few words: "stone wall, push 10 ft". */
export function rulesWords(rules: SpellRules): string {
  const words: string[] = [];
  if (rules.wall) words.push(`${rules.wall.look} wall`);
  if (rules.dark) words.push('darkness');
  else if (rules.obscure) words.push('obscures');
  if (rules.light) words.push(`light ${rules.light.bright}/${rules.light.dim} ft`);
  if (rules.difficult) words.push('difficult terrain');
  if (rules.push) words.push(rules.push > 0 ? `push ${rules.push} ft` : `pull ${-rules.push} ft`);
  if (rules.teleport) words.push(`teleport ${rules.teleport} ft`);
  if (rules.portal) words.push(`gate "${rules.portal}"`);
  if (rules.summon) words.push(`summons ${rules.summon.count > 1 ? `${rules.summon.count} × ` : ''}${rules.summon.name}`);
  return words.join(', ');
}
