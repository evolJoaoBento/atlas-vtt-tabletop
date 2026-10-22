/**
 * The GM's dice on a board: the toolbar's Dice button and its picker, the dice table they throw into, the roll's
 * lifetime (`DiceController`), the line over the board telling the GM what the roll waits on, and the finished roll
 * handed to Atlas's roll log on the map view the roll belongs to. A die the roll waits on (caught on an edge) is thrown
 * again with a click or a flick on it. The selected token's stat sheet opens from the toolbar too (`SheetDrawer`); its
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
import { DicePrompt } from './dicePrompt';
import type { TabletopDiceSettings } from './diceSettings';
import { DiceTable } from './diceTable';
import { DiceTextures } from './diceTextures';
import { listenForDiePresses } from './diePress';
import { parseFormula, type RollRequest } from './rollRules';
import { GENTLE, type Flick } from './throwInput';

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

  constructor(private readonly deps: BoardDiceDeps) {
    const { board, container } = deps;
    const doc = container.ownerDocument;
    // The button is drawn before the picker exists: until then the picker is closed.
    const anchor = board.diceButton({
      isOpen: () => this.picker?.isOpen === true,
      toggle: () => (this.picker.isOpen ? this.picker.close() : this.picker.open()),
      close: () => this.picker.close(),
    });
    this.picker = new DicePicker(anchor ?? container, {
      onRoll: (request, flick) => this.roll(request, flick),
      onClear: () => this.controller?.sceneChanged(),
      colors: () => deps.settings().colors,
      rules: () => this.rules(),
      onOpenChange: () => board.refreshToolbar(),
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
    this.prompt = new DicePrompt(container, () => this.controller?.throwPending(GENTLE));
    // A press on a die the roll waits on: let go, it is thrown again, into the roll and table it was pressed in.
    this.stops.push(listenForDiePresses({
      container,
      canvas: () => board.canvas,
      pickUp: (x, y) => {
        const controller = this.controller;
        const id = controller ? board.diceAt(x, y) : null;
        const release = controller && id !== null ? controller.pickUp(id) : null;
        // A new table meanwhile (the settings changed) has a controller of its own: the press throws nothing.
        return release && ((flick) => { if (this.controller === controller) release(flick); });
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
    this.controller?.sceneChanged();
    this.rollFrom = null;
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
    this.rollFrom = { abilityName: label, tokenId };
    controller.start({ ...parsed, label, ...(advantage ? { advantage } : {}) }, GENTLE);
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

  /** A roll from the picker: the picker steps aside so the GM sees the dice land (they land where the camera looks). */
  private roll(request: RollRequest, flick: Flick): void {
    if (this.disposed) return;
    this.picker.close();
    const controller = this.ensureTable();
    this.rollFrom = null;
    controller.start(request, flick);
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
    const from = this.rollFrom ?? undefined;
    this.rollFrom = null;
    if (!publishRoll(this.deps.atlasView(), stockRoll({ ...result, rolls }, undefined, from))) {
      this.deps.warn('Tabletop: open this map in Atlas to log dice rolls in its roll log.');
    }
  }

  private showPrompt(text: string | null): void {
    this.prompt.show(text);
  }
}
