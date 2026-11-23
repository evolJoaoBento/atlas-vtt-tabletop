/**
 * Floating hover tooltip styled after Atlas's `ToolButton` / `tooltip.css`: appears 10 px above a toolbar button
 * with a short label, optional shortcut keycap and optional muted subtitle, without triggering browser or Obsidian
 * native tooltips.
 */

export interface AtlasTooltipSpec {
  label: string;
  shortcut?: string;
  subtitle?: string;
}

const OPEN_DELAY_MS = 300;
const SKIP_DELAY_MS = 300;
const EXIT_MS = 100;
const SIDE_OFFSET = 10;
const EDGE_MARGIN = 8;

export class AtlasTooltip {
  private readonly host: HTMLElement;
  private readonly el: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly kbdEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private active: { trigger: HTMLElement; spec: () => AtlasTooltipSpec | null } | null = null;
  private openTimer: number | null = null;
  private closeTimer: number | null = null;
  private closedAt = -Infinity;
  private readonly cleanups: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.host = container;
    const doc = container.ownerDocument;
    this.el = doc.createElement('div');
    this.el.className = 'tooltip-content atlas-tabletop-atlas-tooltip';
    this.el.setAttribute('role', 'tooltip');
    this.el.dataset.side = 'top';
    this.el.dataset.state = 'closed';
    this.el.hidden = true;

    const body = doc.createElement('div');
    const inner = doc.createElement('div');
    inner.className = 'tooltip-inner';
    this.labelEl = doc.createElement('span');
    this.labelEl.className = 'tooltip-label';
    this.kbdEl = doc.createElement('kbd');
    this.kbdEl.className = 'tooltip-kbd';
    this.kbdEl.hidden = true;
    inner.append(this.labelEl, this.kbdEl);

    this.subtitleEl = doc.createElement('span');
    this.subtitleEl.className = 'tooltip-subtitle';
    this.subtitleEl.hidden = true;
    body.append(inner, this.subtitleEl);
    this.el.appendChild(body);
    container.appendChild(this.el);

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !this.el.hidden) this.hide();
    };
    doc.addEventListener('keydown', onKey, true);
    this.cleanups.push(() => doc.removeEventListener('keydown', onKey, true));
  }

  /** Wires hover and keyboard focus on `trigger` (use the `<span>` around a button so disabled buttons work too). Returns what unwires it. */
  /** A spec that gives null shows nothing (the control has no tooltip for now). */
  attach(trigger: HTMLElement, spec: () => AtlasTooltipSpec | null): () => void {
    trigger.style.setProperty('--no-tooltip', 'true');
    const onEnter = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      this.schedule(trigger, spec, false);
    };
    const onLeave = (): void => {
      if (this.active?.trigger === trigger) this.closeAnimated();
      else this.clearOpenTimer();
    };
    const onDown = (): void => { this.hide(); };
    const onFocusIn = (): void => {
      if (trigger.matches(':focus-visible') || trigger.querySelector(':focus-visible')) {
        this.schedule(trigger, spec, true);
      }
    };
    const onFocusOut = (): void => {
      if (this.active?.trigger === trigger) this.hide();
    };
    trigger.addEventListener('pointerenter', onEnter);
    trigger.addEventListener('pointerleave', onLeave);
    trigger.addEventListener('pointerdown', onDown);
    trigger.addEventListener('focusin', onFocusIn);
    trigger.addEventListener('focusout', onFocusOut);
    const detach = (): void => {
      if (this.active?.trigger === trigger) this.hide();
      trigger.removeEventListener('pointerenter', onEnter);
      trigger.removeEventListener('pointerleave', onLeave);
      trigger.removeEventListener('pointerdown', onDown);
      trigger.removeEventListener('focusin', onFocusIn);
      trigger.removeEventListener('focusout', onFocusOut);
      const at = this.cleanups.indexOf(detach);
      if (at >= 0) this.cleanups.splice(at, 1);
    };
    this.cleanups.push(detach);
    return detach;
  }

  /** Re-reads the active trigger's content and repositions the tooltip if it is showing. */
  refresh(): void {
    if (!this.active || this.el.hidden) return;
    const spec = this.active.spec();
    if (spec) this.render(this.active.trigger, spec);
    else this.hide();
  }

  /** Hides the tooltip immediately and cancels any pending hover timer. */
  hide(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    if (!this.el.hidden) this.closedAt = this.now();
    this.active = null;
    this.el.dataset.state = 'closed';
    this.el.hidden = true;
  }

  dispose(): void {
    this.hide();
    for (const stop of this.cleanups) stop();
    this.cleanups.length = 0;
    this.el.remove();
  }

  private schedule(trigger: HTMLElement, spec: () => AtlasTooltipSpec | null, immediate: boolean): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    const warm = !this.el.hidden || this.now() - this.closedAt < SKIP_DELAY_MS;
    if (immediate || warm) {
      this.show(trigger, spec);
      return;
    }
    const win = this.host.ownerDocument.defaultView ?? window;
    this.openTimer = win.setTimeout(() => {
      this.openTimer = null;
      this.show(trigger, spec);
    }, OPEN_DELAY_MS);
  }

  private show(trigger: HTMLElement, spec: () => AtlasTooltipSpec | null): void {
    this.clearCloseTimer();
    const now = spec();
    if (!now) { this.hide(); return; }
    this.active = { trigger, spec };
    this.render(trigger, now);
  }

  private render(trigger: HTMLElement, spec: AtlasTooltipSpec): void {
    this.labelEl.textContent = spec.label;
    if (spec.shortcut) {
      this.kbdEl.textContent = spec.shortcut;
      this.kbdEl.hidden = false;
    } else {
      this.kbdEl.textContent = '';
      this.kbdEl.hidden = true;
    }
    if (spec.subtitle) {
      this.subtitleEl.textContent = spec.subtitle;
      this.subtitleEl.hidden = false;
    } else {
      this.subtitleEl.textContent = '';
      this.subtitleEl.hidden = true;
    }

    this.el.hidden = false;
    this.el.dataset.state = 'open';
    const triggerRect = trigger.getBoundingClientRect();
    const hostRect = this.host.getBoundingClientRect();
    const tipWidth = this.el.offsetWidth;
    const tipHeight = this.el.offsetHeight;

    const rawLeft = (triggerRect.left - hostRect.left) + triggerRect.width / 2 - tipWidth / 2;
    const maxLeft = Math.max(EDGE_MARGIN, hostRect.width - tipWidth - EDGE_MARGIN);
    const left = Math.min(Math.max(EDGE_MARGIN, rawLeft), maxLeft);

    const aboveTop = (triggerRect.top - hostRect.top) - tipHeight - SIDE_OFFSET;
    const fitsAbove = aboveTop >= EDGE_MARGIN;
    const top = fitsAbove ? aboveTop : (triggerRect.bottom - hostRect.top) + SIDE_OFFSET;
    this.el.dataset.side = fitsAbove ? 'top' : 'bottom';
    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
  }

  private closeAnimated(): void {
    this.clearOpenTimer();
    this.clearCloseTimer();
    this.active = null;
    if (this.el.hidden) return;
    this.closedAt = this.now();
    this.el.dataset.state = 'closed';
    const win = this.host.ownerDocument.defaultView ?? window;
    this.closeTimer = win.setTimeout(() => {
      this.closeTimer = null;
      if (!this.active) this.el.hidden = true;
    }, EXIT_MS);
  }

  private clearOpenTimer(): void {
    if (this.openTimer === null) return;
    (this.host.ownerDocument.defaultView ?? window).clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  private clearCloseTimer(): void {
    if (this.closeTimer === null) return;
    (this.host.ownerDocument.defaultView ?? window).clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  private now(): number {
    return (this.host.ownerDocument.defaultView ?? window).performance.now();
  }
}
