// Atlas source: toolbar/toolbarLayout.ts and toolbar/toolbarCatalog.ts @ 0.12.0 (AGPL-3.0, ported for Tabletop).
// Only the catalog's ids and hide rules are kept (labels and icons live in the parity tables and the board's toolbar).

/** Atlas's toolbar controls in its default order, and whether each can be hidden (the Command palette cannot). */
const TOOLBAR_CONTROLS = [
  { id: 'move', hideable: true }, { id: 'fog', hideable: true }, { id: 'draw', hideable: true }, { id: 'text', hideable: true },
  { id: 'measure', hideable: true }, { id: 'wall', hideable: true }, { id: 'pin', hideable: true }, { id: 'audio', hideable: true },
  { id: 'dice', hideable: true }, { id: 'loot', hideable: true }, { id: 'assets', hideable: true }, { id: 'palette', hideable: false },
] as const;
const UNDO_BAR = { id: 'undo', hideable: true } as const;
export const UNDO_BAR_ID = UNDO_BAR.id;

export type ToolbarControlId = (typeof TOOLBAR_CONTROLS)[number]['id'];
export type ToolbarUnitId = ToolbarControlId | typeof UNDO_BAR_ID;

export const DEFAULT_TOOLBAR_ORDER: readonly ToolbarControlId[] = TOOLBAR_CONTROLS.map((control) => control.id);

const CONTROLS_BY_ID = new Map<string, { id: string; hideable: boolean }>(TOOLBAR_CONTROLS.map((control) => [control.id, control]));
const UNITS_BY_ID = new Map<string, { id: string; hideable: boolean }>([...CONTROLS_BY_ID, [UNDO_BAR_ID, UNDO_BAR]]);

export function isToolbarControlId(id: string): id is ToolbarControlId {
  return CONTROLS_BY_ID.has(id);
}

export function isToolbarUnitId(id: string): id is ToolbarUnitId {
  return UNITS_BY_ID.has(id);
}

export function isHideableToolbarControl(id: string): boolean {
  return UNITS_BY_ID.get(id)?.hideable ?? false;
}

/**
 * What `AtlasSettings.toolbar` holds: only what differs from the default. Ids
 * this version does not know (a newer Atlas on another device) are kept. A
 * hidden undo/redo bar is `UNDO_BAR_ID` in `hidden`; it is never in `order`.
 */
export interface StoredToolbarLayout {
  readonly order?: readonly string[];
  readonly hidden?: readonly string[];
}

/**
 * The layout this version works with: every catalog id once, in order. A
 * hidden control keeps its slot in the order, which is where it returns to.
 * `hidden` also holds `UNDO_BAR_ID` while the undo/redo bar is hidden; that
 * bar has its own place left of the main one, so it has none in the order.
 */
export interface ToolbarLayout {
  readonly order: readonly ToolbarControlId[];
  readonly hidden: ReadonlySet<ToolbarUnitId>;
}

const MAX_STORED_IDS = 64;
const MAX_ID_LENGTH = 64;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Distinct strings of a sane length, at most `MAX_STORED_IDS`; anything that is not an array gives none. */
function readIds(value: unknown, keep: (id: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value as unknown[]) {
    if (ids.size >= MAX_STORED_IDS) break;
    if (typeof entry === 'string' && entry.length >= 1 && entry.length <= MAX_ID_LENGTH && keep(entry)) ids.add(entry);
  }
  return [...ids];
}

/** Reads a stored layout defensively; the Command palette can never be hidden, and the undo/redo bar has no place in the order. */
export function readToolbarLayout(stored: unknown): StoredToolbarLayout {
  if (!isRecord(stored)) return {};
  const order = readIds(stored.order, (id) => id !== UNDO_BAR_ID);
  const hidden = readIds(stored.hidden, (id) => !isToolbarUnitId(id) || isHideableToolbarControl(id));
  return { ...(order.length > 0 && { order }), ...(hidden.length > 0 && { hidden }) };
}

/**
 * The order of `defaultIds` with the user's order applied: their order first,
 * then every control they have not placed (a later version's, say) after the
 * control that precedes it by default. An empty user order is the default.
 */
export function orderedToolbarIds(defaultIds: readonly string[], custom: readonly string[]): string[] {
  const known = new Set(defaultIds);
  const order = [...new Set(custom.filter((id) => known.has(id)))];
  defaultIds.forEach((id, index) => {
    if (order.includes(id)) return;
    const before = defaultIds.slice(0, index).reverse().find((previous) => order.includes(previous));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id);
  });
  return order;
}

export function resolveToolbarLayout(stored: StoredToolbarLayout): ToolbarLayout {
  const order = orderedToolbarIds(DEFAULT_TOOLBAR_ORDER, stored.order ?? []).filter(isToolbarControlId);
  const hidden = new Set((stored.hidden ?? []).filter(isToolbarUnitId).filter(isHideableToolbarControl));
  return { order, hidden };
}
