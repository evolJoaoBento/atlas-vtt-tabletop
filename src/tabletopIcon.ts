/** The Tabletop icon: a thick board in isometric view with its squares marked. */
const BODY = '<path d="M12 6l10 5-10 5-10-5z"/><path d="M2 11v3l10 5 10-5v-3"/><path d="M7 8.5l10 5"/><path d="M17 8.5l-10 5"/>';

/** The icon as a standalone SVG, for the buttons Tabletop draws itself. */
export const TABLETOP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BODY}</svg>`;

/** The name it is registered under with Obsidian (tabs, menus), and what that registration draws: 24 units scaled to its 100. */
export const TABLETOP_ICON = 'atlas-tabletop';
export const TABLETOP_ICON_BODY = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BODY}</g>`;
