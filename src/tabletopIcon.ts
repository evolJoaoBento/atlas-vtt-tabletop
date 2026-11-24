/** The Tabletop icon: a thick board in isometric view with its squares marked. */
const BODY = '<path d="M12 6l10 5-10 5-10-5z"/><path d="M2 11v3l10 5 10-5v-3"/><path d="M7 8.5l10 5"/><path d="M17 8.5l-10 5"/>';

/**
 * The Open in 3D icon: lucide's map-pinned with a chess rook (lucide's chess-rook, drawn to fit) standing where the pin is,
 * in lucide's 24-unit grid and stroke so it sits with Atlas's toolbar icons.
 */
export const OPEN_3D_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712"/>'
  + '<path d="M7 2v2.5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2"/><path d="M7 4h10"/><path d="M10.5 2v2"/><path d="M13.5 2v2"/>'
  + '<path d="m9.5 6.5-.5 5"/><path d="m14.5 6.5.5 5"/><path d="M7 14v-.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v.5"/></svg>';

/** The name it is registered under with Obsidian (tabs, menus), and what that registration draws: 24 units scaled to its 100. */
export const TABLETOP_ICON = 'atlas-tabletop';
export const TABLETOP_ICON_BODY = `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${BODY}</g>`;
