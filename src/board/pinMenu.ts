/**
 * A pin's right-click menu on the GM's board, as Atlas's pin menu has it: "Readable by players", ticked when the GM
 * lets players open the pin's note online (Atlas's `readable` flag, which Connect reads to send a pin to players). Atlas
 * offers it only for a pin that links a note: not a map or a scene, nor an encounter. Pure.
 */
import type { MenuEntry } from './atlasMenu';
import type { BoardPin } from './mapModel';

/** Atlas's encounters (`atlas-vtt/collections/<collection>/encounters/…`), which a pin rolls rather than opens. */
const ENCOUNTER = /^atlas-vtt\/collections\/[^/#]+\/encounters(?:\/[^#]*)?$/;

/** Whether players could read the pin's note: it links one (with or without a heading), not a map nor an encounter. */
export function canBeReadable(notePath: string | null): boolean {
  if (!notePath) return false;
  const hash = notePath.indexOf('#');
  const link = (hash < 0 ? notePath : notePath.slice(0, hash)).trim();
  if (link === '' || link.toLowerCase().endsWith('.atlasmap')) return false;
  return !(ENCOUNTER.test(link) && !link.toLowerCase().endsWith('.json'));
}

/** The pin's menu: "Readable by players" where Atlas offers it; nothing else (Atlas's own pin menu has the rest). */
export function pinMenuEntries(pin: BoardPin, setReadable: (readable: boolean) => void): MenuEntry[] {
  if (!canBeReadable(pin.notePath)) return [];
  const readable = pin.readable === true;
  return [{ type: 'item', label: 'Readable by players', checked: readable, onClick: () => setReadable(!readable) }];
}
