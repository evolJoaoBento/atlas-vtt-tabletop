/**
 * A roll's lifetime on the thrower's board: its dice laid on the table, each picked up and thrown by the thrower (or
 * all thrown together), read die by die, the thrower asked to throw again whatever was caught on an edge or exploded,
 * and the roll published each time every die has its number. Any die at rest may be thrown again; the roll is then
 * published again once it lands. No three: it drives the table and a roll session.
 */
import type { DiceTable } from './diceTable';
import type { DiceRules, RollRequest } from './rollRules';
import { RollSession } from './rollSession';
import type { Flick } from './throwInput';

export interface DiceControllerDeps {
  table: Pick<DiceTable, 'placeRoll' | 'placeMissing' | 'throwDie' | 'remove' | 'clear' | 'busy'> & { onSettled: DiceTable['onSettled']; onLoosened: DiceTable['onLoosened']; mark?: DiceTable['mark'] };
  /** The rules of the map the roll is for, asked at each new roll. */
  rules: () => DiceRules;
  publish: (result: NonNullable<ReturnType<RollSession['result']>>) => void;
  /** What to tell the thrower (dice to throw, caught dice, explosions); null clears it. */
  prompt: (text: string | null) => void;
}

/** A die the thrower picked up: carried under the pointer, then thrown (with every die still waiting, for `all`). */
export interface DieGrab {
  id: number;
  release(flick: Flick, all?: boolean): void;
}

export class DiceController {
  /** The roll on the table; none once it is cleared or dropped, so a die read late changes nothing. */
  private session: RollSession | null = null;
  /** Whether the roll as it lies now was published: a throw makes it new. */
  private published = false;

  constructor(private readonly deps: DiceControllerDeps) {
    deps.table.onSettled = (id, reading) => {
      const session = this.session;
      if (!session) return;
      session.settle(id, reading);
      // An explosion's die is laid on the table, to be thrown like the rest.
      deps.table.placeMissing();
      this.markWaiting(session);
      const result = session.result();
      if (!result || this.published) {
        deps.prompt(session.prompt());
        return;
      }
      this.published = true;
      try {
        deps.publish(result);
      } finally {
        deps.prompt(null);
      }
    };
    // A die knocked loose is read again where it lands, and the roll waits for it; the explosion it had earned goes.
    deps.table.onLoosened = (id) => {
      const session = this.session;
      if (!session) return;
      for (const gone of session.loosen(id)) deps.table.remove(gone);
      this.published = false;
      this.markWaiting(session);
      deps.prompt(session.prompt());
    };
  }

  /** The line round every die the roll waits on being thrown. */
  private markWaiting(session: RollSession): void {
    this.deps.table.mark?.(session.pendingThrows().map((pending) => pending.id));
  }

  /** A new roll, its dice laid on the table to be thrown; a roll still on the table goes, as it is. */
  start(request: RollRequest): void {
    const session = new RollSession(request, this.deps.rules());
    this.session = session;
    this.published = false;
    this.deps.table.placeRoll(session);
    this.markWaiting(session);
    this.deps.prompt(session.prompt());
  }

  /** Throws every die the roll waits on, together: dice laid on the table, caught dice, and explosions. */
  throwPending(flick: Flick): void {
    const session = this.session;
    if (!session) return;
    const pending = session.pendingThrows();
    pending.forEach((die, index) => {
      // A throw can knock a die loose and take back its explosion: what is no longer pending is not thrown.
      if (this.session !== session || !session.pendingThrows().some((still) => still.id === die.id)) return;
      this.throwOne(session, die.id, flick, index, pending.length);
    });
    this.deps.prompt(session.prompt());
  }

  /** Whether the roll waits on this die being thrown (laid, caught, an explosion). */
  waitsOn(id: number): boolean {
    return this.session?.pendingThrows().some((pending) => pending.id === id) ?? false;
  }

  /** Whether the roll waits on a throw. */
  get waiting(): boolean {
    return (this.session?.pendingThrows().length ?? 0) > 0;
  }

  /** The thrower threw a die at rest (laid, caught, or read: thrown again). */
  clickDie(id: number, flick: Flick): void {
    const session = this.session;
    if (!session || !this.atRest(session, id)) return;
    this.throwOne(session, id, flick, 0, 1);
    this.deps.prompt(session.prompt());
  }

  /**
   * The thrower pressed on a die of the roll at rest: the grab that carries and throws it. It throws only into this
   * roll, so a press that spans a new roll (whose dice may have the same ids) or the roll's end throws nothing. Null for
   * a die in the air, or no roll.
   */
  pickUp(id: number): DieGrab | null {
    const session = this.session;
    if (!session || !this.atRest(session, id)) return null;
    return {
      id,
      release: (flick, all = false) => {
        if (this.session !== session) return;
        if (!all) {
          this.clickDie(id, flick);
          return;
        }
        // The die in hand first, then the dice still waiting, beside it.
        const others = session.pendingThrows().filter((pending) => pending.id !== id);
        this.throwOne(session, id, flick, 0, others.length + 1);
        others.forEach((pending, index) => {
          if (this.session === session && session.pendingThrows().some((still) => still.id === pending.id)) this.throwOne(session, pending.id, flick, index + 1, others.length + 1);
        });
        this.deps.prompt(session.prompt());
      },
    };
  }

  /** The thrower cleared the table: the dice go, and a roll not yet complete is never published. */
  clear(): void {
    this.drop();
  }

  /** The board shows another scene: the roll goes, unpublished. */
  sceneChanged(): void {
    this.drop();
  }

  dispose(): void {
    this.drop();
    this.deps.table.onSettled = () => {};
    this.deps.table.onLoosened = () => {};
  }

  private atRest(session: RollSession, id: number): boolean {
    const state = session.dice.find((die) => die.id === id);
    return state !== undefined && state.status !== 'rolling';
  }

  private throwOne(session: RollSession, id: number, flick: Flick, index: number, count: number): void {
    // Marked thrown first: it is no longer pending, so a second throw of the pending dice leaves it be. A die thrown
    // again loses the explosion its old face earned.
    for (const gone of session.reroll(id)) this.deps.table.remove(gone);
    this.published = false;
    this.deps.table.throwDie(id, flick, index, count);
    this.markWaiting(session);
  }

  private drop(): void {
    this.session = null;
    this.published = false;
    this.deps.table.clear();
    this.deps.prompt(null);
  }
}
