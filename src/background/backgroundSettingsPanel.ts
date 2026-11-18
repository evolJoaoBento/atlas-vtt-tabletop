/**
 * The settings column of the background editor: the custom ground patterns, the range the painted heights cover, and how
 * each liquid (water, lava, acid) moves and looks. It edits the settings object it is given and says when something
 * changed; the editor decides what that means (the changed mark, the palette).
 */

import { LAVA_STYLES, LIQUID_DEFAULTS, LIQUID_KINDS, LIQUID_NAMES, LIQUID_TINTS, MOTION_LABELS, WATER_MOTION_KINDS, readWaterMotion, type LavaStyle, type LiquidKind, type WaterMotion, type WaterMotionKind } from '../board/water';
import { MAX_PATTERNS, type BackgroundSettings, type CustomPattern, type PatternShape } from './backgroundData';

/** The terrain number of the first custom pattern (Custom 1); the others follow it. */
const CUSTOM_TERRAIN_FIRST = 5;

const SHAPES: readonly { value: PatternShape; label: string }[] = [
  { value: 'smooth', label: 'Smooth' },
  { value: 'ridged', label: 'Ridged' },
  { value: 'terraced', label: 'Terraced' },
  { value: 'craters', label: 'Craters' },
];

/** What the editor can ask of the column. */
export interface SettingsPanel {
  /** Draws it again from the settings (after a background is opened, or a pattern added). */
  render(): void;
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

/** A labelled row holding one control, returned so the caller can fill it. */
function field(parent: HTMLElement, label: string): HTMLElement {
  const row = make(parent, 'label', 'atlas-tabletop-bg-field');
  make(row, 'span', 'atlas-tabletop-bg-field__label', label);
  return row;
}

function numberInput(row: HTMLElement, value: number, min: number, max: number, step: number, set: (value: number) => void): HTMLInputElement {
  const input = make(row, 'input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('change', () => {
    const typed = Number(input.value);
    const next = Number.isFinite(typed) ? clamp(typed, min, max) : value;
    input.value = String(next);
    set(next);
  });
  return input;
}

function rangeInput(row: HTMLElement, value: number, step: number, set: (value: number) => void): HTMLInputElement {
  const input = make(row, 'input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => set(Number(input.value)));
  return input;
}

/** Builds the column inside `root`. `settings()` gives the live settings; `changed` is called after every edit. */
export function buildSettingsPanel(root: HTMLElement, settings: () => BackgroundSettings, changed: () => void, clearIndex: (layer: 'terrain', value: number) => void = () => undefined): SettingsPanel {
  const section = (title: string): HTMLElement => {
    const box = make(root, 'section', 'atlas-tabletop-bg-section');
    make(box, 'h4', 'atlas-tabletop-bg-section__title', title);
    return box;
  };

  const patternsBox = (): void => {
    const s = settings();
    const box = section('Custom patterns');
    s.patterns.forEach((pattern, index) => {
      const card = make(box, 'div', 'atlas-tabletop-bg-pattern');
      card.dataset.bgPattern = String(index);
      const head = make(card, 'div', 'atlas-tabletop-bg-pattern__head');
      make(head, 'span', 'atlas-tabletop-bg-pattern__index', `Custom ${index + 1}`);
      if (index === s.patterns.length - 1) {
        const remove = make(head, 'button', 'atlas-tabletop-bg-small', 'Remove');
        remove.type = 'button';
        // What was painted with the pattern goes back to plains, so a pattern added later does not take it over.
        remove.addEventListener('click', () => { s.patterns.pop(); clearIndex('terrain', CUSTOM_TERRAIN_FIRST + index); changed(); render(); });
      }
      const name = make(field(card, 'Name'), 'input');
      name.type = 'text';
      name.maxLength = 60;
      name.value = pattern.name;
      name.addEventListener('change', () => { pattern.name = name.value.trim().slice(0, 60) || `Custom ${index + 1}`; name.value = pattern.name; changed(); });
      numberInput(field(card, 'Scale'), pattern.scale, 4, 200, 1, (v) => { pattern.scale = v; changed(); });
      numberInput(field(card, 'Height'), pattern.height, 0, 40, 0.5, (v) => { pattern.height = v; changed(); });
      numberInput(field(card, 'Roughness'), pattern.roughness, 1, 6, 1, (v) => { pattern.roughness = Math.round(v); changed(); });
      const shape = make(field(card, 'Shape'), 'select');
      for (const { value, label } of SHAPES) {
        const option = make(shape, 'option', undefined, label);
        option.value = value;
      }
      shape.value = pattern.shape;
      shape.addEventListener('change', () => { pattern.shape = shape.value as PatternShape; changed(); });
    });
    const add = make(box, 'button', 'atlas-tabletop-bg-small', s.patterns.length >= MAX_PATTERNS ? `Up to ${MAX_PATTERNS} patterns` : 'Add pattern');
    add.type = 'button';
    add.dataset.bgAction = 'add-pattern';
    add.disabled = s.patterns.length >= MAX_PATTERNS;
    add.addEventListener('click', () => {
      if (s.patterns.length >= MAX_PATTERNS) return;
      const fresh: CustomPattern = { name: `Custom ${s.patterns.length + 1}`, scale: 40, height: 6, roughness: 3, shape: 'smooth' };
      s.patterns.push(fresh);
      changed();
      render();
    });
  };

  const heightBox = (): void => {
    const s = settings();
    const box = section('Painted heights');
    numberInput(field(box, 'Lowest'), s.height.low, -100, 100, 0.5, (v) => { s.height.low = v; if (s.height.high < v) s.height.high = v; changed(); render(); }).dataset.bgHeight = 'low';
    numberInput(field(box, 'Highest'), s.height.high, -100, 100, 0.5, (v) => { s.height.high = v; if (s.height.low > v) s.height.low = v; changed(); render(); }).dataset.bgHeight = 'high';
    make(box, 'p', 'atlas-tabletop-bg-hint', 'Squares. Black on the height layer is the lowest, white the highest.');
  };

  const liquidBox = (kind: LiquidKind): void => {
    const s = settings();
    const motion = s.liquids[kind];
    const box = section(LIQUID_NAMES[kind]);
    box.dataset.bgLiquid = kind;
    const update = (changes: Partial<WaterMotion>): void => {
      s.liquids[kind] = readWaterMotion({ ...s.liquids[kind], ...changes }, LIQUID_DEFAULTS[kind]);
      changed();
    };
    const how = make(field(box, 'Motion'), 'select');
    for (const value of WATER_MOTION_KINDS) {
      const option = make(how, 'option', undefined, MOTION_LABELS[kind][value]);
      option.value = value;
    }
    how.value = motion.kind;
    how.addEventListener('change', () => update({ kind: how.value as WaterMotionKind }));
    rangeInput(field(box, 'Amount'), motion.amount, 0.05, (v) => update({ amount: v })).dataset.bgAmount = '';
    numberInput(field(box, 'Direction'), Math.round(motion.direction), 0, 360, 5, (v) => update({ direction: v }));
    if (kind !== 'lava') rangeInput(field(box, 'Clarity'), motion.clarity, 0.05, (v) => update({ clarity: v })).dataset.bgClarity = '';
    if (kind === 'lava') {
      const type = make(field(box, 'Type'), 'select');
      type.dataset.bgLavaStyle = '';
      for (const style of LAVA_STYLES) {
        const option = make(type, 'option', undefined, style.label);
        option.value = style.value;
        option.title = style.hint;
      }
      type.value = motion.style ?? 'crust';
      type.addEventListener('change', () => update({ style: type.value as LavaStyle }));
    }
    const tints = make(box, 'div', 'atlas-tabletop-bg-tints');
    const picker = make(field(box, 'Colour'), 'input');
    picker.type = 'color';
    picker.value = motion.tint;
    picker.addEventListener('input', () => { update({ tint: picker.value }); markTint(); });
    const markTint = (): void => {
      for (const chip of tints.querySelectorAll<HTMLElement>('.atlas-tabletop-bg-tint')) chip.classList.toggle('is-active', chip.dataset.tint === s.liquids[kind].tint);
    };
    for (const { name, tint } of LIQUID_TINTS[kind]) {
      const chip = make(tints, 'button', 'atlas-tabletop-bg-tint');
      chip.type = 'button';
      chip.title = name;
      chip.dataset.tint = tint;
      chip.style.background = tint;
      chip.addEventListener('click', () => { update({ tint }); picker.value = tint; markTint(); });
    }
    markTint();
  };

  const render = (): void => {
    root.textContent = '';
    patternsBox();
    heightBox();
    for (const kind of LIQUID_KINDS) liquidBox(kind);
  };
  render();
  return { render };
}
