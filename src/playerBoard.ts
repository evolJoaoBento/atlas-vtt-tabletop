/**
 * Tabletop's player board for Atlas VTT Connect (`api.playerBoard`, version 1): the 3D board in a Connect player's
 * tab, drawn from what Connect receives (the scene and Tabletop's board extras, only what players may see). Connect
 * mounts it in its tab and hands it the session's news; it hands back the player's moves, pings, lasers, templates,
 * pins and hovers. It changes nothing else: no menus, doors, walls, lights or settings. Files are Connect's asset ids,
 * looked up through Connect, and waited for until they arrive. When Connect can send a roll, the player throws physical
 * dice on it (`throwDice`): their own pack and Tabletop's dice settings, seen on this board only, the landed values
 * handed back to Connect for the GM.
 */
import { parseMini, type LoadedMini } from './library';
import { Board, type BoardHost } from './board/board';
import type { AugmentedView, RoomPlace } from './board/augmented';
import { boardFromScene, type PlayerSceneLike, type SceneBoard } from './board/sceneAdapter';
import { leaner, QUALITY, withLooks, type LayerLook, type MemoryMode, type Quality, type QualityPreset, type WallEdges } from './board/quality';
import type { Sky } from './board/look';
import { NO_FLIP } from './board/walls';
import { framesAnew } from './board/playerView';
import type { CameraKeep } from './board/camera';
import { materialFromUrls, type LoadedMaterial } from './materials';
import type { BoardCamera, BoardCutscene, BoardExtras, PlayerCutsceneHandle, PlayerCutsceneOptions, PlayerDiceRequest, PlayerDiceResult } from './connectContract';
import { readBoardCutscene } from './cutscene/broadcast';
import { PlayerCutsceneState, type PlayerCutsceneView } from './cutscene/playerCutscene';
import { smoothFollowTwice } from './cutscene/timeline';
import type { CinematicDriver } from './cutscene/drivenView';
import type { ChosenPack } from './dice/dicePack';
import { DicePicker } from './dice/dicePicker';
import { DEFAULT_RULES } from './dice/rollRules';
import { DicePrompt } from './dice/dicePrompt';
import { listenForDiePresses } from './dice/diePress';
import { PlayerDice, type PlayerDiceTable } from './dice/playerDice';
import type { TabletopDiceSettings } from './dice/diceSettings';
import { loadSound } from './sound/catalog';
import { SoundEngine } from './sound/soundEngine';
import type { SoundSettings } from './sound/soundSettings';
import type { SoundLoader } from './sound/customSounds';
import { DiceTable } from './dice/diceTable';
import { DiceTextures } from './dice/diceTextures';
import type { DiceRules } from './dice/rollRules';
import { GENTLE } from './dice/throwInput';
import type { MeasureShape, PlayerTool, SpellChange, TemplateMark, TemplateShape, TemplateChange } from './board/playerTools';
import type { Measurement } from './board/measure';
import { parseMovementRules, readDragDistance } from '../packages/atlas-shared/src/index';
import { ownSpeed } from './board/tokenHeight';
import { PLAYER_REFUSAL_MS, playerRefusalText, type PlayerRefusal } from './board/hostBar';
import type { SpellBook } from './board/spellPicker';

type Point = { x: number; y: number };

/** What Connect gives the board (`playerBoardContract.ts` on Connect's side; the shapes must stay the same). */
export interface PlayerBoardHost {
  image(id: string): string | null;
  model(id: string): ArrayBuffer | null;
  sendMove(tokenId: string, x: number, y: number): boolean;
  sendLaser(points: Point[], lifted: boolean, dt: number[], color?: string): boolean;
  sendPing(x: number, y: number): boolean;
  sendTemplate(change: TemplateChange): boolean;
  /** Casts a spell through a token's eyes (`spells.ts`), takes one of the player's off, or all of theirs; without it, no spells. */
  sendSpell?(change: SpellChange): boolean;
  /** The board left a token's eyes by itself (Escape, Leave): the eye button follows. */
  eyeChanged?(): void;
  openPin(pinId: string): void;
  hover(tokenId: string | null, client: Point | null, modifier: boolean): void;
  toolsChanged(): void;
  /** Sends a finished throw to the GM; false when it could not. Without it the board has no dice. */
  sendDiceResult?(result: PlayerDiceResult): boolean;
  /** The rules of the player's map as the GM offered them; null for the default rules. */
  diceRules?(): DiceRules | null;
  /** A run started with `handBack` has faded to black on its way out and left the board black: Connect puts back the view it had. */
  cutsceneOver?(): void;
}

export interface PlayerBoardToolState {
  tool: PlayerTool;
  shape: MeasureShape;
  templateShape: string;
  ownTemplates: boolean;
  laserColor: string;
  gmView: boolean;
}

export interface PlayerBoardHandle extends PlayerCutsceneHandle {
  setScene(scene: unknown): void;
  setExtras(extras: BoardExtras | null): void;
  setGmCamera(camera: BoardCamera | null): void;
  setGmMapCamera(camera: unknown): void;
  setControlled(tokenIds: readonly string[]): void;
  setConnected(connected: boolean): void;
  setPaused(paused: boolean): void;
  /**
   * `reason` (Connect passes it on): `not-held` when the GM's Atlas is on another map just now; `limit` and `full` when
   * a spell or a template was not kept (the player or the scene has as many as it may; the map's level is full).
   */
  moveRefused(tokenId: string, reason?: PlayerRefusal): void;
  setPlayers(order: readonly string[], self: string | null): void;
  selectTool(tool: PlayerTool): void;
  selectShape(shape: MeasureShape): void;
  selectTemplateShape(shape: string): void;
  selectLaserColor(color: string): void;
  clearOwnTemplates(): void;
  toolState(): PlayerBoardToolState;
  followGm(): void;
  fitMap(): void;
  /** Moves the camera to a point of the map (Atlas's initiative card click). */
  lookAt(x: number, y: number): void;
  /** This board sees through a token's eyes (`seeFrom`). */
  readonly firstPerson?: true;
  /**
   * Sees through a token's eyes, the phone's gyroscope turning the view when `gyro` (the caller has the permission), a drag
   * otherwise; null goes back to the usual camera. False for a token the board does not have.
   */
  seeFrom?(tokenId: string | null, gyro: boolean): boolean;
  /** The token the view is seen through, or null. */
  seeingFrom?(): string | null;
  /** This board draws over a phone's camera picture (`setAugmented`). */
  readonly augmentedReality?: true;
  /**
   * Augmented reality: the phone camera's pose over the printed marker sheet, for one frame (Tabletop's `AugmentedView`);
   * null goes back to the usual camera. False for a pose the board cannot use.
   */
  setAugmented?(view: unknown): boolean;
  /** This board draws into a WebXR immersive AR session (room tracking, Android's ARCore). */
  readonly roomAr?: true;
  /** Room tracking: draws into `session`; `onFrame` hears each XRFrame (and the local reference space) first. */
  startRoomAr?(session: unknown, onFrame: ((frame: unknown, space: unknown) => void) | null): Promise<boolean>;
  /** Room tracking: stands the board at a point of the room (Tabletop's `RoomPlace`); null hides it. */
  placeRoomAr?(place: unknown): void;
  /** Ends room tracking. */
  stopRoomAr?(): void;
  /** Room tracking's frame times and errors, for a look; null when it is off. */
  roomStats?(): { frames: number; intervalMs: number; workMs: number; errors: number; lastError: string } | null;
  /** In augmented reality: where the phone's camera is over the map (board units) and which way it looks; null otherwise. */
  arViewer?(): { position: [number, number, number]; quaternion: [number, number, number, number] } | null;
  receiveTemplates(sceneId: string, templates: readonly unknown[]): void;
  /** This board casts and draws spells (`receiveSpells`, the host's `sendSpell`). */
  readonly spells?: true;
  /** The scene's spells (`CastSpell`s), whenever they change, and what the GM asks of the player's tokens (`SpellRequest`s). */
  receiveSpells?(sceneId: string, spells: readonly unknown[], asks?: readonly unknown[]): void;
  receivePing(ping: unknown): void;
  receiveLaser(laser: unknown): void;
  refresh(): void;
  measure(): void;
  dispose(): void;
  /** This board throws dice (`throwDice`): set when Connect can send a roll (`sendDiceResult`). */
  readonly diceAvailable?: true;
  /** This board throws a reroll rule's dice again and marks the one thrown away `rerolled`, before its replacement (Connect sends a rule only to a board that says so). */
  readonly rerolls?: true;
  /** Throws the roll on the board (one still settling is dropped, unsent); false when there are no dice or no scene. */
  throwDice?(request: PlayerDiceRequest): boolean;
}

export interface PlayerBoardFactory {
  readonly version: 1;
  create(parent: HTMLElement, host: PlayerBoardHost): PlayerBoardHandle;
}

/** Atlas's laser swatches: the GM's colour first, then each player's by their place in the session (Connect's `laserColor`). */
const LASER_PALETTE = ['#ff0059', '#ff9f2e', '#fff133', '#66ffa9', '#00a9ff', '#3d6bff', '#e85aa8', '#ffffff'];
const DEFAULT_LIGHT_SQUARES = 1;
const DEFAULT_MEASUREMENT: Measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 };

/** The player's dice as this vault's Tabletop has them: its dice settings, and the pack chosen in them. */
export interface PlayerBoardDice {
  settings(): TabletopDiceSettings;
  pack(): ChosenPack;
}

/** The player's board sounds: their settings on this device, and a way to hear when the player changes them. */
export interface PlayerBoardSounds {
  settings(): SoundSettings;
  /** Where the sound files come from (the custom sounds folder first); the bundled sounds when absent. */
  load?(): SoundLoader;
  onChange?(listener: () => void): () => void;
}

export function playerBoardFactory(quality: () => Quality, looks: () => { tiltShift: boolean; occlusion: boolean; painted: boolean; sky: Sky; edges?: WallEdges; seeThrough?: boolean; seeThroughSize?: number; layerLook?: LayerLook; layerTick?: number }, dice: PlayerBoardDice, book: () => SpellBook | null = () => null, memory: () => MemoryMode = () => 'normal', sound: PlayerBoardSounds | null = null): PlayerBoardFactory {
  return Object.freeze({
    version: 1 as const,
    create: (parent: HTMLElement, host: PlayerBoardHost): PlayerBoardHandle => new PlayerBoard(parent, host, leaner(withLooks(QUALITY[quality()], looks()), memory()), dice, book, sound),
  });
}

/** How long the own scene may take to come back before the run lets the player go anyway. */
const RESTORE_PATIENCE_MS = 8000;
/** How long a run's scene waits, black, for its map image before it is shown without it. */
const IMAGE_PATIENCE_MS = 4000;
/** A frame longer than this is a tab that was asleep: the live camera does not take it as time passed. */
const LIVE_STEP_MS = 250;

/** Later options win, but one set to `undefined` does not override an earlier value. */
function mergeOptions(first: PlayerCutsceneOptions, later: PlayerCutsceneOptions): PlayerCutsceneOptions {
  const merged: PlayerCutsceneOptions = { ...first };
  if (later.startBlack !== undefined) merged.startBlack = later.startBlack;
  if (later.handBack !== undefined) merged.handBack = later.handBack;
  return merged;
}

/** The button over the board that opens the dice tray during a run. */
interface RollButton {
  root: HTMLElement;
  picker: DicePicker;
  hidden: boolean;
  bottom: number;
}

/** One run on the player's board. */
interface Run {
  cutscene: BoardCutscene;
  state: PlayerCutsceneState;
  /** The player's own camera, to put back; null when the board had not shown their scene yet. */
  keep: CameraKeep | null;
  /** The camera the player had, drawn while their own scene still shows. */
  own: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
  /** The token whose eyes the player was in, and whether the gyroscope turned the view. */
  eyes: string | null;
  gyro: boolean;
  /** The key of the cutscene scene the board shows, or null for the player's own scene. */
  showing: string | null;
  /** The key last drawn, whether its map image was in place, and since when that key has been drawn without it (null: it was in place). */
  loaded: { key: string; complete: boolean; missingSince: number | null } | null;
  live: { goal: { eye: Vec3; target: Vec3 }; mid: { eye: Vec3; target: Vec3 }; current: { eye: Vec3; target: Vec3 }; at: number | null } | null;
  handBack: boolean;
  handedBack: boolean;
  /** The own scene is coming back: when it began, and when it was drawn with the camera put back. */
  restoring: { since: number; done: number | null } | null;
  roll: RollButton | null;
}

type Vec3 = { x: number; y: number; z: number };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

class PlayerBoard implements PlayerBoardHandle {
  private readonly board: Board;
  private scene: PlayerSceneLike | null = null;
  private extras: BoardExtras | null = null;
  private shown: SceneBoard | null = null;
  private controlled = new Set<string>();
  private connected = false;
  private paused = false;
  private self: string | null = null;
  private order: readonly string[] = [];
  private gmCamera: BoardCamera | null = null;
  /** The GM's last 3D view, whatever its scene: offered (Follow GM) once that scene is shown. */
  private sentCamera: BoardCamera | null = null;
  /** The scene the camera last framed: a load of another one frames its map. */
  private framedScene: string | null = null;
  /** The asset id of the map image that was not here at the last load: the board loads again once it is. */
  private missing: string | null = null;
  /** The run on this board, from the start of its enter fade to the end of its leave fade; null when none. */
  private run: Run | null = null;
  /** The revealed scenes Connect sent, by run and map key; only the runs in play (or about to be) are kept. */
  private readonly cutScenes = new Map<string, Map<string, { scene: PlayerSceneLike; extras: BoardExtras | null }>>();
  /** The run that ended last: scenes still arriving for it are dropped. */
  private endedRun: string | null = null;
  /** A run that arrived while the last one was still being left: it starts when that one is done. */
  private queued: { cutscene: BoardCutscene; options: PlayerCutsceneOptions } | null = null;
  /** What the end of a run asks of the load of the player's own scene: the camera to put back (null: frame the map). */
  private afterOwn: { keep: CameraKeep | null; done(): void } | null = null;
  /** Files asked for before they arrived, by asset id: settled when `refresh` finds them. */
  private readonly waiting = new Map<string, Array<() => void>>();
  private loading: Promise<void> = Promise.resolve();
  private disposed = false;
  declare readonly diceAvailable?: true;
  declare readonly rerolls?: true;
  private readonly dice: PlayerDice;
  /** The line over the board saying what the roll waits on, and its Throw (an explosion has no die to click). */
  private readonly prompt: DicePrompt;
  private readonly stopPresses: () => void;

  constructor(private readonly parent: HTMLElement, private readonly host: PlayerBoardHost, private preset: QualityPreset, private readonly diceDeps: PlayerBoardDice, private readonly book: () => SpellBook | null = () => null, private readonly soundSettings: PlayerBoardSounds | null = null) {
    this.board = new Board(parent, this.boardHost(), preset, { audience: 'player' });
    if (host.sendDiceResult) {
      this.diceAvailable = true;
      this.rerolls = true;
    }
    this.dice = new PlayerDice({
      host,
      makeTable: () => this.makeDiceTable(),
      prompt: (text, kind) => {
        if (text !== null && kind === 'notice') this.prompt.notice(text);
        else if (text !== null && kind === 'result') this.prompt.result(text);
        else this.prompt.show(text);
      },
    });
    this.prompt = new DicePrompt(parent, () => this.dice.throwPending(GENTLE), () => this.dice.clear());
    // A press on a die the roll waits on: let go, it is thrown again, into the roll it was pressed in.
    this.stopPresses = listenForDiePresses({
      container: parent,
      canvas: () => this.board.canvas,
      pickUp: (x, y, all) => {
        const id = this.board.diceAt(x, y);
        return id === null ? null : this.dice.pickUp(id, all, { clientX: x, clientY: y });
      },
    });
  }

  setScene(scene: unknown): void {
    const before = this.scene?.sceneId ?? null;
    this.scene = scene as PlayerSceneLike | null;
    // Another scene, or none: the dice go, and the roll in play is never sent. (During a run the own scene is only kept.)
    if ((this.scene?.sceneId ?? null) !== before) this.marks = { templates: null, spells: null };
    if (!this.run && (this.scene?.sceneId ?? null) !== before) this.dice.sceneChanged();
    // No scene (the GM cleared it, or the player was moved to none): the board shows nothing until the next.
    if (!this.run) this.board.canvas.style.visibility = this.scene ? '' : 'hidden';
    // The scene's cone opens as its measuring says (Atlas's cone angle, degrees), for templates and spells alike.
    const cone = (this.scene as { measurement?: { coneAngle?: unknown } } | null)?.measurement?.coneAngle;
    if (typeof cone === 'number' && cone > 0 && cone < 180) this.board.tools.coneAngle = (cone * Math.PI) / 180;
    if (this.scene && this.scene.sceneId !== before) this.useCamera();
    this.reload();
  }

  setExtras(extras: BoardExtras | null): void {
    this.extras = extras;
    this.reload();
  }

  setGmCamera(camera: BoardCamera | null): void {
    this.sentCamera = camera;
    this.useCamera();
  }

  /**
   * The GM's 3D view, when it is of the scene shown, for the player's Follow GM. The board itself starts each scene
   * framing its whole map: the GM's view may be close up, or of a corner the player has no reason to start on.
   */
  private useCamera(): void {
    const camera = this.sentCamera;
    this.gmCamera = camera && camera.sceneId === this.scene?.sceneId ? camera : null;
    this.board.setGmView(this.gmCamera);
    this.host.toolsChanged();
  }

  /** The GM's 2D camera: the board frames the whole map until a 3D view is known, so this changes nothing. */
  setGmMapCamera(_camera: unknown): void {}

  setControlled(tokenIds: readonly string[]): void { this.controlled = new Set(tokenIds); }
  setConnected(connected: boolean): void {
    const was = this.connected;
    this.connected = connected;
    // The connection is gone: a run ends as if the GM had ended it (a repeated call changes nothing more).
    if (was && !connected) this.run?.state.disconnected(this.clock());
  }
  setPaused(paused: boolean): void { this.paused = paused; }

  /**
   * The GM refused a move, a spell or a template: the token goes back to where the scene has it. Refused for a reason
   * (the GM's Atlas holds another map just now, a limit, a full level), the board says so for a few seconds, as the
   * 2D page does.
   */
  moveRefused(_tokenId: string, reason?: PlayerRefusal): void {
    this.reload();
    const text = playerRefusalText(reason);
    if (text === null || this.disposed) return;
    const win = this.parent.ownerDocument.defaultView;
    if (this.refusalTimer !== null) win?.clearTimeout(this.refusalTimer);
    this.board.setBanner({ text });
    this.refusalTimer = win?.setTimeout(() => {
      this.refusalTimer = null;
      if (!this.disposed) this.board.setBanner(null);
    }, PLAYER_REFUSAL_MS) ?? null;
  }
  private refusalTimer: number | null = null;

  setPlayers(order: readonly string[], self: string | null): void {
    this.order = order;
    this.self = self;
    this.board.tools.setPlayers(order, self);
    if (!this.board.tools.laserColor) this.board.tools.selectLaserColor(this.ownColor());
  }

  selectTool(tool: PlayerTool): void {
    if (this.run) return;
    this.board.tools.select(tool);
    this.board.toolsChanged();
  }

  selectShape(shape: MeasureShape): void {
    if (this.run) return;
    this.board.tools.selectShape(shape);
    this.board.toolsChanged();
  }

  selectTemplateShape(shape: string): void {
    if (this.run) return;
    this.board.tools.selectTemplateShape(shape as TemplateShape);
    this.board.toolsChanged();
  }

  selectLaserColor(color: string): void {
    this.board.tools.selectLaserColor(color);
    this.host.toolsChanged();
  }

  clearOwnTemplates(): void {
    for (const action of this.board.tools.clearOwn()) if (action.type === 'template') this.host.sendTemplate(action.change);
  }

  toolState(): PlayerBoardToolState {
    const tools = this.board.tools;
    return { tool: tools.tool, shape: tools.shape, templateShape: tools.templateShape, ownTemplates: tools.ownTemplates(), laserColor: tools.laserColor || this.ownColor(), gmView: this.board.hasGmView };
  }

  // While a run is on, the player's camera, eyes and AR placement are not theirs to move, nor Connect's to move for them.
  followGm(): void { if (!this.run) this.board.followGm(); }
  fitMap(): void { if (!this.run) this.board.frameMap(); }
  lookAt(x: number, y: number): void { if (!this.run) this.board.lookAtPoint(x, y); }
  readonly firstPerson = true as const;
  seeFrom(tokenId: string | null, gyro: boolean): boolean {
    if (this.run) return false;
    return this.board.seeFrom(tokenId, gyro);
  }
  seeingFrom(): string | null { return this.board.seeingFrom; }
  readonly augmentedReality = true as const;
  /** Marker AR is the board's to gate: it keeps the latest view and draws it again by itself when the run is over. */
  setAugmented(view: unknown): boolean { return this.board.setAugmented(view as AugmentedView | null); }
  readonly roomAr = true as const;
  startRoomAr(session: unknown, onFrame: ((frame: unknown, space: unknown) => void) | null): Promise<boolean> {
    if (this.run) return Promise.resolve(false);
    return this.board.startRoomAr(session as XRSession, onFrame);
  }
  placeRoomAr(place: unknown): void { if (!this.run) this.board.placeRoomAr(place as RoomPlace | null); }
  stopRoomAr(): void { this.board.stopRoomAr(); }
  roomStats(): { frames: number; intervalMs: number; workMs: number; errors: number; lastError: string } | null { return this.board.roomStats(); }
  arViewer(): { position: [number, number, number]; quaternion: [number, number, number, number] } | null { return this.board.arViewer(); }

  receiveTemplates(sceneId: string, templates: readonly unknown[]): void {
    if (sceneId !== this.scene?.sceneId) return;
    this.marks.templates = templates;
    // The marks belong to the player's own scene: during a run they wait, and are drawn on it when it is back.
    if (!this.run) this.board.receiveTemplates(templates as TemplateMark[]);
  }

  /** The latest templates and spells of the own scene, drawn again once the run is over (a run's scene shows none of them). */
  private marks: { templates: readonly unknown[] | null; spells: { list: readonly unknown[]; asks: readonly unknown[] } | null } = { templates: null, spells: null };

  readonly spells = true as const;
  receiveSpells(sceneId: string, spells: readonly unknown[], asks: readonly unknown[] = []): void {
    if (sceneId !== this.scene?.sceneId) return;
    this.marks.spells = { list: spells, asks };
    if (!this.run) this.board.receiveSpells(sceneId, spells, asks);
  }

  // Pings and lasers are moments: during a run they are not drawn on the run's scene and are not kept.
  receivePing(ping: unknown): void {
    const { x, y, color, sceneId } = ping as { x: number; y: number; color: string; sceneId: string };
    if (!this.run && sceneId === this.scene?.sceneId) this.board.receivePing(x, y, color);
  }

  receiveLaser(laser: unknown): void {
    const { from, points, lifted, color, sceneId } = laser as { from: string; points: Point[]; lifted: boolean; color?: string; sceneId: string };
    if (!this.run && sceneId === this.scene?.sceneId) this.board.receiveLaser(from, points, lifted, color ?? '#ff0059');
  }

  /** The own scene is back: the templates and spells that came meanwhile are drawn on it. */
  private drawMarks(): void {
    const id = this.scene?.sceneId;
    if (id === undefined) return;
    if (this.marks.templates) this.board.receiveTemplates(this.marks.templates as TemplateMark[]);
    if (this.marks.spells) this.board.receiveSpells(id, this.marks.spells.list, this.marks.spells.asks);
  }

  /** Files arrived: what waited for them is drawn, and the map image loads if it was missing. */
  refresh(): void {
    for (const [id, settle] of [...this.waiting]) {
      if (this.host.image(id) === null && this.host.model(id) === null) continue;
      this.waiting.delete(id);
      for (const done of settle) done();
    }
    if (this.missing !== null && this.host.image(this.missing) !== null) this.reload();
  }

  measure(): void {
    this.board.fit();
  }

  throwDice(request: PlayerDiceRequest): boolean {
    if (this.disposed || !this.scene || this.run) return false;
    return this.dice.throw(request);
  }

  /** The sound engine of this board's window, asked for when the board first needs it; null with no sound settings or no audio. */
  private sounds(): SoundEngine | null {
    if (this.disposed || !this.soundSettings) return null;
    if (this.engine === undefined) {
      const win = this.parent.ownerDocument.defaultView;
      this.engine = win ? SoundEngine.shared(win, this.soundSettings.load?.() ?? loadSound) : null;
      const settings = this.soundSettings;
      this.engine?.configure(settings.settings());
      this.stopSound = settings.onChange?.(() => this.engine?.configure(settings.settings())) ?? null;
    }
    return this.engine;
  }

  private engine: SoundEngine | null | undefined;
  private stopSound: (() => void) | null = null;

  dispose(): void {
    this.disposed = true;
    if (this.refusalTimer !== null) this.parent.ownerDocument.defaultView?.clearTimeout(this.refusalTimer);
    this.refusalTimer = null;
    this.run?.roll?.picker.dispose();
    this.run?.roll?.root.remove();
    this.run = null;
    this.queued = null;
    this.cutScenes.clear();
    this.stopSound?.();
    this.engine?.dispose();
    this.engine = null;
    this.waiting.clear();
    this.dice.dispose();
    this.stopPresses();
    this.prompt.dispose();
    this.board.dispose();
  }

  /** A dice table on this board, with the pack and dice settings as they are now; only this player sees it. */
  private makeDiceTable(): PlayerDiceTable {
    const pack = this.diceDeps.pack();
    const settings = this.diceDeps.settings();
    const textures = new DiceTextures(pack, this.parent.ownerDocument, () => this.board.wake(true));
    const table = new DiceTable({ ...this.board.diceHost(), pack: () => pack.config, textures: (type, color) => textures.textures(type, color) }, settings);
    this.board.attachDice(table);
    return {
      table,
      hold: (ids, clientX, clientY) => table.hold(ids, this.board.rayAt(clientX, clientY)),
      outdated: () => this.diceDeps.pack() !== pack || this.diceDeps.settings() !== settings,
      dispose: () => {
        table.dispose();
        textures.dispose();
      },
    };
  }

  /** This player's colour, as Connect gives it: their place after the GM's, the last colour when not listed. */
  private ownColor(): string {
    const place = this.self ? this.order.indexOf(this.self) + 1 : 0;
    return LASER_PALETTE[(place > 0 ? place : LASER_PALETTE.length - 1) % LASER_PALETTE.length];
  }

  /** The board again from the scene and its extras; loads run one after another. */
  private reload(): void {
    const run = this.run;
    const key = run?.showing ?? null;
    let scene: PlayerSceneLike | null = this.scene;
    let extras: BoardExtras | null = this.extras;
    if (run && key !== null) {
      // The run's scene, as Connect sent it for this run only: its own id, never the player's, so nothing of it is mistaken for theirs.
      this.board.canvas.style.visibility = '';
      const entry = this.cutScenes.get(run.cutscene.runId)?.get(key);
      // Not here yet: the board stays black, and loads it when it comes.
      if (!entry) return;
      const id = `cutscene:${run.cutscene.runId}:${key}`;
      extras = entry.extras && entry.extras.sceneId === entry.scene.sceneId ? { ...entry.extras, sceneId: id } : null;
      scene = { ...entry.scene, sceneId: id };
    }
    if (!scene) return;
    const shown = boardFromScene(scene, extras);
    // The scenes stacked above, drawn as the GM draws them (Upper layers): solid, faded or hidden.
    const layerLook = extras?.layerLook;
    if ((layerLook === 'solid' || layerLook === 'faded' || layerLook === 'transparent') && layerLook !== this.preset.layerLook) {
      this.preset = { ...this.preset, layerLook };
      this.board.setQuality(this.preset);
    }
    const background = shown.map.background;
    const missing = background !== null && this.host.image(background) === null;
    this.missing = missing ? background : null;
    if (missing) shown.map.background = null;
    this.shown = shown;
    const sceneId = scene.sceneId;
    this.loading = this.loading.then(async () => {
      if (this.disposed || this.shown !== shown) return;
      await this.board.load(shown.map);
      if (this.shown !== shown) return;
      this.board.setStack(shown.layers);
      this.loadedId = sceneId;
      if (run && key !== null) {
        // A scene of the run: no framing of its map, and the dice are the run's business (a roll lives on across shots on one map).
        if (this.run === run && run.showing === key) {
          // The wait for a missing image counts from the first load of this key without it, whatever loads come after.
          const was = run.loaded?.key === key ? run.loaded.missingSince : null;
          run.loaded = { key, complete: !missing, missingSince: missing ? (was ?? this.clock()) : null };
          this.arrived(run);
        }
        return;
      }
      // The first scene, or another than the one framed (the GM presented another map): its whole map is framed, not
      // looked at from the old scene's pose. Later loads of the same scene (news, files arriving) keep the camera.
      const after = this.afterOwn;
      this.afterOwn = null;
      if (framesAnew(this.framedScene, sceneId)) this.board.frameNewMap();
      else if (after?.keep) this.board.restoreCamera(after.keep);
      this.framedScene = sceneId;
      if (after) this.drawMarks();
      after?.done();
    }).catch((error: unknown) => console.error('[Tabletop] The player board could not show the scene:', error));
  }

  /** Test support (the harness reads it): the id of the scene the board last finished loading; a run's scene is `cutscene:<runId>:<key>`. */
  private loadedId: string | null = null;

  // ── Cutscenes ─────────────────────────────────────────────────────────────

  readonly cutscenes = true as const;

  private clock(): number {
    return (this.parent.ownerDocument.defaultView ?? window).performance.now();
  }

  setCutscene(raw: unknown | null, options: PlayerCutsceneOptions = {}): void {
    if (this.disposed) return;
    if (raw === null) {
      // A run waiting for this one to finish is cancelled with its scenes.
      if (this.queued) {
        this.cutScenes.delete(this.queued.cutscene.runId);
        this.endedRun = this.queued.cutscene.runId;
        this.queued = null;
      }
      const run = this.run;
      if (!run) return;
      if (options.handBack !== undefined) run.handBack = options.handBack;
      // The leave fade starts now; a repeated call changes nothing.
      run.state.cutscene(null, this.clock());
      this.board.wake(true);
      return;
    }
    const cutscene = readBoardCutscene(raw);
    if (!cutscene) return;
    let run = this.run;
    // A run handed back is over for this board: the next starts it afresh, still black.
    if (run?.handedBack) {
      this.finish(run);
      // A run that was waiting has started: the news is its update, not a second start.
      run = this.run;
    }
    if (run && (run.state.leaving || run.restoring !== null)) {
      // The run is past its End (fading out, or the own scene coming back): any run that comes now waits until it is
      // done, the same one included (a run told again after its end is the player admitted to it again, after a drop).
      const same = this.queued?.cutscene.runId === cutscene.runId;
      // The scenes the run just left had under the same id are from before the drop: Connect sends them again, as they are now.
      if (!same && cutscene.runId === run.cutscene.runId) this.cutScenes.delete(cutscene.runId);
      this.queued = { cutscene, options: same ? mergeOptions(this.queued!.options, options) : options };
      // Its scenes are taken from now on, even when the run just left had the same id.
      if (this.endedRun === cutscene.runId) this.endedRun = null;
      return;
    }
    if (run) this.update(run, cutscene, options);
    else this.begin(cutscene, options);
  }

  setCutsceneScene(runId: string, key: string, scene: unknown, extras: BoardExtras | null): void {
    if (this.disposed || runId === this.endedRun || typeof runId !== 'string' || typeof key !== 'string' || typeof scene !== 'object' || scene === null) return;
    let byKey = this.cutScenes.get(runId);
    if (!byKey) {
      byKey = new Map();
      this.cutScenes.set(runId, byKey);
      // Only the run in play and the one about to be: older arrivals are dropped.
      const keep = new Set([runId, this.run?.cutscene.runId, this.queued?.cutscene.runId]);
      for (const id of [...this.cutScenes.keys()]) if (!keep.has(id)) this.cutScenes.delete(id);
    }
    byKey.set(key, { scene: scene as PlayerSceneLike, extras });
    const run = this.run;
    if (run && run.cutscene.runId === runId && run.showing === key) this.reload();
  }

  setCutsceneCamera(runId: string, camera: { eye: Vec3; target: Vec3 }): void {
    const run = this.run;
    if (this.disposed || !run || run.cutscene.runId !== runId || run.cutscene.mode !== 'live') return;
    const goal = { eye: { ...camera.eye }, target: { ...camera.target } };
    if (!run.live) {
      // The first goal is where the view begins: eased from nowhere it would sweep across the map.
      run.live = { goal, mid: { eye: { ...goal.eye }, target: { ...goal.target } }, current: { eye: { ...goal.eye }, target: { ...goal.target } }, at: null };
      this.arrived(run);
    } else run.live.goal = goal;
    this.board.wake(true);
  }

  /** Tells the run's state a scene has been drawn: when it is the one shown, its map image is in place and, in live, the camera is known. */
  private arrived(run: Run): void {
    const loaded = run.loaded;
    if (!loaded || !loaded.complete || loaded.key !== run.showing) return;
    if (run.cutscene.mode === 'live' && !run.live) return;
    run.state.sceneArrived(loaded.key);
  }

  private begin(cutscene: BoardCutscene, options: PlayerCutsceneOptions): void {
    const board = this.board;
    const now = this.clock();
    // Before the board has shown the player's own scene there is nothing to fade from (and no camera to put back).
    const ownShown = this.framedScene !== null;
    const black = options.startBlack === true || !ownShown;
    const eyes = board.seeingFrom;
    const gyro = board.seeingGyro;
    const state = new PlayerCutsceneState();
    const keep = ownShown ? board.keepCamera() : null;
    const run: Run = {
      cutscene, state, keep, own: board.cameraPose(), eyes, gyro, showing: null, loaded: null, live: null,
      handBack: options.handBack === true, handedBack: false, restoring: null, roll: null,
    };
    this.run = run;
    // Scenes sent for another run are dropped (the ones for this one are kept).
    for (const id of [...this.cutScenes.keys()]) if (id !== cutscene.runId && id !== this.queued?.cutscene.runId) this.cutScenes.delete(id);
    this.dropUnnamed(cutscene);
    this.endedRun = null;
    // The player leaves a token's eyes, and the board is theirs no more; the sight veil hides nothing during a run.
    board.setCinematicRole('locked');
    // The reveal and the bars come on with the run's first scene (at black), not during the fade, when the player's own scene is still on screen.
    if (black) board.cinema.setBlack(1);
    board.setCinematic(this.driverOf(run));
    state.cutscene(cutscene, now, black);
    run.roll = this.makeRoll();
    board.wake(true);
  }

  private update(run: Run, cutscene: BoardCutscene, options: PlayerCutsceneOptions): void {
    if (cutscene.runId !== run.cutscene.runId) {
      // Another run takes over the board: its scenes are its own, and nothing of the last is shown.
      run.showing = null;
      run.loaded = null;
      run.live = null;
      this.cutScenes.delete(run.cutscene.runId);
    }
    run.cutscene = cutscene;
    this.dropUnnamed(cutscene);
    if (options.handBack !== undefined) run.handBack = options.handBack;
    if (run.showing !== null) this.board.cinema.setBars(cutscene.look.bars);
    run.state.cutscene(cutscene, this.clock());
    this.board.wake(true);
  }

  /**
   * The run's scenes of maps the publication no longer names are dropped: a live run that comes back to a map reuses
   * its key, and the board must wait, black, for that map as it is now (Connect sends it again) rather than show it as
   * it was when the GM left it.
   */
  private dropUnnamed(cutscene: BoardCutscene): void {
    const byKey = this.cutScenes.get(cutscene.runId);
    if (!byKey) return;
    const named = new Set([cutscene.key, ...cutscene.shots.map((shot) => shot.key)]);
    for (const key of [...byKey.keys()]) if (!named.has(key)) byKey.delete(key);
  }

  /** What takes the camera over for a run: the state's view of this frame, and what the board must do about it. */
  private driverOf(run: Run): CinematicDriver {
    return {
      pose: (now) => {
        const view = run.state.view(now);
        this.follow(run, view, now);
        const camera = this.cameraOf(run, view, now);
        return { eye: camera.eye, target: camera.target, black: this.blackOf(run, view, now) };
      },
    };
  }

  /** The board's part of the state's news: the scene to show, the own scene coming back, the run being over. */
  private follow(run: Run, view: PlayerCutsceneView, now: number): void {
    if (this.run !== run) return;
    const wanted = view.show === 'own' ? null : view.show;
    if (wanted !== null && wanted !== run.showing && !run.restoring) {
      // The first scene of the run, another map, or (live) another scene: a roll in play does not go with it to the new map.
      if (run.showing !== null) this.dice.sceneChanged('The scene changed; roll again.');
      // The picture is black here: the sight veil stops hiding things and the bars come on now, not while the player's own scene fades.
      this.board.setReveal(true);
      this.board.cinema.setBars(run.cutscene.look.bars);
      run.showing = wanted;
      run.loaded = null;
      this.reload();
    }
    const loaded = run.loaded;
    if (loaded && !loaded.complete && loaded.key === run.showing && loaded.missingSince !== null && now - loaded.missingSince >= IMAGE_PATIENCE_MS) {
      // The map image is not coming (undecodable, refused): the scene shows without it, as a normal load does.
      loaded.complete = true;
      this.arrived(run);
    }
    if (view.restore) this.restore(run, now);
    if (run.restoring && !run.handedBack && run.restoring.done === null && now - run.restoring.since > RESTORE_PATIENCE_MS) {
      // The own scene is not coming: the player is let go over whatever the board shows.
      if (run.keep) this.board.restoreCamera(run.keep);
      run.restoring.done = now;
    }
    // A run waiting that starts black needs no fade in from the own scene: the board stays black until it begins.
    if (run.restoring?.done != null && !run.handedBack && !view.locked && (this.queuedBlack() || now - run.restoring.done >= run.cutscene.look.fadeMs)) this.finish(run);
    this.updateRoll(run, view);
  }

  /** At the leave fade's black: the run's scene and what it revealed go, and the player's own scene and camera come back. */
  private restore(run: Run, now: number): void {
    run.restoring = { since: now, done: null };
    this.dice.sceneChanged('The scene changed; roll again.');
    this.board.setReveal(false);
    run.showing = null;
    run.loaded = null;
    // The scenes of a run waiting to start stay, even under the same id (the player admitted to the run again).
    if (this.queued?.cutscene.runId !== run.cutscene.runId) {
      this.cutScenes.delete(run.cutscene.runId);
      this.endedRun = run.cutscene.runId;
    }
    if (run.handBack) {
      // Connect puts back the view it had, under its own black: this board stays black.
      run.handedBack = true;
      this.host.cutsceneOver?.();
      return;
    }
    const done = (): void => { if (run.restoring) run.restoring.done = this.clock(); };
    if (!this.scene) {
      // The player has no scene: nothing to load, the board shows nothing.
      this.board.canvas.style.visibility = 'hidden';
      if (run.keep) this.board.restoreCamera(run.keep);
      done();
      return;
    }
    this.afterOwn = { keep: run.keep, done };
    this.reload();
  }

  /** A run is waiting to start and asks to begin black (a player admitted again mid-run). */
  private queuedBlack(): boolean {
    return this.queued?.options.startBlack === true;
  }

  /** The camera of this frame: the run's, the live one eased, or the player's own while their scene shows. */
  private cameraOf(run: Run, view: PlayerCutsceneView, now: number): { eye: Vec3; target: Vec3 } {
    if (view.camera) return view.camera;
    const live = run.live;
    if (view.show === 'own' || !live) return run.own;
    const dt = live.at === null ? 0 : Math.min(LIVE_STEP_MS, Math.max(0, now - live.at));
    live.at = now;
    const eased = smoothFollowTwice(live, live.goal, dt);
    live.mid = eased.mid;
    live.current = eased.current;
    return live.current;
  }

  private blackOf(run: Run, view: PlayerCutsceneView, now: number): number {
    const restoring = run.restoring;
    if (!restoring) return view.black;
    if (run.handedBack || restoring.done === null || this.queuedBlack()) return 1;
    // Once the own scene is drawn the picture fades in from it, however long it took.
    return Math.max(view.black, clamp01(1 - (now - restoring.done) / run.cutscene.look.fadeMs));
  }

  /** The run is over for this board: the camera, eyes and tools are the player's again. */
  private finish(run: Run): void {
    if (this.run !== run) return;
    const board = this.board;
    this.run = null;
    run.roll?.picker.dispose();
    run.roll?.root.remove();
    run.roll = null;
    board.setCinematic(null);
    board.setReveal(false);
    board.cinema.setBars(null);
    // The camera the player had, exactly (the driver's last frames moved the drawn one, and handing it back snapped it).
    if (run.restoring && !run.handedBack && run.keep && !framesAnew(this.framedScene, this.scene?.sceneId ?? '')) board.restoreCamera(run.keep);
    board.setCinematicRole('none');
    // Nothing of any run but the one waiting to start is kept.
    for (const id of [...this.cutScenes.keys()]) if (id !== this.queued?.cutscene.runId) this.cutScenes.delete(id);
    if (this.queued?.cutscene.runId !== run.cutscene.runId) this.endedRun = run.cutscene.runId;
    // Back in the same token's eyes, and Connect told, as it was when they were taken.
    if (!run.handedBack && run.eyes !== null && board.seeFrom(run.eyes, run.gyro)) this.host.eyeChanged?.();
    const next = this.queued;
    this.queued = null;
    if (next) this.setCutscene(next.cutscene, next.options);
  }

  // ── The Roll dice button ──────────────────────────────────────────────────

  /** The button over the bottom bar, the one thing a player can press during a run besides hovering; none without dice. */
  private makeRoll(): RollButton | null {
    if (!this.diceAvailable) return null;
    const doc = this.parent.ownerDocument;
    const root = doc.win.createDiv();
    root.className = 'tabletop-cinema-roll';
    const button = doc.win.createEl('button');
    button.type = 'button';
    button.className = 'tabletop-cinema-roll__button';
    button.textContent = 'Roll dice';
    button.setAttribute('aria-label', 'Roll dice');
    root.appendChild(button);
    root.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.parent.appendChild(root);
    const picker = new DicePicker(root, {
      onRoll: (request) => { this.dice.throw(request); },
      colors: () => this.diceDeps.settings().colors,
      rules: () => this.host.diceRules?.() ?? DEFAULT_RULES,
      onOpenChange: (open) => this.prompt.setCovered(open),
    });
    button.addEventListener('click', () => (picker.isOpen ? picker.close() : picker.open()));
    return { root, picker, hidden: false, bottom: -1 };
  }

  /** The button sits just above the bottom bar and goes while the picture is mostly black. */
  private updateRoll(run: Run, view: PlayerCutsceneView): void {
    const roll = run.roll;
    if (!roll) return;
    const hidden = view.black > 0.6 || run.restoring !== null;
    if (hidden !== roll.hidden) {
      roll.hidden = hidden;
      roll.root.hidden = hidden;
      if (hidden) roll.picker.close();
    }
    const bottom = Math.round(this.board.cinema.barHeight);
    if (bottom !== roll.bottom) {
      roll.bottom = bottom;
      roll.root.style.bottom = `${bottom + 14}px`;
    }
  }

  /** Settles once Connect has the file `id`. */
  private arrival(id: string, ready: () => boolean): Promise<void> {
    if (ready()) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.waiting.get(id) ?? [];
      list.push(resolve);
      this.waiting.set(id, list);
    });
  }

  private boardHost(): BoardHost {
    const look = () => this.shown?.look ?? null;
    const none = (): void => undefined;
    return {
      sounds: () => this.sounds(),
      // The player's own spell notes, on Obsidian; none on the web page.
      spellBook: () => this.book(),
      readImage: async (id) => {
        await this.arrival(id, () => this.host.image(id) !== null);
        return this.host.image(id);
      },
      readMini: async (id): Promise<LoadedMini> => {
        await this.arrival(id, () => this.host.model(id) !== null);
        const bytes = this.host.model(id);
        if (!bytes) throw new Error('the model did not arrive');
        return parseMini(bytes);
      },
      readMaterial: async (id): Promise<LoadedMaterial | null> => {
        const record = look()?.materials.find((material) => material.id === id);
        if (!record) return null;
        const ids = Object.values(record.maps);
        await Promise.all(ids.map((asset) => this.arrival(asset, () => this.host.image(asset) !== null)));
        const url = (role: string): string | null => (record.maps[role] ? this.host.image(record.maps[role]) : null);
        return materialFromUrls('', {
          color: url('color'), normal: url('normal') ?? url('normal-dx'), roughness: url('roughness'), ao: url('ao'), arm: url('arm'), metalness: url('metalness'), height: url('height'),
        }, record.scale, record.maps['normal-dx'] !== undefined && record.maps.normal === undefined, record.tuning);
      },
      placement: (tokenId) => {
        const mini = this.shown?.minis[tokenId];
        return mini ? { mini: mini.glb, scale: mini.scale, turn: mini.turn, ...(mini.base ? { base: mini.base } : {}) } : null;
      },
      style: () => 'disc',
      water: () => look()?.water ?? null,
      props: () => (look()?.props ?? []).map((prop) => ({ id: prop.id, glb: prop.asset, x: prop.x, y: prop.y, rotation: prop.turn, scale: prop.scale, ...(prop.solid ? { solid: true } : {}), ...(prop.lift ? { lift: prop.lift } : {}) })),
      rules: () => this.shown!.rules,
      moveToken: (id, x, y) => { this.host.sendMove(id, x, y); },
      canMove: (id) => this.connected && !this.paused && this.controlled.has(id),
      controls: (id) => this.controlled.has(id),
      openNote: (pinId) => this.host.openPin(pinId),
      hoverToken: (id, client, modifier) => this.host.hover(id, client, modifier),
      playerAction: (action) => {
        if (action.type === 'ping') this.host.sendPing(action.x, action.y);
        else if (action.type === 'template') this.host.sendTemplate(action.change);
        else if (action.type === 'spell') this.host.sendSpell?.(action.change);
        else this.host.sendLaser(action.points, action.lifted, action.dt, action.color || this.ownColor());
      },
      ownColor: () => this.board.tools.laserColor || this.ownColor(),
      toolsChanged: () => this.host.toolsChanged(),
      eyeChanged: () => this.host.eyeChanged?.(),
      measurement: () => {
        // Connect's `PlayerMeasurement`: Atlas's settings as the GM has them, the Manhattan rule and a unit's name included.
        const measurement = (this.scene as { measurement?: { mode?: string; unitType?: string; unitDistance?: number; ruleDistance?: number; unitName?: string; diagonalRule?: string; rangeBands?: Array<{ name: string; maxSquares: number }>; coneAngle?: number } } | null)?.measurement;
        if (!measurement?.mode) return DEFAULT_MEASUREMENT;
        const unitDistance = measurement.unitDistance ?? 5;
        return {
          mode: measurement.mode as Measurement['mode'], unitType: (measurement.unitType ?? 'feet') as Measurement['unitType'],
          unitDistance, ruleDistance: measurement.ruleDistance ?? unitDistance,
          ...(typeof measurement.unitName === 'string' && measurement.unitName !== '' ? { unitName: measurement.unitName } : {}),
          diagonalRule: (measurement.diagonalRule ?? 'equidistant') as Measurement['diagonalRule'], rangeBands: measurement.rangeBands ?? [],
          coneAngle: measurement.coneAngle ?? 90,
        };
      },
      // Atlas 0.15's movement as Connect sends it: the steps in the measurement, a speed on each of the players' tokens.
      movement: () => {
        const measurement = (this.scene as { measurement?: { movement?: unknown } } | null)?.measurement;
        const rules = parseMovementRules(measurement?.movement);
        if (!rules || rules.steps.length === 0) return null;
        const tokens = (this.scene as { tokens?: Record<string, { speed?: unknown }> } | null)?.tokens;
        return { rules, speedOf: (id) => ownSpeed(tokens && Object.hasOwn(tokens, id) ? tokens[id]?.speed : undefined) };
      },
      dragDistance: () => readDragDistance((this.scene as { measurement?: { dragDistance?: unknown } } | null)?.measurement?.dragDistance),
      fogHeight: () => look()?.fogHeight ?? 1,
      wallThickness: () => look()?.wallThickness ?? 0.12,
      wallMaterial: (id) => look()?.wallMaterial(id) ?? null,
      wallHeight: (id) => look()?.wallHeight(id) ?? null,
      doorProp: (id) => look()?.doorProp(id) ?? null,
      doorFlip: (id) => look()?.doorFlip(id) ?? NO_FLIP,
      windowOf: (id) => look()?.windowOf(id) ?? null,
      wallWidth: (id) => look()?.wallWidth(id) ?? null,
      lightHeight: (light) => look()?.lightHeight(light.id) ?? DEFAULT_LIGHT_SQUARES,
      // Atlas's scene lighting, as the GM's board has it (a look from an older Tabletop may still carry its own).
      tint: () => look()?.tint ?? this.shown?.map.lighting.ambientColor ?? null,
      ambient: () => look()?.ambient ?? (this.shown?.map.lighting.enabled ? this.shown.map.lighting.ambient : 1),
      laser: () => ({ color: this.board.tools.laserColor || this.ownColor(), size: 16 }),
      // What a player's board never does: the GM's tools and settings.
      warn: none, moveProp: none, addProp: none, tokenMenu: none, propMenu: none, statblockPreview: none, copyToken: none, editResource: none,
      setFogHeight: none, setWallThickness: none, togglePlayerView: none, playerViewOpen: () => false, setLaser: none,
      initiativeOpen: () => false, toggleInitiative: none, setWallHeight: none, setLightHeight: none, toggleDoor: none, wallMenu: none,
      setAmbient: none, lightMenu: none, paintWall: none, setTint: none, clearTint: none,
    };
  }
}
