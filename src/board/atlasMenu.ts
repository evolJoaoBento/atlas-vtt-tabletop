/**
 * Atlas's context menu, one to one, for the 3D board: its markup and classes (`atlas-ctx-*`, styled as Atlas styles
 * them, see styles.css) and its behaviour (Atlas's `AtlasContextMenu`, a Radix dropdown): it opens under the pointer
 * and stays on screen; rows are highlighted by the pointer or the arrow keys; Enter or a click chooses; a submenu opens
 * beside its row on hover or →, and ← closes it; a row may stay open when chosen (`keepOpen`), and a valued row has
 * − value + controls (also the + and - keys); a checked row shows Atlas's check; a click away or Escape closes it.
 * Entries are read again after every choice, so what the menu shows follows what the choice changed.
 */

export interface MenuStepper {
  value: string;
  /** Names the stepped quantity: "Lower Exhaustion", "Raise Exhaustion". */
  label: string;
  canDecrement: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}

export type MenuEntry =
  | {
    type: 'item';
    label: string;
    onClick: () => void;
    checked?: boolean;
    disabled?: boolean;
    destructive?: boolean;
    /** Drawn before the label, e.g. a condition's badge. */
    leading?: (doc: Document) => HTMLElement;
    /** Choosing it leaves the menu open, for toggles often picked several at a time. */
    keepOpen?: boolean;
    stepper?: MenuStepper;
  }
  | { type: 'submenu'; label: string; icon: string; children: () => MenuEntry[] }
  | { type: 'separator' }
  | { type: 'custom'; render: (doc: Document, close: () => void) => HTMLElement };

/** Draws an Obsidian icon (Lucide) into an element; Obsidian's `setIcon` in the app. */
export type IconPainter = (element: HTMLElement, name: string) => void;

const GAP = 4;
const COLLISION_PADDING = 8;

interface Level {
  element: HTMLElement;
  entries: () => MenuEntry[];
  rows: HTMLElement[];
  highlighted: number;
  /** The row of the menu above that opened this one. */
  trigger: HTMLElement | null;
}

export class AtlasMenu {
  private readonly doc: Document;
  private readonly levels: Level[] = [];
  private closed = false;
  private readonly onOutside = (event: PointerEvent): void => {
    if (this.levels.some((level) => level.element.contains(event.target as Node))) return;
    this.close();
  };
  private readonly onKey = (event: KeyboardEvent): void => this.key(event);

  constructor(doc: Document, entries: () => MenuEntry[], at: { x: number; y: number }, private readonly icon: IconPainter, private readonly onClose: () => void = () => {}) {
    this.doc = doc;
    const element = this.level(entries, null);
    this.place(element, { left: at.x, right: at.x, top: at.y + GAP, bottom: at.y + GAP }, 'below');
    doc.addEventListener('pointerdown', this.onOutside, true);
    doc.addEventListener('keydown', this.onKey, true);
    element.focus();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  /** Reads the entries again and redraws every open level, keeping what is highlighted and open. */
  refresh(): void {
    if (this.closed) return;
    for (const level of this.levels) this.fill(level);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.doc.removeEventListener('pointerdown', this.onOutside, true);
    this.doc.removeEventListener('keydown', this.onKey, true);
    for (const level of this.levels) level.element.remove();
    this.levels.length = 0;
    this.onClose();
  }

  private level(entries: () => MenuEntry[], trigger: HTMLElement | null): HTMLElement {
    const element = this.doc.win.createDiv();
    element.className = 'atlas-ctx-menu';
    element.setAttribute('role', 'menu');
    element.tabIndex = -1;
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    const level: Level = { element, entries, rows: [], highlighted: -1, trigger };
    this.levels.push(level);
    this.fill(level);
    this.doc.body.appendChild(element);
    return element;
  }

  private iconSpan(name: string): HTMLElement {
    const span = this.doc.win.createSpan();
    span.className = 'atlas-ctx-icon';
    this.icon(span, name);
    return span;
  }

  /** Draws a level's rows from its entries. */
  private fill(level: Level): void {
    const depth = this.levels.indexOf(level);
    const openTrigger = this.levels[depth + 1]?.trigger ?? null;
    const openIndex = openTrigger ? level.rows.indexOf(openTrigger) : -1;
    level.element.replaceChildren();
    level.rows = [];
    for (const entry of level.entries()) {
      if (entry.type === 'separator') {
        const line = this.doc.win.createDiv();
        line.className = 'atlas-ctx-separator';
        line.setAttribute('role', 'separator');
        level.element.appendChild(line);
        continue;
      }
      if (entry.type === 'custom') {
        const custom = this.doc.win.createDiv();
        custom.className = 'atlas-ctx-custom';
        custom.setAttribute('role', 'none');
        custom.appendChild(entry.render(this.doc, () => this.close()));
        level.element.appendChild(custom);
        continue;
      }
      const row = this.doc.win.createDiv();
      row.className = 'atlas-ctx-item';
      row.tabIndex = -1;
      if (entry.type === 'submenu') {
        row.classList.add('atlas-ctx-submenu-trigger');
        row.setAttribute('role', 'menuitem');
        row.setAttribute('aria-haspopup', 'menu');
        const leading = this.doc.win.createSpan();
        leading.className = 'atlas-ctx-item__leading';
        leading.append(this.iconSpan(entry.icon), Object.assign(this.doc.win.createSpan(), { className: 'atlas-ctx-item__label', textContent: entry.label }));
        const trailing = this.doc.win.createSpan();
        trailing.className = 'atlas-ctx-item__trailing';
        trailing.appendChild(this.iconSpan('chevron-right'));
        row.append(leading, trailing);
        row.addEventListener('pointerenter', () => { this.highlight(level, level.rows.indexOf(row)); this.openSubmenu(level, row, entry.children); });
        row.addEventListener('click', () => this.openSubmenu(level, row, entry.children, true));
        (row as HTMLElement & { menuAction?: () => void }).menuAction = () => this.openSubmenu(level, row, entry.children, true);
      } else {
        row.setAttribute('role', entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
        if (entry.checked !== undefined) row.setAttribute('aria-checked', String(entry.checked));
        if (entry.destructive) row.classList.add('atlas-ctx-item--destructive');
        if (entry.disabled) {
          row.setAttribute('data-disabled', '');
          row.setAttribute('aria-disabled', 'true');
        }
        const label = Object.assign(this.doc.win.createSpan(), { className: 'atlas-ctx-item__label', textContent: entry.label });
        if (entry.leading) {
          const leading = this.doc.win.createSpan();
          leading.className = 'atlas-ctx-item__leading';
          leading.append(entry.leading(this.doc), label);
          row.appendChild(leading);
        } else {
          row.append(entry.label);
        }
        if (entry.stepper || entry.checked !== undefined) {
          const trailing = this.doc.win.createSpan();
          trailing.className = 'atlas-ctx-item__trailing';
          if (entry.stepper) trailing.appendChild(this.stepper(entry.stepper));
          if (entry.checked !== undefined) {
            const check = this.doc.win.createSpan();
            check.className = 'atlas-ctx-item__check';
            check.setAttribute('data-state', entry.checked ? 'checked' : 'unchecked');
            check.appendChild(this.iconSpan('check'));
            trailing.appendChild(check);
          }
          row.appendChild(trailing);
        }
        const choose = (): void => {
          if (entry.disabled) return;
          entry.onClick();
          if (entry.keepOpen) this.refresh();
          else this.close();
        };
        (row as HTMLElement & { menuAction?: () => void; menuStepper?: MenuStepper }).menuAction = choose;
        if (entry.stepper) (row as HTMLElement & { menuStepper?: MenuStepper }).menuStepper = entry.stepper;
        row.addEventListener('click', choose);
        row.addEventListener('pointerenter', () => { this.highlight(level, level.rows.indexOf(row)); this.closeBelow(level); });
      }
      level.rows.push(row);
      level.element.appendChild(row);
    }
    if (level.highlighted >= level.rows.length) level.highlighted = level.rows.length - 1;
    this.highlight(level, level.highlighted);
    // A submenu stays open across a redraw: its trigger is the new row at the same place.
    if (openIndex >= 0 && level.rows[openIndex]) this.levels[depth + 1].trigger = level.rows[openIndex]!;
  }

  private stepper(stepper: MenuStepper): HTMLElement {
    const span = this.doc.win.createSpan();
    span.className = 'atlas-ctx-stepper';
    const button = (icon: string, label: string, enabled: boolean, action: () => void): HTMLButtonElement => {
      const made = this.doc.win.createEl('button');
      made.type = 'button';
      made.tabIndex = -1;
      made.className = 'atlas-ctx-stepper__button';
      made.title = label;
      made.setAttribute('aria-label', label);
      made.disabled = !enabled;
      made.appendChild(this.iconSpan(icon));
      made.addEventListener('click', (event) => {
        // A step is not a choice of the row.
        event.preventDefault();
        event.stopPropagation();
        action();
        this.refresh();
      });
      return made;
    };
    const value = Object.assign(this.doc.win.createSpan(), { className: 'atlas-ctx-stepper__value', textContent: stepper.value });
    span.append(button('minus', `Lower ${stepper.label}`, stepper.canDecrement, stepper.onDecrement), value, button('plus', `Raise ${stepper.label}`, true, stepper.onIncrement));
    return span;
  }

  private highlight(level: Level, index: number): void {
    level.highlighted = index;
    level.rows.forEach((row, i) => row.toggleAttribute('data-highlighted', i === index));
  }

  private closeBelow(level: Level): void {
    const depth = this.levels.indexOf(level);
    for (const below of this.levels.splice(depth + 1)) below.element.remove();
  }

  private openSubmenu(level: Level, row: HTMLElement, children: () => MenuEntry[], focus = false): void {
    const depth = this.levels.indexOf(level);
    if (this.levels[depth + 1]?.trigger === row) {
      if (focus) this.focusFirst(this.levels[depth + 1]);
      return;
    }
    this.closeBelow(level);
    const element = this.level(children, row);
    const rect = row.getBoundingClientRect();
    const parent = level.element.getBoundingClientRect();
    // Beside its row (Radix: side offset 4, align offset −4), on the other side when there is no room.
    this.place(element, { left: parent.left - GAP, right: parent.right + GAP, top: rect.top - GAP, bottom: rect.top - GAP }, 'beside');
    if (focus) this.focusFirst(this.levels[this.levels.length - 1]);
  }

  private focusFirst(level: Level): void {
    level.element.focus();
    this.highlight(level, level.rows.findIndex((row) => !row.hasAttribute('data-disabled')));
  }

  /** Puts a menu at its anchor, kept within the window (collision padding 8) and flipped to the other side if need be. */
  private place(element: HTMLElement, anchor: { left: number; right: number; top: number; bottom: number }, mode: 'below' | 'beside'): void {
    const win = this.doc.defaultView ?? window;
    element.setCssStyles({ position: 'fixed', left: '0px', top: '0px' });
    const { width, height } = element.getBoundingClientRect();
    const maxX = win.innerWidth - COLLISION_PADDING - width;
    const maxY = win.innerHeight - COLLISION_PADDING - height;
    let left: number;
    let top: number;
    if (mode === 'below') {
      left = anchor.left;
      top = anchor.top + height > win.innerHeight - COLLISION_PADDING ? anchor.top - 2 * GAP - height : anchor.top;
    } else {
      left = anchor.right + width > win.innerWidth - COLLISION_PADDING ? anchor.left - width : anchor.right;
      top = anchor.top;
    }
    element.style.left = `${Math.max(COLLISION_PADDING, Math.min(maxX, left))}px`;
    element.style.top = `${Math.max(COLLISION_PADDING, Math.min(maxY, top))}px`;
  }

  private key(event: KeyboardEvent): void {
    const level = this.levels[this.levels.length - 1];
    if (!level) return;
    const row = level.rows[level.highlighted] as (HTMLElement & { menuAction?: () => void; menuStepper?: MenuStepper }) | undefined;
    const move = (step: number): void => {
      if (level.rows.length === 0) return;
      let index = level.highlighted;
      for (let tries = 0; tries < level.rows.length; tries++) {
        index = (index + step + level.rows.length) % level.rows.length;
        if (!level.rows[index].hasAttribute('data-disabled')) break;
      }
      this.highlight(level, index);
    };
    switch (event.key) {
      case 'ArrowDown': move(1); break;
      case 'ArrowUp': move(-1); break;
      case 'Home': this.highlight(level, 0); break;
      case 'End': this.highlight(level, level.rows.length - 1); break;
      case 'ArrowRight':
      case 'Enter':
      case ' ':
        if (event.key === 'ArrowRight' && !row?.classList.contains('atlas-ctx-submenu-trigger')) return;
        row?.menuAction?.();
        break;
      case 'ArrowLeft':
        if (this.levels.length < 2) return;
        this.closeBelow(this.levels[this.levels.length - 2]);
        this.levels[this.levels.length - 1].element.focus();
        break;
      case 'Escape': this.close(); break;
      case '+':
      case '=':
        if (!row?.menuStepper) return;
        row.menuStepper.onIncrement();
        this.refresh();
        break;
      case '-':
        if (!row?.menuStepper?.canDecrement) return;
        row.menuStepper.onDecrement();
        this.refresh();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }
}
