/**
 * One physical roll from the dice laid on the table to the result: which dice still wait to be thrown, which are in
 * the air, settled or caught on an edge, which explosions still have to be thrown, and the result once every die has
 * a number. Any die at rest may be thrown again; the roll is complete again once it lands. A die never gets a number
 * it did not show. Pure: the dice table reports what each die reads, the session decides what the roll is.
 */
import { caughtMessage } from './kit/caught';
import { DIE_FACES, DIE_TYPES, type DieType, type FaceReading } from './kit/faces';
import { critOf, defaultDice, edgeOf, explosion, FATE_FACES, isSuccess, keepDropped, MAX_DICE, successCount, total, type DiceRules, type KeepRule, type RolledDie, type RollRequest } from './rollRules';

export type DieState = {
  id: number;
  die: DieType;
  color?: string;
  /** `waiting`: laid on the table, not thrown yet. */
  status: 'waiting' | 'rolling' | 'settled' | 'caught';
  value?: number;
  exploded?: true;
  negative?: true;
  /** Thrown again under a reroll rule: its number counts for nothing, the die that replaced it follows. */
  rerolled?: true;
  /** A Fate die (thrown as a d6): it reads -1, 0 or +1 in the result. */
  fate?: true;
  /** The label its group had in the formula. */
  label?: string;
  isDefault: boolean;
};

/** The line over the board while dice lie on the table unthrown. */
export const THROW_PROMPT = 'Drag a die to throw it, or throw them all';

type ThrowReason = 'placed' | 'caught' | 'explode-up' | 'explode-down' | 'reroll';

/** What the session knows of a die beyond its state. */
interface DieLine {
  /** The die of the request this one descends from through explosions (itself for a die of the request). */
  root: number;
  /** A default die, or thrown for one's explosion: what an explosion rule scoped to default dice reaches. */
  defaultLine: boolean;
  fromExplosion: boolean;
  /** The percentile pair: the tens die names its ones die, the ones die its tens die. */
  pair?: number;
  ones?: true;
  /** An explosion or a reroll not yet thrown. */
  awaiting?: 'explode-up' | 'explode-down' | 'reroll';
  /** The die this one's explosion added. */
  explodedInto?: number;
  /** The die thrown to replace this one under a reroll rule. */
  rerolledInto?: number;
  /** How many dice before this one in its slot the reroll rule threw away. */
  rerollDepth: number;
}

export class RollSession {
  private readonly states: DieState[] = [];
  private readonly lines = new Map<number, DieLine>();
  private readonly defaultTypes: readonly DieType[];
  private readonly advantaged: [number, number] | null = null;
  /** The roll's number: what was asked, and what the set's advantage or disadvantage adds or takes off. */
  private modifier: number;
  private nextId = 1;

  constructor(private readonly request: RollRequest, private readonly rules: DiceRules) {
    this.defaultTypes = defaultDice(rules);
    this.modifier = request.modifier;
    for (const die of DIE_TYPES) {
      const count = request.dice[die] ?? 0;
      for (let i = 0; i < count; i++) {
        const own = request.dieColors?.[die]?.[i];
        const color = own === null ? undefined : own ?? request.colors?.[die];
        const label = request.dieLabels?.[die]?.[i] ?? undefined;
        this.addDie(die, { isDefault: this.defaultTypes.includes(die), ...(color !== undefined ? { color } : {}), ...(label !== undefined ? { label } : {}) });
      }
    }
    // Fate dice are thrown as d6s and read as minus, blank or plus; never a default die, never exploding.
    for (let i = 0; i < (request.fate ?? 0); i++) {
      const label = request.fateLabels?.[i] ?? undefined;
      this.addDie('d6', { isDefault: false, fate: true, ...(label !== undefined ? { label } : {}) });
    }
    const defaults = this.states.filter((state) => state.isDefault && !this.lines.get(state.id)?.ones);
    // What the set's advantage or disadvantage does, only to a roll of the set's own dice (Atlas's rule).
    const edge = request.advantage ? edgeOf(rules, request.advantage) : null;
    if (request.advantage && edge && defaults.length > 0) {
      const sign = request.advantage === 'advantage' ? 1 : -1;
      if (edge.kind === 'keep') {
        if (defaults.length === 1 && this.rollCount() < MAX_DICE) {
          const second = this.addDie(defaults[0].die, { isDefault: true, color: defaults[0].color, ...(defaults[0].label !== undefined ? { label: defaults[0].label } : {}) });
          this.advantaged = [defaults[0].id, second];
        }
      } else if (edge.kind === 'number') {
        this.modifier += sign * edge.value;
      } else if (this.rollCount() < MAX_DICE) {
        // A die of its own, laid on the table with the rest; it subtracts for disadvantage.
        this.addDie(edge.die, { isDefault: false, ...(edge.color !== undefined ? { color: edge.color } : {}), ...(sign < 0 ? { negative: true } : {}) });
      }
    }
  }

  get dice(): readonly DieState[] {
    return this.states;
  }

  /** What a die came to rest on; an unreadable or impossible face leaves it caught. Settled dice keep their value. */
  settle(id: number, reading: FaceReading): void {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    if (!state || !line || state.status === 'settled') return;
    delete line.awaiting;
    const value = reading.caught ? null : this.faceValue(state.die, line, reading.face);
    if (value === null) {
      state.status = 'caught';
      delete state.value;
      return;
    }
    state.status = 'settled';
    state.value = value;
    const head = line.ones ? (line.pair as number) : id;
    if (!state.fate && !this.rerollIfDue(head)) this.explode(head);
  }

  /**
   * The die is thrown: one laid on the table, caught, an explosion not yet thrown, or one that had its number (thrown
   * again). A die thrown again loses its number, and the explosion its old face earned goes, thrown or not, with any
   * chain from it. Returns the dice taken out of the roll, for the table to take away. A die in the air is not thrown.
   */
  reroll(id: number): number[] {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    if (!state || !line || state.status === 'rolling') return [];
    delete line.awaiting;
    const removed = state.status === 'settled' ? this.withdrawExplosion(id) : [];
    state.status = 'rolling';
    delete state.value;
    return removed;
  }

  /**
   * The die was knocked loose (a die under it was thrown again) and moves: it is read again where it lands, and that
   * reading replaces whatever it had, a number or caught. Not a throw: it is not pending, and the roll waits for it.
   * The explosion its old face earned goes at once, thrown or not, with any chain from it: where it lands alone
   * decides another. Returns the dice taken out of the roll, for the table to take away.
   */
  loosen(id: number): number[] {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    // A die laid on the table, never thrown, has no reading to lose: it waits for its throw still.
    if (!state || !line || state.status === 'rolling' || state.status === 'waiting') return [];
    const removed = this.withdrawExplosion(id);
    state.status = 'rolling';
    delete state.value;
    return removed;
  }

  /** Takes back the explosion a die's face earned (a d100's, through either of its dice), with any chain from it. */
  private withdrawExplosion(id: number): number[] {
    const line = this.lines.get(id) as DieLine;
    const head = this.lines.get(line.ones ? (line.pair as number) : id) as DieLine;
    const removed: number[] = [];
    if (head.explodedInto !== undefined) this.withdraw(head.explodedInto, removed);
    delete head.explodedInto;
    // The die its face sent back for a reroll goes too: thrown again, the die stands on its new face.
    if (head.rerolledInto !== undefined) {
      this.withdraw(head.rerolledInto, removed);
      delete head.rerolledInto;
      const headId = line.ones ? (line.pair as number) : id;
      const state = this.states.find((candidate) => candidate.id === headId);
      if (state) delete state.rerolled;
    }
    return removed;
  }

  /** The dice the thrower still has to throw: dice laid on the table, caught dice and explosions. */
  pendingThrows(): { id: number; die: DieType; reason: ThrowReason; color?: string }[] {
    const pending: { id: number; die: DieType; reason: ThrowReason; color?: string }[] = [];
    for (const state of this.states) {
      const awaiting = this.lines.get(state.id)?.awaiting;
      const reason = state.status === 'caught' ? 'caught' : awaiting ?? (state.status === 'waiting' ? 'placed' : undefined);
      if (reason) pending.push({ id: state.id, die: state.die, reason, ...(state.color !== undefined ? { color: state.color } : {}) });
    }
    return pending;
  }

  /** What to tell the thrower: caught dice first, then explosions to throw, then dice to throw; null when nothing waits. */
  prompt(): string | null {
    const caught = this.states.filter((state) => state.status === 'caught').map((state) => ({ type: state.die }));
    if (caught.length > 0) return caughtMessage(caught);
    const explosions = this.states
      .filter((state) => ['explode-up', 'explode-down'].includes(this.lines.get(state.id)?.awaiting ?? '') && !this.lines.get(state.id)?.ones)
      .map((state) => `${state.die} exploded: throw another ${state.die}`);
    const rerolls = this.states
      .filter((state) => this.lines.get(state.id)?.awaiting === 'reroll' && !this.lines.get(state.id)?.ones)
      .map((state) => `${state.die} rerolled: throw another ${state.die}`);
    if (explosions.length > 0 || rerolls.length > 0) return [...rerolls, ...explosions].join('\n');
    return this.states.some((state) => state.status === 'waiting') ? THROW_PROMPT : null;
  }

  /** The roll once every die has settled and every explosion is thrown; null until then. The die set aside stays, marked dropped. */
  result(): { rolls: RolledDie[]; modifier: number; total: number; crit?: 'success' | 'failure'; successes?: number; label?: string } | null {
    if (this.states.some((state) => state.status !== 'settled' || this.lines.get(state.id)?.awaiting)) return null;
    const dropped = this.droppedRoots();
    const rolls: RolledDie[] = [];
    // As Atlas lists them: a die thrown again is followed at once by the die that replaced it.
    const ordered: DieState[] = [];
    for (const state of this.states) {
      if ((this.lines.get(state.id) as DieLine).rerollDepth > 0) continue;
      ordered.push(state);
      for (let next = this.lines.get(state.id)?.rerolledInto; next !== undefined; next = this.lines.get(next)?.rerolledInto) {
        const replacement = this.states.find((candidate) => candidate.id === next);
        if (replacement) ordered.push(replacement);
      }
    }
    for (const state of ordered) {
      const line = this.lines.get(state.id) as DieLine;
      if (line.ones) continue;
      // A die set aside earns no explosion (Atlas explodes kept dice only): what its explosions threw leaves the roll.
      if (dropped.has(line.root) && line.fromExplosion) continue;
      const face = this.unitValue(state.id) as number;
      const value = state.fate ? FATE_FACES[face - 1] : face;
      const rerolled = state.rerolled === true;
      rolls.push({
        die: state.die,
        value,
        max: state.fate ? 1 : DIE_FACES[state.die],
        ...(state.fate ? { fate: true } : {}),
        ...(state.label !== undefined ? { label: state.label } : {}),
        ...(state.exploded ? { exploded: true } : {}),
        ...(state.negative ? { negative: true } : {}),
        ...(state.color !== undefined ? { color: state.color } : {}),
        ...(rerolled ? { rerolled: true } : {}),
        ...(dropped.has(line.root) && !rerolled ? { dropped: true } : {}),
      });
    }
    // A success count replaces the sum: its total is the successes (the modifier is added), and it has no critical.
    const successes = this.request.success ? successCount(this.request.success, rolls) : undefined;
    const crit = successes === undefined ? critOf(this.rules, rolls) : undefined;
    return {
      rolls,
      modifier: this.modifier,
      total: successes === undefined ? total(rolls, this.modifier) : successes + this.modifier,
      ...(crit ? { crit } : {}),
      ...(successes !== undefined ? { successes } : {}),
      ...(this.request.label !== undefined ? { label: this.request.label } : {}),
    };
  }

  /** Adds a die (a d100 with its ones d10) and returns its id. */
  private addDie(die: DieType, from: { isDefault: boolean; color?: string; label?: string; fate?: true; parent?: DieState; up?: boolean; negative?: true; replaces?: DieState }): number {
    const parentLine = from.parent ? this.lines.get(from.parent.id) : from.replaces ? this.lines.get(from.replaces.id) : undefined;
    const make = (type: DieType, ones: boolean): DieState => {
      const state: DieState = { id: this.nextId++, die: type, status: 'waiting', isDefault: from.isDefault };
      if (from.color !== undefined) state.color = from.color;
      if (from.label !== undefined) state.label = from.label;
      if (from.fate) state.fate = true;
      if (from.negative) state.negative = true;
      if (from.replaces?.negative) state.negative = true;
      if (from.parent) {
        state.exploded = true;
        // Up adds as the die it came from does; down always subtracts.
        if (!from.up || from.parent.negative) state.negative = true;
      }
      this.states.push(state);
      this.lines.set(state.id, {
        root: parentLine?.root ?? state.id,
        defaultLine: parentLine?.defaultLine ?? from.isDefault,
        fromExplosion: from.parent !== undefined,
        rerollDepth: from.replaces ? (parentLine?.rerollDepth ?? 0) + 1 : 0,
        ...(ones ? { ones: true } : {}),
        ...(from.parent ? { awaiting: from.up ? 'explode-up' : 'explode-down' } : from.replaces ? { awaiting: 'reroll' } : {}),
      });
      return state;
    };
    const head = make(die, false);
    if (die === 'd100') {
      const ones = make('d10', true);
      (this.lines.get(head.id) as DieLine).pair = ones.id;
      const onesLine = this.lines.get(ones.id) as DieLine;
      onesLine.pair = head.id;
      onesLine.root = (this.lines.get(head.id) as DieLine).root;
    }
    return head.id;
  }

  /** The number a face means on this die, or null when the die cannot show it. */
  private faceValue(die: DieType, line: DieLine, face: number | null): number | null {
    if (face === null || !Number.isInteger(face)) return null;
    if (line.ones) return face === 10 ? 0 : face >= 0 && face <= 9 ? face : null;
    if (die === 'd100') return face >= 0 && face <= 90 && face % 10 === 0 ? face : null;
    if (die === 'd10' && face === 0) return 10;
    return face >= 1 && face <= DIE_FACES[die] ? face : null;
  }

  /** A die's value in the roll: a d100's is its tens and ones together, 00 and 0 being 100. Null until it has one. */
  private unitValue(id: number): number | null {
    const state = this.states.find((candidate) => candidate.id === id);
    if (!state || state.status !== 'settled' || state.value === undefined) return null;
    if (state.die !== 'd100') return state.value;
    const ones = this.states.find((candidate) => candidate.id === this.lines.get(id)?.pair);
    if (!ones || ones.status !== 'settled' || ones.value === undefined) return null;
    return state.value + ones.value || 100;
  }

  /** Dice in the roll as Atlas counts them: a d100 pair is one. */
  private rollCount(): number {
    return this.states.filter((state) => !this.lines.get(state.id)?.ones).length;
  }

  /** The value a die's slot stands on: its own, or the last die thrown to replace it under a reroll rule. */
  private slotValue(id: number): number | null {
    let current = id;
    for (let next = this.lines.get(current)?.rerolledInto; next !== undefined; next = this.lines.get(current)?.rerolledInto) current = next;
    return this.unitValue(current);
  }

  /**
   * Marks the die rerolled and lays its replacement when the reroll rule of its kind asks for another throw, the slot
   * has throws left and the roll has room. Returns whether it did (the die then earns no explosion).
   */
  private rerollIfDue(id: number): boolean {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    const rule = state ? this.request.reroll?.[state.die] : undefined;
    const value = this.unitValue(id);
    // An explosion's die stands as thrown: rerolls are for the dice of the request.
    if (!state || !line || !rule || value === null || line.fromExplosion || line.rerollDepth >= rule.limit || this.rollCount() >= MAX_DICE) return false;
    if (!isSuccess({ die: state.die, op: rule.op, target: rule.value }, value)) return false;
    state.rerolled = true;
    line.rerolledInto = this.addDie(state.die, { isDefault: state.isDefault, color: state.color, ...(state.label !== undefined ? { label: state.label } : {}), replaces: state });
    return true;
  }

  /** Adds the die an explosion asks for, once the die has its value, while the roll has room for it. */
  private explode(id: number): void {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    const value = this.unitValue(id);
    if (!state || !line || value === null || this.rollCount() >= MAX_DICE) return;
    const direction = explosion(this.rules, state.die, value, line.defaultLine, line.fromExplosion);
    if (direction) line.explodedInto = this.addDie(state.die, { isDefault: false, color: state.color, ...(state.label !== undefined ? { label: state.label } : {}), parent: state, up: direction === 'up' });
  }

  /** Takes an explosion's die (a d100 with its ones die) out of the roll, and the explosions it earned in turn. */
  private withdraw(id: number, removed: number[]): void {
    const line = this.lines.get(id);
    if (!line) return;
    for (const gone of line.pair === undefined ? [id] : [id, line.pair]) {
      this.lines.delete(gone);
      const index = this.states.findIndex((state) => state.id === gone);
      if (index >= 0) this.states.splice(index, 1);
      removed.push(gone);
    }
    if (line.explodedInto !== undefined) this.withdraw(line.explodedInto, removed);
    if (line.rerolledInto !== undefined) this.withdraw(line.rerolledInto, removed);
  }

  /**
   * The dice the finished roll sets aside, for the table to show: those a keep rule or advantage dropped (with their
   * explosions) and those thrown again under a reroll rule. Nothing while the roll is not complete.
   */
  setAside(): number[] {
    if (this.result() === null) return [];
    const dropped = this.droppedRoots();
    return this.states.filter((state) => state.rerolled === true || dropped.has(this.lines.get(state.id)?.root ?? -1)).map((state) => state.id);
  }

  /** The roots of the dice set aside (with their explosions): by advantage or disadvantage, and by keep rules. */
  private droppedRoots(): Set<number> {
    const gone = new Set<number>();
    const edge = this.droppedRoot();
    if (edge !== null) gone.add(edge);
    for (const [die, rule] of Object.entries(this.request.keep ?? {}) as Array<[DieType, KeepRule]>) {
      const roots = this.states
        .filter((state) => state.die === die && !state.fate && this.lines.get(state.id)?.root === state.id && !this.lines.get(state.id)?.ones && !gone.has(state.id))
        .map((state) => ({ id: state.id, value: this.slotValue(state.id) as number }));
      for (const id of keepDropped(rule, roots)) gone.add(id);
    }
    return gone;
  }

  /** The root of the die advantage or disadvantage sets aside (with its explosions); null without one. */
  private droppedRoot(): number | null {
    if (!this.advantaged) return null;
    const [first, second] = this.advantaged;
    const a = this.slotValue(first) as number;
    const b = this.slotValue(second) as number;
    // Advantage keeps the highest, disadvantage the lowest: the other way round where a low roll is the good one.
    const highest = (this.request.advantage === 'advantage') !== (this.rules.crit === 'roll-under');
    const keepFirst = highest ? a >= b : a <= b;
    return keepFirst ? second : first;
  }
}
