/**
 * What can be done to a selected group of tokens as one: turn them all, or hurt or heal them all. The bar that offers
 * these shows over the board while two or more tokens are selected (Shift-click). The rules are pure, so they are
 * tested without a browser; the bar is plain DOM.
 */
import { setSvg } from '../svg';
import { t } from '../i18n';
import { withCurrent, type ResourceDefinition, type ResourceHolder, type ResourceValue } from './resources';

/** How far a click on a rotate button turns the tokens, in degrees. */
export const ROTATE_STEP = 45;
/** The most HP one click may take or give. */
export const HP_STEP_MAX = 999;

/** A rotation in degrees after turning by `delta`, kept within 0 to 360 (clockwise on screen, as Atlas has it). */
export function turned(rotation: number, delta: number): number {
  const next = (((rotation + delta) % 360) + 360) % 360;
  return Math.round(next * 100) / 100;
}

/** The resource the group's HP change applies to: the one called `hp`, else the first that drains and defeats. */
export function hpKey(definitions: readonly ResourceDefinition[]): string | null {
  return (definitions.find((definition) => definition.key === 'hp') ?? definitions.find((definition) => definition.direction === 'drains' && definition.defeatedWhenSpent === true))?.key ?? null;
}

/** What one token's resource becomes under a group change; null when the token holds none or it would not change. */
export function hpChange(token: ResourceHolder, key: string, delta: number): ResourceValue | null {
  const value = token.resources?.[key];
  if (!value) return null;
  const next = withCurrent(value, value.current + delta);
  return next.current === value.current ? null : next;
}

/** A number typed in the amount box: a whole number from 1 up, or null. */
export function readAmount(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return text.trim() !== '' && Number.isInteger(value) && value >= 1 && value <= HP_STEP_MAX ? value : null;
}

export interface GroupBarActions {
  rotate(delta: number): void;
  /** Hurt (a negative amount) or heal (positive) every token of the group. */
  hp(delta: number): void;
  clear(): void;
}

/** Lucide's `rotate-ccw`, `rotate-cw`, `heart`, `swords` and `x` icons (ISC). */
const svg = (body: string): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const LEFT_SVG = svg('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>');
const RIGHT_SVG = svg('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>');
const HEAL_SVG = svg('<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>');
const HURT_SVG = svg('<path d="m14.5 17.5 3 3 3-3"/><path d="M17.5 3.5v17"/><path d="M3 21l6-6"/><path d="m3 3 7 7"/>');
const CLOSE_SVG = svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');

/** The bar over the board while a group is selected: how many, turn them, hurt or heal them, let go. */
export class GroupBar {
  readonly element: HTMLElement;
  private readonly count: HTMLElement;
  private readonly amount: HTMLInputElement;
  private readonly hpButtons: HTMLButtonElement[] = [];

  constructor(container: HTMLElement, actions: GroupBarActions) {
    const doc = container.ownerDocument;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
      const made = doc.win.createEl(tag);
      made.className = className;
      if (text !== undefined) made.textContent = text;
      parent.appendChild(made);
      return made;
    };
    const button = (parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLButtonElement => {
      const made = make('button', 'btn btn--toolbar btn--icon atlas-tabletop-tool-button', parent);
      made.type = 'button';
      setSvg(made, icon);
      made.setAttribute('aria-label', label);
      made.title = label;
      made.addEventListener('click', onClick);
      return made;
    };
    this.element = make('div', 'atlas-tabletop-group-bar atlas-tabletop-atlas', container);
    this.element.hidden = true;
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', t('group.selected', { n: '' }).trim());
    this.count = make('span', 'atlas-tabletop-group-bar__count', this.element);
    make('span', 'atlas-tabletop-group-bar__divider', this.element);
    button(this.element, LEFT_SVG, t('group.rotateLeft', { deg: ROTATE_STEP }), () => actions.rotate(-ROTATE_STEP));
    button(this.element, RIGHT_SVG, t('group.rotateRight', { deg: ROTATE_STEP }), () => actions.rotate(ROTATE_STEP));
    make('span', 'atlas-tabletop-group-bar__divider', this.element);
    this.hpButtons.push(button(this.element, HURT_SVG, t('group.damage'), () => this.apply(-1, actions)));
    this.amount = make('input', 'atlas-tabletop-group-bar__amount', this.element);
    this.amount.type = 'text';
    this.amount.inputMode = 'numeric';
    this.amount.value = '1';
    this.amount.setAttribute('aria-label', t('group.amount'));
    this.amount.title = t('group.amount');
    this.hpButtons.push(button(this.element, HEAL_SVG, t('group.heal'), () => this.apply(1, actions)));
    make('span', 'atlas-tabletop-group-bar__divider', this.element);
    button(this.element, CLOSE_SVG, t('group.clear'), () => actions.clear());
    this.amount.addEventListener('input', () => this.amount.toggleAttribute('aria-invalid', readAmount(this.amount.value) === null));
    // Typing here must not move the camera.
    this.element.addEventListener('keydown', (event) => event.stopPropagation());
    // Presses on the bar are not the board's: no camera drag, no deselecting.
    this.element.addEventListener('pointerdown', (event) => event.stopPropagation());
  }

  private apply(sign: 1 | -1, actions: GroupBarActions): void {
    const amount = readAmount(this.amount.value);
    this.amount.toggleAttribute('aria-invalid', amount === null);
    if (amount !== null) actions.hp(sign * amount);
  }

  /** Shows the bar for `count` tokens (two or more), or hides it. */
  show(count: number, canHurt: boolean): void {
    this.element.hidden = count < 2;
    this.count.textContent = t('group.selected', { n: count });
    for (const made of this.hpButtons) made.disabled = !canHurt;
  }

  dispose(): void {
    this.element.remove();
  }
}
