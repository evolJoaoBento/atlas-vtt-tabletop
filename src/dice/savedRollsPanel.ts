/**
 * The saved rolls beside the dice tray (Atlas 0.18's `DicePresetsPanel`, `PresetCards`), in Atlas's markup and classes: a
 * card that saves the tray's roll under a name, then one card per saved roll, a click throwing it, its ⋯ holding Edit and
 * Delete. They are the collection's (`dicePresets`), so the board and Atlas show and change the same rolls. Left to Atlas:
 * dressing a roll's dice (its editor), keeping a set of the Dice Lab (the flask) and pinning a roll in the tray's row.
 * Plain DOM; what a roll is, how it is saved and thrown is `savedRolls.ts`.
 */
import { at } from '../atlasPort/atlasText';
import {
  MAX_PRESET_NAME, sameSlot, withoutPreset, type DiceShelf, type ShelfChange,
} from '../atlasPort/app/react/components/dice/diceShelf';
import { presetText } from '../atlasPort/app/react/components/dice/presetLook';
import type { MenuEntry, IconPainter } from '../board/atlasMenu';
import { setSvg } from '../svg';
import { saveRoll, savedRollEdited, type SavedRoll, type SavedRollProblem } from './savedRolls';
import type { DiceRules } from './rollRules';

/** What the panel needs of the board and of Atlas. */
export interface SavedRollsHost {
  /** The shelf of the board's collection, read now; null where saved rolls are not offered (an older Atlas, a map in no collection). */
  shelf(): DiceShelf | null;
  /** The collection's dice rules: a formula is checked against what these dice can throw. */
  rules(): DiceRules;
  /** Writes a change to the collection's settings, through Atlas. */
  write(change: ShelfChange): Promise<void>;
  /** Hears the collection's settings change (here or in Atlas); returns how to stop. */
  onChange(listener: () => void): () => void;
  /** Throws a saved roll (the tray steps aside for it); the reason in words where it cannot be thrown. */
  roll(preset: SavedRoll): string | null;
  /** Whether the panel stands open: remembered by this device, as Atlas remembers it. */
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Atlas's menu at a point. */
  menu(entries: MenuEntry[], at: { x: number; y: number }): void;
  icon: IconPainter;
  /** A picture of a die of the pack chosen, by its faces; null where there is none (the card shows its name). */
  picture(sides: number): string | null;
  /** Tells the GM what could not be done. */
  warn(message: string): void;
}

const svg = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Lucide's `plus`, `ellipsis`, `bookmark` and `check` (ISC). */
const PLUS_SVG = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');
const MORE_SVG = svg('<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>');
export const BOOKMARK_SVG = svg('<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>');
const CHECK_SVG = svg('<path d="M20 6 9 17l-5-5"/>');

type Made<K extends keyof HTMLElementTagNameMap> = HTMLElementTagNameMap[K];

export class SavedRollsPanel {
  readonly element: HTMLElement;
  private readonly doc: Document;
  private readonly name: HTMLInputElement;
  private readonly formula: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly list: HTMLElement;
  private readonly stop: () => void;
  /** What the formula field follows until it is typed in: the tray's roll. */
  private trayFormula = '';
  private typed = false;
  private drawn: string | null = null;
  private editing: string | null = null;
  private editor: HTMLElement | null = null;
  private open: boolean;

  constructor(parent: HTMLElement, private readonly host: SavedRollsHost) {
    this.doc = parent.ownerDocument;
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into: HTMLElement): Made<K> => {
      const made = this.doc.win.createEl(tag);
      made.className = className;
      into.appendChild(made);
      return made;
    };
    this.element = this.doc.win.createEl('section');
    this.element.className = 'atlas-dice-presets atlas-tabletop-saved-rolls';
    this.element.setAttribute('aria-label', at('diceRoll.presetsTitle'));
    parent.prepend(this.element);
    this.open = host.isOpen();

    const form = el('div', 'atlas-dice-presets__card atlas-dice-presets__form', this.element);
    const messageId = `atlas-saved-rolls-${Math.random().toString(36).slice(2, 8)}`;
    this.name = el('input', 'atlas-dice-presets__field', form);
    this.name.maxLength = MAX_PRESET_NAME;
    this.name.placeholder = at('diceRoll.presetName');
    this.name.setAttribute('aria-label', at('diceRoll.presetName'));
    this.name.setAttribute('aria-describedby', messageId);
    el('span', 'atlas-dice-presets__divider', form).setAttribute('aria-hidden', 'true');
    this.formula = el('input', 'atlas-dice-presets__field atlas-dice-presets__field--formula', form);
    this.formula.placeholder = '1d8 + 3';
    this.formula.spellcheck = false;
    this.formula.autocomplete = 'off';
    this.formula.setAttribute('aria-label', at('diceRoll.presetFormula'));
    this.formula.setAttribute('aria-describedby', messageId);
    this.formula.addEventListener('input', () => { this.typed = true; });
    const save = el('button', 'atlas-dice-presets__icon atlas-dice-presets__save', form);
    save.type = 'button';
    save.title = at('diceRoll.presetSave');
    save.setAttribute('aria-label', at('diceRoll.presetSave'));
    setSvg(save, PLUS_SVG);
    save.addEventListener('click', () => this.save());
    this.message = el('p', 'atlas-dice-presets__message', form);
    this.message.id = messageId;
    this.message.setAttribute('aria-live', 'polite');
    form.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      this.save();
    });

    this.list = el('ul', 'atlas-dice-presets__list', this.element);
    this.list.setAttribute('aria-label', at('diceRoll.presetsTitle'));
    this.stop = host.onChange(() => this.refresh());
    this.sync();
  }

  /** Whether saved rolls are offered now (they stay out where the shelf is none). */
  get available(): boolean {
    return this.host.shelf() !== null;
  }

  get isOpen(): boolean {
    return this.open && this.available;
  }

  /** Opens or shuts the panel (P in the tray, the bookmark at its foot); remembered. */
  toggle(): void {
    this.open = !this.open;
    this.host.setOpen(this.open);
    this.sync();
  }

  /** The tray's roll as it is now: what a new saved roll starts from, until the formula is typed in. */
  setTrayFormula(text: string): void {
    this.trayFormula = text;
    if (!this.typed) this.formula.value = text;
    // The tray grows and shrinks with its dice: the room above it with it.
    if (!this.element.hidden) this.fit();
  }

  /** The panel as the shelf and its own state say: shown or hidden, with its list as it is now. */
  sync(): void {
    this.element.hidden = !this.isOpen;
    this.refresh();
    if (!this.element.hidden) this.fit();
  }

  /**
   * In a narrow window (Atlas's rule: under 1000 px) the panel stands above the tray and grows upward, up to 320 px: held to
   * the room there is above, so its form is never cut off at the top of the window; its list scrolls.
   */
  private fit(): void {
    const win = this.doc.defaultView;
    this.element.style.removeProperty('max-height');
    if (!win || typeof win.matchMedia !== 'function' || !win.matchMedia('(max-width: 1000px)').matches) return;
    const tray = this.element.parentElement?.getBoundingClientRect();
    if (!tray || tray.height === 0) return;
    const room = Math.floor(tray.top - 16);
    if (room < this.element.getBoundingClientRect().height) this.element.style.maxHeight = `${Math.max(96, room)}px`;
  }

  /** Draws the list again where the shelf changed; the form is never drawn again, so what is typed stays. */
  refresh(): void {
    const shelf = this.host.shelf();
    if (!shelf || !this.isOpen) return;
    const key = JSON.stringify([shelf.presets, shelf.row, this.editing]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.list.replaceChildren(...shelf.presets.map((preset, index) => this.card(shelf, preset as SavedRoll, index)));
    if (this.editing && !shelf.presets.some((preset) => preset.id === this.editing)) this.closeEditor();
    this.fit();
  }

  dispose(): void {
    this.stop();
    this.element.remove();
  }

  private say(text: string | null): void {
    this.message.textContent = text ?? '';
  }

  /** Writes a change; a refusal is told, and the list is read again from what Atlas holds. */
  private write(change: ShelfChange): void {
    this.host.write(change).catch(() => {
      this.host.warn(at('diceRoll.presetsSaveFailed'));
      this.refresh();
    });
  }

  /** Tells what stopped a save, by the field to blame; false where nothing did. */
  private told(result: object): boolean {
    const problem = result as SavedRollProblem;
    if (!('problem' in problem)) return false;
    this.say(problem.problem);
    const [bad, good] = problem.field === 'name' ? [this.name, this.formula] : [this.formula, this.name];
    bad.setAttribute('aria-invalid', 'true');
    good.removeAttribute('aria-invalid');
    return true;
  }

  /** Keeps the tray's roll (or the formula typed) under the name written; the form empties and follows the tray again. */
  private save(): void {
    const shelf = this.host.shelf();
    if (!shelf) return;
    const result = saveRoll(shelf, this.name.value, this.formula.value, this.host.rules());
    // A full shelf says nothing, as in Atlas: the form keeps what was written.
    if (this.told(result) || !('change' in result)) return;
    this.write(result.change);
    this.name.value = '';
    this.typed = false;
    this.formula.value = this.trayFormula;
    this.say(null);
    this.name.removeAttribute('aria-invalid');
    this.formula.removeAttribute('aria-invalid');
  }

  private card(shelf: DiceShelf, preset: SavedRoll, index: number): HTMLElement {
    const doc = this.doc;
    const item = doc.win.createEl('li');
    const pinned = shelf.row.some((slot) => sameSlot(slot, { kind: 'preset', id: preset.id }));
    item.className = 'atlas-dice-presets__card atlas-dice-presets__item';
    item.style.setProperty('--atlas-preset-index', String(Math.min(index, 8)));
    if (pinned) item.dataset.pinned = '';
    if (preset.id === this.editing) {
      item.dataset.editing = '';
      item.setAttribute('aria-current', 'true');
    }
    const roll = doc.win.createEl('button');
    roll.type = 'button';
    roll.className = 'atlas-dice-presets__roll';
    const text = presetText(preset as never) as string;
    roll.setAttribute('aria-label', at('diceRoll.presetRoll', { name: preset.name, formula: text }));
    roll.append(this.dice(preset));
    roll.append(Object.assign(doc.win.createSpan(), { className: 'atlas-dice-presets__name', textContent: preset.name }));
    roll.append(Object.assign(doc.win.createSpan(), { className: 'atlas-dice-presets__formula', textContent: text }));
    roll.addEventListener('click', () => this.say(this.host.roll(preset)));
    const more = doc.win.createEl('button');
    more.type = 'button';
    more.className = 'btn btn--ghost btn--icon atlas-dice-presets__more';
    more.title = at('diceRoll.presetActions', { name: preset.name });
    more.setAttribute('aria-label', more.title);
    more.setAttribute('aria-haspopup', 'menu');
    setSvg(more, MORE_SVG);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const box = more.getBoundingClientRect();
      more.setAttribute('aria-expanded', 'true');
      this.host.menu(this.entries(preset), { x: box.right, y: box.bottom + 4 });
      // The menu closes on its own; the card lets go of its lit look with the next list drawn.
      const off = (): void => { more.removeAttribute('aria-expanded'); doc.removeEventListener('pointerdown', off, true); };
      doc.addEventListener('pointerdown', off, true);
    });
    item.append(roll, more);
    return item;
  }

  private entries(preset: SavedRoll): MenuEntry[] {
    const icon = (name: string) => (doc: Document): HTMLElement => {
      const span = doc.win.createSpan();
      span.className = 'atlas-ctx-icon';
      this.host.icon(span, name);
      return span;
    };
    return [
      { type: 'item', label: at('diceRoll.presetEditShort'), leading: icon('pencil'), onClick: () => this.edit(preset.id) },
      {
        type: 'item', label: at('diceRoll.presetDelete'), leading: icon('trash-2'), destructive: true,
        onClick: () => {
          const shelf = this.host.shelf();
          if (shelf) this.write(withoutPreset(shelf, preset.id));
        },
      },
    ];
  }

  /** The dice a roll throws, one picture per kind (Atlas's `PresetDice`); a die the pack has none of is a tile with its name. */
  private dice(preset: SavedRoll): HTMLElement {
    const doc = this.doc;
    const holder = doc.win.createSpan();
    holder.className = 'atlas-dice-presets__dice';
    holder.setAttribute('aria-hidden', 'true');
    const kinds = preset.look
      ? preset.look.dice.slice(0, 6).map((die) => ({ sides: die.sides, colour: die.colour }))
      : [...preset.formula.replace(/\[[^\]]*\]/g, '').matchAll(/(?<![\w%])(\d*)d(\d+|%)/gi)].slice(0, 6).map((found) => ({ sides: found[2] === '%' ? 100 : Number(found[2]), colour: undefined as string | undefined }));
    for (const kind of kinds) {
      const still = doc.win.createSpan();
      still.className = 'atlas-die-still';
      still.style.width = '32px';
      still.style.height = '32px';
      if (kind.colour) still.style.setProperty('--atlas-die-colour', kind.colour);
      const picture = this.host.picture(kind.sides);
      if (picture) {
        const img = doc.win.createEl('img');
        img.className = 'atlas-die-still__image';
        img.src = picture;
        img.alt = '';
        img.draggable = false;
        still.appendChild(img);
      } else {
        const plain = doc.win.createSpan();
        plain.className = 'atlas-dice-lab__plain-die atlas-die-still__plain';
        plain.textContent = kind.sides === 100 ? 'd%' : `d${kind.sides}`;
        still.appendChild(plain);
      }
      holder.appendChild(still);
    }
    return holder;
  }

  // ── Edit: the roll's name, and a formula roll's formula (a designed roll's dice are dressed in Atlas) ─────────────────

  private edit(id: string): void {
    this.closeEditor(false);
    this.editing = id;
    this.drawn = null;
    this.refresh();
    const shelf = this.host.shelf();
    const preset = shelf?.presets.find((candidate) => candidate.id === id) as SavedRoll | undefined;
    if (!preset) return;
    const doc = this.doc;
    const card = doc.win.createEl('section');
    card.className = 'atlas-dice-presets__card atlas-dice-preset-editor';
    card.setAttribute('aria-label', at('diceRoll.presetEdit', { name: preset.name }));
    const head = doc.win.createDiv();
    head.className = 'atlas-dice-preset-editor__head';
    const name = doc.win.createEl('input');
    name.className = 'atlas-dice-presets__field atlas-dice-preset-editor__name';
    name.value = preset.name;
    name.maxLength = MAX_PRESET_NAME;
    name.placeholder = at('diceRoll.presetName');
    name.setAttribute('aria-label', at('diceRoll.presetName'));
    const done = doc.win.createEl('button');
    done.type = 'button';
    done.className = 'atlas-dice-presets__icon atlas-dice-preset-editor__done';
    done.title = at('diceRoll.rowDone');
    done.setAttribute('aria-label', at('diceRoll.rowDone'));
    setSvg(done, CHECK_SVG);
    head.append(name, done);
    card.appendChild(head);
    const formula = doc.win.createEl('input');
    formula.className = 'atlas-dice-presets__field atlas-dice-presets__field--formula';
    formula.value = preset.formula;
    formula.spellcheck = false;
    formula.setAttribute('aria-label', at('diceRoll.presetFormula'));
    // A designed roll shows what it throws, and keeps it.
    if (preset.look) {
      formula.value = presetText(preset as never);
      formula.readOnly = true;
    }
    card.appendChild(formula);
    const message = doc.win.createEl('p');
    message.className = 'atlas-dice-presets__message';
    message.setAttribute('aria-live', 'polite');
    card.appendChild(message);
    const commit = (): void => {
      const current = this.host.shelf();
      if (!current) return;
      const result = savedRollEdited(current, id, name.value, formula.value, this.host.rules());
      if ('problem' in result) {
        message.textContent = result.problem;
        (result.field === 'name' ? name : formula).setAttribute('aria-invalid', 'true');
        return;
      }
      if ('change' in result) this.write(result.change);
      this.closeEditor();
    };
    done.addEventListener('click', commit);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.closeEditor(); }
    });
    this.element.appendChild(card);
    this.editor = card;
    this.keepInView(card);
    name.focus();
    name.select();
  }

  /**
   * The editor floats above the saved rolls, centred on them: moved sideways back inside the window as the tray itself is
   * (Atlas's keep-in-view variable), and over the rolls where there is no room above (a window too short or too narrow).
   */
  private keepInView(card: HTMLElement): void {
    const win = this.doc.defaultView;
    if (!win) return;
    card.style.removeProperty('--atlas-keep-in-view-x');
    const rect = card.getBoundingClientRect();
    const shift = rect.right > win.innerWidth - 8 ? win.innerWidth - 8 - rect.right : rect.left < 8 ? 8 - rect.left : 0;
    if (shift !== 0) card.style.setProperty('--atlas-keep-in-view-x', `${Math.round(shift)}px`);
    if (rect.top < 8) {
      card.style.bottom = 'auto';
      card.style.top = '0';
    }
  }

  private closeEditor(redraw = true): void {
    this.editor?.remove();
    this.editor = null;
    this.editing = null;
    if (redraw) {
      this.drawn = null;
      this.refresh();
    }
  }
}
