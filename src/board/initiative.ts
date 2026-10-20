/**
 * Atlas's initiative tracker (0.8.0) as the 3D board runs it: the tracker's state as the map file keeps it, the
 * collection's initiative rules, the sides of a fight by sides, the edit popup's fields, the modifier a combatant adds
 * to its roll, and every change the tracker makes (Atlas's `initiativeSlice`, `turns.ts`), each returning the state
 * after it. The token writer sends a change to Atlas's store when Atlas holds the map, else applies it here to the
 * file. Pure, so it is tested without Obsidian.
 */

export type InitiativeSide = 'players' | 'opponents';
export type InitiativeMode = 'turn-order' | 'sides';

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
}

/** A combatant, as Atlas keeps it; fields Tabletop does not know are kept as they are. */
export interface InitiativeEntry {
  id: string;
  tokenId: string;
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
  [field: string]: unknown;
}

export interface InitiativeState {
  entries: InitiativeEntry[];
  currentIndex: number;
  round: number;
  isActive: boolean;
  config: { autoSort: boolean; [field: string]: unknown };
  sides?: { first: InitiativeSide; active: InitiativeSide };
  [field: string]: unknown;
}

/** A change the tracker makes; `roll` carries each combatant's statblock modifier, read beforehand. */
export type InitiativeAction =
  | { type: 'roll'; entryId?: string; roll: string; statblockModifiers: Record<string, number> }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'reorder'; from: number; to: number }
  | { type: 'front'; id: string }
  | { type: 'back'; id: string }
  | { type: 'start'; rules: InitiativeRules }
  | { type: 'end' }
  | { type: 'sitsOut'; id: string; sitsOut: boolean }
  | { type: 'reset' }
  | { type: 'edit'; id: string; changes: Partial<Pick<InitiativeEntry, 'initiative' | 'initiativeModifier' | 'modifierByHand'>> }
  | { type: 'remove'; id: string };

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

/** Stored rules (`settings.initiative`), or undefined when they are none. */
export function parseInitiativeRules(raw: unknown): InitiativeRules | undefined {
  if (!isObj(raw)) return undefined;
  const { mode, roll, firstSide } = raw;
  if ((mode !== 'turn-order' && mode !== 'sides') || !isSide(firstSide)) return undefined;
  if (typeof roll !== 'string' || parseDiceGroup(roll) === null) return undefined;
  const modifier = parseSource(raw.modifier);
  const modifierFallback = parseSource(raw.modifierFallback);
  return { mode, roll: roll.trim(), firstSide, ...(modifier && { modifier }), ...(modifierFallback && { modifierFallback }) };
}

/** A collection's rules: its own, else those of the game system it was set from, else the default. */
export function collectionInitiativeRules(settings: { initiative?: unknown; systemPresetId?: unknown } | null): InitiativeRules {
  const preset = typeof settings?.systemPresetId === 'string' ? PRESET_RULES[settings.systemPresetId] : undefined;
  return parseInitiativeRules(settings?.initiative) ?? (preset ? structuredClone(preset) : { ...DEFAULT_INITIATIVE_RULES });
}

// ── Sides ───────────────────────────────────────────────────────────────────

export const SIDE_LABELS: Record<InitiativeSide, string> = { players: 'Players', opponents: 'Opponents' };

export function otherSide(side: InitiativeSide): InitiativeSide {
  return side === 'players' ? 'opponents' : 'players';
}

export function sidesInOrder(first: InitiativeSide): [InitiativeSide, InitiativeSide] {
  return [first, otherSide(first)];
}

/** Whether the list groups the combatants by side: a running fight keeps its mode, else the rules decide. */
export function listedBySides(initiative: Pick<InitiativeState, 'isActive' | 'sides'>, rules: InitiativeRules): boolean {
  return initiative.isActive ? initiative.sides !== undefined : rules.mode === 'sides';
}

/** A token's side: the one the GM gave it, else the players' for a token that sees, else the opponents'. */
export function sideOf(token: { side: InitiativeSide | null; sees: boolean } | undefined): InitiativeSide {
  if (token?.side) return token.side;
  return token?.sees ? 'players' : 'opponents';
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
  return readSource(fields, rules.modifier) ?? readSource(fields, rules.modifierFallback);
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

/** The tracker as a map file holds it, defaulted as Atlas defaults it; entries without a token are left out. */
export function readInitiative(raw: unknown): InitiativeState {
  if (!isObj(raw)) return emptyInitiative();
  const entries = (Array.isArray(raw.entries) ? raw.entries : []).filter(isObj)
    .filter((entry) => typeof entry.id === 'string' && typeof entry.tokenId === 'string')
    .map((entry, index): InitiativeEntry => ({
      ...entry,
      id: entry.id as string,
      tokenId: entry.tokenId as string,
      name: typeof entry.name === 'string' ? entry.name : 'Token',
      initiative: num(entry.initiative, 0),
      initiativeModifier: num(entry.initiativeModifier, 0),
      imagePath: typeof entry.imagePath === 'string' ? entry.imagePath : '',
      isActive: entry.isActive === true,
      isNPC: entry.isNPC !== false,
      order: num(entry.order, index),
    }));
  const sides = isObj(raw.sides) && isSide(raw.sides.first) && isSide(raw.sides.active) ? { first: raw.sides.first, active: raw.sides.active } : undefined;
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

const renumber = (entries: InitiativeEntry[]): void => entries.forEach((entry, index) => { entry.order = index; });
const byInitiative = (state: InitiativeState): void => {
  state.entries.sort((a, b) => b.initiative - a.initiative);
  renumber(state.entries);
};

function clearSittingOut(state: InitiativeState): void {
  for (const entry of state.entries) delete entry.sitsOut;
}

/** The tracker after `action`, as Atlas's store makes it; `random` rolls the dice. The state given is left as it is. */
export function applyInitiative(given: InitiativeState, action: InitiativeAction, random: () => number = Math.random): InitiativeState {
  const state = structuredClone(given);
  const { entries } = state;
  const find = (id: string): number => entries.findIndex((entry) => entry.id === id);
  switch (action.type) {
    case 'roll': {
      const rolled = entries.filter((entry) => action.entryId === undefined || entry.id === action.entryId);
      for (const entry of rolled) {
        entry.initiative = rollInitiativeDice(action.roll, random) + (ownModifier(entry) ?? action.statblockModifiers[entry.id] ?? 0);
      }
      // Atlas re-sorts after rolling everyone, not after one.
      if (action.entryId === undefined && state.config.autoSort) byInitiative(state);
      break;
    }
    case 'next': {
      if (state.sides) {
        if (state.sides.active === state.sides.first) state.sides.active = otherSide(state.sides.first);
        else { state.sides.active = state.sides.first; state.round++; clearSittingOut(state); }
        break;
      }
      if (entries.length === 0) break;
      const current = entries.find((entry) => entry.isActive);
      if (current) current.isActive = false;
      let next = state.currentIndex + 1;
      if (next >= entries.length) { next = 0; state.round++; }
      state.currentIndex = next;
      if (entries[next]) entries[next]!.isActive = true;
      break;
    }
    case 'previous': {
      if (state.sides) {
        if (state.sides.active !== state.sides.first) state.sides.active = state.sides.first;
        else if (state.round > 1) { state.sides.active = otherSide(state.sides.first); state.round--; }
        break;
      }
      if (entries.length === 0) break;
      const current = entries.find((entry) => entry.isActive);
      if (current) current.isActive = false;
      let previous = state.currentIndex - 1;
      if (previous < 0) {
        previous = entries.length - 1;
        if (state.round > 1) state.round--;
      }
      state.currentIndex = previous;
      if (entries[previous]) entries[previous]!.isActive = true;
      break;
    }
    case 'reorder': {
      const { from, to } = action;
      if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) break;
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved!);
      renumber(entries);
      if (moved!.isActive) state.currentIndex = to;
      break;
    }
    case 'front': {
      const index = find(action.id);
      if (index <= 0) break;
      const [moved] = entries.splice(index, 1);
      entries.unshift(moved!);
      renumber(entries);
      if (moved!.isActive) state.currentIndex = 0;
      break;
    }
    case 'back': {
      const index = find(action.id);
      if (index < 0 || index >= entries.length - 1) break;
      const [moved] = entries.splice(index, 1);
      entries.push(moved!);
      renumber(entries);
      if (moved!.isActive) state.currentIndex = entries.length - 1;
      break;
    }
    case 'start': {
      state.isActive = true;
      state.round = 1;
      entries.forEach((entry) => { entry.isActive = false; });
      clearSittingOut(state);
      // By sides the turn belongs to a side, never to one combatant.
      if (action.rules.mode === 'sides') {
        state.sides = { first: action.rules.firstSide, active: action.rules.firstSide };
        state.currentIndex = -1;
        break;
      }
      delete state.sides;
      state.currentIndex = 0;
      if (entries.length > 0) entries[0]!.isActive = true;
      break;
    }
    case 'end': {
      state.isActive = false;
      state.round = 0;
      state.currentIndex = -1;
      entries.forEach((entry) => { entry.isActive = false; });
      delete state.sides;
      clearSittingOut(state);
      break;
    }
    case 'sitsOut': {
      const entry = entries[find(action.id)];
      if (!entry) break;
      if (action.sitsOut) entry.sitsOut = true;
      else delete entry.sitsOut;
      break;
    }
    case 'reset': {
      state.entries = [];
      state.isActive = false;
      state.round = 0;
      state.currentIndex = -1;
      delete state.sides;
      break;
    }
    case 'edit': {
      const entry = entries[find(action.id)];
      if (!entry) break;
      const changed = action.changes.initiative !== undefined && action.changes.initiative !== entry.initiative;
      Object.assign(entry, action.changes);
      // `undefined` clears a field, as Atlas's store drops it when saving.
      for (const [key, value] of Object.entries(action.changes)) if (value === undefined) delete entry[key];
      if (changed && state.config.autoSort) byInitiative(state);
      break;
    }
    case 'remove': {
      const index = find(action.id);
      if (index === -1) break;
      const wasActive = entries[index]!.isActive;
      entries.splice(index, 1);
      renumber(entries);
      if (wasActive && entries.length > 0) {
        const next = Math.min(index, entries.length - 1);
        entries[next]!.isActive = true;
        state.currentIndex = next;
      }
      break;
    }
  }
  return state;
}
