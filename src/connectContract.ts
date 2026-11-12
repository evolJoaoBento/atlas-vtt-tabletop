/**
 * What Tabletop and Atlas VTT Connect share to put Connect's players on the 3D board. The wire shapes are a copy of
 * Connect's `src/app/online/scene/boardTypes.ts` and must stay the same; the API shapes are what each plugin offers
 * the other through `app.plugins.plugins[…].api`. Heights are in grid squares; null is the board's default.
 */
import type { SpellRules } from './board/spellRules';
import type { RolledDie, RollRequest } from './dice/rollRules';
import type { Spell, SpellAbout, SpellAsk } from './board/spells';

// ── On the wire (Connect's `boardTypes.ts`) ──────────────────────────────────

export interface BoardPoint { x: number; y: number }

export interface BoardDoor {
  open: boolean;
  swing: 'left' | 'right';
  /** The asset id of the GLB standing in the doorway, or null for Tabletop's own leaf. */
  prop: string | null;
  chainId?: string;
  /** The door was turned by the GM: its hinge is at the segment's second end, and/or it opens to the other side of the wall. Absent as Atlas draws it. */
  hinge?: true;
  side?: true;
}

export interface BoardWallRecord {
  id: string;
  /** A closed secret door comes as `solid`, with no `door`. */
  type: 'solid' | 'door';
  p1: BoardPoint;
  p2: BoardPoint;
  height: number | null;
  material: string | null;
  door?: BoardDoor;
  /** Atlas's one-way side, a wall that stops only sight (a curtain), only light (glass) or only tokens (a window), and a limited one. */
  direction?: 'left' | 'right';
  blocks?: 'sight' | 'light' | 'movement';
  limited?: boolean;
  /** A window's opening (grid squares from the floor), where the GM set it. */
  window?: { bottom: number; top: number };
  /** The wall's own width (thickness) in grid squares, where the GM set one. */
  width?: number;
}

export interface BoardLightRecord {
  id: string;
  x: number;
  y: number;
  height: number | null;
  color: string;
  bright: number;
  dim: number;
  intensity: number;
  animation: string | null;
  angle: number | null;
  rotation: number;
  /** A light that darkens, and the ambient level below which it shines (Atlas's `activeBelowAmbient`). */
  darkness: boolean;
  activeBelowAmbient: number | null;
}

export interface BoardMaterialRecord {
  id: string;
  scale: number;
  maps: Record<string, string>;
  /** How strongly the material shows its texture (see MaterialTuning); absent as made. A Connect that does not pass it on draws the texture as made. */
  tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number };
}

export interface BoardPropRecord { id: string; asset: string; x: number; y: number; scale: number; turn: number; solid?: true; lift?: number }

export interface BoardLighting { enabled: boolean; ambient: number; ambientColor: string | null }

/** A scene stacked with the one shown (an elevation layer), as a player's board draws it: its floor and what stands in it, never what is on it. */
export interface BoardLayerRecord {
  id: string;
  /** Grid squares above the shown scene (negative: below it). */
  elevation: number;
  /** Where it stands on the plane beyond its height, seen from the shown scene. */
  stands: { x: number; y: number; turn: number };
  /** The asset id of its floor image. */
  image: string;
  grid: { size: number; offsetX: number; offsetY: number };
  /** Materials are those of `BoardExtras.materials`. */
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  fogHeight: number | null;
  wallThickness: number | null;
  /** The layer's painted water; absent for none. */
  water?: BoardWater;
}

export interface BoardExtras {
  sceneId: string;
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  materials: BoardMaterialRecord[];
  ambient: number | null;
  /** The colour the GM tinted the board's daylight, '#rrggbb'; absent or null for none. */
  tint?: string | null;
  lighting: BoardLighting;
  fogHeight: number | null;
  /** How thick walls stand, as a share of a grid square; null is the board's default. */
  wallThickness: number | null;
  /** The scenes stacked with this one, lowest first; absent when it stands alone (or from an older Connect). */
  layers?: BoardLayerRecord[];
  /** The water painted on the scene and how it moves (Tabletop's saved mask); absent for none, or from an older Connect. */
  water?: BoardWater;
  /** How the GM draws the scenes stacked above (Tabletop's Upper layers); absent from an older Connect. */
  layerLook?: 'solid' | 'faded' | 'transparent';
}

/** Painted water as Tabletop keeps it: the mask's size in texels, its run lengths (base64 varints), and its motion. */
export type BoardWater = { mask: { width: number; height: number; data: string }; motion?: { kind: string; amount: number; direction: number; tint: string; clarity: number } | null };

/** A 3D camera in the board's world: x and z are the map's x and y in pixels, y is up. */
export interface BoardCamera {
  sceneId: string;
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * One shot of a running cutscene, as a player's board plays it. `key` names the shot's map for this run only (`k1`, `k2`,
 * …): a vault path never leaves the GM's machine. Camera poses are in the board's world (see `BoardCamera`).
 */
export interface BoardCutsceneShot {
  /** The run-local name of the shot's map; the keys of `GmCutscene.maps`. Matches `^k[0-9]{1,4}$`. */
  key: string;
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  /** Milliseconds from the start of the run (0..3 600 000). The time between two shots is how long the transition into the later one takes. */
  at: number;
  /** A keyframe shot shapes the camera path but the run never rests on it. */
  keyframe: boolean;
  /** How the run gets into this shot (ignored for the first). A `move` only joins two shots on one map. */
  transition: 'fade' | 'cut' | 'move';
}

/**
 * A cutscene running for players: sent to every admitted player whenever it changes, and `null` when it ends. Prepared:
 * each player's board plays the shots locally (nothing streams the camera). Live: the board follows the GM's camera,
 * which arrives separately (`CutsceneSource.camera`). Limits both sides check: at most 200 shots; `runId` matches
 * `^[A-Za-z0-9_-]{1,64}$`; every coordinate is finite with |value| ≤ 1e7; `look.fadeMs` is 100..3000; `look.bars` is null or
 * one of 1.85, 2, 2.39. Tabletop keeps to the shot, time and coordinate limits itself (the studio refuses past them and a run
 * of a cutscene that breaks them does not start).
 *
 * Reading the news:
 * - The first publication of a `runId` starts the run (fade to black, then in on the step's shot). A board that joins later
 *   starts at the latest publication's `step.shot`, at rest, with no transition.
 * - Scene switch: prepared, the scene changes when the step's map `key` differs from the last publication's. Live bumps
 *   `seq` on every scene switch, and its `key` is then always a new one.
 * - Transition into a step: a cut when `step.shot` is lower than before or `seq` jumps by more than one; otherwise the
 *   step's own transition applies.
 * - A cross-map step: the player's board fades to black and holds black until Connect delivers the new map's revealed
 *   projection, then fades in. Connect sends that projection as soon as it sees the step change.
 * - `GmCutscene.maps` holds the maps of that publication only; it is not cumulative. Resolve `key` from the publication
 *   just read. `GmCutscene` objects are read-only for Connect.
 */
export interface BoardCutscene {
  /** Names this run: a new run has a new id, so a board tells a new run from a change of the one it plays. */
  runId: string;
  mode: 'prepared' | 'live';
  look: {
    /** The aspect ratio (width over height) the picture is letterboxed to, or null for no bars. */
    bars: number | null;
    /** Each way of a fade (to black, and back), in milliseconds. */
    fadeMs: number;
  };
  /** Prepared: at least one shot, sorted by `at`. Live: empty. */
  shots: BoardCutsceneShot[];
  /**
   * Prepared: the ordinary shot (index into `shots`) the run rests on, or is heading to by a transition; never a
   * keyframe shot except the first or the last. Live: `shot` is 0. `seq` starts at 1 and grows by one with every Next,
   * Previous and (live) change of scene, so a board can tell newer news from older and joins mid-run at the latest step.
   */
  step: { shot: number; seq: number };
  /** The run-local key of the map shown now: the step's shot's, or the GM's own scene in live. */
  key: string;
}

/** How `setCutscene` starts and ends a run on a player's board (Connect has the same shape in `playerBoardContract.ts`). */
export interface PlayerCutsceneOptions {
  /** Connect has just made this board for the run, over a view it faded to black itself: no enter fade. */
  startBlack?: boolean;
  /** At the leave fade's black the board does not reload its own scene: it calls `host.cutsceneOver()` and stays black. */
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
  readonly ambient: number | null;
  readonly tint?: string | null;
  /** The scenes stacked with this map, for players' boards; absent when sharing them is off. */
  readonly layers?: ReadonlyArray<BoardLayerLook>;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  /** The scene's painted water, for players. */
  readonly water?: BoardWater;
  /** How the GM draws the scenes stacked above (Upper layers), for players to see them the same. */
  readonly layerLook?: 'solid' | 'faded' | 'transparent';
  /** Where the players' AR marker sheets lie on this map, placed, for their phones; absent for none. */
  readonly arTable?: { squareMm: number; groups: ReadonlyArray<{ group: string; x: number; y: number; heading: number; w: number; h: number }> };
  /** The materials this map's walls use, with their texture maps by role (vault paths). */
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string> }>;
}

/** A scene stacked with a map, as Tabletop hands it to Connect (vault paths, which Connect turns into asset ids). */
export interface BoardLayerLook {
  elevation: number;
  stands: { x: number; y: number; turn: number };
  /** The vault path of its floor image. */
  image: string;
  grid: { size: number; offsetX: number; offsetY: number };
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
  }>;
  props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number; solid?: boolean; lift?: number }>;
  /** The layer's painted water. */
  water?: BoardWater;
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string>; tuning?: { relief: number; occlusion: number; shine: number; depth: number; displace: number; outward: number } }>;
  fogHeight: number | null;
  wallThickness: number | null;
}

/** What players do on a map, for the GM's board: a ping, or new points of a laser. */
export type BoardMark =
  | { kind: 'ping'; mapPath: string; x: number; y: number; color: string }
  | { kind: 'laser'; mapPath: string; from: string; points: BoardPoint[]; lifted: boolean; color: string };

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

export interface BoardSessionTemplate { id: string; owner: string; shape: 'line' | 'circle' | 'square' | 'cone'; start: BoardPoint; end: BoardPoint; color: string }

/** Connect's hosted session, handed to `api.attachSession` (Connect's `BoardSessionHub`; the shapes must stay the same). */
export interface BoardSession {
  hosting(): boolean;
  /**
   * A Connect that carries cutscenes to its players says so (and shows them the GM's shots by switching each GM map
   * tab's live snapshot). Absent from an older Connect, or one with no Atlas scene tabs: Tabletop refuses Play for players.
   */
  readonly cutscenes?: true;
  presentedMap(): string | null;
  overlay(mapPath: string): { templates: readonly BoardSessionTemplate[]; spells?: readonly unknown[]; coneAngle: number; handout: { path: string; title: string } | null };
  onChange(listener: () => void): () => void;
  onMark(listener: (mark: BoardMark) => void): () => void;
  /** Players' phones in augmented reality, as they move. Absent from an older Connect. */
  onViewer?(listener: (viewer: BoardViewer) => void): () => void;
  /** Players' surveys of the table's AR marker sheets. Absent from an older Connect. */
  onSurvey?(listener: (survey: BoardSurvey) => void): () => void;
  addTemplate(mapPath: string, add: { shape: BoardSessionTemplate['shape']; start: BoardPoint; end: BoardPoint }): boolean;
  eraseTemplate(mapPath: string, id: string): void;
  clearTemplates(mapPath: string): void;
  /** The GM casts a spell on the map's scene (through a token's eyes), in the GM's colour; false when it cannot. */
  /** `rules` (what it does beyond its shape) go beside the spell; an older Connect leaves them out. */
  castSpell?(mapPath: string, spell: Spell, rules?: SpellRules, words?: { name: string; about?: SpellAbout }): boolean;
  /** Takes a player's spell off the map's scene (an older Connect has no spells). */
  eraseSpell?(mapPath: string, id: string): void;
  clearSpells?(mapPath: string): void;
  /**
   * Tokens are moving from the map `from` to the stacked map `to` (each as `newId`, the same id unless `to` had one):
   * told before they move, so their players keep them and are shown `to`. Absent from an older Connect.
   */
  tokensMoved?(move: { from: string; to: string; tokens: ReadonlyArray<{ id: string; newId: string }> }): void;
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
