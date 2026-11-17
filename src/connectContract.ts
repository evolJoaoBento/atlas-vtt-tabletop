/**
 * What Tabletop and Atlas VTT Connect share to put Connect's players on the 3D board. The wire shapes are a copy of
 * Connect's `src/app/online/scene/boardTypes.ts` and must stay the same; the API shapes are what each plugin offers
 * the other through `app.plugins.plugins[…].api`. Heights are in grid squares; null is the board's default.
 */
import type { SpellRules } from './board/spellRules';
import type { RolledDie, RollRequest } from './dice/rollRules';
import type { Spell, SpellAbout, SpellAsk } from './board/spells';

// ── On the wire: generated from Connect's `boardTypes.ts` (`npm run sync:connect`), never written here ──────────

import type { BoardCamera, BoardCutscene, BoardExtras, BoardPoint, BoardWater } from './connectWire';

export * from './connectWire';

// ── What each plugin offers the other (kept by hand in both; the fusion number guards it) ──────────────────────

/** How `setCutscene` starts and ends a run on a player's board (Connect has the same shape in `playerBoardContract.ts`). */
export interface PlayerCutsceneOptions {
  /** Connect has just made this board for the run, over a view it faded to black itself: no enter fade. */
  startBlack?: boolean;
  /**
   * At the leave fade's black the board does not reload its own scene: it calls `host.cutsceneOver()` and stays black and
   * locked. Connect then disposes the board, or reuses it with another `setCutscene` (the next run starts from black).
   */
  handBack?: boolean;
}

/** What a player's board adds for cutscenes (`PlayerBoardHandle` extends it). */
export interface PlayerCutsceneHandle {
  /** This board plays cutscenes locally. */
  readonly cutscenes?: true;
  /** The run (a `BoardCutscene`, whenever it changes); null ends it. One Connect cannot read is ignored. */
  setCutscene?(cutscene: unknown | null, options?: PlayerCutsceneOptions): void;
  /** The revealed scene of the map `key` for the run `runId`, and its board extras; sent again whenever it changes. */
  setCutsceneScene?(runId: string, key: string, scene: unknown, extras: BoardExtras | null): void;
  /** Live only: the GM's camera, a goal the board eases towards (never stepped to). */
  setCutsceneCamera?(runId: string, camera: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }): void;
}

// ── The GM's side: Tabletop offers ───────────────────────────────────────────

/**
 * A cutscene as Tabletop publishes it to Connect: what goes to players, and, GM side only and never sent, which vault
 * map each key stands for. Connect finds the GM's Atlas tab of `maps[key]` and sends players that scene (revealed, for
 * the length of the run), without ever putting the path on the wire.
 */
export interface GmCutscene {
  cutscene: BoardCutscene;
  /** key → vault path, for the keys the cutscene uses (every shot's, and `key`). */
  maps: Record<string, string>;
  /** key → the level of that map the key stands for (Atlas levels), for the keys that name one; a key without one is the level Atlas shows. */
  levels?: Record<string, string>;
}

/**
 * The cutscene run on the GM's board, read through Tabletop's API (`api.cutscene`, shaped like `gmCamera`): a pull
 * source. Connect reads `current()` whenever `onChange` fires. At most one run exists at a time; it ends (and `current()`
 * is null) when the GM ends it, its board closes, the session is released or Tabletop unloads.
 *
 * Consumers read `current()` when they attach (a run may already be going). `onChange` may fire twice for one logical
 * change (another tab taking the run over delivers null, then the new run): read `current()` each time and dedupe by `seq`,
 * never count calls. `onCamera` is not throttled: throttle it to 100 ms.
 */
export interface CutsceneSource {
  /** The run now, or null for none. A new object whenever the step, the key or the run changes. */
  current(): GmCutscene | null;
  /** Called when `current()` changed (it started, took a step, changed scene in live, or ended). Returns the stop. */
  onChange(listener: () => void): () => void;
  /**
   * Live only: the GM's own board camera (never the players' window's), for players' boards to follow, smoothed; null in a
   * prepared run or with none.
   */
  camera(): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null;
  /** Called (often) while the live camera moves. Returns the stop. */
  onCamera(listener: () => void): () => void;
}

/** What the GM gave a map on the board, read through Tabletop's API. Paths are vault paths, never sent. */
export interface BoardLook {
  wallHeight(id: string): number | null;
  /** A material's id (its vault folder), or null for the plain wall. */
  wallMaterial(id: string): string | null;
  /** The vault path of the GLB standing in for a door's leaf, or null. */
  doorProp(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it (Rotate 180°, Mirror); none unless said. */
  doorFlip?(id: string): { hinge: boolean; side: boolean };
  /** A window's opening as the GM set it (grid squares from the floor); null for the default. */
  windowOf?(id: string): { bottom: number; top: number } | null;
  /** A wall's own width (thickness) in grid squares; null for the map's. */
  wallWidth?(id: string): number | null;
  lightHeight(id: string): number | null;
  readonly fogHeight: number | null;
  readonly wallThickness: number | null;
  /** The scenes stacked with this map, for players' boards; absent when sharing them is off. */
  readonly layers?: ReadonlyArray<BoardLayerLook>;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  /** The scene's painted water, for players. */
  readonly water?: BoardWater;
  /** How the GM draws the scenes stacked above (Upper layers), for players to see them the same. */
  readonly layerLook?: 'solid' | 'faded' | 'transparent';
  /** Where the players' AR marker sheets lie on this map, placed, for their phones; absent for none. */
  readonly arTable?: { squareMm: number; groups: ReadonlyArray<{ group: string; x: number; y: number; heading: number; w: number; h: number }> };
  /** The raised shapes on the level players are shown (Shapes tool); absent for none. */
  readonly shapes?: ReadonlyArray<BoardShapeLook>;
  /** The ground round the map (Ground panel). */
  readonly ground?: BoardGroundLook;
  /** The materials this map's walls use, with their texture maps by role (vault paths). */
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string> }>;
}

/** A scene stacked with a map, as Tabletop hands it to Connect (vault paths, which Connect turns into asset ids). */
export interface BoardLayerLook {
  elevation: number;
  stands: { x: number; y: number; turn: number };
  /** The vault path of its floor image. */
  image: string;
  /** Where its grid lies; `mapStretch`: how Atlas fitted the level's image to the scene's grid (its stretch's factors times its scale, a turn of a few degrees, an offset), absent for an image that fills the scene's frame. */
  grid: { size: number; offsetX: number; offsetY: number; mapStretch?: { x: number; y: number; rotation?: number; offset?: { x: number; y: number } } };
  walls: ReadonlyArray<{
    id: string; type: 'solid' | 'door' | 'secret-door'; p1: BoardPoint; p2: BoardPoint; closed: boolean;
    direction: 'left' | 'right' | null; blocks: 'sight' | 'light' | 'movement' | null; limited: boolean; chain: string | null;
    height: number | null; material: string | null; doorProp: string | null; flip: { hinge: boolean; side: boolean };
    /** A window's opening (grid squares from the floor), where the GM set it. */
    window?: { bottom: number; top: number } | null;
    /** A wall's own width in grid squares, where the GM set one. */
    width?: number | null;
  }>;
  lights: ReadonlyArray<{
    id: string; x: number; y: number; height: number | null; bright: number; dim: number; color: string; intensity: number;
    animation: string | null; angle: number | null; rotation: number; darkness: boolean; activeBelowAmbient: number | null;
    /** A surface light's outline (lava, acid). */
    area?: ReadonlyArray<{ x: number; y: number }>;
  }>;
  props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  /** The layer's painted water. */
  water?: BoardWater;
  /** The layer's raised shapes; absent for none. */
  shapes?: ReadonlyArray<BoardShapeLook>;
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
  fogHeight: number | null;
  wallThickness: number | null;
}

/** A raised shape as Connect reads it: corners in map pixels with heights in grid squares; materials by vault folder (ids of the look's `materials`). */
export interface BoardShapeLook {
  readonly id: string;
  readonly outline: ReadonlyArray<{ x: number; y: number; h: number }>;
  readonly inner: ReadonlyArray<{ x: number; y: number; h: number }>;
  readonly material?: string;
  readonly sides?: true | string;
}

/** The ground round a map as Connect reads it; the material by vault folder (an id of the look's `materials`). */
export interface BoardGroundLook {
  readonly mode: 'board' | 'horizon' | 'water' | 'lava' | 'acid' | 'painted';
  readonly material?: string;
  readonly noise: string;
  readonly strength: number;
  readonly fog: number;
  readonly margin: number;
  readonly tile: number;
  readonly water: { kind: string; amount: number; direction: number; tint: string; clarity: number };
  readonly lava: { kind: string; amount: number; direction: number; tint: string; clarity: number; style?: string };
  readonly acid: { kind: string; amount: number; direction: number; tint: string; clarity: number };
}

/** What players do on a map, for the GM's board: a ping, new points of a laser, or an instantaneous spell. */
export type BoardMark =
  | { kind: 'ping'; mapPath: string; x: number; y: number; color: string }
  | { kind: 'laser'; mapPath: string; from: string; points: BoardPoint[]; lifted: boolean; color: string }
  /** A player's instantaneous spell going off (a `CastSpell`): shown for a moment, kept nowhere. */
  | { kind: 'spell'; mapPath: string; cast: unknown };

/**
 * A player's phone in augmented reality over a map, for the GM's board: where its camera is in board units and which way
 * it looks (down its −z); `pose` null when they left AR or lost the tracking. `from` is their session id.
 */
export interface BoardViewer {
  mapPath: string;
  from: string;
  name: string;
  color: string;
  pose: { position: [number, number, number]; quaternion: [number, number, number, number] } | null;
}

/** A player's survey of the table's AR marker sheets, for the GM to place on `mapPath`. */
export interface BoardSurvey {
  mapPath: string;
  from: string;
  name: string;
  survey: unknown;
}

/** Connect's hosted session, handed to `api.attachSession` (Connect's `BoardSessionHub`; the shapes must stay the same). */
export interface BoardSession {
  /** The fusion step Connect is a build of (`FUSION_PROTOCOL`): Tabletop takes only a session of its own step. */
  readonly fusion: number;
  hosting(): boolean;
  /**
   * A Connect that carries cutscenes to its players says so (and shows them the GM's shots by switching each GM map
   * tab's live snapshot). Absent from an older Connect, or one with no Atlas scene tabs: Tabletop refuses Play for players.
   */
  readonly cutscenes?: true;
  presentedMap(): string | null;
  /**
   * What the session shows over the map besides Atlas's records: the handout players see. Templates and spells are no
   * part of it: they are Atlas's kept measures, which the board reads from the map and writes through Atlas's store.
   */
  overlay(mapPath: string): { coneAngle: number; handout: { path: string; title: string } | null };
  onChange(listener: () => void): () => void;
  onMark(listener: (mark: BoardMark) => void): () => void;
  /** Players' phones in augmented reality, as they move. Absent from an older Connect. */
  onViewer?(listener: (viewer: BoardViewer) => void): () => void;
  /** Players' surveys of the table's AR marker sheets. Absent from an older Connect. */
  onSurvey?(listener: (survey: BoardSurvey) => void): () => void;
  /**
   * The GM's instantaneous spell goes off for the players of the map's scene (it is kept nowhere); false when the
   * session has no such scene.
   */
  flashSpell?(mapPath: string, spell: Spell, rules?: SpellRules, words?: { name: string; about?: SpellAbout }): boolean;
  /**
   * Tokens are moving from the map `from` to the stacked map `to` (each as `newId`, the same id unless `to` had one):
   * told before they move, so their players keep them and are shown `to`. Absent from an older Connect.
  /**
   * The players who may control `tokenId` (every admitted one) and whether each does, for the "Controlled by" menu;
   * null while no session hands out tokens. Absent from an older Connect.
   */
  controllers?(tokenId: string): Array<{ playerId: string; name: string; controls: boolean }> | null;
  /** Gives `tokenId` to a player or takes it away. */
  setController?(tokenId: string, playerId: string, controls: boolean): void;
  /**
   * The split party for a scene tab of the GM's Atlas view (Atlas's view id and tab id), as the eye's "Present to" menu
   * on Atlas's tabs offers it: a row per player (ticked where they see it), the cap note and "Everyone back"; null
   * while no session runs, on an Atlas without scene tabs, or for a tab Connect does not know. Absent from an older Connect.
   */
  presentTo?(viewId: string, tabId: string): BoardPresentTo | null;
  /** Chooses a player's row of that menu: shows them the tab, or (ticked) sends them back to the presented scene. */
  choosePresentTo?(viewId: string, tabId: string, playerId: string): void;
  /** Everyone follows the presented scene again. */
  everyoneBack?(): void;
  /**
   * What players see of each resource of a character token (Atlas's Edit Token "Players see", Connect's): a row per
   * resource, one choice per column (this token, every token of its statblock); null while no session runs, no Atlas
   * view holds the map, or the token has none. Absent from an older Connect.
   */
  resourceShows?(mapPath: string, tokenId: string): BoardResourceShows | null;
  /** Sets one choice (its `id`) to one of its options' values. */
  setResourceShow?(mapPath: string, tokenId: string, choiceId: string, value: string): void;
  /**
   * Asks the players of `tokenId` to cast `ask` from it (they aim it; Connect takes it as asked): the number of its
   * players on the map's scene now, null when it cannot. Absent from an older Connect.
   */
  requestSpell?(mapPath: string, tokenId: string, ask: SpellAsk): number | null;
  /** The ask waiting for `tokenId`, or null. */
  spellRequest?(mapPath: string, tokenId: string): SpellAsk | null;
  cancelSpellRequest?(mapPath: string, tokenId: string): void;
}

/** A scene tab's "Present to" menu, as Connect words it (Connect's `BoardPresentTo`). */
export interface BoardPresentTo {
  heading: string;
  rows: Array<{ playerId: string; label: string; checked: boolean; disabled: boolean }>;
  /** Shown in place of the rows when there are none. */
  noPlayers: string;
  capNote: string | null;
  everyoneBack: { label: string; disabled: boolean };
}

/** A token's "Players see" choices, as Connect words them (Connect's `BoardResourceShows`). */
export interface BoardResourceShows {
  title: string;
  columns: string[];
  rows: Array<{ label: string; choices: Array<{ id: string; label: string; value: string; options: Array<{ value: string; label: string }> }> }>;
}

/** The GM's 3D view of a map: its players' window when open, else the GM's board; null when neither shows it. */
export interface GmCameraSource {
  camera(mapPath: string): Omit<BoardCamera, 'sceneId'> | null;
  /** Called (often) while either camera moves. */
  onChange(listener: () => void): () => void;
}

// ── A player's physical dice (`api.playerBoard`, optional in version 1) ─────

/** What Connect's stat sheet rolled, handed through the throw and back with its result unchanged. */
export interface PlayerDiceSheet { tokenId: string; roll: unknown }

/** A throw Connect asks the player's board for: the roll, and the sheet roll it is for, if any. */
export type PlayerDiceRequest = RollRequest & { sheet?: PlayerDiceSheet };

/** A finished throw on the player's board, for Connect to send to the GM: every die read, none caught. */
export interface PlayerDiceResult {
  rolls: RolledDie[];
  modifier: number;
  label?: string;
  sheet?: PlayerDiceSheet;
}
