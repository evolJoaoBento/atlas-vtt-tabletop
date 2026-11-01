/**
 * The height ruler of a stack of scenes, down the right of the board, as TaleSpire's height control: a vertical rail from
 * the lowest scene to the highest (the top of the rail is the highest layer), a dash on it every few squares of height
 * (the Layer ruler step, two by default), and a marker on each scene at its elevation, the shown one a lit diamond.
 * Click a marker, or anywhere on the rail (or drag along it), to show the nearest scene.
 */

export interface RulerItem {
  path: string;
  name: string;
  /** Grid squares above the base scene. */
  elevation: number;
  active: boolean;
}

export const DEFAULT_LAYER_TICK = 2;
export const MIN_LAYER_TICK = 0.5;
export const MAX_LAYER_TICK = 10;

/** A stored ruler step, kept within what the setting offers. */
export function readLayerTick(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_LAYER_TICK, Math.max(MIN_LAYER_TICK, Math.round(value * 2) / 2)) : DEFAULT_LAYER_TICK;
}

export interface RulerLayout {
  /** The rail's two ends, in grid squares: the lowest scene and the highest. */
  min: number;
  max: number;
  /** Where each marker stands, as a share of the rail from its bottom (0) to its top (1), in the items' order. */
  at: number[];
  /** The dashes: their heights in squares, and their share of the rail. */
  ticks: Array<{ height: number; at: number }>;
}

/** The most dashes drawn: a step too fine for a tall stack is widened until they fit. */
const MAX_TICKS = 60;

export function rulerLayout(items: ReadonlyArray<Pick<RulerItem, 'elevation'>>, tick: number): RulerLayout {
  const heights = items.map((item) => item.elevation);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const span = max - min || 1;
  let step = readLayerTick(tick);
  while (span / step > MAX_TICKS) step *= 2;
  const ticks: RulerLayout['ticks'] = [];
  for (let height = Math.ceil(min / step) * step; height <= max + 1e-9; height += step) ticks.push({ height: Math.round(height * 100) / 100, at: (height - min) / span });
  return { min, max, at: heights.map((height) => (height - min) / span), ticks };
}

/** Spreads markers up the rail so that no two stand closer than `gap` pixels: `at` are shares of a rail `track` pixels tall. */
export function spreadMarkers(at: readonly number[], track: number, gap: number): number[] {
  const order = at.map((share, index) => ({ share, index })).sort((a, b) => a.share - b.share);
  const px: number[] = new Array<number>(at.length).fill(0);
  let last = -Infinity;
  for (const { share, index } of order) {
    last = Math.max(share * track, last + gap);
    px[index] = last;
  }
  // Pushed past the top, they slide back down together.
  const over = Math.max(0, last - track);
  return px.map((value) => Math.max(0, value - over));
}

export class LayerRuler {
  private readonly element: HTMLElement;
  private items: readonly RulerItem[] = [];
  private tick = DEFAULT_LAYER_TICK;

  constructor(container: HTMLElement, private readonly pick: (path: string) => void, private readonly menu?: (path: string, event: MouseEvent) => void) {
    const doc = container.ownerDocument;
    this.element = doc.win.createDiv();
    this.element.className = 'atlas-tabletop-layers';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Layers');
    this.element.setAttribute('aria-orientation', 'vertical');
    this.element.hidden = true;
    container.appendChild(this.element);
  }

  /** Draws the ruler for the stack's scenes (two or more) with a dash every `tick` squares; fewer hide it. */
  show(items: readonly RulerItem[] | null, tick: number): void {
    this.items = items ?? [];
    this.tick = tick;
    this.draw();
  }

  /** The ruler again with another step between its dashes. */
  setTick(tick: number): void {
    if (tick === this.tick) return;
    this.tick = tick;
    this.draw();
  }

  /** The scene whose pill is under a point of the screen, other than the one being played; null for none. A token dropped there goes to that scene. */
  pathAt(clientX: number, clientY: number): string | null {
    if (this.element.hidden) return null;
    const hit = this.element.ownerDocument.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('.atlas-tabletop-layers__item');
    const path = hit?.dataset.path ?? null;
    return path !== null && this.items.some((item) => item.path === path && !item.active) ? path : null;
  }

  /** Lights the pill a token is being carried over (null: none). */
  dropTarget(path: string | null): void {
    for (const button of this.element.querySelectorAll<HTMLElement>('.atlas-tabletop-layers__item')) button.classList.toggle('is-drop-target', path !== null && button.dataset.path === path);
  }

  dispose(): void {
    this.element.remove();
  }

  private draw(): void {
    const { items, element } = this;
    if (items.length < 2) {
      element.hidden = true;
      return;
    }
    const doc = element.ownerDocument;
    element.hidden = false;
    element.replaceChildren();
    const layout = rulerLayout(items, this.tick);
    const track = Math.max(150, Math.min(420, items.length * 56));
    const positions = spreadMarkers(layout.at, track, 30);
    const rail = doc.win.createDiv();
    rail.className = 'atlas-tabletop-layers__track';
    rail.style.height = `${track}px`;
    const line = doc.win.createDiv();
    line.className = 'atlas-tabletop-layers__rail';
    rail.appendChild(line);
    for (const tick of layout.ticks) {
      const dash = doc.win.createDiv();
      dash.className = 'atlas-tabletop-layers__tick';
      dash.style.bottom = `${tick.at * track}px`;
      dash.title = `${tick.height}`;
      rail.appendChild(dash);
    }
    items.forEach((item, index) => {
      const button = doc.win.createEl('button');
      button.type = 'button';
      button.className = `atlas-tabletop-layers__item${item.active ? ' is-active' : ''}`;
      button.setAttribute('aria-pressed', String(item.active));
      button.dataset.path = item.path;
      button.style.bottom = `${positions[index]}px`;
      button.title = `${item.name} (${item.elevation > 0 ? '+' : ''}${item.elevation})`;
      const label = doc.win.createSpan();
      label.className = 'atlas-tabletop-layers__label';
      const height = doc.win.createSpan();
      height.className = 'atlas-tabletop-layers__height';
      height.textContent = item.elevation > 0 ? `+${item.elevation}` : String(item.elevation);
      const name = doc.win.createSpan();
      name.className = 'atlas-tabletop-layers__name';
      name.textContent = item.name;
      label.append(height, name);
      const marker = doc.win.createSpan();
      marker.className = 'atlas-tabletop-layers__marker';
      button.append(label, marker);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!item.active) this.pick(item.path);
      });
      // Right click: the scene's own menu (adjust its position).
      button.addEventListener('contextmenu', (event) => {
        if (!this.menu) return;
        event.preventDefault();
        event.stopPropagation();
        this.menu(item.path, event);
      });
      rail.appendChild(button);
    });
    // Anywhere on the rail picks the nearest scene; a drag along it picks where it is let go.
    const nearest = (clientY: number): RulerItem | null => {
      const box = rail.getBoundingClientRect();
      const fromBottom = box.bottom - clientY;
      let found: RulerItem | null = null;
      let closest = Infinity;
      items.forEach((item, index) => {
        const distance = Math.abs(positions[index]! - fromBottom);
        if (distance < closest) {
          closest = distance;
          found = item;
        }
      });
      return found;
    };
    let dragging = false;
    rail.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      dragging = true;
      rail.setPointerCapture?.(event.pointerId);
    });
    rail.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = false;
      const found = nearest(event.clientY);
      if (found && !found.active) this.pick(found.path);
    });
    element.appendChild(rail);
  }
}
