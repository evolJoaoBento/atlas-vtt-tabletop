// What the board adds to Atlas's shortcut help (the copy of keyboard/HotkeyHelp.tsx takes it through a patch in
// scripts/atlasPortList.mjs): which of Atlas's shortcuts to list, with the key the board takes, and its own keys.
import type { ReactNode } from 'react';

export interface BoardHotkeyHelp {
  /** Whether Atlas's shortcut `id` does something on the board (the rest are left out of the list). */
  shows(id: string): boolean;
  /** The binding the board takes for Atlas's `key` (a camera letter gets Shift). */
  binding(id: string, key: string): string;
  /** The board's own keys, as sections of the list, before Atlas's general navigation keys. */
  sections?: ReactNode;
}
