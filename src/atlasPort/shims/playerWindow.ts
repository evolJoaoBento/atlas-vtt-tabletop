// Stand-in for Atlas's services/PlayerLootDisplay.ts @ 0.15.0 (AGPL-3.0) in the copies: Atlas shows loot in its own player
// window, which the board cannot reach. Nothing is shown from the board; "Show to players" says so.
import { Notice } from 'obsidian';

type Listener = (shown: ReadonlySet<string>) => void;

const NOTHING: ReadonlySet<string> = new Set();

const display = {
  shownIds: (): ReadonlySet<string> => NOTHING,
  subscribe: (_listener: Listener): (() => void) => () => {},
  toggle: (_draw: unknown): void => { new Notice("Tabletop: show loot to players from Atlas's random tables (its player window)."); },
};

export const PlayerLootDisplay = { get: () => display };
