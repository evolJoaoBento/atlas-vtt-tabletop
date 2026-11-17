/**
 * The veil over a board while its map loads (`loadProgress.ts`): the board behind blurred, and a bar that fills
 * smoothly with how much is in and the time left. It shows only when loading takes a moment (a quick load shows
 * nothing), never takes the pointer (the board stays usable beneath), and fades away once all is in.
 */
import { LoadProgress, timeLeft } from './loadProgress';

/** How long a load must go on before the veil shows, in milliseconds. */
export const SHOW_AFTER_MS = 250;
/** How quickly the bar follows what is in, and the time left its estimate (a time constant, in milliseconds). */
const EASE_MS = 180;
const ETA_EASE_MS = 900;
/** How far the bar fills before all is in: the last stretch waits for the end. */
const HELD = 0.97;

export class LoadingOverlay {
  readonly root: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private frame: number | null = null;
  /** The window the pending frame was asked of (the board can move to a pop-out). */
  private frameWin: Window | null = null;
  private shown = 0;
  private eta: number | null = null;
  private last = 0;
  private visible = false;
  private readonly stop: () => void;

  constructor(private readonly container: HTMLElement, private readonly progress: LoadProgress, private readonly clock: () => number = () => performance.now()) {
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'atlas-tabletop-loading';
    this.root.setAttribute('role', 'progressbar');
    this.root.setAttribute('aria-label', 'Loading the board');
    this.root.setAttribute('aria-valuemin', '0');
    this.root.setAttribute('aria-valuemax', '100');
    this.root.hidden = true;
    const card = doc.createElement('div');
    card.className = 'atlas-tabletop-loading__card';
    this.label = doc.createElement('div');
    this.label.className = 'atlas-tabletop-loading__label';
    this.label.textContent = 'Loading the board';
    const track = doc.createElement('div');
    track.className = 'atlas-tabletop-loading__track';
    this.fill = doc.createElement('div');
    this.fill.className = 'atlas-tabletop-loading__fill';
    track.append(this.fill);
    this.detail = doc.createElement('div');
    this.detail.className = 'atlas-tabletop-loading__detail';
    card.append(this.label, track, this.detail);
    this.root.append(card);
    container.append(this.root);
    this.stop = progress.onChange(() => this.wake());
  }

  /** Whether the veil is up now (test support). */
  get isShown(): boolean {
    return this.visible;
  }

  private wake(): void {
    // A frame asked of a window the board has left (or that closed) never comes: ask again of this one.
    if (this.frame !== null && this.frameWin === this.win() && !this.frameWin.closed) return;
    this.cancel();
    this.last = this.clock();
    this.schedule();
  }

  private schedule(): void {
    this.frameWin = this.win();
    this.frame = this.frameWin.requestAnimationFrame(() => this.tick());
  }

  private cancel(): void {
    if (this.frame !== null && this.frameWin && !this.frameWin.closed) this.frameWin.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  private win(): Window {
    return this.container.ownerDocument.defaultView ?? window;
  }

  private tick(): void {
    this.frame = null;
    const now = this.clock();
    const dt = Math.max(0, now - this.last);
    this.last = now;
    const state = this.progress.state();
    if (state.open) {
      if (!this.visible && state.elapsedMs >= SHOW_AFTER_MS && state.fraction < 1) this.show();
      const target = Math.min(HELD, state.fraction);
      // Smooth, and never back: more asked for slows the bar, it does not empty it.
      this.shown = Math.max(this.shown, this.shown + (target - this.shown) * (1 - Math.exp(-dt / EASE_MS)));
      if (state.remainingMs !== null) this.eta = this.eta === null ? state.remainingMs : this.eta + (state.remainingMs - this.eta) * (1 - Math.exp(-dt / ETA_EASE_MS)) - dt;
      if (this.eta !== null) this.eta = Math.max(0, this.eta);
      this.draw(`${state.done} of ${state.total} · ${timeLeft(this.eta)}`);
      this.schedule();
      return;
    }
    // All in: the bar runs to its end and the veil fades.
    if (this.visible) {
      this.shown = 1;
      this.draw('done');
      this.hide();
    }
    this.shown = 0;
    this.eta = null;
  }

  private draw(detail: string): void {
    if (!this.visible) return;
    this.fill.style.transform = `scaleX(${this.shown.toFixed(4)})`;
    this.root.setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
    this.detail.textContent = detail;
  }

  private show(): void {
    this.visible = true;
    this.root.hidden = false;
    // The next frame fades it in (a change of class from hidden would not be eased).
    this.win().requestAnimationFrame(() => { if (this.visible) this.root.classList.add('is-shown'); });
  }

  private hide(): void {
    this.visible = false;
    this.root.classList.remove('is-shown');
    this.win().setTimeout(() => { if (!this.visible) this.root.hidden = true; }, 400);
  }

  dispose(): void {
    this.stop();
    this.cancel();
    this.root.remove();
  }
}
