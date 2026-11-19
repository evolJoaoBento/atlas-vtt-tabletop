/**
 * On-board resize ring for the see-through walls window: sits over the canvas centred on the camera's pivot, shows the
 * window's radius at the pivot, and lets the GM drag its edge (mouse or touch) to change `seeThroughSize`.
 */

import { readSeeThroughSize } from './quality';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Screen geometry of the see-through window at the camera's pivot, in CSS pixels relative to the canvas. */
export interface SeeThroughCircle {
  x: number;
  y: number;
  radius: number;
  pxPerSquare: number;
}

export interface SeeThroughRingOptions {
  /** Projects the see-through window at the pivot onto the board, or null in views without a cut (first-person, AR). */
  circle(): SeeThroughCircle | null;
  /** Whether see-through walls is currently enabled (off dims and dashes the ring, while still allowing resize). */
  enabled(): boolean;
  /** Current window size in grid squares. */
  size(): number;
  /** Applies a new window size in grid squares (already clamped and stepped to 0.1). */
  setSize(squares: number): void;
  /** Called if the ring closes itself because the board entered a view with no cut. */
  onClose(): void;
}

export class SeeThroughRing {
  private readonly root: HTMLElement;
  private readonly circleEl: SVGCircleElement;
  private readonly hitEl: SVGCircleElement;
  private readonly handleEl: SVGCircleElement;
  private readonly readout: HTMLElement;
  private open = false;
  private dragging: { pointerId: number; target: Element } | null = null;
  private lastSquares: number | null = null;

  constructor(container: HTMLElement, private readonly options: SeeThroughRingOptions) {
    const doc = container.ownerDocument;
    this.root = doc.createElement('div');
    this.root.className = 'atlas-tabletop-seethrough-ring';
    this.root.hidden = true;
    container.appendChild(this.root);

    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'atlas-tabletop-seethrough-ring__svg');
    svg.setAttribute('aria-hidden', 'true');
    this.root.appendChild(svg);

    this.circleEl = doc.createElementNS(SVG_NS, 'circle');
    this.circleEl.setAttribute('class', 'atlas-tabletop-seethrough-ring__circle');
    svg.appendChild(this.circleEl);

    this.hitEl = doc.createElementNS(SVG_NS, 'circle');
    this.hitEl.setAttribute('class', 'atlas-tabletop-seethrough-ring__hit');
    svg.appendChild(this.hitEl);

    this.handleEl = doc.createElementNS(SVG_NS, 'circle');
    this.handleEl.setAttribute('class', 'atlas-tabletop-seethrough-ring__handle');
    this.handleEl.setAttribute('r', '6');
    svg.appendChild(this.handleEl);

    this.readout = doc.createElement('div');
    this.readout.className = 'atlas-tabletop-seethrough-ring__readout';
    this.root.appendChild(this.readout);

    for (const target of [this.hitEl, this.handleEl]) {
      target.addEventListener('pointerdown', (event) => this.onPointerDown(event, target));
      target.addEventListener('pointermove', (event) => this.onPointerMove(event));
      target.addEventListener('pointerup', (event) => this.onPointerUp(event));
      target.addEventListener('pointercancel', (event) => this.onPointerUp(event));
      for (const type of ['click', 'dblclick', 'contextmenu'] as const) {
        target.addEventListener(type, (event) => { event.stopPropagation(); event.preventDefault(); });
      }
    }
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Shows or hides the resize ring. Returns whether it is open afterward. */
  setOpen(open: boolean): boolean {
    if (open) {
      if (!this.options.circle()) {
        this.hide();
        return false;
      }
      this.open = true;
      this.root.hidden = false;
      this.sync();
      return this.open;
    }
    this.hide();
    return false;
  }

  /** True when `node` belongs to this ring overlay (used so outside-click closing ignores it). */
  contains(node: Node | null): boolean {
    return node !== null && this.root.contains(node);
  }

  /** Recomputes the ring's screen position, radius and readout from the board's current camera. */
  sync(): boolean {
    if (!this.open) return false;
    const circle = this.options.circle();
    if (!circle) {
      this.hide();
      this.options.onClose();
      return false;
    }
    const cx = String(circle.x);
    const cy = String(circle.y);
    const r = String(circle.radius);
    this.circleEl.setAttribute('cx', cx);
    this.circleEl.setAttribute('cy', cy);
    this.circleEl.setAttribute('r', r);
    this.hitEl.setAttribute('cx', cx);
    this.hitEl.setAttribute('cy', cy);
    this.hitEl.setAttribute('r', r);
    this.handleEl.setAttribute('cx', String(circle.x + circle.radius));
    this.handleEl.setAttribute('cy', cy);

    const squares = readSeeThroughSize(this.options.size());
    this.lastSquares = squares;
    this.readout.textContent = `${squares.toFixed(1)} squares`;
    this.root.classList.toggle('is-dimmed', !this.options.enabled());

    // Place the readout beside the right handle, flipping inside and clamping if near or past the board's right edge.
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    const badgeWidth = this.readout.offsetWidth || 88;
    const rightSide = circle.x + circle.radius + 14;
    const flip = width > 0 && rightSide + badgeWidth > width - 8;
    this.readout.classList.toggle('is-left', flip);
    const left = flip
      ? Math.min(width - 8, Math.max(8 + badgeWidth, circle.x + circle.radius - 14))
      : Math.max(8, rightSide);
    const top = height > 0 ? Math.min(height - 20, Math.max(20, circle.y)) : circle.y;
    this.readout.style.left = `${left}px`;
    this.readout.style.top = `${top}px`;
    return true;
  }

  private hide(): void {
    this.endDrag();
    this.open = false;
    this.root.hidden = true;
    this.root.classList.remove('is-dragging');
  }

  private onPointerDown(event: PointerEvent, target: Element): void {
    event.stopPropagation();
    event.preventDefault();
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.dragging = { pointerId: event.pointerId, target };
    this.root.classList.add('is-dragging');
    try { target.setPointerCapture(event.pointerId); } catch { /* synthetic events without an active pointer */ }
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.dragging.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    const circle = this.options.circle();
    if (!circle) {
      this.hide();
      this.options.onClose();
      return;
    }
    const rect = this.root.getBoundingClientRect();
    const dx = (event.clientX - rect.left) - circle.x;
    const dy = (event.clientY - rect.top) - circle.y;
    const px = Math.hypot(dx, dy);
    const raw = readSeeThroughSize(px / circle.pxPerSquare);
    const next = readSeeThroughSize(Math.round(raw * 10) / 10);
    if (next !== this.lastSquares) {
      this.lastSquares = next;
      this.options.setSize(next);
    }
    this.sync();
  }

  private onPointerUp(event: PointerEvent): void {
    if (!this.dragging || event.pointerId !== this.dragging.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    this.endDrag();
  }

  private endDrag(): void {
    if (!this.dragging) return;
    const { pointerId, target } = this.dragging;
    this.dragging = null;
    this.root.classList.remove('is-dragging');
    try { target.releasePointerCapture(pointerId); } catch { /* capture already ended */ }
  }

  dispose(): void {
    this.hide();
    this.root.remove();
  }
}
