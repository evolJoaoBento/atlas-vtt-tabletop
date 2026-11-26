/**
 * The Tabletop icon: a chess rook (lucide's chess-rook, redrawn) standing on a map seen in perspective, its front as
 * wide as the icon and its back narrower, the rook in front of the map's back edge with the map's lines stopping one
 * unit clear of it, in lucide's 24-unit grid and 2-unit stroke so it sits with Atlas's toolbar icons. It is the Open in
 * 3D button and the board's tab alike.
 */
const BODY = '<path d="M6.657 12H5.677a1 1 0 0 0-.928.629l-3.2 8A1 1 0 0 0 2.477 22h19.046a1 1 0 0 0 .928-1.371l-3.2-8a1 1 0 0 0-.928-.629h-.98"/>'
  + '<path d="M7.5 2.5V5a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V2.5"/><path d="M7.5 4.5h9"/><path d="M10.5 2.5v2"/><path d="M13.5 2.5v2"/>'
  + '<path d="m10 7-.5 7.5"/><path d="m14 7 .5 7.5"/><path d="M7.5 17v-.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v.5"/><path d="M7.5 17h9"/>';

const STROKE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** The icon as a whole svg, for the Open in 3D button and the board card. */
export const OPEN_3D_SVG = `<svg viewBox="0 0 24 24" ${STROKE}>${BODY}</svg>`;

/** The name it is registered under with Obsidian (tabs, menus), and what that registration draws: 24 units scaled to its 100. */
export const TABLETOP_ICON = 'atlas-tabletop';
export const TABLETOP_ICON_BODY = `<g transform="scale(4.1667)" ${STROKE}>${BODY}</g>`;
