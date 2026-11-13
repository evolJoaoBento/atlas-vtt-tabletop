/**
 * The harness's stand-in for Atlas's initiative tracker: its store actions (`initiativeSlice`, `turns.ts`) as the
 * harness's Atlas runs them on its map, so the board's tracker can be played without Atlas. Tabletop itself changes
 * the tracker only through Atlas's store (`tokenWriter.ts`); nothing here is used by the plugin.
 */
import { otherSide, ownModifier, readInitiative, rollInitiativeDice, statblockModifier, type InitiativeAction, type InitiativeEntry, type InitiativeState } from '../src/board/initiative';

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const renumber = (entries: InitiativeEntry[]): void => entries.forEach((entry, index) => { entry.order = index; });

/** What breaks a tie (Atlas 0.9's `tieBreakModifier`): Act Now's place, else the GM's modifier, else the last roll's. */
function tieBreakOf(entry: InitiativeEntry): number {
  const tie = entry.tieBreak;
  const rolled = entry.rolledModifier;
  return (typeof tie === 'number' ? tie : undefined) ?? ownModifier(entry) ?? (typeof rolled === 'number' ? rolled : 0);
}

/** The higher total first, of equal totals the higher tie-break, else the order they had (the sort is stable). */
const byInitiative = (state: InitiativeState): void => {
  state.entries.sort((a, b) => b.initiative - a.initiative || tieBreakOf(b) - tieBreakOf(a));
  renumber(state.entries);
};

/** Whether a combatant takes its turn: not defeated, not sitting the round out, not delayed (Atlas 0.9's `actsInTurn`). */
const actsInTurn = (entry: InitiativeEntry, defeated: ReadonlySet<string>): boolean => !defeated.has(entry.id) && !entry.sitsOut && !entry.delayed;
const canStillAct = (entry: InitiativeEntry, defeated: ReadonlySet<string>): boolean => !defeated.has(entry.id) && !entry.delayed;

function clearSittingOut(state: InitiativeState): void {
  for (const entry of state.entries) delete entry.sitsOut;
}

/** A new round: its number, and the marks of the round left cleared (kept by round, so stepping back restores them). */
function beginRound(state: InitiativeState): void {
  state.round++;
  const cleared = state.entries.filter((entry) => entry.sitsOut).map((entry) => entry.id);
  clearSittingOut(state);
  if (cleared.length > 0) state.satOut = { ...(isObj(state.satOut) ? state.satOut : {}), [state.round]: cleared };
}

/** Back into the round before: the marks its end cleared come back. */
function backToRoundBefore(state: InitiativeState): void {
  const kept = isObj(state.satOut) ? state.satOut : {};
  const marks = kept[String(state.round)];
  clearSittingOut(state);
  if (Array.isArray(marks)) for (const entry of state.entries) if (marks.includes(entry.id)) entry.sitsOut = true;
  const rest = { ...kept };
  delete rest[String(state.round)];
  if (Object.keys(rest).length > 0) state.satOut = rest;
  else delete state.satOut;
  state.round--;
}

function giveTurn(state: InitiativeState, index: number): void {
  state.entries.forEach((entry, at) => { entry.isActive = at === index; });
  state.currentIndex = index;
}

function turnIndex(state: InitiativeState): number {
  const index = state.entries.findIndex((entry) => entry.isActive);
  return index === -1 ? state.currentIndex : index;
}

/** The next combatant that acts takes the turn; past the last one a round begins. Nothing moves while nobody can act. */
function nextTurn(state: InitiativeState, defeated: ReadonlySet<string>): void {
  const { entries } = state;
  if (!entries.some((entry) => canStillAct(entry, defeated))) return;
  let index = turnIndex(state);
  for (let step = 0; step < 2 * entries.length; step++) {
    index++;
    if (index >= entries.length) {
      index = 0;
      beginRound(state);
    }
    if (actsInTurn(entries[index], defeated)) return giveTurn(state, index);
  }
}

/** The combatant before that acts takes the turn back; before the first, the round before (not before round 1). */
function previousTurn(state: InitiativeState, defeated: ReadonlySet<string>): void {
  const { entries } = state;
  if (!entries.some((entry) => canStillAct(entry, defeated))) return;
  let index = turnIndex(state);
  for (let step = 0; step < 2 * entries.length; step++) {
    index--;
    if (index < 0) {
      index = entries.length - 1;
      if (state.round > 1) backToRoundBefore(state);
    }
    if (actsInTurn(entries[index], defeated)) return giveTurn(state, index);
  }
}

/** What a fight leaves on the tracker that the next one must not read (Atlas 0.9's cards, round marks, delays). */
function clearFight(state: InitiativeState): void {
  delete state.sides;
  delete state.cards;
  delete state.satOut;
  for (const entry of state.entries) {
    entry.isActive = false;
    delete entry.sitsOut;
    delete entry.card;
    delete entry.delayed;
  }
}

/**
 * The tracker after `action`, as Atlas's store makes it; `random` rolls the dice. The state given is left as it is.
 * A fight only Atlas runs (`fileCannotRun`) is not changed here.
 */
export function applyInitiative(given: InitiativeState, action: InitiativeAction, random: () => number = Math.random): InitiativeState {
  const state = structuredClone(given);
  const { entries } = state;
  const find = (id: string): number => entries.findIndex((entry) => entry.id === id);
  const defeated = new Set('defeated' in action ? action.defeated ?? [] : []);
  switch (action.type) {
    case 'roll': {
      const rolled = entries.filter((entry) => action.entryId === undefined || entry.id === action.entryId);
      for (const entry of rolled) {
        const modifier = ownModifier(entry) ?? action.statblockModifiers[entry.id] ?? 0;
        entry.initiative = rollInitiativeDice(action.roll, random) + modifier;
        // Atlas 0.9: the roll fills the empty slot, and its modifier breaks ties.
        entry.rolledModifier = modifier;
        delete entry.awaitingInitiative;
        delete entry.tieBreak;
      }
      // Atlas re-sorts after rolling everyone, not after one.
      if (action.entryId === undefined && state.config.autoSort) byInitiative(state);
      break;
    }
    case 'next': {
      if (state.sides) {
        if (state.sides.active === state.sides.first) state.sides.active = otherSide(state.sides.first);
        else { state.sides.active = state.sides.first; beginRound(state); }
        break;
      }
      nextTurn(state, defeated);
      break;
    }
    case 'previous': {
      if (state.sides) {
        if (state.sides.active !== state.sides.first) state.sides.active = state.sides.first;
        else if (state.round > 1) { state.sides.active = otherSide(state.sides.first); backToRoundBefore(state); }
        break;
      }
      previousTurn(state, defeated);
      break;
    }
    case 'reorder': {
      const { from, to } = action;
      if (from < 0 || from >= entries.length || to < 0 || to >= entries.length) break;
      const [moved] = entries.splice(from, 1);
      entries.splice(to, 0, moved);
      renumber(entries);
      if (moved.isActive) state.currentIndex = to;
      break;
    }
    case 'front': {
      const index = find(action.id);
      if (index <= 0) break;
      const [moved] = entries.splice(index, 1);
      entries.unshift(moved);
      renumber(entries);
      if (moved.isActive) state.currentIndex = 0;
      break;
    }
    case 'back': {
      const index = find(action.id);
      if (index < 0 || index >= entries.length - 1) break;
      const [moved] = entries.splice(index, 1);
      entries.push(moved);
      renumber(entries);
      if (moved.isActive) state.currentIndex = entries.length - 1;
      break;
    }
    case 'start': {
      clearFight(state);
      state.isActive = true;
      state.round = 1;
      // By sides the turn belongs to a side, never to one combatant.
      if (action.rules.mode === 'sides') {
        state.sides = { first: action.rules.firstSide, active: action.rules.firstSide };
        state.currentIndex = -1;
        break;
      }
      // The first combatant that acts takes the turn; the first of all where none does.
      if (entries.length > 0) giveTurn(state, Math.max(entries.findIndex((entry) => actsInTurn(entry, defeated)), 0));
      else state.currentIndex = 0;
      break;
    }
    case 'end': {
      clearFight(state);
      state.isActive = false;
      state.round = 0;
      state.currentIndex = -1;
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
      clearFight(state);
      state.entries = [];
      state.isActive = false;
      state.round = 0;
      state.currentIndex = -1;
      break;
    }
    case 'edit': {
      const entry = entries[find(action.id)];
      if (!entry) break;
      const changed = action.changes.initiative !== undefined && action.changes.initiative !== entry.initiative;
      Object.assign(entry, action.changes);
      // `undefined` clears a field, as Atlas's store drops it when saving.
      for (const [key, value] of Object.entries(action.changes)) if (value === undefined) delete entry[key];
      // Atlas 0.9: a number of its own fills the empty slot; a new number or modifier ends Act Now's tie-break.
      if (action.changes.initiative !== undefined) delete entry.awaitingInitiative;
      delete entry.tieBreak;
      if (changed && state.config.autoSort) byInitiative(state);
      break;
    }
    case 'remove': {
      const index = find(action.id);
      if (index === -1) break;
      const hadTurn = entries[index].isActive;
      entries.splice(index, 1);
      renumber(entries);
      if (!hadTurn || entries.length === 0) break;
      // In a running fight in turn order the turn passes on as if it had ended; otherwise the one now there takes it.
      if (state.isActive && !state.sides) {
        state.currentIndex = index - 1;
        nextTurn(state, defeated);
        break;
      }
      const next = Math.min(index, entries.length - 1);
      giveTurn(state, next);
      break;
    }
  }
  return state;
}
