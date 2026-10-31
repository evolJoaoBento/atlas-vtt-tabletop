/**
 * An "Open in 3D" button in a stock Atlas map view's own toolbar, at the start of its end slot (`.atlas-toolbar-end`,
 * where Connect's group goes too), made with the markup of Atlas's tool button so its styling and spacing apply. Atlas
 * draws its toolbar with React and takes anything added to it away when it draws the slot anew, so each view is watched
 * and the button goes back in; a view whose toolbar is not there yet is looked at again shortly.
 */
import type { App, ItemView } from 'obsidian';
import { setSvg } from './svg';
import { t } from './i18n';
import { mapViews, type AtlasView } from './atlas';

const END = '.atlas-main-toolbar > .atlas-toolbar-end';
const ITEM = 'atlas-tabletop-open3d';
const POLL_MS = 1500;

/** Lucide's `cuboid` icon (ISC). */
const CUBOID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.12 6.4-6.05-4.06a2 2 0 0 0-2.17-.05L2.95 8.41a2 2 0 0 0-.95 1.7v5.82a2 2 0 0 0 .88 1.66l6.05 4.07a2 2 0 0 0 2.17.05l9.95-6.12a2 2 0 0 0 .95-1.7V8.06a2 2 0 0 0-.88-1.66Z"/><path d="M10 22v-8L2.25 9.15"/><path d="m10 14 11.77-6.87"/></svg>';

interface Watched {
  view: AtlasView;
  root: HTMLElement;
  item: HTMLElement | null;
  observer: MutationObserver;
  poll: number;
}

export class AtlasOpenButton {
  private readonly watched = new Map<string, Watched>();

  constructor(private readonly app: App, private readonly open: (mapPath: string) => void) {}

  /** Brings the buttons in line with the map views open now: adds to new ones, lets go of views that closed. */
  sync(): void {
    const views = mapViews(this.app);
    for (const [id, entry] of [...this.watched]) {
      if (!views.some((view) => view.viewId === id) || !entry.root.isConnected) this.release(id, entry);
    }
    for (const view of views) {
      const root = (view as unknown as Partial<ItemView>).containerEl;
      if (!root?.isConnected) continue;
      let entry = this.watched.get(view.viewId);
      if (!entry || entry.root !== root) {
        if (entry) this.release(view.viewId, entry);
        entry = this.watch(view, root);
        this.watched.set(view.viewId, entry);
      }
      entry.view = view;
      this.ensure(entry);
    }
  }

  stop(): void {
    for (const [id, entry] of [...this.watched]) this.release(id, entry);
  }

  private watch(view: AtlasView, root: HTMLElement): Watched {
    const win = root.ownerDocument.defaultView ?? window;
    let queued = false;
    const again = (): void => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        const entry = this.watched.get(view.viewId);
        // Only when the button is gone: watching our own changes would never settle.
        if (entry && !entry.item?.isConnected && root.isConnected) this.ensure(entry);
      });
    };
    const observer = new win.MutationObserver(again);
    observer.observe(root, { childList: true, subtree: true });
    const poll = win.setInterval(again, POLL_MS);
    return { view, root, item: null, observer, poll };
  }

  private release(id: string, entry: Watched): void {
    entry.observer.disconnect();
    (entry.root.ownerDocument.defaultView ?? window).clearInterval(entry.poll);
    entry.item?.remove();
    this.watched.delete(id);
  }

  /** Puts the button in the view's toolbar when it is not there, and keeps it dimmed while no map is open in the view. */
  private ensure(entry: Watched): void {
    const end = entry.root.querySelector<HTMLElement>(END);
    if (!end) return;
    if (!entry.item?.isConnected) {
      entry.item = this.make(entry, end.ownerDocument);
      end.insertBefore(entry.item, end.firstChild);
      end.setCssProps({ gap: '8px' });
    }
    const button = entry.item.querySelector('button')!;
    button.disabled = this.mapOf(entry.view) === null;
  }

  private mapOf(view: AtlasView): string | null {
    const state = view.atlasStore.getState();
    return state.mapPath && state.mapLoaded !== false ? state.mapPath : null;
  }

  private make(entry: Watched, doc: Document): HTMLElement {
    const made = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] => {
      const element = doc.win.createEl(tag);
      element.className = className;
      return element;
    };
    // The markup of Atlas's own tool button, so its CSS and spacing apply.
    const item = made('div', `atlas-toolbar-item ${ITEM}`);
    const content = made('div', 'atlas-toolbar-item__content');
    const tool = made('div', 'atlas-tool-button');
    const holder = made('span', '');
    const button = made('button', 'btn btn--toolbar btn--icon');
    button.type = 'button';
    setSvg(button, CUBOID_SVG);
    button.setAttribute('aria-label', t('open3d'));
    button.title = t('open3d');
    button.addEventListener('click', () => {
      const path = this.mapOf(entry.view);
      if (path) this.open(path);
    });
    holder.appendChild(button);
    tool.appendChild(holder);
    content.appendChild(tool);
    item.appendChild(content);
    return item;
  }
}
