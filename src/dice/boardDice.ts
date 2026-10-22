/**
 * The GM's dice on a board: the toolbar's Dice button and its picker, the dice table they throw into, the roll's
 * lifetime (`DiceController`), the line over the board telling the GM what the roll waits on, and the finished roll
 * handed to Atlas's roll log on the map view the roll belongs to. A die the roll waits on (caught on an edge) is thrown
 * again with a click or a flick on it. The board's tab (and the browser harness) make one per board.
 */
import type { Board } from '../board/board';
import { DiceLogPanel, logEntryOf } from '../board/diceLog';
import { diceRulesOf, onRolled, publishRoll, stockRoll, type MapViewLike, type RollResult } from './atlasDice';
import { DiceController } from './diceController';
import type { ChosenPack } from './dicePack';
import { DicePicker } from './dicePicker';
import type { TabletopDiceSettings } from './diceSettings';
import { DiceTable } from './diceTable';
import { DiceTextures } from './diceTextures';
import type { RollRequest } from './rollRules';
import type { Flick } from './throwInput';

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
}

/** A press that moves less than this is a click on a die: it is tossed gently. */
const DRAG_PX = 6;
const FLICK_MS = 100;
const GENTLE: Flick = { dx: 0, dy: 0, ms: 1 };

export class BoardDice {
  readonly picker: DicePicker;
  readonly log: DiceLogPanel;
  /** The Atlas map view the log listens on, and how to stop. */
  private heard: { view: MapViewLike; stop: () => void } | null = null;
  private table: DiceTable | null = null;
  private textures: DiceTextures | null = null;
  private controller: DiceController | null = null;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
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
    // What the roll waits on, as a line over the board, and the throw it asks for (an explosion has no die to click).
    this.prompt = doc.createElement('div');
    this.prompt.className = 'atlas-tabletop-dice-prompt';
    this.prompt.hidden = true;
    this.prompt.setAttribute('role', 'status');
    this.promptText = doc.createElement('span');
    this.promptText.className = 'atlas-tabletop-dice-prompt__text';
    const throwButton = doc.createElement('button');
    throwButton.type = 'button';
    throwButton.className = 'atlas-tabletop-dice-prompt__throw';
    throwButton.textContent = 'Throw';
    throwButton.addEventListener('click', () => this.controller?.throwPending(GENTLE));
    this.prompt.append(this.promptText, throwButton);
    this.prompt.addEventListener('pointerdown', (event) => event.stopPropagation());
    container.appendChild(this.prompt);
    const down = (event: PointerEvent): void => this.pressDie(event);
    // Before the board's own handling: a press on a die the roll waits on is the dice's, anything else the board's.
    container.addEventListener('pointerdown', down, true);
    this.stops.push(() => container.removeEventListener('pointerdown', down, true));
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
    // A press's stop takes itself out of the list: the list is walked as it was.
    for (const stop of [...this.stops]) stop();
    this.heard?.stop();
    this.heard = null;
    this.picker.dispose();
    this.log.dispose();
    this.deps.board.diceButton(null);
    this.deps.board.diceLogButton(null);
    this.prompt.remove();
  }

  /** The rules of the board's map, as Atlas has them for its collection. */
  private rules(): ReturnType<typeof diceRulesOf> {
    return diceRulesOf(this.deps.atlasView(), this.deps.mapPath());
  }

  /** A roll from the picker: the picker steps aside so the GM sees the dice land (they land where the camera looks). */
  private roll(request: RollRequest, flick: Flick): void {
    if (this.disposed) return;
    this.picker.close();
    this.ensureTable().start(request, flick);
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
    if (!publishRoll(this.deps.atlasView(), stockRoll({ ...result, rolls }))) {
      this.deps.warn('Tabletop: open this map in Atlas to log dice rolls in its roll log.');
    }
  }

  private showPrompt(text: string | null): void {
    this.promptText.textContent = text ?? '';
    this.prompt.hidden = text === null;
  }

  /** A press on a die the roll waits on: let go, the die is thrown again, the way the pointer went. */
  private pressDie(event: PointerEvent): void {
    const controller = this.controller;
    if (event.button !== 0 || !controller || event.target !== this.deps.board.canvas) return;
    const id = this.deps.board.diceAt(event.clientX, event.clientY);
    if (id === null || !controller.waitsOn(id)) return;
    event.stopPropagation();
    event.preventDefault();
    const win = this.deps.container.ownerDocument.defaultView ?? window;
    const samples = [{ x: event.clientX, y: event.clientY, t: event.timeStamp }];
    const move = (moved: PointerEvent): void => {
      if (moved.pointerId !== event.pointerId) return;
      samples.push({ x: moved.clientX, y: moved.clientY, t: moved.timeStamp });
      if (samples.length > 32) samples.shift();
    };
    const up = (lifted: PointerEvent): void => {
      if (lifted.pointerId !== event.pointerId) return;
      stop();
      const last = { x: lifted.clientX, y: lifted.clientY, t: lifted.timeStamp };
      const dragged = Math.hypot(last.x - event.clientX, last.y - event.clientY) > DRAG_PX;
      const from = samples.find((sample) => last.t - sample.t <= FLICK_MS) ?? last;
      if (this.controller === controller) controller.clickDie(id, dragged ? { dx: last.x - from.x, dy: last.y - from.y, ms: Math.max(1, last.t - from.t) } : GENTLE);
    };
    const stop = (): void => {
      win.removeEventListener('pointermove', move, true);
      win.removeEventListener('pointerup', up, true);
      win.removeEventListener('pointercancel', stop, true);
      const at = this.stops.indexOf(stop);
      if (at !== -1) this.stops.splice(at, 1);
    };
    win.addEventListener('pointermove', move, true);
    win.addEventListener('pointerup', up, true);
    win.addEventListener('pointercancel', stop, true);
    this.stops.push(stop);
  }
}
