/**
 * One physical roll from throw to result: which dice are in the air, settled or caught on an edge, which explosions
 * still have to be thrown, and the result once every die has a number. A die never gets a number it did not show.
 * Pure: the dice table reports what each die reads, the session decides what the roll is.
 */
import { caughtMessage } from './kit/caught';
import { DIE_FACES, DIE_TYPES, type DieType, type FaceReading } from './kit/faces';
import { critOf, defaultDie, explosion, MAX_DICE, total, type DiceRules, type RolledDie, type RollRequest } from './rollRules';

export type DieState = {
  id: number;
  die: DieType;
  color?: string;
  status: 'rolling' | 'settled' | 'caught';
  value?: number;
  exploded?: true;
  negative?: true;
  isDefault: boolean;
};

type ThrowReason = 'caught' | 'explode-up' | 'explode-down';

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
  /** An explosion not yet thrown. */
  awaiting?: 'explode-up' | 'explode-down';
  /** The die this one's explosion added. */
  explodedInto?: number;
}

export class RollSession {
  private readonly states: DieState[] = [];
  private readonly lines = new Map<number, DieLine>();
  private readonly defaultType: DieType | null;
  private readonly advantaged: [number, number] | null = null;
  private nextId = 1;

  constructor(private readonly request: RollRequest, private readonly rules: DiceRules) {
    this.defaultType = defaultDie(rules);
    for (const die of DIE_TYPES) {
      const count = request.dice[die] ?? 0;
      for (let i = 0; i < count; i++) this.addDie(die, { isDefault: die === this.defaultType, color: request.colors?.[die] });
    }
    const defaults = this.states.filter((state) => state.isDefault && !this.lines.get(state.id)?.ones);
    if (request.advantage && defaults.length === 1 && this.rollCount() < MAX_DICE) {
      const second = this.addDie(defaults[0].die, { isDefault: true, color: defaults[0].color });
      this.advantaged = [defaults[0].id, second];
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
    this.explode(line.ones ? (line.pair as number) : id);
  }

  /** The die is being thrown again: a caught die, or an explosion not yet thrown. */
  reroll(id: number): void {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    if (!state || !line || (state.status !== 'caught' && !line.awaiting)) return;
    delete line.awaiting;
    state.status = 'rolling';
    delete state.value;
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
    if (!state || !line || state.status === 'rolling') return [];
    state.status = 'rolling';
    delete state.value;
    const head = this.lines.get(line.ones ? (line.pair as number) : id) as DieLine;
    const removed: number[] = [];
    if (head.explodedInto !== undefined) this.withdraw(head.explodedInto, removed);
    delete head.explodedInto;
    return removed;
  }

  /** The dice the thrower still has to throw: caught dice and explosions. */
  pendingThrows(): { id: number; die: DieType; reason: ThrowReason; color?: string }[] {
    const pending: { id: number; die: DieType; reason: ThrowReason; color?: string }[] = [];
    for (const state of this.states) {
      const reason = state.status === 'caught' ? 'caught' : this.lines.get(state.id)?.awaiting;
      if (reason) pending.push({ id: state.id, die: state.die, reason, ...(state.color !== undefined ? { color: state.color } : {}) });
    }
    return pending;
  }

  /** What to tell the thrower: caught dice first, then explosions to throw; null when nothing waits on them. */
  prompt(): string | null {
    const caught = this.states.filter((state) => state.status === 'caught').map((state) => ({ type: state.die }));
    if (caught.length > 0) return caughtMessage(caught);
    const explosions = this.states
      .filter((state) => this.lines.get(state.id)?.awaiting && !this.lines.get(state.id)?.ones)
      .map((state) => `${state.die} exploded: throw another ${state.die}`);
    return explosions.length > 0 ? explosions.join('\n') : null;
  }

  /** The roll once every die has settled and every explosion is thrown; null until then. */
  result(): { rolls: RolledDie[]; modifier: number; total: number; crit?: 'success' | 'failure'; label?: string } | null {
    if (this.states.some((state) => state.status !== 'settled' || this.lines.get(state.id)?.awaiting)) return null;
    const dropped = this.droppedRoot();
    const rolls: RolledDie[] = [];
    for (const state of this.states) {
      const line = this.lines.get(state.id) as DieLine;
      if (line.ones) continue;
      const value = this.unitValue(state.id) as number;
      rolls.push({
        die: state.die,
        value,
        max: DIE_FACES[state.die],
        ...(state.exploded ? { exploded: true } : {}),
        ...(state.negative ? { negative: true } : {}),
        ...(state.color !== undefined ? { color: state.color } : {}),
        ...(dropped !== null && line.root === dropped ? { dropped: true } : {}),
      });
    }
    const crit = critOf(this.rules, rolls);
    return {
      rolls,
      modifier: this.request.modifier,
      total: total(rolls, this.request.modifier),
      ...(crit ? { crit } : {}),
      ...(this.request.label !== undefined ? { label: this.request.label } : {}),
    };
  }

  /** Adds a die (a d100 with its ones d10) and returns its id. */
  private addDie(die: DieType, from: { isDefault: boolean; color?: string; parent?: DieState; up?: boolean }): number {
    const parentLine = from.parent ? this.lines.get(from.parent.id) : undefined;
    const make = (type: DieType, ones: boolean): DieState => {
      const state: DieState = { id: this.nextId++, die: type, status: 'rolling', isDefault: from.isDefault };
      if (from.color !== undefined) state.color = from.color;
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
        ...(ones ? { ones: true } : {}),
        ...(from.parent ? { awaiting: from.up ? 'explode-up' : 'explode-down' } : {}),
      } as DieLine);
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

  /** Adds the die an explosion asks for, once the die has its value, while the roll has room for it. */
  private explode(id: number): void {
    const state = this.states.find((candidate) => candidate.id === id);
    const line = this.lines.get(id);
    const value = this.unitValue(id);
    if (!state || !line || value === null || this.rollCount() >= MAX_DICE) return;
    const direction = explosion(this.rules, state.die, value, line.defaultLine, line.fromExplosion);
    if (direction) line.explodedInto = this.addDie(state.die, { isDefault: false, color: state.color, parent: state, up: direction === 'up' });
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
  }

  /** The root of the die advantage or disadvantage sets aside (with its explosions); null without one. */
  private droppedRoot(): number | null {
    if (!this.advantaged) return null;
    const [first, second] = this.advantaged;
    const a = this.unitValue(first) as number;
    const b = this.unitValue(second) as number;
    const keepFirst = this.request.advantage === 'advantage' ? a >= b : a <= b;
    return keepFirst ? second : first;
  }
}
