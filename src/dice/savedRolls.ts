/**
 * The dice tray's saved rolls on the board (Atlas 0.18): the rolls a collection keeps under a name (`dicePresets`), read and
 * written as Atlas's own tray does (`atlasPort/.../dice/diceShelf.ts`, `presetLook.ts`: Atlas's files, copied), and how one
 * is thrown with the board's dice. Pure: the panel (`savedRollsPanel.ts`) and, later, the tray's editable dice row use it.
 */
import { at } from '../atlasPort/atlasText';
import { compareVersions } from '../../packages/atlas-host/src/atlasFloor';
import {
  MAX_PRESET_NAME, newPreset, withPresetReplaced, withSavedPreset, type DiceShelf, type ShelfChange,
} from '../atlasPort/app/react/components/dice/diceShelf';
import { lookOfFormula } from '../atlasPort/app/react/components/dice/presetLook';
import { rulesOfLook } from './atlasDice';
import { DIE_TYPES } from './kit/faces';
import { explainFormula, parseFormula, type DiceRules, type RollRequest } from './rollRules';

/** A saved roll as Atlas keeps it (`DicePreset`): a formula, or designed dice (`look`) with a bonus as its formula. */
export interface SavedRoll {
  id: string;
  name: string;
  formula: string;
  look?: { dice: Array<{ count: number; sides: number; colour?: string; name?: string }>; [rule: string]: unknown } | undefined;
}

/** The Atlas that keeps saved rolls in its collections. */
export const SAVED_ROLLS_SINCE = '0.18.0';

/** Whether this Atlas keeps saved rolls (older ones have no `dicePresets`: the panel stays out). */
export const savedRollsOffered = (version: string | null): boolean => version !== null && compareVersions(version, SAVED_ROLLS_SINCE) >= 0;

/** Why a roll was not saved: the field to blame and Atlas's words for it; or the shelf is full; or the roll is gone. */
export type SavedRollProblem = { problem: string; field: 'name' | 'formula' } | { full: true } | { gone: true };
export type SavedRollChange = { change: ShelfChange; preset: SavedRoll };

/** The formula as the parser reads it: the tray writes a true minus sign, the parser reads the hyphen. */
export const parseableFormula = (text: string): string => text.replaceAll('−', '-').trim();

/** Atlas's check of a name and a formula to keep; null where both can be kept. */
function problemOf(name: string, written: string, rules: DiceRules): { problem: string; field: 'name' | 'formula' } | null {
  if (name.trim() === '') return { problem: at('diceRoll.presetNeedsName'), field: 'name' };
  if (written === '') return { problem: at('diceRoll.presetNeedsFormula'), field: 'formula' };
  const unreadable = explainFormula(written, rules);
  return unreadable ? { problem: unreadable, field: 'formula' } : null;
}

/**
 * The shelf with a new roll saved under `name` (Atlas's save): a formula of plain dice and numbers becomes dice to dress
 * (`1d8[slashing] + 3`: a d8 named Slashing, bonus +3), any other keeps its formula. `rules` are the collection's, which
 * decide whether the board can throw the formula.
 */
export function saveRoll(shelf: DiceShelf, name: string, formula: string, rules: DiceRules, id?: string): SavedRollChange | SavedRollProblem {
  const written = parseableFormula(formula);
  const problem = problemOf(name, written, rules);
  if (problem) return problem;
  const designed = lookOfFormula(written);
  const preset = (designed ? newPreset(name, designed.bonus, designed.look, id) : newPreset(name, written, undefined, id)) as SavedRoll;
  const change = withSavedPreset(shelf, preset);
  return change ? { change, preset } : { full: true };
}

/**
 * The shelf with a saved roll renamed. A roll written as a formula can be rewritten too; a designed one keeps its dice and
 * bonus whatever is typed (they are dressed in Atlas's editor).
 */
export function savedRollEdited(shelf: DiceShelf, id: string, name: string, formula: string, rules: DiceRules): SavedRollChange | SavedRollProblem {
  const kept = shelf.presets.find((preset) => preset.id === id) as SavedRoll | undefined;
  if (!kept) return { gone: true };
  const written = kept.look ? kept.formula : parseableFormula(formula);
  const problem = kept.look ? (name.trim() === '' ? problemOf(name, written, rules) : null) : problemOf(name, written, rules);
  if (problem) return problem;
  const preset: SavedRoll = { ...kept, name: name.trim().slice(0, MAX_PRESET_NAME), formula: written };
  return { change: withPresetReplaced(shelf, preset), preset };
}

/** What a saved roll throws: its request, and the rules it is thrown by (a designed roll's own dice, else the collection's). */
export type SavedRollPlan = { request: RollRequest; rules: DiceRules } | { problem: string };

/** The dice of a designed roll the board has none of (`d3`), in words. */
function missingDie(look: NonNullable<SavedRoll['look']>): string | null {
  const known: readonly string[] = DIE_TYPES;
  const missing = look.dice.find((die) => !known.includes(`d${die.sides}`));
  return missing ? noDieText(missing.sides) : null;
}

/** Why a die of `sides` faces cannot be thrown on the board (it has the standard bodies only). */
export const noDieText = (sides: number): string => `There is no d${sides} to throw here: use d4, d6, d8, d10, d12, d20 or d100.`;

/**
 * How a saved roll is thrown (Atlas's `useSavedRolls.roll`): a formula as written, by the collection's rules; designed dice
 * as their own set (its colours, names and rules), the bonus added to them. `side`: a designed roll takes it only where its
 * set has a rule for it.
 */
export function savedRollPlan(preset: SavedRoll, collection: DiceRules, side?: 'advantage' | 'disadvantage' | null): SavedRollPlan {
  if (!preset.look) {
    const request = parseFormula(parseableFormula(preset.formula), collection);
    return request ? { request, rules: collection } : { problem: explainFormula(parseableFormula(preset.formula), collection) ?? `Can't read "${preset.formula}" as dice.` };
  }
  const rules = rulesOfLook(preset.look);
  if (!rules) return { problem: missingDie(preset.look) ?? `${preset.name} holds dice these dice cannot throw.` };
  // An empty bonus is a bonus of nothing: the set's own dice are what is thrown.
  const written = preset.formula.trim() === '' ? '+0' : parseableFormula(preset.formula);
  const request = parseFormula(written, rules);
  if (!request) return { problem: explainFormula(written, rules) ?? `Can't read "${preset.formula}" as dice.` };
  const edge = side ? rules[side] : null;
  return { request: { ...request, ...(side && edge ? { advantage: side } : {}) }, rules };
}
