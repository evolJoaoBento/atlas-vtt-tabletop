/**
 * The selected token's resource controls, as Atlas gives them: each resource that counts gets a click-to-edit overlay
 * that lights up on hover, and − / + buttons (a bar's on its two ends, a wheel's stacked on its outer side, + above −).
 * A click on the overlay opens Atlas's editor under the resource: current / max, Enter or clicking away applies,
 * Escape discards, Tab switches fields, the arrow keys step (Shift for tens). They are HTML over the board, laid out
 * every frame on the resources the board draws.
 */
import { setSvg } from '../svg';
import { parseValueInput, type ResourceValue } from './resources';

/** A rectangle on screen, in pixels from the board's top left. */
export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ControlSpec {
  key: string;
  kind: 'bar' | 'wheel';
  /** A wheel's side of the token: its buttons stand outside it. */
  side: -1 | 0 | 1;
  rect: ScreenRect;
  /** The resource's colour: the + button's and the open editor's outline. */
  color: string;
}

/** Atlas's button: a bar's height across; a wheel's buttons stand this far from it. */
const BUTTON_PX = 15;
const GAP_PX = 3;
/** Atlas's minus button is drawn in its critical red. */
const DANGER = '#ef4444';

const MINUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const PLUS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>';

interface Parts {
  hit: HTMLElement;
  minus: HTMLElement;
  plus: HTMLElement;
}

export class ResourceControls {
  private readonly root: HTMLElement;
  private readonly parts = new Map<string, Parts>();
  private active: string | null = null;

  constructor(container: HTMLElement, private readonly actions: { step(key: string, delta: number): void; edit(key: string): void }) {
    const doc = container.ownerDocument;
    this.root = doc.win.createDiv();
    this.root.className = 'atlas-tabletop-controls';
    container.appendChild(this.root);
  }

  /** Lays the controls on these resources; the others are hidden. */
  layout(specs: readonly ControlSpec[]): void {
    const shown = new Set<string>();
    for (const spec of specs) {
      shown.add(spec.key);
      const parts = this.partsFor(spec.key);
      const { left, top, width, height } = spec.rect;
      place(parts.hit, left, top, width, height);
      parts.hit.style.borderRadius = `${height / 2}px`;
      parts.hit.style.setProperty('--atlas-tabletop-accent', spec.color);
      parts.hit.classList.toggle('is-active', this.active === spec.key);
      parts.plus.style.color = spec.color;
      const middle = top + height / 2;
      if (spec.kind === 'bar') {
        place(parts.minus, left - GAP_PX - BUTTON_PX, middle - BUTTON_PX / 2, BUTTON_PX, BUTTON_PX);
        place(parts.plus, left + width + GAP_PX, middle - BUTTON_PX / 2, BUTTON_PX, BUTTON_PX);
      } else {
        const x = spec.side < 0 ? left - GAP_PX - BUTTON_PX : left + width + GAP_PX;
        place(parts.plus, x, middle - BUTTON_PX - 0.5, BUTTON_PX, BUTTON_PX);
        place(parts.minus, x, middle + 0.5, BUTTON_PX, BUTTON_PX);
      }
      for (const part of [parts.hit, parts.minus, parts.plus]) part.hidden = false;
    }
    for (const [key, parts] of this.parts) {
      if (shown.has(key)) continue;
      for (const part of [parts.hit, parts.minus, parts.plus]) part.hidden = true;
    }
  }

  /** Outlines the resource whose editor is open; null for none. */
  setActive(key: string | null): void {
    this.active = key;
    for (const [other, parts] of this.parts) parts.hit.classList.toggle('is-active', other === key);
  }

  hide(): void {
    this.layout([]);
  }

  private partsFor(key: string): Parts {
    let parts = this.parts.get(key);
    if (parts) return parts;
    const doc = this.root.ownerDocument;
    const make = (className: string, label: string, svg: string | null, onPress: () => void): HTMLElement => {
      const element = doc.win.createDiv();
      element.className = className;
      element.setAttribute('aria-label', label);
      if (svg) setSvg(element, svg);
      element.addEventListener('pointerdown', (event) => {
        // Not the board's: a press here must not start a drag or move the camera, nor take the focus from the editor.
        event.preventDefault();
        event.stopPropagation();
        if (event.button === 0) onPress();
      });
      element.addEventListener('contextmenu', (event) => event.preventDefault());
      this.root.appendChild(element);
      return element;
    };
    parts = {
      hit: make('atlas-tabletop-resource-hit', `Edit ${key}`, null, () => this.actions.edit(key)),
      minus: make('atlas-tabletop-resource-button', `Lower ${key}`, MINUS_SVG, () => this.actions.step(key, -1)),
      plus: make('atlas-tabletop-resource-button', `Raise ${key}`, PLUS_SVG, () => this.actions.step(key, 1)),
    };
    parts.minus.style.color = DANGER;
    this.parts.set(key, parts);
    return parts;
  }

  dispose(): void {
    this.root.remove();
    this.parts.clear();
  }
}

function place(element: HTMLElement, left: number, top: number, width: number, height: number): void {
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
}

/** Where the editor hangs: the resource's middle, its top and bottom edges, in the window's pixels. */
export interface EditorAnchor {
  x: number;
  top: number;
  bottom: number;
}

export interface ValueEditor {
  close(): void;
  reposition(anchor: EditorAnchor): void;
  readonly element: HTMLElement;
}

const POPOVER_GAP = 6;
const VIEWPORT_MARGIN = 8;

/**
 * Atlas's resource editor, in its classes (Atlas's styles draw it; Tabletop's own are the fallback): current / max
 * under the resource, above it when there is no room below.
 */
export function openValueEditor(options: {
  doc: Document;
  anchor: EditorAnchor;
  value: ResourceValue;
  label: string;
  onCommit: (value: ResourceValue) => void;
  onClose: () => void;
}): ValueEditor {
  const { doc, value, label, onCommit, onClose } = options;
  const win = doc.defaultView ?? window;
  const root = doc.win.createDiv();
  root.className = 'atlas-vtt-plugin atlas-token-value-editor atlas-tabletop-value-editor';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `Edit ${label}`);
  const field = (name: string, initial: number): HTMLInputElement => {
    const input = doc.win.createEl('input');
    input.className = 'atlas-token-value-editor__input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', name);
    input.value = String(initial);
    root.appendChild(input);
    return input;
  };
  const currentInput = field(`Current ${label}`, value.current);
  const separator = doc.win.createSpan();
  separator.className = 'atlas-token-value-editor__separator';
  separator.textContent = '/';
  root.appendChild(separator);
  const maxInput = field(`Maximum ${label}`, value.max);
  doc.body.appendChild(root);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    doc.removeEventListener('pointerdown', onOutside, true);
    root.remove();
    onClose();
  };
  const parse = (): ResourceValue | null => {
    const withMax = parseValueInput(maxInput.value, value, 'max');
    const next = withMax && parseValueInput(currentInput.value, withMax, 'current');
    maxInput.toggleAttribute('aria-invalid', !withMax);
    currentInput.toggleAttribute('aria-invalid', !!withMax && !next);
    return next;
  };
  const commit = (): boolean => {
    const next = parse();
    if (!next) {
      (maxInput.hasAttribute('aria-invalid') ? maxInput : currentInput).focus();
      return false;
    }
    onCommit(next);
    close();
    return true;
  };
  const dirty = (): boolean => currentInput.value !== String(value.current) || maxInput.value !== String(value.max);
  const onOutside = (event: PointerEvent): void => {
    if (root.contains(event.target as Node)) return;
    if (!dirty() || !commit()) close();
  };
  doc.addEventListener('pointerdown', onOutside, true);
  root.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.target instanceof win.HTMLInputElement) {
      event.preventDefault();
      // Only a plain number steps: a relative change (+5, -3) is left as typed.
      const input = event.target;
      const parsed = /^\d+$/.exec(input.value.trim());
      if (!parsed) return;
      input.value = String(Math.max(0, Number(parsed[0]) + (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1)));
      input.select();
    }
  });

  const reposition = (anchor: EditorAnchor): void => {
    const halfWidth = root.offsetWidth / 2;
    const x = Math.min(Math.max(anchor.x, VIEWPORT_MARGIN + halfWidth), win.innerWidth - VIEWPORT_MARGIN - halfWidth);
    const below = anchor.bottom + POPOVER_GAP;
    const fitsBelow = below + root.offsetHeight <= win.innerHeight - VIEWPORT_MARGIN;
    root.style.left = `${x}px`;
    root.style.top = `${fitsBelow ? below : anchor.top - POPOVER_GAP - root.offsetHeight}px`;
  };
  reposition(options.anchor);
  currentInput.focus();
  currentInput.select();
  return { close, reposition, element: root };
}
