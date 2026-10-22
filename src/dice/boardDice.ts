/**
 * The GM's dice on a board: the toolbar's Dice button and its tray (Atlas's), the dice table its rolls are laid on, the
 * roll's lifetime (`DiceController`), the line over the board telling the GM what the roll waits on (and what it came
 * to), and the finished roll handed to Atlas's roll log on the map view the roll belongs to. A die at rest is picked up
 * with a press, carried under the pointer and thrown when let go (Ctrl: with every die still waiting); thrown again
 * once read, the roll is logged again. The selected token's stat sheet opens from the toolbar too (`SheetDrawer`); its
 * rolls are thrown with the same dice and logged as that token's. The board's tab (and the browser harness) make one
 * per board.
 */
import type { Board } from '../board/board';
import { DiceLogPanel, logEntryOf } from '../board/diceLog';
import { diceRulesOf, onRolled, publishRoll, stockRoll, type MapViewLike, type RollResult } from './atlasDice';
import { DiceController } from './diceController';
import { SheetDrawer } from '../sheets/sheetDrawer';
import type { AdvantageSide, PlayerSheet } from '../sheets/sheet';
import type { ChosenPack } from './dicePack';
import { DicePicker } from './dicePicker';
import { DicePreviews } from './dicePreviews';
import { DicePrompt } from './dicePrompt';
import type { TabletopDiceSettings } from './diceSettings';
import { DiceTable } from './diceTable';
import { DiceTextures } from './diceTextures';
import { listenForDiePresses } from './diePress';
import { DIE_TYPES } from './kit/faces';
import { parseFormula, type RollRequest } from './rollRules';
import { GENTLE } from './throwInput';

export interface BoardDiceDeps {
  board: Board;
  /** The board's root: the prompt line goes over it, and presses on the dice are taken there first. */
  container: HTMLElement;
  /** The board's map. */
  mapPath(): string;
  /** The Atlas map view a roll on the board's map is logged on (`rollViewFor`); null without one. */
  atlasView(): MapViewLike | null;
  settings(): TabletopDiceSettings;
  pack(): ChosenPack;
  /** Shown once per message. */
  warn(message: string): void;
  /** The sheet of a token's stat block; null when it links none or it cannot be read. Without it, no sheet. */
  sheetOf?(tokenId: string): Promise<PlayerSheet | null>;
}

export class BoardDice {
  readonly picker: DicePicker;
  readonly log: DiceLogPanel;
  readonly sheet: SheetDrawer | null = null;
  /** The token whose sheet the drawer shows, and the read of it awaited. */
  private sheetToken: string | null = null;
  private sheetRead = 0;
  /** The statblock ability the roll in play was thrown for; null for the picker's rolls. */
  private rollFrom: { abilityName: string; tokenId: string } | null = null;
  /** The Atlas map view the log listens on, and how to stop. */
  private heard: { view: MapViewLike; stop: () => void } | null = null;
  private table: DiceTable | null = null;
  private textures: DiceTextures | null = null;
  private controller: DiceController | null = null;
  private readonly prompt: DicePrompt;
  private readonly stops: Array<() => void> = [];
  private disposed = false;
  /** The settings or pack changed: the next roll makes a new table. */
  private stale = false;
  /** What the last finished roll came to: shown on the line while its dice lie on the table. */
  private lastResult: string | null = null;
  /** The pictures of the dice on the tray's buttons, and the pack they were drawn with. */
  private readonly previews: DicePreviews;
  private drawnFor: ChosenPack | null = null;

  constructor(private readonly deps: BoardDiceDeps) {
    const { board, container } = deps;
    const doc = container.ownerDocument;
    // The button is drawn before the picker exists: until then the picker is closed.
    const anchor = board.diceButton({
      isOpen: () => this.picker?.isOpen === true,
      toggle: () => (this.picker.isOpen ? this.picker.close() : this.picker.open()),
      close: () => this.picker.close(),
    });
    this.previews = new DicePreviews(doc, () => this.picker?.refreshPictures());
    this.picker = new DicePicker(anchor ?? container, {
      onRoll: (request) => this.roll(request),
      colors: () => deps.settings().colors,
      rules: () => this.rules(),
      picture: (die) => this.previews.url(die),
      onOpenChange: (open) => {
        // The dice's pictures, of the pack chosen now.
        const pack = deps.pack();
        if (open && pack !== this.drawnFor) {
          this.drawnFor = pack;
          this.previews.draw(pack, DIE_TYPES);
        }
        this.prompt?.setCovered(open);
        board.refreshToolbar();
      },
    });
    // The log button beside it; every roll Atlas logs on the map shows in the log and as a card over the board.
    const logAnchor = board.diceLogButton({
      isOpen: () => this.log?.isOpen === true,
      toggle: () => this.log.toggle(),
      close: () => this.log.close(),
    });
    this.log = new DiceLogPanel(logAnchor ?? container, { toastParent: container, onOpenChange: () => board.refreshToolbar() });
    this.listen();
    // The selected token's sheet, after the log; it follows the selection.
    if (deps.sheetOf) {
      const sheetAnchor = board.sheetButton({
        isOpen: () => this.sheet?.isOpen === true,
        toggle: () => this.sheet?.toggle(),
        close: () => this.sheet?.close(),
      });
      if (sheetAnchor) {
        this.sheet = new SheetDrawer(container, {
          onRoll: (formula, label, advantage) => this.sheetRoll(formula, label, advantage),
          onOpenChange: (open) => {
            if (open) this.readSheet();
            board.refreshToolbar();
          },
        });
        this.stops.push(board.onSelect(() => this.readSheet()));
      }
    }
    // What the roll waits on, as a line over the board, and the throw it asks for (an explosion has no die to click).
    this.prompt = new DicePrompt(container, () => this.controller?.throwPending(GENTLE), () => this.clearTable());
    // A press on a die at rest (Ctrl: every die at rest, bundled): carried under the pointer, and thrown when let go,
    // into the roll and table it was pressed in.
    this.stops.push(listenForDiePresses({
      container,
      canvas: () => board.canvas,
      pickUp: (x, y, all) => {
        const controller = this.controller;
        const table = this.table;
        const id = controller ? board.diceAt(x, y) : null;
        const grab = controller && id !== null ? controller.pickUp(id, all) : null;
        if (!grab || !table) return null;
        // Ctrl: every die at rest is gathered round the pointer at once.
        if (all) table.hold(grab.ids, board.rayAt(x, y));
        // A new table meanwhile (the settings changed) has a controller of its own: the press carries and throws nothing.
        return {
          move: (cx, cy) => { if (this.controller === controller) table.hold(grab.ids, board.rayAt(cx, cy)); },
          release: (flick) => { if (this.controller === controller) grab.release(flick); },
        };
      },
    }));
  }

  /** The log hears the Atlas map view that holds the board's map: it follows when that view opens, closes or moves. */
  listen(): void {
    if (this.disposed) return;
    const view = this.deps.atlasView();
    if (view === this.heard?.view) return;
    this.heard?.stop();
    this.heard = null;
    if (!view) return;
    this.heard = {
      view,
      stop: onRolled(view, (roll) => {
        const entry = logEntryOf(roll);
        if (entry) this.log.add(entry);
      }),
    };
  }

  /** The board shows another scene or map, or closes: the dice go, and the roll in play is never logged. */
  sceneChanged(): void {
    this.lastResult = null;
    this.controller?.sceneChanged();
    this.rollFrom = null;
  }

  /** The GM cleared the table: the dice go; a roll not yet complete is never logged. */
  private clearTable(): void {
    this.lastResult = null;
    this.rollFrom = null;
    if (this.controller) this.controller.clear();
    else this.showPrompt(null);
  }

  /** The drawer shows the selected token's sheet, read again (the note may have changed); none while it is closed. */
  private readSheet(): void {
    const sheet = this.sheet;
    if (!sheet || this.disposed) return;
    const tokenId = this.deps.board.selected;
    const read = ++this.sheetRead;
    if (tokenId !== this.sheetToken) {
      this.sheetToken = null;
      sheet.show(null);
    }
    if (tokenId === null || !sheet.isOpen) return;
    void (this.deps.sheetOf?.(tokenId) ?? Promise.resolve(null)).catch(() => null).then((found) => {
      // Another token was selected, or the drawer went, meanwhile: this read is no longer wanted.
      if (read !== this.sheetRead || this.disposed) return;
      this.sheetToken = tokenId;
      sheet.show(found);
    });
  }

  /**
   * A roll from the sheet, thrown gently; a roll still settling is dropped, unpublished, as the picker's Roll does.
   * Logged as the ability of the token whose sheet it is.
   */
  private sheetRoll(formula: string, label: string, advantage?: AdvantageSide): void {
    const tokenId = this.sheetToken;
    if (this.disposed || tokenId === null) return;
    const parsed = parseFormula(formula, this.rules());
    if (!parsed) {
      this.sheet?.notice(`Can't roll ${formula} with physical dice.`);
      return;
    }
    const controller = this.ensureTable();
    this.lastResult = null;
    this.rollFrom = { abilityName: label, tokenId };
    controller.start({ ...parsed, label, ...(advantage ? { advantage } : {}) });
  }

  /**
   * The dice settings or pack changed: the next roll is made with them. The dice on the table, and a roll in play,
   * stay as they are until then.
   */
  reset(): void {
    this.stale = true;
  }

  /** Whether the next roll makes a new table (the settings or pack changed since this one was made). */
  get isStale(): boolean {
    return this.stale;
  }

  /** The table, its roll and its textures go. */
  private teardown(): void {
    this.rollFrom = null;
    this.controller?.dispose();
    this.controller = null;
    this.table?.dispose();
    this.table = null;
    this.textures?.dispose();
    this.textures = null;
    this.showPrompt(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.teardown();
    for (const stop of this.stops) stop();
    this.heard?.stop();
    this.heard = null;
    this.picker.dispose();
    this.previews.dispose();
    this.log.dispose();
    this.sheet?.dispose();
    this.deps.board.diceButton(null);
    this.deps.board.diceLogButton(null);
    this.deps.board.sheetButton(null);
    this.prompt.dispose();
  }

  /** The rules of the board's map, as Atlas has them for its collection. */
  private rules(): ReturnType<typeof diceRulesOf> {
    return diceRulesOf(this.deps.atlasView(), this.deps.mapPath());
  }

  /** A roll from the picker, its dice laid where the camera looks: the picker steps aside so the GM can pick them up. */
  private roll(request: RollRequest): void {
    if (this.disposed) return;
    this.picker.close();
    const controller = this.ensureTable();
    this.rollFrom = null;
    this.lastResult = null;
    controller.start(request);
  }

  /** The table and the roll's controller, made at the first throw, with the pack and settings as they are then. */
  private ensureTable(): DiceController {
    const { board } = this.deps;
    if (this.stale) {
      this.teardown();
      this.stale = false;
    }
    if (this.controller && this.table) {
      board.attachDice(this.table);
      return this.controller;
    }
    const pack = this.deps.pack();
    const textures = new DiceTextures(pack, this.deps.container.ownerDocument, () => board.wake(true));
    const table = new DiceTable({ ...board.diceHost(), pack: () => pack.config, textures: (type, color) => textures.textures(type, color) }, this.deps.settings());
    board.attachDice(table);
    this.textures = textures;
    this.table = table;
    this.controller = new DiceController({
      table,
      rules: () => this.rules(),
      publish: (result) => this.publish(result),
      prompt: (text) => this.showPrompt(text),
    });
    return this.controller;
  }

  /** The finished roll to Atlas's roll log, each die's colour named as the picker names it. */
  private publish(result: RollResult): void {
    const names = new Map(this.deps.settings().colors.map((entry) => [entry.color.toLowerCase(), entry.name]));
    const rolls = result.rolls.map((roll) => {
      const name = roll.color ? names.get(roll.color.toLowerCase()) : undefined;
      return name ? { ...roll, colorName: name } : roll;
    });
    // The ability stays with the roll: thrown again, its dice are still that ability's.
    const from = this.rollFrom ?? undefined;
    const roll = stockRoll({ ...result, rolls }, undefined, from) as { formula: string; total: number };
    const said = `${from ? `${from.abilityName}: ` : ''}${roll.formula} = ${roll.total}`;
    if (publishRoll(this.deps.atlasView(), roll)) {
      this.lastResult = said;
      return;
    }
    // Warned once per message; the total stays on the line, so no result is lost.
    this.deps.warn('Tabletop: open this map in Atlas to log dice rolls in its roll log.');
    this.lastResult = `Not logged (open this map in Atlas): ${said}`;
  }

  /**
   * What the roll waits on. Once the controller clears the line (the roll published), what the roll came to stays on
   * it while its dice lie on the table.
   */
  private showPrompt(text: string | null): void {
    if (text === null && this.lastResult !== null) this.prompt.result(`${this.lastResult} · drag a die to throw it again`);
    else this.prompt.show(text);
  }
}
