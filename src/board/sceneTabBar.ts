/**
 * Atlas's scene tabs over the GM's board, drawn as Atlas draws them (`SceneTabBar.tsx`, its markup and class names, so
 * Atlas's own styles dress them): one tab per open scene of the Atlas view holding the board's map, the active one
 * marked, an eye that presents a scene to players (lit on the presented one), a cross that closes it, and a plus that
 * opens another. The board's host does what each asks of Atlas.
 */
import { setSvg } from '../svg';


export interface SceneTabEntry {
  id: string;
  name: string;
  filePath: string;
  active: boolean;
  presented: boolean;
  /** Loaded in Atlas (drawn lighter while asleep), and changed since saved. */
  loaded: boolean;
  dirty: boolean;
}

export interface SceneTabBarHost {
  /** The Atlas view's scene tabs; none hides the bar. */
  tabs(): SceneTabEntry[];
  switchTab(id: string): void;
  presentTab(id: string): void;
  /** Without them, no cross or plus (an Atlas that offers no way to). */
  closeTab?(id: string): void;
  addTab?(): void;
}

/** Lucide's icons, at Atlas's sizes. */
const icon = (size: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const EYE = icon(12, '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>');
const CROSS = icon(12, '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>');
const PLUS = icon(14, '<path d="M5 12h14"/><path d="M12 5v14"/>');

export class SceneTabBar {
  /** Atlas's scope (its style variables), and its top row, as in Atlas's map view. */
  private readonly scope: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly strip: HTMLElement;
  private key = '';

  constructor(container: HTMLElement, private readonly host: SceneTabBarHost) {
    const doc = container.ownerDocument;
    this.scope = doc.createElement('div');
    this.scope.className = 'atlas-vtt-plugin atlas-tabletop-scene-tabs';
    const row = doc.createElement('div');
    row.className = 'atlas-top-bar-row';
    this.bar = doc.createElement('div');
    this.bar.className = 'atlas-scene-tab-bar';
    this.strip = doc.createElement('div');
    this.strip.className = 'atlas-scene-tab-bar__strip';
    this.strip.setAttribute('role', 'tablist');
    this.strip.setAttribute('aria-label', 'Open maps');
    this.bar.appendChild(this.strip);
    if (host.addTab) {
      const add = doc.createElement('button');
      add.type = 'button';
      add.className = 'atlas-scene-tab atlas-scene-tab-bar__button atlas-scene-tab-bar__add';
      add.setAttribute('aria-label', 'Open a scene');
      add.title = 'Open a scene';
      setSvg(add, PLUS);
      add.addEventListener('click', () => host.addTab?.());
      this.bar.appendChild(add);
    }
    row.appendChild(this.bar);
    this.scope.appendChild(row);
    container.appendChild(this.scope);
    // A wheel over the strip scrolls it sideways, as Atlas's does.
    this.strip.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      this.strip.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
  }

  /** Draws the tabs as the host has them now; the same tabs again are left as they are. */
  refresh(): void {
    const tabs = this.host.tabs();
    const key = JSON.stringify(tabs);
    if (key === this.key) return;
    this.key = key;
    this.scope.hidden = tabs.length === 0;
    const doc = this.strip.ownerDocument;
    this.strip.replaceChildren(...tabs.map((tab) => {
      const element = doc.createElement('div');
      element.setAttribute('role', 'tab');
      element.setAttribute('aria-selected', String(tab.active));
      element.tabIndex = 0;
      element.className = `atlas-scene-tab ${tab.active ? 'atlas-scene-tab--active' : tab.loaded ? 'atlas-scene-tab--loaded' : 'atlas-scene-tab--sleeping'}`;
      element.addEventListener('click', () => this.host.switchTab(tab.id));
      element.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        this.host.switchTab(tab.id);
      });
      // Show and close sit at opposite ends, so one is never clicked for the other.
      element.appendChild(this.action(EYE, tab.presented ? `${tab.name} is shown to players` : `Show ${tab.name} to players`, tab.presented, () => this.host.presentTab(tab.id)));
      const name = doc.createElement('span');
      name.className = 'atlas-scene-tab__name';
      name.textContent = tab.name;
      name.title = tab.filePath;
      element.appendChild(name);
      if (tab.dirty) {
        const dirty = doc.createElement('span');
        dirty.className = 'atlas-scene-tab__dirty';
        element.appendChild(dirty);
      }
      if (this.host.closeTab) {
        element.appendChild(this.action(CROSS, `Close ${tab.name}`, undefined, () => this.host.closeTab?.(tab.id)));
        element.addEventListener('mousedown', (event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          this.host.closeTab?.(tab.id);
        });
      }
      return element;
    }));
    this.strip.querySelector('.atlas-scene-tab--active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  dispose(): void {
    this.scope.remove();
  }

  /** An icon button inside a tab, which keeps its events from switching to the tab. */
  private action(svg: string, label: string, active: boolean | undefined, run: () => void): HTMLButtonElement {
    const button = this.strip.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = `atlas-scene-tab__action${active ? ' atlas-scene-tab__action--active' : ''}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (active !== undefined) button.setAttribute('aria-pressed', String(active));
    setSvg(button, svg);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      run();
    });
    button.addEventListener('mousedown', (event) => event.stopPropagation());
    button.addEventListener('keydown', (event) => event.stopPropagation());
    return button;
  }
}
