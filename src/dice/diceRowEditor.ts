/**
 * The tray's row while it is edited (Atlas 0.18's `DiceRowEditor`), in Atlas's markup and classes: its places wiggle, a drag
 * moves one (as a phone's home screen does; `useRowDrag` as `diceRow.ts`'s arithmetic), its x takes it out, and + at the end
 * adds a die of any size, typed (`d3`). Saved rolls join the row from their pin in the saved rolls' panel. What changes goes to the
 * collection through `write`; the tray draws the editor again from what Atlas then holds. Plain DOM.
 */
import { at } from '../atlasPort/atlasText';
import {
  MAX_ROW, typedRowDie, withRowDie, withRowSlotMoved, withoutRowSlot, type DiceShelf, type RowDieProblem, type ShelfChange,
} from '../atlasPort/app/react/components/dice/diceShelf';
import { FORMULA_LIMITS } from '../atlasPort/app/tools/parseFormula';
import { setSvg } from '../svg';
import { dragOffsets, dragTarget, rowColumns, type Point, type RowPlace } from './diceRow';

export interface RowEditorHost {
  doc: Document;
  /** The shelf as the collection holds it now. */
  shelf(): DiceShelf | null;
  /** Writes a change of the row to the collection. */
  write(change: ShelfChange): void;
  /** The picture of a place (its die, or its saved roll's face). */
  art(place: RowPlace): HTMLElement;
  /** The place that keeps the focus when the editor is drawn again after a key moved a place. */
  keepFocus(place: number): void;
}

const svg = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
/** Lucide's `x` and `plus` (ISC). */
const X_SVG = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const PLUS_SVG = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');

/** How far a press moves before it is a drag, so a tap on a place's x stays a tap. */
const DRAG_THRESHOLD = 4;

type Make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, into?: HTMLElement) => HTMLElementTagNameMap[K];

/** Why a typed die stays out of the row, in words. */
function problemText(problem: RowDieProblem, sides: number | null): string {
  switch (problem) {
    case 'not-a-die': return at('diceRoll.rowNotADie');
    case 'faces': return at('diceRoll.rowFaces', { min: 2, max: FORMULA_LIMITS.faces });
    case 'present': return at('diceRoll.rowPresent', { sides: sides ?? 0 });
    case 'full': return at('diceRoll.presetRowFull', { max: MAX_ROW });
  }
}

/** The editor of `places` (the row's places as the tray shows them); the tray puts it in the row's place. */
export function buildRowEditor(host: RowEditorHost, places: readonly RowPlace[]): HTMLElement {
  const doc = host.doc;
  const el: Make = (tag, className, into) => {
    const made = doc.win.createEl(tag);
    made.className = className;
    into?.appendChild(made);
    return made;
  };
  const wrap = el('div', 'atlas-dice-tray__row-edit');
  const room = places.length < MAX_ROW;
  const row = el('div', 'atlas-dice-tray__dice atlas-dice-tray__dice--editing', wrap);
  row.style.setProperty('--atlas-tray-slots', String(rowColumns(places.length + (room ? 1 : 0))));
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', at('diceRoll.rowTitle'));
  // The dice are images, which the browser would drag as files and cancel the pointer for.
  row.addEventListener('dragstart', (event) => event.preventDefault());
  const note = el('p', 'atlas-dice-tray__row-note');
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');

  const move = (from: number, to: number): void => {
    const shelf = host.shelf();
    const change = shelf ? withRowSlotMoved(shelf, from, to) : null;
    if (change) host.write(change);
  };

  interface Drag { pointerId: number; from: number; to: number; start: Point; moved: boolean; centres: Point[] }
  let drag: Drag | null = null;
  const dice: HTMLElement[] = [];
  const offsetAll = (offsets: readonly string[]): void => dice.forEach((die, index) => { die.style.translate = offsets[index] ?? '0 0'; });
  const drop = (): void => {
    drag = null;
    offsetAll([]);
    dice.forEach((each) => each.removeAttribute('data-held'));
  };

  places.forEach((place, index) => {
    const die = el('div', 'atlas-dice-tray__die', row);
    dice.push(die);
    const face = el('div', 'atlas-dice-tray__face', die);
    face.setAttribute('role', 'img');
    face.tabIndex = 0;
    face.setAttribute('aria-label', at('diceRoll.rowPlace', { name: place.caption, place: index + 1 }));
    face.appendChild(host.art(place));
    const remove = el('button', 'atlas-dice-tray__remove', die);
    remove.type = 'button';
    remove.setAttribute('aria-label', at('diceRoll.rowRemove', { name: place.caption }));
    setSvg(remove, X_SVG);
    remove.addEventListener('pointerdown', (event) => event.stopPropagation());
    remove.addEventListener('click', () => {
      const shelf = host.shelf();
      if (shelf) host.write(withoutRowSlot(shelf, index));
    });
    const caption = el('span', 'atlas-dice-tray__caption', die);
    caption.textContent = place.caption;
    caption.setAttribute('aria-hidden', 'true');

    die.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const centres = dice.map((each) => {
        const rect = each.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      die.setPointerCapture?.(event.pointerId);
      drag = { pointerId: event.pointerId, from: index, to: index, start: { x: event.clientX, y: event.clientY }, moved: false, centres };
    });
    die.addEventListener('pointermove', (event) => {
      const now = drag;
      if (!now || event.pointerId !== now.pointerId) return;
      const delta = { x: event.clientX - now.start.x, y: event.clientY - now.start.y };
      now.moved = now.moved || Math.hypot(delta.x, delta.y) > DRAG_THRESHOLD;
      if (!now.moved) return;
      now.to = dragTarget(now.centres, now.from, delta);
      dice[now.from]?.setAttribute('data-held', '');
      offsetAll(dragOffsets(now.centres, now.from, now.to, delta));
    });
    die.addEventListener('pointerup', (event) => {
      const done = drag;
      if (!done || event.pointerId !== done.pointerId) return;
      drop();
      if (done.moved && done.to !== done.from) {
        // The row takes its new order without sliding.
        row.classList.add('atlas-dice-tray__dice--settling');
        doc.defaultView?.requestAnimationFrame(() => row.classList.remove('atlas-dice-tray__dice--settling'));
        move(done.from, done.to);
      }
    });
    die.addEventListener('pointercancel', drop);
    die.addEventListener('keydown', (event) => {
      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      event.stopPropagation();
      const to = index + (event.key === 'ArrowLeft' ? -1 : 1);
      if (to >= 0 && to < places.length) host.keepFocus(to);
      move(index, to);
    });
  });
  if (room) row.appendChild(addDie(host, note, el));
  // Out of the flow, in the gap under the row, so nothing moves when it speaks.
  wrap.appendChild(note);
  return wrap;
}

/**
 * The last place while the row has room: + opens a field in it, where a die typed (`d3`) joins the row. A die that cannot join
 * shakes the field and says why in the note under the row, until the field changes.
 */
function addDie(host: RowEditorHost, note: HTMLElement, el: Make): HTMLElement {
  const cell = el('div', 'atlas-dice-tray__die');
  const label = at('diceRoll.rowAddDie');
  const plus = el('button', 'atlas-dice-tray__face atlas-dice-tray__add', cell);
  plus.type = 'button';
  plus.setAttribute('aria-label', label);
  setSvg(plus, PLUS_SVG);
  const caption = el('span', 'atlas-dice-tray__caption', cell);
  caption.textContent = at('diceRoll.rowAddDieCaption');
  caption.setAttribute('aria-hidden', 'true');
  let shakes = 0;
  plus.addEventListener('click', () => {
    const field = el('input', 'atlas-dice-tray__face atlas-dice-tray__add-field');
    field.value = '';
    field.placeholder = 'd3';
    field.setAttribute('aria-label', label);
    field.spellcheck = false;
    field.autocomplete = 'off';
    plus.replaceWith(field);
    field.focus();
    const add = (): void => {
      const shelf = host.shelf();
      if (!shelf) return;
      const { sides, problem } = typedRowDie(shelf, field.value);
      const change = problem === null && sides !== null ? withRowDie(shelf, sides) : null;
      note.textContent = change ? '' : problemText(problem ?? 'not-a-die', sides);
      if (change) { host.write(change); return; }
      field.setAttribute('aria-invalid', 'true');
      // Every refusal shakes again: two identical keyframes, taken in turn, restart the animation.
      shakes += 1;
      field.setAttribute('data-shake', String(shakes % 2));
    };
    field.addEventListener('input', () => { note.textContent = ''; field.removeAttribute('aria-invalid'); });
    field.addEventListener('blur', () => {
      if (field.value.trim() !== '') return;
      field.replaceWith(plus);
      note.textContent = '';
    });
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      event.stopPropagation();
      add();
    });
  });
  return cell;
}
