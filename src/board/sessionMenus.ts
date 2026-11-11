/**
 * The board's menus for what Connect's session offers on Atlas's own UI, built from what the session hands over
 * (`connectContract.ts`), in Connect's words: a scene tab's "Present to" (the split party). Entries only: `atlasMenu.ts` draws them. Pure.
 */
import type { MenuEntry } from './atlasMenu';
import type { BoardPresentTo } from '../connectContract';

const note = (label: string): MenuEntry => ({ type: 'item', label, disabled: true, onClick: () => undefined });

/** A scene tab's "Present to" submenu: a row per player, ticked where they see it, staying open; then "Everyone back". */
export function presentToEntry(read: () => BoardPresentTo | null, choose: (playerId: string) => void, everyoneBack: () => void): MenuEntry | null {
  const first = read();
  if (!first) return null;
  return {
    type: 'submenu', label: first.heading, icon: 'users',
    children: () => {
      const menu = read();
      if (!menu) return [];
      const rows: MenuEntry[] = menu.rows.length === 0
        ? [note(menu.noPlayers)]
        : menu.rows.map((row): MenuEntry => ({ type: 'item', label: row.label, checked: row.checked, disabled: row.disabled, keepOpen: true, onClick: () => choose(row.playerId) }));
      return [
        ...(menu.capNote ? [note(menu.capNote)] : []),
        ...rows,
        { type: 'separator' },
        { type: 'item', label: menu.everyoneBack.label, disabled: menu.everyoneBack.disabled, onClick: () => everyoneBack() },
      ];
    },
  };
}
