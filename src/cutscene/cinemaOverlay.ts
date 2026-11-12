/**
 * The cinema look laid over a board: letterbox bars at the top and bottom, and a black fade that covers everything under
 * it. It sits above every other overlay of the board and takes no pointer events. The bars are sized to the
 * container, so they follow it as it is resized.
 */

export class CinemaOverlay {
  private readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly bottom: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly watch: ResizeObserver | null;
  private ratio: number | null = null;
  private level = 0;

  constructor(private readonly container: HTMLElement) {
    const doc = container.ownerDocument;
    const make = (className: string, parent: HTMLElement): HTMLElement => {
      const element = doc.createElement('div');
      element.className = className;
      parent.appendChild(element);
      return element;
    };
    this.root = make('tabletop-cinema', container);
    this.top = make('tabletop-cinema__bar tabletop-cinema__bar--top', this.root);
    this.bottom = make('tabletop-cinema__bar tabletop-cinema__bar--bottom', this.root);
    this.fade = make('tabletop-cinema__fade', this.root);
    this.top.hidden = true;
    this.bottom.hidden = true;
    this.fade.style.opacity = '0';
    const win = doc.defaultView;
    this.watch = win && 'ResizeObserver' in win ? new win.ResizeObserver(() => this.size()) : null;
    this.watch?.observe(container);
  }

  /** The bars for a picture of `aspect` (width over height) letterboxed in the container; null takes them away. */
  setBars(aspect: number | null): void {
    this.ratio = aspect !== null && Number.isFinite(aspect) && aspect > 0 ? aspect : null;
    this.size();
  }

  /** The aspect the bars are set for, or null while there are none. */
  get aspect(): number | null {
    return this.ratio;
  }

  /** How black the fade is, 0 (clear) to 1 (black). */
  setBlack(level: number): void {
    this.level = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    this.fade.style.opacity = String(this.level);
  }

  get black(): number {
    return this.level;
  }

  /** The height of each bar in pixels: what the container has above and below a picture of the aspect, shared between them. */
  get barHeight(): number {
    if (this.ratio === null) return 0;
    return Math.max(0, (this.container.clientHeight - this.container.clientWidth / this.ratio) / 2);
  }

  private size(): void {
    const height = this.barHeight;
    const shown = this.ratio !== null && height > 0;
    for (const bar of [this.top, this.bottom]) {
      bar.hidden = !shown;
      bar.style.height = `${height}px`;
    }
  }

  dispose(): void {
    this.watch?.disconnect();
    this.root.remove();
  }
}
