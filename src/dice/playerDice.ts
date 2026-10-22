/**
 * A Connect player's dice on their 3D board: the throw Connect asks for, thrown into the player's own dice table, the
 * roll's lifetime (`DiceController`, with the rules the GM offered), and the finished roll handed back to Connect, which
 * sends it to the GM. The roll waits on any die caught on an edge, and on explosions, until the player throws them;
 * only clean readings are sent. No three and no DOM: the player board makes the table and draws the prompt.
 */
import type { PlayerDiceRequest, PlayerDiceResult, PlayerDiceSheet } from '../connectContract';
import { DiceController, type DiceControllerDeps } from './diceController';
import { DIE_TYPES } from './kit/faces';
import { DEFAULT_RULES, MAX_DICE, type DiceRules } from './rollRules';
import type { RollSession } from './rollSession';
import { GENTLE, type Flick } from './throwInput';

/** A dice table the board made with the pack and settings as they were then. */
export interface PlayerDiceTable {
  table: DiceControllerDeps['table'];
  /** The pack or the dice settings changed since: the next throw makes another table. */
  outdated(): boolean;
  /** The table and its textures go. */
  dispose(): void;
}

export interface PlayerDiceDeps {
  /** Connect's side: where the roll goes, and the rules of the player's map as the GM offered them. */
  host: { sendDiceResult?(result: PlayerDiceResult): boolean; diceRules?(): DiceRules | null };
  makeTable(): PlayerDiceTable;
  /** What the roll waits on; `notice`: a message with nothing to throw. Null clears it. */
  prompt(text: string | null, notice?: boolean): void;
}

const NOT_SENT = "Couldn't send the roll to the GM.";

export class PlayerDice {
  private made: PlayerDiceTable | null = null;
  private controller: DiceController | null = null;
  /** The sheet roll the roll in play was thrown for, handed back with its result. */
  private sheet: PlayerDiceSheet | null = null;
  /** The last roll could not be sent: said until the next throw. */
  private notice: string | null = null;
  private disposed = false;

  constructor(private readonly deps: PlayerDiceDeps) {}

  /** Throws `request` (a roll still settling is dropped, unsent); false when there are no dice or the roll is not one. */
  throw(request: PlayerDiceRequest): boolean {
    if (this.disposed || !this.deps.host.sendDiceResult || !throwable(request)) return false;
    const { sheet, ...roll } = request;
    // The notice goes first: a table made again clears the line, and must not show it again.
    this.notice = null;
    const controller = this.ensureTable();
    this.sheet = sheet ?? null;
    // Connect asks for a throw without a flick of its own: the dice are tossed gently.
    controller.start(roll, GENTLE);
    return true;
  }

  /** Whether the roll waits on this die being thrown again (caught on an edge). */
  waitsOn(id: number): boolean {
    return this.controller?.waitsOn(id) ?? false;
  }

  /**
   * The player pressed on a die the roll waits on: the throw once it is let go, into this roll only (a new throw, scene
   * or table meanwhile throws nothing). Null when the roll does not wait on it.
   */
  pickUp(id: number): ((flick: Flick) => void) | null {
    return this.controller?.pickUp(id) ?? null;
  }

  /** Throws every die the roll waits on: caught dice, and explosions (which have no die to click). */
  throwPending(flick: Flick = GENTLE): void {
    this.controller?.throwPending(flick);
  }

  /** The board shows another scene, or none: the dice go and the roll in play is never sent. */
  sceneChanged(): void {
    this.sheet = null;
    this.notice = null;
    this.controller?.sceneChanged();
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
      // The controller clears the line once the roll is published: a notice about it stays.
      prompt: (text) => this.deps.prompt(text ?? this.notice, text === null && this.notice !== null),
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

  /** The finished roll to Connect, once; a roll it cannot send is said so, not sent again. */
  private publish(result: NonNullable<ReturnType<RollSession['result']>>): void {
    const sheet = this.sheet;
    this.sheet = null;
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
