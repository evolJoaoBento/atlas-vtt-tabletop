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
import { boardFromScene, type PlayerSceneLike, type SceneBoard } from './board/sceneAdapter';
import { QUALITY, type Quality } from './board/quality';
import { materialFromUrls, type LoadedMaterial } from './materials';
import type { BoardCamera, BoardExtras, PlayerDiceRequest, PlayerDiceResult } from './connectContract';
import type { ChosenPack } from './dice/dicePack';
import { DicePrompt } from './dice/dicePrompt';
import { listenForDiePresses } from './dice/diePress';
import { PlayerDice, type PlayerDiceTable } from './dice/playerDice';
import type { TabletopDiceSettings } from './dice/diceSettings';
import { DiceTable } from './dice/diceTable';
import { DiceTextures } from './dice/diceTextures';
import type { DiceRules } from './dice/rollRules';
import { GENTLE } from './dice/throwInput';
import type { MeasureShape, PlayerTool, TemplateMark, TemplateShape, TemplateChange } from './board/playerTools';
import type { Measurement } from './board/measure';

type Point = { x: number; y: number };

/** What Connect gives the board (`playerBoardContract.ts` on Connect's side; the shapes must stay the same). */
export interface PlayerBoardHost {
  image(id: string): string | null;
  model(id: string): ArrayBuffer | null;
  sendMove(tokenId: string, x: number, y: number): boolean;
  sendLaser(points: Point[], lifted: boolean, dt: number[], color?: string): boolean;
  sendPing(x: number, y: number): boolean;
  sendTemplate(change: TemplateChange): boolean;
  openPin(pinId: string): void;
  hover(tokenId: string | null, client: Point | null, modifier: boolean): void;
  toolsChanged(): void;
  /** Sends a finished throw to the GM; false when it could not. Without it the board has no dice. */
  sendDiceResult?(result: PlayerDiceResult): boolean;
  /** The rules of the player's map as the GM offered them; null for the default rules. */
  diceRules?(): DiceRules | null;
}

export interface PlayerBoardToolState {
  tool: PlayerTool;
  shape: MeasureShape;
  templateShape: string;
  ownTemplates: boolean;
  laserColor: string;
  gmView: boolean;
}

export interface PlayerBoardHandle {
  setScene(scene: unknown): void;
  setExtras(extras: BoardExtras | null): void;
  setGmCamera(camera: BoardCamera | null): void;
  setGmMapCamera(camera: unknown): void;
  setControlled(tokenIds: readonly string[]): void;
  setConnected(connected: boolean): void;
  setPaused(paused: boolean): void;
  moveRefused(tokenId: string): void;
  setPlayers(order: readonly string[], self: string | null): void;
  selectTool(tool: PlayerTool): void;
  selectShape(shape: MeasureShape): void;
  selectTemplateShape(shape: string): void;
  selectLaserColor(color: string): void;
  clearOwnTemplates(): void;
  toolState(): PlayerBoardToolState;
  followGm(): void;
  fitMap(): void;
  receiveTemplates(sceneId: string, templates: readonly unknown[]): void;
  receivePing(ping: unknown): void;
  receiveLaser(laser: unknown): void;
  refresh(): void;
  measure(): void;
  dispose(): void;
  /** This board throws dice (`throwDice`): set when Connect can send a roll (`sendDiceResult`). */
  readonly diceAvailable?: true;
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
const DEFAULT_MEASUREMENT: Measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', bands: [] };

/** The player's dice as this vault's Tabletop has them: its dice settings, and the pack chosen in them. */
export interface PlayerBoardDice {
  settings(): TabletopDiceSettings;
  pack(): ChosenPack;
}

export function playerBoardFactory(quality: () => Quality, dice: PlayerBoardDice): PlayerBoardFactory {
  return Object.freeze({
    version: 1 as const,
    create: (parent: HTMLElement, host: PlayerBoardHost): PlayerBoardHandle => new PlayerBoard(parent, host, quality(), dice),
  });
}

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
  /** The GM's last 3D view, whatever its scene: used once that scene is shown. */
  private sentCamera: BoardCamera | null = null;
  private followedOnce = false;
  /** The map image was not here at the last load: the board loads again once it is. */
  private backgroundMissing = false;
  /** Files asked for before they arrived, by asset id: settled when `refresh` finds them. */
  private readonly waiting = new Map<string, Array<() => void>>();
  private loading: Promise<void> = Promise.resolve();
  private disposed = false;
  declare readonly diceAvailable?: true;
  private readonly dice: PlayerDice;
  /** The line over the board saying what the roll waits on, and its Throw (an explosion has no die to click). */
  private readonly prompt: DicePrompt;
  private readonly stopPresses: () => void;

  constructor(private readonly parent: HTMLElement, private readonly host: PlayerBoardHost, quality: Quality, private readonly diceDeps: PlayerBoardDice) {
    this.board = new Board(parent, this.boardHost(), QUALITY[quality], { audience: 'player' });
    if (host.sendDiceResult) this.diceAvailable = true;
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
      pickUp: (x, y) => {
        const id = this.board.diceAt(x, y);
        return id === null ? null : this.dice.pickUp(id);
      },
    });
  }

  setScene(scene: unknown): void {
    const before = this.scene?.sceneId ?? null;
    this.scene = scene as PlayerSceneLike | null;
    // Another scene, or none: the dice go, and the roll in play is never sent.
    if ((this.scene?.sceneId ?? null) !== before) this.dice.sceneChanged();
    // No scene (the GM cleared it, or the player was moved to none): the board shows nothing until the next.
    this.board.canvas.style.visibility = this.scene ? '' : 'hidden';
    if (this.scene && this.scene.sceneId !== before) {
      this.followedOnce = false;
      this.useCamera();
    }
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

  /** The GM's 3D view, when it is of the scene shown. */
  private useCamera(): void {
    const camera = this.sentCamera;
    this.gmCamera = camera && camera.sceneId === this.scene?.sceneId ? camera : null;
    this.board.setGmView(this.gmCamera);
    // The board starts on the GM's view, then the player looks where they like.
    if (this.gmCamera && !this.followedOnce && this.shown) {
      this.followedOnce = true;
      this.board.followGm();
    }
    this.host.toolsChanged();
  }

  /** The GM's 2D camera: the board frames the whole map until a 3D view is known, so this changes nothing. */
  setGmMapCamera(_camera: unknown): void {}

  setControlled(tokenIds: readonly string[]): void { this.controlled = new Set(tokenIds); }
  setConnected(connected: boolean): void { this.connected = connected; }
  setPaused(paused: boolean): void { this.paused = paused; }

  /** The GM refused a move: the token goes back to where the scene has it. */
  moveRefused(_tokenId: string): void {
    this.reload();
  }

  setPlayers(order: readonly string[], self: string | null): void {
    this.order = order;
    this.self = self;
    this.board.tools.setPlayers(order, self);
    if (!this.board.tools.laserColor) this.board.tools.selectLaserColor(this.ownColor());
  }

  selectTool(tool: PlayerTool): void {
    this.board.tools.select(tool);
    this.board.toolsChanged();
  }

  selectShape(shape: MeasureShape): void {
    this.board.tools.selectShape(shape);
    this.board.toolsChanged();
  }

  selectTemplateShape(shape: string): void {
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

  followGm(): void { this.board.followGm(); }
  fitMap(): void { this.board.frameMap(); }

  receiveTemplates(sceneId: string, templates: readonly unknown[]): void {
    if (sceneId !== this.scene?.sceneId) return;
    this.board.receiveTemplates(templates as TemplateMark[]);
  }

  receivePing(ping: unknown): void {
    const { x, y, color, sceneId } = ping as { x: number; y: number; color: string; sceneId: string };
    if (sceneId === this.scene?.sceneId) this.board.receivePing(x, y, color);
  }

  receiveLaser(laser: unknown): void {
    const { from, points, lifted, color, sceneId } = laser as { from: string; points: Point[]; lifted: boolean; color?: string; sceneId: string };
    if (sceneId === this.scene?.sceneId) this.board.receiveLaser(from, points, lifted, color ?? '#ff0059');
  }

  /** Files arrived: what waited for them is drawn, and the map image loads if it was missing. */
  refresh(): void {
    for (const [id, settle] of [...this.waiting]) {
      if (this.host.image(id) === null && this.host.model(id) === null) continue;
      this.waiting.delete(id);
      for (const done of settle) done();
    }
    if (this.backgroundMissing && this.scene?.map.asset && this.host.image(this.scene.map.asset)) this.reload();
  }

  measure(): void {
    this.board.fit();
  }

  throwDice(request: PlayerDiceRequest): boolean {
    if (this.disposed || !this.scene) return false;
    return this.dice.throw(request);
  }

  dispose(): void {
    this.disposed = true;
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
      hold: (id, clientX, clientY) => table.hold(id, this.board.rayAt(clientX, clientY)),
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
    return LASER_PALETTE[(place > 0 ? place : LASER_PALETTE.length - 1) % LASER_PALETTE.length]!;
  }

  /** The board again from the scene and its extras; loads run one after another. */
  private reload(): void {
    const scene = this.scene;
    if (!scene) return;
    const shown = boardFromScene(scene, this.extras);
    const background = shown.map.background;
    this.backgroundMissing = background !== null && this.host.image(background) === null;
    if (this.backgroundMissing) shown.map.background = null;
    this.shown = shown;
    this.loading = this.loading.then(async () => {
      if (this.disposed || this.shown !== shown) return;
      await this.board.load(shown.map);
      if (this.gmCamera && !this.followedOnce) {
        this.followedOnce = true;
        this.board.followGm();
      }
    }).catch((error: unknown) => console.error('[Tabletop] The player board could not show the scene:', error));
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
        const url = (role: string): string | null => (record.maps[role] ? this.host.image(record.maps[role]!) : null);
        return materialFromUrls('', {
          color: url('color'), normal: url('normal') ?? url('normal-dx'), roughness: url('roughness'), ao: url('ao'), arm: url('arm'), metalness: url('metalness'),
        }, record.scale, record.maps['normal-dx'] !== undefined && record.maps.normal === undefined);
      },
      placement: (tokenId) => {
        const mini = this.shown?.minis[tokenId];
        return mini ? { mini: mini.glb, scale: mini.scale, turn: mini.turn } : null;
      },
      style: () => 'disc',
      props: () => (look()?.props ?? []).map((prop) => ({ id: prop.id, glb: prop.asset, x: prop.x, y: prop.y, rotation: prop.turn, scale: prop.scale })),
      rules: () => this.shown!.rules,
      moveToken: (id, x, y) => { this.host.sendMove(id, x, y); },
      canMove: (id) => this.connected && !this.paused && this.controlled.has(id),
      openNote: (pinId) => this.host.openPin(pinId),
      hoverToken: (id, client, modifier) => this.host.hover(id, client, modifier),
      playerAction: (action) => {
        if (action.type === 'ping') this.host.sendPing(action.x, action.y);
        else if (action.type === 'template') this.host.sendTemplate(action.change);
        else this.host.sendLaser(action.points, action.lifted, action.dt, action.color || this.ownColor());
      },
      ownColor: () => this.board.tools.laserColor || this.ownColor(),
      toolsChanged: () => this.host.toolsChanged(),
      measurement: () => {
        const measurement = (this.scene as { measurement?: { mode?: string; unitType?: string; unitDistance?: number; diagonalRule?: string; rangeBands?: Array<{ name: string; maxSquares: number }> } } | null)?.measurement;
        return measurement?.mode ? {
          mode: measurement.mode as Measurement['mode'], unitType: (measurement.unitType ?? 'feet') as Measurement['unitType'],
          unitDistance: measurement.unitDistance ?? 5, diagonalRule: (measurement.diagonalRule ?? 'equidistant') as Measurement['diagonalRule'], bands: measurement.rangeBands ?? [],
        } : DEFAULT_MEASUREMENT;
      },
      fogHeight: () => look()?.fogHeight ?? 1,
      wallThickness: () => look()?.wallThickness ?? 0.12,
      wallMaterial: (id) => look()?.wallMaterial(id) ?? null,
      wallHeight: (id) => look()?.wallHeight(id) ?? null,
      doorProp: (id) => look()?.doorProp(id) ?? null,
      lightHeight: (light) => look()?.lightHeight(light.id) ?? DEFAULT_LIGHT_SQUARES,
      ambient: () => look()?.ambient ?? (this.shown?.map.lighting.enabled ? this.shown.map.lighting.ambient : 1),
      laser: () => ({ color: this.board.tools.laserColor || this.ownColor(), size: 16 }),
      // What a player's board never does: the GM's tools and settings.
      warn: none, moveProp: none, addProp: none, tokenMenu: none, propMenu: none, statblockPreview: none, copyToken: none, editResource: none,
      setFogHeight: none, setWallThickness: none, togglePlayerView: none, playerViewOpen: () => false, setLaser: none,
      initiativeOpen: () => false, toggleInitiative: none, setWallHeight: none, setLightHeight: none, toggleDoor: none, wallMenu: none,
      setAmbient: none, lightMenu: none, paintWall: none,
    };
  }
}
