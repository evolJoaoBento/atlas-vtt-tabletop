/**
 * A Connect player's dice on their 3D board: the roll Connect asks for, its dice laid on the player's own dice table
 * for the player to pick up and throw, the roll's lifetime (`DiceController`, with the rules the GM offered), and the
 * finished roll handed back to Connect, which sends it to the GM (again each time a die is thrown again). The roll waits
 * on any die caught on an edge, and on explosions, until the player throws them; only clean readings are sent. No three
 * and no DOM: the player board makes the table and draws the prompt.
 */
import type { PlayerDiceRequest, PlayerDiceResult, PlayerDiceSheet } from '../connectContract';
import { DiceController, type DiceControllerDeps } from './diceController';
import type { PressedDie } from './diePress';
import { DIE_TYPES } from './kit/faces';
import { DEFAULT_RULES, MAX_DICE, type DiceRules } from './rollRules';
import type { RollSession } from './rollSession';
import { GENTLE, type Flick } from './throwInput';

/** A dice table the board made with the pack and settings as they were then. */
export interface PlayerDiceTable {
  table: DiceControllerDeps['table'];
  /** Carries a die under the pointer. */
  hold(id: number, clientX: number, clientY: number): void;
  /** The pack or the dice settings changed since: the next throw makes another table. */
  outdated(): boolean;
  /** The table and its textures go. */
  dispose(): void;
}

export interface PlayerDiceDeps {
  /** Connect's side: where the roll goes, and the rules of the player's map as the GM offered them. */
  host: { sendDiceResult?(result: PlayerDiceResult): boolean; diceRules?(): DiceRules | null };
  makeTable(): PlayerDiceTable;
  /**
   * What the roll waits on; `notice`: a message with nothing to throw, that goes by itself; `result`: what the roll
   * came to, staying while its dice lie on the table. Null clears it.
   */
  prompt(text: string | null, kind?: 'notice' | 'result'): void;
}

const NOT_SENT = "Couldn't send the roll to the GM.";

export class PlayerDice {
  private made: PlayerDiceTable | null = null;
  private controller: DiceController | null = null;
  /** The sheet roll the roll in play was thrown for, handed back with its result. */
  private sheet: PlayerDiceSheet | null = null;
  /** The last roll could not be sent: said until the next throw. */
  private notice: string | null = null;
  /** What the last roll sent came to: said while its dice lie on the table. */
  private sent: string | null = null;
  private disposed = false;

  constructor(private readonly deps: PlayerDiceDeps) {}

  /** Lays `request`'s dice on the table (a roll still there goes, unsent); false when there are no dice or the roll is not one. */
  throw(request: PlayerDiceRequest): boolean {
    if (this.disposed || !this.deps.host.sendDiceResult || !throwable(request)) return false;
    const { sheet, ...roll } = request;
    // The notice goes first: a table made again clears the line, and must not show it again.
    this.notice = null;
    this.sent = null;
    const controller = this.ensureTable();
    this.sheet = sheet ?? null;
    controller.start(roll);
    return true;
  }

  /** Whether the roll waits on this die being thrown again (caught on an edge). */
  waitsOn(id: number): boolean {
    return this.controller?.waitsOn(id) ?? false;
  }

  /**
   * The player pressed on a die at rest: carried under the pointer, thrown once it is let go, into this roll only (a
   * new roll, scene or table meanwhile throws nothing). Null for a die in the air.
   */
  pickUp(id: number): PressedDie | null {
    const controller = this.controller;
    const made = this.made;
    const grab = controller?.pickUp(id) ?? null;
    if (!grab || !made) return null;
    return {
      move: (clientX, clientY) => { if (this.controller === controller) made.hold(id, clientX, clientY); },
      release: (flick, all) => { if (this.controller === controller) grab.release(flick, all); },
    };
  }

  /** Throws every die the roll waits on, together: dice laid on the table, caught dice, and explosions. */
  throwPending(flick: Flick = GENTLE): void {
    this.controller?.throwPending(flick);
  }

  /** The board shows another scene, or none: the dice go and the roll in play is never sent. */
  sceneChanged(): void {
    this.sheet = null;
    this.notice = null;
    this.sent = null;
    this.controller?.sceneChanged();
  }

  /** The player cleared the table: the dice go, and a roll not yet complete is never sent. */
  clear(): void {
    this.sheet = null;
    this.notice = null;
    this.sent = null;
    if (this.controller) this.controller.clear();
    else this.deps.prompt(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
  }

  private ensureTable(): DiceController {
    if (this.made?.outdated()) this.teardown();
    if (this.controller) return this.controller;
    const made = this.deps.makeTable();
    this.made = made;
    this.controller = new DiceController({
      table: made.table,
      rules: () => this.deps.host.diceRules?.() ?? DEFAULT_RULES,
      publish: (result) => this.publish(result),
      // The controller clears the line once the roll is published: a notice about it, or what it came to, shows then.
      prompt: (text) => {
        if (text !== null) this.deps.prompt(text);
        else if (this.notice !== null) this.deps.prompt(this.notice, 'notice');
        else if (this.sent !== null) this.deps.prompt(this.sent, 'result');
        else this.deps.prompt(null);
      },
    });
    return this.controller;
  }

  private teardown(): void {
    this.sheet = null;
    this.controller?.dispose();
    this.controller = null;
    this.made?.dispose();
    this.made = null;
    this.deps.prompt(null);
  }

  /**
   * The finished roll to Connect; a roll it cannot send is said so, not sent again. A die thrown again makes the roll
   * new: it is sent again once it lands, for the same sheet roll.
   */
  private publish(result: NonNullable<ReturnType<RollSession['result']>>): void {
    const sheet = this.sheet;
    const out: PlayerDiceResult = {
      rolls: result.rolls,
      modifier: result.modifier,
      ...(result.label !== undefined ? { label: result.label } : {}),
      ...(sheet ? { sheet } : {}),
    };
    let sent = false;
    try {
      sent = this.deps.host.sendDiceResult?.(out) === true;
    } catch (error) {
      console.error('[Tabletop] Connect could not send the roll:', error);
    }
    if (!sent) this.notice = NOT_SENT;
    else this.sent = `Sent to the GM: ${result.total} · drag a die to throw it again`;
  }
}

/** One to 20 dice of the known types, each count and the modifier a whole number. */
function throwable(request: PlayerDiceRequest): boolean {
  let count = 0;
  for (const [die, n] of Object.entries(request.dice ?? {})) {
    if (!(DIE_TYPES as readonly string[]).includes(die) || !Number.isInteger(n) || (n as number) < 0) return false;
    count += n as number;
  }
  return count >= 1 && count <= MAX_DICE && Number.isInteger(request.modifier);
}
