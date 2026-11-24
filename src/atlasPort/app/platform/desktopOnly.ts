// Atlas source: src/app/platform/desktopOnly.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { Platform } from 'obsidian';

/**
 * Whether Atlas runs in the desktop app with its desktop UI: where there are popout windows, a
 * file manager, a system trash and Electron. A desktop Obsidian that emulates mobile is none, so
 * it offers what a tablet offers.
 */
export function isDesktopApp(): boolean {
  return Platform.isDesktopApp && !Platform.isMobile;
}

/**
 * What only the desktop app offers (the player window, anything that needs a second window or
 * the system's own dialogs): `items` there, nothing on mobile. Spread it into a list of commands,
 * menu rows or buttons, so mobile never shows one that fails.
 */
export function desktopOnly<T>(...items: T[]): T[] {
  return isDesktopApp() ? items : [];
}
