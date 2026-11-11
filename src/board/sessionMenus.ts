/**
 * The board's menus for what Connect's session offers on Atlas's own UI, built from what the session hands over
 * (`connectContract.ts`), in Connect's words: a scene tab's "Present to" (the split party) and a token's "Players see"
 * (what players see of each resource). Entries only: `atlasMenu.ts` draws them. Pure.
 */
import type { MenuEntry } from './atlasMenu';
import type { BoardPresentTo, BoardResourceShows } from '../connectContract';

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

/**
 * A token's "Players see" submenu: a submenu per resource, each column's choices under its heading (this token, every
 * token of its kind), the one in force ticked; choosing one keeps the menu open.
 */
export function playersSeeEntry(read: () => BoardResourceShows | null, set: (choiceId: string, value: string) => void): MenuEntry | null {
  const first = read();
  if (!first || first.rows.length === 0) return null;
  return {
    type: 'submenu', label: first.title, icon: 'eye',
    children: () => (read()?.rows ?? []).map((row, index): MenuEntry => ({
      type: 'submenu', label: row.label, icon: 'heart',
      children: () => {
        const shows = read();
        const now = shows?.rows[index];
        if (!shows || !now) return [];
        return now.choices.flatMap((choice, column): MenuEntry[] => [
          ...(column > 0 ? [{ type: 'separator' } as const] : []),
          ...(shows.columns.length > 1 ? [note(shows.columns[column] ?? '')] : []),
          ...choice.options.map((option): MenuEntry => ({
            type: 'item', label: option.label, checked: option.value === choice.value, keepOpen: true,
            onClick: () => { if (option.value !== choice.value) set(choice.id, option.value); },
          })),
        ]);
      },
    })),
  };
}
