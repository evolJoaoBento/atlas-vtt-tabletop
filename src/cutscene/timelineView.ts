/**
 * The timeline strip a cutscene is built on, along the bottom of the board: a ruler in seconds, a marker for each
 * shot, and the transition between every two. It draws a cutscene it is given and reports what the person does to it
 * (a click on empty time, a shot dragged, a right click); the studio decides what that changes. The maths of time and
 * place is pure and exported, so it is tested without a page.
 */

import { retime, type Cutscene, type Shot } from './cutsceneData';

/** How many pixels a second of the cutscene takes on the strip. */
export const DEFAULT_PX_PER_SECOND = 80;
/** Room kept left of the first second, so a shot at 0 is not cut by the edge. */
export const TIMELINE_PAD = 24;
/** Seconds of empty time kept after the last shot, to click on. */
const TAIL_SECONDS = 6;
/** How far a pointer must move before a press on a shot is a drag, in pixels. */
const DRAG_PX = 4;

/** The moment, in milliseconds, at `x` pixels along a strip scrolled by `scrollPx`; never before the start. */
export function timeAt(x: number, pxPerSecond = DEFAULT_PX_PER_SECOND, scrollPx = 0): number {
  return Math.max(0, Math.round(((x + scrollPx) / pxPerSecond) * 1000));
}

/** Where a moment is on the strip, in pixels from its left edge (scrolled by `scrollPx`). */
export function xAt(ms: number, pxPerSecond = DEFAULT_PX_PER_SECOND, scrollPx = 0): number {
  return (ms / 1000) * pxPerSecond - scrollPx;
}

/** The index of the shot a transition leads into when `ms` is strictly between it and the shot before; -1 elsewhere. */
export function gapBefore(shots: ReadonlyArray<Pick<Shot, 'at'>>, ms: number): number {
  for (let i = 1; i < shots.length; i++) {
    if (ms > shots[i - 1].at && ms < shots[i].at) return i;
  }
  return -1;
}

/** A map's name as the person knows it: the file name without its folders or extension. */
export function mapLabel(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

export interface MenuItem {
  label: string;
  /** Ticked: the current choice. */
  checked?: boolean;
  /** Greyed out, with the reason as its tooltip. */
  disabled?: string | boolean;
  run(): void;
}

/** A small menu opened at the pointer over a board: choosing, Escape or a press elsewhere closes it. */
export class PopupMenu {
  private el: HTMLElement | null = null;
  private readonly away = (event: Event): void => {
    if (this.el && !this.el.contains(event.target as Node)) this.close();
  };
  private readonly key = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.el) return;
    event.stopPropagation();
    this.close();
  };

  constructor(private readonly root: HTMLElement) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  show(items: readonly MenuItem[], clientX: number, clientY: number): void {
    this.close();
    const doc = this.root.ownerDocument;
    const menu = doc.createElement('div');
    menu.className = 'tabletop-menu';
    menu.setAttribute('role', 'menu');
    for (const item of items) {
      const entry = doc.createElement('button');
      entry.type = 'button';
      entry.className = 'tabletop-menu__item';
      entry.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (item.checked !== undefined) entry.setAttribute('aria-checked', String(item.checked));
      const tick = doc.createElement('span');
      tick.className = 'tabletop-menu__tick';
      tick.textContent = item.checked ? '✓' : '';
      const text = doc.createElement('span');
      text.textContent = item.label;
      entry.append(tick, text);
      if (item.disabled) {
        entry.disabled = true;
        if (typeof item.disabled === 'string') entry.title = item.disabled;
      }
      entry.addEventListener('click', () => {
        this.close();
        item.run();
      });
      menu.appendChild(entry);
    }
    menu.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.root.appendChild(menu);
    this.el = menu;
    // Beside the pointer, kept inside the board.
    const box = this.root.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(4, Math.min(clientX - box.left, box.width - width - 4));
    const top = Math.max(4, Math.min(clientY - box.top - height, box.height - height - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    doc.addEventListener('pointerdown', this.away, true);
    doc.defaultView?.addEventListener('keydown', this.key, true);
  }

  close(): void {
    if (!this.el) return;
    const doc = this.root.ownerDocument;
    doc.removeEventListener('pointerdown', this.away, true);
    doc.defaultView?.removeEventListener('keydown', this.key, true);
    this.el.remove();
    this.el = null;
  }
}

/** What the strip reports. */
export interface TimelineCallbacks {
  /** A left click on empty time: a shot is wanted at this moment. */
  add(at: number): void;
  /** A shot was dragged and let go at this moment (already held off its neighbours). */
  retime(shotId: string, at: number): void;
  /** A click on a shot without a drag. */
  select(shotId: string): void;
  /** A right click on a shot. */
  shotMenu(shotId: string, clientX: number, clientY: number): void;
  /** A right click between two shots: the id of the second, which holds the transition. */
  gapMenu(shotId: string, clientX: number, clientY: number): void;
}

/** How shots are drawn: the map the cutscene belongs to (others are drawn apart), and a map's name. */
export interface TimelineLook {
  home: string;
  mapName(path: string): string;
}

export class TimelineView {
  readonly el: HTMLElement;
  /** The strip's heading row, for the studio to put its title and buttons in. */
  readonly head: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly track: HTMLElement;
  private cutscene: Cutscene | null = null;
  private pxPerSecond = DEFAULT_PX_PER_SECOND;

  constructor(parent: HTMLElement, private readonly callbacks: TimelineCallbacks) {
    const doc = parent.ownerDocument;
    const make = (className: string, into: HTMLElement): HTMLElement => {
      const element = doc.createElement('div');
      element.className = className;
      into.appendChild(element);
      return element;
    };
    this.el = make('tabletop-timeline', parent);
    this.head = make('tabletop-timeline__head', this.el);
    this.scroll = make('tabletop-timeline__scroll', this.el);
    this.track = make('tabletop-timeline__track', this.scroll);
    // The board under the strip is not pressed, scrolled or zoomed through it.
    for (const type of ['pointerdown', 'dblclick'] as const) this.el.addEventListener(type, (event) => event.stopPropagation());
    this.el.addEventListener('wheel', (event) => {
      event.stopPropagation();
      event.preventDefault();
      this.scroll.scrollLeft += event.deltaX + event.deltaY;
    }, { passive: false });
    this.scroll.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.tabletop-timeline__shot')) return;
      this.callbacks.add(this.momentAt(event.clientX));
    });
    this.scroll.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shots = this.cutscene?.shots ?? [];
      const hit = (event.target as HTMLElement).closest<HTMLElement>('.tabletop-timeline__shot');
      if (hit?.dataset.shotId) {
        this.callbacks.shotMenu(hit.dataset.shotId, event.clientX, event.clientY);
        return;
      }
      const into = gapBefore(shots, this.momentAt(event.clientX));
      if (into >= 0) this.callbacks.gapMenu(shots[into].id, event.clientX, event.clientY);
    });
  }

  get hidden(): boolean {
    return this.el.hidden;
  }

  set hidden(hidden: boolean) {
    this.el.hidden = hidden;
  }

  /** The moment under a pointer. */
  private momentAt(clientX: number): number {
    return timeAt(clientX - this.scroll.getBoundingClientRect().left - TIMELINE_PAD, this.pxPerSecond, this.scroll.scrollLeft);
  }

  private left(ms: number): string {
    return `${TIMELINE_PAD + xAt(ms, this.pxPerSecond)}px`;
  }

  /** Draws the cutscene again. */
  render(c: Cutscene, look: TimelineLook): void {
    this.cutscene = c;
    const doc = this.el.ownerDocument;
    const track = this.track;
    track.replaceChildren();
    const last = c.shots.length > 0 ? c.shots[c.shots.length - 1].at : 0;
    const total = Math.ceil(last / 1000) + TAIL_SECONDS;
    track.style.width = `${TIMELINE_PAD * 2 + total * this.pxPerSecond}px`;
    const add = (className: string, left: string): HTMLElement => {
      const element = doc.createElement('div');
      element.className = className;
      element.style.left = left;
      track.appendChild(element);
      return element;
    };
    for (let second = 0; second <= total; second++) {
      add('tabletop-timeline__tick', this.left(second * 1000)).textContent = `${second}`;
    }
    c.shots.forEach((shot, i) => {
      if (i === 0) return;
      const before = c.shots[i - 1];
      const link = add(`tabletop-timeline__link tabletop-timeline__link--${shot.transition}`, this.left(before.at));
      link.style.width = `${xAt(shot.at, this.pxPerSecond) - xAt(before.at, this.pxPerSecond)}px`;
      link.dataset.transition = shot.transition;
      link.textContent = shot.transition === 'cut' ? 'Cut' : shot.transition === 'move' ? 'Move' : 'Fade';
    });
    c.shots.forEach((shot, i) => {
      const marker = add('tabletop-timeline__shot', this.left(shot.at));
      if (shot.keyframe) marker.classList.add('tabletop-timeline__shot--keyframe');
      if (shot.mapPath !== look.home) marker.classList.add('tabletop-timeline__shot--other');
      marker.dataset.shotId = shot.id;
      marker.dataset.index = String(i);
      marker.title = `Shot ${i + 1}${shot.keyframe ? ' (keyframe)' : ''} at ${seconds(shot.at)}: ${look.mapName(shot.mapPath)}`;
      marker.textContent = String(i + 1);
      marker.addEventListener('pointerdown', (event) => this.press(event, marker, shot.id));
    });
  }

  /** A press on a shot: a drag retimes it, a plain click selects it. */
  private press(event: PointerEvent, marker: HTMLElement, shotId: string): void {
    if (event.button !== 0 || !this.cutscene) return;
    event.stopPropagation();
    const c = this.cutscene;
    const start = c.shots.find((shot) => shot.id === shotId);
    if (!start) return;
    const from = event.clientX;
    let dragging = false;
    let at = start.at;
    try { marker.setPointerCapture(event.pointerId); } catch { /* a pointer that is not active cannot be captured */ }
    const move = (e: PointerEvent): void => {
      if (!dragging && Math.abs(e.clientX - from) < DRAG_PX) return;
      dragging = true;
      marker.classList.add('is-dragging');
      // Held off the neighbours as the edit will hold it.
      const wanted = Math.round(start.at + ((e.clientX - from) / this.pxPerSecond) * 1000);
      at = retime(c, shotId, wanted).shots.find((shot) => shot.id === shotId)?.at ?? start.at;
      marker.style.left = this.left(at);
    };
    const done = (e: PointerEvent): void => {
      marker.removeEventListener('pointermove', move);
      marker.removeEventListener('pointerup', done);
      marker.removeEventListener('pointercancel', done);
      try { marker.releasePointerCapture(e.pointerId); } catch { /* already let go */ }
      marker.classList.remove('is-dragging');
      if (e.type === 'pointercancel') {
        marker.style.left = this.left(start.at);
        return;
      }
      if (dragging) this.callbacks.retime(shotId, at);
      else this.callbacks.select(shotId);
    };
    marker.addEventListener('pointermove', move);
    marker.addEventListener('pointerup', done);
    marker.addEventListener('pointercancel', done);
  }

  dispose(): void {
    this.el.remove();
  }
}
