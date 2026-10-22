/**
 * How a collection rolls dice, as Atlas describes it in its API (`DiceRules`, `CritRule`, `ExplodeRule`): the roll a
 * bare bonus is added to, how critical results are recognised and which dice explode. Pure.
 */
import { DIE_FACES, DIE_TYPES, type DieType } from './kit/faces';

export interface DiceRules {
  /** One dice group, `NdS`; a bare `+3` rolls it. */
  defaultRoll: string;
  /** Decided on the default dice of a roll only. */
  crit: 'natural' | 'roll-under' | 'doubles' | 'high-total' | 'none';
  /** Unset: no die explodes. */
  explode?: { dice: 'default' | 'all'; repeats: boolean; highFaces: number; lowFaces: number };
}

export const DEFAULT_RULES: DiceRules = { defaultRoll: '1d20', crit: 'natural' };

/** At most this many dice in a roll; a d100 counts once. */
export const MAX_DICE = 20;

export interface RollRequest {
  dice: Partial<Record<DieType, number>>;
  modifier: number;
  /** Rolls a second default die and keeps the higher (advantage) or the lower. */
  advantage?: 'advantage' | 'disadvantage';
  label?: string;
  /** One colour for every die of a type. */
  colors?: Partial<Record<DieType, string>>;
  /** A colour for each die of a type, in order (null: the pack's colour); wins over `colors`. */
  dieColors?: Partial<Record<DieType, Array<string | null>>>;
}

/** One die of a finished roll, as Atlas logs it. */
export interface RolledDie {
  die: DieType;
  value: number;
  max: number;
  /** Thrown because the die before it exploded. */
  exploded?: true;
  /** Subtracts: thrown for an explosion downwards. */
  negative?: true;
  color?: string;
  colorName?: string;
  /** Not counted: the die advantage or disadvantage set aside. */
  dropped?: true;
}

const asDie = (sides: string): DieType | null => {
  const die = `d${Number(sides)}`;
  return (DIE_TYPES as readonly string[]).includes(die) ? (die as DieType) : null;
};

/** `NdS` (N defaults to 1) → its die and count; null when it is not one known dice group. */
function diceGroup(text: string): { die: DieType; count: number } | null {
  const match = /^(\d*)d(\d+)$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const die = asDie(match[2]);
  const count = match[1] === '' ? 1 : Number(match[1]);
  return die && count >= 1 ? { die, count } : null;
}

export function defaultDie(rules: DiceRules): DieType | null {
  return diceGroup(rules.defaultRoll)?.die ?? null;
}

/**
 * `NdS` groups and flat numbers joined by `+`/`-`, e.g. `2d6+1d8-1`. Without any dice group the default roll is
 * rolled. Null for an unknown die, a subtracted group, more than 20 dice or anything else.
 */
export function parseFormula(formula: string, rules: DiceRules = DEFAULT_RULES): RollRequest | null {
  const text = formula.replace(/\s+/g, '').toLowerCase();
  const term = /([+-])?(?:(\d*)d(\d+)|(\d+))/y;
  const dice: Partial<Record<DieType, number>> = {};
  let modifier = 0;
  let count = 0;
  let index = 0;
  while (index < text.length) {
    term.lastIndex = index;
    const match = term.exec(text);
    if (!match || (index > 0 && !match[1])) return null;
    index = term.lastIndex;
    const sign = match[1] === '-' ? -1 : 1;
    if (match[4] !== undefined) {
      modifier += sign * Number(match[4]);
      continue;
    }
    const group = diceGroup(`${match[2]}d${match[3]}`);
    if (!group || sign < 0) return null;
    dice[group.die] = (dice[group.die] ?? 0) + group.count;
    count += group.count;
  }
  if (index === 0) return null;
  if (count === 0) {
    const group = diceGroup(rules.defaultRoll);
    if (!group) return null;
    dice[group.die] = group.count;
    count = group.count;
  }
  return count > MAX_DICE ? null : { dice, modifier };
}

/**
 * Whether a die showing `value` explodes: one of its `highFaces` highest faces rolls again and adds ('up'), one of
 * its `lowFaces` lowest rolls again and subtracts ('down'). `isDefault`: the die is a default die of the roll, or
 * was thrown for one's explosion; `fromExplosion`: it was thrown for an explosion, so explodes only if the rule repeats.
 */
export function explosion(rules: DiceRules, die: DieType, value: number, isDefault: boolean, fromExplosion: boolean): 'up' | 'down' | null {
  const rule = rules.explode;
  if (!rule || (rule.dice === 'default' && !isDefault) || (fromExplosion && !rule.repeats)) return null;
  if (rule.highFaces > 0 && value > DIE_FACES[die] - rule.highFaces) return 'up';
  if (rule.lowFaces > 0 && value <= rule.lowFaces) return 'down';
  return null;
}

/** The roll's critical result, from its default dice that count: not set aside, not thrown for an explosion. */
export function critOf(rules: DiceRules, rolls: readonly RolledDie[]): 'success' | 'failure' | undefined {
  const die = defaultDie(rules);
  const dice = rolls.filter((roll) => roll.die === die && !roll.dropped && !roll.exploded && !roll.negative);
  if (dice.length === 0) return undefined;
  switch (rules.crit) {
    case 'natural':
      if (dice.some((roll) => roll.value === roll.max)) return 'success';
      return dice.some((roll) => roll.value === 1) ? 'failure' : undefined;
    case 'roll-under':
      if (dice.some((roll) => roll.value === 1)) return 'success';
      return dice.some((roll) => roll.value === roll.max) ? 'failure' : undefined;
    case 'doubles':
      return dice.length > 1 && dice.every((roll) => roll.value === dice[0].value) ? 'success' : undefined;
    case 'high-total': {
      const sum = dice.reduce((acc, roll) => acc + roll.value, 0);
      const highest = dice.reduce((acc, roll) => acc + roll.max, 0);
      return sum >= highest - 1 ? 'success' : undefined;
    }
    default:
      return undefined;
  }
}

export function total(rolls: readonly RolledDie[], modifier: number): number {
  return rolls.reduce((acc, roll) => (roll.dropped ? acc : acc + (roll.negative ? -roll.value : roll.value)), modifier);
}
