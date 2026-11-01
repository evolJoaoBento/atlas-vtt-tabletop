/**
 * The card a `tabletop` code block shows in a note: the map's name (or the caption), the latest snapshot of its 3D
 * board when there is one, and a button that opens the map in 3D. Plain DOM.
 */
import { setSvg } from './svg';
import { t } from './i18n';
import { TABLETOP_SVG } from './tabletopIcon';

export interface BoardCardOptions {
  title: string;
  /** A URL for the latest snapshot, or null when none was saved. */
  snapshotUrl: string | null;
  open(): void;
}


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
  setSvg(button, TABLETOP_SVG);
  const label = doc.win.createSpan();
  label.textContent = t('open3d');
  button.appendChild(label);
  button.addEventListener('click', () => options.open());
  row.append(title, button);
  card.appendChild(row);
  parent.appendChild(card);
  return card;
}
