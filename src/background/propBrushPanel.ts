/**
 * The Props tab's palette in the background editor: the prop brushes as coloured chips, an Add brush button, and the
 * settings of the chosen brush (its name, up to four props, how many stand in a square, how big they are). It edits the
 * brush list it is given and says when something changed; the editor decides what that means (the changed mark, the
 * picture).
 *
 * Brushes are numbered 1 to 6 in the order they were made, and the painted layer stores those numbers. So only the last
 * brush can be removed: the others keep their number, and what was painted with them keeps its meaning.
 */

import { MAX_BRUSHES, MAX_BRUSH_PROPS, type PropBrush } from './backgroundData';

/** The colours the brushes are shown in on the canvas (brush 1 is the first). */
export const BRUSH_COLORS: readonly string[] = ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#46c3e0', '#b24fe0'];

/** A prop the brush can pick, as the gallery's props library lists it. */
export interface PropChoice {
  path: string;
  name: string;
  thumb: string | null;
}

/** What the panel works on and tells. */
export interface PropBrushPanelHost {
  /** The brushes of the open background (edited in place). */
  brushes(): PropBrush[];
  /** The props a brush can scatter. */
  props(): PropChoice[];
  /** The chosen brush, 1 to 6, or 0 when there is none. */
  selected(): number;
  select(brush: number): void;
  /** A setting changed but the list of brushes stayed the same (a name, a number, a prop): nothing has to be redrawn. */
  edited(): void;
  /** Brushes were added or removed, so the editor redraws the palette and the picture. */
  restructured(): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function make<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const made = parent.ownerDocument.createElement(tag);
  if (cls) made.className = cls;
  if (text !== undefined) made.textContent = text;
  parent.appendChild(made);
  return made;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function field(parent: HTMLElement, label: string): HTMLElement {
  const row = make(parent, 'label', 'atlas-tabletop-bg-field');
  make(row, 'span', 'atlas-tabletop-bg-field__label', label);
  return row;
}

/** A number box that keeps what is typed inside `min`..`max` (a bad entry goes back to the last good value). */
function numberBox(row: HTMLElement, value: number, min: number, max: number, step: number, set: (value: number) => void): HTMLInputElement {
  const input = make(row, 'input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  let last = value;
  input.addEventListener('change', () => {
    const typed = Number(input.value);
    last = input.value.trim() !== '' && Number.isFinite(typed) ? clamp(typed, min, max) : last;
    input.value = String(last);
    set(last);
  });
  return input;
}

/** Draws the palette of the Props tab into `box` (which is emptied first). */
export function renderPropBrushPanel(box: HTMLElement, host: PropBrushPanelHost): void {
  box.textContent = '';
  const brushes = host.brushes();
  const chosen = host.selected();

  const chips = make(box, 'div', 'atlas-tabletop-bg-brushes');
  brushes.forEach((brush, index) => {
    const number = index + 1;
    const chip = make(chips, 'button', 'atlas-tabletop-bg-swatch');
    chip.type = 'button';
    chip.dataset.bgPropbrush = String(number);
    chip.classList.toggle('is-active', number === chosen);
    const dot = make(chip, 'span', 'atlas-tabletop-bg-swatch__dot');
    dot.style.background = BRUSH_COLORS[index];
    make(chip, 'span', 'atlas-tabletop-bg-brushname', brush.name);
    chip.addEventListener('click', () => { host.select(number); });
  });
  const add = make(chips, 'button', 'atlas-tabletop-bg-small', brushes.length >= MAX_BRUSHES ? `Up to ${MAX_BRUSHES} brushes` : 'Add brush');
  add.type = 'button';
  add.dataset.bgAction = 'add-brush';
  add.disabled = brushes.length >= MAX_BRUSHES;
  add.addEventListener('click', () => {
    if (brushes.length >= MAX_BRUSHES) return;
    brushes.push({ name: `Props ${brushes.length + 1}`, props: [], density: 10, scale: 1 });
    host.select(brushes.length);
    host.restructured();
  });

  const brush = chosen >= 1 && chosen <= brushes.length ? brushes[chosen - 1] : null;
  if (!brush) {
    make(box, 'p', 'atlas-tabletop-bg-hint', brushes.length ? 'Pick a brush to paint with.' : 'Add a brush, pick the props it scatters, then paint where they should stand.');
    return;
  }

  const card = make(box, 'div', 'atlas-tabletop-bg-brushcard');
  const head = make(card, 'div', 'atlas-tabletop-bg-pattern__head');
  make(head, 'span', 'atlas-tabletop-bg-pattern__index', `Brush ${chosen}`);
  if (chosen === brushes.length) {
    const remove = make(head, 'button', 'atlas-tabletop-bg-small', 'Remove');
    remove.type = 'button';
    remove.dataset.bgAction = 'remove-brush';
    remove.addEventListener('click', () => {
      brushes.pop();
      host.select(brushes.length);
      host.restructured();
    });
  }

  const numbers = make(card, 'div', 'atlas-tabletop-bg-brushcol');
  const pickers = make(card, 'div', 'atlas-tabletop-bg-brushcol');
  const name = make(field(numbers, 'Name'), 'input');
  name.type = 'text';
  name.maxLength = 60;
  name.value = brush.name;
  name.dataset.bgBrushName = '';
  name.addEventListener('change', () => {
    brush.name = name.value.trim().slice(0, 60) || `Props ${chosen}`;
    name.value = brush.name;
    const label = box.querySelector<HTMLElement>(`[data-bg-propbrush="${chosen}"] .atlas-tabletop-bg-brushname`);
    if (label) label.textContent = brush.name;
    host.edited();
  });

  numberBox(field(numbers, 'Density'), brush.density, 0.1, 200, 0.1, (v) => { brush.density = v; host.edited(); }).dataset.bgBrushDensity = '';
  numberBox(field(numbers, 'Scale'), brush.scale, 0.1, 20, 0.1, (v) => { brush.scale = v; host.edited(); }).dataset.bgBrushScale = '';

  // One picker for each prop chosen, and one empty to add another (up to four).
  const library = host.props();
  const known = new Set(library.map((p) => p.path));
  const slots = Math.min(MAX_BRUSH_PROPS, brush.props.length + 1);
  for (let slot = 0; slot < slots; slot++) {
    const path = brush.props[slot] ?? null;
    const pick = make(field(pickers, `Prop ${slot + 1}`), 'select');
    pick.dataset.bgBrushProp = String(slot);
    make(pick, 'option', undefined, '—').value = '';
    for (const p of [...library, ...(path && !known.has(path) ? [{ path, name: baseName(path), thumb: null }] : [])]) make(pick, 'option', undefined, p.name).value = p.path;
    pick.value = path ?? '';
    pick.addEventListener('change', () => {
      if (!pick.value) brush.props.splice(slot, 1);
      else if (brush.props.includes(pick.value) && brush.props[slot] !== pick.value) { pick.value = path ?? ''; return; } else brush.props[slot] = pick.value;
      host.edited();
      renderPropBrushPanel(box, host);
    });
  }
}
