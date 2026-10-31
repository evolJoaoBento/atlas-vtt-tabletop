/**
 * A token's stat block as Atlas draws it, in the sheet drawer: Atlas's own `atlas-statblock` card, rendered into the
 * drawer where it is (Tabletop shares the GM's window and so Atlas's styles), its dice links handed to the board's dice
 * in place of Atlas's own dice tool. Atlas without the card (no `atlas-statblock` fence) draws none, and the drawer
 * keeps to the text sheet. Idea ported from Atlas VTT Connect (MIT, `statblockCards.ts`), which sends the card to
 * players instead; here nothing is captured or sent.
 *
 * Nothing here imports Obsidian: the host that renders the markdown is given (`atlasCardHost.ts`).
 */
import { advantageSide, type AdvantageSide } from './sheet';

/** What draws Atlas's card for one note. */
export interface CardHost {
  /** The creature's name, for the drawer's title when no text sheet has one. */
  readonly name?: string | undefined;
  /** Renders Atlas's `atlas-statblock` card of the note into `into`. */
  render(into: HTMLElement): Promise<void>;
  dispose(): void;
}

/** Atlas renders with React: the card is done once it stops changing for this long. */
const QUIET_MS = 150;
const TIMEOUT_MS = 4000;

/** Waits until `element` has stopped changing, or the timeout. */
export function settled(element: Element, win: Window = element.ownerDocument.defaultView ?? window): Promise<void> {
  return new Promise((resolve) => {
    let quiet = win.setTimeout(done, QUIET_MS);
    const limit = win.setTimeout(done, TIMEOUT_MS);
    const observer = new (win as Window & typeof globalThis).MutationObserver(() => {
      win.clearTimeout(quiet);
      quiet = win.setTimeout(done, QUIET_MS);
    });
    observer.observe(element, { subtree: true, childList: true, attributes: true, characterData: true });
    function done(): void {
      observer.disconnect();
      win.clearTimeout(quiet);
      win.clearTimeout(limit);
      resolve();
    }
  });
}

/** Draws the card into `into`; false (and `into` left empty) when this Atlas draws none. */
export async function drawCard(host: CardHost, into: HTMLElement, settle: (element: Element) => Promise<void> = settled): Promise<boolean> {
  into.replaceChildren();
  await host.render(into);
  await settle(into);
  if (!into.querySelector('.atlas-statblock')) {
    into.replaceChildren();
    return false;
  }
  // The fence's own edit bar belongs to a note, not to a drawer.
  into.querySelectorAll('.atlas-statblock-fence__bar').forEach((bar) => bar.remove());
  return true;
}

/** What a roll is called: the label it follows, else the trait it is in, else its formula (Connect's `rollLabel`). */
export function rollLabel(link: Element, formula: string): string {
  const labelled = link.closest('.atlas-sb-labelled, .atlas-sb-metric__number');
  const label = labelled?.querySelector('.atlas-sb-label')?.textContent?.trim();
  if (label) return label;
  const trait = link.closest('.atlas-sb-trait');
  const name = trait?.querySelector('[class*="name"], strong, b, em')?.textContent?.trim().replace(/[.:]$/, '');
  return name || formula;
}

/**
 * A dice link of the card rolls with the board's dice, never Atlas's: caught on its way down, before Atlas's own
 * handlers (which hear a click, Enter or Space, and a right-click) can roll with its dice tool as well. A click, Enter
 * or Space rolls; Shift rolls with advantage, Alt with disadvantage. A right-click rolls nothing. Returns how to stop.
 */
export function routeCardRolls(root: HTMLElement, onRoll: (formula: string, label: string, side?: AdvantageSide) => void, accept: (link: HTMLElement) => boolean = () => true): () => void {
  const heard = (event: Event): void => {
    const target = event.target as Element | null;
    const link = typeof target?.closest === 'function' ? target.closest<HTMLElement>('[data-formula]') : null;
    if (!link || !root.contains(link) || !accept(link)) return;
    const key = (event as KeyboardEvent).key;
    const asked = event.type === 'click' || (event.type === 'keydown' && (key === 'Enter' || key === ' '));
    // Whatever Atlas would do with the event, it does not: a key that rolls nothing is left to the page.
    if (event.type === 'keydown' && !asked) return;
    event.preventDefault();
    event.stopPropagation();
    const formula = (link.dataset.formula ?? '').trim();
    if (!asked || !formula) return;
    const modifiers = event as MouseEvent;
    const side = advantageSide(modifiers.shiftKey === true, modifiers.altKey === true);
    onRoll(formula, rollLabel(link, formula), side ?? undefined);
  };
  const types = ['click', 'keydown', 'contextmenu'] as const;
  for (const type of types) root.addEventListener(type, heard, true);
  return () => { for (const type of types) root.removeEventListener(type, heard, true); };
}
