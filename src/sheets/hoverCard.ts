/**
 * The stat block card Ctrl/Cmd + hover opens over a token, as Atlas shows it (`StatblockHoverPreview`): Atlas's own
 * card in a floating box by the pointer, closing when Ctrl/Cmd is let go. Where this Atlas draws no card, the page
 * preview of the note stands in (`fallback`). Its dice links throw the board's dice.
 */
import type { AdvantageSide } from './sheet';
import { drawCard, routeCardRolls, type CardHost } from './atlasCard';

/** Atlas's closing animation. */
const CLOSE_MS = 150;
const PADDING = 20;
/** The gap between the pointer and the card. */
const GAP = 15;

/** Atlas's own classes for this box (`statblock-preview-window.scss`): its surface, fade-in and fade-out come with them. */
const WINDOW = 'atlas-statblock-preview-window';
const MEASURING = `${WINDOW} ${WINDOW}--measuring`;
const CLOSING = `${WINDOW} ${WINDOW}--closing`;

/**
 * Where the card goes, as Atlas places its own (`StatblockPreviewWindow.setPosition`): beside the pointer, on the other
 * side where it would leave the window, then clamped inside it. `size`: the card as drawn.
 */
export function hoverPosition(at: { x: number; y: number }, size: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number; maxHeight: number } {
  let left = at.x + GAP;
  let top = at.y + GAP;
  if (left + size.width > view.width - PADDING) {
    left = at.x - size.width - GAP;
    if (left < PADDING) left = view.width - size.width - PADDING;
  }
  if (top + size.height > view.height - PADDING) {
    top = at.y - size.height - GAP;
    if (top < PADDING) top = view.height - size.height - PADDING;
  }
  return { left: Math.max(PADDING, left), top: Math.max(PADDING, top), maxHeight: view.height - PADDING * 2 };
}

interface Shown {
  box: HTMLElement;
  host: CardHost;
  stop: () => void;
}

export class StatblockHoverCard {
  private shown: Shown | null = null;
  private run = 0;
  /** Closes a window that is not this card's own: Atlas's, opened through its manager (`atlasPreview.ts`). */
  private external: (() => void) | null = null;
  private closing: { box: HTMLElement; host: CardHost; timer: number } | null = null;
  private readonly win: Window;

  constructor(
    private readonly doc: Document,
    private readonly onRoll: (formula: string, label: string, side?: AdvantageSide) => void,
    private readonly onReleased: () => void = () => {},
    private readonly settle?: (element: Element) => Promise<void>,
  ) {
    this.win = doc.defaultView ?? window;
    this.win.addEventListener('keyup', this.released);
  }

  /** Letting go of Ctrl (Cmd on macOS) closes the card. */
  private readonly released = (event: KeyboardEvent): void => {
    if (event.key !== 'Control' && event.key !== 'Meta') return;
    this.hide();
    this.onReleased();
  };

  /**
   * Draws `host`'s card by `at` (window coordinates). A card still being drawn for an earlier token never lands: the
   * newest request wins. `fallback` runs when this Atlas draws no card.
   */
  async show(host: CardHost, at: { x: number; y: number }, fallback: () => void): Promise<void> {
    this.clear();
    this.external?.();
    this.external = null;
    // The card of the token before goes at once, as the new one's takes its place.
    if (this.shown) {
      const old = this.shown;
      this.shown = null;
      old.stop();
      old.box.remove();
      old.host.dispose();
    }
    const run = ++this.run;
    const box = this.win.createDiv();
    // Drawn where it cannot be seen first: Atlas picks the card's columns from the width it has, and it needs measuring.
    box.className = MEASURING;
    // This card routes its own rolls: the page-wide routing of Atlas's window leaves it be.
    box.setAttribute('data-tabletop-card', 'true');
    // Capped to the window first, so what is measured is the card as it will show: its body scrolls when it is taller.
    box.setCssStyles({ maxHeight: `${this.win.innerHeight - PADDING * 2}px` });
    this.doc.body.append(box);
    const drawn = await drawCard(host, box, this.settle).catch(() => false);
    if (run !== this.run) {
      host.dispose();
      box.remove();
      return;
    }
    if (!drawn) {
      host.dispose();
      box.remove();
      fallback();
      return;
    }
    const rect = box.getBoundingClientRect();
    const place = hoverPosition(at, { width: rect.width, height: rect.height }, { width: this.win.innerWidth, height: this.win.innerHeight });
    box.setCssStyles({ left: `${place.left}px`, top: `${place.top}px`, maxHeight: `${place.maxHeight}px` });
    box.className = WINDOW;
    this.shown = { box, host, stop: routeCardRolls(box, this.onRoll) };
  }

  /** Atlas's own window is up: it closes with this card's rules (Ctrl/Cmd let go, another token), and no card of this one's is. */
  adopt(close: () => void): void {
    this.hide();
    this.external = close;
  }

  /** Closes the card, with Atlas's short fade; one still being drawn is dropped. */
  hide(): void {
    this.run += 1;
    const external = this.external;
    this.external = null;
    external?.();
    const shown = this.shown;
    this.shown = null;
    if (!shown) return;
    shown.stop();
    shown.box.className = CLOSING;
    const timer = this.win.setTimeout(() => {
      shown.box.remove();
      shown.host.dispose();
      if (this.closing?.box === shown.box) this.closing = null;
    }, CLOSE_MS);
    this.clear();
    this.closing = { box: shown.box, host: shown.host, timer };
  }

  /** Takes away a card that is closing, at once. */
  private clear(): void {
    const closing = this.closing;
    if (!closing) return;
    this.win.clearTimeout(closing.timer);
    closing.box.remove();
    closing.host.dispose();
    this.closing = null;
  }

  dispose(): void {
    this.win.removeEventListener('keyup', this.released);
    this.run += 1;
    this.external?.();
    this.external = null;
    this.clear();
    if (this.shown) {
      this.shown.stop();
      this.shown.box.remove();
      this.shown.host.dispose();
      this.shown = null;
    }
  }
}
