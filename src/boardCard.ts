/**
 * The card a `tabletop` code block shows in a note: the map's name (or the caption), the latest snapshot of its 3D
 * board when there is one, and a button that opens the map in 3D. Plain DOM.
 */
import { setSvg } from './svg';
import { t } from './i18n';

export interface BoardCardOptions {
  title: string;
  /** A URL for the latest snapshot, or null when none was saved. */
  snapshotUrl: string | null;
  open(): void;
}

/** Lucide's `cuboid` icon (ISC). */
const CUBOID_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.12 6.4-6.05-4.06a2 2 0 0 0-2.17-.05L2.95 8.41a2 2 0 0 0-.95 1.7v5.82a2 2 0 0 0 .88 1.66l6.05 4.07a2 2 0 0 0 2.17.05l9.95-6.12a2 2 0 0 0 .95-1.7V8.06a2 2 0 0 0-.88-1.66Z"/><path d="M10 22v-8L2.25 9.15"/><path d="m10 14 11.77-6.87"/></svg>';

export function renderBoardCard(parent: HTMLElement, options: BoardCardOptions): HTMLElement {
  const doc = parent.ownerDocument;
  const card = doc.win.createDiv();
  card.className = 'atlas-tabletop-board-card';
  if (options.snapshotUrl) {
    const picture = doc.win.createEl('img');
    picture.className = 'atlas-tabletop-board-card__snapshot';
    picture.src = options.snapshotUrl;
    picture.alt = `Snapshot of ${options.title}`;
    picture.draggable = false;
    card.appendChild(picture);
  }
  const row = doc.win.createDiv();
  row.className = 'atlas-tabletop-board-card__row';
  const title = doc.win.createSpan();
  title.className = 'atlas-tabletop-board-card__title';
  title.textContent = options.title;
  const button = doc.win.createEl('button');
  button.type = 'button';
  button.className = 'atlas-tabletop-board-card__open';
  setSvg(button, CUBOID_SVG);
  const label = doc.win.createSpan();
  label.textContent = t('open3d');
  button.appendChild(label);
  button.addEventListener('click', () => options.open());
  row.append(title, button);
  card.appendChild(row);
  parent.appendChild(card);
  return card;
}
