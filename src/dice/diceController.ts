/**
 * A roll's lifetime on the thrower's board: thrown into the dice table, read die by die, the thrower asked to throw
 * again whatever was caught on an edge or exploded, and the roll published once, when every die has its number.
 * No three: it drives the table and a roll session.
 */
import type { DiceTable } from './diceTable';
import type { DiceRules, RollRequest } from './rollRules';
import { RollSession } from './rollSession';
import type { Flick } from './throwInput';

export interface DiceControllerDeps {
  table: Pick<DiceTable, 'throwRoll' | 'throwDie' | 'remove' | 'clear' | 'busy'> & { onSettled: DiceTable['onSettled']; onLoosened: DiceTable['onLoosened'] };
  /** The rules of the map the roll is for, asked at each new roll. */
  rules: () => DiceRules;
  publish: (result: NonNullable<ReturnType<RollSession['result']>>) => void;
  /** What to tell the thrower (caught dice, explosions to throw); null clears it. */
  prompt: (text: string | null) => void;
}

export class DiceController {
  /** The roll in play; none once it is published or dropped, so a die read late changes nothing. */
  private session: RollSession | null = null;

  constructor(private readonly deps: DiceControllerDeps) {
    deps.table.onSettled = (id, reading) => {
      const session = this.session;
      if (!session) return;
      session.settle(id, reading);
      const result = session.result();
      if (!result) {
        deps.prompt(session.prompt());
        return;
      }
      this.session = null;
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
      deps.prompt(session.prompt());
    };
  }

  /** A new roll, thrown the way the flick went; a roll still in play is dropped. */
  start(request: RollRequest, flick: Flick): void {
    const session = new RollSession(request, this.deps.rules());
    this.session = session;
    this.deps.prompt(null);
    this.deps.table.throwRoll(session, flick);
  }

  /** Throws every die the roll waits on: caught dice again, and explosions. */
  throwPending(flick: Flick): void {
    const session = this.session;
    if (!session) return;
    for (const pending of session.pendingThrows()) {
      // A throw can knock a die loose and take back its explosion: what is no longer pending is not thrown.
      if (this.session !== session || !session.pendingThrows().some((still) => still.id === pending.id)) continue;
      this.throwOne(session, pending.id, flick);
    }
    this.deps.prompt(session.prompt());
  }

  /** Whether the roll waits on this die being thrown (caught on an edge): a click on it throws it. */
  waitsOn(id: number): boolean {
    return this.session?.pendingThrows().some((pending) => pending.id === id) ?? false;
  }

  /** Whether the roll waits on a throw (a caught die, or an explosion to throw). */
  get waiting(): boolean {
    return (this.session?.pendingThrows().length ?? 0) > 0;
  }

  /** The thrower picked up a die: it is thrown again if the roll waits on it; a die with its number stays put. */
  clickDie(id: number, flick: Flick): void {
    const session = this.session;
    if (!session || !session.pendingThrows().some((pending) => pending.id === id)) return;
    this.throwOne(session, id, flick);
    this.deps.prompt(session.prompt());
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

  private throwOne(session: RollSession, id: number, flick: Flick): void {
    // Marked thrown first: it is no longer pending, so a second throw of the pending dice leaves it be.
    session.reroll(id);
    this.deps.table.throwDie(id, flick);
  }

  private drop(): void {
    this.session = null;
    this.deps.table.clear();
    this.deps.prompt(null);
  }
}
