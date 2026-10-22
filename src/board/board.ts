/**
 * The 3D board: an Atlas map drawn as a table, with its tokens, pins and props, a camera that moves like
 * TacticalEngine's, and the pointer and keys that drive them.
 *
 * - Left-drag on a token carries it (its mini leans and walks the way Tabletop's minis always have); on release it
 *   snaps to the grid like Atlas, glides there, and the move is saved once.
 * - Ctrl + left-drag on a prop carries the prop.
 * - A click on a pin opens its note; a right-click on a token or a prop opens its menu; a click on a token selects it
 *   (and wobbles its mini), a click on the empty board or Escape lets it go. The selected token gets Atlas's resource
 *   controls: − / + beside each bar and wheel, and a click on one opens Atlas's editor for it.
 * - Atlas's fog of war stands on the map as a see-through block, as tall as the toolbar's settings say.
 * - The laser pointer (Atlas's): while it is on, the pointer is a glowing dot, and a press draws a beam that fades
 *   behind it. Players see it too. Right-drag still pans and the wheel zooms. V switches between it and moving (Atlas's
 *   Move/Select key), as the toolbar's Move/Select menu does; Escape turns it off.
 * - The local player view (a second window, for a screen the players look at) draws the same scene as players see it:
 *   no hidden tokens, nothing under the fog (which is solid), no pins, only the resources shown to players. It follows
 *   the GM's camera, live, unless the GM froze it.
 * - Any other drag moves the camera: left or middle orbits, right pans. The wheel zooms. WASD or the arrow keys pan,
 *   Q and E turn, Home frames the map.
 *
 * It talks to Obsidian only through its `BoardHost`, so the harness can drive it, and draws only when something
 * moves: the camera easing, a token gliding, a mini's clip playing.
 */
import * as THREE from 'three';
import type { MiniPlacement } from '../assignments';
import type { LoadedMini } from '../library';
import type { PropPlacement, TokenStyle } from './boardData';
import { OrbitCamera, limitsFor } from './camera';
import type { CollectionRules } from './conditions';
import { formatDistance, pathLengthInCells, type Measurement } from './measure';
import { hexCenter, ringDiameter, snapPoint } from './geometry';
import { TokenLabels, type HoverTarget } from './labels';
import type { BoardMap, BoardToken } from './mapModel';
import { ResourceControls, openValueEditor, type ControlSpec, type EditorAnchor, type ScreenRect, type ValueEditor } from './resourceControls';
import { resourceUpdate, withCurrent, type ResourceValue } from './resources';
import { IconPiece, InkPiece, PinPiece, PropPiece, TextPiece, TokenPiece, type PoseContext } from './pieces';
import { numberCells, type CellNumbers } from './cellNumbers';
import { stripGeometry } from './surface';
import { ResolutionGovernor, type QualityPreset } from './quality';
import { BoardSurface } from './surface';
import { FogVolume } from './fogVolume';
import { LaserBeam } from './laserBeam';
import { LaserTrail, beamWidth, smoothBeam, type LaserSettings } from './laser';
import { BoardToolbar, type DiceButton } from './toolbar';
import { pinTitle } from './pinIcons';
import { NO_INSTANCE_NUMBERS, badgeNumberInView, insideFog, numberTokensInView, playerSees } from './playerView';
import { positionOf } from './camera';
import { loadImageTexture, plateTexture, screenScale } from './textures';
import { WallSet } from './wallPieces';
import { LightRig } from './lightRig';
import { DarknessLayer } from './darkness';
import { BoardMarks } from './marks';
import { PlayerToolState, type TemplateMark, type TemplateShape, type ToolAction } from './playerTools';
import type { FogOperation } from './fog';
import { segmentFrame, type BoardLight } from './walls';
import { MATERIAL_DRAG_TYPE, MATERIAL_TEXT_PREFIX, type LoadedMaterial } from '../materials';
import type { DiceObstacle, DiceTable, DiceTableHost } from '../dice/diceTable';

/** Obsidian's accent colour, for highlights; Atlas's purple outside Obsidian. */
function accent(element: HTMLElement): string {
  const value = element.ownerDocument.defaultView?.getComputedStyle(element).getPropertyValue('--interactive-accent').trim();
  return value || ACCENT;
}

export interface BoardHost {
  /** A URL for a vault image, or null when it is missing. */
  readImage(path: string): Promise<string | null>;
  /** A GLB read into a model; rejects with the reason it cannot be drawn. */
  readMini(path: string): Promise<LoadedMini>;
  placement(tokenId: string): MiniPlacement | null;
  style(tokenId: string): TokenStyle;
  props(): readonly PropPlacement[];
  rules(): CollectionRules;
  moveToken(id: string, x: number, y: number): void;
  moveProp(id: string, x: number, y: number): void;
  addProp(glb: string, x: number, y: number): void;
  openNote(path: string): void;
  tokenMenu(id: string, event: MouseEvent): void;
  propMenu(id: string, event: MouseEvent): void;
  /** Shows a token's stat block (Ctrl/Cmd + hover). */
  statblockPreview(id: string, event: MouseEvent): void;
  /** Saves a copy of a token (Alt + drag) under `newId` at (x, y). */
  copyToken(id: string, newId: string, x: number, y: number): void;
  /**
   * Saves a resource edited from the token's controls: `edit` turns the value held now (by Atlas, or in the file) into
   * the new one, so quick steps add up; `maxEdited` says the maximum was set by hand.
   */
  editResource(id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): void;
  /** How distances are measured and labelled on this map. */
  measurement(): Measurement;
  /** How tall the map's fog stands, in grid squares; and saving a new height. */
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** How thick the walls stand, as a share of a grid square. */
  wallThickness(): number;
  setWallThickness(thickness: number): void;
  /** Shown once per message. */
  warn(message: string): void;
  /** Opens or closes the local player view of this map; whether it is open. */
  togglePlayerView(): void;
  playerViewOpen(): boolean;
  /** The laser's colour and size, kept for every map; and saving a change. */
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** Whether the initiative tracker shows on the board; showing or hiding it. */
  initiativeOpen(): boolean;
  toggleInitiative(): void;
  /** The material painted on a wall or door (a materials folder), and the prop standing in for a door; null for none. */
  wallMaterial(id: string): string | null;
  /** A wall's or door's own height in grid squares; null stands it as tall as the fog. */
  wallHeight(id: string): number | null;
  /** Keeps a wall's height (Ctrl + drag), with Shift the whole wall's; and a light's. In grid squares. */
  setWallHeight(id: string, squares: number, whole: boolean): void;
  setLightHeight(id: string, squares: number): void;
  doorProp(id: string): string | null;
  /** Loads a material of the gallery; null when it cannot be read. */
  readMaterial(path: string): Promise<LoadedMaterial | null>;
  /** Opens or shuts a door (Atlas's `toggleDoor`); the board shows it at once unless the door is locked. */
  toggleDoor(id: string): void;
  /** A wall's or door's right-click menu. */
  wallMenu(id: string, event: MouseEvent): void;
  /** The board's ambient light (0–1), and keeping a new level. */
  ambient(): number;
  setAmbient(level: number): void;
  /** How high a light hangs, in grid squares. */
  lightHeight(light: BoardLight): number;
  /** A light's right-click menu (on its bulb). */
  lightMenu(id: string, event: MouseEvent): void;
  /** A material dropped from the gallery on a wall or door: that segment, or with Shift the whole wall drawn with it. */
  paintWall(id: string, material: string, whole: boolean): void;
  /** The GM's camera or the players' moved (Connect follows it for its players' "GM view"). */
  cameraMoved?(): void;
  /** A Connect player's board: whether the player may drag this token now (one the GM lets them control). */
  canMove?(tokenId: string): boolean;
  /** A Connect player's board: the token under the pointer (null for none), the pointer in client pixels, Ctrl/Cmd down. */
  hoverToken?(tokenId: string | null, client: { x: number; y: number } | null, modifier: boolean): void;
  /** A Connect player's board: what a tool asks of the session (a ping, a template, laser points). */
  playerAction?(action: ToolAction): void;
  /** The player's own colour (their templates and laser while drawn). */
  ownColor?(): string;
  /** The tool, shape or colour changed on the board (Escape too): Connect's toolbar follows. */
  toolsChanged?(): void;
  /** Whether Connect hosts a session (the GM's board offers the Template tool then). */
  hosting?(): boolean;
}

/** Who looks at the board: the GM (everything, and the tools to change it), or a Connect player (what players see). */
export type BoardAudience = 'gm' | 'player';

const FOV = 35;
/** A press that moves less than this is a click (TacticalEngine). */
const DRAG_PX = 6;
const ORBIT_X = 0.006;
const ORBIT_Y = 0.004;
const PAN_PER_PX = 0.0016;
const WHEEL = 0.0012;
const KEY_PAN = 0.9;
const KEY_TURN = 1.6;
/** How fast a released token closes on its cell, per second. */
const GLIDE = 14;
/** The longest frame anything steps by, so a hidden tab does not fling a mini. */
const LONGEST_STEP = 1 / 15;
const FALLBACK_SIZE = 2000;
/** The hovered cell's label height on screen, in pixels. */
const CELL_LABEL_PX = 20;
const ACCENT = '#7c5cff';
/** How often a playing clip redraws the shadows, in seconds. */
const CLIP_SHADOW_STEP = 1 / 15;
/** How often a flame flickers when nothing else moves, in milliseconds (about 15 times a second). */
const FLICKER_MS = 66;
/** The camera settles this many squares from where the shadow-casting lights were chosen: they are chosen again. */
const CASTER_STEP_SQUARES = 3;
/** Atlas's default lit threshold: below this ambient light a scene is dark. */
const LIT_THRESHOLD = 0.25;
/** The board's daylight at full ambient light: the sky's and the sun's strength. */
const DAY_SKY = 1.5;
const DAY_SUN = 2.2;
/** A wall is never lower than this many squares, whatever the fog's height. */
const MIN_WALL_SQUARES = 0.25;
/** The plain looks of a wall (grey stone) and a door (dark wood) before a material is painted on. */
const PLAIN_WALL = 0x8d8780;
const PLAIN_DOOR = 0x6e4a2c;
/** Room left around the map when it is framed, for the tilt's perspective. */
const FRAME_MARGIN = 1.1;

interface TokenEntry {
  token: BoardToken;
  piece: TokenPiece;
  labels: TokenLabels;
  /** What the players' picture shows over the token, drawn only in that picture's pass. */
  playerLabels: TokenLabels;
  /** Where it is drawn, and where it is heading. */
  at: { x: number; y: number };
  goal: { x: number; y: number };
  mini: string | null;
}

/** The local player view's own drawing of the scene, in its window. */
interface PlayerScreen {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  view: THREE.PerspectiveCamera;
  resize: ResizeObserver;
  /** Where the GM froze the players' camera; null while it follows the GM's. */
  frozen: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number }; yaw: number; distance: number } | null;
  /** Its shadows are drawn on its next frame (it just opened, or it was resized). */
  shadowsDirty: boolean;
  /** Its camera is inside the fog: the picture is black. */
  blind: boolean;
}

/** The cell under the pointer: where it is and what it is called. */
interface HoveredCell {
  key: string;
  label: string;
  center: { x: number; y: number };
}

type Press =
  | {
    kind: 'camera'; button: number; x: number; y: number; lastX: number; lastY: number; moved: boolean;
    token: string | null; prop: string | null; pin: string | null; door: string | null; light: string | null;
    /** The spot of the board a pan holds under the pointer. */
    grab: { x: number; y: number } | null;
  }
  | {
    kind: 'token'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number };
    /** Alt was held: the drop makes a copy and the token goes back. */
    copy: boolean;
    /** The ruler: where the drag began (snapped), and the waypoints Space dropped. */
    start: { x: number; y: number };
    waypoints: Array<{ x: number; y: number }>;
  }
  | { kind: 'prop'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number } }
  /** Ctrl + drag on a wall or a light: up raises it, down lowers it; `start` is its height when the drag began, in squares. */
  | { kind: 'height'; target: 'wall' | 'light'; id: string; x: number; y: number; moved: boolean; start: number }
  /** The laser drawing its beam. */
  | { kind: 'laser'; x: number; y: number; moved: boolean }
  /** A Connect player's tool (measure, template, laser, ping) under way. */
  | { kind: 'tool'; x: number; y: number; moved: boolean };

export class Board {
  readonly canvas: HTMLCanvasElement;
  camera: OrbitCamera = new OrbitCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly view = new THREE.PerspectiveCamera(FOV, 1, 1, 10_000);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tooltip: HTMLElement;
  private readonly resize: ResizeObserver;
  private readonly stops: Array<() => void> = [];
  private surface: BoardSurface | null = null;
  private map: BoardMap | null = null;
  private size = { width: 0, height: 0 };
  private hasImage = false;
  private readonly tokens = new Map<string, TokenEntry>();
  private pins: PinPiece[] = [];
  private icons: IconPiece[] = [];
  private texts: TextPiece[] = [];
  private inks: InkPiece[] = [];
  /** The grid's numbered cells, and the cell under the pointer with its highlight and label. */
  private cells: CellNumbers = { at: () => null };
  hoveredCell: string | null = null;
  private cellOutline: THREE.Mesh | null = null;
  private cellLabel: THREE.Sprite | null = null;
  private cellLabelAspect = 1;
  private readonly props = new Map<string, PropPiece>();
  private readonly arts = new Map<string, Promise<THREE.Texture | null>>();
  private readonly models = new Map<string, Promise<LoadedMini | null>>();
  private press: Press | null = null;
  private placing: string | null = null;
  /** The material a click paints walls with, chosen in the gallery; null when not painting. */
  private painting: string | null = null;
  private readonly held = new Set<string>();
  private frameId = 0;
  private last = 0;
  private clock = 0;
  private disposed = false;
  private governor: ResolutionGovernor;
  /** The last frame asked for the next one: the time between them is a real frame time, not a rest. */
  private continuing = false;
  /** Something on the board changed since the shadows were last drawn. */
  private shadowsDirty = true;
  private shadowedAt = 0;
  private ruler: THREE.Group | null = null;
  /** The ruler being shown: its points (start, waypoints, landing) and its label. */
  rulerState: { points: Array<{ x: number; y: number }>; label: string } | null = null;
  /** The token whose resource controls show. */
  private selectedId: string | null = null;
  private readonly selectListeners = new Set<(id: string | null) => void>();
  private readonly controls: ResourceControls;
  private readonly fog = new FogVolume();
  /** Atlas's walls and doors, and the materials they are painted with, by key (a folder, or the plain looks). */
  private readonly walls: WallSet;
  private readonly wallMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Atlas's lights, and the board's daylight they shine against (a level shown while the slider moves). */
  private readonly rig = new LightRig();
  private readonly hemisphere = new THREE.HemisphereLight(0xfff4e6, 0x2a2430, DAY_SKY);
  private ambientShown: number | null = null;
  /** The height being dragged (Ctrl + drag), shown before it is kept. */
  private heightDrag: { target: 'wall' | 'light'; id: string; value: number } | null = null;
  /** Where the camera was when the shadow-casting lights were last chosen. */
  private castersAt = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  private flickerTimer = 0;
  private readonly toolbar: BoardToolbar;
  private player: PlayerScreen | null = null;
  /** Copy numbers as players see them, kept from sync to sync so a token keeps its number. */
  private playerNumbers = NO_INSTANCE_NUMBERS;
  /** The window whose animation frame is asked for: the GM's, or the players' while the GM's is hidden. */
  private frameWin: Window | null = null;
  /** The laser: whether it is on, the beam's trail, where the pointer is (on the screen and on the map). */
  private laserOn = false;
  private readonly laserTrail = new LaserTrail();
  private readonly beam = new LaserBeam();
  private laserClient: { x: number; y: number } | null = null;
  private laserPoint: { x: number; y: number } | null = null;
  /** The open resource editor: whose, which resource, the value it opened on. */
  private editor: { tokenId: string; key: string; value: ResourceValue; view: ValueEditor } | null = null;
  /** How the last frame sized things on screen, to size what a reload rebuilds before the next frame. */
  private lastPose: PoseContext | null = null;
  /** The token whose stat block was last shown, so a hover shows it once. */
  private previewed: string | null = null;

  /** Who looks at it; a player's board shows what players see and changes nothing but its own tokens' places. */
  readonly audience: BoardAudience;
  /** The darkness of a lit scene, on a player's board (Connect sends it). */
  private readonly darkness = new DarknessLayer();
  /** A Connect player's tools, and what people mark on the board in a session (templates, pings, lasers). */
  readonly tools = new PlayerToolState();
  readonly marks = new BoardMarks();
  /** A player's camera stands inside the fog: the picture is black. */
  private blind = false;
  /** The thrower's dice, drawn on this board only: never in the players' picture. */
  private dice: DiceTable | null = null;

  constructor(private readonly container: HTMLElement, private readonly host: BoardHost, private quality: QualityPreset, options: { audience?: BoardAudience } = {}) {
    this.audience = options.audience ?? 'gm';
    const doc = container.ownerDocument;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'atlas-tabletop-board';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.tooltip = doc.createElement('div');
    this.tooltip.className = 'atlas-tabletop-tooltip';
    this.tooltip.hidden = true;
    container.appendChild(this.tooltip);
    this.walls = new WallSet({
      look: (path, door) => this.wallLook(path, door),
      materialOf: (id) => this.host.wallMaterial(id),
      heightOf: (id) => (this.heightDrag?.target === 'wall' && this.heightDrag.id === id ? this.heightDrag.value : this.host.wallHeight(id)),
      propOf: (id) => this.host.doorProp(id),
      prop: (glb) => this.model(glb),
    });
    this.scene.add(this.fog.object3d, this.beam.object3d, this.walls.object3d, this.rig.object3d);
    this.toolbar = new BoardToolbar(container, {
      fogHeight: () => this.host.fogHeight(),
      setFogHeight: (height) => this.host.setFogHeight(height),
      wallThickness: () => this.host.wallThickness(),
      setWallThickness: (thickness) => this.host.setWallThickness(thickness),
      playerViewOpen: () => this.host.playerViewOpen(),
      laserOn: () => this.laserOn,
      selectTool: (tool) => this.setLaser(tool === 'laser'),
      laser: () => this.host.laser(),
      setLaser: (changes) => { this.host.setLaser(changes); this.wake(); },
      togglePlayerView: () => this.host.togglePlayerView(),
      playerFrozen: () => this.player?.frozen != null,
      togglePlayerFreeze: () => this.setPlayerFrozen(this.player?.frozen == null),
      hosting: () => this.host.hosting?.() === true,
      templateOn: () => this.tools.tool === 'template',
      templateShape: () => this.tools.templateShape,
      clearTemplates: () => { this.host.playerAction?.({ type: 'template', change: { clear: true } }); },
      selectTemplate: (shape) => {
        if (shape === null) this.tools.select('move');
        else this.tools.selectTemplateShape(shape as TemplateShape);
        this.toolsChanged();
        this.toolbar.refresh();
      },
      initiativeOpen: () => this.host.initiativeOpen(),
      toggleInitiative: () => this.host.toggleInitiative(),
      ambient: () => this.ambientShown ?? this.host.ambient(),
      setAmbient: (level, keep) => {
        this.ambientShown = keep ? null : level;
        if (keep) this.host.setAmbient(level);
        this.applyLighting();
      },
    });
    this.toolbar.setHidden(this.audience === 'player');
    this.tools.eraseAny = this.audience === 'gm';
    this.scene.add(this.darkness.object3d, this.marks.object3d);
    this.controls = new ResourceControls(container, {
      step: (key, delta) => this.stepResource(key, delta),
      edit: (key) => this.openEditor(key),
    });

    // The fast card where the browser lets a page ask (a Mac with two); on Windows, Tabletop's graphics card setting.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The resolution follows the quality setting, and drops while the board cannot keep up (adaptive resolution).
    this.governor = new ResolutionGovernor(quality, doc.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(this.governor.ratio);
    // Shadows are redrawn only when something on the board moves, not when only the camera does.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.background = new THREE.Color(0x0f0c0a);
    this.scene.add(this.hemisphere);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.listen();
    this.fit();
  }

  /** Shows a map: the first load frames it, later loads (the file changed) keep the camera where it is. */
  async load(map: BoardMap): Promise<void> {
    this.showCell(null);
    const first = this.map === null;
    const sameImage = this.map?.background === map.background;
    this.map = map;
    if (first || !sameImage || this.gridChanged(map)) await this.buildSurface(map);
    if (this.disposed) return;
    if (first) {
      this.camera = new OrbitCamera({ target: { x: this.size.width / 2, y: 0, z: this.size.height / 2 }, pitch: 0.95 }, limitsFor(this.size.width, this.size.height));
      this.frameMap();
      this.camera.snap();
    }
    this.sync();
  }

  /** The drawing resolution now, as a share of the screen's pixels. */
  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  /**
   * Applies a quality preset. Antialiasing is fixed when the board is made, so a preset that changes it returns false:
   * the board must be made again.
   */
  setQuality(preset: QualityPreset): boolean {
    if (preset.antialias !== this.quality.antialias) return false;
    this.quality = preset;
    this.governor = new ResolutionGovernor(preset, this.container.ownerDocument.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(this.governor.ratio);
    this.fit();
    if (this.sun.shadow.mapSize.x !== preset.shadowMapSize) {
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    for (const entry of this.tokens.values()) entry.piece.setMiniShadows(preset.miniShadows);
    this.applyLighting();
    this.wake(true);
    return true;
  }

  /** Re-reads the minis, styles, props and rules from the host (they changed outside the map file). */
  refresh(): void {
    if (this.map) this.sync();
  }

  /** The next left click on the board drops a prop of `glb` there. */
  placeProp(glb: string): void {
    this.placing = glb;
    this.canvas.style.cursor = 'crosshair';
    this.canvas.focus();
  }

  /**
   * Looks at the whole map from the current angle: far enough out that the circle around it fits the narrower of the
   * view's two fields of view, so it fits however the camera has turned, with a margin for the tilt.
   */
  frameMap(): void {
    const half = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * Math.min(1, this.view.aspect);
    const fit = (Math.hypot(this.size.width, this.size.height) / 2 / half) * FRAME_MARGIN;
    // `frame` stands back 1.8 × the radius it is given (TacticalEngine's framing).
    this.camera.frame({ x: this.size.width / 2, y: 0, z: this.size.height / 2 }, fit / 1.8);
    this.wake();
  }

  private gridChanged(map: BoardMap): boolean {
    return this.lastGrid !== JSON.stringify(map.grid);
  }

  private lastGrid = '';

  private async buildSurface(map: BoardMap): Promise<void> {
    let texture: THREE.Texture | null = null;
    if (map.background) {
      const url = await this.host.readImage(map.background);
      if (url) {
        try {
          texture = await loadImageTexture(url);
        } catch {
          this.host.warn(`Tabletop: cannot read the map image ${map.background}.`);
        }
      } else {
        this.host.warn(`Tabletop: the map image ${map.background} is missing.`);
      }
    }
    if (this.disposed) { texture?.dispose(); return; }
    const image = texture?.image as { width?: number; height?: number } | undefined;
    const width = image?.width || FALLBACK_SIZE;
    const height = image?.height || FALLBACK_SIZE;
    this.surface?.object3d.removeFromParent();
    this.surface?.dispose();
    this.surface = new BoardSurface(width, height, map.grid);
    this.surface.setImage(texture);
    this.scene.add(this.surface.object3d);
    this.size = { width, height };
    this.hasImage = texture !== null;
    this.cells = numberCells(map.grid, width, height);
    this.lastGrid = JSON.stringify(map.grid);
    const span = Math.max(width, height);
    this.sun.position.set(width / 2 - span * 0.5, span * 1.2, height / 2 - span * 0.7);
    this.sun.target.position.set(width / 2, 0, height / 2);
    const shadow = this.sun.shadow.camera;
    shadow.left = -span * 0.8;
    shadow.right = span * 0.8;
    shadow.top = span * 0.8;
    shadow.bottom = -span * 0.8;
    shadow.near = span * 0.1;
    shadow.far = span * 4;
    shadow.updateProjectionMatrix();
    this.view.near = span * 0.005;
    this.view.far = span * 40;
    this.view.updateProjectionMatrix();
  }

  /** Brings tokens, pins and props in line with the map and the host. */
  private sync(): void {
    const map = this.map!;
    const rules = this.host.rules();
    this.darkness.update((map as { darkness?: FogOperation[] }).darkness ?? []);
    try {
      this.fog.update(map.fog, this.host.fogHeight(), map.grid.size);
    } catch (error) {
      this.host.warn(`Tabletop: cannot show this map's fog of war: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Walls stand as tall as the fog (never quite flat, so a map with flat fog still shows them).
    this.updateWalls();
    this.applyLighting();
    // Combatants kept beside the map (Atlas 0.9) are no part of it: not drawn, not counted, not seen.
    const onMap = map.tokens.filter((token) => !token.offMap);
    // Players count copies among the tokens they see, ordered by the GM's numbers (Atlas's player window).
    this.playerNumbers = numberTokensInView(this.playerNumbers, onMap
      .filter((token) => playerSees(token, this.tokens.get(token.id)?.goal ?? token, this.fog.areas))
      .map((token) => ({ id: token.id, art: token.imagePath ?? '', rank: token.instanceNumber ?? Infinity })));
    const artUse = new Map<string, number>();
    for (const token of onMap) if (token.imagePath) artUse.set(token.imagePath, (artUse.get(token.imagePath) ?? 0) + 1);
    const seen = new Set<string>();
    for (const token of onMap) {
      seen.add(token.id);
      const shared = (artUse.get(token.imagePath ?? '') ?? 0) >= 2;
      const gmLook = { viewer: 'gm' as const, badge: map.tokenSettings.showInstanceBadges && shared ? token.instanceNumber : null };
      const playerLook = { viewer: 'player' as const, badge: badgeNumberInView(this.playerNumbers, token.id, map.tokenSettings.showInstanceBadges) };
      let entry = this.tokens.get(token.id);
      if (!entry) {
        const piece = new TokenPiece(token, map.grid, rules.definitions);
        piece.setMiniShadows(this.quality.miniShadows);
        const labels = new TokenLabels(token, map.tokenSettings, rules, gmLook);
        const playerLabels = new TokenLabels(token, map.tokenSettings, rules, playerLook);
        playerLabels.object3d.visible = false;
        piece.object3d.add(labels.object3d, playerLabels.object3d);
        this.scene.add(piece.object3d);
        entry = { token, piece, labels, playerLabels, at: { x: token.x, y: token.y }, goal: { x: token.x, y: token.y }, mini: null };
        this.tokens.set(token.id, entry);
      } else {
        entry.piece.update(token, rules.definitions);
        entry.labels.update(token, map.tokenSettings, rules, gmLook);
        entry.playerLabels.update(token, map.tokenSettings, rules, playerLook);
        entry.token = token;
        // A token being carried stays under the pointer; the file catches up on release.
        if (this.press?.kind !== 'token' || this.press.id !== token.id) entry.goal = { x: token.x, y: token.y };
      }
      entry.piece.setStyle(this.host.style(token.id));
      this.applyArt(entry);
      this.applyMini(entry);
    }
    for (const [id, entry] of [...this.tokens]) {
      if (seen.has(id)) continue;
      entry.labels.dispose();
      entry.playerLabels.dispose();
      entry.piece.dispose();
      this.tokens.delete(id);
    }
    if (this.selectedId !== null && !this.tokens.has(this.selectedId)) this.select(null);
    // An editor whose value changed under it (Atlas, another tab) would apply its change to a stale value.
    const editing = this.editor;
    if (editing) {
      const now = this.tokens.get(editing.tokenId)?.token.resources[editing.key];
      if (!now || now.current !== editing.value.current || now.max !== editing.value.max) editing.view.close();
    }

    // Icons are kept across reloads when nothing about them changed: each one loads its glyph, so a rebuilt one
    // would blink out.
    const iconKey = (icon: BoardMap['icons'][number]): string => JSON.stringify(icon);
    const kept = new Map(this.icons.map((piece) => [iconKey(piece.icon), piece]));
    this.icons = map.icons.map((icon) => {
      const old = kept.get(iconKey(icon));
      if (old) {
        kept.delete(iconKey(icon));
        return old;
      }
      const piece = new IconPiece(icon, () => this.wake(true));
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of kept.values()) piece.dispose();

    // Pen strokes, kept when they and their place in the order are unchanged.
    const inkKey = (ink: BoardMap['inks'][number], order: number): string => `${order}|${JSON.stringify(ink)}`;
    const keptInks = new Map(this.inks.map((piece, order) => [inkKey(piece.ink, order), piece]));
    this.inks = map.inks.map((ink, order) => {
      const old = keptInks.get(inkKey(ink, order));
      if (old) {
        keptInks.delete(inkKey(ink, order));
        return old;
      }
      const piece = new InkPiece(ink, order);
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of keptInks.values()) piece.dispose();

    // Text labels, kept like the icons when nothing about them changed: each one paints its letters.
    const textKey = (text: BoardMap['texts'][number]): string => JSON.stringify(text);
    const keptTexts = new Map(this.texts.map((piece) => [textKey(piece.label), piece]));
    this.texts = map.texts.map((text) => {
      const old = keptTexts.get(textKey(text));
      if (old) {
        keptTexts.delete(textKey(text));
        return old;
      }
      const piece = new TextPiece(text);
      this.scene.add(piece.object3d);
      return piece;
    });
    for (const piece of keptTexts.values()) piece.dispose();

    for (const pin of this.pins) pin.dispose();
    this.pins = map.pins.map((pin) => {
      const piece = new PinPiece(pin, map.grid);
      this.scene.add(piece.object3d);
      return piece;
    });

    const wanted = new Map(this.host.props().map((prop) => [prop.id, prop]));
    for (const [id, piece] of [...this.props]) {
      const next = wanted.get(id);
      if (next && next.glb === piece.placement.glb && next.scale === piece.placement.scale && next.rotation === piece.placement.rotation) {
        piece.placement = next;
        if (this.press?.kind !== 'prop' || this.press.id !== id) piece.place(next.x, next.y);
        continue;
      }
      piece.dispose();
      this.props.delete(id);
    }
    for (const prop of wanted.values()) {
      if (this.props.has(prop.id)) continue;
      const piece = new PropPiece(prop, map.grid);
      this.props.set(prop.id, piece);
      this.scene.add(piece.object3d);
      void this.model(prop.glb).then((model) => {
        if (this.props.get(prop.id) !== piece || !model) return;
        piece.setModel(model);
        this.wake(true);
      });
    }
    // What was rebuilt is sized on screen now: an unsized sprite fills the view for a press made before the next frame.
    const pose = this.lastPose;
    if (pose) {
      for (const pin of this.pins) pin.pose(pose);
      for (const entry of this.tokens.values()) {
        entry.labels.place(entry.piece.figureHeight(), ringDiameter(map.grid, entry.token.size) / 2, entry.piece.top);
        entry.labels.pose(pose);
        entry.playerLabels.place(entry.piece.figureHeight(), ringDiameter(map.grid, entry.token.size) / 2, entry.piece.top);
      }
    }
    this.wake(true);
  }

  private applyArt(entry: TokenEntry): void {
    const path = entry.token.imagePath;
    if (!path) { entry.piece.setArt(null); return; }
    let art = this.arts.get(path);
    if (!art) {
      art = this.host.readImage(path).then((url) => (url ? loadImageTexture(url) : null)).catch(() => null);
      this.arts.set(path, art);
    }
    void art.then((texture) => {
      if (this.tokens.get(entry.token.id) !== entry || entry.token.imagePath !== path) return;
      if (!texture) this.host.warn(`Tabletop: cannot show the token art ${path}.`);
      entry.piece.setArt(texture);
      this.wake(true);
    });
  }

  private applyMini(entry: TokenEntry): void {
    const placement = this.host.placement(entry.token.id);
    if (!placement) {
      entry.mini = null;
      entry.piece.setMini(null, null);
      return;
    }
    entry.mini = placement.mini;
    void this.model(placement.mini).then((model) => {
      if (this.tokens.get(entry.token.id) !== entry || entry.mini !== placement.mini) return;
      entry.piece.setMini(model, model ? placement : null);
      this.wake(true);
    });
  }

  private model(path: string): Promise<LoadedMini | null> {
    let found = this.models.get(path);
    if (!found) {
      found = this.host.readMini(path).catch((error: unknown) => {
        this.host.warn(`Tabletop: cannot show ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      this.models.set(path, found);
    }
    return found;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** The size and resolution the canvas was last given. */
  private fitted = { width: 0, height: 0, ratio: 0 };

  fit(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const ratio = this.renderer.getPixelRatio();
    // Sizing a WebGL canvas wipes it, even to the size it has: only a real change is applied.
    if (width === this.fitted.width && height === this.fitted.height && ratio === this.fitted.ratio) return;
    this.fitted = { width, height, ratio };
    this.renderer.setSize(width, height, false);
    this.view.aspect = width / height;
    this.view.updateProjectionMatrix();
    // The page may paint before the next frame: the wiped canvas is drawn again now, or the board blinks.
    this.redraw();
    this.wake();
  }

  /** Draws the board again at once with what it holds, outside the frame loop. */
  private redraw(): void {
    if (!this.map || this.disposed) return;
    try {
      this.drawMain();
    } catch (error) {
      console.error('[Tabletop] The board could not be drawn:', error);
    }
  }

  /** The board's own picture: the GM's, or on a player's board what players see (black inside the fog). */
  private drawMain(): void {
    if (this.audience === 'player') {
      this.showFor('player');
      this.blind = this.fog.hides(this.view.position, (point) => insideFog(this.fog.areas, point));
      if (this.blind) {
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear();
        return;
      }
    }
    this.fog.face(this.view.position);
    this.renderer.render(this.scene, this.view);
  }

  /** On a player's board: the GM's 3D view to glide to (the GM view button); null when there is none. */
  private gmPose: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null = null;

  setGmView(pose: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null): void {
    this.gmPose = pose ? { eye: { ...pose.eye }, target: { ...pose.target } } : null;
  }

  get hasGmView(): boolean {
    return this.gmPose !== null;
  }

  /** Glides to the GM's 3D view; false when there is none. */
  followGm(): boolean {
    const pose = this.gmPose;
    if (!pose) return false;
    this.camera.view(pose.eye, pose.target);
    this.wake();
    return true;
  }

  /** The line across the board's top (Connect hosting while Atlas does not hold the map); null takes it away. */
  setBanner(banner: { text: string; action?: { label: string; run(): void } } | null): void {
    let element = this.container.querySelector<HTMLElement>(':scope > .atlas-tabletop-banner');
    if (!banner) {
      if (element) element.hidden = true;
      return;
    }
    const doc = this.container.ownerDocument;
    // The same banner again is left as it is: rebuilt, its button would be swapped under the pointer.
    const key = JSON.stringify([banner.text, banner.action?.label ?? null]);
    if (element && !element.hidden && element.dataset.key === key) return;
    if (!element) {
      element = doc.createElement('div');
      element.className = 'atlas-tabletop-banner';
      element.setAttribute('role', 'status');
      this.container.appendChild(element);
    }
    element.hidden = false;
    element.dataset.key = key;
    element.replaceChildren();
    const text = doc.createElement('span');
    text.textContent = banner.text;
    element.appendChild(text);
    if (banner.action) {
      const { label, run } = banner.action;
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', () => run());
      element.appendChild(button);
    }
  }

  /** The image the GM shows players (Connect's handout), small in a corner; null takes it away. */
  setHandout(handout: { title: string; url: string | null } | null): void {
    let element = this.container.querySelector<HTMLElement>(':scope > .atlas-tabletop-handout');
    if (!handout) {
      if (element) element.hidden = true;
      return;
    }
    const doc = this.container.ownerDocument;
    // The same handout again is left as it is: rebuilt, its image would load again and flicker.
    const key = JSON.stringify([handout.title, handout.url]);
    if (element && !element.hidden && element.dataset.key === key) return;
    if (!element) {
      element = doc.createElement('div');
      element.className = 'atlas-tabletop-handout';
      this.container.appendChild(element);
    }
    element.hidden = false;
    element.dataset.key = key;
    element.replaceChildren();
    const title = doc.createElement('div');
    title.className = 'atlas-tabletop-handout__title';
    title.textContent = `Shown to players: ${handout.title}`;
    element.appendChild(title);
    if (handout.url) {
      const image = doc.createElement('img');
      image.src = handout.url;
      image.alt = handout.title;
      element.appendChild(image);
    }
  }

  /** Whether the picture is black (a player's camera inside the fog). */
  get isBlind(): boolean {
    return this.blind;
  }

  /** Asks for a frame; frames keep coming while anything moves. `changed` says the board itself changed (shadows). */
  wake(changed = false): void {
    if (changed) this.shadowsDirty = true;
    if (this.disposed || this.frameId !== 0) return;
    // A hidden window gets no animation frames: while the GM's is hidden, the players' window drives the drawing.
    const gm = this.container.ownerDocument;
    const players = this.player?.container.ownerDocument;
    const win = (gm.hidden && players && !players.hidden ? players.defaultView : gm.defaultView) ?? window;
    this.frameWin = win;
    this.frameId = win.requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    this.frameId = 0;
    if (this.disposed) return;
    const interval = this.last === 0 ? 0 : (time - this.last) / 1000;
    const dt = Math.min(LONGEST_STEP, interval);
    this.last = time;
    if (this.continuing) {
      const ratio = this.governor.sample(interval);
      if (ratio !== null) {
        this.renderer.setPixelRatio(ratio);
        this.fit();
      }
    }
    this.clock += dt;
    this.steer(dt);
    const cameraMoving = this.camera.update(dt);
    let busy = cameraMoving;
    // Settled somewhere new: the lights nearest it cast the shadows now.
    const target = this.camera.goal.target;
    if (!cameraMoving && this.map && Math.hypot(target.x - this.castersAt.x, target.z - this.castersAt.z) > this.map.grid.size * CASTER_STEP_SQUARES) {
      this.castersAt = { x: target.x, z: target.z };
      if (this.rig.castShadows(this.quality.lightShadows, this.castersAt)) this.shadowsDirty = true;
    }
    this.applyView();
    const viewHeight = this.renderer.domElement.clientHeight || 1;
    const context: PoseContext = {
      dt,
      now: this.clock,
      zoom: viewHeight / (2 * this.camera.pose.distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)),
      yaw: this.camera.pose.yaw,
      pixel: screenScale(1, viewHeight, FOV),
    };
    this.lastPose = context;
    if (this.drawLaser()) busy = true;
    const doorsMoving = this.walls.step(dt);
    if (doorsMoving) busy = true;
    if (this.marks.step(this.clock, context.pixel)) busy = true;
    this.rig.step(this.clock);
    const glide = 1 - Math.exp(-GLIDE * dt);
    let changed = this.shadowsDirty || this.press?.kind === 'token' || this.press?.kind === 'prop' || doorsMoving;
    let moving = false;
    // Dice in the air step with the frame, and keep frames (and shadows) coming until the last one is read.
    if (this.dice?.busy) {
      this.dice.step(dt * 1000);
      busy = true;
      changed = true;
      moving = true;
    }
    for (const entry of this.tokens.values()) {
      const dx = entry.goal.x - entry.at.x;
      const dy = entry.goal.y - entry.at.y;
      if (Math.abs(dx) > 0.05 || Math.abs(dy) > 0.05) {
        entry.at.x += dx * glide;
        entry.at.y += dy * glide;
        busy = true;
        changed = true;
        moving = true;
      } else {
        entry.at.x = entry.goal.x;
        entry.at.y = entry.goal.y;
      }
      entry.piece.pose(entry.at.x, entry.at.y, context);
      // A light the token carries goes with it.
      this.rig.place(entry.token.id, entry.at.x, entry.at.y);
      entry.labels.place(entry.piece.figureHeight(), ringDiameter(this.map!.grid, entry.token.size) / 2, entry.piece.top);
      entry.labels.pose(context);
      if (this.audience === 'player') entry.playerLabels.pose(context);
      entry.playerLabels.place(entry.piece.figureHeight(), ringDiameter(this.map!.grid, entry.token.size) / 2, entry.piece.top);
      if (entry.piece.animating) {
        busy = true;
        changed = true;
      }
    }
    for (const pin of this.pins) pin.pose(context);
    this.ruler?.traverse((node) => {
      if (!(node as THREE.Sprite).isSprite) return;
      const aspect = (node.userData.aspect as number | undefined) ?? 1;
      node.scale.set(context.pixel * 22 * aspect, context.pixel * 22, 1);
    });
    if (this.cellLabel) this.cellLabel.scale.set(context.pixel * CELL_LABEL_PX * this.cellLabelAspect, context.pixel * CELL_LABEL_PX, 1);
    // A mini's clip alone redraws the shadows a few times a second, not every frame.
    const clipsOnly = changed && !this.shadowsDirty && this.press === null && !moving;
    const shadows = changed && (!clipsOnly || this.clock - this.shadowedAt >= CLIP_SHADOW_STEP);
    if (shadows) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowedAt = this.clock;
    }
    this.shadowsDirty = false;
    this.drawMain();
    this.layoutControls();
    this.drawPlayers(shadows, context);
    if (cameraMoving) this.host.cameraMoved?.();
    this.continuing = busy || this.held.size > 0 || this.press !== null;
    if (this.continuing) this.wake();
    // Flames flicker on a timer, a few times a second, not on every frame the screen can draw; those frames are
    // rests to the resolution governor.
    else if (this.rig.animated && this.flickerTimer === 0) {
      const win = this.frameWin ?? this.container.ownerDocument.defaultView ?? window;
      this.flickerTimer = win.setTimeout(() => { this.flickerTimer = 0; this.wake(); }, FLICKER_MS);
    }
  }

  private steer(dt: number): void {
    if (this.held.size === 0) return;
    const speed = this.camera.goal.distance * KEY_PAN * dt;
    let right = 0;
    let forward = 0;
    if (this.held.has('a') || this.held.has('arrowleft')) right -= 1;
    if (this.held.has('d') || this.held.has('arrowright')) right += 1;
    if (this.held.has('w') || this.held.has('arrowup')) forward += 1;
    if (this.held.has('s') || this.held.has('arrowdown')) forward -= 1;
    if (right !== 0 || forward !== 0) this.camera.pan(right * speed, forward * speed);
    if (this.held.has('q')) this.camera.orbit(KEY_TURN * dt, 0);
    if (this.held.has('e')) this.camera.orbit(-KEY_TURN * dt, 0);
  }

  // ── Pointer and keys ──────────────────────────────────────────────────────

  /** Puts the drawn camera where the orbit camera's pose says, so rays cast before the next frame see it too. */
  private applyView(): void {
    const eye = this.camera.position();
    const target = this.camera.pose.target;
    this.view.position.set(eye.x, eye.y, eye.z);
    this.view.lookAt(target.x, target.y, target.z);
    this.view.updateMatrixWorld();
  }

  private ray(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.applyView();
    this.raycaster.setFromCamera(ndc, this.view);
  }

  /**
   * Pans so the spot `grab` is under the pointer at (x, y): the board moves exactly with the hand. Without a spot (the
   * pan began off the board) it falls back to TacticalEngine's rate.
   */
  private panTo(grab: { x: number; y: number } | null, x: number, y: number): void {
    const now = grab ? this.boardPoint(x, y) : null;
    if (grab && now) {
      this.camera.goal.target.x += grab.x - now.x;
      this.camera.goal.target.z += grab.y - now.y;
      return;
    }
    const press = this.press;
    if (press?.kind !== 'camera') return;
    const scale = this.camera.goal.distance * PAN_PER_PX;
    this.camera.pan(-(x - press.lastX) * scale, (y - press.lastY) * scale);
  }

  /** The point of the board under the pointer, in map pixels. */
  boardPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    this.ray(clientX, clientY);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  private hit<T extends THREE.Object3D>(clientX: number, clientY: number, objects: T[]): T | null {
    this.ray(clientX, clientY);
    // Rays use the world matrices of the last frame drawn: what a reload rebuilt since would still sit at the origin.
    for (const object of objects) object.updateWorldMatrix(true, false);
    const hits = this.raycaster.intersectObjects(objects, false);
    return (hits[0]?.object as T | undefined) ?? null;
  }

  /** The token under the pointer: its figure, or anything drawn over it (name, bars, wheels). */
  private tokenAt(clientX: number, clientY: number): string | null {
    const owners = new Map<THREE.Object3D, string>();
    for (const entry of this.tokens.values()) {
      owners.set(entry.piece.hitTarget, entry.token.id);
      for (const sprite of entry.labels.sprites) owners.set(sprite, entry.token.id);
    }
    const hit = this.hit(clientX, clientY, [...owners.keys()]);
    return hit ? owners.get(hit) ?? null : null;
  }

  private pinAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, this.pins.map((pin) => pin.hitTarget));
    return (hit?.userData.pinId as string | undefined) ?? null;
  }

  /** Stands the map's walls: as tall as the fog, or each at its own height (or the one being dragged). */
  private updateWalls(): void {
    const map = this.map;
    if (!map) return;
    const fog = this.fog.areas;
    this.walls.update(map.walls, {
      height: Math.max(MIN_WALL_SQUARES, this.host.fogHeight()) * map.grid.size,
      tile: map.grid.size,
      thickness: this.host.wallThickness() * map.grid.size,
      fogged: (x, y) => insideFog(fog, { x, y }),
      fogKey: map.fog.map((operation) => operation.id).join(','),
    });
  }

  /** A wall's height as it stands now, in squares: its own, else the fog's (half for a low wall). */
  private wallSquares(id: string): number {
    const wall = this.map?.walls.find((candidate) => candidate.id === id);
    const fog = Math.max(MIN_WALL_SQUARES, this.host.fogHeight());
    return this.host.wallHeight(id) ?? (wall?.limited ? fog / 2 : fog);
  }

  /** How many grid squares one pixel of the screen spans where the camera looks. */
  private squaresPerPixel(): number {
    const height = this.renderer.domElement.clientHeight || 1;
    const span = 2 * this.camera.pose.distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    return span / height / (this.map?.grid.size ?? 70);
  }

  /** The light whose bulb is under a point of the screen. */
  private lightAt(clientX: number, clientY: number): string | null {
    this.ray(clientX, clientY);
    return this.rig.lightAt(this.raycaster);
  }

  /**
   * The board's light: its daylight at the ambient level (the sun casts no shadow in the dark), and Atlas's lights
   * against it, the nearest casting shadows as the quality allows.
   */
  private applyLighting(): void {
    const map = this.map;
    if (!map) return;
    const ambient = this.ambientShown ?? this.host.ambient();
    this.hemisphere.intensity = DAY_SKY * ambient;
    this.sun.intensity = DAY_SUN * ambient;
    // Below Atlas's lit threshold the scene is dark: the sun casts no shadow there.
    const sunCasts = ambient >= LIT_THRESHOLD;
    if (this.sun.castShadow !== sunCasts) { this.sun.castShadow = sunCasts; this.shadowsDirty = true; }
    const measurement = this.host.measurement();
    this.rig.update(map.lights, {
      unitDistance: measurement.unitDistance > 0 ? measurement.unitDistance : 5,
      cell: map.grid.size,
      ambient,
      litThreshold: LIT_THRESHOLD,
      heightOf: (light) => (this.heightDrag?.target === 'light' && this.heightDrag.id === light.id ? this.heightDrag.value : this.host.lightHeight(light)) * map.grid.size,
    });
    // Token lights stand where their tokens are drawn now.
    for (const entry of this.tokens.values()) this.rig.place(entry.token.id, entry.at.x, entry.at.y);
    const target = this.camera.goal.target;
    this.castersAt = { x: target.x, z: target.z };
    if (this.rig.castShadows(this.quality.lightShadows, this.castersAt)) this.shadowsDirty = true;
    this.wake(true);
  }

  /** The door under a point of the screen. */
  private doorAt(clientX: number, clientY: number): string | null {
    this.ray(clientX, clientY);
    return this.walls.doorAt(this.raycaster);
  }

  /** The wall or door under a point of the screen. */
  wallAt(clientX: number, clientY: number): string | null {
    this.ray(clientX, clientY);
    return this.walls.wallAt(this.raycaster);
  }

  /** Opens or shuts a door: at once on the board (a locked one stays shut), saved by the host. */
  toggleDoor(id: string): void {
    const wall = this.map?.walls.find((candidate) => candidate.id === id);
    if (!wall) return;
    if (!wall.locked) {
      wall.closed = !wall.closed;
      this.walls.setOpen(id, !wall.closed);
      this.wake(true);
    }
    this.host.toggleDoor(id);
  }

  /** The material of walls painted with `path` (null: plain), shared by them; its textures fill in once read. */
  private wallLook(path: string | null, door: boolean): THREE.Material {
    const key = path ?? (door ? ':door' : ':wall');
    let material = this.wallMaterials.get(key);
    if (material) return material;
    material = new THREE.MeshStandardMaterial({ color: path ? 0xffffff : door ? PLAIN_DOOR : PLAIN_WALL, roughness: 0.9, metalness: 0 });
    this.wallMaterials.set(key, material);
    if (path) {
      const made = material;
      void this.host.readMaterial(path).then((loaded) => {
        if (this.disposed || !loaded) { if (!loaded) made.color.set(PLAIN_WALL); return; }
        loaded.apply(made);
        made.needsUpdate = true;
        this.wake(true);
      });
    }
    return material;
  }

  private propAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, [...this.props.values()].map((piece) => piece.hitTarget));
    return (hit?.userData.propId as string | undefined) ?? null;
  }

  private listen(): void {
    const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void, options?: AddEventListenerOptions): void => {
      this.canvas.addEventListener(type, handler, options);
      this.stops.push(() => this.canvas.removeEventListener(type, handler, options));
    };
    on('contextmenu', (event) => event.preventDefault());
    on('pointerdown', (event) => this.down(event));
    on('pointermove', (event) => this.move(event));
    on('pointerup', (event) => this.up(event));
    on('pointercancel', () => this.cancel());
    // The pointer was taken away mid-drag (Alt-Tab, a dialog): no pointerup will come, so the drag ends here. After a
    // normal release `press` is already cleared.
    on('lostpointercapture', () => { if (this.press) this.cancel(); });
    on('pointerleave', () => {
      this.tooltip.hidden = true;
      this.showCell(null);
      this.laserClient = null;
      this.laserPoint = null;
      if (this.audience === 'player') this.host.hoverToken?.(null, null, false);
      this.wake();
    });
    on('wheel', (event) => {
      event.preventDefault();
      this.camera.zoom(Math.exp(event.deltaY * WHEEL));
      this.wake();
    }, { passive: false });
    on('keydown', (event) => {
      const key = event.key.toLowerCase();
      if (key === 'escape' && this.placing) { this.stopPlacing(); return; }
      if (key === 'escape' && this.painting) { this.paintWith(null); return; }
      if (key === 'escape' && this.laserOn) { this.setLaser(false); return; }
      // Atlas's Move/Select key switches between moving and the laser pointer.
      // A player's tools are Connect's: Escape goes back to Move, as in its 2D view.
      if (this.audience === 'player' && key === 'escape' && this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); return; }
      if (key === 'v' && this.audience === 'gm' && !event.ctrlKey && !event.metaKey && !event.altKey) { this.setLaser(!this.laserOn); return; }
      if (key === 'escape' && this.selectedId !== null) { this.select(null); return; }
      if (key === 'escape' && this.toolbar.isOpen) { this.toolbar.close(); this.toolbar.closeDice(); return; }
      if (key === 'home') { this.frameMap(); event.preventDefault(); return; }
      // Space while carrying a token drops a waypoint on its ruler.
      if (key === ' ' && this.press?.kind === 'token') {
        event.preventDefault();
        if (!event.repeat) this.addWaypoint();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        this.held.add(key);
        event.preventDefault();
        this.wake();
      }
    });
    on('keyup', (event) => { this.held.delete(event.key.toLowerCase()); });
    // A material dragged from the gallery: the wall under the pointer is named, and painted where it is dropped. Taken
    // on the whole board (before anything over the canvas, or Obsidian's own drag handling, sees it), and as plain
    // text too, where the custom type does not get through.
    const types = (event: DragEvent): string[] => Array.from(event.dataTransfer?.types ?? []);
    // Over the board itself only: the panels on it (the initiative cards) have drags of their own.
    const mayCarry = (event: DragEvent): boolean => event.target === this.canvas
      && (types(event).includes(MATERIAL_DRAG_TYPE) || (types(event).includes('text/plain') && !types(event).includes('Files')));
    const take = (type: 'dragover' | 'drop' | 'dragleave', handler: (event: DragEvent) => void): void => {
      this.container.addEventListener(type, handler, true);
      this.stops.push(() => this.container.removeEventListener(type, handler, true));
    };
    take('dragover', (event) => {
      if (!mayCarry(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      const wall = this.wallAt(event.clientX, event.clientY);
      this.showTip(event.clientX, event.clientY, wall ? (event.shiftKey ? 'Paint the whole wall' : 'Paint this segment (Shift: the whole wall)') : 'Drop on a wall or door');
    });
    take('dragleave', (event) => { if (event.target === this.container || !this.container.contains(event.relatedTarget as Node | null)) this.tooltip.hidden = true; });
    take('drop', (event) => {
      if (!mayCarry(event)) return;
      const text = event.dataTransfer?.getData('text/plain') ?? '';
      const material = event.dataTransfer?.getData(MATERIAL_DRAG_TYPE) || (text.startsWith(MATERIAL_TEXT_PREFIX) ? text.slice(MATERIAL_TEXT_PREFIX.length) : '');
      if (!material) return;
      event.preventDefault();
      event.stopPropagation();
      this.tooltip.hidden = true;
      const wall = this.wallAt(event.clientX, event.clientY);
      if (wall) this.host.paintWall(wall, material, event.shiftKey);
      else this.host.warn('Tabletop: drop the material on a wall or door.');
    });
    on('blur', () => this.held.clear());
  }

  private down(event: PointerEvent): void {
    this.canvas.focus();
    this.canvas.setPointerCapture?.(event.pointerId);
    this.tooltip.hidden = true;
    const { clientX: x, clientY: y } = event;
    if (event.button === 0 && this.placing) return;
    if (event.button === 0 && this.painting) return;
    if (event.button === 0 && this.laserOn) {
      this.press = { kind: 'laser', x, y, moved: false };
      this.trackLaser(x, y);
      return;
    }
    if (this.audience === 'player') {
      this.playerDown(event);
      return;
    }
    // While Connect hosts, the GM's Template tool: a drag places one, a tap erases any.
    if (event.button === 0 && this.tools.tool === 'template' && this.host.hosting?.() === true) {
      const at = this.boardPoint(x, y);
      if (at) {
        this.press = { kind: 'tool', x, y, moved: false };
        this.tools.down(at, this.now());
        this.showToolOverlay();
        return;
      }
    }
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
      const id = this.propAt(x, y);
      const piece = id ? this.props.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && piece && at) {
        this.press = { kind: 'prop', id, x, y, moved: false, grab: { dx: piece.object3d.position.x - at.x, dy: piece.object3d.position.z - at.y } };
        return;
      }
      // Ctrl + drag on a light's bulb or a wall changes its height.
      const light = this.lightAt(x, y);
      const wall = light ? null : this.wallAt(x, y);
      if (light) {
        const found = this.map?.lights.find((candidate) => candidate.id === light);
        const start = found ? this.host.lightHeight(found) : 1;
        this.press = { kind: 'height', target: 'light', id: light, x, y, moved: false, start };
        return;
      }
      if (wall) {
        this.press = { kind: 'height', target: 'wall', id: wall, x, y, moved: false, start: this.wallSquares(wall) };
        return;
      }
    }
    if (event.button === 0) {
      const id = this.tokenAt(x, y);
      const entry = id ? this.tokens.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && entry && at) {
        this.press = {
          kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y },
          copy: event.altKey, start: snapPoint(this.map!.grid, entry.token.x, entry.token.y), waypoints: [],
        };
        entry.piece.carried = true;
        return;
      }
    }
    const token = event.button === 2 ? this.tokenAt(x, y) : null;
    const prop = event.button === 2 && !token ? this.propAt(x, y) : null;
    const pin = event.button === 0 ? this.pinAt(x, y) : null;
    // A right-click on a light's bulb opens its menu; a click opens a door; a right-click on any wall opens its menu.
    const light = event.button === 2 && !token && !prop ? this.lightAt(x, y) : null;
    const door = event.button === 0 && !pin ? this.doorAt(x, y) : event.button === 2 && !token && !prop && !light ? this.wallAt(x, y) : null;
    const grab = event.button === 2 ? this.boardPoint(x, y) : null;
    this.press = { kind: 'camera', button: event.button, x, y, lastX: x, lastY: y, moved: false, token, prop, pin, door, light, grab };
  }

  /**
   * A press on a player's board: a token the player may move is picked up (no copies), a pin opens its note; anything
   * else turns or slides the camera. No menus, doors, props, walls or lights: those are the GM's.
   */
  private playerDown(event: PointerEvent): void {
    const { clientX: x, clientY: y } = event;
    if (event.button === 0) {
      const id = this.tokenAt(x, y);
      const entry = id ? this.tokens.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && entry && at && this.host.canMove?.(id) === true) {
        this.press = {
          kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y },
          copy: false, start: snapPoint(this.map!.grid, entry.token.x, entry.token.y), waypoints: [],
        };
        entry.piece.carried = true;
        return;
      }
    }
    if (event.button === 0 && this.tools.takesPress) {
      const at = this.boardPoint(x, y);
      if (at) {
        this.press = { kind: 'tool', x, y, moved: false };
        this.tools.down(at, this.now());
        this.showToolOverlay();
        return;
      }
    }
    const pin = event.button === 0 ? this.pinAt(x, y) : null;
    const grab = event.button === 2 ? this.boardPoint(x, y) : null;
    this.press = { kind: 'camera', button: event.button, x, y, lastX: x, lastY: y, moved: false, token: null, prop: null, pin, door: null, light: null, grab };
  }

  /** Milliseconds, for the laser's timing. */
  private now(): number {
    return (this.container.ownerDocument.defaultView ?? window).performance.now();
  }

  /** The tools' actions go to Connect. */
  private act(actions: readonly ToolAction[]): void {
    for (const action of actions) this.host.playerAction?.(action);
  }

  /** The measure or template being dragged, drawn; the toolbar told of a change. */
  private showToolOverlay(): void {
    const { measure, draft } = this.tools.overlay();
    const map = this.map;
    const label = measure && map ? formatDistance(pathLengthInCells([measure.start, measure.end], map.grid, this.host.measurement().diagonalRule), this.host.measurement()) : '';
    this.marks.setOverlay(measure ? { ...measure, label } : null, draft ? { ...draft, color: this.host.ownColor?.() ?? '#ffcc33' } : null, this.tools.coneAngle, this.lastPose?.pixel ?? 0.002);
    this.wake();
  }

  /** Lets the tools change from outside (Connect's toolbar): the drawing and the toolbar follow. */
  toolsChanged(): void {
    this.tools.cancel();
    this.showToolOverlay();
    this.host.toolsChanged?.();
    if (this.audience === 'gm') this.toolbar.refresh();
  }

  /** The scene's lasting templates, from Connect. */
  receiveTemplates(list: readonly TemplateMark[]): void {
    this.tools.receiveTemplates(list);
    this.marks.setTemplates(list, this.tools.coneAngle);
    this.host.toolsChanged?.();
    this.wake();
  }

  /** Someone's ping, from Connect. */
  receivePing(x: number, y: number, color: string): void {
    this.marks.ping(x, y, color, this.clock);
    this.wake();
  }

  /** New points of someone's laser, from Connect. */
  receiveLaser(from: string, points: ReadonlyArray<{ x: number; y: number }>, lifted: boolean, color: string): void {
    this.marks.laser(from, points, lifted, color, this.clock);
    this.wake();
  }

  private move(event: PointerEvent): void {
    const press = this.press;
    if (press?.kind === 'tool') {
      if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_PX) press.moved = true;
      const at = this.boardPoint(event.clientX, event.clientY);
      if (at) {
        const actions = this.tools.move(at, this.now());
        // The player's own laser shows as it is drawn.
        for (const action of actions) if (action.type === 'laser') this.marks.laser('self', action.points, false, action.color || (this.host.ownColor?.() ?? '#ff0059'), this.clock);
        this.act(actions);
        this.showToolOverlay();
      }
      return;
    }
    if (this.laserOn) this.trackLaser(event.clientX, event.clientY);
    if (press?.kind === 'laser') return;
    if (!press) { if (!this.laserOn) this.hover(event); return; }
    // Moving with no button held: the release was missed.
    if (event.buttons === 0) { this.cancel(); return; }
    const { clientX: x, clientY: y } = event;
    if (!press.moved && Math.hypot(x - press.x, y - press.y) >= DRAG_PX) press.moved = true;
    if (!press.moved) return;
    if (press.kind === 'camera') {
      const dx = x - press.lastX;
      const dy = y - press.lastY;
      press.lastX = x;
      press.lastY = y;
      if (press.button === 0 || press.button === 1) this.camera.orbit(-dx * ORBIT_X, -dy * ORBIT_Y);
      else this.panTo(press.grab, x, y);
      // A drag moves the view at once: easing it would leave the board trailing the pointer.
      this.camera.snap();
      this.wake();
      return;
    }
    if (press.kind === 'height') {
      // Up raises it, down lowers it, by what the pointer covers on the board; to a twentieth of a square.
      const value = Math.max(0, Math.round((press.start + (press.y - y) * this.squaresPerPixel()) * 20) / 20);
      this.heightDrag = { target: press.target, id: press.id, value };
      if (press.target === 'wall') this.updateWalls();
      else this.applyLighting();
      this.showTip(x, y, `Height ${value} sq${press.target === 'wall' ? ' (Shift: the whole wall)' : ''}`);
      this.wake(true);
      return;
    }
    const at = this.boardPoint(x, y);
    if (!at) return;
    const point = this.clampToBoard(at.x + press.grab.dx, at.y + press.grab.dy);
    if (press.kind === 'token') {
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = point;
        entry.at = { ...point };
      }
      this.drawRuler();
    } else {
      this.props.get(press.id)?.place(point.x, point.y);
    }
    this.wake();
  }

  private up(event: PointerEvent): void {
    const press = this.press;
    this.press = null;
    const { clientX: x, clientY: y } = event;
    // Painting: a click paints the wall under it (Shift: the whole wall), and painting goes on until Esc.
    if (event.button === 0 && this.painting) {
      const wall = this.wallAt(x, y);
      if (wall) this.host.paintWall(wall, this.painting, event.shiftKey);
      return;
    }
    if (event.button === 0 && this.placing) {
      const at = this.boardPoint(x, y);
      const glb = this.placing;
      this.stopPlacing();
      if (at) this.host.addProp(glb, at.x, at.y);
      return;
    }
    if (!press) return;
    if (press.kind === 'laser') { this.wake(); return; }
    if (press.kind === 'tool') {
      const at = this.boardPoint(x, y);
      const actions = at ? this.tools.up(at, this.now(), press.moved) : (this.tools.cancel(), []);
      for (const action of actions) if (action.type === 'laser') this.marks.laser('self', action.points, true, action.color || (this.host.ownColor?.() ?? '#ff0059'), this.clock);
      this.act(actions);
      this.showToolOverlay();
      return;
    }
    if (press.kind === 'token') {
      this.clearRuler();
      const entry = this.tokens.get(press.id);
      if (!entry) return;
      entry.piece.carried = false;
      if (press.moved && press.copy) {
        this.copyToken(entry, snapPoint(this.map!.grid, entry.at.x, entry.at.y));
        return;
      }
      if (!press.moved) {
        // A player's board has no resource controls to open.
        if (this.audience === 'gm') this.select(press.id);
        entry.piece.shake(this.clock);
        this.wake(true);
        return;
      }
      const snapped = snapPoint(this.map!.grid, entry.at.x, entry.at.y);
      entry.goal = snapped;
      this.host.moveToken(press.id, snapped.x, snapped.y);
      this.wake(true);
      return;
    }
    if (press.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece && press.moved) this.host.moveProp(press.id, piece.object3d.position.x, piece.object3d.position.z);
      this.wake(true);
      return;
    }
    if (press.kind === 'height') {
      const drag = this.heightDrag;
      this.heightDrag = null;
      this.tooltip.hidden = true;
      if (press.moved && drag) {
        if (drag.target === 'wall') this.host.setWallHeight(drag.id, drag.value, event.shiftKey);
        else this.host.setLightHeight(drag.id, drag.value);
      }
      this.updateWalls();
      this.applyLighting();
      return;
    }
    if (press.moved) return;
    if (press.button === 0 && press.door) {
      this.toggleDoor(press.door);
      return;
    }
    if (press.button === 0 && !press.pin) this.select(null);
    if (press.button === 2 && press.token) this.host.tokenMenu(press.token, event);
    else if (press.button === 2 && press.prop) this.host.propMenu(press.prop, event);
    else if (press.button === 2 && press.light) this.host.lightMenu(press.light, event);
    else if (press.button === 2 && press.door) this.host.wallMenu(press.door, event);
    else if (press.button === 0 && press.pin) {
      const pin = this.pins.find((piece) => piece.pin.id === press.pin);
      if (pin?.pin.notePath) this.host.openNote(pin.pin.notePath);
    }
  }

  private cancel(): void {
    const press = this.press;
    this.press = null;
    if (press?.kind === 'tool') {
      this.tools.cancel();
      this.showToolOverlay();
      return;
    }
    if (press?.kind === 'token') {
      this.clearRuler();
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = { x: entry.token.x, y: entry.token.y };
        entry.piece.carried = false;
      }
    } else if (press?.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece) piece.place(piece.placement.x, piece.placement.y);
    } else if (press?.kind === 'height') {
      // A lost drag leaves the height as it was.
      this.heightDrag = null;
      this.tooltip.hidden = true;
      this.updateWalls();
      this.applyLighting();
    }
    this.wake(true);
  }

  /** The cell under a point: its number (when the map numbers its cells) and the note a hex-linked pin gives it. */
  private cellAt(x: number, y: number): HoveredCell | null {
    const map = this.map;
    if (!map || !map.grid.enabled) return null;
    const cell = this.cells.at(x, y);
    const hex = map.grid.type !== 'square';
    const center = cell?.center ?? (hex ? hexCenter(map.grid, x, y) : null);
    if (!center) return null;
    const linked = hex ? map.pins.find((pin) => {
      if (!pin.hex || !pin.notePath) return false;
      const at = hexCenter(map.grid, pin.x, pin.y);
      return Math.hypot(at.x - center.x, at.y - center.y) < 1;
    }) : undefined;
    const label = [cell?.label ?? '', linked ? pinTitle(linked) : ''].filter(Boolean).join(' · ');
    if (!label) return null;
    return { key: `${center.x.toFixed(1)},${center.y.toFixed(1)}|${label}`, label, center };
  }

  /** Outlines the hovered cell and floats its number (and linked note) over it; null clears it. */
  private showCell(cell: HoveredCell | null): void {
    if (cell && this.cellOutline?.userData.key === cell.key) return;
    if (!cell && !this.cellOutline) return;
    if (this.cellOutline) {
      this.cellOutline.removeFromParent();
      this.cellOutline.geometry.dispose();
      (this.cellOutline.material as THREE.Material).dispose();
      this.cellOutline = null;
    }
    if (this.cellLabel) {
      this.cellLabel.removeFromParent();
      this.cellLabel.material.map?.dispose();
      this.cellLabel.material.dispose();
      this.cellLabel = null;
    }
    this.hoveredCell = cell?.label ?? null;
    const map = this.map;
    if (!cell || !map) { this.wake(); return; }
    const grid = map.grid;
    const corners: Array<{ x: number; y: number }> = [];
    if (grid.type === 'square') {
      const h = grid.size / 2;
      corners.push({ x: -h, y: -h }, { x: h, y: -h }, { x: h, y: h }, { x: -h, y: h });
    } else {
      const radius = grid.size / Math.sqrt(3);
      const start = grid.type === 'hex-vertical' ? -Math.PI / 2 : 0;
      for (let i = 0; i < 6; i++) corners.push({ x: radius * Math.cos(start + (Math.PI / 3) * i), y: radius * Math.sin(start + (Math.PI / 3) * i) });
    }
    const segments: number[] = [];
    corners.forEach((corner, i) => {
      const next = corners[(i + 1) % corners.length]!;
      segments.push(cell.center.x + corner.x, cell.center.y + corner.y, cell.center.x + next.x, cell.center.y + next.y);
    });
    this.cellOutline = new THREE.Mesh(stripGeometry(segments, grid.size * 0.04), new THREE.MeshBasicMaterial({ color: accent(this.container), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
    this.cellOutline.userData.key = cell.key;
    this.cellOutline.position.y = 0.3;
    this.scene.add(this.cellOutline);
    const plate = plateTexture(cell.label, 22);
    this.cellLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false, opacity: grid.numberOpacity }));
    this.cellLabel.renderOrder = 30;
    this.cellLabelAspect = plate.width / plate.height;
    this.cellLabel.center.set(0.5, 0);
    this.cellLabel.position.set(cell.center.x, grid.size * 0.1, cell.center.y - grid.size * 0.37);
    this.scene.add(this.cellLabel);
    this.wake();
  }

  /** The carried token's ruler path: start, waypoints, and where it would land now. */
  private rulerPoints(): Array<{ x: number; y: number }> | null {
    const press = this.press;
    if (press?.kind !== 'token' || !this.map) return null;
    const entry = this.tokens.get(press.id);
    if (!entry) return null;
    const landing = snapPoint(this.map.grid, entry.at.x, entry.at.y);
    const points = [press.start, ...press.waypoints];
    const last = points[points.length - 1]!;
    if (Math.hypot(landing.x - last.x, landing.y - last.y) > 0.5) points.push(landing);
    return points.length > 1 ? points : null;
  }

  private addWaypoint(): void {
    const press = this.press;
    if (press?.kind !== 'token' || !this.map) return;
    const entry = this.tokens.get(press.id);
    if (!entry) return;
    const landing = snapPoint(this.map.grid, entry.at.x, entry.at.y);
    const last = press.waypoints[press.waypoints.length - 1] ?? press.start;
    if (Math.hypot(landing.x - last.x, landing.y - last.y) <= 0.5) return;
    press.waypoints.push(landing);
    this.drawRuler();
  }

  private clearRuler(): void {
    if (this.ruler) {
      this.ruler.traverse((node) => {
        const object = node as THREE.Mesh | THREE.Sprite;
        if (!('material' in object) || !object.material) return;
        (object as THREE.Mesh).geometry?.dispose();
        const material = object.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      });
      this.ruler.removeFromParent();
      this.ruler = null;
    }
    this.rulerState = null;
  }

  /** Atlas's drag ruler: the path in the accent colour over a dark edge, dots at the start and waypoints, the distance at its middle. */
  private drawRuler(): void {
    const points = this.rulerPoints();
    const map = this.map;
    // Pointer moves inside one cell change nothing: the path runs between cell centres.
    if (points && this.ruler && JSON.stringify(points) === JSON.stringify(this.rulerState?.points)) return;
    this.clearRuler();
    if (!points || !map) { this.wake(); return; }
    const measurement = this.host.measurement();
    const label = formatDistance(pathLengthInCells(points, map.grid, measurement.diagonalRule), measurement);
    this.rulerState = { points, label };
    const group = new THREE.Group();
    group.position.y = 1.2;
    const segments: number[] = [];
    for (let i = 1; i < points.length; i++) segments.push(points[i - 1]!.x, points[i - 1]!.y, points[i]!.x, points[i]!.y);
    const color = accent(this.container);
    const edge = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.09), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    const line = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    line.position.y = 0.2;
    group.add(edge, line);
    for (const point of points.slice(0, -1)) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(map.grid.size * 0.11, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      dot.position.set(point.x, 0.4, point.y);
      group.add(dot);
    }
    // The label sits halfway along the path.
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    let rest = total / 2;
    let middle = points[0]!;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (rest <= length) {
        const t = length === 0 ? 0 : rest / length;
        middle = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        break;
      }
      rest -= length;
    }
    const plate = plateTexture(label, 24);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false }));
    tag.renderOrder = 40;
    tag.center.set(0.5, -0.3);
    tag.position.set(middle.x, map.grid.size * 0.2, middle.y);
    tag.userData.aspect = plate.width / plate.height;
    group.add(tag);
    this.ruler = group;
    this.scene.add(group);
    this.wake();
  }

  /** Alt + drag let go: the token goes back, and a copy (shown at once) is saved where it was dropped. */
  private copyToken(entry: TokenEntry, at: { x: number; y: number }): void {
    const map = this.map!;
    entry.goal = { x: entry.token.x, y: entry.token.y };
    entry.at = { ...entry.goal };
    const newId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    const taken = new Set(map.tokens.filter((token) => token.imagePath === entry.token.imagePath).map((token) => token.instanceNumber));
    let instance = 1;
    while (taken.has(instance)) instance++;
    map.tokens = [...map.tokens, { ...entry.token, id: newId, x: at.x, y: at.y, instanceNumber: instance }];
    this.sync();
    this.host.copyToken(entry.token.id, newId, at.x, at.y);
  }

  // ── Dice ──────────────────────────────────────────────────────────────────

  /**
   * What a dice table needs of this board: its scene, the grid, where the camera looks, and frames. The pack and its
   * textures are the thrower's to add (never an empty pack: a die needs its pack's shapes and numbers to be read).
   */
  diceHost(): Omit<DiceTableHost, 'pack' | 'textures'> {
    return {
      scene: this.scene,
      gridSize: () => this.map?.grid.size ?? FALLBACK_SIZE / 40,
      target: () => ({ x: this.camera.goal.target.x, z: this.camera.goal.target.z }),
      mapSize: () => ({ width: this.size.width, height: this.size.height }),
      cameraYaw: () => this.cameraYaw(),
      wake: () => this.wake(true),
      obstacles: () => this.diceObstacles(),
    };
  }

  /**
   * What stands on the board for dice to bounce off: every token and prop (as the round shape a click finds them by),
   * and every wall and closed door, as tall as they stand. Never moved by a die.
   */
  private diceObstacles(): DiceObstacle[] {
    const map = this.map;
    if (!map) return [];
    const obstacles: DiceObstacle[] = [];
    const round = (object3d: THREE.Object3D, hit: THREE.Object3D): void => {
      const radius = hit.scale.x;
      const height = hit.scale.y;
      if (radius > 0 && height > 0) obstacles.push({ kind: 'round', x: object3d.position.x, z: object3d.position.z, radius, height });
    };
    for (const entry of this.tokens.values()) round(entry.piece.object3d, entry.piece.hitTarget);
    for (const piece of this.props.values()) round(piece.object3d, piece.hitTarget);
    const thick = this.host.wallThickness() * map.grid.size;
    for (const wall of map.walls) {
      if ((wall.type === 'door' || wall.type === 'secret-door') && !wall.closed) continue;
      const height = this.wallSquares(wall.id) * map.grid.size;
      if (!(height > 0)) continue;
      const frame = segmentFrame(wall.p1, wall.p2);
      obstacles.push({ kind: 'box', x: frame.cx, z: frame.cy, halfLength: (frame.length + thick) / 2, halfWidth: thick / 2, heading: frame.heading, height });
    }
    return obstacles;
  }

  /** The toolbar's Dice button, opening the board's dice picker; null takes it away. Returns where the picker opens. */
  diceButton(handlers: DiceButton | null): HTMLElement | null {
    if (this.disposed) return null;
    return this.toolbar.setDice(this.audience === 'gm' ? handlers : null);
  }

  /** The toolbar's Dice log button, opening the board's dice log; null takes it away. Returns where the log opens. */
  diceLogButton(handlers: DiceButton | null): HTMLElement | null {
    if (this.disposed) return null;
    return this.toolbar.setDiceLog(this.audience === 'gm' ? handlers : null);
  }

  /** The toolbar's Stat sheet button, opening the selected token's sheet; null takes it away. */
  sheetButton(handlers: DiceButton | null): HTMLElement | null {
    if (this.disposed) return null;
    return this.toolbar.setSheet(this.audience === 'gm' ? handlers : null);
  }

  /** Hears every change of the selected token (its id, or null) until the returned function is called. */
  onSelect(listener: (id: string | null) => void): () => void {
    this.selectListeners.add(listener);
    return () => this.selectListeners.delete(listener);
  }

  /** Throws dice on this board from now on (a table made with `diceHost()`); the one before goes. */
  attachDice(table: DiceTable): void {
    if (this.dice && this.dice !== table) this.dice.dispose();
    this.dice = table;
    this.wake(true);
  }

  /** Which way the camera faces round the board, in radians (0 looks toward -z). */
  cameraYaw(): number {
    return this.camera.pose.yaw;
  }

  /** The camera's forward and right along the ground, as unit vectors in map pixels (x, z). */
  cameraBasis(): { forward: { x: number; z: number }; right: { x: number; z: number } } {
    const yaw = this.camera.pose.yaw;
    return { forward: { x: -Math.sin(yaw), z: -Math.cos(yaw) }, right: { x: Math.cos(yaw), z: -Math.sin(yaw) } };
  }

  /** Half of what the camera shows across and up the screen, in map pixels, at the distance of what it looks at. */
  visibleHalfExtent(): { x: number; z: number } {
    const half = this.camera.pose.distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    return { x: half * this.view.aspect, z: half };
  }

  /** The ray from the camera through a point of the screen, in the board's world. */
  rayAt(clientX: number, clientY: number): THREE.Ray {
    this.ray(clientX, clientY);
    return this.raycaster.ray.clone();
  }

  /** The die under the pointer, or null. */
  diceAt(clientX: number, clientY: number): number | null {
    return this.dice?.pick(this.rayAt(clientX, clientY)) ?? null;
  }

  // ── The local player view ─────────────────────────────────────────────────

  /** Draws the scene in the local player view's window too, from now on; `container` is that window's board area. */
  attachPlayer(container: HTMLElement): void {
    this.detachPlayer();
    const doc = container.ownerDocument;
    const win = doc.defaultView ?? window;
    const canvas = doc.createElement('canvas');
    canvas.className = 'atlas-tabletop-player-board';
    container.appendChild(canvas);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // Its own screen: that window may sit on another monitor.
    renderer.setPixelRatio(Math.min(win.devicePixelRatio || 1, this.quality.maxPixelRatio));
    const view = new THREE.PerspectiveCamera(FOV, 1, this.view.near, this.view.far);
    const resize = new win.ResizeObserver(() => {
      const player = this.player;
      if (!player) return;
      player.renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
      player.shadowsDirty = true;
      // Sizing wiped the players' canvas: drawn again before that window paints, or it blinks.
      if (this.lastPose) this.drawPlayers(false, this.lastPose);
      this.wake();
    });
    resize.observe(container);
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight), false);
    this.player = { container, canvas, renderer, view, resize, frozen: null, shadowsDirty: true, blind: false };
    this.toolbar.refresh();
    this.wake(true);
  }

  /** Stops drawing in the local player view's window (it closed, or shows another board). */
  detachPlayer(): void {
    const player = this.player;
    if (!player) return;
    this.player = null;
    player.resize.disconnect();
    player.renderer.dispose();
    player.renderer.forceContextLoss();
    player.canvas.remove();
    this.toolbar.refresh();
  }

  /** The player view opened or closed somewhere: the toolbar's buttons follow. */
  refreshToolbar(): void {
    this.toolbar.refresh();
  }

  /** The GM's camera in the board's world (x and z the map's pixels, y up). */
  cameraPose(): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } {
    const eye = this.camera.position();
    return { eye: { x: eye.x, y: eye.y, z: eye.z }, target: { ...this.camera.pose.target } };
  }

  /** The players' window's camera: where the GM froze it, else the GM's; null without a players' window. */
  playerPose(): { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null {
    const player = this.player;
    if (!player) return null;
    return player.frozen ? { eye: { ...player.frozen.eye }, target: { ...player.frozen.target } } : this.cameraPose();
  }

  /** Whether the players' camera is frozen where the GM froze it. */
  get playerFrozen(): boolean {
    return this.player?.frozen != null;
  }

  /** Freezes the players' camera where the GM's is now, or lets it follow the GM's again. */
  setPlayerFrozen(frozen: boolean): void {
    const player = this.player;
    if (!player) return;
    const pose = this.camera.pose;
    player.frozen = frozen ? { eye: positionOf(pose), target: { ...pose.target }, yaw: pose.yaw, distance: pose.distance } : null;
    this.toolbar.refresh();
    this.host.cameraMoved?.();
    this.wake();
  }

  /**
   * Shows the scene as `viewer` sees it, for the next drawing: the GM everything; players no hidden token, nothing
   * whose centre is under the fog (tokens, Tabletop's props), no pins or cell highlight, the solid fog and their own
   * labels.
   */
  private showFor(viewer: 'gm' | 'player'): void {
    const gm = viewer === 'gm';
    const fog = this.fog.areas;
    for (const entry of this.tokens.values()) {
      entry.piece.object3d.visible = gm || playerSees(entry.token, entry.at, fog);
      entry.labels.object3d.visible = gm;
      entry.playerLabels.object3d.visible = !gm;
    }
    for (const pin of this.pins) pin.object3d.visible = gm;
    for (const piece of this.props.values()) piece.object3d.visible = gm || !insideFog(fog, { x: piece.object3d.position.x, y: piece.object3d.position.z });
    if (this.cellOutline) this.cellOutline.visible = gm;
    if (this.cellLabel) this.cellLabel.visible = gm;
    this.fog.show(viewer);
    this.walls.show(viewer);
    this.rig.show(viewer);
  }

  /** The players' picture, after the GM's: the same scene through the players' camera, then back to the GM's look. */
  private drawPlayers(shadows: boolean, gm: PoseContext): void {
    const player = this.player;
    if (!player) return;
    const height = player.container.clientHeight;
    const width = player.container.clientWidth;
    if (width === 0 || height === 0) return;
    const pose = this.camera.pose;
    const frozen = player.frozen;
    const eye = frozen?.eye ?? this.camera.position();
    const target = frozen?.target ?? pose.target;
    player.view.position.set(eye.x, eye.y, eye.z);
    player.view.lookAt(target.x, target.y, target.z);
    player.view.aspect = width / height;
    player.view.near = this.view.near;
    player.view.far = this.view.far;
    player.view.updateProjectionMatrix();
    player.view.updateMatrixWorld();
    const distance = frozen?.distance ?? pose.distance;
    const context: PoseContext = {
      ...gm,
      yaw: frozen?.yaw ?? pose.yaw,
      zoom: height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)),
      pixel: screenScale(1, height, FOV),
    };
    this.showFor('player');
    // Only the thrower sees the dice tumble: never the players' screen.
    if (this.dice) this.dice.object3d.visible = false;
    try {
      for (const entry of this.tokens.values()) entry.playerLabels.pose(context);
      player.renderer.shadowMap.needsUpdate = shadows || player.shadowsDirty;
      player.shadowsDirty = false;
      // A camera inside the fog sees nothing at all: the players' picture is black.
      player.blind = this.fog.hides(player.view.position, (point) => insideFog(this.fog.areas, point));
      if (player.blind) {
        player.renderer.setClearColor(0x000000, 1);
        player.renderer.clear();
      } else {
        this.fog.face(player.view.position);
        player.renderer.render(this.scene, player.view);
      }
    } catch (error) {
      console.error('[Tabletop] The player view could not be drawn:', error);
    } finally {
      // Whatever happened, the GM's board goes back to the GM's look.
      this.showFor('gm');
      if (this.dice) this.dice.object3d.visible = true;
    }
  }

  /** The token whose resource controls show, or null. */
  get selected(): string | null {
    return this.selectedId;
  }

  /** Selects a token (null lets it go): it gets the resource controls; an editor open on another closes. */
  /** Atlas's initiative card click: the camera goes to the token, which is selected. */
  showToken(id: string): void {
    const entry = this.tokens.get(id);
    if (!entry) return;
    this.camera.lookAt({ x: entry.goal.x, y: 0, z: entry.goal.y });
    this.select(id);
    this.wake();
  }

  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    if (this.editor && this.editor.tokenId !== id) this.editor.view.close();
    for (const listener of [...this.selectListeners]) listener(id);
    this.wake();
  }

  /**
   * Shows a token's change at once, before the map file catches up: `token` replaces it, null takes it away. Used for
   * the token menu's Kill and Delete.
   */
  changeToken(id: string, token: BoardToken | null): void {
    const map = this.map;
    if (!map) return;
    map.tokens = token ? map.tokens.map((other) => (other.id === id ? token : other)) : map.tokens.filter((other) => other.id !== id);
    this.sync();
  }

  /** The screen rectangle of a resource drawn on a token, in pixels from the board's top left. */
  private screenRect(sprite: THREE.Sprite, width: number, height: number): ScreenRect | null {
    const at = sprite.getWorldPosition(new THREE.Vector3()).project(this.view);
    if (at.z > 1 || at.z < -1) return null;
    const x = ((at.x + 1) / 2) * this.canvas.clientWidth;
    const y = ((1 - at.y) / 2) * this.canvas.clientHeight;
    // A sprite's centre is its anchor, as a share of its size from its bottom left.
    const left = x - sprite.center.x * width;
    const bottom = y + sprite.center.y * height;
    return { left, top: bottom - height, width, height };
  }

  /** Lays the selected token's controls on its resources, and keeps an open editor under its resource. */
  private layoutControls(): void {
    const entry = this.selectedId !== null ? this.tokens.get(this.selectedId) : undefined;
    const carried = this.press?.kind === 'token' && this.press.id === this.selectedId && this.press.moved;
    if (!entry || carried) {
      this.controls.hide();
      return;
    }
    const specs: ControlSpec[] = [];
    for (const target of entry.labels.resourceTargets) {
      // A static value does not change in play: its number is set in Atlas's Edit Token.
      if (target.definition.direction === 'static') continue;
      const rect = this.screenRect(target.object, target.width, target.height);
      if (!rect) continue;
      specs.push({ key: target.definition.key, kind: target.kind, side: target.side, rect, color: target.definition.color });
    }
    this.controls.layout(specs);
    const editing = this.editor;
    if (editing) {
      const spec = specs.find((candidate) => candidate.key === editing.key);
      if (spec) editing.view.reposition(this.anchorOf(spec.rect));
    }
  }

  private anchorOf(rect: ScreenRect): EditorAnchor {
    const canvas = this.canvas.getBoundingClientRect();
    return { x: canvas.left + rect.left + rect.width / 2, top: canvas.top + rect.top, bottom: canvas.top + rect.top + rect.height };
  }

  /** Shows a resource's new value on the selected token at once; the map file (or Atlas) catches up. */
  private showResource(id: string, key: string, next: ResourceValue, maxEdited: boolean): void {
    const entry = this.tokens.get(id);
    if (!entry) return;
    this.changeToken(id, { ...entry.token, ...resourceUpdate(entry.token, key, next, maxEdited) } as BoardToken);
  }

  /** − / +: one point down or up, as Atlas steps it. */
  private stepResource(key: string, delta: number): void {
    const id = this.selectedId;
    const value = id !== null ? this.tokens.get(id)?.token.resources[key] : undefined;
    if (id === null || !value) return;
    const next = withCurrent(value, value.current + delta);
    if (next.current === value.current) return;
    this.showResource(id, key, next, false);
    this.host.editResource(id, key, (stored) => withCurrent(stored, stored.current + delta), false);
  }

  /** Opens Atlas's editor under one of the selected token's resources. */
  private openEditor(key: string): void {
    const id = this.selectedId;
    const entry = id !== null ? this.tokens.get(id) : undefined;
    const target = entry?.labels.resourceTargets.find((candidate) => candidate.definition.key === key);
    const value = entry?.token.resources[key];
    if (id === null || !target || !value) return;
    this.editor?.view.close();
    const rect = this.screenRect(target.object, target.width, target.height);
    if (!rect) return;
    this.controls.setActive(key);
    const view = openValueEditor({
      doc: this.container.ownerDocument,
      anchor: this.anchorOf(rect),
      value,
      label: target.definition.name,
      onCommit: (next) => {
        if (next.current === value.current && next.max === value.max) return;
        const maxEdited = next.max !== value.max;
        this.showResource(id, key, next, maxEdited);
        this.host.editResource(id, key, () => next, maxEdited);
      },
      onClose: () => {
        if (this.editor?.view === view) this.editor = null;
        this.controls.setActive(null);
        this.wake();
      },
    });
    this.editor = { tokenId: id, key, value, view };
  }

  /** The materials changed (one was edited or replaced): they are read again and the walls rebuilt with them. */
  refreshMaterials(): void {
    for (const material of this.wallMaterials.values()) material.dispose();
    this.wallMaterials.clear();
    this.walls.invalidate();
    if (this.map) this.sync();
  }

  /** Paints walls with a material on click (from the gallery, without dragging); null stops. */
  paintWith(material: string | null): void {
    this.painting = material;
    this.canvas.style.cursor = material ? 'copy' : this.laserOn ? 'none' : '';
    if (!material) this.tooltip.hidden = true;
    this.canvas.focus();
  }

  get isPainting(): boolean {
    return this.painting !== null;
  }

  private stopPlacing(): void {
    this.placing = null;
    this.canvas.style.cursor = this.laserOn ? 'none' : '';
  }

  // ── The laser pointer ─────────────────────────────────────────────────────

  /** Whether the laser is on. */
  get laser(): boolean {
    return this.laserOn;
  }

  /** Turns the laser on (the pointer becomes its dot) or off (its trail fades). */
  setLaser(on: boolean): void {
    if (on === this.laserOn) return;
    this.laserOn = on;
    if (on) this.showCell(null);
    if (!on && this.press?.kind === 'laser') this.press = null;
    if (!this.placing) this.canvas.style.cursor = on ? 'none' : '';
    this.toolbar.refresh();
    this.wake();
  }

  /** Map pixels per screen pixel where the laser points, so its size is in screen pixels at any zoom (as in Atlas). */
  private laserScale(at: { x: number; y: number } | null): number {
    const height = this.canvas.clientHeight || 1;
    const eye = this.view.position;
    const distance = at ? Math.hypot(at.x - eye.x, eye.y, at.y - eye.z) : this.camera.pose.distance;
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / height;
  }

  /** The pointer moved (or was pressed) with the laser on: where it is on the map, and the beam's trail while pressed. */
  private trackLaser(clientX: number, clientY: number): void {
    this.laserClient = { x: clientX, y: clientY };
    this.laserPoint = this.boardPoint(clientX, clientY);
    if (this.press?.kind === 'laser' && this.laserPoint) {
      const scale = this.laserScale(this.laserPoint);
      const halfWidth = beamWidth(this.host.laser().size).halfWidth * scale;
      this.laserTrail.add(this.laserPoint.x, this.laserPoint.y, performance.now(), Math.max(3 * scale, halfWidth * 0.15));
    }
    this.wake();
  }

  /** Draws the laser for this frame; true while its trail still fades (more frames are needed). */
  private drawLaser(): boolean {
    // The camera may have moved under a still pointer: the laser stays under the pointer.
    if (this.laserOn && this.laserClient) this.laserPoint = this.boardPoint(this.laserClient.x, this.laserClient.y);
    const now = performance.now();
    const settings = this.host.laser();
    const scale = this.laserScale(this.laserPoint);
    const { halfWidth, bodyShare } = beamWidth(settings.size);
    const pointing = this.press?.kind === 'laser';
    const trail = this.laserTrail.points(now);
    // While drawing, the beam runs up to the pointer, which stays at full strength.
    if (pointing && this.laserPoint) trail.push({ ...this.laserPoint, life: 1 });
    const spacing = Math.max(3 * scale, halfWidth * scale * 0.25);
    const dot = this.laserOn && !pointing ? this.laserPoint : null;
    this.beam.draw(smoothBeam(trail, spacing), dot, this.laserOn ? this.laserPoint : null, settings.color, halfWidth * scale, bodyShare);
    return this.laserTrail.alive(now) || pointing;
  }

  /** Keeps a carried piece on the map image; a map without one has no edge to keep to. */
  private clampToBoard(x: number, y: number): { x: number; y: number } {
    if (!this.hasImage) return { x, y };
    return { x: THREE.MathUtils.clamp(x, 0, this.size.width), y: THREE.MathUtils.clamp(y, 0, this.size.height) };
  }

  /** Names a condition ring or stat badge under the pointer; with Ctrl/Cmd held, shows a token's stat block. */
  private hover(event: PointerEvent): void {
    if (this.audience === 'player') {
      // Connect shows the token's card (or with Ctrl/Cmd the player's own stat block) around the board.
      const id = this.tokenAt(event.clientX, event.clientY);
      this.host.hoverToken?.(id, { x: event.clientX, y: event.clientY }, event.ctrlKey || event.metaKey);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const id = this.tokenAt(event.clientX, event.clientY);
      if (id !== this.previewed && id && this.tokens.get(id)?.token.statblockPath) this.host.statblockPreview(id, event);
      this.previewed = id;
    } else {
      this.previewed = null;
    }
    if (this.painting) {
      const wall = this.wallAt(event.clientX, event.clientY);
      this.showTip(event.clientX, event.clientY, wall ? (event.shiftKey ? 'Click: paint the whole wall' : 'Click: paint this segment (Shift: the whole wall)') : 'Click a wall or door to paint it · Esc to stop');
      return;
    }
    const point = this.boardPoint(event.clientX, event.clientY);
    const inside = point !== null && point.x >= 0 && point.y >= 0 && point.x <= this.size.width && point.y <= this.size.height;
    this.showCell(inside ? this.cellAt(point.x, point.y) : null);
    const targets: HoverTarget[] = [];
    for (const entry of this.tokens.values()) targets.push(...entry.labels.hoverTargets);
    const hit = this.hit(event.clientX, event.clientY, targets.map((target) => target.object));
    const found = hit ? targets.find((target) => target.object === hit) : undefined;
    if (!found) { this.tooltip.hidden = true; return; }
    this.showTip(event.clientX, event.clientY, found.label);
  }

  /** The board's tooltip, beside the pointer. */
  private showTip(clientX: number, clientY: number, text: string): void {
    const rect = this.container.getBoundingClientRect();
    this.tooltip.textContent = text;
    this.tooltip.style.left = `${clientX - rect.left + 12}px`;
    this.tooltip.style.top = `${clientY - rect.top + 12}px`;
    this.tooltip.hidden = false;
  }

  dispose(): void {
    this.disposed = true;
    this.selectListeners.clear();
    this.dice?.dispose();
    this.dice = null;
    if (this.flickerTimer !== 0) (this.frameWin ?? this.container.ownerDocument.defaultView ?? window).clearTimeout(this.flickerTimer);
    if (this.frameId !== 0) (this.frameWin ?? this.container.ownerDocument.defaultView ?? window).cancelAnimationFrame(this.frameId);
    this.detachPlayer();
    for (const stop of this.stops) stop();
    this.resize.disconnect();
    for (const entry of this.tokens.values()) { entry.labels.dispose(); entry.playerLabels.dispose(); entry.piece.dispose(); }
    this.tokens.clear();
    for (const pin of this.pins) pin.dispose();
    for (const icon of this.icons) icon.dispose();
    for (const text of this.texts) text.dispose();
    for (const ink of this.inks) ink.dispose();
    this.showCell(null);
    this.clearRuler();
    this.editor?.view.close();
    this.controls.dispose();
    this.toolbar.dispose();
    this.beam.dispose();
    this.fog.dispose();
    this.walls.dispose();
    this.rig.dispose();
    for (const material of this.wallMaterials.values()) material.dispose();
    for (const piece of this.props.values()) piece.dispose();
    this.surface?.dispose();
    for (const art of this.arts.values()) void art.then((texture) => texture?.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.tooltip.remove();
  }
}
