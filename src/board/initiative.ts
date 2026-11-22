/**
 * Atlas's initiative tracker (0.8.0) as the 3D board runs it: the tracker's state as the map file keeps it, the
 * collection's initiative rules, the sides of a fight by sides, the edit popup's fields, the modifier a combatant adds
 * to its roll, and every change the tracker makes (Atlas's `initiativeSlice`, `turns.ts`), each returning the state
 * after it. The token writer sends a change to Atlas's store when Atlas holds the map, else applies it here to the
 * file. Pure, so it is tested without Obsidian.
 *
 * Atlas 0.9 runs fights Tabletop's file path does not (by cards, by named or rolled sides) and keeps more on each
 * combatant (a delayed turn, a tie-break, a dealt card). Its rules are kept whole, so Atlas gets them as stored when it
 * starts a fight; its fight state is kept as written, the fields a change makes stale are cleared, and a fight only
 * Atlas can run is refused in the file (`fileCannotRun`).
 */
import { listedBySides as atlasListedBySides, sideOf as atlasSideOf } from '../../packages/atlas-shared/src/index';
import { inSideOrder } from '../atlasPort/app/gameSystems/initiativeSideRules';

export type InitiativeSide = 'players' | 'opponents';
/** Atlas 0.9 adds fights by cards. */
export type InitiativeMode = 'turn-order' | 'sides' | 'cards';
/** A side: one of the two built-in ones, or one the collection named (Atlas 0.9). */
export type SideId = string;

/** A statblock field that gives an initiative modifier; `abilityScore` reads it as a score (DEX 16 gives +3). */
export interface ModifierSource {
  field: string;
  abilityScore?: true;
}

export interface InitiativeRules {
  mode: InitiativeMode;
  /** Turn order: the dice each combatant rolls (`1d20`). */
  roll: string;
  /** Sides: the side that acts first in every round. */
  firstSide: InitiativeSide;
  modifier?: ModifierSource;
  modifierFallback?: ModifierSource;
  /** Atlas 0.9's sides in the order they act, named ones among them; unset, `firstSide` then the other. */
  sides?: Array<{ id: SideId; name?: string }>;
  /** Atlas 0.9: the dice each side rolls every round for the order. */
  sideRoll?: string;
  /** Anything else Atlas stores (a deck of cards…), kept to hand back to Atlas as it is. */
  [field: string]: unknown;
}

/** A combatant, as Atlas keeps it; fields Tabletop does not know are kept as they are. */
export interface InitiativeEntry {
  id: string;
  /** Absent on an Atlas 0.18 party member (`partyMemberId`) and on an "Add enemy" entry. */
  tokenId?: string | undefined;
  name: string;
  initiative: number;
  initiativeModifier: number;
  modifierByHand?: true | undefined;
  imagePath: string;
  statblockPath?: string | undefined;
  isActive: boolean;
  isNPC: boolean;
  order: number;
  sitsOut?: boolean;
  /** A combatant that held its turn back (Atlas 0.9's delay). */
  delayed?: boolean;
  [field: string]: unknown;
}

export interface InitiativeState {
  entries: InitiativeEntry[];
  currentIndex: number;
  round: number;
  isActive: boolean;
  config: { autoSort: boolean; [field: string]: unknown };
  /** A fight by sides: the side whose turn it is (a named one in Atlas 0.9), and Atlas 0.9's order and rolls. */
  sides?: { first: InitiativeSide; active: SideId; order?: Array<{ id: SideId; name?: string }>; roll?: string; [field: string]: unknown };
  [field: string]: unknown;
}

/** A change the tracker makes; `roll` carries each combatant's statblock modifier, read beforehand. */
export type InitiativeAction =
  | { type: 'roll'; entryId?: string; roll: string; statblockModifiers: Record<string, number> }
  /** `defeated`: the entry ids whose combatant is defeated; turns pass them by (Atlas 0.9). */
  | { type: 'next'; defeated?: readonly string[] }
  | { type: 'previous'; defeated?: readonly string[] }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'front'; id: string }
  | { type: 'back'; id: string }
  | { type: 'start'; rules: InitiativeRules; defeated?: readonly string[] }
  | { type: 'end' }
  | { type: 'sitsOut'; id: string; sitsOut: boolean }
  | { type: 'reset' }
  /** Atlas 0.18's "Reset initiative": ends the fight and empties every number, keeping everyone. Atlas only. */
  | { type: 'resetNumbers' }
  | { type: 'edit'; id: string; changes: Partial<Pick<InitiativeEntry, 'initiative' | 'initiativeModifier' | 'modifierByHand'>> }
  | { type: 'remove'; id: string; defeated?: readonly string[] };

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isSide = (value: unknown): value is InitiativeSide => value === 'players' || value === 'opponents';

// ── The rules ───────────────────────────────────────────────────────────────

/** A collection without a game system: a d20 each, highest first. */
export const DEFAULT_INITIATIVE_RULES: Readonly<InitiativeRules> = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };

/** The initiative rules of Atlas's built-in game systems, which a collection set from one follows until edited. */
const PRESET_RULES: Record<string, InitiativeRules> = {
  'builtin:cairn': { mode: 'sides', roll: '1d20', firstSide: 'players' },
  'builtin:cyberpunkred': { mode: 'turn-order', roll: '1d10', firstSide: 'players' },
  'builtin:dnd5e': {
    mode: 'turn-order', roll: '1d20', firstSide: 'players',
    modifier: { field: 'initiative' }, modifierFallback: { field: 'stats.1', abilityScore: true },
  },
  'builtin:pathfinder2e': { mode: 'turn-order', roll: '1d20', firstSide: 'players', modifier: { field: 'initiative' } },
  // Atlas 0.9: B/X group initiative, each side rolling 1d6 every round.
  'builtin:ose': { mode: 'sides', roll: '1d20', firstSide: 'players', sideRoll: '1d6' },
};

const DICE_GROUP = /^([1-9]\d?)?d([2-9]|[1-9]\d{1,2})$/i;

/** Count and sides of one dice group such as `2d6`; null when it is none. */
export function parseDiceGroup(roll: string): { count: number; sides: number } | null {
  const match = DICE_GROUP.exec(roll.trim());
  return match ? { count: Number(match[1] ?? '1'), sides: Number(match[2]) } : null;
}

function parseSource(raw: unknown): ModifierSource | undefined {
  if (!isObj(raw) || typeof raw.field !== 'string' || raw.field.trim() === '') return undefined;
  return { field: raw.field.trim(), ...(raw.abilityScore === true && { abilityScore: true as const }) };
}

/**
 * Stored rules (`settings.initiative`), or undefined when they are none. What Tabletop does not read (Atlas 0.9's
 * sides, side rolls, deck) is kept as stored, for Atlas.
 */
export function parseInitiativeRules(raw: unknown): InitiativeRules | undefined {
  if (!isObj(raw)) return undefined;
  const { mode, roll, firstSide } = raw;
  if ((mode !== 'turn-order' && mode !== 'sides' && mode !== 'cards') || !isSide(firstSide)) return undefined;
  if (typeof roll !== 'string' || parseDiceGroup(roll) === null) return undefined;
  const modifier = parseSource(raw.modifier);
  const modifierFallback = parseSource(raw.modifierFallback);
  const kept = { ...raw };
  delete kept.modifier;
  delete kept.modifierFallback;
  return { ...kept, mode, roll: roll.trim(), firstSide, ...(modifier && { modifier }), ...(modifierFallback && { modifierFallback }) };
}

/** A collection's rules: its own, else those of the game system it was set from, else the default. */
export function collectionInitiativeRules(settings: { initiative?: unknown; systemPresetId?: unknown } | null): InitiativeRules {
  const preset = typeof settings?.systemPresetId === 'string' ? PRESET_RULES[settings.systemPresetId] : undefined;
  return parseInitiativeRules(settings?.initiative) ?? (preset ? structuredClone(preset) : { ...DEFAULT_INITIATIVE_RULES });
}

// ── Sides ───────────────────────────────────────────────────────────────────

export const SIDE_LABELS: Record<InitiativeSide, string> = { players: 'Players', opponents: 'Opponents' };

/** A side's name: a built-in one's label, a named one's name (from the fight's order or the rules). */
export function sideLabel(id: SideId, named: ReadonlyArray<{ id: SideId; name?: string }> = []): string {
  if (isSide(id)) return SIDE_LABELS[id];
  return named.find((side) => side.id === id)?.name ?? id;
}

/**
 * The sides of a fight by sides in the order they act: Atlas 0.9's order when set, else the two built-in ones. Before a fight
 * the order the GM dragged the sides into (Atlas 0.19's `sideOrder`) comes first, as Atlas's list shows them (`listedSides`).
 */
export function fightSides(state: Pick<InitiativeState, 'sides'> & { sideOrder?: unknown }, rules: InitiativeRules): SideId[] {
  const order = state.sides?.order ?? (state.sides ? undefined : rules.sides);
  const sides = order && order.length > 0 ? order.map((side) => side.id) : sidesInOrder(state.sides?.first ?? rules.firstSide);
  if (state.sides || !Array.isArray(state.sideOrder)) return sides;
  const dragged = state.sideOrder.filter((id): id is SideId => typeof id === 'string');
  return inSideOrder(sides.map((id) => ({ id })), dragged).map((side) => side.id);
}

export function otherSide(side: InitiativeSide): InitiativeSide {
  return side === 'players' ? 'opponents' : 'players';
}

export function sidesInOrder(first: InitiativeSide): [InitiativeSide, InitiativeSide] {
  return [first, otherSide(first)];
}

/** Whether the list groups the combatants by side: a running fight keeps its mode, else the rules decide (Atlas's own rule). */
export function listedBySides(initiative: Pick<InitiativeState, 'isActive' | 'sides'>, rules: InitiativeRules): boolean {
  return atlasListedBySides(initiative as never, rules as never);
}

/**
 * A token's side, by Atlas's own rule (`initiative/sides.ts`): the one the GM gave it where `known` has it (the fight's
 * sides; the two built-in ones by default), else the players' for a token that sees, else the opponents'.
 */
export function sideOf(token: { side: SideId | null; sees: boolean } | undefined, known?: readonly SideId[]): SideId {
  if (!token) return 'opponents';
  return atlasSideOf({ side: token.side ?? undefined, vision: { enabled: token.sees } } as never, known as never) as SideId;
}

// ── Modifiers and the edit popup ────────────────────────────────────────────

const SIGNED_WHOLE = /^[+\-−]?\d{1,9}$/;

/** A whole number with an optional sign (the typographic minus counts); anything else is none. */
export function parseInitiativeModifier(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace('−', '-');
  return SIGNED_WHOLE.test(text) ? Number(text) : null;
}

/** The GM's own modifier on an entry, 0 included when set by hand; a plain 0 is none. */
export function ownModifier(entry: Pick<InitiativeEntry, 'initiativeModifier' | 'modifierByHand'>): number | undefined {
  return entry.modifierByHand || entry.initiativeModifier !== 0 ? entry.initiativeModifier : undefined;
}

/** The modifier field as the popup opens: the GM's own, empty where there is none. */
export function modifierText(entry: Pick<InitiativeEntry, 'initiativeModifier' | 'modifierByHand'>): string {
  const own = ownModifier(entry);
  return own === undefined ? '' : String(own);
}

/** A confirmed popup's changes: the total where it is a whole number; the modifier set, or cleared when emptied. */
export function initiativeEdit(totalText: string, modifierInput: string): Extract<InitiativeAction, { type: 'edit' }>['changes'] {
  const total = parseInitiativeModifier(totalText);
  const modifier = modifierInput.trim() === '' ? null : parseInitiativeModifier(modifierInput);
  return {
    ...(total !== null && { initiative: total }),
    ...(modifierInput.trim() === ''
      ? { initiativeModifier: 0, modifierByHand: undefined }
      : modifier !== null && { initiativeModifier: modifier, modifierByHand: true as const }),
  };
}

/** A statblock key without case, spaces, underscores and hyphens: `Max Stress` and `max_stress` are one field. */
const normalizedKey = (key: string): string => key.toLowerCase().replace(/[\s_-]/g, '');

/** A dotted path (`initiative`, `stats.1`) in a statblock's fields, a key matched however it is spelled. */
export function resolveField(record: Readonly<Record<string, unknown>>, path: string): unknown {
  let value: unknown = record;
  for (const part of path.split('.').map((piece) => piece.trim()).filter(Boolean)) {
    if (Array.isArray(value)) value = /^\d+$/.test(part) ? value[Number(part)] : undefined;
    else if (isObj(value)) {
      const key = part in value ? part : Object.keys(value).find((candidate) => normalizedKey(candidate) === normalizedKey(part));
      value = key === undefined ? undefined : value[key];
    } else return undefined;
  }
  return value;
}

function readSource(fields: Record<string, unknown>, source: ModifierSource | undefined): number | null {
  if (!source) return null;
  const value = parseInitiativeModifier(resolveField(fields, source.field));
  return value !== null && source.abilityScore ? Math.floor((value - 10) / 2) : value;
}

/** The modifier a statblock holds where the rules read it (their field, else their fallback); null where none does. */
export function statblockModifier(fields: Record<string, unknown>, rules: Pick<InitiativeRules, 'modifier' | 'modifierFallback'>): number | null {
  // Before the fallback, Fantasy Statblocks' own initiative modifier (`modifier`), as Atlas 0.9 reads it.
  return readSource(fields, rules.modifier) ?? readSource(fields, { field: 'modifier' }) ?? readSource(fields, rules.modifierFallback);
}

/** The total of a dice group; a d20 where `roll` is none. */
export function rollInitiativeDice(roll: string, random: () => number): number {
  const { count, sides } = parseDiceGroup(roll) ?? { count: 1, sides: 20 };
  let total = 0;
  for (let die = 0; die < count; die++) total += Math.floor(random() * sides) + 1;
  return total;
}

// ── The state ───────────────────────────────────────────────────────────────

export function emptyInitiative(): InitiativeState {
  return { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } };
}

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** The tracker as a map file holds it, defaulted as Atlas defaults it; entries without an id are left out. Entries without a token (Atlas 0.18's party members and enemies) are kept, so
 * indices equal Atlas's. */
export function readInitiative(raw: unknown): InitiativeState {
  if (!isObj(raw)) return emptyInitiative();
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter(isObj)
    .filter((entry) => typeof entry.id === 'string')
    .map((entry, index): InitiativeEntry => ({
      ...entry,
      id: entry.id as string,
      ...(typeof entry.tokenId === 'string' ? { tokenId: entry.tokenId } : {}),
      name: typeof entry.name === 'string' ? entry.name : 'Token',
      initiative: num(entry.initiative, 0),
      initiativeModifier: num(entry.initiativeModifier, 0),
      imagePath: typeof entry.imagePath === 'string' ? entry.imagePath : '',
      isActive: entry.isActive === true,
      isNPC: entry.isNPC !== false,
      order: num(entry.order, index),
    }));
  // Atlas 0.9's side turn may be a named side's, with the order and rolls beside it: kept as written.
  const sides = isObj(raw.sides) && isSide(raw.sides.first) && typeof raw.sides.active === 'string'
    ? { ...raw.sides, first: raw.sides.first, active: raw.sides.active } as InitiativeState['sides']
    : undefined;
  const config = isObj(raw.config) ? raw.config : {};
  return {
    ...raw,
    entries,
    currentIndex: num(raw.currentIndex, -1),
    round: num(raw.round, 0),
    isActive: raw.isActive === true,
    config: { ...config, autoSort: config.autoSort !== false },
    ...(sides ? { sides } : {}),
  };
}

/** The combatants in the order the tracker lists them. */
export function sortedEntries(state: InitiativeState): InitiativeEntry[] {
  return [...state.entries].sort((a, b) => a.order - b.order);
}

/** The combatants whose turn it is while a fight runs: those marked active, else the one at the current place. */
export function currentEntries(state: InitiativeState): InitiativeEntry[] {
  if (!state.isActive) return [];
  const marked = state.entries.filter((entry) => entry.isActive && entry.sitsOut !== true);
  if (marked.length > 0) return marked;
  const at = Math.max(state.currentIndex, 0);
  return state.entries.slice(at, at + 1);
}

/** What tells one turn from the next (the horn sounds on it): a key that changes with the round and the combatants. */
export function turnAnnouncement(state: InitiativeState): { key: string } | null {
  const current = currentEntries(state);
  if (current.length === 0) return null;
  return { key: `${state.round}:${current.map((entry) => entry.id).join(',')}` };
}

/** The tokens of the combatants holding their turn back, while a fight runs. */
export function delayedTokens(state: InitiativeState): string[] {
  return state.isActive ? state.entries.flatMap((entry) => (entry.delayed === true && entry.tokenId !== undefined ? [entry.tokenId] : [])) : [];
}

/** The tokens of the combatants whose turn it is: a party member or an enemy without a token has none to light. */
export function currentTokenIds(state: InitiativeState): string[] {
  return currentEntries(state).flatMap((entry) => (entry.tokenId === undefined ? [] : [entry.tokenId]));
}
