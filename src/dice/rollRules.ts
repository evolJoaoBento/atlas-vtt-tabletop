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
  /**
   * The dice of a dice set, group by group, each with the colour the set gives it (Atlas's Dice lab): a bare bonus
   * rolls all of them, mixed kinds and colours included. Unset where the collection stores only `defaultRoll`.
   */
  groups?: DieGroup[];
  /**
   * What advantage and disadvantage do on a dice set (`DiceSet.advantage`, `.disadvantage`): `null` where the set sets
   * nothing, and the roll rolls as any other. Unset (a collection that stores only `defaultRoll`): keep the best or worst.
   */
  advantage?: EdgeRule | null;
  disadvantage?: EdgeRule | null;
}

/** A group of a dice set's dice. */
export interface DieGroup {
  die: DieType;
  count: number;
  color?: string;
}

/**
 * What advantage or disadvantage does on a dice set: `keep` rolls one more of the set's die and keeps the best (the
 * worst for disadvantage; the other way round on a roll-under set), `number` adds the number (takes it off for
 * disadvantage) and `die` adds a die of its own (subtracts it for disadvantage).
 */
export type EdgeRule = { kind: 'keep' } | { kind: 'number'; value: number } | { kind: 'die'; die: DieType; color?: string };

/** The edge `side` has on these rules; null for none. */
export function edgeOf(rules: DiceRules, side: 'advantage' | 'disadvantage'): EdgeRule | null {
  const edge = rules[side];
  return edge === undefined ? { kind: 'keep' } : edge;
}

export const DEFAULT_RULES: DiceRules = { defaultRoll: '1d20', crit: 'natural' };

/** At most this many dice in a roll; a d100 counts once. */
export const MAX_DICE = 20;

/** How often `rr` throws a die again at most (Atlas's limit). */
export const REROLL_REPEATS = 10;

/** The numbers a die can show (a d100 reads 1 to 100). */
const faceNumbers = (die: DieType): number[] => Array.from({ length: DIE_FACES[die] }, (_, i) => i + 1);

/** `kh`/`kl` keep the highest/lowest dice of a kind, `dh`/`dl` drop them (`4d6kh3`, `2d20dl1`). */
export type KeepMode = 'kh' | 'kl' | 'dh' | 'dl';

export interface KeepRule {
  mode: KeepMode;
  count: number;
}

/**
 * A reroll (`2d6r<2`, `1d20ro1`, `4d6rr<=2`), Atlas's: a die that meets the condition is thrown again, up to `limit` times
 * (`r` and `ro` once, `rr` ten times); the die it replaces stays in the roll, marked rerolled, and counts for nothing.
 * A bare `r` rerolls ones.
 */
export interface RerollRule {
  op: '>=' | '>' | '<=' | '<' | '=';
  value: number;
  limit: number;
}

/** A success count (`5d10>=8`): the roll's total is the number of kept dice of `die` that meet the target. */
export interface SuccessRule {
  die: DieType;
  op: '>=' | '>' | '<=' | '<' | '=';
  target: number;
}

export interface RollRequest {
  dice: Partial<Record<DieType, number>>;
  modifier: number;
  /** Per kind of die: which of its dice count. The others are set aside (marked dropped). */
  keep?: Partial<Record<DieType, KeepRule>>;
  /** Per kind of die: which results are thrown again. */
  reroll?: Partial<Record<DieType, RerollRule>>;
  success?: SuccessRule;
  /** Rolls a second default die and keeps the higher (advantage) or the lower. */
  advantage?: 'advantage' | 'disadvantage';
  label?: string;
  /** Fate dice (`4dF`): how many. Thrown as d6s, each reading minus, blank or plus (two faces each). */
  fate?: number;
  /** A label for each die of a type, in order (null: none), from `2d6[fire]+1d6[cold]`; the labels of the Fate dice. */
  dieLabels?: Partial<Record<DieType, Array<string | null>>>;
  fateLabels?: Array<string | null>;
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
  /** Counted for nothing: thrown again under a reroll rule, the die that replaced it follows. */
  rerolled?: true;
  /** A Fate die: thrown as a d6, it reads -1, 0 or +1 (`max` 1). */
  fate?: true;
  /** What the formula called the die's group (`2d6[fire]`). */
  label?: string;
}

/** What each face of the d6 a Fate die is thrown as means: two minus, two blank, two plus. */
export const FATE_FACES: readonly number[] = [-1, -1, 0, 0, 1, 1];

/** The longest a label may be, and what it may hold (Atlas's own: letters, numbers, spaces, apostrophes and hyphens). */
const LABEL = /^[\p{L}\p{N} '-]{1,24}$/u;

const asDie = (sides: string): DieType | null => {
  const die = sides === '%' ? 'd100' : `d${Number(sides)}`;
  return (DIE_TYPES as readonly string[]).includes(die) ? (die as DieType) : null;
};

/** `NdS` (N defaults to 1) → its die and count; null when it is not one known dice group. */
function diceGroup(text: string): { die: DieType; count: number } | null {
  const match = /^(\d*)d(\d+|%)$/.exec(text.trim().toLowerCase());
  if (!match) return null;
  const die = asDie(match[2]);
  const count = match[1] === '' ? 1 : Number(match[1]);
  return die && count >= 1 ? { die, count } : null;
}

export function defaultDie(rules: DiceRules): DieType | null {
  return rules.groups?.[0]?.die ?? diceGroup(rules.defaultRoll)?.die ?? null;
}

/** Every kind of die the default roll holds. */
export function defaultDice(rules: DiceRules): DieType[] {
  return rules.groups ? [...new Set(rules.groups.map((group) => group.die))] : [defaultDie(rules)].filter((die): die is DieType => die !== null);
}

/** Why `parseFormula` refuses a formula, in words for the roller; null when it reads. */
export function explainFormula(formula: string, rules: DiceRules = DEFAULT_RULES): string | null {
  const result = readFormula(formula, rules);
  return 'error' in result ? result.error : null;
}

/**
 * `NdS` groups (`d%` is a d100) and flat numbers joined by `+`/`-`, e.g. `2d6+1d8-1`. A group may keep or drop dice
 * (`4d6kh3`, `2d20kl1`, `5d8dh1`), reroll (`2d6r<2`, `1d20ro1`, `4d6rr<=2`) and a formula may count successes (`5d10>=8`, `5d10cs>7`) on its one kind of die.
 * Without any dice group the default roll is rolled. Null for an unknown die, a subtracted group, more than 20 dice or
 * anything else (`explainFormula` says which).
 */
export function parseFormula(formula: string, rules: DiceRules = DEFAULT_RULES): RollRequest | null {
  const result = readFormula(formula, rules);
  return 'error' in result ? null : result;
}

function readFormula(formula: string, rules: DiceRules): RollRequest | { error: string } {
  const bad = (error: string): { error: string } => ({ error });
  // Labels (`2d6[fire]`) are taken out first, whitespace and all, and put back by number.
  const labels: string[] = [];
  const withoutLabels = formula.replace(/\[([^\]]*)\]/g, (_all, inner: string) => `{${labels.push(inner.trim()) - 1}}`);
  const text = withoutLabels.replace(/\s+/g, '').toLowerCase();
  for (const label of labels) if (!LABEL.test(label)) return bad('A label is 1 to 24 letters, numbers, spaces, apostrophes or hyphens, like [fire].');
  if (text === '') return bad('Enter a formula such as 2d6+3.');
  const term = /([+-])?(?:(\d*)d(\d+|%|f)(?:r([or]?)(?:(>=|<=|>|<|=)?(\d+))?)?(?:(k[hl]|d[hl])(\d*))?(?:cs)?(?:(>=|<=|>|<|=)(\d+))?(?:\{(\d+)\})?|(\d+))/y;
  const keep: Partial<Record<DieType, KeepRule>> = {};
  const reroll: Partial<Record<DieType, RerollRule>> = {};
  const kinds = new Map<DieType, number>();
  let success: SuccessRule | undefined;
  const dice: Partial<Record<DieType, number>> = {};
  let dieColors: Partial<Record<DieType, Array<string | null>>> | undefined;
  const dieLabels: Partial<Record<DieType, Array<string | null>>> = {};
  const fateLabels: Array<string | null> = [];
  let fate = 0;
  let modifier = 0;
  let count = 0;
  let index = 0;
  while (index < text.length) {
    term.lastIndex = index;
    const match = term.exec(text);
    if (!match || (index > 0 && !match[1])) return bad(`Can't read "${formula.trim()}" as dice: use groups like 2d6, joined by + or -.`);
    index = term.lastIndex;
    const sign = match[1] === '-' ? -1 : 1;
    if (match[12] !== undefined) {
      modifier += sign * Number(match[12]);
      continue;
    }
    const label = match[11] === undefined ? null : labels[Number(match[11])] ?? null;
    if (match[3] === 'f') {
      const dealt = match[2] === '' ? 1 : Number(match[2]);
      if (!(dealt >= 1)) return bad('A group needs at least one die.');
      if (sign < 0) return bad('A group of dice cannot be subtracted.');
      if (match[4] !== undefined || match[7] !== undefined || match[9] !== undefined) return bad('Fate dice take no keep, drop, reroll or success rule.');
      fate += dealt;
      count += dealt;
      for (let i = 0; i < dealt; i++) fateLabels.push(label);
      continue;
    }
    const group = diceGroup(`${match[2]}d${match[3]}`);
    if (!group) return bad(match[2] === '0' ? 'A group needs at least one die.' : `There is no d${match[3]}: use d4, d6, d8, d10, d12, d20 or d100.`);
    if (sign < 0) return bad('A group of dice cannot be subtracted.');
    const before = dice[group.die] ?? 0;
    if (label !== null) {
      const own = dieLabels[group.die] ?? [];
      while (own.length < before) own.push(null);
      for (let i = 0; i < group.count; i++) own.push(label);
      dieLabels[group.die] = own;
    }
    dice[group.die] = before + group.count;
    count += group.count;
    kinds.set(group.die, (kinds.get(group.die) ?? 0) + 1);
    if (match[4] !== undefined) {
      const rule: RerollRule = { op: (match[5] ?? '=') as RerollRule['op'], value: match[6] === undefined ? 1 : Number(match[6]), limit: match[4] === 'r' ? REROLL_REPEATS : 1 };
      // Atlas refuses a rule every face meets: the die could never stand.
      if (faceNumbers(group.die).every((face) => isSuccess({ die: group.die, ...rule, target: rule.value }, face))) return bad(`Rerolling ${group.die} like that would never stop: some face has to stand.`);
      reroll[group.die] = rule;
    }
    if (match[7] !== undefined) {
      const kept = match[8] === '' ? 1 : Number(match[8]);
      if (kept < 1) return bad(`${match[7]}0 would keep or drop nothing.`);
      if (match[7].startsWith('d') && kept >= group.count) return bad(`Dropping ${kept} of ${group.count} dice leaves none.`);
      keep[group.die] = { mode: match[7] as KeepMode, count: kept };
    }
    if (match[9] !== undefined) {
      const rule: SuccessRule = { die: group.die, op: match[9] as SuccessRule['op'], target: Number(match[10]) };
      if (success && success.die !== rule.die) return bad('Count successes on one kind of die only.');
      success = rule;
    }
  }
  if (index === 0) return bad(`Can't read "${formula.trim()}" as dice.`);
  for (const die of [...Object.keys(keep), ...Object.keys(reroll)] as DieType[]) {
    if ((kinds.get(die) ?? 0) > 1) return bad(`Keep, drop and reroll apply to a whole kind of die: write one ${die} group.`);
  }
  if (count === 0 && rules.groups && rules.groups.length > 0) {
    // A dice set rolls every group it has, each die in the colour the set gives it.
    for (const group of rules.groups) {
      dice[group.die] = (dice[group.die] ?? 0) + group.count;
      count += group.count;
      for (let i = 0; i < group.count; i++) (dieColors ??= {})[group.die] = [...(dieColors[group.die] ?? []), group.color ?? null];
    }
    if (dieColors && !Object.values(dieColors).some((colors) => colors.some((color) => color !== null))) dieColors = undefined;
  } else if (count === 0) {
    const group = diceGroup(rules.defaultRoll);
    if (!group) return bad(`The collection's default roll "${rules.defaultRoll}" is not one these dice can throw.`);
    dice[group.die] = group.count;
    count = group.count;
  }
  if (count > MAX_DICE) return bad(`A roll holds at most ${MAX_DICE} dice.`);
  if (fate > 0 && (Object.keys(keep).length > 0 || Object.keys(reroll).length > 0 || success)) return bad('Fate dice cannot be mixed with a keep, drop, reroll or success rule.');
  return {
    dice, modifier, ...(dieColors ? { dieColors } : {}),
    ...(fate > 0 ? { fate } : {}),
    ...(Object.keys(dieLabels).length > 0 ? { dieLabels } : {}),
    ...(fateLabels.some((each) => each !== null) ? { fateLabels } : {}),
    ...(Object.keys(keep).length > 0 ? { keep } : {}),
    ...(Object.keys(reroll).length > 0 ? { reroll } : {}),
    ...(success ? { success } : {}),
  };
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
  const kinds = defaultDice(rules);
  const dice = rolls.filter((roll) => kinds.includes(roll.die) && !roll.fate && !roll.dropped && !roll.rerolled && !roll.exploded && !roll.negative);
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

/** Whether a die showing `value` is a success of the rule. */
export function isSuccess(rule: SuccessRule, value: number): boolean {
  switch (rule.op) {
    case '>=': return value >= rule.target;
    case '>': return value > rule.target;
    case '<=': return value <= rule.target;
    case '<': return value < rule.target;
    default: return value === rule.target;
  }
}

/** The dice a keep rule sets aside, from the values (by id) of the dice of one kind: ties go to the die thrown first. */
export function keepDropped(rule: KeepRule, dice: ReadonlyArray<{ id: number; value: number }>): Set<number> {
  // Among equal values the die thrown first counts as the extreme one (the higher for kh and dh, the lower for kl and dl).
  const high = rule.mode === 'kh' || rule.mode === 'dh';
  const sorted = [...dice].sort((a, b) => a.value - b.value || (high ? b.id - a.id : a.id - b.id));
  const n = Math.min(rule.count, sorted.length);
  const gone = rule.mode === 'kh' ? sorted.slice(0, sorted.length - n)
    : rule.mode === 'kl' ? sorted.slice(n)
      : rule.mode === 'dh' ? sorted.slice(sorted.length - n)
        : sorted.slice(0, n);
  return new Set(gone.map((die) => die.id));
}

/** The number of kept dice of the rule's kind that meet it. */
export function successCount(rule: SuccessRule, rolls: readonly RolledDie[]): number {
  return rolls.filter((roll) => roll.die === rule.die && !roll.fate && !roll.dropped && !roll.rerolled && !roll.negative && isSuccess(rule, roll.value)).length;
}

export function total(rolls: readonly RolledDie[], modifier: number): number {
  return rolls.reduce((acc, roll) => (roll.dropped || roll.rerolled ? acc : acc + (roll.negative ? -roll.value : roll.value)), modifier);
}
