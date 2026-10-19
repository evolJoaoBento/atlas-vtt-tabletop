/**
 * Tabletop's rows in Atlas's own right-click menu of a token (the Radix menu, `.atlas-ctx-menu`): "Place mini…", and
 * "Remove mini" when the token has one. Atlas draws that menu with React when the right button is released, so the
 * token under the pointer is noted when the button goes down and the rows are added when the menu appears. They use
 * Atlas's `atlas-ctx-item` markup with a class of Tabletop's own, so other extensions' rows (Connect's) are left alone.
 */
import { setIcon } from 'obsidian';
import { tokenAt, type AtlasView } from './atlas';

const MENU = '.atlas-ctx-menu';
const ROW_CLASS = 'atlas-tabletop-ctx-item';
const WAIT_MS = 1500;

export interface TokenMenuEntry {
  label: string;
  icon: string;
  onClick(): void;
}

/** Starts watching `view` for right presses on tokens; `entries` says what to add for one. Returns what stops it. */
export function watchTokenMenu(view: AtlasView, entries: (tokenId: string) => TokenMenuEntry[]): () => void {
  const root = view.containerEl;
  const doc = root?.ownerDocument;
  const win = doc?.defaultView;
  if (!root || !doc || !win) return () => undefined;
  let waiting: MutationObserver | null = null;
  let timer: number | null = null;
  const stopWaiting = (): void => {
    waiting?.disconnect();
    waiting = null;
    if (timer !== null) win.clearTimeout(timer);
    timer = null;
  };

  const press = (event: PointerEvent): void => {
    stopWaiting();
    if (event.button !== 2) return;
    const tokenId = tokenAt(view, event.clientX, event.clientY);
    if (!tokenId) return;
    const attach = (): boolean => {
      const menu = doc.querySelector<HTMLElement>(MENU);
      if (!menu) return false;
      if (!menu.querySelector(`.${ROW_CLASS}`)) addTo(menu, entries(tokenId));
      return true;
    };
    if (attach()) return;
    waiting = new win.MutationObserver(() => {
      if (attach()) stopWaiting();
    });
    waiting.observe(doc.body, { childList: true, subtree: true });
    timer = win.setTimeout(stopWaiting, WAIT_MS);
  };
  root.addEventListener('pointerdown', press, true);
  return () => {
    stopWaiting();
    root.removeEventListener('pointerdown', press, true);
  };
}

function addTo(menu: HTMLElement, entries: TokenMenuEntry[]): void {
  if (entries.length === 0) return;
  const doc = menu.ownerDocument;
  const holder = doc.createElement('div');
  holder.className = 'atlas-tabletop-ctx';
  const close = (): void => {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  };
  for (const entry of entries) {
    const row = doc.createElement('div');
    row.className = `atlas-ctx-item ${ROW_CLASS}`;
    row.setAttribute('role', 'menuitem');
    row.tabIndex = -1;
    const lead = doc.createElement('span');
    lead.className = 'atlas-ctx-item__leading';
    const icon = doc.createElement('span');
    icon.className = 'atlas-ctx-icon';
    setIcon(icon, entry.icon);
    const label = doc.createElement('span');
    label.className = 'atlas-ctx-item__label';
    label.textContent = entry.label;
    lead.append(icon, label);
    row.appendChild(lead);
    row.addEventListener('click', (event) => {
      event.stopPropagation();
      close();
      try {
        entry.onClick();
      } catch (error) {
        console.error(`[Tabletop] Menu item ${entry.label} failed:`, error);
      }
    });
    holder.appendChild(row);
  }
  // Before the menu's last entry (Delete), so the destructive one stays at the end.
  menu.insertBefore(holder, menu.lastElementChild);
  // React may draw the menu anew: the rows go back in, only when they were taken out (no tug of war with others).
  const win = doc.defaultView;
  if (!win) return;
  const again = new win.MutationObserver(() => {
    if (!menu.isConnected) {
      again.disconnect();
      return;
    }
    if (!holder.isConnected) menu.insertBefore(holder, menu.lastElementChild);
  });
  again.observe(menu, { childList: true });
}
