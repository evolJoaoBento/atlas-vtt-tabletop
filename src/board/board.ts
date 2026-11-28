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
 *   no hidden tokens, nothing under the fog (which is solid), no pins (a Connect player's own board shows the readable ones Connect sends), only the resources shown to players. It follows
 *   the GM's camera, live, unless the GM froze it.
 * - Any other drag moves the camera: left or middle orbits, right pans. The wheel zooms. WASD or the arrow keys pan,
 *   Q and E turn, Home frames the map.
 *
 * It talks to Obsidian only through its `BoardHost`, so the harness can drive it, and draws only when something
 * moves: the camera easing, a token gliding, a mini's clip playing.
 */
import * as THREE from 'three';
import { choiceOf, horizonColor, LIGHTING, lightingFor, room, setLook, tinted, type LightingChoice } from './look';
import type { MiniPlacement } from '../assignments';
import type { LoadedMini } from '../library';
import type { PropLook, PropPlacement, TokenStyle } from './boardData';
import { OrbitCamera, limitsFor, type CameraLimits } from './camera';
import type { CollectionRules } from './conditions';
import { feetPerSquare, formatDistance, pathLengthInCells, type Measurement } from './measure';
import { BEYOND_SPEED, riseBetweenEnds, showsDragDistance, type DragDistance, type MovementRules } from '../../packages/atlas-shared/src/index';
import { rulerLook } from './dragMovement';
import { liftOf } from './tokenHeight';
import { hexCenter, nearestFootprint, ringDiameter, snapPoint } from './geometry';
import { imageToWorld, stretchPlacement, worldSize } from './mapStretch';
import { groupFollow, groupLanding, type GroupMember } from './groupMove';
import { ACTIVE_COLOR, GroupMarks } from './groupMarks';
import { GroupBar, hpChange, hpKey, turned } from './groupActions';
import { TokenLabels, type HoverTarget } from './labels';
import type { BoardMap, BoardToken } from './mapModel';
import { ResourceControls, openValueEditor, type ControlSpec, type EditorAnchor, type ScreenRect, type ValueEditor } from './resourceControls';
import { resourceUpdate, withCurrent, type ResourceValue } from './resources';
import { IconPiece, InkPiece, PinPiece, PropPiece, TextPiece, TokenPiece, type PoseContext } from './pieces';
import { numberCells, type CellNumbers } from './cellNumbers';
import { stripGeometry } from './surface';
import { addCutaway, newCutaway } from './cutaway';
import { UNLIT, type BoardSight, type SightCells } from './atlasSight';

/** What a viewer has in sight: by squares (rays, or a map that would not cut into rooms) or by rooms (cinematic); and a point's answer. */
/** Where the map is seen, by Atlas's raster. */
type SeenMask = { readonly seenAt: (x: number, y: number) => boolean; readonly cells: SightCells };
import { SightVeil } from './sightVeil';
import { LayerRuler } from './layerRuler';
import { PlacementGizmo, type GizmoPart } from './placementGizmo';
import { carryView, isNoPlacement, NO_PLACEMENT, snapTurn, turnAbout, turnStep, wrapTurn, type Placement } from './layerPlacement';
import { ElevationLayerView, type ElevationLayerData, type ElevationLayerShape } from './elevationLayer';
import { ShapeEditor } from './shapeEditor';
import { DEFAULT_GROUND, fogRange, planeReach, readGround, type GroundSettings } from './ground';
import { GroundPlane } from './groundPlane';
import { SeaPlane } from './seaPlane';
import { PaintedScene } from '../background/paintedScene';
import { averageColor, impostorSpan } from '../background/propForest';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { LoadedBackground } from '../background/backgroundData';
import { ShapesView } from './shapeView';
import { shapeHeightAt, type TerrainShape } from './terrainShapes';
import { EDGE_SHARE, postFxOn, ResolutionGovernor, type LayerLook, type QualityPreset, type WallEdges } from './quality';
import { PostFx, type PostFxLook } from './postFx';
import { BoardSurface } from './surface';
import { FogVolume } from './fogVolume';
import { hasRoomWalls } from '../atlasPort/app/fog/fogRooms';
import { fogWalls } from './fogWalls';
import { fogMenuAt, fogMenuEntries } from './fogMenu';
import type { MenuEntry } from './atlasMenu';
import { FogTool, type FogBarActions, type FogHost, type FogOperationInput, type FogSwitchId } from './fogTool';
import { at as atlasText } from '../atlasPort/atlasText';
import { LaserBeam } from './laserBeam';
import { LaserTrail, beamWidth, smoothBeam, type LaserSettings } from './laser';
import { LIQUID_KINDS, WaterMask, type LiquidKind, type SavedWaterMask, type WaterMotion, type WaterMotionKind } from './water';
import { maskOfSource, motionsOf, sameWet, waterKeyOf, type WaterSource } from './liquids';
import { WaterSurface } from './waterSurface';
import { EyeView } from './eyeView';
import { PieceOutline } from './pieceOutline';
import { SpellCaster } from './spellCaster';
import { SpellPicker, type SpellBook } from './spellPicker';
import { SpellGizmo } from './spellGizmo';
import { boxPoints, isInstantaneous, readCastSpells, type DamageType, readSpellRequests, spellHits, spellUnder, type CastSpell, type Spell, type SpellAsk, type SpellTarget, spellLabel } from './spells';
import { GROW_MS, SpellView } from './spellView';
import { nearness, placeAt } from '../sound/placement';
import { liquidLoop, waterDistance } from '../sound/waterSound';
import { castsToAnnounce, spellImpactSound, spellLoopGains } from '../sound/spellSounds';
import { hitAura, type SpellEffect } from './spellEffects';
import { inDifficultSpell, pushTo, slide, spellFootprint, spellRuleLights, spellRuleWalls, type SpellRules } from './spellRules';
import { SpellRulePanel } from './spellRulePanel';
import { materialWith, type MaterialDefaults } from '../materialDefaults';
import { aboutElement, rulesWords } from './spellPicker';
import { difficultGround } from './spellView';
import type { ToolbarCommandHost } from '../palette/tabletopCommands';
import { BoardToolbar, type AtlasToolButton, type CinemaButtons, type DiceButton, type ToolbarActions, type ToolbarHelp, UNPAINT } from './toolbar';
import { pinTitle } from './pinIcons';
import { insideFog, pinsShown, playerSees, shownToPlayers } from './playerView';
import { instanceBadgeNumbers } from './levels';
import { positionOf } from './camera';
import { wireDiceSounds } from '../sound/diceSounds';
import { boardHeard } from '../sound/boardHeard';
import { doorChanges, RecentDrops, remoteMoves, sceneKey } from '../sound/miniSounds';
import { currentTokenIds, turnAnnouncement } from './initiative';
import { TurnBannerDisplay, type PortraitSource } from '../atlasPort/app/initiative/banner/turnBannerElement';
import type { TurnBannerCommand } from './turnBanner';
import { BoardChanges } from '../sound/boardChanges';
import { conditionSound } from '../sound/conditionSounds';
import { staggerOffsets } from '../sound/thinning';
import type { PlayOptions, SoundEngine, SoundId } from '../sound/soundEngine';
import { isVideoPath, loadImageTexture, loadMapTexture, MAX_MAP_TEXTURE, mapImageSize, mapTextureFromPicture, plateTexture, screenScale } from './textures';
import { capObjectTextures, capTexture } from './textureCap';
import { widgetTakes } from './widgetKeys';
import { WallSet } from './wallPieces';
import { LightRig } from './lightRig';
import { DarknessLayer } from './darkness';
import { BoardMarks } from './marks';
import { AreaVolumes, areaVolumeOf, markShape, type AreaVolume } from './areaVolume';
import { ringsOf, type WallsLook } from './areaCuts';
import { PlayerToolState, templateArea, type MeasureShape, type PlayerTool, type TemplateMark, type ToolAction } from './playerTools';
import { DEFAULT_MEASURE_TOOL, isMeasureShape, type MeasureToolOptions } from './measureOptions';
import { MEASURE_PIN_PX } from './marks';
import { measureWhileHeld } from '../atlasPort/measureWhileHeld';
import { nextBoardMeasureMode } from './boardHotkeys';
import type { MeasureChange } from './boardMeasures';
import { LIVE_DISSOLVE_MS, MEASURE_FADE_MS, releaseKeeps, releasedAlpha } from './measureRelease';
import { deleteTargetOf, dragPoints, editableMeasures, handleSpots, hitHandle, mayEditMeasures, samePoints, type Handle, type HandleRef } from './measureEdit';
import { MeasureHandleMarks, type HandleItem } from './measureHandleMarks';
import { MeasurePopover } from './measurePopover';
import { followedToken, placedMeasure } from './boardMeasures';
import type { FogOperation } from './fog';
import { isDoor, isWindow, NO_FLIP, segmentFrame, wholeWall, windowSpan, type BoardLight, type BoardWall, type DoorFlip, type WindowSpan } from './walls';
import { MINI_DRAG_TYPE, MINI_TEXT_PREFIX } from '../assignments';
import { augmentedCamera, augmentedProjection, isAugmentedView, roomPlacement, type AugmentedView, type RoomPlace } from './augmented';
import { ArViewers, isViewerPose, type ViewerPose } from './arViewers';
import { groupLabel, TABLE_SQUARES_MM, type SavedArTable } from '../arTable';
import { MATERIAL_DRAG_TYPE, MATERIAL_TEXT_PREFIX, materialDrag, type LoadedMaterial } from '../materials';
import { Impacts } from './impact';
import { opaqueAt } from './alphaSample';
import { CinemaOverlay } from '../cutscene/cinemaOverlay';
import { drivenView, type CinematicDriver, type Heading } from '../cutscene/drivenView';
import { enterLeave } from '../cutscene/timeline';
import { inputAllowed, type CinematicRole, type LockInput } from '../cutscene/lockRules';
import type { CameraKeep } from './camera';
import type { DiceObstacle, DiceTable, DiceTableHost } from '../dice/diceTable';
import { underBox } from './ink';
import { LoadProgress } from './loadProgress';
import { LoadingOverlay } from './loadingOverlay';
import { t } from '../i18n';

/** The map's image as the bucket reads it: the image, its size in its own pixels, and the affine carrying those into the world. */
interface FillSource { image: CanvasImageSource; width: number; height: number; transform: [number, number, number, number, number, number] }

/** Where the map's image lies, as an affine of its pixels into the world (as the board's floor lays it); null without one. */
function fillSourceFor(texture: THREE.Texture | null, size: { width: number; height: number }, matrix: readonly number[] | null, stretch: Parameters<typeof imageToWorld>[2] | null): FillSource | null {
  const image = texture?.image as CanvasImageSource | undefined;
  if (!texture || !image || texture.userData.video) return null;
  if (matrix) {
    // The unit square carried into the world: the image's pixels scaled down to it first.
    const [a, b, c, d, e, f] = matrix as [number, number, number, number, number, number];
    return { image, width: size.width, height: size.height, transform: [a / size.width, b / size.width, c / size.height, d / size.height, e, f] };
  }
  if (stretch) {
    const o = imageToWorld({ x: 0, y: 0 }, size, stretch);
    const u = imageToWorld({ x: 1, y: 0 }, size, stretch);
    const v = imageToWorld({ x: 0, y: 1 }, size, stretch);
    return { image, width: size.width, height: size.height, transform: [u.x - o.x, u.y - o.y, v.x - o.x, v.y - o.y, o.x, o.y] };
  }
  return { image, width: size.width, height: size.height, transform: [1, 0, 0, 1, 0, 0] };
}

/** How soon a second Alt + click on a prop makes a double click, in ms. */
/** Layers kept put away at most (each its floor, walls and props), to come back without reading them again. */
const PARKED_LAYERS = 12;
/** How long the camera glides to another layer's floor, seconds (the layers fade over most of it). */
const LAYER_GLIDE_SECONDS = 0.9;
const DOUBLE_CLICK_MS = 400;
/** How far past its ring a press still grabs a token the player may move, on a player's board (1.5: half as far again). */
const GRAB_SLACK = 1.5;
/** An instantaneous spell (Fireball) taken off fades out over this long, seconds. */
const INSTANT_FADE_SECONDS = 1.5;

/** Obsidian's accent colour, for highlights; Atlas's purple outside Obsidian. */
/** Obsidian's error red, which Atlas draws a move past the last movement step in (resolved as `accent` is). */
function errorColor(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  const value = view?.getComputedStyle(element).getPropertyValue('--text-error').trim();
  if (!value || !view) return ERROR_RED;
  const probe = element.ownerDocument.createElement('span');
  probe.style.display = 'none';
  probe.style.color = value;
  if (!probe.style.color) return ERROR_RED;
  element.appendChild(probe);
  const resolved = view.getComputedStyle(probe).color;
  probe.remove();
  return resolved || ERROR_RED;
}
const ERROR_RED = '#fb464c';
/** No walls (the same array each time: the fog's rooms cache on it). */
const NO_WALLS: readonly BoardWall[] = [];

function accent(element: HTMLElement): string {
  const view = element.ownerDocument.defaultView;
  const value = view?.getComputedStyle(element).getPropertyValue('--interactive-accent').trim();
  if (!value || !view) return ACCENT;
  // Obsidian gives it as hsl() with var()/calc() parts, which three.js cannot read: the browser resolves it to rgb().
  const probe = element.ownerDocument.createElement('span');
  probe.style.display = 'none';
  probe.style.color = value;
  if (!probe.style.color) return ACCENT;
  element.appendChild(probe);
  const resolved = view.getComputedStyle(probe).color;
  probe.remove();
  return resolved || ACCENT;
}

export interface BoardHost {
  /** The GM previews another token's point of view (null: none): the host asks Atlas for its sight (fusion 4D). */
  povChanged?(id: string | null): void;
  /** The map's liquids (Atlas's liquids as outlines, each of its kind, an old saved mask of water, or both; and how each moves), for the board to draw. */
  water?(): WaterSource | null;
  /**
   * Keeps the map's painted liquids, a mask for each (null: none of it left). Where the host keeps them somewhere that
   * may keep something else (Atlas's liquids: its limits, liquids the brush may not change, a refusal), it gives a
   * promise that settles once they are kept or refused: the board then draws what `water()` gives, where that is not
   * what was painted.
   */
  saveWater?(masks: Record<LiquidKind, SavedWaterMask | null>): void | Promise<unknown>;
  /** Keeps how all of the map's liquid of a kind moves. */
  saveWaterMotion?(motion: WaterMotion, liquid: LiquidKind): void;
  /** Tabletop's undo history for this board's map (src/board/undoHistory.ts): a step back, a step forward. */
  undo?(): void;
  redo?(): void;
  canUndo?(): boolean;
  canRedo?(): boolean;
  /** Records a change the board made that no store records by itself. */
  recordUndo?(step: { label: string; undo(): boolean; redo(): boolean }): void;
  /** Whether a scene of the stack is hidden on the board (the GM hid it from its pill's menu). */
  layerHidden?(path: string): boolean;
  /** A key for one of Atlas's toolbar tools (`carrying`: a token is being dragged); true when it opened one. */
  atlasKey?(event: KeyboardEvent, carrying: boolean): boolean;
  /** A URL for a vault image, or null when it is missing. */
  readImage(path: string): Promise<string | null>;
  /**
   * A map too large to decode whole as a picture of at most `maxSide` pixels, and the map's own size (Atlas 0.11's
   * Mosaic Canvas); null when the map is read as an ordinary image, which is every map where the host has no such way.
   */
  readPicture?(path: string, maxSide: number): Promise<{ bitmap: ImageBitmap; width: number; height: number } | null>;
  /** A GLB read into a model; rejects with the reason it cannot be drawn. */
  readMini(path: string): Promise<LoadedMini>;
  placement(tokenId: string): MiniPlacement | null;
  style(tokenId: string): TokenStyle;
  props(): readonly PropPlacement[];
  /** The raised shapes of the level shown (roofs, hills), and keeping or removing one; without these there is no Shapes tool. */
  shapes?(): readonly TerrainShape[];
  /** The ground round the map (Board settings → Ground), and keeping a change to it; without it, the map on its table. */
  ground?(): GroundSettings;
  setGround?(settings: GroundSettings): void;
  /** The saved painted backgrounds the Painted ground can show: a list the host keeps fresh, so it answers at once. */
  backgrounds?(): readonly { folder: string; name: string; thumb?: string | null }[];
  /** Reads a saved painted background (its painted layers, settings and the materials of its slots); null when it is gone or cannot be read. */
  readBackground?(ref: string): Promise<LoadedBackground | null>;
  /** Makes a new painted background (the gallery's Backgrounds tab, naming it). */
  newBackground?(): void;
  saveShape?(shape: TerrainShape): void;
  removeShape?(id: string): void;
  rules(): CollectionRules;
  moveToken(id: string, x: number, y: number): void;
  /** Several tokens moved as one change; a host without it is given the moves one by one. */
  moveTokens?(moves: ReadonlyArray<{ id: string; x: number; y: number }>): void;
  /**
   * Whether this board is the one to carry out a newly cast spell's token changes (a push, a teleport, a summons): the
   * first of the GM's boards to ask for it, once (`key`: the cast's id and its spell, as sent). Absent: a board that never does.
   */
  claimSpell?(key: string): boolean;
  /** Makes tokens for a summoning spell (map pixels, a statblock link or name); their ids. */
  summonTokens?(tokens: ReadonlyArray<{ name: string; x: number; y: number; statblock?: string }>): string[];
  /** Takes tokens off the map. */
  removeTokens?(ids: readonly string[]): void;
  /**
   * Atlas's Copy, Cut and Paste of tokens (the GM's; `tokenClipboard.ts`): copy puts the tokens on the clipboard (false
   * when none is on the map); cut also takes them off, in one step; paste puts the clipboard centred on a map point and
   * gives the new tokens' ids. A host without them (an Atlas that lacks the store actions refuses with a reason).
   */
  copyTokens?(ids: readonly string[]): Promise<boolean>;
  cutTokens?(ids: readonly string[]): Promise<boolean>;
  pasteTokens?(at: { x: number; y: number }): Promise<readonly string[]>;
  duplicateTokens?(ids: readonly string[]): Promise<readonly string[]>;
  /** Several tokens turned (degrees, 0 to 360); a host without it cannot turn a group. */
  rotateTokens?(turns: ReadonlyArray<{ id: string; rotation: number }>): void;
  moveProp(id: string, x: number, y: number): void;
  /** Sets a prop's scale, in cells across. */
  scaleProp?(id: string, scale: number): void;
  /** Sets how high a prop stands, in grid squares. */
  liftProp?(id: string, lift: number): void;
  /** Whether dropped props snap to the grid (on its own: tokens follow the map's Snap to grid). */
  snapProps?(): boolean;
  /** Turns snapping on or off: for tokens the map's own Snap to grid (Atlas's), for props the board setting. */
  setSnap?(kind: 'tokens' | 'props', on: boolean): void;
  addProp(glb: string, x: number, y: number, look?: PropLook): void;
  openNote(path: string): void;
  tokenMenu(id: string, event: MouseEvent): void;
  propMenu(id: string, event: MouseEvent): void;
  /** Shows a token's stat block (Ctrl/Cmd + hover). */
  statblockPreview(id: string, event: MouseEvent): void;
  /** Closes the stat block card Ctrl/Cmd + hover opened (Ctrl/Cmd was let go). */
  statblockPreviewEnd?(): void;
  /** Saves a copy of a token (Shift + Alt + drag) under `newId` at (x, y). */
  copyToken(id: string, newId: string, x: number, y: number): void;
  /**
   * Saves a resource edited from the token's controls: `edit` turns the value held now (by Atlas, or in the file) into
   * the new one, so quick steps add up; `maxEdited` says the maximum was set by hand.
   */
  editResource(id: string, key: string, edit: (stored: ResourceValue) => ResourceValue, maxEdited: boolean): void;
  /** How distances are measured and labelled on this map. */
  measurement(): Measurement;
  /**
   * The map's movement (Atlas 0.15): the collection's rules, and a token's speed in game units (null without one).
   * Without it a drag reads as a plain distance.
   */
  movement?(): { rules: MovementRules; speedOf(tokenId: string): number | null } | null;
  /** When a dragged token shows its distance (Atlas 0.15's setting); without it, always. */
  dragDistance?(): DragDistance;
  setDragDistance?(choice: DragDistance): void;
  /** The GM's Measure tool choices (persisted across boards); defaults to `DEFAULT_MEASURE_TOOL`. */
  /** Atlas's Measure tool choices (the board's bar and Atlas's toolbar share them); null where Atlas has none (the board keeps its own). */
  measureTool?(): MeasureToolOptions | null;
  /** Changes Atlas's choices; false where Atlas has none. */
  setMeasureTool?(changes: Partial<MeasureToolOptions>): boolean;
  /** Writes a kept measurement or clears the kept measurements of the shown level. */
  measureAction?(change: MeasureChange): void;
  /** What Atlas can do with a kept measurement (its `updateMeasure` and `deleteMeasure`); the handles stand only where it can delete. */
  measureWrites?(): { update: boolean; remove: boolean };
  /** Changes a kept measurement in one step of Atlas's history (a field given as undefined goes). */
  updateMeasure?(id: string, changes: Record<string, unknown>): void;
  /** Takes a kept measurement off the map, in one step of Atlas's history. */
  deleteMeasure?(id: string): void;
  /** Opens the collection's Measurement rules (Grid settings) in Atlas when reachable. */
  openMeasureRules?(): void;
  canOpenMeasureRules?(): boolean;
  /** Atlas's formatted hotkey labels for Measure and Keep. */
  measureHotkeys?(): { measure: string | null; measureKeep: string | null; gmView: string | null; diceTray?: string | null; diceLog?: string | null };
  /** How tall the map's fog stands, in grid squares; and saving a new height. */
  /** The GM's fog tool (Atlas 0.18's) and its bars, through Atlas's store; absent where the board cannot write fog (a player's, a board with no Atlas). */
  fog?: FogHost;
  /** The key of Atlas's fog tool as shown ("F"). */
  fogHotkey?(): string | null;
  fogHeight(): number;
  setFogHeight(height: number): void;
  /** Whether walls with no height of their own reach the level above (less a millimetre); `fogHeight` is then that height. */
  wallsReachNext?(): boolean;
  setWallsReachNext?(on: boolean): void;
  /** How thick the walls stand, as a share of a grid square. */
  wallThickness(): number;
  setWallThickness(thickness: number): void;
  /** Shown once per message. */
  warn(message: string): void;
  /** Opens or closes the local player view of this map; whether it is open. */
  togglePlayerView(): void;
  playerViewOpen(): boolean;
  /** Atlas's GM view switch of the Atlas view holding this map (true: GM view, false: session view); null where Atlas has none. */
  gmView?(): boolean | null;
  /** Throws that switch; false where Atlas has none to throw. */
  setGmView?(on: boolean): boolean;
  /** Whether the pointer is a finger (Atlas's coarse pointer): the lighting peek then has a button in the bar, where a keyboard holds its key. */
  coarsePointer?(): boolean;
  /** The laser's colour and size, kept for every map; and saving a change. */
  laser(): LaserSettings;
  setLaser(changes: Partial<LaserSettings>): void;
  /** Chooses the board's lighting (classic, or painted under a sky), kept for every board; absent where it is not the GM's to choose. */
  setLighting?(choice: LightingChoice): void;
  /** The miniature look and the contact shadows, on or off, kept for every board. */
  setTiltShift?(on: boolean): void;
  setOcclusion?(on: boolean): void;
  /** The cinematic grade and the flames' halo, on or off, kept for every board. */
  setGrade?(on: boolean): void;
  /** Depth of field, on or off, kept for every board. */
  setDepthOfField?(on: boolean): void;
  /** Its intensity and centre focus, kept for every board. */
  setDofStrength?(strength: number): void;
  setDofCenter?(on: boolean): void;
  setHalo?(on: boolean): void;
  /** How round the walls' edges are, kept for every board. */
  setWallEdges?(edges: WallEdges): void;
  /** Whether walls between the camera and what it looks at fade out, kept for every board. */
  setSeeThrough?(on: boolean): void;
  /** How wide the see-through window is, in grid squares, kept for every board. */
  setSeeThroughSize?(squares: number): void;
  setLayerLook?(look: LayerLook): void;
  /** Shows another scene of the stack (the layer menu). */
  switchLayer?(path: string): void;
  /** A scene's pill on the height ruler was right-clicked. */
  layerMenu?(path: string, event: MouseEvent): void;
  /** The GM placed the players' AR table on the map (or changed its square size): it is to be kept. */
  tablePlaced?(table: SavedArTable): void;
  /** The GM took the players' AR table off the map. */
  tableRemoved?(): void;
  /**
   * Tokens go to another scene or level of the stack: dropped on its pill (no `places`: they stand where there is room),
   * or let go over it (`places`: each where it was let go, in that layer's own map pixels; `follow`: that layer is shown).
   */
  moveTokensToLayer?(ids: readonly string[], path: string, places?: Readonly<Record<string, { x: number; y: number }>>, follow?: boolean): void;
  /** Whether a stat sheet's roll is thrown at once; changing it, kept for every board. */
  autoRoll?(): boolean;
  setAutoRoll?(on: boolean): void;
  /** Whether the initiative tracker shows on the board; showing or hiding it. */
  initiativeOpen(): boolean;
  toggleInitiative(): void;
  /** The material painted on a wall or door (a materials folder), and the prop standing in for a door; null for none. */
  wallMaterial(id: string): string | null;
  /** The materials walls and doors wear when none is painted on them, by kind; none without. */
  materialDefaults?(): MaterialDefaults;
  /** A wall's or door's own height in grid squares; null stands it as tall as the fog. */
  wallHeight(id: string): number | null;
  /** A wall's or door's own width (thickness) in grid squares; null for the map's wall thickness. */
  wallWidth?(id: string): number | null;
  /** A window's opening as the GM set it (grid squares from the floor); null for the default. */
  windowOf?(id: string): { bottom: number; top: number } | null;
  /** Keeps a wall's height (Ctrl + drag), with Shift the whole wall's; and a light's. In grid squares. */
  setWallHeight(id: string, squares: number, whole: boolean): void;
  setLightHeight(id: string, squares: number): void;
  /** Keeps a window's opening (Ctrl + drag on its handles), with Shift the whole window's. In grid squares from the floor. */
  setWindowSpan?(id: string, span: WindowSpan, whole: boolean): void;
  /** Keeps a wall's own width (Alt + drag on its handle), with Shift the whole wall's. In grid squares. */
  setWallWidth?(id: string, squares: number, whole: boolean): void;
  doorProp(id: string): string | null;
  /** How the GM turned a door from the way Atlas draws it (hinge at the other end, opening to the other side). */
  doorFlip?(id: string): DoorFlip;
  /** Loads a material of the gallery; null when it cannot be read. */
  readMaterial(path: string): Promise<LoadedMaterial | null>;
  /** Opens or shuts a door (Atlas's `toggleDoor`); the board shows it at once unless the door is locked. */
  toggleDoor(id: string): void;
  /** A wall's or door's right-click menu. */
  wallMenu(id: string, event: MouseEvent): void;
  /** A pin's right-click menu (the GM's board: Readable by players). Without it a right-click on a pin does nothing of its own. */
  pinMenu?(id: string, event: MouseEvent): void;
  /** The fog menu (Reveal, Hide, Delete) opened at a right-click, in Atlas's menu style; `onClose` once it has closed, however. */
  fogMenu?(entries: MenuEntry[], event: MouseEvent, onClose: () => void): void;
  /** The board's ambient light (0–1), and keeping a new level. */
  ambient(): number;
  /** Whether the scene's lighting is on in Atlas: the light level can be set only then. Absent: it can. */
  lightingOn?(): boolean;
  setAmbient(level: number): void;
  /** The colour the daylight is tinted ('#rrggbb'), or null for none; keeping a new one, or taking it off. */
  tint(): string | null;
  setTint(color: string): void;
  clearTint(): void;
  /** Atlas's "Forget explored areas", and whether Atlas offers it here. Absent where it is not the GM's. */
  forgetExplored?(): void;
  forgetExploredOffered?(): boolean;
  /** How high a light hangs, in grid squares. */
  lightHeight(light: BoardLight): number;
  /** A light's right-click menu (on its bulb). */
  lightMenu(id: string, event: MouseEvent): void;
  /** A material dropped from the gallery on a wall or door: that segment, or with Shift the whole wall drawn with it. */
  paintWall(id: string, material: string | null, whole: boolean): void;
  /** The materials the paint tool offers (the gallery's). */
  materials?(): Array<{ path: string; name: string; thumb: string | null }>;
  /**
   * The toolbar's mode for the GM (null: the board has no modes), and choosing a new one. Play and Edit are kept
   * between sessions; Cinematic lasts while the cutscene gallery or editor is open.
   */
  boardMode?(): 'play' | 'edit' | 'cinematic' | null;
  setBoardMode?(mode: 'play' | 'edit' | 'cinematic'): void;
  /** A mini dragged from the gallery onto a token: that token is drawn as it. */
  assignMini?(tokenId: string, glb: string): void;
  /** Alt + drag on a token turns its mini: its turn in degrees now (null with no mini), and where a drag saves it. */
  miniTurn?(tokenId: string): number | null;
  setMiniTurn?(tokenId: string, turn: number): void;
  /** The GM's camera or the players' moved (Connect follows it for its players' "GM view"). */
  cameraMoved?(): void;
  /** The sound engine of this board's window, set up from the player's sound settings; absent or null: the board is silent. */
  sounds?(): SoundEngine | null;
  /** A Connect player's board: whether the player may drag this token now (one the GM lets them control). */
  canMove?(tokenId: string): boolean;
  /** A Connect player's board: whether this player controls the token, paused or not (their own turn's horn is full). */
  controls?(tokenId: string): boolean;
  /** The GM's board: whether a Connect player controls this token (a monster's turn has none, and its horn is full). */
  controlledByPlayers?(tokenId: string): boolean;
  /** A Connect player's board: the token under the pointer (null for none), the pointer in client pixels, Ctrl/Cmd down. */
  hoverToken?(tokenId: string | null, client: { x: number; y: number } | null, modifier: boolean): void;
  /** A Connect player's board: what a tool asks of the session (a ping, a template, laser points). */
  playerAction?(action: ToolAction): void;
  /** The player's own colour (their templates and laser while drawn). */
  ownColor?(): string;
  /** The spell notes this board can search (Obsidian's boards); absent or null for none (the web player board). */
  spellBook?(): SpellBook | null;
  /** The tool, shape or colour changed on the board (Escape too): Connect's toolbar follows. */
  toolsChanged?(): void;
  /** Whether Connect hosts a session . */
  hosting?(): boolean;
  /** The board left a token's eyes by itself (Escape, the Leave button): Connect's eye button follows. */
  eyeChanged?(): void;
}

/** The line round what a spell hits. */
/** Who the GM's own spells belong to (Connect's GM id). */
export const GM_SPELL_OWNER = 'gm';
const SPELL_HIT_COLOR = '#ff2a2a';

/** A prop's name, for the list of what a spell hits: its GLB's file name. */
const propName = (glb: string): string => (glb.split('/').pop() ?? glb).replace(/\.[^.]+$/, '') || 'Prop';

/** The meshes an outline goes round, its own lines aside: when a mini loads, the count changes and the line is redone. */
function meshCount(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((node) => { if ((node as THREE.Mesh).isMesh && node.userData.noOutline !== true) count += 1; });
  return count;
}

/** Whether an object shows (it and every parent visible). */
function showing(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Who looks at the board: the GM (everything, and the tools to change it), or a Connect player (what players see). */
export type BoardAudience = 'gm' | 'player';

const FOV = 35;
/** The orbit camera's near plane as a share of its distance, once that is past the map's own near plane (`fitNear`): the camera only looks down steeply from that far, so nothing comes this close. */
const NEAR_SHARE = 0.03;
/** A press that moves less than this is a click (TacticalEngine). */
const DRAG_PX = 6;
const ORBIT_X = 0.006;
const ORBIT_Y = 0.004;
const PAN_PER_PX = 0.0016;
const WHEEL = 0.0012;
const KEY_PAN = 0.9;
const KEY_TURN = 1.6;
/** How fast the authoring camera flies, in board spans per second. */
const FREE_SPEED = 0.4;
/** How far one notch of the wheel moves the authoring camera, as a factor of the reach it was made with. */
const FREE_DOLLY = 1.1;
/** How fast a released token closes on its cell, per second. */
const GLIDE = 14;
/** The longest frame anything steps by, so a hidden tab does not fling a mini. */
const LONGEST_STEP = 1 / 15;
const FALLBACK_SIZE = 2000;
/** The hovered cell's label height on screen, in pixels. */
const CELL_LABEL_PX = 20;
const ACCENT = '#7c5cff';

/** What a height drag moves: a light, a wall's top, or a window's sill (its opening's bottom) or lintel (its top). */
type WallPart = 'wall' | 'sill' | 'lintel' | 'width';
/** Which handles a key shows: Ctrl the heights, Alt the width. */
type HandleKind = 'height' | 'width';
type HeightTarget = WallPart | 'light';
/** Ctrl's handles on a wall: their radius on the screen, and how near the pointer takes one. */
const HANDLE_PIXELS = 6;
const HANDLE_REACH = 16;
/** The span, in grid cells, the water loops' falloff with the camera's distance is measured against. */
const WATER_SPAN_CELLS = 20;

/** The water brush's size by Ctrl + scroll: a step a notch, as the toolbar's slider goes, in grid cells. */
const BRUSH_STEP = 0.25;
const BRUSH_MIN = 0.25;
const BRUSH_MAX = 6;
const BRUSH_NOTCH = 100;
/** A wall's own width, dragged: its least and its most, in grid squares. */
const WIDTH_MIN = 0.02;
const WIDTH_MAX = 2;
const HANDLE_GEOMETRY = new THREE.SphereGeometry(1, 16, 12);
/** How often a playing clip redraws the shadows, in seconds. */
const CLIP_SHADOW_STEP = 1 / 15;
/** How often a flame flickers when nothing else moves, in milliseconds (about 15 times a second). */
const FLICKER_MS = 66;
/** The camera settles this many squares from where the shadow-casting lights were chosen: they are chosen again. */
const CASTER_STEP_SQUARES = 3;
/** Atlas's default lit threshold: below this ambient light a scene is dark. */
const LIT_THRESHOLD = 0.25;
/** A wall is never lower than this many squares, whatever the fog's height. */
const MIN_WALL_SQUARES = 0.25;
/** The plain looks of a wall (grey stone) and a door (dark wood) before a material is painted on. */
const PLAIN_WALL = 0x8d8780;
const PLAIN_DOOR = 0x6e4a2c;
/** An animated map is redrawn this often, in milliseconds (about thirty frames a second). */
const VIDEO_FRAME_MS = 33;
/** The colour a sea of lava lights the board with from below (set from its tint). */
const LAVA_UNDERLIGHT = new THREE.Color();

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
  /** How high it stands now (on a solid prop), easing to its stand: the top of the solid props under it, when last found. */
  lift: number;
  stand?: { x: number; y: number; version: number; value: number };
  /** Sliding to a spot another board put it on (heard picked up at the start): the put-down is heard on arriving, after `glideDelay` ms. */
  gliding?: boolean;
  glideDelay?: number;
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
  /** The post-processing (miniature look, contact shadows), made when a setting asks for it. */
  tilt: PostFx | null;
}

/** The cell under the pointer: where it is and what it is called. */
interface HoveredCell {
  key: string;
  label: string;
  center: { x: number; y: number };
}

type Press =
  | {
    /** A handle of the placement gizmo being dragged: where the pointer last met the scene's plane, and its angle about the gizmo's middle. */
    kind: 'gizmo'; part: GizmoPart; last: { x: number; z: number }; angle: number;
    /** A turn: how far the pointer has gone round since the press (unsnapped), and where the scene stood then. */
    turned: number; from: Placement;
  }
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
    /** Shift was held: a click without a drag adds the token to the selection, or takes it out. */
    toggle?: boolean;
    /** The tokens of a Shift-click selection dragged together, each with where it stood. */
    members?: Map<string, GroupMember>;
    /** The ruler: where the drag began (snapped), and the waypoints Space dropped. */
    start: { x: number; y: number };
    waypoints: Array<{ x: number; y: number }>;
  }
  /** Alt + drag on a token with a mini: the mini turns with the pointer round the token, from where it was. */
  | { kind: 'rotate'; id: string; x: number; y: number; moved: boolean; center: { x: number; y: number }; startAngle: number; startTurn: number; turn: number }
  | { kind: 'prop'; id: string; x: number; y: number; moved: boolean; grab: { dx: number; dy: number } }
  /** Ctrl + drag on a prop in Edit mode: up grows it, down shrinks it; its scale at the press. */
  | { kind: 'propScale'; id: string; x: number; y: number; moved: boolean; start: number; value: number }
  /** Alt + drag on a prop that is not solid, in Edit mode: up raises it, down lowers it; in grid squares. */
  | { kind: 'propLift'; id: string; x: number; y: number; moved: boolean; start: number; value: number }
  /** Ctrl + drag on a wall or a light: up raises it, down lowers it; `start` is its height when the drag began, in squares. */
  | { kind: 'height'; target: HeightTarget; id: string; x: number; y: number; moved: boolean; start: number }
  /** The laser drawing its beam. */
  | { kind: 'laser'; x: number; y: number; moved: boolean }
  /** A Connect player's tool (measure, template, laser, ping) under way. */
  | { kind: 'tool'; x: number; y: number; moved: boolean }
  | { kind: 'water'; last: { x: number; y: number } }
  /** The fog tool's drag under way (`fogTool.ts` keeps it). */
  | { kind: 'fog' }
  /** A press on a kept measurement's handle: a click opens its popover, a drag moves, resizes or turns it. */
  | { kind: 'measureHandle'; ref: HandleRef; x: number; y: number; moved: boolean; grabbed: { x: number; y: number } | null; from: { x: number; y: number } | null };

/** Numbers the boards, so each has loop keys of its own on the window's shared sound engine. */
let nextBoardNumber = 0;

export class Board {
  readonly canvas: HTMLCanvasElement;
  camera: OrbitCamera = new OrbitCamera();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly view = new THREE.PerspectiveCamera(FOV, 1, 1, 10_000);
  /** Seeing through a token's eyes (a player's view): the token, and the look it has; null for the usual camera. */
  private eye: EyeView | null = null;
  /** The turn the eye view draws with this frame, and where a drag of it last was. */
  private eyeTurn: THREE.Quaternion | null = null;
  private eyeDrag: { x: number; y: number } | null = null;
  /** Casting spells through the eyes (a player's board): the bar, the steps, the aim. */
  private caster: SpellCaster | null = null;
  /** The scene's spells, from Connect. */
  private castSpells: CastSpell[] = [];
  /** Whether a spell was kept out of the players' picture at the last drawing (so its view is shown again once none is). */
  private secretSpells = false;
  private readonly spellViews = new Map<string, { key: string; view: SpellView; instant: boolean }>();
  /** Instantaneous spells taken off the scene, fading out (`start` in seconds, the page's clock). */
  private fadingSpells: Array<{ view: SpellView; start: number }> = [];
  /** The spell being cast, drawn while it is aimed, moved and confirmed. */
  private spellPreview: { key: string; view: SpellView; spell: Spell } | null = null;
  /** The red lines round what the spells hit, by target. */
  private readonly spellOutlines = new Map<string, { outline: PieceOutline; meshes: number }>();
  /** What a cast damaging spell does to each thing it hits, drawn round it (`hitAura`), by target id. */
  private readonly spellAuras = new Map<string, { type: DamageType; root: THREE.Object3D; effect: SpellEffect }>();
  private spellHitsAt = 0;
  private spellTimer = 0;
  /** The map the spells were last drawn for (their cut by the walls is redone on another). */
  private spellMap: BoardMap | null = null;
  /** The casts this board has seen on the scene it shows (their sound is made once), and which scene that is. */
  private announcedCasts: Set<string> | null = null;
  private castScene: string | null = null;
  /** The casts the last spell list brought that are new to this scene (announced by the next drawing). */
  private newCasts = new Set<string>();
  /** Casts growing into place, from when (the page's clock, seconds). */
  private growingSpells = new Map<string, number>();
  /** The spell loops playing, by key, with the sound and gain last asked of the engine. */
  private spellLoops = new Map<string, { id: SoundId; gain: number }>();
  /** The water loops going, by motion kind (`water:flow`), with the gain each was last set to. */
  private waterLoops = new Map<string, { id: SoundId; gain: number }>();
  /** Finished strokes being kept by the host: the water it gives meanwhile is not drawn again. */
  private savingWater = 0;
  /** When (page clock, ms) and from which camera the water loops were last worked out. */
  private waterLoopsAt = -Infinity;
  private waterLoopsSeen = { x: NaN, z: NaN, distance: NaN, yaw: NaN, pitch: NaN };
  /** The mouse held for the eyes (pointer lock), and whether the board let go of it itself. */
  private pointerLocked = false;
  private lockReleasing = false;
  /** The handles round a spell set at a point, while the caster moves and turns it. */
  private spellGizmo: SpellGizmo | null = null;
  /** The GM's spell under the pointer with Ctrl held, in Play mode: a click clears it. */
  private hoveredSpell: string | null = null;
  /** The token whose name shows (a click on it called it up; anything done next hides it). */
  private namedId: string | null = null;
  /** A press that may be a click on a token: on its release, close by, the token's name shows. */
  private nameClick: { id: string; x: number; y: number } | null = null;
  /** How the last press came: a finger aims with a drag and Place, a mouse with the lock and a click. */
  private lastPointer = 'mouse';
  /** Augmented reality: the phone camera's pose over the printed sheet, the board drawn over its picture; null when off. */
  private augmented: AugmentedView | null = null;
  /** The camera's picture behind the board in augmented reality (when the page draws it in), and what it is made from. */
  private arTexture: THREE.CanvasTexture | null = null;
  private arSource: unknown = null;
  /**
   * Room tracking (WebXR's immersive AR, Android's ARCore): the phone tracks the room itself; the board stands where it
`   * was put. The drawn camera hangs from `rig`, which takes the room's metres to the board's units.
   */
  private room: { session: XRSession; rig: THREE.Group; onFrame: ((frame: XRFrame, space: XRReferenceSpace | null) => void) | null; far: number } | null = null;
  /** Room tracking's frame times, for a look (the page's tracking numbers): eased over the last frames. */
  private roomTimes = { frames: 0, interval: 0, work: 0, errors: 0, lastError: '', last: 0 };
  /** The near plane the map sets, given back when the eye view ends. */
  private baseNear = 1;
  /** Fingers on the board (a phone or tablet): two pinch to zoom and slide the view; until all lift, nothing else starts. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinch: { grab: { x: number; y: number } | null; spread: number } | null = null;
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly tooltip: HTMLElement;
  private readonly resize: ResizeObserver;
  private readonly stops: Array<() => void> = [];
  private surface: BoardSurface | null = null;
  /** The scenes stacked with this one (elevation layers), as the view gave them, and what draws each. */
  private stackData: readonly ElevationLayerData[] = [];
  /** A stack given while the camera glides to another floor: laid out when it gets there. */
  private pendingStack: readonly ElevationLayerData[] | null = null;
  /** The scene played, as a layer kept ready for when another is shown. */
  private warmData: readonly ElevationLayerData[] = [];
  /** Layers put away (not drawn, fading out), kept to come straight back: by path. */
  private readonly parked = new Map<string, ElevationLayerView>();
  /** The floors' textures once read, by picture (for what must know at once, as a carried token's fall). */
  private readonly floorReady = new Map<string, THREE.Texture>();
  /** The layer key of the scene played (a level's or a stacked scene's path), as the stack names it. */
  private currentKey: string | null = null;
  /** The layer about to be the one played (`switchingTo`): its view is swapped with the old scene's the moment it loads. */
  private nextKey: string | null = null;
  private readonly layerViews = new Map<string, ElevationLayerView>();
  /**
   * What players are shown of the lit scene, as Atlas works it out (`setAtlasSight`, fusion 4D): the keys
   * `t:<token id>` and `p:<prop id>` of what stands in their sight, or null while the scene is unlit (nothing is
   * hidden then). `sightKey` is what it was worked out from.
   */
  private sight: Set<string> | null = null;
  private sightKey = '';
  /** Atlas's answer for players, and for the point of view being previewed; both unlit until the host answers. */
  private atlasSight: BoardSight = UNLIT;
  private atlasPov: BoardSight = UNLIT;
  /** Counts the answers handed in, so sight is worked out again only when one came. */
  private sightRevision = 0;
  /** The token whose point of view the GM is previewing ("Preview POV"): Atlas's sight of it alone, on the GM's board only. */
  private pov: string | null = null;
  private povSight: Set<string> | null = null;
  /** Where the map is seen: by players, and from the point of view being previewed. */
  private sightMasks: { sight: SeenMask | null; pov: SeenMask | null } | null = null;
  private layerRuler: LayerRuler | null = null;
  /** The handles the AR table is placed with, and where it stands as they are dragged. */
  private gizmo: PlacementGizmo | null = null;
  private adjustPlacement: Placement = NO_PLACEMENT;
  private readonly veilSight = new SightVeil();
  private readonly veilPov = new SightVeil();
  /** What the cast spells' rules stand on the map while they last (`spellRules.ts`): walls, and lights or darkness. */
  private ruleWalls: BoardWall[] = [];
  private ruleLights: BoardLight[] = [];
  private ruleKey = '';
  /** The rules the aimed spell's drawing shows. */
  private spellPreviewRules = '';
  private ruleDecals: THREE.Mesh[] = [];
  /** Whether the pieces were last drawn under a previewed point of view: they are shown again when it ends. */
  private sightApplied = false;
  private map: BoardMap | null = null;
  private size = { width: 0, height: 0 };

  /** The board's size in map pixels once the map is drawn, null before: the world's (the image's, as Atlas's alignment lays it), or a stand-in size where the image could not be read (`mapSizeKnown`). */
  get mapSize(): { width: number; height: number } | null {
    return this.size.width > 0 && this.size.height > 0 ? { width: this.size.width, height: this.size.height } : null;
  }
  private sizeKnown = false;
  /** Whether `mapSize` is the map's own size: false before it is drawn, and for a map whose image could not be read (or that has none). */
  get mapSizeKnown(): boolean {
    return this.sizeKnown && this.mapSize !== null;
  }
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
  /** Bumped whenever a prop comes, goes, moves, loads or turns solid: the tokens' stands are found again. */
  private propsVersion = 0;
  /** The props in the map's order (the last dropped last): each stands on the solid ones before it. */
  private propOrder: string[] = [];
  /** The props version the stacking was last worked out for. */
  private stackedVersion = -1;
  private readonly standRay = new THREE.Raycaster();
  private readonly arts = new Map<string, Promise<THREE.Texture | null>>();
  private readonly models = new Map<string, Promise<LoadedMini | null>>();
  private press: Press | null = null;
  /** The map's painted liquids, each a sheet drawn over its floor; a liquid the map has none of has none. */
  private readonly liquids = new Map<LiquidKind, WaterSurface>();
  /** The liquid the brush paints. */
  private brushLiquid: LiquidKind = 'water';
  /** The map's painted water (the water sounds' search). */
  private get water(): WaterSurface | null {
    return this.liquids.get('water') ?? null;
  }
  /** The water brush while the GM paints or erases water; null while the tool is off. */
  private waterTool: 'paint' | 'erase' | 'fill' | null = null;
  /** The raised shapes of the level shown, and the Shapes tool editing them (the GM's, made when first used). */
  private readonly shapesView = new ShapesView();
  /** What a map being loaded still waits for (its image, art, minis, props, materials), and the veil that shows it. */
  readonly loads = new LoadProgress();
  private readonly loadingOverlay: LoadingOverlay;
  /** The plane to the horizon (the ground's horizon mode). */
  private readonly groundPlane = new GroundPlane();
  /** The water, lava or acid to the horizon (the ground's liquid modes). */
  private readonly seaPlane = new SeaPlane();
  /** The painted background's ground and liquids (the ground's painted mode); the plane it shapes is the ground plane above. */
  private readonly painted = new PaintedScene(
    {
      background: (ref) => this.loads.track(this.host.readBackground?.(ref) ?? Promise.resolve(null), 2),
      material: (path) => this.loads.track(this.host.readMaterial(path), 2),
      model: (path) => this.model(path),
      impostor: (model) => this.impostorOf(model),
    },
    () => { if (!this.disposed) this.applyGround(); },
    // A player's board (the host cannot choose backgrounds) shows one background at a time: it keeps only that one read.
    { keepOnlyCurrent: () => this.host.backgrounds === undefined },
  );
  /** The shapes drawn now (the one being edited as it is): what tokens stand on. */
  private drawnShapes: readonly TerrainShape[] = [];
  private shapeEditor: ShapeEditor | null = null;
  /** The bucket's sensitivity, 0 (the very colour clicked) to 100 (almost any): how far a colour may be from it. */
  private waterFill = 30;
  /** The map's image as the bucket sees it (one pixel a water texel), made at its first fill; null until then. */
  private fillColors: { key: string; colors: Uint8ClampedArray } | null = null;
  /** How the map's image lies in the world, for the bucket: the image and the affine carrying its pixels there. */
  private fillSource: FillSource | null = null;
  /** The water brush's radius, in grid cells. */
  private waterBrush = 1;
  /** The water brush's outline under the pointer, its size; null until the brush is first over the board. */
  private brushRing: THREE.Mesh | null = null;
  private brushRingRadius = 0;
  /** The water mask as last read from or saved to the board data (to tell when an undo changed it). */
  private waterKey = 'null';
  /** Where the pointer was over the board last, for the brush outline (null: off the board). */
  private brushAt: { x: number; y: number } | null = null;
  /** Ctrl + scroll not yet a whole notch of brush size, in pixels. */
  private brushScroll = 0;
  /** The water brush is the eraser only while Alt is held: back to the brush when it is let go. */
  private shiftErase = false;
  private brushTipTimer: ReturnType<typeof setTimeout> | undefined;
  /** The motion the GM chose for this map's liquids, before any is painted too; a liquid without one follows what the map keeps. */
  private chosenWaterMotion: Partial<Record<LiquidKind, WaterMotion>> = {};
  private placing: string | null = null;
  /** The look of the prop being placed (a variant's), else none: as the model comes. */
  private placingLook: PropLook | undefined = undefined;
  /** The material a click paints walls with, chosen in the gallery; null when not painting. */
  private painting: string | null = null;
  private readonly held = new Set<string>();
  /** The cinematic mode (see `setCinematic`): what drives the camera, who the board lets do what, and the look laid over it. */
  private cinematicDriver: CinematicDriver | null = null;
  private role: CinematicRole = 'none';
  private heading: Heading = { yaw: 0, pitch: 0 };
  private drivenAim: { x: number; y: number; z: number } | null = null;
  private eyesLocked: string | null = null;
  private arLatest: AugmentedView | null = null;
  private reveal = false;
  private playersDriven = false;
  private playerCinema: CinemaOverlay | null = null;
  private playerHold = false;
  private playerHeld: HTMLImageElement | null = null;
  /** The driver was taken away: the fade is cleared after the frame that draws the camera's own pose, not before. */
  private clearBlackAfterFrame = false;
  readonly cinema: CinemaOverlay;
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
  rulerState: { points: Array<{ x: number; y: number }>; label: string; color?: string | null } | null = null;
  /** The token whose resource controls show. */
  private selectedId: string | null = null;
  /** The tokens of a Shift-click selection (two or more; empty without one). */
  private readonly group = new Set<string>();
  private readonly groupMarks = new GroupMarks();
  private groupBar!: GroupBar;
  /** The combatants whose turn it is (Atlas's tracker), ringed on the board. */
  private active: readonly string[] = [];
  private readonly activeMarks = new GroupMarks(ACTIVE_COLOR, 1.2);
  private readonly selectListeners = new Set<(id: string | null) => void>();
  private readonly controls: ResourceControls;
  private readonly fog = new FogVolume();
  /** The GM's fog tool, made with the toolbar (a GM board whose host writes fog); null otherwise. */
  private fogTool: FogTool | null = null;
  /** Atlas's fog opacity in the GM's view as last read (undefined: not read yet; null: Atlas has none), kept so a frame does not read the setting. */
  private gmFogOpacity: number | null | undefined = undefined;
  /** The fog the toolbar was last brought up to date with (ids of its operations). */
  private fogShown = '';
  /** The fog tool's switches where Atlas keeps none (Atlas 0.18's `fogSnap` and `fogConstrain` defaults). */
  private readonly fogSwitches: Record<FogSwitchId, boolean> = { fogSnap: true, fogConstrain: false };
  /** Atlas's walls and doors, and the materials they are painted with, by key (a folder, or the plain looks). */
  private readonly walls: WallSet;
  private readonly wallMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** What fades the walls between a camera and its pivot, shared by every wall material. */
  private readonly cutaway = newCutaway();
  /** Atlas's lights, and the board's daylight they shine against (a level shown while the slider moves). */
  private readonly rig = new LightRig();
  private readonly hemisphere = new THREE.HemisphereLight(LIGHTING.classic.skyColor, LIGHTING.classic.groundColor, 1);
  private ambientShown: number | null = null;
  /** A tint shown while the colour picker moves, before it is kept; '' is none. */
  private tintShown: string | null = null;
  /** The height being dragged (Ctrl + drag), shown before it is kept. */
  private heightDrag: { target: HeightTarget; id: string; value: number } | null = null;
  /** Where the pointer last was over the board, for Ctrl pressed without a move. */
  private pointerAt: { x: number; y: number } | null = null;
  /** Ctrl's handles on the wall under the pointer: its top, and a window's sill and lintel. */
  private handles: { wall: string; kind: HandleKind; group: THREE.Group; spots: { part: WallPart; at: THREE.Vector3 }[] } | null = null;
  /** With Ctrl over a prop in Edit mode: a dot on its top, ready for a drag that scales it. */
  private propHandle: THREE.Mesh | null = null;
  /** With Alt over a prop that is not solid, in Edit mode: a line up through it, ready for a drag that raises it. */
  private propLine: THREE.Mesh | null = null;
  /** The last Alt + click on a prop, for Alt + double click (which resets its height). */
  private liftClick: { id: string; at: number } | null = null;
  /** Where the camera was when the shadow-casting lights were last chosen. */
  private castersAt = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  private flickerTimer = 0;
  private readonly toolbar: BoardToolbar;
  private player: PlayerScreen | null = null;
  /** Copy numbers as players see them, kept from sync to sync so a token keeps its number. */
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
  /** Areas of Atlas with an effect, standing in 3D from the floor (`areaVolume.ts`). */
  private readonly areas = new AreaVolumes();
  /** The scene's lasting templates and areas as they came: drawn again when the map's walls change. */
  private templateMarks: readonly TemplateMark[] = [];
  /** Players looking at the map in augmented reality: an eye where each phone is (the GM's board, while hosting). */
  readonly viewers = new ArViewers();
  /** The players' AR table (the GM's board while hosting): its sheets drawn on the map, and whether the GM is placing it. */
  private arTable: SavedArTable | null = null;
  private tablePlacing = false;
  private readonly tableOutlines = new THREE.Group();
  /** A player's camera stands inside the fog: the picture is black. */
  private blind = false;
  /** The thrower's dice, drawn on this board only: never in the players' picture. */
  private dice: DiceTable | null = null;

  constructor(private readonly container: HTMLElement, private readonly host: BoardHost, private quality: QualityPreset, options: { audience?: BoardAudience } = {}) {
    this.audience = options.audience ?? 'gm';
    this.rig.setHalo(quality.halo);
    const doc = container.ownerDocument;
    this.canvas = doc.win.createEl('canvas');
    this.canvas.className = 'atlas-tabletop-board';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.loadingOverlay = new LoadingOverlay(container, this.loads);
    this.tooltip = doc.win.createDiv();
    this.tooltip.className = 'atlas-tabletop-tooltip';
    this.tooltip.hidden = true;
    container.appendChild(this.tooltip);
    this.cinema = new CinemaOverlay(container);
    this.walls = new WallSet({
      look: (path, door) => this.wallLook(path, door),
      // A material dragged over a wall shows on it before it is dropped.
      materialOf: (id) => (this.paintPreview?.ids.includes(id) ? this.paintPreview.material : this.host.wallMaterial(id)),
      defaultOf: (wall) => materialWith(null, wall, this.host.materialDefaults?.()),
      displaces: (path) => (path ? this.wallMaterials.get(path)?.userData.displaces === true : false),
      tileOf: (path) => (path ? (this.wallMaterials.get(path)?.userData.tileScale as number | undefined) ?? 1 : 1),
      heightOf: (id) => (this.heightDrag?.target === 'wall' && this.heightDrag.id === id ? this.heightDrag.value : this.host.wallHeight(id)),
      windowOf: (id) => this.shownWindow(id),
      widthOf: (id) => (this.heightDrag?.target === 'width' && this.heightDrag.id === id ? this.heightDrag.value : this.host.wallWidth?.(id) ?? null),
      propOf: (id) => this.host.doorProp(id),
      flipOf: (id) => this.host.doorFlip?.(id) ?? NO_FLIP,
      prop: (glb) => this.model(glb),
    });
    this.scene.add(this.fog.object3d, this.beam.object3d, this.walls.object3d, this.rig.object3d, this.veilSight.object3d, this.veilPov.object3d);
    if (this.audience === 'gm' && this.host.fog) {
      this.fogTool = new FogTool({
        parent: this.scene,
        canvas: () => this.container.ownerDocument.createElement('canvas'),
        boardPoint: (x, y) => this.boardPoint(x, y),
        unitsPerPixel: (at) => this.unitsPerPixel(at),
        mapSize: () => (this.mapSizeKnown ? this.mapSize : null),
        commit: (operations) => this.commitFog(operations),
        fogKey: () => (this.map?.fog ?? []).map((operation) => operation.id).join(','),
        changed: () => this.toolbar?.refresh(),
        wake: () => this.wake(),
        walls: () => fogWalls(this.map?.walls ?? NO_WALLS),
        grid: () => (this.map ? { type: this.map.grid.type, size: this.map.grid.size, offsetX: this.map.grid.offsetX, offsetY: this.map.grid.offsetY, snap: this.map.grid.snap } : null),
        mapRect: () => this.fogMapRect(),
        notice: (text) => this.host.fog?.notice(text),
        switchOn: (id) => this.host.fog?.switchOn?.(id) ?? this.fogSwitches[id],
        accent: () => accent(this.container),
      });
    }
    this.toolbar = new BoardToolbar(container, {
      fogHeight: () => this.host.fogHeight(),
      setFogHeight: (height) => this.host.setFogHeight(height),
      ...(this.host.setWallsReachNext && { wallsReachNext: () => this.host.wallsReachNext?.() === true, setWallsReachNext: (on: boolean) => this.host.setWallsReachNext?.(on) }),
      wallThickness: () => this.host.wallThickness(),
      setWallThickness: (thickness) => this.host.setWallThickness(thickness),
      wallEdges: () => this.quality.edges,
      seeThrough: () => this.quality.seeThrough,
      seeThroughSize: () => this.quality.seeThroughSize,
      ...(this.host.setSeeThroughSize && { setSeeThroughSize: (squares: number) => this.host.setSeeThroughSize?.(squares) }),
      layerLook: () => this.quality.layerLook,
      ...(this.host.setLayerLook && { setLayerLook: (look: LayerLook) => this.host.setLayerLook?.(look) }),
      ...(this.host.setSeeThrough && { setSeeThrough: (on: boolean) => this.host.setSeeThrough?.(on) }),
      ...(this.host.setSnap && { snap: () => ({ tokens: this.map?.grid.snap ?? true, props: this.host.snapProps?.() ?? true }), setSnap: (kind: 'tokens' | 'props', on: boolean) => this.host.setSnap?.(kind, on) }),
      ...(this.host.setWallEdges && { setWallEdges: (edges: WallEdges) => this.host.setWallEdges?.(edges) }),
      playerViewOpen: () => this.host.playerViewOpen(),
      laserOn: () => this.laserOn,
      selectTool: (tool) => { this.fogTool?.setOn(false); this.waterTool = null; this.shapeEditor?.setActive(false); this.showBrush(); this.stopPainting(); this.putMeasureAway(); this.setLaser(tool === 'laser'); this.toolbar.refresh(); },
      ...(this.audience === 'gm' && {
        mode: () => this.host.boardMode?.() ?? null,
        setMode: (mode: 'play' | 'edit' | 'cinematic') => this.setMode(mode),
        painting: () => this.painting,
        setPainting: (material: string | null) => this.paintWith(material),
        materials: () => this.host.materials?.() ?? [],
      }),
      laser: () => this.host.laser(),
      canLight: () => this.host.setLighting !== undefined,
      lighting: () => choiceOf(this.quality.painted, this.quality.sky),
      setLighting: (choice) => this.host.setLighting?.(choice),
      tiltShift: () => this.quality.tiltShift,
      setTiltShift: (on) => this.host.setTiltShift?.(on),
      occlusion: () => this.quality.occlusion,
      setOcclusion: (on) => this.host.setOcclusion?.(on),
      grade: () => this.quality.grade,
      setGrade: (on) => this.host.setGrade?.(on),
      halo: () => this.quality.halo,
      setHalo: (on) => this.host.setHalo?.(on),
      depthOfField: () => this.quality.depthOfField,
      setDepthOfField: (on) => this.host.setDepthOfField?.(on),
      dofStrength: () => this.quality.dofStrength,
      setDofStrength: (strength) => this.host.setDofStrength?.(strength),
      dofCenter: () => this.quality.dofCenter,
      setDofCenter: (on) => this.host.setDofCenter?.(on),
      autoRoll: () => this.host.autoRoll?.() ?? false,
      setAutoRoll: (on) => this.host.setAutoRoll?.(on),
      setLaser: (changes) => { this.host.setLaser(changes); this.wake(); },
      togglePlayerView: () => this.host.togglePlayerView(),
      gmView: () => !this.sessionSwitch,
      setGmView: (on) => this.throwGmView(on),
      // The lighting peek's button, which a finger holds in the key's place.
      ...(this.audience === 'gm' && { peek: (on: boolean) => { this.peek(on); }, coarse: () => this.host.coarsePointer?.() === true }),
      gmViewShortcut: () => this.host.measureHotkeys?.().gmView ?? null,
      playerFrozen: () => this.player?.frozen != null,
      togglePlayerFreeze: () => this.setPlayerFrozen(this.player?.frozen == null),
      hosting: () => this.host.hosting?.() === true,
      ...(this.audience === 'gm' && {
        arTableSheets: () => this.arTable?.survey.groups.length ?? null,
        placeArTable: () => { if (this.arTable) this.placeTable(true); else this.host.warn(t('arTable.none')); },
      }),
      ...(this.fogTool && { fog: this.fogBarActions() }),
      waterTool: () => this.waterTool,
      ...(this.audience === 'gm' && this.host.setGround && {
        ground: () => this.groundSettings(),
        setGround: (settings: GroundSettings) => this.host.setGround?.(settings),
        ...(this.host.backgrounds && { backgrounds: () => this.host.backgrounds?.() ?? [] }),
        ...(this.host.newBackground && { newBackground: () => this.host.newBackground?.() }),
      }),
      ...(this.audience === 'gm' && this.host.saveShape && {
        shapeTool: () => this.shapeEditor?.active === true,
        setShapeTool: (on: boolean) => this.setShapeTool(on),
      }),
      setWaterTool: (mode) => {
        this.shiftErase = false;
        if (mode) { this.stopPainting(); this.shapeEditor?.setActive(false); this.fogTool?.setOn(false); }
        this.waterTool = mode;
        if (mode && this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); }
        this.showBrush();
        this.toolbar.refresh();
      },
      waterBrush: () => this.waterBrush,
      waterFill: () => this.waterFill,
      setWaterFill: (sensitivity) => { this.waterFill = Math.min(100, Math.max(0, Math.round(sensitivity))); },
      setWaterBrush: (cells) => { this.waterBrush = Math.min(8, Math.max(0.25, cells)); this.showBrush(); },
      liquid: () => this.brushLiquid,
      setLiquid: (liquid) => { this.brushLiquid = liquid; this.toolbar.refresh(); },
      waterMotion: () => this.motionOf(this.brushLiquid),
      setWaterMotion: (motion) => {
        const liquid = this.brushLiquid;
        this.chosenWaterMotion = { ...this.chosenWaterMotion, [liquid]: motion };
        this.liquids.get(liquid)?.setMotion(motion);
        this.waterLoopsAt = -Infinity;
        this.host.saveWaterMotion?.(motion, liquid);
        this.wake();
      },
      measureOn: () => (this.heldRuler?.tool ?? this.tools.tool) === 'measure',
      measureShape: () => this.heldRuler?.shape ?? this.tools.shape,
      selectMeasure: (shape) => {
        if (shape !== null) {
          this.fogTool?.setOn(false);
          this.waterTool = null;
          this.stopPainting();
          if (this.laserOn) this.setLaser(false);
          this.setMeasureOptions({ mode: shape });
        }
        if (shape === null) this.tools.select('move');
        else this.tools.selectShape(shape);
        this.toolsChanged();
      },
      measureOptions: () => this.measureOptions(),
      setMeasureOptions: (changes) => this.setMeasureOptions(changes),
      clearMeasures: () => { this.host.measureAction?.({ clear: true }); },
      hasKeptMeasures: () => (this.map?.measures.length ?? 0) > 0 || this.tools.shown.length > 0,
      hasLevels: () => (this.map?.levels.length ?? 0) > 1,
      dragDistance: () => this.host.dragDistance?.() ?? 'always',
      setDragDistance: (choice) => { this.host.setDragDistance?.(choice); this.toolbar.refresh(); },
      ...(this.host.openMeasureRules && {
        openMeasureRules: () => this.host.openMeasureRules?.(),
        ...(this.host.canOpenMeasureRules && { canOpenMeasureRules: () => this.host.canOpenMeasureRules?.() === true }),
      }),
      measureShortcut: () => this.host.measureHotkeys?.().measure ?? 'M',
      measureKeepShortcut: () => this.host.measureHotkeys?.().measureKeep ?? 'K',
      diceShortcut: (which) => this.host.measureHotkeys?.()[which] ?? null,
      canUndo: () => this.host.canUndo?.() === true,
      canRedo: () => this.host.canRedo?.() === true,
      undo: this.host.undo ? () => this.host.undo?.() : undefined,
      redo: this.host.redo ? () => this.host.redo?.() : undefined,
      initiativeOpen: () => this.host.initiativeOpen(),
      toggleInitiative: () => this.host.toggleInitiative(),
      ambient: () => this.ambientShown ?? this.host.ambient(),
      lightingOn: () => this.host.lightingOn?.() ?? true,
      setAmbient: (level, keep) => {
        this.ambientShown = keep ? null : level;
        if (keep) this.host.setAmbient(level);
        this.applyLighting();
      },
      tint: () => this.tintShown ?? this.host.tint(),
      setTint: (color, keep) => {
        this.tintShown = keep ? null : color;
        if (keep) this.host.setTint(color);
        this.paintDaylight();
        this.wake(true);
      },
      resetTint: () => {
        this.tintShown = null;
        this.host.clearTint();
        this.paintDaylight();
        this.wake(true);
      },
      ...(this.host.forgetExplored && {
        forgetExplored: () => this.host.forgetExplored?.(),
        forgetExploredOffered: () => this.host.forgetExploredOffered?.() ?? true,
      }),
    });
    this.toolbar.setHidden(this.audience === 'player');
    this.tools.eraseAny = this.audience === 'gm';
    this.scene.add(this.darkness.object3d, this.marks.object3d, this.areas.object3d, this.measureHandles.object3d, this.groupMarks.object3d, this.activeMarks.object3d, this.viewers.object3d, this.tableOutlines);
    this.tableOutlines.name = 'ar-table';
    this.groupBar = new GroupBar(container, { rotate: (delta) => this.rotateGroup(delta), hp: (delta) => this.changeGroupHp(delta), clear: () => this.clearGroup() });
    this.controls = new ResourceControls(container, {
      step: (key, delta) => this.stepResource(key, delta),
      edit: (key) => this.openEditor(key),
    });

    // The fast card where the browser lets a page ask (a Mac with two); on Windows, Tabletop's graphics card setting.
    // A stencil buffer: the line round a die still to be thrown is drawn only outside the die (dieOutline.ts).
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: quality.antialias, powerPreference: 'high-performance', stencil: true, alpha: true });
    // Opaque as ever outside augmented reality: a see-through canvas would let the pane show through what blends.
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    setLook(this.renderer, this.quality.painted);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The resolution follows the quality setting, and drops while the board cannot keep up (adaptive resolution).
    this.governor = new ResolutionGovernor(quality, doc.defaultView?.devicePixelRatio ?? 1);
    this.renderer.setPixelRatio(this.governor.ratio);
    // Shadows are redrawn only when something on the board moves, not when only the camera does.
    this.renderer.shadowMap.autoUpdate = false;
    this.scene.add(this.hemisphere);
    this.paintDaylight();
    this.sun.castShadow = true;
    this.sun.shadow.radius = lightingFor(this.quality.painted, this.quality.sky).shadowRadius;
    this.sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);

    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
    this.listen();
    this.fit();
  }

  /** Shows a map: the first load frames it, later loads (the file changed) keep the camera where it is. */
  async load(map: BoardMap, shiftY = 0, carry: Placement = NO_PLACEMENT): Promise<void> {
    this.showCell(null);
    const first = this.map === null;
    const sameImage = this.map?.background === map.background;
    // A shape under way belongs to the map and level it was drawn on: another scene, level or image drops it.
    if (this.map && (this.map.path !== map.path || this.map.level !== map.level || !sameImage)) this.fogTool?.cancel();
    this.map = map;
    // Another of the stack becomes the one played: its layer is put away and the old scene comes back as a layer (kept
    // ready), at once, both easing; the camera glides between them.
    const next = this.nextKey;
    this.nextKey = null;
    if (!first && next !== null && next !== this.currentKey) this.swapLayers(next, shiftY, carry);
    // Another map: what it waits for shows (the same map's news does not).
    if (first || !sameImage) this.loads.open();
    if (first || !sameImage || this.gridChanged(map)) await this.buildSurface(map);
    if (this.disposed) return;
    // Another scene of the stack: the camera stays where it was in the world, then glides to the new floor.
    if (!first) this.reorigin(shiftY, carry);
    if (first) {
      this.camera = new OrbitCamera({ target: { x: this.size.width / 2, y: 0, z: this.size.height / 2 }, pitch: 0.95 }, this.cameraLimits());
      this.frameWhole();
      this.camera.snap();
    }
    this.sync();
    // The same floor, other news (a player's board getting its board extras): the water is read again where it changed.
    this.syncWater(map);
  }

  /**
   * The scenes stacked with the one shown (their elevations measured from it). They are drawn read-only: the shown
   * scene is the one edited and played.
   */
  setStack(layers: readonly ElevationLayerData[]): void {
    // Read while gliding to another floor: laid out once there, so the glide does not stutter.
    // (A layer not drawn yet is built at once, not left missing.)
    const known = layers.every((layer) => layer.current || this.layerViews.has(layer.path) || this.parked.has(layer.path));
    if (this.camera?.gliding && known) { this.pendingStack = layers; this.wake(true); return; }
    this.pendingStack = null;
    // Low on memory: the scene shown alone.
    const all = this.quality.noLayers ? [] : layers;
    this.stackData = all.filter((layer) => !layer.current);
    // The scene played, kept ready (put away) as a layer for when another is shown.
    this.warmData = all.filter((layer) => layer.current);
    const current = this.warmData[0];
    if (current) this.currentKey = current.path;
    this.applyStack();
    // The stack as read for the scene played: floors none of it shows go (only now: while a scene is being changed,
    // the one left is still to become a layer).
    this.pruneFloors();
  }

  private applyStack(): void {
    const map = this.map;
    const surface = this.surface;
    if (!map || !surface || this.disposed) return;
    const lowest = Math.min(0, ...this.stackData.map((layer) => layer.elevation));
    // The scene being played is always drawn solid (its transparent parts cut out, so the scenes below show through); the Upper layers look is for the scenes above it.
    surface.stack(lowest * map.grid.size, lowest < 0 ? 'solid' : null);
    this.groundPlane.object3d.position.y = lowest * map.grid.size;
    this.seaPlane.object3d.position.y = lowest * map.grid.size;
    this.painted.object3d.position.y = lowest * map.grid.size;
    // The floor of the scene being played is never cut by the see-through window (only the floors above it, and walls, are).
    const wanted = new Map(this.stackData.map((layer) => [layer.path, layer]));
    // A layer no longer drawn is put away, not thrown out: shown again it fades straight back in, nothing read again.
    for (const [path, view] of [...this.layerViews]) {
      if (wanted.has(path)) continue;
      this.layerViews.delete(path);
      this.park(path, view);
    }
    const measurement = this.host.measurement();
    const shape: ElevationLayerShape = {
      cell: map.grid.size,
      offsetX: map.grid.offsetX,
      offsetY: map.grid.offsetY,
      look: this.quality.layerLook,
      minWall: MIN_WALL_SQUARES,
      edge: EDGE_SHARE[this.quality.edges],
      cuts: this.quality.displaceCuts,
      miniShadows: this.quality.miniShadows,
      ambient: this.ambientShown ?? this.host.ambient(),
      litThreshold: LIT_THRESHOLD,
      unitDistance: measurement.unitDistance > 0 ? measurement.unitDistance : 5,
    };
    for (const layer of [...wanted.values(), ...this.warmData]) {
      const warm = layer.current === true;
      let view = this.layerViews.get(layer.path) ?? this.parked.get(layer.path);
      if (view && !warm && this.parked.get(layer.path) === view) {
        // Back from being put away: it fades in.
        this.parked.delete(layer.path);
        this.layerViews.set(layer.path, view);
        view.object3d.visible = true;
        view.fadeTo(1);
      } else if (view && warm && this.layerViews.get(layer.path) === view) {
        this.layerViews.delete(layer.path);
        this.park(layer.path, view);
      }
      if (!view) {
        view = new ElevationLayerView(layer, {
          wallLook: (path, door) => this.wallLook(path, door),
          defaultOf: (wall) => materialWith(null, wall, this.host.materialDefaults?.()),
          displaces: (path) => (path ? this.wallMaterials.get(path)?.userData.displaces === true : false),
          tileOf: (path) => (path ? (this.wallMaterials.get(path)?.userData.tileScale as number | undefined) ?? 1 : 1),
          model: (path) => this.model(path),
          image: (path) => this.floorTexture(path),
          art: (path) => this.artTexture(path),
          cut: (material) => addCutaway(material, this.cutaway),
          wake: () => this.wake(true),
        });
        this.scene.add(view.object3d);
        if (warm) this.park(layer.path, view, true);
        else this.layerViews.set(layer.path, view);
      }
      view.setHalo(this.quality.halo);
      view.update(layer, layer.elevation > 0 ? shape : { ...shape, look: 'solid' });
      // A layer the GM hid is not drawn (and so stands between the camera and nothing), whatever the Upper layers look.
      if (!warm) view.object3d.visible = this.host.layerHidden?.(layer.path) !== true;
    }
    // Put away beyond a dozen: the oldest go for good.
    while (this.parked.size > PARKED_LAYERS) {
      const [path, view] = this.parked.entries().next().value as [string, ElevationLayerView];
      this.parked.delete(path);
      view.dispose();
    }
    this.shadowsDirty = true;
    this.wake(true);
  }

  /**
   * Hands the board what Atlas shows players of the lit scene (`players`), and what the previewed point of view sees
   * (`pov`, null without one): the shared player visibility reader's answers for the Atlas tab that holds the map.
   */
  setAtlasSight(players: BoardSight, pov: BoardSight | null): void {
    this.atlasSight = players;
    this.atlasPov = pov ?? UNLIT;
    this.sightRevision++;
    this.wake(true);
  }

  /** Whether token `id` is being dragged on the board, or glides to where it was put. */
  private tokenMoving(id: string): boolean {
    const press = this.press;
    if (press?.kind === 'token' && press.moved && (press.id === id || press.members?.has(id) === true)) return true;
    return this.tokens.get(id)?.piece.animating === true;
  }

  /** Works out what stands in sight from Atlas's answers, when anything that decides it changed; true when the answer changed. */
  private refreshSight(): boolean {
    const map = this.map;
    if (this.pov !== null && !this.tokens.has(this.pov)) { this.pov = null; this.showPovChip(); this.host.povChanged?.(null); }
    const players = this.atlasSight;
    const pov = this.pov !== null ? this.atlasPov : UNLIT;
    if (!map || (players.kind === 'unlit' && pov.kind === 'unlit')) {
      const had = this.sight !== null || this.povSight !== null;
      this.sight = null;
      this.povSight = null;
      this.sightKey = '';
      this.sightMasks = null;
      this.veilSight.clear();
      this.veilPov.clear();
      return had;
    }
    const pieces = [
      ...[...this.tokens.values()].map((entry) => ({ key: `t:${entry.token.id}`, token: entry.token.id, at: { x: entry.at.x, y: entry.at.y } })),
      ...[...this.props.values()].map((piece) => ({ key: `p:${piece.id}`, token: null, at: { x: piece.object3d.position.x, y: piece.object3d.position.z } })),
    ];
    // Positions are judged to an eighth of a square, so a token gliding along does not ask again at every frame.
    const quantum = Math.max(2, map.grid.size / 8);
    const round = (value: number): number => Math.round(value / quantum) * quantum;
    // The blocks stand as tall as the tallest wall, so nothing of an unseen square shows over them.
    const wallHeights = map.walls.map((wall) => this.host.wallHeight(wall.id) ?? 0);
    const veilHeight = Math.max(MIN_WALL_SQUARES, this.host.fogHeight(), ...wallHeights) * map.grid.size * 1.02;
    const key = JSON.stringify([this.sightRevision, this.pov, veilHeight, this.size, pieces.map((piece) => [piece.key, round(piece.at.x), round(piece.at.y)])]);
    if (key === this.sightKey) return false;
    this.sightKey = key;
    // Not known yet: nothing is seen, and the whole map is veiled.
    const whole: SightCells = { cellSize: Math.max(this.size.width, this.size.height, 1), cols: 1, rows: 1, shown: new Uint8Array(1) };
    const maskOf = (sight: BoardSight): SeenMask | null => sight.kind === 'unlit' ? null
      : sight.kind === 'pending' ? { cells: whole, seenAt: () => false } : { cells: sight.cells, seenAt: sight.seenAt };
    const sightMask = maskOf(players);
    const povMask = maskOf(pov);
    // Players: the tokens Atlas shows them, and the props where they see the map.
    // A token is the one Atlas shows them; while the GM drags it or it glides, also where the board draws it, since Atlas
    // judges it where it stands in the store (the drop, the end of the glide).
    const seen = sightMask === null ? null : new Set(pieces.filter((piece) => (piece.token !== null
      ? players.kind === 'ready' && players.seen.has(piece.token) && (!this.tokenMoving(piece.token) || sightMask.seenAt(piece.at.x, piece.at.y))
      : sightMask.seenAt(piece.at.x, piece.at.y))).map((piece) => piece.key));
    // A point of view: what stands where that token sees the map, and the token itself.
    const from = povMask === null ? null : new Set(pieces.filter((piece) => piece.token === this.pov || povMask.seenAt(piece.at.x, piece.at.y)).map((piece) => piece.key));
    this.sightMasks = { sight: sightMask, pov: povMask };
    const veil = (target: SightVeil, mask: SeenMask | null): void => {
      if (!mask) { target.clear(); return; }
      const { cellSize, cols, rows, shown } = mask.cells;
      target.update(shown, { cols, rows, size: cellSize, startX: 0, startY: 0 }, this.size, veilHeight);
    };
    veil(this.veilSight, sightMask);
    veil(this.veilPov, povMask);
    const differs = (a: Set<string> | null, b: Set<string> | null): boolean => (a === null) !== (b === null) || (a !== null && b !== null && (a.size !== b.size || [...a].some((item) => !b.has(item))));
    const changed = differs(seen, this.sight) || differs(from, this.povSight);
    this.sight = seen;
    this.povSight = from;
    return changed;
  }

  /** The token whose point of view is being previewed, or null. */
  get povToken(): string | null {
    return this.pov;
  }

  /** Looks at the board from a token's point of view: what it cannot see behind walls and shut doors is hidden on the GM's board. Null stops. */
  setPov(id: string | null): void {
    const next = id !== null && this.tokens.has(id) ? id : null;
    if (next === this.pov) return;
    this.pov = next;
    this.host.povChanged?.(next);
    this.sightKey = '';
    this.shadowsDirty = true;
    this.showPovChip();
    this.wake(true);
  }

  /** A chip over the board says whose point of view this is, and stops it. */
  private showPovChip(): void {
    let chip = this.container.querySelector<HTMLElement>(':scope > .atlas-tabletop-pov');
    const entry = this.pov !== null ? this.tokens.get(this.pov) : undefined;
    if (!entry) {
      if (chip) chip.hidden = true;
      return;
    }
    const doc = this.container.ownerDocument;
    if (!chip) {
      chip = doc.win.createDiv();
      chip.className = 'atlas-tabletop-pov';
      chip.setAttribute('role', 'status');
      this.container.appendChild(chip);
    }
    chip.hidden = false;
    chip.replaceChildren();
    const text = doc.win.createSpan();
    text.textContent = `POV: ${entry.token.name ?? 'token'}`;
    const stop = doc.win.createEl('button');
    stop.type = 'button';
    stop.textContent = 'Stop POV';
    stop.addEventListener('click', () => this.setPov(null));
    chip.append(text, stop);
  }

  /** Whether the map point (x, y) lies on a square no viewer has in sight, as `viewer` sees the board (for what is drawn over the veil, as the pins are). */
  private pointBeyond(viewer: 'gm' | 'player', x: number, y: number): boolean {
    const masks = this.sightMasks;
    if (!masks || (this.reveal && viewer === 'player')) return false;
    let mask: SeenMask | null = null;
    if (viewer === 'gm' && masks.pov) mask = masks.pov;
    else if (masks.sight && viewer === 'player') mask = masks.sight;
    if (!mask) return false;
    return !mask.seenAt(x, y);
  }

  /** Whether a piece is beyond what the tokens that see have in sight, as `viewer` sees the board. */
  private beyondSight(viewer: 'gm' | 'player', key: string): boolean {
    if (this.reveal && viewer === 'player') return false;
    // A point of view being previewed is the GM's board alone: players are shown what the tokens that see have in sight.
    if (viewer === 'gm' && this.povSight !== null) return !this.povSight.has(key);
    if (this.sight === null) return false;
    // The GM's own board shows everything, as Atlas's GM view does.
    if (viewer === 'gm') return false;
    return !this.sight.has(key);
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
    const repaint = preset.painted !== this.quality.painted || preset.sky !== this.quality.sky;
    const rounder = preset.edges !== this.quality.edges || preset.displaceCuts !== this.quality.displaceCuts;
    const seeing = preset.seeThrough !== this.quality.seeThrough || preset.seeThroughSize !== this.quality.seeThroughSize;
    if (preset.layerTick !== this.quality.layerTick) this.layerRuler?.setTick(preset.layerTick);
    const restack = (this.layerViews.size > 0 || this.stackData.length > 0)
      && (preset.layerLook !== this.quality.layerLook || rounder || preset.miniShadows !== this.quality.miniShadows);
    const haloChanged = preset.halo !== this.quality.halo;
    this.quality = preset;
    if (haloChanged) {
      this.rig.setHalo(preset.halo);
      for (const view of [...this.layerViews.values(), ...this.parked.values()]) view.setHalo(preset.halo);
      this.wake(true);
    }
    if (restack) this.applyStack();
    if (seeing) this.wake(true);
    if (repaint) this.applyLook();
    // Walls are stood again with their new edges.
    if (rounder) { this.updateWalls(); this.wake(true); }
    if (!postFxOn(preset)) {
      this.tilt?.dispose();
      this.tilt = null;
      if (this.player) {
        this.player.tilt?.dispose();
        this.player.tilt = null;
      }
    }
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
    this.toolbar.refresh();
    this.wake(true);
    return true;
  }

  /** Re-reads the minis, styles, props and rules from the host (they changed outside the map file). */
  refresh(): void {
    if (!this.map) return;
    this.sync();
    this.syncWater(this.map);
  }

  /** The map's water as saved now (an undo or redo, another board of the map): drawn again where it differs. */
  private syncWater(map: BoardMap): void {
    if (this.press?.kind === 'water' || this.savingWater > 0) return;
    const saved = this.host.water?.() ?? null;
    if (waterKeyOf(saved) !== this.waterKey) { this.loadWater(map); this.wake(); return; }
    if (!saved) return;
    const motions = motionsOf(saved);
    for (const [liquid, surface] of this.liquids) {
      const motion = motions[liquid];
      if (JSON.stringify(motion) !== JSON.stringify(surface.currentMotion)) { surface.setMotion(motion); this.waterLoopsAt = -Infinity; this.toolbar.refresh(); this.wake(); }
    }
  }

  /** How the map's liquid of a kind moves now: as drawn, else as chosen, else as the map keeps it. */
  private motionOf(liquid: LiquidKind): WaterMotion {
    return this.liquids.get(liquid)?.currentMotion ?? this.chosenWaterMotion[liquid] ?? motionsOf(this.host.water?.() ?? null)[liquid];
  }

  /** The next left click on the board drops a prop of `glb` there. */
  placeProp(glb: string, look?: PropLook): void {
    this.placing = glb;
    this.placingLook = look;
    this.canvas.setCssStyles({ cursor: 'crosshair' });
    this.canvas.focus();
  }

  /**
   * Looks at the whole map from the current angle: far enough out that the circle around it fits the narrower of the
   * view's two fields of view, so it fits however the camera has turned, with a margin for the tilt.
   */
  frameMap(): void {
    if (!this.allows('camera')) return;
    this.frameWhole();
  }

  /** `frameMap` without asking the lock: the board itself framing a map it has just shown. */
  private frameWhole(): void {
    const half = Math.tan(THREE.MathUtils.degToRad(FOV) / 2) * Math.min(1, this.view.aspect);
    const fit = (Math.hypot(this.size.width, this.size.height) / 2 / half) * FRAME_MARGIN;
    // `frame` stands back 1.8 × the radius it is given (TacticalEngine's framing).
    this.camera.frame({ x: this.size.width / 2, y: 0, z: this.size.height / 2 }, fit / 1.8);
    this.wake();
  }

  /**
   * Another map is shown on the same board (a Connect player's board when the GM presents another scene): the camera
   * takes that map's limits and frames the whole of it at once, as the first map was, not the old map's pose.
   */
  frameNewMap(): void {
    if (!this.map) return;
    this.camera.setLimits(this.cameraLimits());
    this.frameWhole();
    this.camera.snap();
  }

  private gridChanged(map: BoardMap): boolean {
    return this.lastGrid !== JSON.stringify([map.grid, map.world ?? null]);
  }

  private lastGrid = '';

  /** The video of an animated map, while the map is one: the board keeps drawing frames while it plays. */
  private video: HTMLVideoElement | null = null;

  /** A map image as a texture; null when it cannot be read. */
  private async mapTexture(background: string): Promise<THREE.Texture | null> {
    let texture: THREE.Texture | null = null;
    // Never larger than the graphics card takes in one texture, whatever Atlas allows.
    const side = Math.min(MAX_MAP_TEXTURE, this.quality.textureSide ?? MAX_MAP_TEXTURE, this.renderer.capabilities.maxTextureSize);
    // A map too large to decode whole comes as a picture of Atlas's tiles.
    const picture = await this.host.readPicture?.(background, side).catch(() => null);
    if (picture) texture = mapTextureFromPicture(picture);
    if (!texture) {
      const url = await this.host.readImage(background);
      if (url) {
        try {
          texture = await loadMapTexture(url, background, side);
        } catch {
          this.host.warn(`Tabletop: cannot read the map image ${background}.`);
        }
      } else {
        this.host.warn(`Tabletop: the map image ${background} is missing.`);
      }
    }
    return texture;
  }

  /**
   * The floors of a stack, decoded once and kept while the stack is shown: the scene played and every scene stacked with
   * it share one texture per image, so going to another scene of the stack reads nothing and decodes nothing (its floor
   * is already drawn as a layer). A video floor is not kept (letting go of it stops the video).
   */
  private readonly floorTextures = new Map<string, Promise<THREE.Texture | null>>();

  private floorTexture(background: string): Promise<THREE.Texture | null> {
    if (isVideoPath(background)) return this.loads.track(this.mapTexture(background), 4);
    let kept = this.floorTextures.get(background);
    if (!kept) {
      kept = this.loads.track(this.mapTexture(background), 4).then((texture) => {
        if (texture) { texture.userData.shared = true; this.floorReady.set(background, texture); }
        return texture;
      });
      this.floorTextures.set(background, kept);
    }
    return kept;
  }

  /** A kept floor's texture, once read (null before). */
  private floorTextureNow(background: string): THREE.Texture | null {
    return this.floorReady.get(background) ?? null;
  }

  /** Lets go of the kept floors no scene of the stack shows any more. */
  private pruneFloors(): void {
    const wanted = new Set([this.map?.background, ...this.stackData.map((layer) => layer.map.background), ...[...this.parked.values()].map((view) => view.background)].filter((path): path is string => typeof path === 'string'));
    for (const [path, kept] of [...this.floorTextures]) {
      if (wanted.has(path)) continue;
      this.floorTextures.delete(path);
      this.floorReady.delete(path);
      void kept.then((texture) => texture?.dispose());
    }
  }

  private async buildSurface(map: BoardMap): Promise<void> {
    const texture = map.background ? await this.floorTexture(map.background) : null;
    if (this.disposed) { if (texture && texture.userData.shared !== true) texture.dispose(); return; }
    const imageSize = mapImageSize(texture) ?? { width: FALLBACK_SIZE, height: FALLBACK_SIZE };
    // A player's map comes in the world's own size, whatever the image sent (a shrunk copy, a stretched or turned map).
    const world = map.world && map.world.width > 0 && map.world.height > 0 ? map.world : null;
    // Atlas's grid alignment may have turned or stretched the image: the world, and so the board, is then bigger than it.
    const stretch = texture && !world ? map.grid.mapStretch : undefined;
    const { width, height } = world ?? (stretch ? worldSize(imageSize, stretch) : imageSize);
    this.video = (texture?.userData.video as HTMLVideoElement | undefined) ?? null;
    this.surface?.object3d.removeFromParent();
    this.surface?.dispose();
    const matrix = world ? (world.matrix ?? ([width, 0, 0, height, 0, 0] as const)) : undefined;
    this.surface = new BoardSurface(width, height, map.grid, stretch ? { image: imageSize, placement: stretchPlacement(imageSize, stretch) } : undefined, matrix);
    this.surface.setImage(texture);
    this.fillColors = null;
    this.fillSource = fillSourceFor(texture, imageSize, world ? matrix ?? null : null, stretch ?? null);
    this.scene.add(this.surface.object3d);
    this.size = { width, height };
    this.sizeKnown = world !== null || mapImageSize(texture) !== null;
    this.hasImage = texture !== null;
    this.cells = numberCells(map.grid, width, height);
    this.lastGrid = JSON.stringify([map.grid, map.world ?? null]);
    const span = Math.max(width, height);
    this.span = span;
    this.applyHorizon();
    this.loadWater(map);
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
    this.baseNear = this.view.near;
    this.view.far = span * 40;
    this.view.updateProjectionMatrix();
    this.applyStack();
    // The shapes wear the map image just read, at the map's size.
    this.drawShapes();
    this.applyGround();
  }

  /** The ground round the map as its settings say: the table (grown by the extra board) or the plane to the horizon, and the fog. */
  private applyGround(): void {
    const map = this.map;
    if (!map || !this.surface) return;
    const ground = this.groundSettings();
    const cell = map.grid.size;
    // The painted background, once it is read and made; until then (or if it cannot be), the plain horizon plane.
    // Out to a little past where the fog hides everything, from anywhere over the map.
    const reach = planeReach(ground.fog, this.span);
    // A bare board (the leanest memory) keeps only the table: no painted background, horizon plane or sea.
    const bare = this.quality.bare === true;
    const paintedLook = ground.mode === 'painted' && !this.seeThrough && !bare
      ? this.painted.look(ground.background, { width: this.size.width, height: this.size.height, cell, margin: ground.margin, tile: ground.tile, reach })
      : (this.painted.clear(), null);
    const horizon = (ground.mode === 'horizon' || ground.mode === 'painted') && !this.seeThrough && !bare;
    const sea = (ground.mode === 'water' || ground.mode === 'lava' || ground.mode === 'acid') && !this.seeThrough && !bare;
    this.surface.setMargin(ground.mode === 'board' ? ground.margin * map.grid.size : 0);
    this.surface.showTable(!horizon && !sea);
    const lowest = Math.min(0, ...this.stackData.map((layer) => layer.elevation)) * map.grid.size;
    if (sea) {
      if (!this.seaPlane.object3d.parent) this.scene.add(this.seaPlane.object3d);
      const liquid = ground.mode as LiquidKind;
      this.seaPlane.update(ground[liquid], { width: this.size.width, height: this.size.height, cell: map.grid.size, reach }, liquid);
      this.seaPlane.object3d.position.y = lowest;
    } else this.seaPlane.object3d.removeFromParent();
    if (horizon) {
      if (!this.groundPlane.object3d.parent) this.scene.add(this.groundPlane.object3d);
      // A painted background not yet read (or gone) leaves plain ground: the Ground panel's material is not its own.
      const { material: _material, ...plain } = ground;
      this.groundPlane.update(ground.mode === 'painted' ? plain : ground, { width: this.size.width, height: this.size.height, cell, margin: ground.margin, reach }, (folder) => this.loads.track(this.host.readMaterial(folder), 2), () => this.wake(true), paintedLook ?? undefined);
      // Always under the scene's first level, whichever level is shown (the shown one stands at 0, those below it under).
      this.groundPlane.object3d.position.y = lowest;
    } else this.groundPlane.object3d.removeFromParent();
    if (paintedLook && this.painted.hasContent) {
      if (!this.painted.object3d.parent) this.scene.add(this.painted.object3d);
      this.painted.object3d.position.y = lowest;
    } else this.painted.object3d.removeFromParent();
    this.applyHorizon();
    this.paintDaylight();
    this.wake(true);
  }

  /** The painted background's liquid sheets, by liquid (none while the ground is not painted). */
  get paintedLiquids(): ReadonlyMap<LiquidKind, WaterSurface> {
    return this.painted.liquids;
  }

  /** Reads the painted background `ref` again next time the ground is drawn (the host saved it), and draws the ground now. */
  forgetBackground(ref: string): void {
    this.painted.forget(ref);
    if (!this.disposed) this.applyGround();
  }

  private groundSettings(): GroundSettings {
    const ground = this.host.ground?.();
    return ground ? readGround(ground) : DEFAULT_GROUND;
  }

  /** Draws the raised shapes of the level shown (the one being edited as it is now), and the editor's handles with `handles`. */
  private drawShapes(handles = true): void {
    const map = this.map;
    if (!map) return;
    if (!this.shapesView.object3d.parent) this.scene.add(this.shapesView.object3d);
    const kept = this.host.shapes?.() ?? [];
    const image = (this.surface?.imageMaterial as THREE.MeshStandardMaterial | undefined)?.map ?? null;
    this.drawnShapes = this.shapeEditor ? this.shapeEditor.merged(kept) : kept;
    // The tokens' stands are found again (they stand on the shapes).
    this.propsVersion += 1;
    this.shapesView.update(this.drawnShapes, {
      cell: map.grid.size, width: this.size.width, height: this.size.height, image,
      material: (folder) => this.wallLook(folder, false),
    });
    if (handles) this.shapeEditor?.refresh();
    this.wake(true);
  }

  /** Takes up the Shapes tool, or puts it down: one tool at a time. */
  private setShapeTool(on: boolean): void {
    if (on) {
      if (this.host.boardMode?.() !== 'edit') this.setMode('edit');
      if (this.waterTool) { this.waterTool = null; this.showBrush(); }
      this.fogTool?.setOn(false);
      this.stopPainting();
      if (this.laserOn) this.setLaser(false);
      if (this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); }
      if (!this.shapeEditor) {
        this.shapeEditor = new ShapeEditor(this.container, {
          cell: () => this.map?.grid.size ?? 1,
          shapes: () => this.host.shapes?.() ?? [],
          floorAt: (x, y) => this.boardPoint(x, y),
          pick: (x, y, objects) => this.hit(x, y, objects),
          save: (shape) => this.host.saveShape?.(shape),
          remove: (id) => this.host.removeShape?.(id),
          changed: () => this.drawShapes(false),
        });
        this.scene.add(this.shapeEditor.object3d);
      }
    }
    this.shapeEditor?.setActive(on);
    this.toolbar.refresh();
    this.wake(true);
  }

  /** The shape under the pointer, of the level shown. */
  private shapeAt(clientX: number, clientY: number): string | null {
    const hit = this.hit(clientX, clientY, this.shapesView.pickables);
    return (hit?.userData.shapeId as string | undefined) ?? null;
  }

  /**
   * The raised shape under the pointer and which part of it (its surface, or its closed sides), when it is nearer than
   * any wall there: what a material dropped or painted there goes to. Null over nothing of a shape, or a wall before it.
   */
  private shapePartAt(clientX: number, clientY: number): { shape: TerrainShape; part: 'top' | 'sides' } | null {
    this.ray(clientX, clientY);
    for (const mesh of this.shapesView.pickables) mesh.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObjects(this.shapesView.pickables, false)[0];
    if (!hit) return null;
    this.walls.object3d.updateWorldMatrix(true, true);
    const wall = this.raycaster.intersectObject(this.walls.object3d, true)[0];
    if (wall && wall.distance < hit.distance) return null;
    const shape = (this.host.shapes?.() ?? []).find((one) => one.id === hit.object.userData.shapeId);
    if (!shape) return null;
    return { shape, part: hit.face?.materialIndex === 1 ? 'sides' : 'top' };
  }

  /** Paints a raised shape's surface or its sides with a material (null: plain again: the map image on top, plain sides). */
  private paintShape(shape: TerrainShape, part: 'top' | 'sides', material: string | null): void {
    const { material: top, sides, ...rest } = shape;
    if (part === 'top') this.host.saveShape?.({ ...rest, ...(sides !== undefined && { sides }), ...(material && { material }) });
    else this.host.saveShape?.({ ...rest, ...(top && { material: top }), sides: material ?? true });
  }

  /** Brings tokens, pins and props in line with the map and the host. */
  private sync(): void {
    const map = this.map!;
    const rules = this.host.rules();
    this.darkness.update((map as { darkness?: FogOperation[] }).darkness ?? []);
    try {
      this.fog.update(map.fog, this.host.fogHeight(), map.grid.size);
      this.fogTool?.fogDrawn();
      // Another board of this vault switched the shared mode away from Edit: the tool is put down here too.
      if (this.fogTool?.on && !this.editing) { this.fogTool.setOn(false); this.toolbar.refresh(); }
      // The fog tool's bars say whether there is fog to delete: they follow what the map holds.
      const fogShown = map.fog.map((operation) => operation.id).join(',');
      if (fogShown !== this.fogShown) { this.fogShown = fogShown; if (this.fogTool) this.toolbar.refresh(); }
    } catch (error) {
      this.host.warn(`Tabletop: cannot show this map's fog of war: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Walls stand as tall as the fog (never quite flat, so a map with flat fog still shows them).
    this.updateWalls();
    this.applyLighting();
    // Combatants kept beside the map (Atlas 0.9) are no part of it: not drawn, not counted, not seen.
    // Tokens on another level (Atlas 0.10) stay in the map for the tracker, but are not drawn.
    const onMap = map.tokens.filter((token) => !token.offMap && !token.offLevel);
    // Players see the GM's numbers (Atlas 0.10): copies on a level are counted hidden or not, and a token they cannot see shows none.
    const numbers = instanceBadgeNumbers(new Map(onMap.map((token) => [token.id, token])), map.tokenSettings.showInstanceBadges);
    // News of the scene being played, not another scene (or level) opening: only those moves and doors are heard.
    const scene = sceneKey(map);
    const sameScene = scene === this.syncedScene;
    this.syncedScene = scene;
    const was = sameScene ? new Map([...this.tokens].map(([id, entry]) => [id, { x: entry.token.x, y: entry.token.y }])) : null;
    const seen = new Set<string>();
    for (const token of onMap) {
      seen.add(token.id);
      const badge = numbers.get(token.id) ?? null;
      const gmLook = { viewer: 'gm' as const, badge };
      const playerLook = { viewer: 'player' as const, badge: badge !== null && playerSees(token, this.tokens.get(token.id)?.goal ?? token, this.fog.areas) ? badge : null };
      let entry = this.tokens.get(token.id);
      if (!entry) {
        const piece = new TokenPiece(token, map.grid, rules.definitions);
        piece.setMiniShadows(this.quality.miniShadows);
        const labels = new TokenLabels(token, map.tokenSettings, rules, gmLook);
        const playerLabels = new TokenLabels(token, map.tokenSettings, rules, playerLook);
        playerLabels.object3d.visible = false;
        piece.object3d.add(labels.object3d, playerLabels.object3d);
        this.scene.add(piece.object3d);
        entry = { token, piece, labels, playerLabels, at: { x: token.x, y: token.y }, goal: { x: token.x, y: token.y }, mini: null, lift: 0 };
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
    if (was) this.hearRemoteMoves(was, onMap);
    this.hearRemoteDoors(map, sameScene);
    this.hearMapChanges(map, rules.conditions, scene, sameScene);
    if (this.selectedId !== null && !this.tokens.has(this.selectedId)) this.select(null);
    // Tokens just added (the asset manager's spawn) are selected once they stand on the board.
    if (this.pendingSelection && this.pendingSelection.every((id) => this.tokens.has(id))) {
      const ids = this.pendingSelection;
      this.pendingSelection = null;
      this.selectTokens(ids);
    }
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
      const piece = new InkPiece(ink);
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
    this.propOrder = [...wanted.keys()];
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
        this.propsVersion += 1;
        this.wake(true);
      });
    }
    this.propsVersion += 1;
    this.drawShapes();
    this.applyGround();
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
    void this.artTexture(path).then((texture) => {
      if (this.tokens.get(entry.token.id) !== entry || entry.token.imagePath !== path) return;
      if (!texture) this.host.warn(`Tabletop: cannot show the token art ${path}.`);
      entry.piece.setArt(texture);
      this.wake(true);
    });
  }

  /** A token's art as a texture, kept: tokens share it. */
  private artTexture(path: string): Promise<THREE.Texture | null> {
    let art = this.arts.get(path);
    if (!art) {
      // On a device short of memory (a phone) the art is kept small: a token is a small thing on the screen.
      art = this.loads.track(this.host.readImage(path).then((url) => (url ? loadImageTexture(url) : null)).then((texture) => {
        if (texture) capTexture(texture, this.quality.imageSide);
        return texture;
      }).catch(() => null));
      this.arts.set(path, art);
    }
    return art;
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

  /**
   * A flat picture of a model, seen from the side on a transparent ground, for the far painted props. Drawn once into
   * its own target (the lights are flat: the scene lights it again when the card is drawn); disposing the texture frees the target.
   */
  private impostorOf(model: LoadedMini): THREE.Texture {
    const renderer = this.renderer;
    const span = impostorSpan(model);
    const stage = new THREE.Scene();
    const copy = cloneSkinned(model.scene);
    copy.scale.setScalar(1);
    stage.add(copy, new THREE.AmbientLight(0xffffff, Math.PI));
    const camera = new THREE.OrthographicCamera(-span / 2, span / 2, span, 0, 0.01, span * 20);
    camera.position.set(0, 0, span * 5);
    const previousTarget = renderer.getRenderTarget(), previousColor = renderer.getClearColor(new THREE.Color()), previousAlpha = renderer.getClearAlpha();
    // Behind the model, a full-frame sheet of the model's average colour that is fully clear: the renderer's own clear
    // would drop the colour of a clear pixel (it multiplies by alpha), but this keeps it, so the soft edge of the
    // picture, mixed down the mipmaps, fades to the model's colour and not to black.
    const average = averageColor(model);
    const backdropGeometry = new THREE.PlaneGeometry(span * 2, span * 2);
    const backdropMaterial = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Vector3(average.r, average.g, average.b) } },
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 0.0); }',
      blending: THREE.NoBlending,
      depthWrite: false,
      depthTest: false,
    });
    const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial);
    backdrop.position.set(0, span / 2, -span * 3);
    backdrop.renderOrder = -1;
    backdrop.frustumCulled = false;
    stage.add(backdrop);
    let target: THREE.WebGLRenderTarget | null = null;
    try {
      target = new THREE.WebGLRenderTarget(256, 256, { samples: 4, depthBuffer: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(stage, camera);
    } catch (error) {
      target?.dispose();
      throw error;
    } finally {
      backdropGeometry.dispose();
      backdropMaterial.dispose();
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousColor, previousAlpha);
    }
    const made = target as THREE.WebGLRenderTarget;
    const texture = made.texture;
    texture.userData.target = made;
    const free = texture.dispose.bind(texture);
    texture.dispose = (): void => { free(); made.dispose(); };
    return texture;
  }

  private model(path: string): Promise<LoadedMini | null> {
    let found = this.models.get(path);
    if (!found) {
      // On a device short of memory (a phone) the model's own textures are kept small before they are drawn.
      found = this.loads.track(this.host.readMini(path).then((mini) => {
        capObjectTextures(mini.scene, this.quality.imageSide);
        return mini;
      }).catch((error: unknown) => {
        this.host.warn(`Tabletop: cannot show ${path}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }), 2);
      this.models.set(path, found);
    }
    return found;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  /** The post-processing (miniature look, contact shadows), made when a setting asks for it. */
  private tilt: PostFx | null = null;

  /** The farthest the camera looks, in map pixels, from the map's size. */
  private span = 1000;

  /** In the painted look the floor runs out to the horizon and fades into the sky's colour there. */
  private applyHorizon(): void {
    const painted = this.quality.painted;
    this.surface?.widenFloor(painted ? 3 : 1);
    this.surface?.showFloor(!this.seeThrough);
    if (!this.cameraUnbound) this.camera.limits.minPitch = limitsFor(this.size.width, this.size.height, painted).minPitch;
    const ground = this.groundSettings();
    // The plane to the horizon fades into its own distance fog (the GM's slider), whatever the look.
    const range = ground.mode !== 'board' && !this.seeThrough ? fogRange(ground.fog, this.span) : painted && !this.seeThrough ? { near: this.span * 4, far: this.span * 16 } : null;
    this.scene.fog = range ? new THREE.Fog(tinted(horizonColor(this.quality.sky), this.tintShown ?? this.host.tint()), range.near, range.far) : null;
  }

  /** What the sky behind the table was last painted for: its look, its sky and the tint. */
  private backdropKey = '';

  /** The colours of the daylight and of the sky behind the table: the look's, multiplied by the tint the GM gave the board. */
  private paintDaylight(): void {
    const lighting = lightingFor(this.quality.painted, this.quality.sky);
    const tint = this.tintShown ?? this.host.tint();
    this.hemisphere.color.copy(tinted(lighting.skyColor, tint));
    this.hemisphere.groundColor.copy(tinted(lighting.groundColor, tint));
    // A sea of lava lights everything from below in its own glow.
    const ground = this.groundSettings();
    if (ground.mode === 'lava' && !this.seeThrough) this.hemisphere.groundColor.lerp(LAVA_UNDERLIGHT.set(ground.lava.tint), 0.65);
    this.sun.color.copy(tinted(lighting.sunColor, tint));
    // In augmented reality the camera's picture is the room round the table.
    if (this.seeThrough) return;
    const key = `${this.quality.painted}|${this.quality.sky}|${tint ?? ''}`;
    if (key === this.backdropKey) return;
    this.backdropKey = key;
    const old = this.scene.background;
    this.scene.background = room(this.container.ownerDocument, this.quality.painted, this.quality.sky, tint);
    if (old instanceof THREE.Texture) old.dispose();
    if (this.scene.fog instanceof THREE.Fog) this.scene.fog.color.copy(tinted(horizonColor(this.quality.sky), tint));
  }

  /** The painted look or the classic one: the lights, the tone mapping, the soft shadows, the room round the table. */
  private applyLook(): void {
    const lighting = lightingFor(this.quality.painted, this.quality.sky);
    this.paintDaylight();
    this.sun.shadow.radius = lighting.shadowRadius;
    // The shadow map is made again for the new filter: drawing with the old one mismatches the shaders.
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    setLook(this.renderer, this.quality.painted);
    if (this.player) setLook(this.player.renderer, this.quality.painted);
    this.applyHorizon();
    this.shadowsDirty = true;
  }

  /** How far the board's own camera is from where it aims, for depth of field; null for a camera that aims at no point (the eyes, AR, a room). */
  private focusDistance: number | null = null;

  /** What the post-processing is asked for now; `focus` is the camera's focus distance for depth of field (null: what the middle of the view rests on). */
  private looks(focus: number | null = null): PostFxLook {
    return { tilt: this.quality.tiltShift, grade: this.quality.grade, depthOfField: this.quality.depthOfField, dofStrength: this.quality.dofStrength, focus, occlusion: this.quality.occlusion && { radius: (this.map?.grid.size ?? 50) * 0.5 } };
  }

  /** The size and resolution the canvas was last given. */
  private fitted = { width: 0, height: 0, ratio: 0 };

  fit(): void {
    this.lookOnScreen();
    // The room tracking session sizes the picture itself (and refuses a change while it shows).
    if (this.room) return;
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
      // Over the table in augmented reality the camera is no token's: it is never inside the fog.
      this.blind = !this.seeThrough && !this.reveal && this.fog.hides(this.view.position, (point) => insideFog(this.fog.areas, point));
      if (this.blind) {
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.clear();
        return;
      }
    }
    // Atlas's session view: the GM's own board shows the players' picture, drawn afresh each frame (a token may have moved under the fog).
    else if (this.sessionView) {
      this.showFor('player');
      this.sightApplied = true;
    }
    // The GM's board follows a previewed point of view, and goes back to showing everything after it.
    else if (this.povSight !== null) {
      this.showFor('gm');
      this.sightApplied = true;
    } else if (this.sightApplied) {
      this.showFor('gm');
      this.sightApplied = false;
    }
    // Looking out of a token's eyes, the scenes above are always there, whole and solid; their own look again after.
    const firstPerson = this.eye !== null;
    for (const view of this.layerViews.values()) {
      if (firstPerson) { view.setVisible(true); view.setBlackout(false); }
      view.setFirstPerson(firstPerson);
    }
    // In room tracking the drawn camera hangs from the rig: its own position is in the room's metres.
    this.fog.face(this.room ? this.view.getWorldPosition(new THREE.Vector3()) : this.view.position);
    if (this.seeThrough) {
      // See-through where nothing is drawn, the effects (which fill the picture) left out.
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.render(this.scene, this.view);
    } else if (postFxOn(this.quality)) {
      this.tilt ??= new PostFx(this.renderer, this.quality.antialias);
      this.tilt.render(this.scene, this.view, this.looks(this.quality.dofCenter ? null : this.focusDistance));
    } else {
      this.renderer.render(this.scene, this.view);
    }
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
    if (!pose || !this.allows('camera')) return false;
    this.camera.view(pose.eye, pose.target);
    this.wake();
    return true;
  }

  /** The line across the board's top (Connect hosting while Atlas does not hold the map); null takes it away. */
  /**
   * The shown scene changed to another of its stack: the world did not move, so the camera keeps what it looks at
   * (the old scene's floor, now `shiftY` map pixels away) and glides to the new scene's floor.
   */
  reorigin(shiftY: number, carry: Placement = NO_PLACEMENT): void {
    if (!shiftY && isNoPlacement(carry)) return;
    // The new scene is the origin: its own placement on the plane is taken out of the world, so the camera is carried
    // along (the point it looks at, and its heading) and keeps its view of the base.
    for (const pose of [this.camera.pose, this.camera.goal]) {
      const carried = carryView(pose.target, pose.yaw, carry);
      pose.target.x = carried.x;
      pose.target.z = carried.z;
      pose.yaw = carried.yaw;
    }
    // A long, eased glide to the new floor (the old one fades out under it meanwhile).
    const from = this.camera.pose.target.y + shiftY;
    this.camera.goal.target.y = 0;
    if (shiftY) this.camera.glideY(from, LAYER_GLIDE_SECONDS); else this.camera.pose.target.y = from;
    this.wake(true);
  }

  /** The scene about to be shown is the stack's `key` (a level's key or a scene's path): the next load swaps them over. */
  switchingTo(key: string): void {
    this.nextKey = key;
  }

  /** Puts a layer away: it fades out, then is not drawn; kept to come back. */
  private park(path: string, view: ElevationLayerView, instant = false): void {
    this.parked.delete(path);
    this.parked.set(path, view);
    view.fadeTo(0);
    if (instant) view.object3d.visible = false;
  }

  /**
   * The layer `next` becomes the scene played: every layer moves by the scenes' difference in height, `next`'s own is
   * put away (the scene's floor takes its place) and the old scene's comes back as a layer, easing in. Only where the
   * scenes share a plane (levels, or scenes not moved apart); else the stack is laid out again once read.
   */
  private swapLayers(next: string, shiftY: number, carry: Placement): void {
    const cell = this.map?.grid.size ?? 50;
    if (!isNoPlacement(carry)) return;
    const squares = shiftY / cell;
    for (const view of [...this.layerViews.values(), ...this.parked.values()]) view.shiftElevation(squares);
    const incoming = this.layerViews.get(next);
    if (incoming) { this.layerViews.delete(next); this.park(next, incoming); }
    const old = this.currentKey !== null ? this.parked.get(this.currentKey) : undefined;
    if (old && this.currentKey !== null) {
      this.parked.delete(this.currentKey);
      this.layerViews.set(this.currentKey, old);
      old.object3d.visible = this.host.layerHidden?.(this.currentKey) !== true;
      old.restyle(old.elevation > 0 ? this.quality.layerLook : 'solid');
      old.fadeTo(1);
    }
    this.currentKey = next;
    this.wake(true);
  }

  /** The size of a scene of the stack in its own pixels (its image's once read); null when it is not in the stack. */
  layerSize(path: string): { width: number; height: number } | null {
    return this.layerViews.get(path)?.size ?? null;
  }

  // ── The players' AR table ────────────────────────────────────────────────

  /**
   * Where the players' printed AR marker sheets lie on the map (Connect's players surveyed it, the GM placed it), drawn
   * as their outlines with their names; null takes them away. Only the GM's board shows them, never the players' window.
   */
  setArTable(table: SavedArTable | null): void {
    this.arTable = table;
    if (!table && this.tablePlacing) this.placeTable(false);
    if (!this.tablePlacing && table) this.adjustPlacement = this.tablePlacement(table);
    // Placing, and not mid-drag: the handles stay on the table's middle (its square size may have changed).
    if (this.tablePlacing && this.gizmo && this.press?.kind !== 'gizmo') {
      const middle = this.tableMiddle();
      this.gizmo.object3d.position.set(middle.x, this.tableHeight() + 0.5, middle.y);
    }
    this.drawTable();
    this.wake(true);
  }

  /** Starts (or stops) placing the AR table: the move and turn handles on it, and a chip to say so. */
  placeTable(on: boolean): void {
    if (on && !this.arTable) return;
    this.tablePlacing = on;
    this.gizmo?.dispose();
    this.gizmo = null;
    if (on && this.arTable && this.map) {
      this.adjustPlacement = this.tablePlacement(this.arTable);
      const middle = this.tableMiddle();
      const gizmo = new PlacementGizmo();
      gizmo.object3d.position.set(middle.x, this.tableHeight() + 0.5, middle.y);
      this.scene.add(gizmo.object3d);
      this.gizmo = gizmo;
      this.camera.lookAt({ x: middle.x, y: 0, z: middle.y });
    }
    this.showTableChip();
    this.drawTable();
    this.wake(true);
  }

  /** The point of the map in the middle of the view (squares). */
  viewMiddle(): { x: number; y: number } {
    const target = this.camera.goal.target;
    const cell = this.map?.grid.size ?? 70;
    return { x: target.x / cell, y: target.z / cell };
  }

  /** Whether the GM is placing the AR table. */
  get placingTable(): boolean {
    return this.tablePlacing;
  }

  /** The saved placing as the gizmo works it: map pixels and degrees. */
  private tablePlacement(table: SavedArTable): Placement {
    const cell = this.map?.grid.size ?? 70;
    return { x: table.place.x * cell, y: table.place.y * cell, turn: (table.place.turn * 180) / Math.PI };
  }

  /** The table as placed now (the handles' placing while they are dragged). */
  private placedTable(): SavedArTable | null {
    const table = this.arTable;
    if (!table) return null;
    if (!this.tablePlacing) return table;
    const cell = this.map?.grid.size ?? 70;
    const p = this.adjustPlacement;
    return { survey: table.survey, place: { x: p.x / cell, y: p.y / cell, turn: (p.turn * Math.PI) / 180 } };
  }

  /** A survey point (millimetres) on the map (map pixels), as placed now. */
  private tablePoint(table: SavedArTable, x: number, y: number): { x: number; y: number } {
    const cell = this.map?.grid.size ?? 70;
    const k = cell / table.survey.squareMm;
    const c = Math.cos(table.place.turn);
    const s = Math.sin(table.place.turn);
    return { x: table.place.x * cell + (c * x - s * y) * k, y: table.place.y * cell + (s * x + c * y) * k };
  }

  /** The middle of the table's sheets on the map (map pixels). */
  private tableMiddle(): { x: number; y: number } {
    const table = this.placedTable();
    if (!table) return { x: this.size.width / 2, y: this.size.height / 2 };
    const points = table.survey.groups.map((group) => this.tablePoint(table, group.x, group.y));
    return { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length };
  }

  /** The table is the lowest scene's floor. */
  private tableHeight(): number {
    return Math.min(0, ...this.stackData.map((layer) => layer.elevation)) * (this.map?.grid.size ?? 70) + 1.5;
  }

  /** The sheets' outlines and names on the map. */
  private drawTable(): void {
    const group = this.tableOutlines;
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | undefined;
        if (material) { (material as THREE.SpriteMaterial).map?.dispose(); material.dispose(); }
      });
    }
    const table = this.placedTable();
    // Seen only while the GM fine-tunes it (Board settings, AR table).
    if (!table || !this.map || !this.tablePlacing) return;
    const y = this.tableHeight();
    const color = this.tablePlacing ? 0x5ec8ff : 0x9ad7ff;
    for (const sheet of table.survey.groups) {
      const c = Math.cos(sheet.heading);
      const s = Math.sin(sheet.heading);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
        const lx = (u * sheet.w) / 2;
        const ly = (v * sheet.h) / 2;
        const point = this.tablePoint(table, sheet.x + c * lx - s * ly, sheet.y + s * lx + c * ly);
        return new THREE.Vector3(point.x, y, point.y);
      });
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
      line.renderOrder = 9;
      const shape = new THREE.Shape(corners.map((corner) => new THREE.Vector2(corner.x, corner.z)));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: this.tablePlacing ? 0.18 : 0.1, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
      fill.position.y = y;
      fill.renderOrder = 8;
      const middle = this.tablePoint(table, sheet.x, sheet.y);
      const plate = plateTexture(groupLabel(sheet.group), 20);
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: plate.texture, sizeAttenuation: false, transparent: true, depthTest: false }));
      label.userData.aspect = plate.width / plate.height;
      label.position.set(middle.x, y + 1, middle.y);
      label.renderOrder = 10;
      group.add(line, fill, label);
    }
    this.sizeTableLabels();
  }

  /** The sheets' names keep one size on screen. */
  private sizeTableLabels(): void {
    const pixel = this.lastPose?.pixel;
    if (!pixel) return;
    for (const child of this.tableOutlines.children) {
      if (!(child as THREE.Sprite).isSprite) continue;
      const aspect = (child.userData.aspect as number | undefined) ?? 1;
      child.scale.set(pixel * 18 * aspect, pixel * 18, 1);
    }
  }

  /** The chip over the board while placing the AR table: its square size, and Done or Remove. */
  private showTableChip(): void {
    let chip = this.container.querySelector<HTMLElement>(':scope > .atlas-tabletop-adjust.is-table');
    if (!this.tablePlacing) {
      chip?.remove();
      return;
    }
    const doc = this.container.ownerDocument;
    if (!chip) {
      chip = doc.win.createDiv();
      chip.className = 'atlas-tabletop-adjust is-table';
      chip.setAttribute('role', 'status');
      this.container.appendChild(chip);
    }
    chip.replaceChildren();
    const table = this.arTable;
    const text = doc.win.createSpan();
    text.textContent = `Placing the AR table${table ? ` (${table.survey.groups.length} sheets)` : ''}: drag the handles`;
    const square = doc.win.createEl('select');
    square.setAttribute('aria-label', 'A square on the table');
    for (const size of TABLE_SQUARES_MM) {
      const option = doc.win.createEl('option');
      option.value = String(size);
      option.textContent = `${size} mm squares`;
      option.selected = size === table?.survey.squareMm;
      square.append(option);
    }
    if (table && !(TABLE_SQUARES_MM as readonly number[]).includes(table.survey.squareMm)) {
      const option = doc.win.createEl('option');
      option.value = String(table.survey.squareMm);
      option.textContent = `${table.survey.squareMm} mm squares`;
      option.selected = true;
      square.append(option);
    }
    square.addEventListener('change', () => {
      const placed = this.placedTable();
      if (!placed) return;
      this.host.tablePlaced?.({ ...placed, survey: { ...placed.survey, squareMm: Number(square.value) } });
    });
    const remove = doc.win.createEl('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { this.placeTable(false); this.host.tableRemoved?.(); });
    const done = doc.win.createEl('button');
    done.type = 'button';
    done.textContent = 'Done';
    done.addEventListener('click', () => this.placeTable(false));
    chip.append(text, square, remove, done);
  }

  /** The point of the placed table's plane under the pointer (the ray from the camera meets it), as map coordinates (x, y on the map = x, z here). */
  private adjustPoint(): { x: number; z: number } | null {
    const gizmo = this.gizmo;
    if (!gizmo) return null;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -gizmo.object3d.position.y);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  /** A press on a handle: the table follows the pointer from here. */
  private beginGizmo(x: number, y: number): boolean {
    const gizmo = this.gizmo;
    if (!gizmo || !this.tablePlacing) return false;
    this.ray(x, y);
    const part = gizmo.hit(this.raycaster);
    const at = this.adjustPoint();
    if (!part || !at) return false;
    const middle = gizmo.object3d.position;
    this.press = { kind: 'gizmo', part, last: at, angle: Math.atan2(at.z - middle.z, at.x - middle.x), turned: 0, from: this.adjustPlacement };
    return true;
  }

  private dragGizmo(press: Extract<Press, { kind: 'gizmo' }>, x: number, y: number, keys: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {}): void {
    const gizmo = this.gizmo;
    if (!gizmo || !this.tablePlacing) return;
    this.ray(x, y);
    const at = this.adjustPoint();
    if (!at) return;
    const middle = gizmo.object3d.position;
    let next = this.adjustPlacement;
    if (press.part === 'turn') {
      const angle = Math.atan2(at.z - middle.z, at.x - middle.x);
      let delta = ((angle - press.angle) * 180) / Math.PI;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      // The turn follows the pointer round the middle, snapped: a quarter turn by default, 45 degrees with Shift, 5 with Ctrl, free with Alt.
      press.turned += delta;
      press.angle = angle;
      const wanted = snapTurn(press.from.turn + press.turned, turnStep(keys));
      next = turnAbout(press.from, { x: middle.x, y: middle.z }, wrapTurn(wanted - press.from.turn));
    } else {
      const dx = press.part === 'z' ? 0 : at.x - press.last.x;
      const dz = press.part === 'x' ? 0 : at.z - press.last.z;
      next = { ...next, x: next.x + dx, y: next.y + dz };
      middle.x += dx;
      middle.z += dz;
    }
    press.last = at;
    this.adjustPlacement = next;
    // The AR table follows the handles.
    this.drawTable();
    this.wake(true);
  }

  /** The handles keep one size on screen, whatever the zoom. */
  private sizeGizmo(): void {
    const gizmo = this.gizmo;
    if (gizmo) gizmo.object3d.scale.setScalar(this.view.position.distanceTo(gizmo.object3d.position) * 0.06);
    if (this.tableOutlines.children.length > 0) this.sizeTableLabels();
  }

  /** The stack's scenes for the height ruler down the right of the board; fewer than two hide it. */
  /** The height ruler's pills, as last given. */
  private layerMenuItems: ReadonlyArray<{ path: string; name: string; elevation: number; active: boolean }> = [];

  setLayerMenu(items: ReadonlyArray<{ path: string; name: string; elevation: number; active: boolean }> | null): void {
    this.layerMenuItems = items ?? [];
    this.layerRuler ??= new LayerRuler(this.container, (path) => this.host.switchLayer?.(path), (path, event) => this.host.layerMenu?.(path, event));
    this.layerRuler.show(items && items.map((item) => ({ ...item, hidden: !item.active && this.host.layerHidden?.(item.path) === true })), this.quality.layerTick);
  }

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
      element = doc.win.createDiv();
      element.className = 'atlas-tabletop-banner';
      element.setAttribute('role', 'status');
      this.container.appendChild(element);
    }
    element.hidden = false;
    element.dataset.key = key;
    element.replaceChildren();
    const text = doc.win.createSpan();
    text.textContent = banner.text;
    element.appendChild(text);
    if (banner.action) {
      const action = banner.action;
      const button = doc.win.createEl('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', () => action.run());
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
      element = doc.win.createDiv();
      element.className = 'atlas-tabletop-handout';
      this.container.appendChild(element);
    }
    element.hidden = false;
    element.dataset.key = key;
    element.replaceChildren();
    const title = doc.win.createDiv();
    title.className = 'atlas-tabletop-handout__title';
    title.textContent = `Shown to players: ${handout.title}`;
    element.appendChild(title);
    if (handout.url) {
      const image = doc.win.createEl('img');
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
    // In room tracking the session's own frames draw the board, one each frame.
    if (this.disposed || this.frameId !== 0 || this.room) return;
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
    this.lookOnScreen();
    const interval = this.last === 0 ? 0 : (time - this.last) / 1000;
    const dt = Math.min(LONGEST_STEP, interval);
    this.last = time;
    if (this.continuing && !this.room) {
      const ratio = this.governor.sample(interval);
      if (ratio !== null) {
        // Over a camera's picture, never below the screen's own pixels: the picture would blur.
        this.renderer.setPixelRatio(this.seeThrough ? Math.max(1, ratio) : ratio);
        this.fit();
      }
    }
    this.clock += dt;
    this.steer(dt);
    const driven = this.stepDriver();
    for (const surface of this.liquids.values()) surface.tick(time / 1000);
    if (this.seaPlane.object3d.parent) this.seaPlane.tick(time / 1000);
    if (this.painted.object3d.parent) this.painted.tick(time / 1000);
    // The water brush was put away (another tool, Escape): its outline goes with it.
    if (this.brushRing?.visible && !this.waterTool) this.brushRing.visible = false;
    // A cutscene's camera is set whole each frame, not eased, and asks for a frame after every frame.
    const cameraMoving = this.cinematicDriver ? driven : this.camera.update(dt);
    if (this.pendingStack && !this.camera.gliding) this.setStack(this.pendingStack);
    let busy = cameraMoving || this.cinematicDriver !== null;
    // Settled somewhere new: the lights nearest it cast the shadows now.
    const target = this.cinematicDriver ? this.camera.pose.target : this.camera.goal.target;
    if (!cameraMoving && this.map && Math.hypot(target.x - this.castersAt.x, target.z - this.castersAt.z) > this.map.grid.size * CASTER_STEP_SQUARES) {
      this.castersAt = { x: target.x, z: target.z };
      if (this.rig.castShadows(this.quality.lightShadows, this.castersAt)) this.shadowsDirty = true;
    }
    if (this.eye) {
      const { quaternion, turning } = this.eye.turn(dt);
      this.eyeTurn = quaternion;
      if (turning) busy = true;
    }
    this.applyView();
    // The fog brush's ring keeps its width on screen and its place under a still pointer while the camera moves (after the
    // camera is placed, so the frame that settles it draws the ring settled too).
    this.fogTool?.frame();
    this.spellTick();
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
    let doorsMoving = this.walls.step(dt);
    for (const view of this.layerViews.values()) if (view.step(dt, this.clock, context)) doorsMoving = true;
    // Layers put away fade out, then are not drawn at all.
    for (const view of this.parked.values()) {
      if (!view.object3d.visible) continue;
      if (view.step(dt, this.clock, context)) doorsMoving = true;
      if (view.gone) view.object3d.visible = false;
    }
    // A layer easing in or out (or to another look) keeps the frames coming until it is done.
    if ([...this.layerViews.values(), ...this.parked.values()].some((view) => view.object3d.visible && view.fading)) { doorsMoving = true; this.wake(); }
    if (doorsMoving) busy = true;
    if (this.marks.step(this.clock, context.pixel)) busy = true;
    this.syncMeasureHandles(context.pixel);
    if (this.stepReleased()) busy = true;
    if (this.viewers.step(this.clock, dt, context.pixel)) busy = true;
    this.rig.step(this.clock);
    const glide = 1 - Math.exp(-GLIDE * dt);
    if (this.stackedVersion !== this.propsVersion) { this.stackProps(); this.shadowsDirty = true; }
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
        if (entry.gliding) this.arrived(entry);
      }
      // On a solid prop the token stands on its top, easing up or down onto it; at its height (Atlas 0.15) over that.
      const floor = this.standAt(entry);
      const stand = floor + this.heightLift(entry.token);
      if (Math.abs(stand - entry.lift) > 0.05) { entry.lift += (stand - entry.lift) * glide; busy = true; changed = true; } else entry.lift = stand;
      entry.piece.pose(entry.at.x, entry.at.y, context, entry.lift);
      entry.piece.setDrop(entry.lift - floor);
      // A light the token carries goes with it.
      this.rig.place(entry.token.id, entry.at.x, entry.at.y);
      entry.labels.place(entry.piece.figureHeight(), ringDiameter(this.map!.grid, entry.token.size) / 2, entry.piece.top);
      entry.labels.pose(context);
      if (this.audience === 'player' || this.sessionView) entry.playerLabels.pose(context);
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
    if (shadows && !this.room) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowedAt = this.clock;
    }
    this.shadowsDirty = false;
    if (this.group.size > 0) this.placeGroup();
    if (this.active.length > 0) this.placeActive();
    this.sizeGizmo();
    if (this.refreshSight()) this.shadowsDirty = true;
    this.drawMain();
    if (this.clearBlackAfterFrame) {
      this.clearBlackAfterFrame = false;
      this.cinema.setBlack(0);
    }
    this.layoutControls();
    this.drawPlayers(shadows, context);
    if (cameraMoving) this.host.cameraMoved?.();
    this.tellListener();
    this.syncLoopsToScreen();
    this.updateWaterLoops();
    this.continuing = busy || this.held.size > 0 || this.press !== null;
    if (this.continuing) this.wake();
    // Flames flicker on a timer, a few times a second, not on every frame the screen can draw; those frames are
    // rests to the resolution governor.
    else if ((this.rig.animated || [...this.layerViews.values()].some((view) => view.animated) || this.video !== null || this.liquidsMoving || this.seaPlane.object3d.parent !== null || this.painted.moving) && this.flickerTimer === 0) {
      const win = this.frameWin ?? this.container.ownerDocument.defaultView ?? window;
      // Moving water is drawn as often as a playing map, so it flows smoothly.
      this.flickerTimer = win.setTimeout(() => { this.flickerTimer = 0; this.wake(); }, this.video !== null || this.liquidsMoving || this.seaPlane.object3d.parent !== null || this.painted.moving ? VIDEO_FRAME_MS : FLICKER_MS);
    }
  }

  private steer(dt: number): void {
    if (this.held.size === 0 || !this.allows('camera')) return;
    const free = this.cinematicDriver?.free;
    if (free) {
      // The authoring camera flies: W and S along the view, A and D across it, Q down and E up.
      const step = this.span * FREE_SPEED * dt;
      const axis = (plus: string[], minus: string[]): number => (plus.some((key) => this.held.has(key)) ? 1 : 0) - (minus.some((key) => this.held.has(key)) ? 1 : 0);
      free.fly(axis(['d', 'arrowright'], ['a', 'arrowleft']) * step, axis(['e'], ['q']) * step, axis(['w', 'arrowup'], ['s', 'arrowdown']) * step);
      return;
    }
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
    // A cutscene's camera wins over the orbit camera, the eyes, augmented reality and a room-tracking session alike.
    const aim = this.cinematicDriver ? this.drivenAim : null;
    // Depth of field focuses where the camera aims (the orbit's target, the cutscene's aim); other cameras focus on what the middle of the view rests on.
    this.focusDistance = null;
    if (aim) {
      const eye = this.camera.position();
      this.fitNear(this.camera.pose.distance);
      this.focusDistance = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
      this.view.position.set(eye.x, eye.y, eye.z);
      this.view.lookAt(aim.x, aim.y, aim.z);
      // Augmented reality had its own projection; the driven camera has the board's.
      if (this.augmented) this.view.updateProjectionMatrix();
      this.view.updateMatrixWorld();
      this.aimCutaway(eye, this.camera.pose.target);
      return;
    }
    if (this.room) {
      // The session places the drawn camera, under the rig.
      this.room.rig.updateMatrixWorld(true);
      const eye = this.view.getWorldPosition(new THREE.Vector3());
      this.aimCutaway(eye, eye);
      this.cutaway.strength.value = 0;
      return;
    }
    const ar = this.augmented;
    if (ar && this.map) {
      const cell = this.map.grid.size;
      // A table the GM placed: its origin is the map's top left (at the table's height); else the anchor.
      const anchor = ar.origin ? { ...this.augmentedAnchor(null), x: ar.origin.x, z: ar.origin.y } : this.augmentedAnchor(ar.anchor);
      const camera = augmentedCamera(ar, cell, anchor);
      this.view.position.copy(camera.position);
      this.view.quaternion.copy(camera.quaternion);
      this.view.updateMatrixWorld();
      // A centimetre off the lens to the far side of the room, in board units.
      const near = Math.max(0.01, (cell / ar.squareMm) * 10);
      this.view.projectionMatrix.copy(augmentedProjection(ar.frustum, near, Math.max(this.span * 8, near * 1000)));
      this.view.projectionMatrixInverse.copy(this.view.projectionMatrix).invert();
      this.aimCutaway(camera.position, { x: anchor.x, y: anchor.y, z: anchor.z });
      this.cutaway.strength.value = 0;
      return;
    }
    if (this.eye && this.eyeTurn && this.eyeAt()) {
      const at = this.eyeAt()!;
      this.view.position.set(at.x, at.y, at.z);
      this.view.quaternion.copy(this.eyeTurn);
      this.view.updateMatrixWorld();
      // No see-through cut from inside the room: the walls around stay whole.
      const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(this.eyeTurn).multiplyScalar(this.map?.grid.size ?? 50).add(this.view.position);
      this.aimCutaway(at, ahead);
      this.cutaway.strength.value = 0;
      return;
    }
    const eye = this.camera.position();
    const target = this.camera.pose.target;
    this.fitNear(this.camera.pose.distance);
    this.focusDistance = this.camera.pose.distance;
    this.view.position.set(eye.x, eye.y, eye.z);
    this.view.lookAt(target.x, target.y, target.z);
    this.view.updateMatrixWorld();
    this.aimCutaway(eye, target);
  }

  /**
   * The near plane follows the orbit camera out: the depth a frame tells apart grows with the square of the distance over
   * the near plane, so a near plane kept close lets far walls flicker through floors a hair above them (walls reaching
   * the level above stop a millimetre short of its floor). Never nearer than the map's own near plane.
   */
  private fitNear(distance: number): void {
    const near = Math.max(this.baseNear, distance * NEAR_SHARE);
    if (Math.abs(near - this.view.near) <= this.view.near * 0.01) return;
    this.view.near = near;
    this.view.updateProjectionMatrix();
  }

  /** Aims the see-through cut from a camera at the point it looks at, for the drawing about to be made. */
  private aimCutaway(eye: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): void {
    this.cutaway.eye.value.set(eye.x, eye.y, eye.z);
    this.cutaway.pivot.value.set(target.x, target.y, target.z);
    this.cutaway.radius.value = (this.map?.grid.size ?? 50) * this.quality.seeThroughSize;
    this.cutaway.strength.value = this.quality.seeThrough ? 1 : 0;
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

  /** How many map pixels one screen pixel is at `at` on the ground: the camera's distance and its field of view. */
  private unitsPerPixel(at: { x: number; y: number }): number {
    const distance = this.view.position.distanceTo(new THREE.Vector3(at.x, 0, at.y));
    return (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.view.fov) / 2)) / Math.max(1, this.canvas.clientHeight);
  }

  /** The map as the board draws it, in map pixels, for the fog actions on the whole map (null while its size is not known). */
  private fogMapRect(): { x: number; y: number; width: number; height: number } | null {
    const size = this.mapSizeKnown ? this.mapSize : null;
    return size ? { x: 0, y: 0, width: size.width, height: size.height } : null;
  }

  /** Takes up the GM's fog tool: Edit mode, the other tools put away, the tool on as `mode` (Atlas's button and key open it as Fog). */
  private startFog(mode: 'fog' | 'eraser' = 'fog'): void {
    const tool = this.fogTool;
    if (!tool || this.audience !== 'gm') return;
    if (this.host.boardMode?.() !== 'edit') this.setMode('edit');
    if (this.waterTool) { this.waterTool = null; this.showBrush(); }
    this.shapeEditor?.setActive(false);
    this.stopPainting();
    if (this.laserOn) this.setLaser(false);
    if (this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); }
    tool.setOn(true, mode);
  }

  /** Atlas's fog key: opens the fog tool, and with it open turns it between Fog and Eraser. False where the board has none. */
  toggleFogTool(): boolean {
    const tool = this.fogTool;
    if (!tool || this.audience !== 'gm') return false;
    if (tool.on) { tool.toggleMode(); return true; }
    // Through the toolbar's own way in: the other panels close and Edit mode is taken, as when the button is pressed.
    return this.toolbar.goTo('fog');
  }

  /** Atlas's smaller and larger brush keys, while the fog tool is on (`held`: a repeat of the key): true when it sized the brush. */
  stepFogBrush(direction: 1 | -1, held: boolean): boolean {
    const tool = this.fogTool;
    if (!tool?.on) return false;
    tool.stepBrush(direction, held);
    return true;
  }

  /**
   * A key of the fog shape under way (Atlas's `FogStrokeKeys`): Enter closes a polygon, Backspace or the map's undo (`undo`) takes its
   * last corner back; Escape drops the shape. True where the shape took it, which the map's shortcuts then never hear.
   */
  fogKey(event: Pick<KeyboardEvent, 'key' | 'repeat'>, undo = false): boolean {
    const tool = this.fogTool;
    if (this.audience !== 'gm' || !tool?.on || !tool.drawing) return false;
    if (event.key === 'Escape') { tool.cancel(); return true; }
    return tool.key(event.key, event.repeat === true, undo);
  }

  /**
   * Atlas's session view (its GM view switch off): the GM's own board shows the map as the players see it, hidden tokens gone and
   * the fog opaque. The switch is Atlas's, in the store of the Atlas view holding the map, so Atlas and the board agree; where
   * there is none it is the board's own. Never on a player's board.
   */
  get sessionView(): boolean {
    // Cinematic mode has no such switch: a cutscene is edited in the GM's view.
    if (this.audience !== 'gm' || this.host.boardMode?.() === 'cinematic') return false;
    // The peek (Atlas's lighting peek) shows the same picture, for as long as it is held.
    return this.peeking || this.sessionSwitch;
  }

  /** The GM view switch alone: off is session view. The peek leaves it as it is. */
  private get sessionSwitch(): boolean {
    if (this.audience !== 'gm' || this.host.boardMode?.() === 'cinematic') return false;
    const shared = this.host.gmView?.() ?? null;
    return shared === null ? this.sessionLocal : !shared;
  }

  private sessionLocal = false;
  /** Atlas's lighting peek is held: the board shows the players' look though the GM view switch says the GM's. */
  private peeking = false;
  /** The key that holds the peek (lower case), so its release is known; null for the toolbar's button. */
  private peekKey: string | null = null;

  /**
   * Atlas's lighting peek (`SessionLighting.setPeeking`): while held the GM's board shows what the players see, as session view does, and the
   * GM view switch stays where it was. Never on a player's board or in Cinematic mode, which have no GM view to look away from. True when it
   * took the press.
   */
  peek(on: boolean, key: string | null = null): boolean {
    if (on && (this.audience !== 'gm' || this.host.boardMode?.() === 'cinematic')) return false;
    this.peekKey = on ? key : null;
    if (this.peeking === on) return true;
    this.peeking = on;
    // The fog shape under way is kept (Atlas hides its marks for the peek and drops nothing); the board is drawn anew.
    this.sightApplied = true;
    this.toolbar.refresh();
    this.wake();
    return true;
  }

  /**
   * Atlas's Measure key (`measureWhileHeld`), pressed: a tap, acted on when the key goes up, chooses the tool (in Play mode, switching to
   * it) or, with the tool chosen, steps to its next mode. Held while the map is pressed it is a quick ruler (the measure tool, a plain
   * ruler, nothing kept) and the tool in use comes back once key and button are up. Where the board cannot take a quick ruler (Edit mode,
   * the fog tool, a token's eyes) a press is no ruler and the key is a tap. True: the key is the board's.
   */
  measureKey(event: KeyboardEvent): boolean {
    measureWhileHeld(event, {
      onMap: (target) => this.canHoldRuler(target),
      tap: () => this.measureTap(),
      press: () => this.holdRuler(),
      release: () => this.releaseRuler(),
    });
    return true;
  }

  private measureTap(): void {
    const actions = this.toolbarActions();
    if (!actions.measureOn?.()) { this.goToToolbar('measure'); return; }
    const options = actions.measureOptions?.();
    if (!options) return;
    const ranges = actions.rangesUnavailable !== undefined && actions.rangesUnavailable() === null;
    const next = nextBoardMeasureMode(options.mode, ranges);
    if (isMeasureShape(next)) actions.selectMeasure?.(next);
    else actions.setMeasureOptions?.({ mode: next });
    this.refreshToolbar();
  }

  /** The tool that waits while Atlas's measure key is held for a quick ruler (`heldRulerFrom`), with the measure shape it had. */
  private heldRuler: { tool: PlayerTool; shape: MeasureShape } | null = null;

  /**
   * Whether a press on `target` may be a quick ruler, as Atlas's held measure key makes it: the GM's board over its canvas, whatever tool
   * (fog, water, props, shapes, laser) or mode (Play, Edit) is in use, which wait for the press. Not through a token's eyes (the view only looks
   * about), in Cinematic mode (no tools to measure with) or on a player's board (Connect's own tools). Elsewhere the key is a tap.
   */
  canHoldRuler(target: EventTarget | null): boolean {
    if (this.audience !== 'gm' || target !== this.canvas || this.eye) return false;
    return this.host.boardMode?.() !== 'cinematic';
  }

  /**
   * The measure key held with a press on the map (Atlas's `holdRuler`): the measure tool takes the press as a ruler that is never
   * kept, and the tool in use waits, still the one the bar shows. Pressed again while held, the first tool still waits.
   */
  holdRuler(): void {
    this.heldRuler ??= { tool: this.tools.tool, shape: this.tools.shape };
    this.tools.tool = 'measure';
    this.tools.shape = 'ruler';
  }

  /** Key and button are let go (Atlas's `releaseRuler`): the tool that waited comes back, unless another was picked meanwhile. */
  releaseRuler(): void {
    const from = this.heldRuler;
    if (from === null) return;
    this.heldRuler = null;
    if (this.tools.tool !== 'measure') return;
    this.tools.cancel();
    this.tools.tool = from.tool;
    this.tools.shape = from.shape;
    this.dissolveReleased();
    this.showToolOverlay();
  }

  /** A key was let go: ends the peek that key holds. */
  private peekKeyUp(key: string): void {
    if (this.peeking && this.peekKey !== null && this.peekKey === key.toLowerCase()) this.peek(false);
  }

  /** Throws the GM view switch: on is GM view, off Atlas's session view. */
  throwGmView(on: boolean): void {
    if (this.audience !== 'gm') return;
    // Written to Atlas's store, which tells the board back (`gmViewChanged`); the board's own where Atlas has none.
    if (this.host.setGmView?.(on) !== true) this.sessionLocal = !on;
    this.gmViewChanged();
  }

  /** Atlas's GM key: turns between GM view and session view. False where the board has no such switch (a player's board, Cinematic mode). */
  toggleGmView(): boolean {
    if (this.audience !== 'gm' || this.host.boardMode?.() === 'cinematic') return false;
    this.throwGmView(this.sessionSwitch);
    return true;
  }

  /** The switch was thrown (here, or in Atlas): the board is drawn anew, and a fog polygon begun in the other view is dropped, as Atlas drops it. */
  gmViewChanged(): void {
    if (this.sessionView && this.fogTool?.drawing) this.fogTool.cancel();
    this.sightApplied = true;
    this.toolbar.refresh();
    this.wake();
  }

  /** Whether the GM's fog tool is on. */
  get fogToolOn(): boolean {
    return this.fogTool?.on === true;
  }

  /** The fog shapes finished by the tool, written to Atlas's store by the host; the stroke's preview goes if they are refused. */
  private commitFog(operations: FogOperationInput[]): void {
    const kept = this.host.fog?.add(operations);
    if (kept instanceof Promise) void kept.then((ok) => { if (ok === false) this.fogTool?.failed(); }, () => this.fogTool?.failed());
  }

  /**
   * The fog menu at a right-click released in place (Atlas's `showFogMenu`): while the fog tool is on and no shape is under way, or the Move tool (Atlas's Select and Move) is,
   * on fog it offers Reveal and Delete, on revealed open ground Hide and Delete, and the body or ground they act on is outlined
   * while it is open. False where the fog has no menu there (the click is then the board's own).
   */
  private openFogMenu(event: MouseEvent): boolean {
    const tool = this.fogTool;
    const host = this.host.fog;
    if (!host || !this.host.fogMenu || this.audience !== 'gm' || !this.map || this.sessionView) return false;
    // Atlas's `secondaryTargetAt`: the menu is the GM's, with the fog tool on, and with the tools that take tokens (Select, Move: the board's
    // Move with nothing else held or painted); the board's Cinematic mode, a cutscene's, has none.
    const mode = this.host.boardMode?.() ?? null;
    if (tool?.on) { if (!this.editing || tool.drawing) return false; }
    else if (!tool || this.tools.tool !== 'move' || this.painting || this.waterTool || this.placing || mode === 'cinematic') return false;
    const point = this.boardPoint(event.clientX, event.clientY);
    const hit = point ? fogMenuAt(this.map.fog, point) : null;
    if (!point || !hit) return false;
    const now = (): ReturnType<typeof fogMenuAt> => (this.map ? fogMenuAt(this.map.fog, point) : null);
    const quiet = (done: Promise<unknown> | void): void => { if (done instanceof Promise) void done.catch(() => undefined); };
    const entries = fogMenuEntries(hit, {
      offers: () => host.offers(),
      now,
      reveal: (outlines) => quiet(host.reveal(outlines)),
      erase: (body) => quiet(host.add([{ type: 'lasso', points: body.map(({ x, y }) => ({ x, y })), isErasing: true }])),
      hide: (id) => quiet(host.hide(id)),
      forget: (id) => quiet(host.forget(id)),
    });
    if (entries.length === 0) return false;
    tool.cancel();
    tool.showTarget(hit.outlines);
    this.host.fogMenu(entries, event, () => tool.showTarget(null));
    return true;
  }

  /** Cover all: hides the whole map; Atlas's own notice where there is none to hide. */
  private coverFog(): void {
    const host = this.host.fog;
    if (!host) return;
    const done = (ok: boolean): void => { if (!ok) host.notice(atlasText('fog.noMap')); };
    const covered = host.cover(this.fogMapRect());
    if (covered instanceof Promise) void covered.then(done, () => undefined); else done(covered);
  }

  /** Hide all rooms: with Atlas's notice of how many it hid. */
  private hideFogRooms(): void {
    const host = this.host.fog;
    if (!host) return;
    const done = ({ rooms, hidden }: { rooms: number; hidden: number }): void => {
      if (hidden > 0) host.notice(atlasText('fog.roomsHidden', { count: hidden }));
      else host.notice(rooms > 0 ? atlasText('fog.roomsAreHidden') : atlasText('fog.noRooms'));
    };
    const result = host.hideRooms(this.fogMapRect());
    if (result instanceof Promise) void result.then(done, () => undefined); else done(result);
  }

  /** The GM's Atlas fog opacity changed (or is read again): the fog in the GM's view takes it. */
  refreshFogOpacity(): void {
    this.gmFogOpacity = this.host.fog?.gmOpacity?.() ?? null;
    this.fog.setGmStrength(this.gmFogOpacity);
    this.wake(true);
  }

  /** What the fog tool's bars ask of the board. */
  private fogBarActions(): FogBarActions {
    const tool = this.fogTool!;
    const host = this.host.fog!;
    return {
      state: () => ({ on: tool.on, mode: tool.mode, shape: tool.shape, brushSize: tool.brushSize }),
      start: (mode) => this.startFog(mode),
      stop: () => tool.setOn(false),
      setMode: (mode) => tool.setMode(mode),
      setShape: (shape) => tool.setShape(shape),
      setBrushSize: (size) => tool.setBrushSize(size),
      cellSize: () => { const size = this.map?.grid.size ?? 0; return Number.isFinite(size) && size > 0 ? size : 0; },
      hasWalls: () => hasRoomWalls(fogWalls(this.map?.walls ?? NO_WALLS) as never),
      levelled: () => (this.map?.levels?.length ?? 0) > 1,
      anyFog: () => (this.map?.fog.length ?? 0) > 0,
      offers: () => host.offers(),
      cover: () => this.coverFog(),
      clear: () => { const kept = host.clear(); if (kept instanceof Promise) void kept.catch(() => undefined); },
      hideRooms: () => this.hideFogRooms(),
      gmOpacity: () => host.gmOpacity?.() ?? null,
      setGmOpacity: (opacity) => { host.setGmOpacity?.(opacity); this.refreshFogOpacity(); },
      switchOn: (id) => host.switchOn?.(id) ?? this.fogSwitches[id],
      setSwitch: (id, on) => { if (host.setSwitch?.(id, on) !== true) this.fogSwitches[id] = on; },
      brushKeys: () => host.brushKeys?.() ?? ', .',
      hotkey: () => this.host.fogHotkey?.() ?? null,
    };
  }

  /** The point of the board under the pointer, in map pixels. */
  boardPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    this.ray(clientX, clientY);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    return hit ? { x: hit.x, y: hit.z } : null;
  }

  /** The board point under the pointer, on the surface of a raised shape (a roof, a hill) when one is there, else on the floor. */
  private surfacePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const meshes = this.shapesView.pickables;
    if (meshes.length > 0) {
      this.ray(clientX, clientY);
      for (const mesh of meshes) mesh.updateWorldMatrix(true, false);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      if (hit) return { x: hit.point.x, y: hit.point.z };
    }
    return this.boardPoint(clientX, clientY);
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

  /**
   * A token the player may move under the pointer, for a press on a player's board: only those tokens are tried, so a
   * name plate or another token in front (drawn or not: rays hit hidden objects too) never takes the press. A press
   * that misses the figure still grabs one: by its figure widened by half (its whole height), else by its ground.
   */
  private movableTokenAt(clientX: number, clientY: number): string | null {
    const movable = [...this.tokens.values()].filter((entry) => entry.piece.object3d.visible && this.host.canMove?.(entry.token.id) === true);
    if (movable.length === 0) return null;
    const owners = new Map<THREE.Object3D, string>();
    for (const entry of movable) {
      owners.set(entry.piece.hitTarget, entry.token.id);
      if (entry.playerLabels.object3d.visible) for (const sprite of entry.playerLabels.sprites) owners.set(sprite, entry.token.id);
    }
    const hit = this.hit(clientX, clientY, [...owners.keys()]);
    if (hit) return owners.get(hit) ?? null;
    const targets = movable.map((entry) => entry.piece.hitTarget);
    for (const target of targets) { target.scale.x *= GRAB_SLACK; target.scale.z *= GRAB_SLACK; }
    const near = this.hit(clientX, clientY, targets);
    for (const target of targets) { target.scale.x /= GRAB_SLACK; target.scale.z /= GRAB_SLACK; target.updateWorldMatrix(true, false); }
    if (near) return (near.userData.tokenId as string | undefined) ?? null;
    const at = this.boardPoint(clientX, clientY);
    if (!at || !this.map) return null;
    const grid = this.map.grid;
    const ground = nearestFootprint(at, movable.map((entry) => ({ id: entry.token.id, x: entry.at.x, y: entry.at.y, radius: ringDiameter(grid, entry.token.size) / 2 })), GRAB_SLACK);
    return ground?.id ?? null;
  }

  private pinAt(clientX: number, clientY: number): string | null {
    // Only a pin drawn can be clicked: one hidden (beyond sight on a player's board, or the GM's own in session view) opens nothing.
    const shown = this.audience === 'player' || this.sessionView ? this.pins.filter((pin) => pin.object3d.visible) : this.pins;
    const hit = this.hit(clientX, clientY, shown.map((pin) => pin.hitTarget));
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
      edge: EDGE_SHARE[this.quality.edges],
      cuts: this.quality.displaceCuts,
    });
  }

  /** A wall's height as it stands now, in squares: its own, else the fog's (half for a low wall). */
  /** A window's opening as shown: while its sill or lintel is dragged, where the drag has it (kept inside the wall). */
  private shownWindow(id: string): WindowSpan | null {
    const saved = this.host.windowOf?.(id) ?? null;
    const drag = this.heightDrag;
    if (!drag || drag.id !== id || (drag.target !== 'sill' && drag.target !== 'lintel')) return saved;
    const height = this.wallSquares(id);
    const span = windowSpan(height, saved);
    if (drag.target === 'sill') return windowSpan(height, { bottom: Math.min(drag.value, span.top - 0.25), top: span.top });
    return windowSpan(height, { bottom: span.bottom, top: Math.max(drag.value, span.bottom + 0.25) });
  }

  /** Where one of a wall's handles stands, in grid squares from the floor. */
  private partSquares(id: string, part: WallPart): number {
    if (part === 'wall') return this.heightDrag?.target === 'wall' && this.heightDrag.id === id ? this.heightDrag.value : this.wallSquares(id);
    const span = windowSpan(this.wallSquares(id), this.shownWindow(id));
    return part === 'sill' ? span.bottom : span.top;
  }

  /** A wall's width as it stands now, in squares: its own (or as dragged), else the map's wall thickness. */
  private wallWidthSquares(id: string): number {
    if (this.heightDrag?.target === 'width' && this.heightDrag.id === id) return this.heightDrag.value;
    return this.host.wallWidth?.(id) ?? this.host.wallThickness();
  }

  /**
   * With Ctrl held, the height handles of the wall under the pointer; with Alt, its width handle (the GM's, in Edit, no
   * brush or paint in hand); else none.
   */
  private ctrlHandles(kind: HandleKind | null): void {
    const at = this.pointerAt;
    if (kind && at && this.audience === 'gm' && this.editing && !this.painting && !this.waterTool && this.fogTool?.on !== true && !this.placing) {
      const near = this.handles?.kind === kind ? this.handleAt(at.x, at.y) : null;
      // Over a prop (and no wall handle nearer): its scale dot.
      const prop = !near && kind === 'height' && this.host.scaleProp ? this.propAt(at.x, at.y) : null;
      this.showPropHandle(prop);
      const raised = !near && kind === 'width' && this.host.liftProp && !this.tokenAt(at.x, at.y) ? this.propAt(at.x, at.y) : null;
      const loose = raised;
      this.showPropLine(loose);
      if (prop || loose) {
        this.hideHandles();
        this.canvas.style.cursor = 'ns-resize';
        return;
      }
      const wall = near ? near.wall : this.wallAt(at.x, at.y);
      if (wall) this.showHandles(wall, near?.part ?? null, kind);
      else this.hideHandles();
      this.canvas.style.cursor = near ? (kind === 'width' ? 'ew-resize' : 'ns-resize') : this.laserOn ? 'none' : '';
    } else if (this.handles || this.propHandle || this.propLine) {
      this.hideHandles();
      this.showPropHandle(null);
      this.showPropLine(null);
      this.canvas.style.cursor = this.laserOn ? 'none' : '';
    }
  }

  /** The height line through a prop that is not solid, from the floor to over its top (white while dragged); null takes it away. */
  private showPropLine(id: string | null, lit = false): void {
    const piece = id ? this.props.get(id) : null;
    if (!piece || !this.map) {
      if (this.propLine) {
        this.propLine.geometry.dispose();
        (this.propLine.material as THREE.Material).dispose();
        this.propLine.removeFromParent();
        this.propLine = null;
        this.wake();
      }
      return;
    }
    const color = accent(this.container);
    if (!this.propLine) {
      this.propLine = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 }));
      this.propLine.renderOrder = 22;
      this.propLine.raycast = () => {};
      this.scene.add(this.propLine);
    }
    piece.object3d.updateWorldMatrix(true, true);
    const body = piece.body;
    const box = body ? new THREE.Box3().setFromObject(body) : null;
    const top = (box && Number.isFinite(box.max.y) ? box.max.y : piece.object3d.position.y + this.map.grid.size * 0.5) + this.map.grid.size * 0.4;
    const width = HANDLE_PIXELS * 0.35 * this.squaresPerPixel() * this.map.grid.size * (lit ? 1.4 : 1);
    this.propLine.scale.set(width, Math.max(1, top), width);
    this.propLine.position.set(piece.object3d.position.x, top / 2, piece.object3d.position.z);
    (this.propLine.material as THREE.MeshBasicMaterial).color.set(lit ? '#ffffff' : color);
    this.wake();
  }

  /** The scale dot on top of a prop (white while it is dragged); null takes it away. */
  private showPropHandle(id: string | null, lit = false): void {
    const piece = id ? this.props.get(id) : null;
    if (!piece || !this.map) {
      if (this.propHandle) {
        (this.propHandle.material as THREE.Material).dispose();
        this.propHandle.removeFromParent();
        this.propHandle = null;
        this.wake();
      }
      return;
    }
    const color = accent(this.container);
    if (!this.propHandle) {
      this.propHandle = new THREE.Mesh(HANDLE_GEOMETRY, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 }));
      this.propHandle.renderOrder = 22;
      this.propHandle.raycast = () => {};
      this.scene.add(this.propHandle);
    }
    piece.object3d.updateWorldMatrix(true, true);
    const body = piece.body;
    const top = body ? new THREE.Box3().setFromObject(body).max.y : this.map.grid.size * 0.5;
    this.propHandle.position.set(piece.object3d.position.x, Number.isFinite(top) ? top : 0, piece.object3d.position.z);
    this.propHandle.scale.setScalar(HANDLE_PIXELS * this.squaresPerPixel() * this.map.grid.size * (lit ? 1.4 : 1));
    (this.propHandle.material as THREE.MeshBasicMaterial).color.set(lit ? '#ffffff' : color);
    this.wake();
  }

  /** Ctrl's handles on a wall: a dot on its top's middle, and on a window two more, at its opening's bottom and top. */
  private showHandles(id: string, hot: WallPart | null = null, kind: HandleKind = this.handles?.kind ?? 'height'): void {
    const wall = this.map?.walls.find((candidate) => candidate.id === id);
    if (!wall || !this.map) { this.hideHandles(); return; }
    if (!this.handles || this.handles.wall !== id || this.handles.kind !== kind) {
      this.hideHandles();
      const group = new THREE.Group();
      group.renderOrder = 22;
      this.scene.add(group);
      this.handles = { wall: id, kind, group, spots: [] };
    }
    const { group } = this.handles;
    const tile = this.map.grid.size;
    const frame = segmentFrame(wall.p1, wall.p2);
    const parts: WallPart[] = kind === 'width' ? ['width'] : isWindow(wall) ? ['sill', 'lintel', 'wall'] : ['wall'];
    // As big on the screen wherever the camera is.
    const radius = HANDLE_PIXELS * this.squaresPerPixel() * tile;
    const color = accent(this.container);
    while (group.children.length < parts.length) {
      const dot = new THREE.Mesh(HANDLE_GEOMETRY, new THREE.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true }));
      dot.renderOrder = 22;
      dot.raycast = () => {};
      group.add(dot);
    }
    while (group.children.length > parts.length) {
      const extra = group.children[group.children.length - 1] as THREE.Mesh;
      (extra.material as THREE.Material).dispose();
      group.remove(extra);
    }
    this.handles.spots = parts.map((part, index) => {
      const at = part === 'width' ? this.widthSpot(wall, frame) : new THREE.Vector3(frame.cx, this.partSquares(id, part) * tile, frame.cy);
      const dot = group.children[index] as THREE.Mesh;
      dot.position.copy(at);
      const lit = part === hot || (this.press?.kind === 'height' && this.press.target === part);
      dot.scale.setScalar(radius * (lit ? 1.4 : 1));
      const material = dot.material as THREE.MeshBasicMaterial;
      material.color.set(lit ? '#ffffff' : color);
      material.opacity = 0.95;
      return { part, at };
    });
    this.wake();
  }

  /** The width handle's place: on the face of the wall turned to the camera, half way up it, at its middle. */
  private widthSpot(wall: { id: string }, frame: ReturnType<typeof segmentFrame>): THREE.Vector3 {
    const tile = this.map?.grid.size ?? 70;
    const nx = -Math.sin(frame.heading);
    const nz = Math.cos(frame.heading);
    this.applyView();
    const side = (this.view.position.x - frame.cx) * nx + (this.view.position.z - frame.cy) * nz >= 0 ? 1 : -1;
    const half = (this.wallWidthSquares(wall.id) * tile) / 2;
    return new THREE.Vector3(frame.cx + nx * half * side, (this.wallSquares(wall.id) * tile) / 2, frame.cy + nz * half * side);
  }

  private hideHandles(): void {
    if (!this.handles) return;
    for (const dot of this.handles.group.children) ((dot as THREE.Mesh).material as THREE.Material).dispose();
    this.handles.group.removeFromParent();
    this.handles = null;
    this.wake();
  }

  /** The handle shown nearest a point of the screen, within reach of it. */
  private handleAt(clientX: number, clientY: number): { wall: string; part: WallPart } | null {
    if (!this.handles) return null;
    this.applyView();
    const rect = this.canvas.getBoundingClientRect();
    let best: { wall: string; part: WallPart } | null = null;
    let bestDistance = HANDLE_REACH;
    for (const spot of this.handles.spots) {
      const on = spot.at.clone().project(this.view);
      if (on.z > 1) continue;
      const distance = Math.hypot(rect.left + ((on.x + 1) / 2) * rect.width - clientX, rect.top + ((1 - on.y) / 2) * rect.height - clientY);
      if (distance <= bestDistance) { bestDistance = distance; best = { wall: this.handles.wall, part: spot.part }; }
    }
    return best;
  }

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
    const lighting = lightingFor(this.quality.painted, this.quality.sky);
    this.paintDaylight();
    this.hemisphere.intensity = lighting.sky * ambient;
    this.sun.intensity = lighting.sun * ambient;
    // Below Atlas's lit threshold the scene is dark: the sun casts no shadow there.
    const sunCasts = ambient >= LIT_THRESHOLD;
    if (this.sun.castShadow !== sunCasts) { this.sun.castShadow = sunCasts; this.shadowsDirty = true; }
    const measurement = this.host.measurement();
    this.rig.update(this.ruleLights.length > 0 ? [...map.lights, ...this.ruleLights] : map.lights, {
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

  /** A material dragged over walls, shown on them until it is dropped or leaves (null: none). */
  private paintPreview: { ids: string[]; material: string } | null = null;
  private readonly impacts = new Impacts();
  /** The tokens dropped here in the last two seconds, and the scene and doors as the last sync left them (for what other boards change). */
  private readonly drops = new RecentDrops(() => this.now());
  private syncedScene: string | null = null;
  private doorStates: ReadonlyMap<string, boolean> = new Map();

  private previewPaint(preview: { ids: string[]; material: string } | null): void {
    const key = (value: typeof preview): string => (value ? `${value.material}|${value.ids.join(',')}` : '');
    if (key(preview) === key(this.paintPreview)) return;
    this.paintPreview = preview;
    this.updateWalls();
    this.wake(true);
  }

  /** A mini landing where it was dropped: a ring over the floor and a puff of dust. */
  private landImpact(tokenId: string, at: { x: number; y: number }, delayMs = 0): void {
    const entry = this.tokens.get(tokenId);
    const cell = this.map?.grid.size ?? 50;
    if (!this.impacts.object3d.parent) this.scene.add(this.impacts.object3d);
    this.impacts.land({ x: at.x, y: this.standAt({ at }), z: at.y }, cell * Math.max(0.5, entry?.token.size ?? 1) * 0.55);
    this.putDownSound(at, delayMs);
    this.wake(true);
  }

  /** The minis a drag has just lifted (one, or the group with it), each heard picked up from where it stood, staggered. */
  private pickUpSound(press: { id: string; members?: ReadonlyMap<string, unknown> }): void {
    const ids = [...new Set([press.id, ...(press.members?.keys() ?? [])])].filter((id) => this.tokens.has(id));
    const delays = staggerOffsets(ids.length);
    ids.forEach((id, index) => {
      const entry = this.tokens.get(id)!;
      entry.gliding = false;
      this.sound('mini.pickup', { at: { x: entry.at.x, y: this.standAt({ at: entry.at }), z: entry.at.y }, delayMs: delays[index] });
    });
  }

  /** The sound of a mini set down at `at`. */
  private putDownSound(at: { x: number; y: number }, delayMs = 0): void {
    this.sound('mini.putdown', { at: { x: at.x, y: this.standAt({ at }), z: at.y }, delayMs });
  }

  /** Remembers tokens this board just dropped, so the file echoing the drop back is not heard as someone else's move. */
  private dropped(ids: Iterable<string>): void {
    this.drops.mark(ids);
  }

  /**
   * Fog the GM placed or revealed (one chime however many operations came), a condition put on a token (staggered when
   * several came together) and a turn passing, since the last sync of this scene. Scene loads and switches are silent.
   */
  private hearMapChanges(map: BoardMap, conditions: CollectionRules['conditions'], scene: string, sameScene: boolean): void {
    const fight = map.initiative ?? null;
    const current = fight ? currentTokenIds(fight) : [];
    const turnKey = fight ? turnAnnouncement(fight)?.key ?? null : null;
    const changes = this.changes.next({
      id: scene,
      fogIds: map.fog.map((operation) => operation.id),
      tokens: map.tokens.filter((token) => !token.offMap && !token.offLevel).map((token) => ({ id: token.id, conditions: token.conditions.map((id) => conditions.get(id)?.name ?? id) })),
      turnKey,
      turnTokens: current,
    });
    if (changes.fogAdded) this.sound('fog.chime');
    const heard = changes.conditionsAdded.flatMap((added) => {
      const entry = this.tokens.get(added.tokenId);
      return entry && this.heardToken(entry.token, entry.at) ? [{ entry, name: added.name }] : [];
    });
    const delays = staggerOffsets(heard.length);
    heard.forEach(({ entry, name }, index) => this.sound(conditionSound(name), { at: { x: entry.at.x, y: this.standAt(entry), z: entry.at.y }, delayMs: delays[index] }));
    if (!sameScene) { this.hornKey = turnKey; this.hornArmed = false; }
    else if (changes.turnChanged && turnKey !== this.hornKey) {
      this.hornKey = turnKey;
      this.horn(changes.turnChanged.tokens);
    }
  }

  /** What the last map or tracker update said the turn was, so a turn passing is heard once even when two things report it. */
  private hornKey: string | null = null;
  /** Whether the host's tracker has told its turn since this scene opened: the first telling only seeds `hornKey`, it never sounds. */
  private hornArmed = false;
  private readonly changes = new BoardChanges();

  /** The tracker the host holds moved on to `key` (the GM's board, which follows Atlas's live tracker ahead of the file): a new turn blows the horn once. */
  hearTurn(key: string | null, tokens: readonly string[]): void {
    if (this.hornArmed && key !== null && this.hornKey !== null && key !== this.hornKey) this.horn(tokens);
    this.hornKey = key;
    this.hornArmed = true;
  }

  /** The turn horn: full for a turn this board's player owns, for a monster's turn on the GM's board, or while the player window shows; quiet otherwise. */
  private horn(tokens: readonly string[]): void {
    const mine = tokens.some((id) => this.host.controls?.(id) === true);
    const monster = this.audience === 'gm' && !tokens.some((id) => this.host.controlledByPlayers?.(id) === true);
    const table = this.audience === 'gm' && this.player !== null;
    this.sound('turn.horn', { gain: mine || monster || table ? 1 : 0.35 });
  }

  /** Whether this board's viewer sees the token at `at`: the GM everything, a player what the fog, the GM and their sight leave. */
  private heardToken(token: BoardToken, at: { x: number; y: number }): boolean {
    if (this.audience === 'gm') return true;
    return this.eye?.tokenId !== token.id && playerSees(token, at, this.fog.areas) && !this.beyondSight('player', `t:${token.id}`);
  }

  /**
   * Tokens moved by someone else since the last sync of this scene: each is picked up now (staggered, for a group) and
   * flagged to be put down when its slide ends. The ones dropped here a moment ago, and the one under the pointer, are not.
   */
  private hearRemoteMoves(was: ReadonlyMap<string, { x: number; y: number }>, onMap: readonly BoardToken[]): void {
    const now = new Map(onMap.map((token) => [token.id, { x: token.x, y: token.y }]));
    const ignore = this.drops.active();
    if (this.press?.kind === 'token') for (const id of [this.press.id, ...(this.press.members?.keys() ?? [])]) ignore.add(id);
    const moved = remoteMoves(was, now, this.map?.grid.size ?? 50, ignore);
    const delays = staggerOffsets(moved.length);
    const heard = this.heard();
    moved.forEach((id, index) => {
      const entry = this.tokens.get(id);
      const from = was.get(id);
      if (!entry || !from) return;
      // Owed only while the board is heard: a move synced to a hidden window is not put down in a burst when it is shown.
      entry.gliding = heard;
      entry.glideDelay = delays[index];
      if (this.heardToken(entry.token, from)) this.sound('mini.pickup', { at: { x: from.x, y: this.standAt({ at: from }), z: from.y }, delayMs: delays[index] });
    });
  }

  /** A token that slid to a spot another board put it on has got there: it is set down, if this board's viewer sees it there. */
  private arrived(entry: TokenEntry): void {
    entry.gliding = false;
    if (this.heardToken(entry.token, entry.at)) this.putDownSound(entry.at, entry.glideDelay ?? 0);
  }

  /** Doors opened or shut by someone else since the last sync of this scene. */
  private hearRemoteDoors(map: BoardMap, sameScene: boolean): void {
    const states = new Map(map.walls.filter((wall) => wall.type === 'door' || wall.type === 'secret-door').map((wall) => [wall.id, wall.closed]));
    if (sameScene) for (const change of doorChanges(this.doorStates, states)) this.doorSound(change.id, change.closed ? 'door.shut' : 'door.open', true);
    this.doorStates = states;
  }

  /** A door's sound, at the middle of the door; one changed by someone else is not heard on a player's board when the door is under fog or out of sight. */
  private doorSound(id: string, sound: 'door.open' | 'door.shut' | 'door.locked', remote = false): void {
    const wall = this.map?.walls.find((candidate) => candidate.id === id);
    if (!wall) return;
    const cell = this.map?.grid.size ?? 50;
    const middle = { x: (wall.p1.x + wall.p2.x) / 2, y: (wall.p1.y + wall.p2.y) / 2 };
    if (remote && this.audience === 'player' && (insideFog(this.fog.areas, middle) || this.pointBeyond('player', middle.x, middle.y))) return;
    this.sound(sound, { at: { x: middle.x, y: (this.wallSquares(id) * cell) / 2, z: middle.y } });
  }

  /** A material slapped on wall segments: a flash over them and dust off their foot. */
  private slapImpact(ids: readonly string[]): void {
    const cell = this.map?.grid.size ?? 50;
    const segments = (this.map?.walls ?? []).filter((wall) => ids.includes(wall.id));
    if (segments.length === 0) return;
    if (!this.impacts.object3d.parent) this.scene.add(this.impacts.object3d);
    const height = Math.max(...segments.map((wall) => this.wallSquares(wall.id))) * cell;
    this.impacts.slap(segments, height, 0, this.host.wallThickness() * cell);
    // Heard at the middle of the segments.
    const middle = (axis: 'x' | 'y'): number => segments.reduce((sum, wall) => sum + (wall.p1[axis] + wall.p2[axis]) / 2, 0) / segments.length;
    this.sound('wall.crumble', { at: { x: middle('x'), y: height / 2, z: middle('y') } });
    this.wake(true);
  }

  /** Opens or shuts a door: at once on the board (a locked one stays shut), saved by the host. */
  toggleDoor(id: string): void {
    const wall = this.map?.walls.find((candidate) => candidate.id === id);
    if (!wall) return;
    if (!wall.locked) {
      wall.closed = !wall.closed;
      this.walls.setOpen(id, !wall.closed);
      // The file will say the same: that is no news to be heard again.
      this.doorStates = new Map(this.doorStates).set(id, wall.closed);
      this.wake(true);
      this.doorSound(id, wall.closed ? 'door.shut' : 'door.open');
    } else this.doorSound(id, 'door.locked');
    this.host.toggleDoor(id);
  }

  /** The material of walls painted with `path` (null: plain), shared by them; its textures fill in once read. */
  private wallLook(path: string | null, door: boolean): THREE.Material {
    const key = path ?? (door ? ':door' : ':wall');
    let material = this.wallMaterials.get(key);
    if (material) return material;
    material = new THREE.MeshStandardMaterial({ color: path ? 0xffffff : door ? PLAIN_DOOR : PLAIN_WALL, roughness: 0.9, metalness: 0 });
    addCutaway(material, this.cutaway);
    this.wallMaterials.set(key, material);
    if (path) {
      const made = material;
      void this.loads.track(this.host.readMaterial(path), 2).then((loaded) => {
        if (this.disposed || !loaded) { if (!loaded) made.color.set(PLAIN_WALL); return; }
        loaded.apply(made);
        // A material's own shader (parallax) replaces the cut: put it back.
        addCutaway(made, this.cutaway);
        made.needsUpdate = true;
        // Walls of a material that moves them are cut finely: stood again now that it is known.
        if (made.userData.displaces) this.updateWalls();
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
    on('pointercancel', (event) => { this.endTouch(event); this.cancel(); });
    // A double click on a mini brings the camera to it (the same as a click on its initiative card, minus the selection).
    on('dblclick', (event) => {
      if (event.button !== 0 || !this.allows('camera')) return;
      const entry = this.tokens.get(this.tokenAt(event.clientX, event.clientY) ?? '');
      if (!entry) return;
      this.camera.lookAt({ x: entry.goal.x, y: 0, z: entry.goal.y });
      this.wake();
    });
    // The pointer was taken away mid-drag (Alt-Tab, a dialog): no pointerup will come, so the drag ends here. After a
    // normal release `press` is already cleared.
    on('lostpointercapture', () => { if (this.press) this.cancel(); });
    on('pointerleave', () => {
      this.setMeasureHover(null);
      this.brushAt = null;
      this.showBrush();
      this.tooltip.hidden = true;
      this.showCell(null);
      this.laserClient = null;
      this.laserPoint = null;
      if (this.audience === 'player') this.host.hoverToken?.(null, null, false);
      this.wake();
    });
    on('wheel', (event) => {
      event.preventDefault();
      this.showName(null);
      if (this.eye) return;
      // With the fog brush in hand, Ctrl + scroll sizes it too: a notch one step of the keys (Atlas's smaller and larger brush).
      if (this.fogTool?.on && this.fogTool.shape === 'brush' && (event.ctrlKey || event.metaKey)) {
        const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
        this.brushScroll += pixels;
        const notches = Math.trunc(this.brushScroll / BRUSH_NOTCH);
        if (notches !== 0) {
          this.brushScroll -= notches * BRUSH_NOTCH;
          for (let i = 0; i < Math.abs(notches); i += 1) this.fogTool.stepBrush(notches < 0 ? 1 : -1, false);
          this.fogTool.move(event.clientX, event.clientY, { shift: event.shiftKey, ctrl: false }, event.altKey);
        }
        return;
      }
      // With the water brush in hand, Ctrl + scroll sizes the brush instead of zooming: a notch a quarter cell.
      if (this.waterTool && (event.ctrlKey || event.metaKey)) {
        const pixels = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 800 : event.deltaY;
        this.brushScroll += pixels;
        const notches = Math.trunc(this.brushScroll / BRUSH_NOTCH);
        if (notches !== 0) {
          this.brushScroll -= notches * BRUSH_NOTCH;
          const size = Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, Math.round((this.waterBrush - notches * BRUSH_STEP) / BRUSH_STEP) * BRUSH_STEP));
          if (size !== this.waterBrush) {
            this.waterBrush = size;
            this.brushAt = this.boardPoint(event.clientX, event.clientY) ?? this.brushAt;
            this.showBrush();
            this.toolbar.refresh();
          }
          this.showTip(event.clientX, event.clientY, `Brush ${this.waterBrush} cells (Ctrl + scroll)`);
          clearTimeout(this.brushTipTimer);
          this.brushTipTimer = setTimeout(() => { this.tooltip.hidden = true; }, 900);
        }
        return;
      }
      if (!this.allows('camera')) return;
      const free = this.cinematicDriver?.free;
      if (free) free.dolly(FREE_DOLLY ** -Math.sign(event.deltaY));
      else this.camera.zoom(Math.exp(event.deltaY * WHEEL));
      this.wake();
    }, { passive: false });
    on('keydown', (event) => {
      // A widget's number held (Atlas's widget bar): its keys step the widget, not the board.
      if (widgetTakes(event)) return;
      const key = event.key.toLowerCase();
      this.showName(null);
      // Escape first takes away a spell's review still waiting over the board (it would sit over the next cast).
      if (key === 'escape' && this.rulePanel?.showing) { this.rulePanel.dismiss(); return; }
      // Through the eyes, Escape steps back out of a spell being cast, else leaves the eyes.
      if (key === 'escape' && this.eye) {
        if (this.caster?.busy) this.caster.back(); else this.leaveEyes();
        return;
      }
      // F casts a spell: it works with the mouse held (only Escape is the browser's then).
      if (key === 'f' && this.eye && this.caster && !this.caster.busy && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.caster.open();
        return;
      }
      if (this.toolKey(event, key)) return;
      if (key === 'escape' && this.group.size > 0) { this.clearGroup(); return; }
      if (key === 'escape' && this.selectedId !== null) { this.select(null); return; }
      if (key === 'escape' && this.toolbar.isOpen) { this.toolbar.closeGround(); this.toolbar.closeDice(); this.toolbar.closeLighting(); return; }
      if (key === 'home') { this.frameMap(); event.preventDefault(); return; }
      // Up and down arrows while carrying a token take it to the layer above or below (shown, not yet the one played).
      if ((key === 'arrowup' || key === 'arrowdown' || key === 'pageup' || key === 'pagedown') && this.press?.kind === 'token' && this.audience === 'gm' && this.layerViews.size > 0) {
        event.preventDefault();
        this.stepDragLayer(key === 'arrowup' || key === 'pageup' ? 1 : -1);
        return;
      }
      // Space while carrying a token drops a waypoint on its ruler.
      if (key === ' ' && this.press?.kind === 'token') {
        event.preventDefault();
        if (!event.repeat) this.addWaypoint();
        return;
      }
      // Space while dragging a ruler measure drops a waypoint.
      if (key === ' ' && this.press?.kind === 'tool' && this.tools.tool === 'measure' && this.tools.shape === 'ruler') {
        event.preventDefault();
        if (!event.repeat && this.tools.addWaypoint()) this.showToolOverlay();
        return;
      }
      // Atlas's toolbar tools (random tables, asset manager, command palette) by Atlas's keys, the GM's only.
      if (this.audience === 'gm' && this.host.atlasKey?.(event, this.press?.kind === 'token') === true) { event.preventDefault(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key)) {
        if (!this.allows('camera')) return;
        this.held.add(key);
        event.preventDefault();
        this.wake();
      }
    });
    on('keyup', (event) => {
      this.held.delete(event.key.toLowerCase());
      if (event.key === 'Control' || event.key === 'Meta') this.hoverSpell(null);
    });
    // How presses come (a finger or a mouse), the spell panels' included: a mouse holds the pointer for the eyes.
    const pressed = (event: PointerEvent): void => { this.lastPointer = event.pointerType || 'mouse'; };
    this.container.addEventListener('pointerdown', pressed, { capture: true });
    const locking = (): void => this.lockChanged();
    this.canvas.ownerDocument.addEventListener('pointerlockchange', locking);
    this.stops.push(() => {
      this.container.removeEventListener('pointerdown', pressed, { capture: true });
      this.canvas.ownerDocument.removeEventListener('pointerlockchange', locking);
    });
    // Ctrl, pressed or let go wherever the focus is, shows or takes away the handles of the wall under the pointer.
    const win = this.canvas.ownerDocument.defaultView;
    const ctrl = (event: KeyboardEvent): void => {
      if (event.key !== 'Control' && event.key !== 'Meta' && event.key !== 'Alt') return;
      if (event.type === 'keydown' && event.repeat) return;
      // Alt alone would take the focus to the window's menu: not over the board.
      if (event.key === 'Alt' && this.pointerAt) event.preventDefault();
      // Let go: the spell's card and light go with the key.
      if (event.type === 'keyup' && !event.ctrlKey && !event.metaKey && !event.altKey) { this.hoverSpell(null); this.showSpellCard(null, { clientX: 0, clientY: 0 }); }
      if (this.press?.kind !== 'height' && this.press?.kind !== 'propScale' && this.press?.kind !== 'propLift') this.ctrlHandles(event.altKey ? 'width' : event.ctrlKey || event.metaKey ? 'height' : null);
    };
    const lost = (): void => { if (this.press?.kind !== 'height' && this.press?.kind !== 'propScale' && this.press?.kind !== 'propLift') this.ctrlHandles(null); };
    win?.addEventListener('keydown', ctrl);
    // Esc stops painting wherever the focus is (the gallery, say), unless it is for a field or a dialog.
    const escape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], .modal-container') !== null)) return;
      // Through the eyes, Escape pressed with the focus off the board (the eye button, a spell button) steps back too;
      // the board's own key handler has it when the board has the focus.
      if (this.eye && target !== this.canvas) {
        if (this.caster?.busy) this.caster.back(); else this.leaveEyes();
        return;
      }
      if (this.painting === null) return;
      this.paintWith(null);
    };
    win?.addEventListener('keydown', escape);
    this.stops.push(() => win?.removeEventListener('keydown', escape));
    win?.addEventListener('keyup', ctrl);
    // The lighting peek is held by its key, let go wherever the focus is; and the window losing the focus lets it go (Atlas's `bindHoldHotkey`).
    const peekUp = (event: KeyboardEvent): void => this.peekKeyUp(event.key);
    const peekLost = (): void => { if (this.peekKey !== null) this.peek(false); };
    win?.addEventListener('keyup', peekUp);
    win?.addEventListener('blur', peekLost);
    this.stops.push(() => { win?.removeEventListener('keyup', peekUp); win?.removeEventListener('blur', peekLost); });
    // Alt held with the water brush: the eraser, until it is let go (as Atlas's Alt turns its fog brush around).
    const altErase = (event: KeyboardEvent): void => {
      if (event.key !== 'Alt' || this.audience !== 'gm') return;
      // Alt held with the fog tool: a stroke does the other thing (also one under way), until it is let go.
      if (this.fogTool?.on) this.fogTool.setFlipped(event.type === 'keydown');
      if (event.type === 'keydown') {
        if (event.repeat || this.waterTool !== 'paint') return;
        const target = event.target as HTMLElement | null;
        if (target && target.closest('input, textarea, select, [contenteditable="true"], .modal-container') !== null) return;
        this.shiftErase = true;
        this.waterTool = 'erase';
      } else {
        if (!this.shiftErase) return;
        this.shiftErase = false;
        if (this.waterTool === 'erase') this.waterTool = 'paint';
      }
      this.showBrush();
      this.toolbar.refresh();
    };
    const altLost = (): void => { this.fogTool?.setFlipped(false); this.fogTool?.cancel(); if (this.shiftErase) altErase(new KeyboardEvent('keyup', { key: 'Alt' })); };
    // The fog shape under way: Escape drops it (before anything leaves the tool or clears the selection); Shift, Ctrl and Cmd place its
    // next corner anew. Enter and Backspace come through the shortcuts (`BoardAtlasTools.key`: `fogKey`), which know the undo key.
    const fogKeys = (event: KeyboardEvent): void => {
      const tool = this.fogTool;
      if (this.audience !== 'gm' || !tool?.on || !tool.drawing) return;
      // Only the board of the tab that is shown has the key (another tab's polygon does not take the Escape that closes a menu).
      const leaf = this.container.closest('.workspace-leaf');
      if (leaf && !leaf.classList.contains('mod-active')) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"], .modal-container') !== null) return;
      if (event.type === 'keydown' && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); tool.cancel(); return; }
      if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta') tool.rekey({ shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey });
    };
    // Atlas's keys act on the board wherever the focus is inside its tab, not only on the canvas: a toolbar button that was just
    // pressed keeps it. Text fields and Atlas's windows keep their own keys. Keys the canvas hears itself are not heard twice.
    const keysFromFocus = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || widgetTakes(event) || this.audience !== 'gm' || this.eye) return;
      const target = event.target as HTMLElement | null;
      // Focus inside the board's tab, or fallen to the page (a pressed button that was removed, as the measure
      // popover's Delete is) while the board's tab is the active one.
      if (!target || target === this.canvas) return;
      if (!this.container.contains(target) && target !== this.container.ownerDocument.body) return;
      const leaf = this.container.closest('.workspace-leaf');
      if (leaf && !leaf.classList.contains('mod-active')) return;
      if (target.closest('input, textarea, select, [contenteditable="true"], .atlas-tabletop-atlas-ui, .modal-container') !== null) return;
      // Atlas's Sound page over the board (SoundWindow) has the keys, also with the focus fallen to the page's body.
      if (this.container.querySelector('.atlas-tabletop-sound, .atlas-tabletop-sound-files') !== null) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      // Escape first closes a menu of the toolbar that is open.
      if (key === 'escape' && this.toolbar.isOpen) return;
      if (key !== 'v' && key !== 'k' && key !== 'escape' && this.host.atlasKey?.(event, this.press?.kind === 'token') !== true) return;
      if (key === 'v' || key === 'k' || key === 'escape') { if (!this.toolKey(event, key)) return; }
      event.preventDefault();
      event.stopPropagation();
    };
    win?.addEventListener('keydown', keysFromFocus, true);
    this.stops.push(() => win?.removeEventListener('keydown', keysFromFocus, true));
    win?.addEventListener('keydown', fogKeys, true);
    win?.addEventListener('keyup', fogKeys, true);
    this.stops.push(() => { win?.removeEventListener('keydown', fogKeys, true); win?.removeEventListener('keyup', fogKeys, true); });
    win?.addEventListener('keydown', altErase);
    win?.addEventListener('keyup', altErase);
    win?.addEventListener('blur', altLost);
    this.stops.push(() => { win?.removeEventListener('keydown', altErase); win?.removeEventListener('keyup', altErase); win?.removeEventListener('blur', altLost); });
    win?.addEventListener('blur', lost);
    this.stops.push(() => { win?.removeEventListener('keydown', ctrl); win?.removeEventListener('keyup', ctrl); win?.removeEventListener('blur', lost); });
    on('pointerleave', () => { this.fogTool?.leave(); this.pointerAt = null; if (this.press?.kind !== 'height' && this.press?.kind !== 'propScale' && this.press?.kind !== 'propLift') this.ctrlHandles(null); });
    // A material dragged from the gallery: the wall under the pointer is named, and painted where it is dropped. Taken
    // on the whole board (before anything over the canvas, or Obsidian's own drag handling, sees it), and as plain
    // text too, where the custom type does not get through.
    const types = (event: DragEvent): string[] => Array.from(event.dataTransfer?.types ?? []);
    // Over the board itself only: the panels on it (the initiative cards) have drags of their own.
    const mayCarry = (event: DragEvent): boolean => event.target === this.canvas
      && (types(event).includes(MATERIAL_DRAG_TYPE) || types(event).includes(MINI_DRAG_TYPE) || (types(event).includes('text/plain') && !types(event).includes('Files')));
    const take = (type: 'dragover' | 'drop' | 'dragleave', handler: (event: DragEvent) => void): void => {
      this.container.addEventListener(type, handler, true);
      this.stops.push(() => this.container.removeEventListener(type, handler, true));
    };
    take('dragover', (event) => {
      if (!mayCarry(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      if (types(event).includes(MINI_DRAG_TYPE)) {
        this.showTip(event.clientX, event.clientY, this.tokenAt(event.clientX, event.clientY) ? 'Give this token the mini' : 'Drop on a token');
        return;
      }
      // A raised shape in front: its surface or its sides take the material.
      const shaped = this.shapePartAt(event.clientX, event.clientY);
      if (shaped) {
        this.showTip(event.clientX, event.clientY, shaped.part === 'sides' ? 'Paint its sides' : 'Paint its surface');
        this.previewPaint(null);
        return;
      }
      const wall = this.wallAt(event.clientX, event.clientY);
      this.showTip(event.clientX, event.clientY, wall ? (event.shiftKey ? 'Paint the whole wall' : 'Paint this segment (Shift: the whole wall)') : 'Drop on a wall, a door or a shape');
      // The material shows on the wall under the pointer (the whole wall with Shift) before it is dropped. The drag's
      // data cannot be read until the drop: the gallery says what it carries (`materialDrag`).
      const carried = materialDrag.folder;
      this.previewPaint(wall && carried ? { ids: event.shiftKey ? wholeWall(this.map?.walls ?? [], wall) : [wall], material: carried } : null);
    });
    take('dragleave', (event) => {
      if (event.target === this.container || !this.container.contains(event.relatedTarget as Node | null)) { this.tooltip.hidden = true; this.previewPaint(null); }
    });
    take('drop', (event) => {
      if (!mayCarry(event)) return;
      const text = event.dataTransfer?.getData('text/plain') ?? '';
      const mini = event.dataTransfer?.getData(MINI_DRAG_TYPE) || (text.startsWith(MINI_TEXT_PREFIX) ? text.slice(MINI_TEXT_PREFIX.length) : '');
      if (mini) {
        event.preventDefault();
        event.stopPropagation();
        this.tooltip.hidden = true;
        const token = this.tokenAt(event.clientX, event.clientY);
        if (token) { this.host.assignMini?.(token, mini); const at = this.tokens.get(token)?.at; if (at) this.landImpact(token, at); }
        else this.host.warn('Tabletop: drop the mini on a token.');
        return;
      }
      const material = event.dataTransfer?.getData(MATERIAL_DRAG_TYPE) || (text.startsWith(MATERIAL_TEXT_PREFIX) ? text.slice(MATERIAL_TEXT_PREFIX.length) : '');
      if (!material) return;
      event.preventDefault();
      event.stopPropagation();
      this.tooltip.hidden = true;
      this.previewPaint(null);
      const shaped = this.shapePartAt(event.clientX, event.clientY);
      if (shaped) { this.paintShape(shaped.shape, shaped.part, material); return; }
      const wall = this.wallAt(event.clientX, event.clientY);
      if (wall) {
        this.host.paintWall(wall, material, event.shiftKey);
        this.slapImpact(event.shiftKey ? wholeWall(this.map?.walls ?? [], wall) : [wall]);
      } else this.host.warn('Tabletop: drop the material on a wall, a door or a raised shape.');
    });
    on('blur', () => this.held.clear());
  }

  private down(event: PointerEvent): void {
    this.canvas.focus();
    // With the mouse held for the eyes there is no pointer to capture (the browser refuses).
    if (!this.pointerLocked) this.canvas.setPointerCapture?.(event.pointerId);
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size >= 2) { this.startPinch(); return; }
      if (this.pinch) return;
    }
    // Anything done hides a name called up; a click on a token calls its name up (on release, `up`).
    this.showName(null);
    this.nameClick = null;
    if (event.button === 0 && !this.eye && this.touches.size <= 1) {
      const named = this.tokenAt(event.clientX, event.clientY);
      if (named) this.nameClick = { id: named, x: event.clientX, y: event.clientY };
    }
    // Through a token's eyes a drag only looks about; a mouse click holds the mouse to look (Escape lets go), and
    // while a spell is aimed, a click with the mouse held places it.
    if (this.eye && this.spellGizmo && this.caster?.adjusting && !this.pointerLocked && event.button === 0) {
      this.ray(event.clientX, event.clientY);
      if (this.spellGizmo.grab(this.raycaster, this.caster.adjusting, event.clientX)) return;
    }
    // The GM in Play mode, Alt held over a spell: a click clears it.
    if (!this.eye && this.audience === 'gm' && event.button === 0 && event.altKey && this.hoveredSpell && this.spellClearing) {
      const id = this.hoveredSpell;
      this.hoverSpell(null);
      this.host.playerAction?.({ type: 'spell', change: { remove: id } });
      return;
    }
    if (this.eye) {
      if (this.pointerLocked) {
        if (event.button === 0) this.caster?.click();
        // A right click lets go of the mouse and stays in the eyes.
        else if (event.button === 2) this.lockPointer(false);
        return;
      }
      if (event.pointerType === 'mouse' && event.button === 0 && (!this.caster?.busy || this.caster.aiming)) { this.lockPointer(true); return; }
      this.eyeDrag = { x: event.clientX, y: event.clientY };
      return;
    }
    this.tooltip.hidden = true;
    const { clientX: x, clientY: y } = event;
    // The press that closed a measurement's popover only did that, for the Measure tool: it measures nothing.
    if (this.measureClosedBy === event) {
      this.measureClosedBy = null;
      if (event.button === 0 && this.audience === 'gm' && (this.tools.tool === 'measure' || this.heldRuler !== null)) { this.press = null; return; }
    }
    // The pin beside a measurement that fades: a press on it keeps the measurement.
    if (event.button === 0 && this.audience === 'gm' && this.releasedPinAt(x, y)) {
      this.keepReleased();
      this.press = null;
      return;
    }
    // The handles of the kept measurements take the press from any tool (Atlas: the smallest marks and the topmost).
    if (event.button === 0 && this.audience === 'gm' && this.beginMeasureHandle(event)) return;
    // The measure key held (Atlas's `holdRuler`): the press is the quick ruler's, whatever tool is in use; that tool waits and has it back after.
    if (event.button === 0 && this.heldRuler !== null && this.audience === 'gm') {
      const at = this.boardPoint(x, y);
      if (at) {
        this.press = { kind: 'tool', x, y, moved: false };
        this.tools.down(at, this.now());
        this.showToolOverlay();
        return;
      }
    }
    // The handles of a scene being placed on the plane come first.
    if (event.button === 0 && this.audience === 'gm' && this.beginGizmo(x, y)) return;
    if (event.button === 0 && this.placing) return;
    if (event.button === 0 && this.painting) return;
    if (event.button === 2 && this.painting) { this.paintWith(null); this.press = null; return; }
    if (event.button === 0 && this.laserOn) {
      this.press = { kind: 'laser', x, y, moved: false };
      this.trackLaser(x, y);
      return;
    }
    if (this.audience === 'player') {
      this.playerDown(event);
      return;
    }
    // The GM's fog tool: a drag draws fog (Alt: the other thing). A press on a token is the token's.
    // A press of the tool that begins nothing (Cells without a grid) is swallowed too: nothing under it is dragged or lifted.
    // The press of a token, a pin, a door or a light's bulb is that object's from any tool (Atlas: they take the press and the fog tool draws nothing).
    // Only in Edit mode: another board may have switched the shared mode to Play under a tool left on.
    if (event.button === 0 && this.fogTool?.on && this.editing && !this.tokenAt(x, y) && !this.pinAt(x, y) && !this.doorAt(x, y) && !this.lightAt(x, y)) {
      if (this.fogTool.down(x, y, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }, event.altKey)) this.press = { kind: 'fog' };
      return;
    }
    // The Shapes tool: a click adds a corner, a corner pressed is dragged (Ctrl: raised).
    if (this.shapeEditor?.down(x, y, event.button, event.ctrlKey || event.metaKey)) return;
    // The GM's water brush: a drag paints water over the map (or takes it away).
    if (event.button === 0 && this.waterTool === 'fill' && this.audience === 'gm') {
      const at = this.boardPoint(x, y);
      if (at) {
        this.fillWater(at, !event.shiftKey);
        this.press = { kind: 'water', last: at };
        return;
      }
    }
    if (event.button === 0 && this.waterTool && this.audience === 'gm') {
      const at = this.boardPoint(x, y);
      if (at) {
        this.paintWater(at, at);
        this.press = { kind: 'water', last: at };
        return;
      }
    }
    // The GM's Measure tool (Atlas's): a drag measures a line, circle or cone; nothing is kept or sent.
    if (event.button === 0 && this.tools.tool === 'measure') {
      const at = this.boardPoint(x, y);
      if (at) {
        this.press = { kind: 'tool', x, y, moved: false };
        this.tools.down(at, this.now());
        this.showToolOverlay();
        return;
      }
    }
    // Alt + drag on a prop: its standing height; Alt + double click puts it back on what is under it.
    if (event.button === 0 && event.altKey && !event.shiftKey && this.editing && this.host.liftProp && !this.painting && !this.waterTool && !this.placing) {
      const id = this.tokenAt(x, y) ? null : this.propAt(x, y);
      const piece = id ? this.props.get(id) : null;
      if (id && piece) {
        const now = performance.now();
        const again = this.liftClick && this.liftClick.id === id && now - this.liftClick.at < DOUBLE_CLICK_MS;
        this.liftClick = again ? null : { id, at: now };
        if (again) {
          this.host.liftProp(id, 0);
          this.propsVersion += 1;
          this.showPropLine(null);
          this.wake(true);
          return;
        }
        const start = piece.placement.lift ?? 0;
        this.press = { kind: 'propLift', id, x, y, moved: false, start, value: start };
        return;
      }
    }
    // Alt + drag on a wall's width handle.
    if (event.button === 0 && event.altKey && this.editing && this.handles?.kind === 'width') {
      const handle = this.handleAt(x, y);
      if (handle) {
        this.press = { kind: 'height', target: 'width', id: handle.wall, x, y, moved: false, start: this.wallWidthSquares(handle.wall) };
        return;
      }
    }
    if (event.button === 0 && (event.ctrlKey || event.metaKey)) {
      const id = this.propAt(x, y);
      const piece = id ? this.props.get(id) : null;
      const at = this.boardPoint(x, y);
      if (id && piece && at && this.editing && this.host.scaleProp) {
        this.press = { kind: 'propScale', id, x, y, moved: false, start: piece.placement.scale, value: piece.placement.scale };
        return;
      }
      if (id && piece && at) {
        this.press = { kind: 'prop', id, x, y, moved: false, grab: { dx: piece.object3d.position.x - at.x, dy: piece.object3d.position.z - at.y } };
        return;
      }
      // Ctrl + drag on one of a wall's handles: its top, or a window's sill or lintel.
      const handle = this.editing && this.handles?.kind === 'height' ? this.handleAt(x, y) : null;
      if (handle) {
        this.press = { kind: 'height', target: handle.part, id: handle.wall, x, y, moved: false, start: this.partSquares(handle.wall, handle.part) };
        return;
      }
      // Ctrl + drag on a light's bulb or a wall changes its height.
      const light = this.lightAt(x, y);
      const wall = light || !this.editing ? null : this.wallAt(x, y);
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
      const at = this.surfacePoint(x, y);
      const turn = id && event.altKey && !event.shiftKey ? this.host.miniTurn?.(id) ?? null : null;
      if (id && entry && at && turn !== null) {
        const center = { x: entry.at.x, y: entry.at.y };
        this.press = { kind: 'rotate', id, x, y, moved: false, center, startAngle: Math.atan2(at.y - center.y, at.x - center.x), startTurn: turn, turn };
        return;
      }
      if (id && entry && at) {
        const toggle = event.shiftKey && !event.altKey;
        const members = !toggle && this.group.size >= 2 && this.group.has(id) ? this.groupMembers() : undefined;
        this.press = {
          kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y },
          copy: event.altKey && event.shiftKey, start: snapPoint(this.snapGrid('tokens'), entry.goal.x, entry.goal.y, entry.token.size), waypoints: [],
          ...(toggle ? { toggle } : {}), ...(members ? { members } : {}),
        };
        entry.piece.carried = true;
        for (const member of members?.keys() ?? []) { const other = this.tokens.get(member); if (other) other.piece.carried = true; }
        return;
      }
      const propId = !id && this.editing && this.host.boardMode?.() === 'edit' && !this.painting && !this.waterTool && !this.placing ? this.propAt(x, y) : null;
      const prop = propId ? this.props.get(propId) : null;
      if (propId && prop && at) {
        this.press = { kind: 'prop', id: propId, x, y, moved: false, grab: { dx: prop.object3d.position.x - at.x, dy: prop.object3d.position.z - at.y } };
        prop.carried = true;
        this.wake(true);
        return;
      }
    }
    const token = event.button === 2 ? this.tokenAt(x, y) : null;
    const prop = event.button === 2 && !token ? this.propAt(x, y) : null;
    // A click on a pin opens its note; a right-click on one (over any wall behind it) opens its menu.
    const pin = event.button === 0 || (event.button === 2 && !token && !prop && this.host.pinMenu) ? this.pinAt(x, y) : null;
    // A right-click on a light's bulb opens its menu; a click opens a door; a right-click on any wall opens its menu.
    const light = event.button === 2 && !token && !prop && !pin ? this.lightAt(x, y) : null;
    const door = event.button === 0 && !pin ? this.doorAt(x, y) : event.button === 2 && !token && !prop && !light && !pin ? this.wallAt(x, y) : null;
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
      const id = this.movableTokenAt(x, y);
      const entry = id ? this.tokens.get(id) : null;
      const at = this.surfacePoint(x, y);
      if (id && entry && at) {
        this.press = {
          kind: 'token', id, x, y, moved: false, grab: { dx: entry.at.x - at.x, dy: entry.at.y - at.y },
          copy: false, start: snapPoint(this.snapGrid('tokens'), entry.goal.x, entry.goal.y, entry.token.size), waypoints: [],
        };
        entry.piece.carried = true;
        return;
      }
    }
    if (event.button === 0 && this.tools.takesPress && this.allows('tool')) {
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
    for (const action of actions) {
      this.host.playerAction?.(action);
    }
  }

  /**
   * The measurement let go that Keep did not keep (Atlas's `LiveMeasuring.fade`): it stays `MEASURE_FADE_MS` with a pin beside
   * its label that keeps it, and dissolves over the last `LIVE_DISSOLVE_MS`. `add` is what the pin keeps; `at` when it was let go.
   */
  private released: { measure: NonNullable<ReturnType<PlayerToolState['overlay']>['measure']>; add: MeasureChange; at: number; pin: boolean } | null = null;

  /** Takes the fading measurement off the board. */
  private clearReleased(): void {
    if (!this.released) return;
    this.released = null;
    this.showToolOverlay();
  }

  /** The pin of the fading measurement was pressed: its measurement is kept, in one step of Atlas's history. */
  private keepReleased(): void {
    const released = this.released;
    if (!released) return;
    this.host.measureAction?.(released.add);
    this.released = null;
    this.showToolOverlay();
  }

  /** Whether the screen point is on the pin beside the fading measurement's label. */
  private releasedPinAt(clientX: number, clientY: number): boolean {
    const pin = this.marks.pin;
    if (!this.released?.pin || !pin) return false;
    this.applyView();
    const rect = this.canvas.getBoundingClientRect();
    const on = new THREE.Vector3(pin.x, 1.2, pin.y).project(this.view);
    if (on.z > 1) return false;
    const x = rect.left + ((on.x + 1) / 2) * rect.width + pin.away;
    const y = rect.top + ((1 - on.y) / 2) * rect.height;
    // A little beyond its disc still takes the press (Atlas's reach).
    return Math.hypot(clientX - x, clientY - y) <= MEASURE_PIN_PX / 2 + 2;
  }

  /** Ages the fading measurement: whole while it stays, dissolving at the end, gone after `MEASURE_FADE_MS`; true while it shows. */
  private stepReleased(): boolean {
    const released = this.released;
    if (!released) return false;
    const elapsed = this.now() - released.at;
    if (elapsed >= MEASURE_FADE_MS) { this.clearReleased(); return false; }
    this.marks.setOverlayAlpha(releasedAlpha(elapsed));
    return true;
  }

  /** The measure key let go: a measurement still fading goes without its pin, dissolving at once (Atlas's `dissolve`). */
  private dissolveReleased(): void {
    const released = this.released;
    if (!released) return;
    released.pin = false;
    released.at = this.now() - (MEASURE_FADE_MS - LIVE_DISSOLVE_MS);
    this.showToolOverlay();
  }

  /** Atlas's Measure tool choices changed (its toolbar, its keys): the bar and the shape in use follow. */
  measureToolChanged(): void {
    if (this.audience !== 'gm') return;
    const { mode } = this.measureOptions();
    if (this.tools.tool === 'measure' && isMeasureShape(mode) && this.tools.shape !== mode) {
      this.tools.shape = mode;
      this.tools.cancel();
      this.showToolOverlay();
    }
    this.toolbar.refresh();
  }


  // ---- A kept measurement is edited on the board as in Atlas (`MeasureHandleInteraction`): handles, popover, drag, Delete ----

  /** The handles of the kept measurements: a badge at each origin, on an area its far end and a turn handle. */
  private readonly measureHandles = new MeasureHandleMarks(() => accent(this.container));
  private measureHover: HandleRef | null = null;
  /** The measurement whose popover is open. */
  private measureOpen: string | null = null;
  /** Where a measurement being dragged lies now; kept after the let-go until Atlas's store answers with the new points. */
  private measurePreview: { id: string; points: Array<{ x: number; y: number }>; settled: { measures: unknown; until: number } | null } | null = null;
  private measurePopoverView: MeasurePopover | null = null;
  /** The press that closed the popover, which the Measure tool then starts no measurement with. */
  private measureClosedBy: Event | null = null;
  private measureSeen: { map: BoardMap; measures: unknown; tokens: unknown; preview: unknown; open: string | null } | null = null;
  private stopMeasurePresses: (() => void) | null = null;

  /** Whether kept measurements take handles now (Atlas's `mayEditMeasure` for the board): the GM's board of a loaded map, in GM view, with Atlas able to delete. */
  get measuresEditable(): boolean {
    return mayEditMeasures({
      gm: this.audience === 'gm', gmView: !this.sessionView, loaded: this.map !== null, eye: this.eye !== null,
      cinematic: this.host.boardMode?.() === 'cinematic', writes: this.host.measureWrites?.().remove === true && this.host.deleteMeasure !== undefined,
    });
  }

  private editableIds(): string[] {
    return editableMeasures(this.map?.measures ?? []).map(({ id }) => id);
  }

  /** Draws the handles again where the measurements, the tokens, a drag or the open popover say; sizes them to the screen; keeps the popover beside its handle. */
  private syncMeasureHandles(pixel: number): void {
    const on = this.measuresEditable;
    this.measureHandles.setVisible(on);
    if (!on || !this.map) {
      this.closeMeasurePopover();
      this.setMeasureHover(null);
      return;
    }
    const map = this.map;
    const preview = this.measurePreview;
    if (preview?.settled && (map.measures !== preview.settled.measures || performance.now() > preview.settled.until)) this.measurePreview = null;
    const seen = this.measureSeen;
    if (!seen || seen.map !== map || seen.measures !== map.measures || seen.tokens !== map.tokens || seen.preview !== this.measurePreview || seen.open !== this.measureOpen) {
      this.measureSeen = { map, measures: map.measures, tokens: map.tokens, preview: this.measurePreview, open: this.measureOpen };
      this.rebuildMeasureHandles(map);
    }
    this.measureHandles.step(pixel);
    this.placeMeasurePopover();
  }

  private rebuildMeasureHandles(map: BoardMap): void {
    const preview = this.measurePreview;
    const editable = editableMeasures(map.measures).map((measure) => (preview?.id === measure.id ? { id: measure.id, record: { ...measure.record, points: preview.points } as typeof measure.record } : measure));
    const tokens = new Map(map.tokens.map((token) => [token.id, token]));
    const spots = handleSpots(editable, map.tokens.map(({ id, x, y, size }) => ({ id, x, y, size })), map.grid.size);
    const items: HandleItem[] = [];
    for (const { id, record } of editable) {
      const spot = spots.get(id);
      if (!spot) continue;
      const placed = placedMeasure(record, (token) => { const at = tokens.get(token); return at ? { x: at.x, y: at.y } : null; }) ?? record;
      items.push({
        id, shape: record.shape, color: typeof record.color === 'string' ? record.color : accent(this.container), spot,
        points: placed.points.map(({ x, y }) => ({ x, y })), turns: record.shape !== 'circle' && record.shape !== 'ruler' && followedToken(record) === null,
      });
    }
    this.measureHandles.set(items, this.measureOpen);
    if (this.measureOpen !== null && !items.some(({ id }) => id === this.measureOpen)) this.closeMeasurePopover(); else this.showMeasurePopover();
    this.wake();
  }

  /** The handle under a screen point, tested where the handles are drawn on screen. */
  private measureHandleAt(clientX: number, clientY: number): HandleRef | null {
    if (!this.measureHandles.visible) return null;
    this.applyView();
    const rect = this.canvas.getBoundingClientRect();
    const places: Handle[] = [];
    for (const place of this.measureHandles.places()) {
      const on = new THREE.Vector3(place.x, 1.4, place.y).project(this.view);
      if (on.z > 1) continue;
      places.push({ id: place.id, part: place.part, x: rect.left + ((on.x + 1) / 2) * rect.width, y: rect.top + ((1 - on.y) / 2) * rect.height });
    }
    return hitHandle(places, clientX, clientY);
  }

  private setMeasureHover(ref: HandleRef | null): void {
    if (ref?.id === this.measureHover?.id && ref?.part === this.measureHover?.part) return;
    this.measureHover = ref;
    this.measureHandles.setHovered(ref);
    this.canvas.style.cursor = ref ? 'pointer' : this.laserOn ? 'none' : '';
    this.wake();
  }

  /** A press on a handle: its measurement's popover opens when let go in place; a drag changes it. True when a handle took the press. */
  private beginMeasureHandle(event: PointerEvent): boolean {
    const ref = this.measureHandleAt(event.clientX, event.clientY);
    if (!ref || !this.map?.measures.some(({ id }) => id === ref.id)) return false;
    const from = ref.part === 'turn' ? this.measureHandles.places().find((place) => place.id === ref.id && place.part === 'turn') ?? null : null;
    this.press = { kind: 'measureHandle', ref, x: event.clientX, y: event.clientY, moved: false, grabbed: this.boardPoint(event.clientX, event.clientY), from: from ? { x: from.x, y: from.y } : null };
    return true;
  }

  /** The handle dragged: the measurement is shown where the pointer takes it (nothing is written until it is let go). */
  private dragMeasureHandle(press: Extract<Press, { kind: 'measureHandle' }>, event: PointerEvent): void {
    if (!press.moved) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_PX) return;
      press.moved = true;
      this.measureHandles.setDragging(press.ref);
    }
    const map = this.map;
    const entry = map?.measures.find(({ id }) => id === press.ref.id);
    const at = this.boardPoint(event.clientX, event.clientY);
    if (!map || !entry || !at || !press.grabbed) return;
    const grid = map.grid;
    const points = dragPoints(entry.record, press.ref.part, { x: at.x - press.grabbed.x, y: at.y - press.grabbed.y },
      { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY, snap: grid.enabled && grid.snap }, event.altKey, press.from);
    // Snapped, most moves of the pointer leave it where it is; an aura has no drag.
    if (!points || samePoints(points, this.measurePreview?.id === entry.id ? this.measurePreview.points : entry.record.points)) return;
    this.measurePreview = { id: entry.id, points, settled: null };
    this.wake();
  }

  /** The handle is let go (`commit`) or the press is lost: a click opens the popover, a drag writes the new points as one step. */
  private endMeasureHandle(press: Extract<Press, { kind: 'measureHandle' }>, commit: boolean): void {
    this.measureHandles.setDragging(null);
    const preview = this.measurePreview;
    if (press.moved) {
      if (commit && preview && preview.id === press.ref.id) {
        // Shown where it was let go until Atlas's store answers.
        preview.settled = { measures: this.map?.measures, until: performance.now() + 1500 };
        this.host.updateMeasure?.(preview.id, { points: preview.points.map(({ x, y }) => ({ x, y })) });
      } else {
        this.measurePreview = null;
      }
    } else if (commit) {
      this.openMeasurePopover(press.ref.id);
    }
    this.measureSeen = null;
    this.wake();
  }

  openMeasurePopover(id: string): void {
    if (!this.editableIds().includes(id)) return;
    this.measureOpen = id;
    this.measureSeen = null;
    if (!this.stopMeasurePresses) {
      const doc = this.container.ownerDocument;
      // A press anywhere but in the popover closes it, except one on a handle (that is the popover's own: it moves there). The press is remembered: it closed something.
      const onPress = (event: PointerEvent): void => {
        if (this.measureOpen === null || this.measurePopoverView?.element.contains(event.target as Node | null)) return;
        if (event.target === this.canvas && this.measureHandleAt(event.clientX, event.clientY) !== null) return;
        this.measureClosedBy = event;
        this.closeMeasurePopover();
      };
      doc.addEventListener('pointerdown', onPress, true);
      this.stopMeasurePresses = () => doc.removeEventListener('pointerdown', onPress, true);
    }
    this.wake();
  }

  closeMeasurePopover(): void {
    if (this.measureOpen === null && !this.measurePopoverView?.isOpen) return;
    this.measureOpen = null;
    this.measurePopoverView?.hide();
    this.stopMeasurePresses?.();
    this.stopMeasurePresses = null;
    this.measureSeen = null;
    this.wake();
  }

  private showMeasurePopover(): void {
    const id = this.measureOpen;
    const entry = id === null ? undefined : this.map?.measures.find((measure) => measure.id === id);
    if (id === null || !entry) { this.measurePopoverView?.hide(); return; }
    this.measurePopoverView ??= new MeasurePopover(this.container, {
      cell: () => this.map?.grid.size ?? 70,
      canUpdate: () => this.host.measureWrites?.().update === true && this.host.updateMeasure !== undefined,
      update: (measure, changes) => this.host.updateMeasure?.(measure, changes),
      remove: (measure) => this.removeMeasure(measure),
      tokensIn: (measure) => this.tokensInMeasure(measure).length,
      selectTokens: (measure) => this.selectTokensIn(measure),
      lineWidthChosen: (cells) => { this.host.setMeasureTool?.({ lineWidth: cells }); },
      distanceText: (cells) => { const size = this.map?.grid.size ?? 70; return this.distanceLabel([{ x: 0, y: 0 }, { x: cells * size, y: 0 }]); },
      close: () => { this.closeMeasurePopover(); this.canvas.focus(); },
    });
    this.measurePopoverView.show(id, entry.record as never);
  }

  /** Keeps the open popover beside its measurement's badge, clear of the toolbar. */
  private placeMeasurePopover(): void {
    const id = this.measureOpen;
    const popover = this.measurePopoverView;
    const item = id === null ? null : this.measureHandles.itemOf(id);
    if (!popover?.isOpen || !item) return;
    this.applyView();
    const on = new THREE.Vector3(item.spot.origin.x, 1.4, item.spot.origin.y).project(this.view);
    const rect = this.canvas.getBoundingClientRect();
    const box = this.container.getBoundingClientRect();
    const bar = this.container.querySelector<HTMLElement>('.atlas-tabletop-toolbar')?.getBoundingClientRect();
    popover.place(rect.left + ((on.x + 1) / 2) * rect.width - box.left, rect.top + ((1 - on.y) / 2) * rect.height - box.top,
      { width: box.width, height: box.height }, { top: 0, bottom: bar && bar.height > 0 ? Math.max(0, box.bottom - bar.top) : 0 });
  }

  /** Takes a kept measurement off the map (one undo step); its popover closes with it. */
  private removeMeasure(id: string): void {
    this.setMeasureHover(null);
    this.closeMeasurePopover();
    this.host.deleteMeasure?.(id);
    this.wake();
  }

  /** Atlas's Delete on a handle: the measurement the pointer is over, else the one whose popover is open. False where neither is. */
  private deleteMeasureByKey(): boolean {
    if (!this.measuresEditable) return false;
    const id = deleteTargetOf({ hovered: this.measureHover?.id ?? null, open: this.measureOpen, editable: this.editableIds() });
    if (id === null) return false;
    this.removeMeasure(id);
    return true;
  }

  /** Escape: a measurement being dragged is put back, else the popover closes. */
  private measureEscape(): boolean {
    const press = this.press;
    if (press?.kind === 'measureHandle' && press.moved) {
      this.press = null;
      this.endMeasureHandle(press, false);
      return true;
    }
    if (this.measureOpen === null) return false;
    this.closeMeasurePopover();
    return true;
  }

  /** The tokens whose centre lies in the area of the kept measurement `id`, as it lies now. */
  private tokensInMeasure(id: string): string[] {
    const map = this.map;
    const entry = map?.measures.find((measure) => measure.id === id);
    if (!map || !entry || entry.record.shape === 'ruler') return [];
    const tokens = new Map(map.tokens.map((token) => [token.id, token]));
    const placed = placedMeasure(entry.record, (token) => { const at = tokens.get(token); return at ? { x: at.x, y: at.y } : null; });
    const [start, end] = placed?.points ?? [];
    if (!placed || !start || !end) return [];
    const width = entry.record.shape === 'line' ? (typeof entry.record.width === 'number' && entry.record.width > 0 ? entry.record.width : map.grid.size) : undefined;
    const area = templateArea({ shape: entry.record.shape, start, end, ...(width !== undefined ? { width } : {}) } as never, this.tools.coneAngle);
    if (!area) return [];
    return map.tokens.filter((token) => this.tokens.has(token.id) && area.contains({ x: token.x, y: token.y })).map((token) => token.id);
  }

  /** Atlas's Select tokens: the tokens in the area are selected. */
  private selectTokensIn(id: string): void {
    const ids = this.tokensInMeasure(id);
    if (ids.length === 0) return;
    if (ids.length === 1) { this.select(ids[0]); return; }
    this.select(null);
    this.group.clear();
    for (const token of ids) this.group.add(token);
    this.drawGroup();
    this.wake();
  }

  /**
   * The keys of the tools (the Shapes tool, Escape out of the one in hand, K for Keep, V for Move/Select and the laser): true when
   * one did something. They are the board's whatever has the focus inside it, so this is called from the canvas and from the
   * window (`toolKeysFromFocus`), where a toolbar button has it.
   */
  private toolKey(event: KeyboardEvent, key: string): boolean {
    if (this.audience === 'gm' && this.shapeEditor?.key(key)) { event.preventDefault(); return true; }
    if (key === 'escape' && this.audience === 'gm' && this.measureEscape()) return true;
    if (key === 'escape' && this.placing) { this.stopPlacing(); return true; }
    if (key === 'escape' && this.painting) { this.paintWith(null); return true; }
    if (key === 'escape' && this.laserOn) { this.setLaser(false); return true; }
    // Atlas's Move/Select key switches between moving and the laser pointer.
    // A player's tools are Connect's: Escape goes back to Move, as in its 2D view.
    if (this.audience === 'gm' && key === 'escape' && this.fogTool?.on) {
      if (this.fogTool.drawing) this.fogTool.cancel(); else this.fogTool.setOn(false);
      return true;
    }
    if (this.audience === 'gm' && key === 'escape' && this.waterTool) { this.waterTool = null; this.showBrush(); this.toolbar.refresh(); return true; }
    if (this.audience === 'gm' && key === 'escape' && this.tools.tool === 'measure') { this.tools.select('move'); this.toolsChanged(); return true; }
    if (this.audience === 'gm' && key === 'k' && this.tools.tool === 'measure' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      this.setMeasureOptions({ keep: !this.measureOptions().keep });
      return true;
    }
    if (this.audience === 'player' && key === 'escape' && this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); return true; }
    if (key === 'v' && this.audience === 'gm' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // With the Measure tool in hand the key goes back to Move/Select (the hand); pressed again it is the laser.
      if (this.tools.tool !== 'move') { this.putMeasureAway(); this.setLaser(false); } else this.setLaser(!this.laserOn);
      return true;
    }
    return false;
  }

  /** The measure or template being dragged, drawn; the toolbar told of a change. */
  private showToolOverlay(): void {
    const { measure: live, draft } = this.tools.overlay();
    // A new measurement gives way to one that still fades.
    if (live) this.released = null;
    const measure = live ?? this.released?.measure ?? null;
    const map = this.map;
    const cell = map?.grid.size ?? 70;
    const opts = this.measureOptions();
    // A ruler from one token to another counts the height between them, as Atlas's ruler does (`rulerRise`); an area counts none.
    const points = measure ? [measure.start, ...(measure.waypoints ?? []), measure.end] : [];
    const rise = measure && map && measure.shape === 'ruler' ? riseBetweenEnds(points, (point) => this.heightAt(point), this.host.measurement()) : 0;
    const label = measure && map ? this.distanceLabel(points, rise) : '';
    const measureColor = opts.color ?? accent(this.container);
    this.marks.setOverlay(
      measure
        ? { ...measure, label, color: measureColor, cell, ...(measure.shape === 'line' ? { width: opts.lineWidth * cell } : {}) }
        : null,
      // Drawn as the measure it becomes: a line one cell wide.
      draft ? { ...draft, color: this.host.ownColor?.() ?? '#ffcc33', ...(draft.shape === 'line' ? { width: cell } : {}) } : null,
      this.tools.coneAngle,
      this.lastPose?.pixel ?? 0.002,
      !live && this.released?.pin === true,
    );
    if (!live && this.released) this.marks.setOverlayAlpha(releasedAlpha(this.now() - this.released.at));
    this.wake();
  }

  /** Lets the tools change from outside (Connect's toolbar): the drawing and the toolbar follow. */
  toolsChanged(): void {
    this.tools.cancel();
    // The Measure tool put away takes a measurement that still fades with it (Atlas's `putAway`: the live measurement is cleared); a held ruler's own fade is left.
    if (this.tools.tool !== 'measure' && this.heldRuler === null) this.released = null;
    this.showToolOverlay();
    this.host.toolsChanged?.();
    if (this.audience === 'gm') this.toolbar.refresh();
  }

  /** The scene's lasting templates, from Connect. */
  receiveTemplates(list: readonly TemplateMark[]): void {
    this.tools.receiveTemplates(list);
    this.templateMarks = list;
    this.drawMarks();
    this.host.toolsChanged?.();
    if (this.audience === 'gm') this.toolbar.refresh();
    this.wake();
  }

  /** What the walls leave of an area depends on the map's size (the lighting seals walls by it) and its grid. */
  private wallsLook(): WallsLook {
    return { size: this.mapSizeKnown ? this.mapSize : null, cell: this.map?.grid.size };
  }

  /**
   * The lasting templates and areas drawn: each cut by the map's walls as Atlas cuts its kept areas (unless its measure
   * passes walls), and each area with an effect standing in 3D as tall as the map's default wall height. Drawn again when
   * the map changes (a wall or a door moved).
   */
  private drawMarks(): void {
    const map = this.map;
    const walls = map?.walls ?? [];
    const cell = map?.grid.size ?? 70;
    const look = this.wallsLook();
    const height = Math.max(MIN_WALL_SQUARES, this.host.fogHeight()) * cell;
    const cuts = new Map<string, Array<Array<{ x: number; y: number }>>>();
    const volumes: AreaVolume[] = [];
    for (const mark of this.templateMarks) {
      const shape = markShape(mark, this.tools.coneAngle, walls, look);
      if (shape?.cut) cuts.set(mark.id, ringsOf(shape.cut));
      if (mark.effect) {
        const volume = areaVolumeOf(mark, shape?.cut ?? null, height, this.tools.coneAngle);
        if (volume) volumes.push(volume);
      }
    }
    this.marks.setTemplates(this.templateMarks, this.tools.coneAngle, cuts);
    this.areas.set(volumes, cell);
    this.wake();
  }

  /** The areas with an effect drawn now, for a look in tests. */
  areaState(): ReturnType<AreaVolumes['state']> {
    return this.areas.state();
  }

  /** Someone's ping, from Connect. */
  receivePing(x: number, y: number, color: string): void {
    this.marks.ping(x, y, color, this.clock);
    this.wake();
  }

  /**
   * A player's phone in augmented reality, from Connect: where its camera is over this map, in board units (null: they
   * left AR or lost the tracking). Shown as an eye in their colour, with their name.
   */
  receiveViewer(from: string, name: string, color: string, pose: ViewerPose | null): void {
    if (typeof from !== 'string' || (pose !== null && !isViewerPose(pose))) return;
    this.viewers.set(from, typeof name === 'string' ? name.slice(0, 60) : '', typeof color === 'string' ? color : '#ffcc33', pose, (this.map?.grid.size ?? 70) * 0.75, this.clock);
    this.wake();
  }

  /** New points of someone's laser, from Connect. */
  receiveLaser(from: string, points: ReadonlyArray<{ x: number; y: number }>, lifted: boolean, color: string): void {
    this.marks.laser(from, points, lifted, color, this.clock);
    this.wake();
  }

  private move(event: PointerEvent): void {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch) { this.movePinch(); return; }
    }
    if (this.eye && this.spellGizmo && this.caster?.adjusting && !this.pointerLocked) {
      this.ray(event.clientX, event.clientY);
      if (this.spellGizmo.dragging) {
        const spell = this.spellGizmo.move(this.raycaster, event.clientX, this.map?.grid.size ?? 50, event.shiftKey);
        if (spell) { this.caster.adjusted(spell); this.spellGizmo.place(spell, this.view); }
        return;
      }
      if (!this.eyeDrag) {
        const handle = this.spellGizmo.hit(this.raycaster);
        this.spellGizmo.hover(handle);
        this.canvas.style.cursor = handle ? (handle.kind === 'move' ? 'move' : 'grab') : '';
        this.wake();
      }
    }
    if (!this.eye) this.spellHoverAt(event);
    if (this.eye) {
      if (this.pointerLocked) { this.eye.drag(event.movementX, event.movementY); return; }
      if (this.eyeDrag) { this.eye.drag(event.clientX - this.eyeDrag.x, event.clientY - this.eyeDrag.y); this.eyeDrag = { x: event.clientX, y: event.clientY }; }
      return;
    }
    const press = this.press;
    if (this.shapeEditor?.move(event.clientX, event.clientY, event.shiftKey)) return;
    if (this.waterTool) { this.brushAt = this.boardPoint(event.clientX, event.clientY); this.showBrush(); }
    if (this.fogTool?.on) this.fogTool.move(event.clientX, event.clientY, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }, event.altKey);
    if (press?.kind === 'fog') return;
    if (press?.kind === 'gizmo') {
      this.dragGizmo(press, event.clientX, event.clientY, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey, alt: event.altKey });
      return;
    }
    if (press?.kind === 'water') {
      const at = this.boardPoint(event.clientX, event.clientY);
      if (at && this.waterTool !== 'fill') { this.paintWater(press.last, at); press.last = at; }
      return;
    }
    if (press?.kind === 'measureHandle') { this.dragMeasureHandle(press, event); return; }
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
    if (!press) {
      if (!this.laserOn) this.hover(event);
      // The GM's Alt over a spell: the tip says what a click does (after the token's hover, which hides tips).
      if (this.hoveredSpell && this.spellClearing) this.showTip(event.clientX, event.clientY, 'Alt+click to clear this spell');
      return;
    }
    // Moving with no button held: the release was missed.
    if (event.buttons === 0) { this.cancel(); return; }
    const { clientX: x, clientY: y } = event;
    const lifted = press.moved;
    if (!press.moved && Math.hypot(x - press.x, y - press.y) >= DRAG_PX) press.moved = true;
    if (!press.moved) return;
    // The press turning into a drag is where the lock says no: a click stays a click, a drag it does not allow ends here.
    if (!this.pressAllowed(press)) { this.cancel(); return; }
    if (!lifted && press.kind === 'token') this.pickUpSound(press);
    if (press.kind === 'rotate') {
      const at = this.boardPoint(x, y);
      if (!at) return;
      let turn = press.startTurn + THREE.MathUtils.radToDeg(Math.atan2(at.y - press.center.y, at.x - press.center.x) - press.startAngle);
      if (event.shiftKey) turn = Math.round(turn / 15) * 15;
      turn = ((turn % 360) + 360) % 360;
      press.turn = turn;
      this.tokens.get(press.id)?.piece.turnMini(turn);
      this.showTip(x, y, `Turn ${Math.round(turn)}° (Shift: steps of 15°)`);
      this.wake(true);
      return;
    }
    if (press.kind === 'camera') {
      const dx = x - press.lastX;
      const dy = y - press.lastY;
      press.lastX = x;
      press.lastY = y;
      const free = this.cinematicDriver?.free;
      if (free) {
        // The authoring camera looks about: a drag with either button turns the view where it stands.
        free.look(dx * ORBIT_X, -dy * ORBIT_Y);
        this.wake();
        return;
      }
      if (press.button === 0 || press.button === 1) this.camera.orbit(-dx * ORBIT_X, -dy * ORBIT_Y);
      else this.panTo(press.grab, x, y);
      // A drag moves the view at once: easing it would leave the board trailing the pointer.
      this.camera.snap();
      this.wake();
      return;
    }
    if (press.kind === 'height' && press.target === 'width') {
      // The width follows the pointer: twice its distance from the wall's middle line, where it is half way up the wall.
      const wall = this.map?.walls.find((candidate) => candidate.id === press.id);
      if (!wall || !this.map) return;
      const tile = this.map.grid.size;
      const frame = segmentFrame(wall.p1, wall.p2);
      this.ray(x, y);
      const hit = this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(this.wallSquares(press.id) * tile) / 2), new THREE.Vector3());
      if (!hit) return;
      const across = Math.abs((hit.x - frame.cx) * -Math.sin(frame.heading) + (hit.z - frame.cy) * Math.cos(frame.heading));
      const value = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(((2 * across) / tile) * 100) / 100));
      this.heightDrag = { target: 'width', id: press.id, value };
      this.updateWalls();
      this.showHandles(press.id, 'width', 'width');
      this.showTip(x, y, `Width ${value} sq (Shift: the whole wall)`);
      this.wake(true);
      return;
    }
    if (press.kind === 'propLift') {
      const value = Math.max(0, Math.round((press.start + (press.y - y) * this.squaresPerPixel()) * 20) / 20);
      press.value = value;
      this.propsVersion += 1;
      this.stackProps();
      this.showPropLine(press.id, true);
      this.showTip(x, y, `Height ${value} sq`);
      this.wake(true);
      return;
    }
    if (press.kind === 'propScale') {
      // Up grows it, down shrinks it, by what the pointer covers on the board; to a twentieth of a cell.
      const value = Math.min(10, Math.max(0.1, Math.round((press.start + (press.y - y) * this.squaresPerPixel()) * 20) / 20));
      press.value = value;
      this.props.get(press.id)?.preview(value);
      this.propsVersion += 1;
      this.showPropHandle(press.id, true);
      this.showTip(x, y, `Scale ${value} cells`);
      this.wake(true);
      return;
    }
    if (press.kind === 'height') {
      // Up raises it, down lowers it, by what the pointer covers on the board; to a twentieth of a square.
      const value = Math.max(0, Math.round((press.start + (press.y - y) * this.squaresPerPixel()) * 20) / 20);
      this.heightDrag = { target: press.target, id: press.id, value };
      if (press.target === 'light') this.applyLighting();
      else { this.updateWalls(); this.showHandles(press.id); }
      const name = press.target === 'sill' ? 'Window bottom' : press.target === 'lintel' ? 'Window top' : 'Height';
      const shown = press.target === 'sill' || press.target === 'lintel' ? this.shownWindow(press.id)?.[press.target === 'sill' ? 'bottom' : 'top'] ?? value : value;
      this.showTip(x, y, `${name} ${shown} sq${press.target === 'light' ? '' : press.target === 'wall' ? ' (Shift: the whole wall)' : ' (Shift: the whole window)'}`);
      this.wake(true);
      return;
    }
    const at = this.surfacePoint(x, y);
    if (!at) return;
    const point = this.clampToBoard(at.x + press.grab.dx, at.y + press.grab.dy);
    if (press.kind === 'token') {
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = point;
        entry.at = { ...point };
      }
      // Over another scene's pill on the height ruler, the token would go to that scene; else to the layer it is over
      // (the one the arrows chose, or below it where that one's floor is see-through).
      const pill = this.audience === 'gm' ? this.layerRuler?.pathAt(x, y) ?? null : null;
      this.updateDragLanding(point);
      this.layerRuler?.dropTarget(pill ?? this.dragLanding?.key ?? null);
      if (press.members) {
        for (const [id, place] of groupFollow(press.members, press.id, point, this.size.width, this.size.height)) {
          const other = this.tokens.get(id);
          if (other && id !== press.id) { other.goal = { ...place }; other.at = { ...place }; }
        }
      }
      this.drawRuler();
    } else {
      this.props.get(press.id)?.place(point.x, point.y);
      this.propsVersion += 1;
    }
    this.wake();
  }

  private up(event: PointerEvent): void {
    const click = this.nameClick;
    this.nameClick = null;
    if (click && Math.hypot(event.clientX - click.x, event.clientY - click.y) < 6) this.showName(click.id);
    if (this.endTouch(event)) return;
    if (this.spellGizmo?.dragging) { this.spellGizmo.release(); this.wake(); return; }
    if (this.eye) { this.eyeDrag = null; return; }
    if (this.shapeEditor?.up()) { this.press = null; return; }
    const press = this.press;
    this.press = null;
    if (press?.kind === 'fog') { this.fogTool?.up(event.clientX, event.clientY, { shift: event.shiftKey, ctrl: event.ctrlKey || event.metaKey }, event.altKey); return; }
    // A handle let go: the table's new place is saved.
    if (press?.kind === 'gizmo') {
      if (this.tablePlacing) { const table = this.placedTable(); if (table) this.host.tablePlaced?.(table); }
      return;
    }
    const { clientX: x, clientY: y } = event;
    // Painting: a click paints the wall under it (Shift: the whole wall), and painting goes on until Esc.
    if (event.button === 0 && this.painting && press?.kind !== 'tool') {
      // A raised shape under the pointer takes the material (or loses it), before the walls behind it.
      const shaped = this.shapePartAt(x, y);
      if (shaped) {
        this.paintShape(shaped.shape, shaped.part, this.painting === UNPAINT ? null : this.painting);
        return;
      }
      const wall = this.wallAt(x, y);
      if (wall) this.host.paintWall(wall, this.painting === UNPAINT ? null : this.painting, event.shiftKey);
      return;
    }
    if (event.button === 0 && this.placing && press?.kind !== 'tool') {
      const at = this.boardPoint(x, y);
      const glb = this.placing;
      const look = this.placingLook;
      this.stopPlacing();
      if (at) this.host.addProp(glb, at.x, at.y, look);
      return;
    }
    if (!press) return;
    if (press.kind === 'laser') { this.wake(); return; }
    if (press.kind === 'water') {
      const saved = Object.fromEntries(LIQUID_KINDS.map((liquid) => {
        const mask = this.liquids.get(liquid)?.mask;
        return [liquid, mask && !mask.empty ? mask.save() : null];
      })) as Record<LiquidKind, SavedWaterMask | null>;
      // While the host keeps it the water it gives is not drawn again (it may refresh the board from within, and its
      // water is a stroke behind until it is kept); once kept, the board shows what the host has.
      this.savingWater += 1;
      const kept = (): void => { this.savingWater -= 1; this.showKeptWater(); };
      let keeping: void | Promise<unknown>;
      try { keeping = this.host.saveWater?.(saved); } catch (error) { kept(); throw error; }
      if (keeping instanceof Promise) void keeping.then(kept, kept); else kept();
      return;
    }
    if (press.kind === 'measureHandle') { this.endMeasureHandle(press, true); return; }
    if (press.kind === 'tool') {
      const at = this.boardPoint(x, y);
      const pendingMeasure = at && press.moved && this.audience === 'gm' && this.tools.tool === 'measure' ? this.tools.overlay().measure : null;
      const actions = at ? this.tools.up(at, this.now(), press.moved) : (this.tools.cancel(), []);
      for (const action of actions) if (action.type === 'laser') this.marks.laser('self', action.points, true, action.color || (this.host.ownColor?.() ?? '#ff0059'), this.clock);
      this.act(actions);
      if (pendingMeasure && at) {
        const opts = this.measureOptions();
        const cell = this.map?.grid.size ?? 70;
        const points = pendingMeasure.shape === 'ruler'
          ? [pendingMeasure.start, ...(pendingMeasure.waypoints ?? []), at]
          : [pendingMeasure.start, at];
        const add: MeasureChange = {
          add: {
            shape: pendingMeasure.shape,
            points,
            ...(pendingMeasure.shape === 'line' ? { width: opts.lineWidth * cell } : {}),
            ...(opts.color ? { color: opts.color } : {}),
            ...(!opts.players ? { hidden: true as const } : {}),
            ...(pendingMeasure.shape !== 'ruler' && opts.effect ? { effect: opts.effect } : {}),
          },
        };
        // As Atlas lets go of a measurement: kept when Keep and Shift differ (the held measure key's ruler counts as Keep off);
        // else it stays two seconds with a pin that keeps it, and dissolves.
        if (releaseKeeps(opts.keep, this.heldRuler !== null, event.shiftKey)) {
          this.released = null;
          this.host.measureAction?.(add);
        } else {
          this.released = { measure: { ...pendingMeasure, end: at }, add, at: this.now(), pin: true };
        }
      }
      this.showToolOverlay();
      return;
    }
    if (press.kind === 'rotate') {
      this.tooltip.hidden = true;
      if (press.moved) this.host.setMiniTurn?.(press.id, press.turn);
      else if (this.audience === 'gm') this.select(press.id);
      this.wake(true);
      return;
    }
    if (press.kind === 'token') {
      this.clearRuler();
      const entry = this.tokens.get(press.id);
      if (!entry) return;
      entry.piece.carried = false;
      for (const member of press.members?.keys() ?? []) { const other = this.tokens.get(member); if (other) other.piece.carried = false; }
      if (!press.moved && press.toggle && this.audience === 'gm') {
        this.toggleGroup(press.id);
        entry.piece.shake(this.clock);
        this.wake(true);
        return;
      }
      if (press.moved && press.copy) {
        this.copyToken(entry, snapPoint(this.snapGrid('tokens'), entry.at.x, entry.at.y, entry.token.size));
        return;
      }
      // Dropped on another scene's pill: the tokens go there (and stand where they were until it is done).
      const pill = this.audience === 'gm' && press.moved ? this.layerRuler?.pathAt(event.clientX, event.clientY) ?? null : null;
      // Let go over another layer (chosen with the arrows, or fallen through a see-through floor): it goes there, where
      // it was let go, and that layer is shown.
      const landing = this.audience === 'gm' && press.moved ? this.dragLanding : null;
      const dropped = pill ?? landing?.key ?? null;
      this.layerRuler?.dropTarget(null);
      if (dropped) {
        const ids = [...new Set([press.id, ...(press.members?.keys() ?? [])])];
        const view = this.layerViews.get(dropped);
        const places: Record<string, { x: number; y: number }> = {};
        for (const id of ids) {
          const carried = this.tokens.get(id);
          if (!carried) continue;
          if (!pill && view) {
            const snapped = snapPoint(this.snapGrid('tokens'), carried.at.x, carried.at.y, carried.token.size);
            places[id] = view.mapPointAt(snapped.x, snapped.y);
          }
          carried.goal = { x: carried.token.x, y: carried.token.y };
        }
        // Set down on another scene: the same sound as any drop, where it was let go here.
        const delays = staggerOffsets(ids.length);
        ids.forEach((id, index) => { const carried = this.tokens.get(id); if (carried) this.putDownSound(carried.at, delays[index]); });
        this.endDragLayer();
        this.host.moveTokensToLayer?.(ids, dropped, pill ? undefined : places, !pill);
        this.wake(true);
        return;
      }
      this.endDragLayer();
      if (!press.moved) {
        // A player's board has no resource controls to open.
        if (this.audience === 'gm') { this.clearGroup(); this.select(press.id); }
        entry.piece.shake(this.clock);
        this.wake(true);
        return;
      }
      if (press.members) {
        const landing = groupLanding(press.members, press.id, entry.at, this.snapGrid('tokens'), this.size.width, this.size.height);
        const moves: Array<{ id: string; x: number; y: number }> = [];
        for (const [id, place] of landing) {
          const other = this.tokens.get(id);
          if (!other) continue;
          other.goal = place;
          moves.push({ id, x: place.x, y: place.y });
        }
        if (this.host.moveTokens) this.host.moveTokens(moves);
        else for (const move of moves) this.host.moveToken(move.id, move.x, move.y);
        this.dropped(moves.map((move) => move.id));
        const delays = staggerOffsets(moves.length);
        moves.forEach((move, index) => this.landImpact(move.id, move, delays[index]));
        this.wake(true);
        return;
      }
      const snapped = snapPoint(this.snapGrid('tokens'), entry.at.x, entry.at.y, entry.token.size);
      entry.goal = snapped;
      this.host.moveToken(press.id, snapped.x, snapped.y);
      this.dropped([press.id]);
      this.landImpact(press.id, snapped);
      this.wake(true);
      return;
    }
    if (press.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece) {
        piece.carried = false;
        if (press.moved) {
          const size = Math.max(1, Math.round(piece.placement.scale));
          const landing = snapPoint(this.snapGrid('props'), piece.object3d.position.x, piece.object3d.position.z, size);
          piece.place(landing.x, landing.y);
          // Dropped last: on a solid prop it stands on top (as the map will have it once saved).
          this.propOrder = [...this.propOrder.filter((other) => other !== press.id), press.id];
          this.propsVersion += 1;
          this.host.moveProp(press.id, landing.x, landing.y);
        } else piece.place(piece.object3d.position.x, piece.object3d.position.z);
      }
      this.wake(true);
      return;
    }
    if (press.kind === 'propLift') {
      this.tooltip.hidden = true;
      this.showPropLine(null);
      if (press.moved && press.value !== press.start) this.host.liftProp?.(press.id, press.value);
      this.propsVersion += 1;
      this.wake(true);
      return;
    }
    if (press.kind === 'propScale') {
      this.tooltip.hidden = true;
      this.showPropHandle(null);
      const piece = this.props.get(press.id);
      if (piece && press.moved && press.value !== press.start) this.host.scaleProp?.(press.id, press.value);
      else piece?.preview(null);
      this.propsVersion += 1;
      this.wake(true);
      return;
    }
    if (press.kind === 'height') {
      const drag = this.heightDrag;
      this.heightDrag = null;
      this.tooltip.hidden = true;
      if (press.moved && drag) {
        if (drag.target === 'wall') this.host.setWallHeight(drag.id, drag.value, event.shiftKey);
        else if (drag.target === 'light') this.host.setLightHeight(drag.id, drag.value);
        else if (drag.target === 'width') this.host.setWallWidth?.(drag.id, drag.value, event.shiftKey);
        else {
          // The span as shown (kept inside the wall), worked out before the drag is let go.
          this.heightDrag = drag;
          const span = this.shownWindow(drag.id);
          this.heightDrag = null;
          if (span) this.host.setWindowSpan?.(drag.id, span, event.shiftKey);
        }
      }
      this.hideHandles();
      this.updateWalls();
      this.applyLighting();
      return;
    }
    if (press.moved) return;
    // The fog tool owns a right-click on fog (and on the ground of fog revealed from it), as in Atlas, where only a door's badge and a pin lie
    // above it; a token stays the token's (the board keeps tokens live under the tool), and a prop, a light or a plain wall give way to the fog.
    const beaten = press.token !== null || press.pin !== null || this.map?.walls.some((wall) => wall.id === press.door && isDoor(wall)) === true;
    if (press.button === 2 && !beaten && this.openFogMenu(event)) return;
    if (press.button === 0 && press.door) {
      this.toggleDoor(press.door);
      return;
    }
    if (press.button === 0 && !press.pin) { this.clearGroup(); this.select(null); }
    if (press.button === 2 && press.token) this.host.tokenMenu(press.token, event);
    else if (press.button === 2 && press.prop) this.host.propMenu(press.prop, event);
    else if (press.button === 2 && press.pin) this.host.pinMenu?.(press.pin, event);
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
    // A second finger or a cancelled pointer: a polygon keeps the corners it has (Atlas's `dropDrag`).
    if (press?.kind === 'fog') { this.fogTool?.dropPress(); return; }
    if (press?.kind === 'measureHandle') { this.endMeasureHandle(press, false); return; }
    if (press?.kind === 'tool') {
      this.tools.cancel();
      this.showToolOverlay();
      return;
    }
    if (press?.kind === 'rotate') {
      // A lost drag leaves the mini turned as it was.
      this.tokens.get(press.id)?.piece.turnMini(press.startTurn);
      this.tooltip.hidden = true;
      this.wake(true);
    } else if (press?.kind === 'token') {
      this.layerRuler?.dropTarget(null);
      this.endDragLayer();
      this.clearRuler();
      const entry = this.tokens.get(press.id);
      if (entry) {
        entry.goal = { x: entry.token.x, y: entry.token.y };
        entry.piece.carried = false;
      }
      for (const member of press.members?.keys() ?? []) {
        const other = this.tokens.get(member);
        if (other) { other.goal = { x: other.token.x, y: other.token.y }; other.piece.carried = false; }
      }
    } else if (press?.kind === 'prop') {
      const piece = this.props.get(press.id);
      if (piece) { piece.carried = false; piece.place(piece.placement.x, piece.placement.y); }
    } else if (press?.kind === 'propLift') {
      this.showPropLine(null);
      this.tooltip.hidden = true;
      this.propsVersion += 1;
    } else if (press?.kind === 'propScale') {
      this.showPropHandle(null);
      this.props.get(press.id)?.preview(null);
      this.tooltip.hidden = true;
    } else if (press?.kind === 'height') {
      // A lost drag leaves the height as it was.
      this.heightDrag = null;
      this.hideHandles();
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
      const next = corners[(i + 1) % corners.length];
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
    const landing = snapPoint(this.snapGrid('tokens'), entry.at.x, entry.at.y, entry.token.size);
    const points = [press.start, ...press.waypoints];
    const last = points[points.length - 1];
    if (Math.hypot(landing.x - last.x, landing.y - last.y) > 0.5) points.push(landing);
    return points.length > 1 ? points : null;
  }

  private addWaypoint(): void {
    const press = this.press;
    if (press?.kind !== 'token' || !this.map) return;
    const entry = this.tokens.get(press.id);
    if (!entry) return;
    const landing = snapPoint(this.snapGrid('tokens'), entry.at.x, entry.at.y, entry.token.size);
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
    // The GM's choice (Atlas 0.15): a drag shows its distance always, only while a fight runs, or never.
    if (!showsDragDistance(this.host.dragDistance?.() ?? 'always', map.initiative.isActive === true)) { this.wake(); return; }
    // Through a spell's difficult terrain each square costs one more: the share of the path in it, counted again.
    const cells = pathLengthInCells(points, map.grid, measurement.diagonalRule) * (1 + this.difficultShare(points));
    // Against the token's speed, in the colour of the step the move lies in, as Atlas's drag ruler reads it.
    const press = this.press;
    const movement = this.host.movement?.() ?? null;
    const speed = movement && press?.kind === 'token' ? movement.speedOf(press.id) : null;
    const look = rulerLook(cells, speed, movement?.rules, measurement);
    const label = look.label;
    this.rulerState = { points, label, color: look.color };
    const group = new THREE.Group();
    group.position.y = 1.2;
    const segments: number[] = [];
    for (let i = 1; i < points.length; i++) segments.push(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
    const color = look.color === null ? accent(this.container) : look.color === BEYOND_SPEED ? errorColor(this.container) : look.color;
    const edge = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.15), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }));
    const line = new THREE.Mesh(stripGeometry(segments, map.grid.size * 0.09), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
    line.position.y = 0.2;
    group.add(edge, line);
    for (const point of points.slice(0, -1)) {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(map.grid.size * 0.14, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      dot.position.set(point.x, 0.4, point.y);
      group.add(dot);
    }
    // The label sits halfway along the path.
    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    let rest = total / 2;
    let middle = points[0];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
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

  /** Shift + Alt + drag let go: the token goes back, and a copy (shown at once) is saved where it was dropped. */
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
    this.putDownSound(at);
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
      const own = (this.host.wallWidth?.(wall.id) ?? 0) * map.grid.size;
      const width = own > 0 ? own : thick;
      obstacles.push({ kind: 'box', x: frame.cx, z: frame.cy, halfLength: (frame.length + width) / 2, halfWidth: width / 2, heading: frame.heading, height });
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

  /** The toolbar's Cutscenes button and live toggle (the GM's only); null takes them away. */
  cinemaButton(handlers: CinemaButtons | null): HTMLElement | null {
    if (this.disposed) return null;
    return this.toolbar.setCinema(this.audience === 'gm' ? handlers : null);
  }

  /** The selected token's Stat sheet drawer, opened from the command palette (the GM's only); null takes it away. Returns whether it is on. */
  sheetButton(handlers: DiceButton | null): boolean {
    if (this.disposed) return false;
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
    // The dice are heard where they are drawn: this board's clack, roll and caught.
    wireDiceSounds(table, this);
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
    const canvas = doc.win.createEl('canvas');
    canvas.className = 'atlas-tabletop-player-board';
    container.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    } catch (error) {
      // A second WebGL context can be refused (a window holds few): the player window stays as it was.
      console.warn('Tabletop: the player window could not get a WebGL context:', error);
      canvas.remove();
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    setLook(renderer, this.quality.painted);
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
    this.player = { container, canvas, renderer, view, resize, frozen: null, shadowsDirty: true, blind: false, tilt: null };
    doc.addEventListener('visibilitychange', this.playersVisibility);
    this.reissueLoops();
    this.toolbar.refresh();
    this.wake(true);
  }

  /** Stops drawing in the local player view's window (it closed, or shows another board). */
  detachPlayer(): void {
    const player = this.player;
    if (!player) return;
    this.player = null;
    this.finishPlayersFade();
    this.playerCinema?.dispose();
    this.playerCinema = null;
    // The held picture was laid over the window that is gone; a window attached again draws live (or is held anew).
    this.playerHeld = null;
    player.container.ownerDocument.removeEventListener('visibilitychange', this.playersVisibility);
    if (!this.disposed) this.reissueLoops();
    player.resize.disconnect();
    player.tilt?.dispose();
    // The lamps' shadow maps are shared with this window's renderer: freed while both renderers are alive, so none keeps a listener that throws later.
    this.rig.releaseShadows();
    for (const view of [...this.layerViews.values(), ...this.parked.values()]) view.releaseShadows();
    // This board's own lamps made their maps again on the next draw.
    if (!this.disposed) {
      this.shadowsDirty = true;
      this.wake(true);
    }
    player.renderer.dispose();
    player.renderer.forceContextLoss();
    player.canvas.remove();
    this.toolbar.refresh();
  }

  /** The player view opened or closed somewhere: the toolbar's buttons follow. */
  /** Fallback Measure tool choices when the host does not persist them (e.g. player board or unit tests). */
  private localMeasureTool: MeasureToolOptions = { ...DEFAULT_MEASURE_TOOL };

  private measureOptions(): MeasureToolOptions {
    return this.host.measureTool?.() ?? this.localMeasureTool;
  }

  private setMeasureOptions(changes: Partial<MeasureToolOptions>): void {
    const next = { ...this.measureOptions(), ...changes };
    this.localMeasureTool = next;
    // Atlas holds the choices where it can (its own toolbar shows the same); the board's copy stands where it cannot.
    this.host.setMeasureTool?.(changes);
    if (changes.mode && isMeasureShape(changes.mode)) {
      this.tools.shape = changes.mode;
    }
    this.toolbar.refresh();
  }

  /** Shows the board's toolbar, as its actions stand now (a player view opened or closed, the undo history changed). */
  refreshToolbar(): void {
    this.toolbar.refresh();
  }

  /**
   * A small picture of the board as a camera at `pose` sees it (a cutscene shot's thumbnail), as a PNG data URL of
   * `width` x `height` pixels; null when it cannot be drawn. The GM's own picture: what the board shows now, from there.
   */
  shotThumbnail(pose: { eye: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }, width: number, height: number): string | null {
    if (this.disposed || !(width > 0) || !(height > 0)) return null;
    const camera = this.view.clone();
    camera.aspect = width / height;
    camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const target = new THREE.WebGLRenderTarget(width, height, { colorSpace: THREE.SRGBColorSpace });
    const pixels = new Uint8Array(width * height * 4);
    const before = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      this.renderer.render(this.scene, camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    } catch (error) {
      console.warn('[Tabletop] A shot thumbnail could not be drawn:', error);
      return null;
    } finally {
      this.renderer.setRenderTarget(before);
      target.dispose();
    }
    const canvas = this.container.ownerDocument.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    // WebGL reads rows bottom up.
    const image = context.createImageData(width, height);
    for (let row = 0; row < height; row++) image.data.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    context.putImageData(image, 0, 0);
    this.wake(true);
    return canvas.toDataURL('image/png');
  }

  /** Cinematic mode: the camera may go anywhere a cinematic shot needs (down to the board's edge, close in, far out). */
  private cameraUnbound = false;

  /** The camera's limits for this map: the board's own, or loosened for Cinematic mode. */
  private cameraLimits(): CameraLimits {
    const base = limitsFor(this.size.width, this.size.height, this.quality.painted);
    return this.cameraUnbound ? { minPitch: 0.02, maxPitch: 1.55, farPitch: 0.02, minDistance: base.minDistance * 0.05, maxDistance: base.maxDistance * 2 } : base;
  }

  /** Lifts the camera's angle and distance limits (Cinematic mode), or puts them back. */
  setCameraUnbound(on: boolean): void {
    if (this.cameraUnbound === on) return;
    this.cameraUnbound = on;
    this.camera.setLimits(this.cameraLimits(), true);
    this.wake(true);
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
    return player.frozen && !this.playersDriven ? { eye: { ...player.frozen.eye }, target: { ...player.frozen.target } } : this.cameraPose();
  }

  /** The camera pose the engine was last told, so it is told again whenever the drawn camera differs (a drag snaps the pose, which `update` does not report as a move). */
  private listened = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, distance: NaN };

  /** Tells the sound engine where the camera is, so sounds are placed against it; nothing is sent while the camera is where it was. */
  private tellListener(): void {
    const engine = this.host.sounds?.();
    if (!engine) return;
    const pose = this.camera.pose;
    const seen = this.listened;
    const { x, y, z } = pose.target;
    if (x === seen.x && y === seen.y && z === seen.z && pose.yaw === seen.yaw && pose.pitch === seen.pitch && pose.distance === seen.distance) return;
    seen.x = x; seen.y = y; seen.z = z; seen.yaw = pose.yaw; seen.pitch = pose.pitch; seen.distance = pose.distance;
    engine.setListener({ eye: positionOf(pose), target: { ...pose.target } }, pose.distance);
  }

  /** Whether this board was on screen when last looked at: a tab behind another is not displayed, and what it draws is not heard (a hidden window is the engine's to silence). */
  private onScreen = true;

  /** Looks once whether the board is on screen (a layout read): at the top of each frame and when the container is resized. */
  private lookOnScreen(): void {
    this.onScreen = this.container.isConnected && this.container.getClientRects().length > 0;
  }

  /**
   * Whether this board is heard now: on screen in a shown window, or driving the local players' window while that is in
   * view (the table hears the GM's machine). The windows' visibility is read live, so a hidden one counts at once.
   */
  private heard(): boolean {
    const players = this.player?.container?.ownerDocument ?? null;
    return boardHeard({ onScreen: this.onScreen, hidden: this.container.ownerDocument.hidden }, players ? { hidden: players.hidden } : null);
  }

  /** The rule handed to the engine with each sound and loop, so it asks this board, not only its own window. */
  private readonly heardRule = (): boolean => this.heard();

  /** Plays a board sound; nothing happens when the host gives no engine (the local player window, a window without audio) or nobody sees the board. */
  sound(id: SoundId, options?: PlayOptions): void {
    if (!this.heard()) return;
    this.host.sounds?.()?.play(id, options, this.heardRule);
  }

  /** The loops the board wants, by key, whether or not it is on screen to play them. */
  private loopsAsked = new Map<string, { id: SoundId; gain: number }>();
  /** Whether the loops were last handed to the engine as playing. */
  private loopsHeard = true;
  /** The engine the loops were handed to, kept so they can be stopped when the board goes, after its host has stopped giving the engine out (a closed tab). */
  private loopEngine: ReturnType<NonNullable<BoardHost['sounds']>> = null;
  /** Makes this board's loop keys its own: boards in one window share an engine, and one going behind a tab must not stop another's loop. */
  private readonly loopPrefix = `board${nextBoardNumber++}:`;

  /** Keeps (or with a null id stops) the looping sound under `key`, at `gain`; a board that is not on screen keeps it silent and plays it when it is shown again. */
  soundLoop(key: string, id: SoundId | null, gain: number): void {
    if (id === null) this.loopsAsked.delete(key);
    else this.loopsAsked.set(key, { id, gain });
    const engine = this.host.sounds?.() ?? null;
    if (engine) this.loopEngine = engine;
    engine?.loop(this.loopPrefix + key, id !== null && !this.loopsWanted() ? null : id, gain, this.heardRule);
  }

  /** Whether the loops are kept going: the board is on screen, or the players' window it drives is open (a hidden window's are eased silent by the engine, by `heard`). */
  private loopsWanted(): boolean {
    return this.onScreen || this.player !== null;
  }

  /** The loops go quiet when the board's tab goes behind another, and come back (eased in by the engine) when it is in front again. */
  private syncLoopsToScreen(): void {
    if (this.loopsWanted() !== this.loopsHeard) this.reissueLoops();
  }

  /** Hands every loop the board wants to the engine again: stopped or kept as `loopsWanted` says, and eased by `heard`. */
  private reissueLoops(): void {
    const wanted = this.loopsWanted();
    this.loopsHeard = wanted;
    const engine = this.host.sounds?.() ?? null;
    if (!engine) return;
    this.loopEngine = engine;
    for (const [key, ask] of this.loopsAsked) engine.loop(this.loopPrefix + key, wanted ? ask.id : null, ask.gain, this.heardRule);
  }

  /** The players' window was shown or hidden: no frame may come to tell the engine (both windows hidden), so the loops are eased now. */
  private readonly playersVisibility = (): void => this.reissueLoops();

  /**
   * The host's engine is another one (the tab moved to another window): this board's loops stop on the old engine and
   * start on the new, and the new one is told where the camera is on the next frame.
   */
  soundEngineChanged(): void {
    for (const key of this.loopsAsked.keys()) this.loopEngine?.loop(this.loopPrefix + key, null, 0);
    this.loopEngine = null;
    this.listened = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, distance: NaN };
    this.reissueLoops();
    this.wake();
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
   * whose centre is under the fog (tokens, Tabletop's props), no cell highlight, the solid fog and their own labels; pins
   * only on a Connect player's own board, which holds just the readable ones (`pinsShown`).
   */
  private showFor(viewer: 'gm' | 'player', window = false): void {
    const gm = viewer === 'gm';
    const fog = this.fog.areas;
    // A cutscene's reveal: players are shown what the GM's view shows, as players draw it (no fog, no sight, hidden tokens still hidden).
    const revealed = this.reveal && !gm;
    this.fog.object3d.visible = !revealed;
    for (const entry of this.tokens.values()) {
      const own = this.eye?.tokenId === entry.token.id;
      entry.piece.object3d.visible = !own && (gm || (revealed ? !entry.token.hidden : playerSees(entry.token, entry.at, fog))) && !this.beyondSight(viewer, `t:${entry.token.id}`)
        // A box the GM covers the map with (Atlas 0.16's solid fill above the tokens) hides what stands under it from players.
        && (gm || !underBox(this.map?.inks ?? [], entry.at));
      entry.labels.object3d.visible = gm && !own;
      entry.playerLabels.object3d.visible = !gm && !own;
    }
    // What the GM hid in Atlas 0.16 (a drawing, a text, a stamp) is the GM's alone.
    for (const piece of this.inks) piece.object3d.visible = gm || !piece.ink.hidden;
    for (const piece of this.texts) piece.object3d.visible = gm || !piece.label.hidden;
    for (const piece of this.icons) piece.show(gm || !piece.icon.hidden);
    const pins = pinsShown(viewer, this.audience);
    // Atlas's session view on the GM's own board shows the pins the GM shares with players (`shownToPlayers`); the players' window none.
    const shared = !gm && !window && this.audience === 'gm';
    for (const pin of this.pins) pin.object3d.visible = (pins || (shared && shownToPlayers(pin.pin))) && !this.pointBeyond(viewer, pin.pin.x, pin.pin.y);
    for (const piece of this.props.values()) piece.object3d.visible = (gm || revealed || !insideFog(fog, { x: piece.object3d.position.x, y: piece.object3d.position.z })) && (gm || !underBox(this.map?.inks ?? [], { x: piece.object3d.position.x, y: piece.object3d.position.z })) && !this.beyondSight(viewer, `p:${piece.id}`);
    if (this.cellOutline) this.cellOutline.visible = gm;
    if (this.cellLabel) this.cellLabel.visible = gm;
    if (this.gmFogOpacity === undefined) this.gmFogOpacity = this.host.fog?.gmOpacity?.() ?? null;
    this.fog.setGmStrength(this.gmFogOpacity);
    this.fog.show(viewer);
    this.walls.show(viewer);
    this.rig.show(viewer);
    // What Atlas keeps from its players (a hidden area, a spell on a token they do not see) is not in their picture.
    this.marks.show(viewer);
    this.areas.show(viewer);
    if (this.castSpells.some((cast) => cast.gmOnly)) {
      const secret = new Set(this.castSpells.filter((cast) => cast.gmOnly).map((cast) => cast.id));
      for (const [id, kept] of this.spellViews) kept.view.object3d.visible = gm || !secret.has(id);
    } else if (this.secretSpells) for (const kept of this.spellViews.values()) kept.view.object3d.visible = true;
    this.secretSpells = this.castSpells.some((cast) => cast.gmOnly);
    if (this.gizmo) this.gizmo.object3d.visible = gm;
    // The unseen squares: the players' view always, or the point of view being previewed on the GM's board.
    this.veilPov.object3d.visible = gm && this.povSight !== null;
    this.veilSight.object3d.visible = !revealed && this.sight !== null && !gm;
    // The GM's player window shows one scene at a time: what is stacked on it is the GM's. A Connect player's own board
    // shows the scenes stacked with theirs, which Connect sends (their form, never what stands on them).
    // Under sight (a point of view on the GM's board, or a player's board) the scenes stacked above
    // are blacked out as shadows, and the ones below stay.
    // The GM's own board in session view keeps the scenes stacked on it, as a player's board does.
    const ownBoard = !gm && (this.audience === 'player' || !window);
    const sighted = !revealed && ((gm && this.povSight !== null) || (ownBoard && this.sight !== null));
    for (const view of this.layerViews.values()) {
      view.setVisible(gm || ownBoard);
      view.setBlackout(sighted && view.elevation > 0);
    }
  }

  /** The players' picture, after the GM's: the same scene through the players' camera, then back to the GM's look. */
  private drawPlayers(shadows: boolean, gm: PoseContext): void {
    const player = this.player;
    if (!player) return;
    // Dressed first: a fade of the window alone runs its course even while the window has no size.
    this.dressPlayers(player);
    const height = player.container.clientHeight;
    const width = player.container.clientWidth;
    if (width === 0 || height === 0) return;
    // Held: the window keeps the picture laid over it (see `holdPlayers`); nothing is drawn under it meanwhile.
    if (this.playerHeld && this.playerHold) return;
    const pose = this.camera.pose;
    // A cutscene's camera is every player's: where the GM froze theirs does not count meanwhile.
    const frozen = this.playersDriven ? null : player.frozen;
    const eye = frozen?.eye ?? this.camera.position();
    const target = frozen?.target ?? pose.target;
    player.view.position.set(eye.x, eye.y, eye.z);
    player.view.lookAt(target.x, target.y, target.z);
    player.view.aspect = width / height;
    player.view.near = this.view.near;
    player.view.far = this.view.far;
    player.view.updateProjectionMatrix();
    player.view.updateMatrixWorld();
    this.aimCutaway(eye, target);
    const distance = frozen?.distance ?? pose.distance;
    const context: PoseContext = {
      ...gm,
      yaw: frozen?.yaw ?? pose.yaw,
      zoom: height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)),
      pixel: screenScale(1, height, FOV),
    };
    this.showFor('player', true);
    // Only the thrower sees the dice tumble: never the players' screen. Nor the AR players' eyes: those are the GM's.
    if (this.dice) this.dice.object3d.visible = false;
    this.viewers.object3d.visible = false;
    this.tableOutlines.visible = false;
    try {
      for (const entry of this.tokens.values()) entry.playerLabels.pose(context);
      player.renderer.shadowMap.needsUpdate = shadows || player.shadowsDirty;
      player.shadowsDirty = false;
      // A camera inside the fog sees nothing at all: the players' picture is black.
      player.blind = !this.reveal && this.fog.hides(player.view.position, (point) => insideFog(this.fog.areas, point));
      if (player.blind) {
        player.renderer.setClearColor(0x000000, 1);
        player.renderer.clear();
      } else {
        this.fog.face(player.view.position);
        if (postFxOn(this.quality)) {
          player.tilt ??= new PostFx(player.renderer, this.quality.antialias);
          player.tilt.render(this.scene, player.view, this.looks());
        } else {
          player.renderer.render(this.scene, player.view);
        }
      }
      // The frame is taken right after it is drawn, while the canvas still holds it.
      if (this.playerHold && !this.playerHeld) this.holdFrame(player);
    } catch (error) {
      console.error('[Tabletop] The player view could not be drawn:', error);
    } finally {
      // Whatever happened, the GM's board goes back to its own look: the GM's, or Atlas's session view.
      this.showFor(this.sessionView ? 'player' : 'gm');
      if (this.dice) this.dice.object3d.visible = true;
      this.viewers.object3d.visible = true;
      this.tableOutlines.visible = true;
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
    if (this.allows('camera')) this.camera.lookAt({ x: entry.goal.x, y: 0, z: entry.goal.y });
    this.select(id);
    this.wake();
  }

  /**
   * After a stroke was kept (or refused): where the host's water is the water painted, nothing is drawn again; where
   * it is not (Atlas's limits gave something up, a liquid the brush may not change was erased over, the stroke was
   * refused), the board draws what the host has. Not during the next stroke, which ends here again.
   */
  private showKeptWater(): void {
    const map = this.map;
    if (this.disposed || !map || this.savingWater > 0 || this.press?.kind === 'water') return;
    const source = this.host.water?.() ?? null;
    const same = LIQUID_KINDS.every((liquid) => {
      const kept = this.size.width > 0 ? maskOfSource(source, this.size.width, this.size.height, map.grid.size, liquid) : null;
      return sameWet(kept, this.liquids.get(liquid)?.mask ?? null);
    });
    if (same) { this.waterKey = waterKeyOf(source); return; }
    this.loadWater(map);
    this.toolbar.refresh();
    this.wake();
  }

  /** The map's saved liquids, each drawn over its floor (none of a liquid it has none of and none is being painted). */
  private loadWater(map: BoardMap): void {
    for (const surface of this.liquids.values()) surface.dispose();
    this.liquids.clear();
    this.waterLoopsAt = -Infinity;
    this.chosenWaterMotion = {};
    const saved = this.host.water?.() ?? null;
    this.waterKey = waterKeyOf(saved);
    // A bare board (the leanest memory) draws no liquids.
    if (!saved || !this.size || this.quality.bare) return;
    const motions = motionsOf(saved);
    for (const liquid of LIQUID_KINDS) {
      const mask = maskOfSource(saved, this.size.width, this.size.height, map.grid.size, liquid);
      if (mask) this.showWater(mask, motions[liquid], liquid);
    }
  }

  private showWater(mask: WaterMask, motion: WaterMotion, liquid: LiquidKind): WaterSurface {
    const surface = new WaterSurface(mask, this.size?.width ?? 1, this.size?.height ?? 1, this.map?.grid.size ?? 70, motion, liquid);
    this.liquids.get(liquid)?.dispose();
    this.liquids.set(liquid, surface);
    this.scene.add(surface.object3d);
    return surface;
  }

  /** Whether any painted liquid needs frames to move. */
  private get liquidsMoving(): boolean {
    for (const surface of this.liquids.values()) if (surface.moving) return true;
    return false;
  }

  /** The brush's liquid's sheet, made (empty) to paint into when the map has none of it yet. */
  private brushSheet(map: BoardMap): WaterSurface {
    const liquid = this.brushLiquid;
    return this.liquids.get(liquid) ?? this.showWater(WaterMask.forMap(this.size.width, this.size.height, map.grid.size), this.motionOf(liquid), liquid);
  }

  /**
   * The water brush's outline: a ring of the brush's size under the pointer, in the accent colour while painting and
   * red while erasing; hidden while the brush is off or the pointer is off the board.
   */
  private showBrush(): void {
    const cell = this.map?.grid.size ?? 70;
    const radius = this.waterBrush * cell;
    const at = this.waterTool && this.waterTool !== 'fill' ? this.brushAt : null;
    if (!at) {
      if (this.brushRing?.visible) { this.brushRing.visible = false; this.wake(); }
      return;
    }
    if (!this.brushRing) {
      this.brushRing = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      this.brushRing.renderOrder = 20;
      this.brushRing.raycast = () => {};
      this.scene.add(this.brushRing);
    }
    const ring = this.brushRing;
    if (this.brushRingRadius !== radius) {
      const width = Math.min(radius * 0.5, Math.max(1.5, cell * 0.07));
      ring.geometry.dispose();
      ring.geometry = new THREE.RingGeometry(radius - width, radius, 96).rotateX(-Math.PI / 2);
      this.brushRingRadius = radius;
    }
    (ring.material as THREE.MeshBasicMaterial).color.set(this.waterTool === 'erase' ? '#ff5a5a' : accent(this.container));
    ring.position.set(at.x, 0.5, at.y);
    ring.visible = true;
    this.wake();
  }

  /** The map's colours at the water mask's texels (white where it has no image). */
  private mapColors(mask: WaterMask): Uint8ClampedArray | null {
    const key = `${mask.width}x${mask.height}`;
    if (this.fillColors?.key === key) return this.fillColors.colors;
    const canvas = this.container.ownerDocument.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, mask.width, mask.height);
    const source = this.fillSource;
    if (source) {
      context.setTransform(1 / mask.texel, 0, 0, 1 / mask.texel, 0, 0);
      context.transform(...source.transform);
      context.drawImage(source.image, 0, 0, source.width, source.height);
    }
    let colors: Uint8ClampedArray;
    try {
      colors = context.getImageData(0, 0, mask.width, mask.height).data;
    } catch {
      this.host.warn('Tabletop: the bucket cannot read the map image.');
      return null;
    }
    this.fillColors = { key, colors };
    return colors;
  }

  /** The walls (and shut doors) as texels the bucket does not cross. */
  private fillWalls(mask: WaterMask): Uint8Array {
    const blocked = new Uint8Array(mask.width * mask.height);
    const canvas = this.container.ownerDocument.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return blocked;
    context.strokeStyle = '#000';
    context.lineCap = 'round';
    context.lineWidth = 1.5;
    for (const wall of this.map?.walls ?? []) {
      if ((wall.type === 'door' || wall.type === 'secret-door') && !wall.closed) continue;
      context.beginPath();
      context.moveTo(wall.p1.x / mask.texel, wall.p1.y / mask.texel);
      context.lineTo(wall.p2.x / mask.texel, wall.p2.y / mask.texel);
      context.stroke();
    }
    const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
    for (let k = 0; k < blocked.length; k++) if (pixels[k * 4 + 3]! > 0) blocked[k] = 1;
    return blocked;
  }

  /** The bucket: fills the area of the map's colour joined to a point with water (or, with Shift, dries it). */
  private fillWater(at: { x: number; y: number }, wet: boolean): void {
    const map = this.map;
    if (!map || !this.size) return;
    if (!wet && !this.liquids.has(this.brushLiquid)) return;
    const water = this.brushSheet(map);
    const colors = this.mapColors(water.mask);
    if (!colors) return;
    // 0 takes only the colour clicked, 100 a long way off it (the farthest two colours are 441 apart).
    const tolerance = (this.waterFill / 100) * 200;
    if (water.mask.fill(at.x, at.y, colors, tolerance, wet, this.fillWalls(water.mask))) {
      water.maskChanged();
      this.waterLoopsAt = -Infinity;
      // One liquid at a place: what was filled is no longer any other.
      if (wet) for (const [liquid, other] of this.liquids) if (liquid !== this.brushLiquid && other.mask.dryUnder(water.mask)) other.maskChanged();
    }
    this.wake();
  }

  /**
   * Stacks the props: in the map's order, each stands on the top of the solid props before it under its middle (the
   * one carried on the solid props under it, holding up nothing while it is carried).
   */
  private stackProps(): void {
    this.stackedVersion = this.propsVersion;
    const order = [...this.propOrder.filter((id) => this.props.has(id)), ...[...this.props.keys()].filter((id) => !this.propOrder.includes(id))];
    const carried = this.press?.kind === 'prop' ? this.press.id : null;
    const below: THREE.Object3D[] = [];
    const ray = this.standRay;
    const standOn = (piece: PropPiece, under: THREE.Object3D[]): number => {
      if (under.length === 0) return 0;
      ray.set(new THREE.Vector3(piece.object3d.position.x, 1e5, piece.object3d.position.z), new THREE.Vector3(0, -1, 0));
      ray.far = 2e5;
      const hit = ray.intersectObjects(under, true)[0];
      return hit ? Math.max(0, hit.point.y) : 0;
    };
    for (const id of order) {
      if (id === carried) continue;
      const piece = this.props.get(id)!;
      piece.setBase(standOn(piece, below) + this.liftOf(piece));
      piece.object3d.updateWorldMatrix(true, true);
      if (piece.placement.solid && piece.body) below.push(piece.body);
    }
    const held = carried ? this.props.get(carried) : null;
    if (held) { held.setBase(standOn(held, below) + this.liftOf(held)); held.object3d.updateWorldMatrix(true, true); }
  }

  /** How high a prop stands over what is under it, in world units: its own height (as dragged). */
  private liftOf(piece: PropPiece): number {
    if (!this.map) return 0;
    const press = this.press;
    const squares = press?.kind === 'propLift' && press.id === piece.id ? press.value : piece.placement.lift ?? 0;
    return squares * this.map.grid.size;
  }

  /** How high the top of the solid props under a token's middle is (0: none there, the floor). Kept until it moves or the props change. */
  /** The layer a carried token is over (`key` null: the scene played), at what height; null when not carrying one. */
  private dragLanding: { key: string | null; elevation: number } | null = null;
  /** The layer the arrows chose while carrying (null: the scene played), and the look it had before it was shown solid. */
  private dragLayer: string | null = null;
  private dragLayerLook: { key: string; look: LayerLook } | null = null;

  /** The floors a carried token may go to: the scene played (key null) and each layer shown, low to high. */
  private dragFloors(): Array<{ key: string | null; elevation: number; view: ElevationLayerView | null }> {
    const floors: Array<{ key: string | null; elevation: number; view: ElevationLayerView | null }> = [{ key: null, elevation: 0, view: null }];
    for (const [key, view] of this.layerViews) {
      if (this.host.layerHidden?.(key) === true) continue;
      floors.push({ key, elevation: view.elevation, view });
    }
    return floors.sort((a, b) => a.elevation - b.elevation);
  }

  /** Whether the scene played has ground at a map point (its picture there not see-through). */
  private groundHere(x: number, y: number): boolean {
    const background = this.map?.background;
    if (!background || this.size.width <= 0 || this.size.height <= 0) return true;
    const texture = this.floorTextureNow(background);
    const picture = texture?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!picture) return true;
    return opaqueAt(picture, x / this.size.width, y / this.size.height) ?? true;
  }

  /** Where a token carried to `point` would land: the floor chosen, or the first below it with ground there. */
  private updateDragLanding(point: { x: number; y: number }): void {
    if (this.audience !== 'gm' || (this.layerViews.size === 0 && this.dragLayer === null)) { this.dragLanding = null; return; }
    const floors = this.dragFloors();
    let index = Math.max(0, floors.findIndex((floor) => floor.key === this.dragLayer));
    for (; index > 0; index--) {
      const floor = floors[index]!;
      const ground = floor.view ? floor.view.groundAt(point.x, point.y, opaqueAt) : this.groundHere(point.x, point.y);
      if (ground) break;
    }
    // The lowest floor has the last say: something stands there.
    const floor = floors[index]!;
    if (floor.key === null && !this.groundHere(point.x, point.y)) {
      // The scene played is see-through here: the first floor below with ground.
      for (let below = index - 1; below >= 0; below--) {
        const lower = floors[below]!;
        if (lower.view?.groundAt(point.x, point.y, opaqueAt)) { this.dragLanding = { key: lower.key, elevation: lower.elevation }; this.wake(true); return; }
      }
    }
    const next = floor.key === null ? null : { key: floor.key, elevation: floor.elevation };
    if (JSON.stringify(next) !== JSON.stringify(this.dragLanding)) { this.dragLanding = next; this.wake(true); }
  }

  /** The arrows while carrying: the layer above (+1) or below (-1), shown solid while it is chosen. */
  private stepDragLayer(direction: number): void {
    const floors = this.dragFloors();
    const at = Math.max(0, floors.findIndex((floor) => floor.key === this.dragLayer));
    const next = floors[Math.max(0, Math.min(floors.length - 1, at + direction))]!;
    if (next.key === this.dragLayer) return;
    this.restoreDragLook();
    this.dragLayer = next.key;
    // A layer above shown faded or hidden is shown whole while a token is carried to it.
    if (next.view && next.key) {
      this.dragLayerLook = { key: next.key, look: next.elevation > 0 ? this.quality.layerLook : 'solid' };
      next.view.restyle('solid');
    }
    const entry = this.press?.kind === 'token' ? this.tokens.get(this.press.id) : undefined;
    if (entry) this.updateDragLanding(entry.at);
    this.layerRuler?.dropTarget(this.dragLanding?.key ?? null);
    this.showTip(this.pointerAt?.x ?? 0, this.pointerAt?.y ?? 0, next.key === null ? 'This scene' : `To ${this.layerName(next.key)} (let go to move it there)`);
    this.wake(true);
  }

  private restoreDragLook(): void {
    const kept = this.dragLayerLook;
    this.dragLayerLook = null;
    if (kept) this.layerViews.get(kept.key)?.restyle(kept.look);
  }

  /** Carrying ended: the layers look as they did. */
  private endDragLayer(): void {
    this.restoreDragLook();
    this.dragLayer = null;
    this.dragLanding = null;
  }

  /** A layer's name as the height ruler shows it. */
  private layerName(key: string): string {
    return this.layerMenuItems.find((item) => item.path === key)?.name ?? key.replace(/^.*[/:]/, '').replace(/\.[^.]+$/, '');
  }

  /**
   * How far over its floor a token's figure stands, in map pixels: its height (Atlas 0.15, `liftOf`) in squares. A token
   * below the floor (a negative height: burrowing) is drawn on it, as the board has nothing under the map to show.
   */
  private heightLift(token: { elevation: number }): number {
    const grid = this.map?.grid.size ?? 70;
    return Math.max(0, liftOf(token, this.host.measurement())) * grid;
  }

  /**
   * The height (game units) of the token a measure's point lies on, for Atlas's `riseBetweenEnds`: the shown token
   * whose footprint holds the point (the first found), else 0, the floor.
   */
  private heightAt(point: { x: number; y: number }): number {
    const grid = this.map?.grid;
    if (!grid) return 0;
    for (const entry of this.tokens.values()) {
      if (!showing(entry.piece.object3d) || (this.audience === 'player' && entry.token.hidden)) continue;
      const radius = ringDiameter(grid, entry.token.size) / 2;
      if (Math.hypot(point.x - entry.at.x, point.y - entry.at.y) <= radius) return entry.token.elevation;
    }
    return 0;
  }

  private standAt(entry: { at: { x: number; y: number }; stand?: { x: number; y: number; version: number; value: number } }): number {
    // Carried over another layer: it hovers at that layer's floor.
    if (this.dragLanding && this.press?.kind === 'token' && (this.press.id === (entry as { token?: { id: string } }).token?.id || this.press.members?.has((entry as { token?: { id: string } }).token?.id ?? ''))) {
      return this.dragLanding.elevation * (this.map?.grid.size ?? 50);
    }
    const kept = entry.stand;
    if (kept && kept.version === this.propsVersion && Math.abs(kept.x - entry.at.x) < 0.5 && Math.abs(kept.y - entry.at.y) < 0.5) return kept.value;
    const bodies: THREE.Object3D[] = [];
    for (const piece of this.props.values()) if (piece.placement.solid && piece.body) { piece.object3d.updateWorldMatrix(true, true); bodies.push(piece.body); }
    let value = 0;
    if (bodies.length > 0) {
      this.standRay.set(new THREE.Vector3(entry.at.x, 1e5, entry.at.y), new THREE.Vector3(0, -1, 0));
      this.standRay.far = 2e5;
      const hit = this.standRay.intersectObjects(bodies, true)[0];
      if (hit) value = Math.max(0, hit.point.y);
    }
    // On a raised shape (a roof, a hill) it stands on its surface.
    const cell = this.map?.grid.size ?? 50;
    for (const shape of this.drawnShapes) {
      const h = shapeHeightAt(shape, entry.at.x, entry.at.y);
      if (h !== null) value = Math.max(value, h * cell);
    }
    entry.stand = { x: entry.at.x, y: entry.at.y, version: this.propsVersion, value };
    return value;
  }

  /** Paints (or erases) the water brush along a drag, from one board point to the next. */
  private paintWater(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const map = this.map;
    if (!map || !this.size || !this.waterTool) return;
    const wet = this.waterTool === 'paint';
    const radius = this.waterBrush * map.grid.size;
    // The eraser takes every liquid away; the brush paints its own and takes the others away under it.
    for (const [liquid, other] of this.liquids) if ((!wet || liquid !== this.brushLiquid) && other.mask.stroke(from, to, radius, false)) { other.maskChanged(); this.waterLoopsAt = -Infinity; }
    if (wet) {
      const water = this.brushSheet(map);
      if (water.mask.stroke(from, to, radius, true)) { water.maskChanged(); this.waterLoopsAt = -Infinity; }
    }
    this.wake();
  }

  /** What the board's toolbar controls do. */
  toolbarActions(): ToolbarActions {
    return this.toolbar.boardActions;
  }

  /** Toolbar command host for Atlas's command palette: reads available buttons and switches mode before opening them. */
  toolbarCommandHost(): ToolbarCommandHost {
    return {
      state: () => this.toolbar.toolbarState(),
      goTo: (id) => this.toolbar.goTo(id),
    };
  }

  /** Switches mode if needed and opens or activates the toolbar button `id`. */
  goToToolbar(id: string): boolean {
    return this.toolbar.goTo(id);
  }

  /**
   * Whether the board itself has a use for this key now, before Atlas's shortcuts: the Shapes tool (Enter, Delete,
   * Backspace), the view through a token's eyes, or a token being carried (Space, the arrows and Page Up/Down).
   */
  ownsKey(event: KeyboardEvent): boolean {
    if (this.eye) return true;
    if (this.shapeEditor?.active === true && ['Enter', 'Delete', 'Backspace'].includes(event.key)) return true;
    return this.press?.kind === 'token' && ['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '].includes(event.key);
  }

  /** Atlas's Fit token key: the camera frames the selected token (the selection's first). False without one. */
  frameToken(): boolean {
    const id = this.selectedId ?? this.group.values().next().value ?? null;
    const entry = id === null ? undefined : this.tokens.get(id);
    if (!entry || !this.allows('camera')) return false;
    const cell = this.map?.grid.size ?? 50;
    this.camera.frame({ x: entry.at.x, y: 0, z: entry.at.y }, cell * Math.max(2, entry.token.size * 2));
    this.wake();
    return true;
  }

  /**
   * Atlas's level keys: shows the scene of the stack next above (1) or below (-1) the one shown, passing over those the GM
   * hid. False when there is none that way.
   */
  stepLevel(direction: 1 | -1): boolean {
    const items = [...this.layerMenuItems].sort((a, b) => a.elevation - b.elevation);
    const at = items.findIndex((item) => item.active);
    if (at < 0 || !this.host.switchLayer) return false;
    for (let index = at + direction; index >= 0 && index < items.length; index += direction) {
      const item = items[index]!;
      if (this.host.layerHidden?.(item.path) === true) continue;
      this.host.switchLayer(item.path);
      return true;
    }
    return false;
  }

  /** Atlas's Select all key: every token of the shown scene is selected (the GM's). False when there are fewer than two. */
  selectAll(): boolean {
    if (this.audience !== 'gm' || this.tokens.size === 0) return false;
    if (this.tokens.size === 1) { this.select(this.tokens.keys().next().value ?? null); return true; }
    this.select(null);
    this.group.clear();
    for (const id of this.tokens.keys()) this.group.add(id);
    this.drawGroup();
    this.wake();
    return true;
  }

  /** The tokens of the shown scene that are selected: the group, else the selected one. */
  selectedTokenIds(): string[] {
    const picked = this.group.size > 0 ? [...this.group] : this.selectedId !== null ? [this.selectedId] : [];
    return picked.filter((id) => this.tokens.has(id));
  }

  /** Atlas's Delete key: the selected tokens leave the map (the GM's, one undo step). False with nothing selected. */
  deleteSelection(): boolean {
    // A kept measurement under the pointer, or whose popover is open, goes before anything selected does (Atlas).
    if (this.deleteMeasureByKey()) return true;
    if (this.audience !== 'gm' || !this.host.removeTokens) return false;
    const ids = this.selectedTokenIds();
    if (ids.length === 0) return false;
    this.clearGroup();
    this.select(null);
    this.host.removeTokens(ids);
    return true;
  }

  /** Text selected on the page: Atlas's Copy and Cut leave the key to the browser's own copy then (`yieldsToTextSelection`). */
  private textSelected(): boolean {
    const selection = this.canvas.ownerDocument.getSelection();
    return selection !== null && !selection.isCollapsed && selection.toString().trim() !== '';
  }

  /**
   * Atlas's Copy key: the selected tokens go on the clipboard (the GM's). True when the key is the board's (as in Atlas,
   * even with nothing selected), false when it was left to selected page text or this is not the GM's board.
   */
  copySelection(): boolean {
    if (this.audience !== 'gm' || !this.host.copyTokens || this.textSelected()) return false;
    const ids = this.selectedTokenIds();
    if (ids.length > 0) void this.host.copyTokens(ids);
    return true;
  }

  /** Atlas's Cut key: Copy, then the selected tokens leave the map in one undo step. */
  cutSelection(): boolean {
    if (this.audience !== 'gm' || !this.host.cutTokens || this.textSelected()) return false;
    const ids = this.selectedTokenIds();
    if (ids.length === 0) return true;
    this.clearGroup();
    this.select(null);
    void this.host.cutTokens(ids);
    return true;
  }

  /**
   * Atlas's Paste key: the copied tokens land centred on the point under the pointer, else on the middle of the view, and
   * the copies are selected. True when the key is the board's.
   */
  pasteSelection(): boolean {
    if (this.audience !== 'gm' || !this.host.pasteTokens) return false;
    const at = this.pointerAt ? this.boardPoint(this.pointerAt.x, this.pointerAt.y) : null;
    this.host.pasteTokens(at ?? this.viewCentre()).then((ids) => { if (ids.length > 0) this.selectTokens(ids); }, () => {});
    return true;
  }

  /** Atlas's Duplicate key: copies of the selected tokens one cell aside, selected afterwards (one undo step). True when the key is the board's. */
  duplicateSelection(): boolean {
    if (this.audience !== 'gm' || !this.host.duplicateTokens) return false;
    const ids = this.selectedTokenIds();
    if (ids.length > 0) this.host.duplicateTokens(ids).then((copies) => { if (copies.length > 0) this.selectTokens(copies); }, () => {});
    return true;
  }

  /** A token (or ruler measurement) is being dragged (Space then drops a waypoint). */
  get carryingToken(): boolean {
    return this.press?.kind === 'token' || (this.press?.kind === 'tool' && this.tools.tool === 'measure' && this.tools.shape === 'ruler');
  }

  /** Atlas's command palette tool, which Tabletop Settings opens on its page. */
  private atlasPalette: AtlasToolButton | null = null;

  /** Shows Atlas's toolbar tools on the board's toolbar (the GM's; src/board/atlasTools.ts). */
  setAtlasTools(tools: readonly AtlasToolButton[]): void {
    this.atlasPalette = tools.find((tool) => tool.id === 'palette') ?? null;
    if (this.audience === 'gm') this.toolbar.setAtlasTools(tools);
  }

  /** Atlas's keyboard shortcuts button in its bar beside the toolbar (the GM's); null takes it away. */
  setHelp(help: ToolbarHelp | null): void {
    if (this.audience === 'gm') this.toolbar.setHelp(help);
  }

  /** The point of the map the camera looks at (the centre of the view), in map pixels. */
  viewCentre(): { x: number; y: number } {
    const target = this.camera.pose.target;
    return { x: target.x, y: target.z };
  }

  /** Tokens waiting to be selected until they stand on the board (`selectTokens` of tokens not read yet). */
  private pendingSelection: string[] | null = null;

  /** Selects these tokens (one is the selected token, several a group); tokens not on the board yet wait for it. */
  selectTokens(ids: readonly string[]): void {
    if (!ids.every((id) => this.tokens.has(id))) { this.pendingSelection = [...ids]; return; }
    this.group.clear();
    if (ids.length === 1) this.select(ids[0] ?? null);
    else {
      for (const id of ids) this.group.add(id);
      this.select(null);
    }
    this.drawGroup();
  }

  /** The camera goes to a point of the map, selecting nothing. */
  /**
   * Sees through a token's eyes (null goes back to the usual camera): the camera stands at its eye height and follows
   * it, turned by the phone's gyroscope when `gyro` (the caller asked for it) and by a drag. False for a token not here.
   */
  seeFrom(tokenId: string | null, gyro = false): boolean {
    if (tokenId !== null && !this.allows('eyes')) return false;
    if (tokenId !== null && this.tokens.has(tokenId)) this.eyesLocked = null;
    this.eye?.dispose();
    this.eye = null;
    this.eyeTurn = null;
    this.eyeDrag = null;
    if (tokenId === null || !this.tokens.has(tokenId)) {
      this.lockPointer(false);
      this.caster?.show(false);
      // The caster closed: a spell's review still waiting goes with it.
      this.rulePanel?.dismiss();
      // The GM's toolbar back, after the eyes.
      if (this.audience === 'gm') this.toolbar.setHidden(false);
      this.toolbar.refresh();
      this.view.near = this.baseNear;
      this.view.updateProjectionMatrix();
      this.wake(true);
      return tokenId === null;
    }
    this.eye = new EyeView(tokenId, this.camera.pose.yaw, gyro, this.container.ownerDocument.defaultView ?? window, () => this.wake());
    // The keys (Escape, F) go to the board from the start.
    this.canvas.focus({ preventScroll: true });
    // Players, and the GM through anyone's eyes, cast spells there; the GM's toolbar makes way for the spell toolbar.
    this.caster ??= this.makeCaster();
    this.caster.show(true);
    if (this.audience === 'gm') this.toolbar.setHidden(true);
    this.toolbar.refresh();
    // Close by, the walls must not be clipped away.
    this.view.near = Math.max(0.5, (this.map?.grid.size ?? 50) * 0.02);
    this.view.updateProjectionMatrix();
    this.wake(true);
    return true;
  }

  /** Two fingers down: what was being done with one stops, and the spot between them is held under them. */
  private startPinch(): void {
    if (this.press) this.cancel();
    this.eyeDrag = null;
    if (!this.allows('camera')) return;
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = { grab: this.eye ? null : this.boardPoint(mid.x, mid.y), spread: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }

  /** Two fingers moving: apart zooms in, together out, and the view slides with them (through a token's eyes, neither). */
  private movePinch(): void {
    const pinch = this.pinch;
    const [a, b] = [...this.touches.values()];
    if (!pinch || !a || !b || this.eye || !this.allows('camera') || this.cinematicDriver?.free) return;
    const spread = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    this.camera.zoom(pinch.spread / spread);
    pinch.spread = spread;
    this.camera.snap();
    this.panTo(pinch.grab, (a.x + b.x) / 2, (a.y + b.y) / 2);
    this.camera.snap();
    this.wake();
  }

  /** A finger lifted: true while a pinch is still on (the last finger lifting ends it), so the lift starts nothing. */
  private endTouch(event: PointerEvent): boolean {
    if (event.pointerType !== 'touch' || !this.touches.delete(event.pointerId)) return false;
    if (!this.pinch) return false;
    if (this.touches.size === 0) this.pinch = null;
    this.press = null;
    return true;
  }

  /**
   * Augmented reality: draws the board from the phone camera's tracked pose over the printed sheet, over the camera's
   * picture (see-through where the board is not); null goes back to the usual camera. False for a pose it cannot use.
   */
  setAugmented(view: AugmentedView | null): boolean {
    if (view !== null && !isAugmentedView(view)) return false;
    // While a cutscene has the camera the view is kept as the latest and not drawn; it is drawn when the lock ends.
    this.arLatest = view;
    if (!this.allows('ar')) return true;
    this.applyAugmented(view);
    return true;
  }

  /** Puts the augmented-reality look on for `view`, or takes it off for null (the lock calls it with null without forgetting the latest view). */
  private applyAugmented(view: AugmentedView | null): void {
    const was = this.augmented !== null;
    this.augmented = view;
    // The camera's picture, when the page draws it in: the same picture the pose was found for, so the two never part.
    const source = view?.background ?? null;
    if (source) {
      if (!this.arTexture || this.arSource !== source) {
        this.arTexture?.dispose();
        this.arTexture = new THREE.CanvasTexture(source as HTMLCanvasElement);
        this.arTexture.colorSpace = THREE.SRGBColorSpace;
        this.arSource = source;
      } else {
        this.arTexture.needsUpdate = true;
      }
    } else if (this.arTexture) {
      if (this.scene.background === this.arTexture) this.scene.background = null;
      this.arTexture.dispose();
      this.arTexture = null;
      this.arSource = null;
    }
    if (view && !was) {
      this.seeFrom(null);
      if (this.renderer.getPixelRatio() < 1) { this.renderer.setPixelRatio(1); this.fit(); }
      const old = this.scene.background;
      this.scene.background = null;
      if (old instanceof THREE.Texture && old !== this.arTexture) old.dispose();
      this.backdropKey = '';
      this.applyHorizon();
    } else if (!view && was) {
      this.renderer.setClearColor(0x000000, 1);
      this.view.near = this.baseNear;
      this.view.updateProjectionMatrix();
      this.applyHorizon();
      this.paintDaylight();
    }
    if (this.arTexture) this.scene.background = this.arTexture;
    if ((view !== null) !== was) this.toolbar.refresh();
    this.wake(!view || !was);
  }

  /** Whether the camera's picture shows round the board: augmented reality on a marker sheet, or room tracking. */
  private get seeThrough(): boolean {
    return this.augmented !== null || this.room !== null;
  }

  /**
   * Room tracking: draws the board into a WebXR immersive AR session (the page asked for it in the player's tap).
`   * `onFrame` hears each of the session's frames first (the page looks for the table there). The board shows once
`   * placed (`placeRoomAr`). Ends with the session.
   */
  async startRoomAr(session: XRSession, onFrame: ((frame: XRFrame, space: XRReferenceSpace | null) => void) | null): Promise<boolean> {
    if (this.room || this.disposed || !this.allows('ar')) return false;
    this.setAugmented(null);
    this.seeFrom(null);
    const rig = new THREE.Group();
    rig.matrixAutoUpdate = false;
    this.room = { session, rig, onFrame, far: this.view.far };
    this.toolbar.refresh();
    try {
      const xr = this.renderer.xr;
      xr.enabled = true;
      xr.setReferenceSpaceType('local');
      // Half the screen's resolution each way: the session's own is the phone's full screen, several times what the
      // board draws on a phone otherwise.
      xr.setFramebufferScaleFactor(0.5);
      await xr.setSession(session);
    } catch (error) {
      this.room = null;
      this.renderer.xr.enabled = false;
      throw error;
    }
    if (this.frameId !== 0) this.frameWin?.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    rig.add(this.view);
    // The room is in metres: a centimetre to a hundred metres ahead.
    this.view.near = 0.01;
    this.view.far = 100;
    this.scene.visible = false;
    const old = this.scene.background;
    this.scene.background = null;
    if (old instanceof THREE.Texture) old.dispose();
    this.backdropKey = '';
    this.applyHorizon();
    session.addEventListener('end', () => this.endRoom());
    this.roomTimes = { frames: 0, interval: 0, work: 0, errors: 0, lastError: '', last: 0 };
    this.renderer.setAnimationLoop((time, frame) => {
      const room = this.room;
      if (!room) return;
      const times = this.roomTimes;
      const started = performance.now();
      if (times.last > 0) times.interval += (time - times.last - times.interval) * 0.1;
      times.last = time;
      try {
        if (frame) room.onFrame?.(frame, this.renderer.xr.getReferenceSpace());
        this.frame(time);
      } catch (error) {
        times.errors++;
        times.lastError = error instanceof Error ? error.message : String(error);
        if (times.errors <= 3) console.error('[Tabletop] Room tracking frame:', error);
      }
      times.frames++;
      times.work += (performance.now() - started - times.work) * 0.1;
    });
    this.shadowsDirty = true;
    return true;
  }

  /**
`   * Room tracking: stands the board on the table at `place` (a point of the room, in metres, and which way the map's up
   * faces), at its size on the table; null hides it (not placed yet).
   */
  placeRoomAr(place: RoomPlace | null): void {
    const room = this.room;
    if (!room || !this.map) return;
    if (!place) { this.scene.visible = false; return; }
    const anchor = this.augmentedAnchor(place.anchor);
    const matrix = roomPlacement(place, this.map.grid.size, anchor);
    if (!matrix) return;
    room.rig.matrix.copy(matrix);
    room.rig.matrixWorldNeedsUpdate = true;
    this.scene.visible = true;
  }

  /** Ends room tracking (its session). */
  stopRoomAr(): void {
    const room = this.room;
    if (!room) return;
    room.session.end().catch(() => this.endRoom());
  }

  /** Room tracking's frame times (milliseconds, eased): between frames, and spent drawing one; and errors met. */
  roomStats(): { frames: number; intervalMs: number; workMs: number; errors: number; lastError: string } | null {
    if (!this.room) return null;
    const times = this.roomTimes;
    return { frames: times.frames, intervalMs: times.interval, workMs: times.work, errors: times.errors, lastError: times.lastError };
  }

  /**
   * Where the phone's camera is in augmented reality, in board units, and which way it looks (down its −z): what the
   * GM's board shows as this player's eye. Null when the board is not drawn over the camera, or not placed yet.
   */
  arViewer(): ViewerPose | null {
    if (this.room ? !this.scene.visible : !this.augmented || !this.map) return null;
    if (this.room) this.room.rig.updateMatrixWorld(true);
    else this.view.updateMatrixWorld();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    this.view.matrixWorld.decompose(position, quaternion, new THREE.Vector3());
    const pose: ViewerPose = { position: [position.x, position.y, position.z], quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w] };
    return isViewerPose(pose) ? pose : null;
  }

  /** Whether room tracking draws the board. */
  get isRoomAr(): boolean {
    return this.room !== null;
  }

  /** The session ended: the board takes the page's canvas and its usual camera again. */
  private endRoom(): void {
    const room = this.room;
    if (!room) return;
    this.room = null;
    this.toolbar.refresh();
    this.renderer.setAnimationLoop(null);
    this.renderer.xr.enabled = false;
    room.rig.remove(this.view);
    this.view.near = this.baseNear;
    this.view.far = room.far;
    this.view.updateProjectionMatrix();
    this.scene.visible = true;
    this.renderer.setClearColor(0x000000, 1);
    this.applyHorizon();
    this.paintDaylight();
    this.fitted = { width: 0, height: 0, ratio: 0 };
    this.fit();
    this.wake(true);
  }

  /** Whether the board is drawn in augmented reality. */
  get isAugmented(): boolean {
    return this.augmented !== null;
  }

  /** The board point on the printed sheet's middle: the token `anchor`, or the map's middle. */
  private augmentedAnchor(anchor: string | null): { x: number; y: number; z: number } {
    // On the table: the lowest scene of the stack's floor. A scene stacked higher (the one shown, too) stands above it.
    const base = Math.min(0, ...this.stackData.map((layer) => layer.elevation)) * (this.map?.grid.size ?? 0);
    const entry = anchor === null ? undefined : this.tokens.get(anchor);
    if (entry) return { x: entry.at.x, y: base, z: entry.at.y };
    return { x: this.size.width / 2, y: base, z: this.size.height / 2 };
  }

  /** Shows a token's name, large (null: hides the one shown). */
  private showName(id: string | null): void {
    if (id === this.namedId) return;
    const before = this.namedId ? this.tokens.get(this.namedId) : undefined;
    before?.labels.setNamed(false);
    before?.playerLabels.setNamed(false);
    this.namedId = id;
    const entry = id ? this.tokens.get(id) : undefined;
    entry?.labels.setNamed(true);
    entry?.playerLabels.setNamed(true);
    this.wake();
  }

  /** The token whose name shows, or null: for a look in tests. */
  get namedToken(): string | null {
    return this.namedId;
  }

  /** Leaves the token's eyes by the board's own doing (Escape, Leave): Connect is told. */
  private leaveEyes(): void {
    this.seeFrom(null);
    this.host.eyeChanged?.();
    this.host.toolsChanged?.();
  }

  /** Holds the mouse for the eyes (a mouse only; a finger drags), or lets go of it. */
  private lockPointer(on: boolean): void {
    const doc = this.canvas.ownerDocument;
    if (on) {
      if (!this.eye || this.lastPointer !== 'mouse' || doc.pointerLockElement === this.canvas) return;
      try {
        const asked = this.canvas.requestPointerLock?.() as unknown;
        if (asked instanceof Promise) asked.catch(() => undefined);
      } catch {
        // Refused (too soon after Escape, say): the next click asks again.
      }
    } else if (doc.pointerLockElement === this.canvas) {
      this.lockReleasing = true;
      doc.exitPointerLock();
    }
  }

  /** The mouse held or let go: Escape letting go steps back out of an aimed spell, else leaves the eyes. */
  private lockChanged(): void {
    const locked = this.canvas.ownerDocument.pointerLockElement === this.canvas;
    const was = this.pointerLocked;
    this.pointerLocked = locked;
    const released = was && !locked && !this.lockReleasing;
    if (!locked) this.lockReleasing = false;
    if (released && this.eye) {
      if (this.caster?.busy) this.caster.back(); else this.leaveEyes();
    }
    this.caster?.refresh();
  }

  private makeCaster(): SpellCaster {
    return new SpellCaster({
      root: this.container,
      cell: () => this.map?.grid.size ?? 50,
      coneAngle: () => this.tools.coneAngle,
      caster: () => this.eye?.tokenId ?? null,
      eye: () => {
        const at = this.eyeAt();
        return at && this.eyeTurn ? { position: new THREE.Vector3(at.x, at.y, at.z), turn: this.eyeTurn.clone() } : null;
      },
      aim: () => this.spellAim(),
      preview: (spell) => this.previewSpell(spell, this.caster?.currentRules ?? null),
      cast: (spell, request, rules, words) => { this.host.playerAction?.({ type: 'spell', change: { add: spell, ...(request !== undefined ? { request } : {}), ...(rules ? { rules } : {}), ...(words ? { name: words.name, ...(words.about ? { about: words.about } : {}) } : {}) } }); return true; },
      decline: (request) => this.host.playerAction?.({ type: 'spell', change: { decline: request } }),
      enter: (tokenId) => this.enterForAsk(tokenId),
      tokenName: (tokenId) => this.tokens.get(tokenId)?.token.name ?? 'your token',
      hasOwn: () => { const me = this.spellOwner(); return me !== null && this.castSpells.some((cast) => cast.owner === me); },
      clearOwn: () => {
        // Whoever clears takes only their own (the GM's board takes the GM's off Atlas's measures in one step).
        this.host.playerAction?.({ type: 'spell', change: { clear: true } });
      },
      locked: () => this.pointerLocked,
      lock: (on) => this.lockPointer(on),
      handles: (spell) => this.spellHandles(spell),
      touch: () => this.lastPointer !== 'mouse',
      leave: () => this.leaveEyes(),
      // A new cast begun: the reviews of the casts before it go.
      began: () => this.rulePanel?.dismiss(),
      wake: () => this.wake(),
      book: () => this.host.spellBook?.() ?? null,
      unitDistance: () => feetPerSquare(this.host.measurement()),
    });
  }

  /**
   * Cast through a token's eyes (the GM's Cast, Myself): into them, and the spell search open where there are spell
   * notes, else the shapes to pick. False when the token is not on the board.
   */
  castThrough(tokenId: string): boolean {
    if (!this.tokens.has(tokenId)) return false;
    if (this.eye?.tokenId !== tokenId) {
      if (!this.seeFrom(tokenId, false)) return false;
      this.host.eyeChanged?.();
      this.host.toolsChanged?.();
    }
    if (!this.caster?.openSearch()) this.caster?.open();
    return true;
  }

  /** The spell toolbar through the eyes: for tests. */
  get spellCaster(): SpellCaster | null {
    return this.caster;
  }

  /** The GM's ask panel, while open. */
  private askPicker: SpellPicker | null = null;

  /**
   * The GM asks a token's player for a spell (Cast, Player): the spell search over the board, the spell picked drawn
   * at the token, as it would go; Send hands the ask over, Take back (when one waits) withdraws it.
   */
  askSpellPanel(tokenId: string, options: { title: string; note?: string; send(ask: SpellAsk): void; withdraw?: () => void }): SpellPicker | null {
    const book = this.host.spellBook?.() ?? null;
    if (!book || !this.tokens.has(tokenId)) return null;
    this.askPicker?.close();
    const cell = this.map?.grid.size ?? 50;
    const picker = new SpellPicker(this.container, {
      book, title: options.title, ...(options.note ? { note: options.note } : {}), cell: () => cell,
      unitDistance: () => feetPerSquare(this.host.measurement()),
      changed: (ask) => { this.previewSpell(ask ? this.spellAtToken(tokenId, ask) : null, ask?.rules ?? null); },
      actions: [
        { label: 'Send to the player', primary: true, run: (ask) => { picker.close(); options.send(ask); } },
        ...(options.withdraw ? [{ label: 'Take back the ask', warning: true, run: () => { picker.close(); options.withdraw?.(); } }] : []),
        { label: 'Cancel', run: () => picker.close() },
      ],
      closed: () => { if (this.askPicker === picker) this.askPicker = null; this.previewSpell(null); },
    });
    this.askPicker = picker;
    return picker;
  }

  /** An ask's shape at a token, for its preview: from its eyes the way the view looks, or centred on it. */
  private spellAtToken(tokenId: string, ask: SpellAsk): Spell | null {
    const entry = this.tokens.get(tokenId);
    if (!entry) return null;
    const box = new THREE.Box3().setFromObject(entry.piece.fall);
    const eye = box.isEmpty() ? 0 : box.min.y + (box.max.y - box.min.y) * 0.85;
    const yaw = this.camera.pose.yaw;
    const common = {
      shape: ask.shape, yaw, pitch: 0, roll: 0, size: ask.size, length: ask.length, angle: ask.angle ?? this.tools.coneAngle, caster: tokenId,
      ...(ask.effect ? { effect: ask.effect } : {}),
    };
    if (ask.shape === 'wall') {
      const run = ask.longest ?? ask.size * 4;
      return { ...common, from: 'point', at: { x: entry.at.x, y: entry.at.y, h: 0 }, to: { x: entry.at.x - Math.sin(yaw) * run, y: entry.at.y - Math.cos(yaw) * run }, yaw: 0 };
    }
    if (ask.from === 'self') return { ...common, from: 'self', at: { x: entry.at.x, y: entry.at.y, h: eye } };
    return { ...common, from: 'point', at: { x: entry.at.x, y: entry.at.y, h: 0 }, pitch: ask.shape === 'cylinder' ? Math.PI / 2 : 0 };
  }

  /** Whose spells are this board's own: the player's, or the GM's. */
  private spellOwner(): string | null {
    return this.audience === 'gm' ? GM_SPELL_OWNER : this.tools.selfId;
  }

  /** The point under the crosshair (the middle of the view): the first thing drawn there, else the floor. */
  private spellAim(): THREE.Vector3 | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), this.view);
    const own = this.eye ? this.tokens.get(this.eye.tokenId)?.piece.object3d : undefined;
    const under = (object: THREE.Object3D, root: THREE.Object3D | undefined): boolean => {
      for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === root || node.userData.spell === true) return true;
      return false;
    };
    for (const hit of ray.intersectObjects(this.scene.children, true)) {
      const mesh = hit.object as THREE.Mesh;
      if (!mesh.isMesh || mesh.userData.noOutline === true || !showing(mesh) || under(mesh, own)) continue;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.every((material) => material.visible === false || (material.transparent && material.opacity < 0.99))) continue;
      return hit.point.clone();
    }
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  /** Puts the handles round the spell set at a point (null: takes them away). */
  private spellHandles(spell: Spell | null): void {
    if (!spell) {
      this.spellGizmo?.dispose();
      this.spellGizmo = null;
      this.canvas.style.cursor = '';
      this.wake();
      return;
    }
    if (!this.spellGizmo) {
      this.spellGizmo = new SpellGizmo();
      this.scene.add(this.spellGizmo.object3d);
    }
    this.spellGizmo.place(spell, this.view);
    this.wake();
  }

  /** Whether the spell hovered is one Alt would clear (the GM's), rather than one Ctrl only shows. */
  private spellClearing = false;
  /** The spell's card shown with Ctrl over it: its name and words, like a creature's stat block. */
  private spellCard: HTMLElement | null = null;
  private spellCardFor: string | null = null;

  /**
   * The pointer over a spell: with Ctrl/Cmd its card shows (its name, level line, properties and words), with Alt (the
   * GM in Play mode) it lights up and a click clears it. A token under the pointer comes first: its own stat block.
   */
  private spellHoverAt(event: PointerEvent): void {
    const clearing = this.audience === 'gm' && event.altKey;
    const showing = event.ctrlKey || event.metaKey;
    // A creature under the pointer comes first for Ctrl (its stat block); Alt clears the spell under it all the same.
    if (!(clearing || showing) || this.editing || this.press || this.spellViews.size === 0 || (!clearing && this.tokenAt(event.clientX, event.clientY) !== null)) {
      this.hoverSpell(null);
      this.showSpellCard(null, event);
      return;
    }
    this.ray(event.clientX, event.clientY);
    let best: { id: string; distance: number } | null = null;
    for (const [id, kept] of this.spellViews) {
      const distance = kept.view.hit(this.raycaster);
      if (distance !== null && (!best || distance < best.distance)) best = { id, distance };
    }
    this.spellClearing = clearing;
    this.hoverSpell(best?.id ?? null);
    if (best && clearing) this.showTip(event.clientX, event.clientY, 'Alt+click to clear this spell');
    this.showSpellCard(best && !clearing ? best.id : null, event);
  }

  /** The card of the cast `id` by the pointer, or none. */
  private showSpellCard(id: string | null, event: { clientX: number; clientY: number }): void {
    const cast = id ? this.castSpells.find((each) => each.id === id) : undefined;
    if (!cast) {
      this.spellCard?.remove();
      this.spellCard = null;
      this.spellCardFor = null;
      return;
    }
    if (this.spellCardFor !== cast.id || !this.spellCard) {
      this.spellCard?.remove();
      const doc = this.container.ownerDocument;
      const card = doc.createElement('div');
      card.className = 'atlas-tabletop-spellcard is-hover';
      const name = cast.name ?? cast.rules?.name ?? 'Spell';
      const about = cast.about ?? { line: spellLabel(cast.spell, this.map?.grid.size ?? 50), properties: cast.rules ? [['Effects', rulesWords(cast.rules)] as [string, string]] : [], text: '' };
      card.append(aboutElement(doc, name, about));
      this.container.append(card);
      this.spellCard = card;
      this.spellCardFor = cast.id;
    }
    const box = this.container.getBoundingClientRect();
    const card = this.spellCard;
    const x = event.clientX - box.left + 16;
    const y = event.clientY - box.top + 16;
    card.style.left = `${Math.max(8, Math.min(x, box.width - card.offsetWidth - 8))}px`;
    card.style.top = `${Math.max(8, Math.min(y, box.height - card.offsetHeight - 8))}px`;
  }

  /** The id of the spell whose card shows (for tests). */
  get spellCardShown(): string | null {
    return this.spellCardFor;
  }

  private hoverSpell(id: string | null): void {
    if (id === this.hoveredSpell) {
      this.canvas.style.cursor = id && this.spellClearing ? 'pointer' : this.canvas.style.cursor === 'pointer' ? '' : this.canvas.style.cursor;
      return;
    }
    if (this.hoveredSpell) this.spellViews.get(this.hoveredSpell)?.view.highlight(false);
    if (id === null && this.hoveredSpell !== null) this.tooltip.hidden = true;
    this.hoveredSpell = id;
    if (id) this.spellViews.get(id)?.view.highlight(true);
    this.canvas.style.cursor = id && this.spellClearing ? 'pointer' : this.canvas.style.cursor === 'pointer' ? '' : this.canvas.style.cursor;
    this.wake();
  }

  /** What a spell may hit: the tokens and props shown (to a player, only those in sight), by points of their boxes. */
  private spellTargets(): Array<SpellTarget & { name: string; root: THREE.Object3D }> {
    const out: Array<SpellTarget & { name: string; root: THREE.Object3D }> = [];
    const player = this.audience === 'player';
    for (const entry of this.tokens.values()) {
      if (player && (!showing(entry.piece.object3d) || entry.token.hidden)) continue;
      const box = new THREE.Box3().setFromObject(entry.piece.fall);
      if (box.isEmpty()) continue;
      out.push({ id: entry.token.id, points: boxPoints(box), name: entry.token.name ?? 'Token', root: entry.piece.fall });
    }
    for (const piece of this.props.values()) {
      if (player && !showing(piece.object3d)) continue;
      const box = new THREE.Box3().setFromObject(piece.object3d);
      if (box.isEmpty()) continue;
      out.push({ id: `prop:${piece.id}`, points: boxPoints(box), name: propName(piece.placement.glb), root: piece.object3d });
    }
    return out;
  }

  /** Draws the spell being cast (null: none) and names what it hits. */
  private previewSpell(spell: Spell | null, rules: SpellRules | null = null): string[] {
    const key = spell ? JSON.stringify(spell) : '';
    // What the spell does shows while it is aimed too: a stone wall stone, a fog grey, a light glowing.
    const rulesKey = rules ? JSON.stringify(rules) : '';
    if (this.spellPreview && this.spellPreviewRules !== rulesKey) {
      this.spellPreview.view.setRules(rules);
      this.spellPreviewRules = rulesKey;
      this.wake();
    }
    // The same shape only moved or turned (aiming it): the drawing moves, not made again.
    if (spell && this.spellPreview && this.spellPreview.key !== key && this.spellPreview.view.fits(spell)) {
      this.spellPreview.view.moveTo(spell, this.map?.walls ?? [], this.wallsLook());
      this.spellPreview = { ...this.spellPreview, key, spell };
      this.spellHitsAt = 0;
      this.wake();
    }
    if ((this.spellPreview?.key ?? '') !== key) {
      this.spellPreview?.view.dispose();
      this.spellPreview = null;
      if (spell) {
        const view = new SpellView(spell, this.host.ownColor?.() ?? '#7c5cff', this.map?.walls ?? [], 0.45, this.map?.grid.size ?? 50, { plain: true, look: this.wallsLook() });
        view.setRules(rules);
        this.spellPreviewRules = rulesKey;
        this.scene.add(view.object3d);
        this.spellPreview = { key, view, spell };
      }
      this.spellHitsAt = 0;
      this.wake();
    }
    if (!spell) return [];
    const targets = this.spellTargets();
    const hits = new Set(spellHits(spell, targets, this.map?.walls ?? [], this.wallsLook()));
    return targets.filter((target) => hits.has(target.id)).map((target) => target.name);
  }

  /** Into a token's eyes for the GM's ask of it (a click on Aim): Connect is told, as by its own eye button. */
  private enterForAsk(tokenId: string): boolean {
    if (!this.tokens.has(tokenId)) return false;
    if (this.eye?.tokenId !== tokenId) {
      if (!this.seeFrom(tokenId, false)) return false;
      this.host.eyeChanged?.();
      this.host.toolsChanged?.();
    }
    return true;
  }

  /**
   * The scene's spells, from Connect: each drawn in its caster's colour, what it hits outlined; and the GM's asks.
   * `scene` is the scene the list is for (Connect's scene id on a player's board, the map's path on the GM's): its
   * first list only seeds what stands there, whether or not the board has loaded that scene's map yet. `standing` are
   * spells that stand though they are not in the list (on a level not shown): what they summoned is not offered for removal.
   */
  receiveSpells(scene: string, list: readonly unknown[], asks: readonly unknown[] = [], standing: readonly string[] = []): void {
    this.standingCasts = new Set(standing);
    if (this.audience === 'player') {
      const requests = readSpellRequests(asks).filter((request) => this.tokens.has(request.tokenId));
      if (requests.length > 0 || this.caster) {
        this.caster ??= this.makeCaster();
        this.caster.ask(requests);
      }
    }
    this.castSpells = readCastSpells(list);
    this.noteCasts(scene);
    this.drawSpells();
    if (this.audience === 'gm') this.landSpells();
    this.spellHitsAt = 0;
    this.caster?.refresh();
    this.wake();
  }

  private drawSpells(): void {
    const walls = this.map?.walls ?? [];
    const wanted = new Set<string>();
    const announced = this.newCasts;
    for (const cast of this.castSpells) {
      wanted.add(cast.id);
      const key = JSON.stringify([cast.spell, cast.color, cast.rules ?? null]);
      const kept = this.spellViews.get(cast.id);
      if (kept?.key === key) continue;
      kept?.view.dispose();
      const view = new SpellView(cast.spell, cast.color, walls, 0.4, this.map?.grid.size ?? 50, { look: this.wallsLook() });
      view.setRules(cast.rules);
      if (announced.has(cast.id)) {
        // Newly cast: it grows into place, with its damage's sound where it stands (not when it is out of sight).
        view.grow(0);
        this.growingSpells.set(cast.id, this.spellClock());
        if (!this.spellHidden(cast.spell)) this.sound(spellImpactSound(cast.spell.effect), { at: this.spellSpot(cast.spell) });
        this.wake();
      } else if (!this.growingSpells.has(cast.id)) view.grow(1);
      else view.grow(Math.min(1, (this.spellClock() - this.growingSpells.get(cast.id)!) * 1000 / GROW_MS));
      this.scene.add(view.object3d);
      this.spellViews.set(cast.id, { key, view, instant: isInstantaneous(cast) });
    }
    for (const id of [...this.growingSpells.keys()]) if (!wanted.has(id)) this.growingSpells.delete(id);
    this.newCasts = new Set();
    for (const [id, kept] of this.spellViews) {
      if (wanted.has(id)) continue;
      this.spellViews.delete(id);
      // An instantaneous spell taken off (after its cast) fades out; any other goes at once.
      if (kept.instant && this.spellMap === this.map) { this.fadingSpells.push({ view: kept.view, start: this.spellClock() }); this.wake(); } else kept.view.dispose();
    }
    this.applyRules();
  }

  /** Forgets what was seen of the spells when a list for another scene comes: its first list only seeds them. The map catching up later forgets nothing. */
  private syncCastScene(scene: string): void {
    if (scene === this.castScene) return;
    this.castScene = scene;
    this.announcedCasts = null;
    this.growingSpells.clear();
    this.newCasts = new Set();
  }

  /**
   * Notes the casts a spell list brings. The first list a scene gets, whenever it arrives, only seeds what is seen: its
   * spells are already standing, whole and silent. Each list after announces the ids new to it.
   */
  private noteCasts(scene: string): void {
    this.syncCastScene(scene);
    const ids = this.castSpells.map((cast) => cast.id);
    this.newCasts = new Set(castsToAnnounce(this.announcedCasts ?? new Set(), this.announcedCasts === null, ids));
    this.announcedCasts = new Set(ids);
  }

  /** Where a spell is heard: the middle of a wall, else its anchor (board space, y up). */
  private spellSpot(spell: Spell): { x: number; y: number; z: number } {
    const to = spell.to;
    return { x: to ? (spell.at.x + to.x) / 2 : spell.at.x, y: spell.at.h + (spell.shape === 'wall' ? spell.length / 2 : 0), z: to ? (spell.at.y + to.y) / 2 : spell.at.y };
  }

  /**
   * Whether this board does not show a spell's anchor: on a player's board, under the fog or on a square nobody in
   * sight sees. (The spell's drawing is not cut by the fog, but its sound is not heard from there.)
   */
  private spellHidden(spell: Spell): boolean {
    if (this.audience !== 'player') return false;
    const spot = this.spellSpot(spell);
    return insideFog(this.fog.areas, { x: spot.x, y: spot.z }) || this.pointBeyond('player', spot.x, spot.z);
  }

  /**
   * Keeps one loop per damage type going for the lasting spells seen on the board, at the loudest level any of them is
   * heard from the camera (reach: six cells); a type with none left is stopped.
   */
  private updateSpellLoops(): void {
    const cell = this.map?.grid.size ?? 50;
    const pose = this.camera.pose;
    // Only the shown scene's spells loop: none from the last scene's list while the new one has not come, nor from a new
    // scene's list while its map is still loading.
    const shown = this.map !== null && this.castScene === this.map.path;
    const lasting = this.castSpells
      .filter((cast) => shown && !isInstantaneous(cast) && this.spellViews.has(cast.id) && !this.spellHidden(cast.spell))
      .map((cast) => ({ id: cast.id, effect: cast.spell.effect ?? null, at: this.spellSpot(cast.spell), lasting: true }));
    const gains = spellLoopGains(lasting, { eye: positionOf(pose), target: { ...pose.target } }, 6 * cell);
    const wanted = new Map([...gains].map(([id, gain]) => [`spell:${id.replace('spell.loop.', '')}`, { id, gain }]));
    for (const key of [...this.spellLoops.keys()]) {
      if (wanted.has(key)) continue;
      this.spellLoops.delete(key);
      this.soundLoop(key, null, 0);
    }
    for (const [key, next] of wanted) {
      const kept = this.spellLoops.get(key);
      if (kept && kept.id === next.id && Math.abs(kept.gain - next.gain) < 0.005) continue;
      this.spellLoops.set(key, next);
      this.soundLoop(key, next.id, next.gain);
    }
  }

  /**
   * Keeps one loop per motion kind of the painted water on the board (the scene's, and that of the layers shown),
   * heard at the level of the kind's nearest water to where the camera looks (reach: eight cells), as loud as the camera
   * is close. Worked out when the camera has moved and once a second (or at once, after `waterLoopsAt` is cleared).
   */
  private updateWaterLoops(): void {
    const win = this.container.ownerDocument.defaultView ?? window;
    const now = win.performance.now();
    const pose = this.camera.pose;
    const seen = this.waterLoopsSeen;
    const moved = pose.target.x !== seen.x || pose.target.z !== seen.z || pose.distance !== seen.distance || pose.yaw !== seen.yaw || pose.pitch !== seen.pitch;
    if (!moved && now - this.waterLoopsAt < 1000) return;
    this.waterLoopsAt = now;
    seen.x = pose.target.x; seen.z = pose.target.z; seen.distance = pose.distance; seen.yaw = pose.yaw; seen.pitch = pose.pitch;
    const cell = this.map?.grid.size ?? 50;
    // By liquid and motion: `lava:flow`.
    const reach = new Map<string, number>();
    const note = (liquid: LiquidKind, kind: WaterMotionKind, distance: number): void => {
      const key = `${liquid}:${kind}`;
      reach.set(key, Math.min(reach.get(key) ?? Infinity, distance));
    };
    if (this.size) {
      for (const [liquid, surface] of this.liquids) {
        const distance = waterDistance(surface.mask, this.size.width, this.size.height, { x: pose.target.x, y: pose.target.z });
        if (distance !== Infinity) note(liquid, surface.currentMotion.kind, distance);
      }
    }
    for (const view of this.layerViews.values()) {
      for (const near of view.waterReach(pose.target.x, pose.target.z)) note(near.liquid, near.kind, near.distance);
    }
    // How loud the camera's height makes the water it looks at (the same for every kind): full close up, quieter from twenty cells and more away.
    const listener = { eye: positionOf(pose), target: { ...pose.target } };
    const heard = reach.size > 0 ? placeAt(listener, { ...pose.target }, WATER_SPAN_CELLS * cell).gain : 0;
    const wanted = new Map<string, { id: SoundId; gain: number }>();
    for (const [key, distance] of reach) {
      const [liquid, kind] = key.split(':') as [LiquidKind, WaterMotionKind];
      wanted.set(key, { id: liquidLoop(liquid, kind), gain: nearness(distance, 8 * cell) * heard });
    }
    for (const key of [...this.waterLoops.keys()]) {
      if (wanted.has(key)) continue;
      this.waterLoops.delete(key);
      this.soundLoop(key, null, 0);
    }
    for (const [key, next] of wanted) {
      const kept = this.waterLoops.get(key);
      if (kept && kept.id === next.id && Math.abs(kept.gain - next.gain) < 0.005) continue;
      this.waterLoops.set(key, next);
      this.soundLoop(key, next.id, next.gain);
    }
  }

  /** The page's clock, seconds (what spells are animated by). */
  private spellClock(): number {
    return (this.container.ownerDocument.defaultView ?? window).performance.now() / 1000;
  }

  /** The walls, lights and darkness the cast spells' rules make, worked out again when the spells or the scale change. */
  private applyRules(): void {
    const map = this.map;
    const measurement = this.host.measurement();
    const unitDistance = measurement.unitDistance > 0 ? measurement.unitDistance : 5;
    const cell = map?.grid.size ?? 50;
    const unitsPerFoot = unitDistance / feetPerSquare(measurement);
    const ruled = this.castSpells.filter((cast) => cast.rules);
    const key = JSON.stringify([unitsPerFoot, cell, ruled.map((cast) => [cast.id, cast.spell, cast.rules])]);
    if (key === this.ruleKey) return;
    this.ruleKey = key;
    this.ruleWalls = ruled.flatMap((cast) => spellRuleWalls(cast.id, cast.spell, cast.rules));
    this.ruleLights = ruled.flatMap((cast) => spellRuleLights(cast.id, cast.spell, cast.rules, unitsPerFoot, cell / unitDistance));
    // Difficult ground: a tangle drawn over the floor the spell covers.
    for (const decal of this.ruleDecals) { decal.removeFromParent(); decal.geometry.dispose(); (decal.material as THREE.Material).dispose(); }
    this.ruleDecals = ruled.filter((cast) => cast.rules?.difficult).map((cast) => {
      const decal = difficultGround(spellFootprint(cast.spell).ring, cell, this.container.ownerDocument);
      decal.position.y = 0.6;
      this.scene.add(decal);
      return decal;
    });
    this.sightKey = '';
    this.applyLighting();
    this.wake();
  }

  /** The casts this board has seen (null before the first list: those already there are not carried out again). */
  private seenCasts: Set<string> | null = null;
  /** The tokens each summoning spell made, by its id: offered for removal when the spell goes. */
  private readonly summoned = new Map<string, string[]>();
  private rulePanel: SpellRulePanel | null = null;

  /** The review of what spells do to tokens, over the board (for tests). */
  get spellRules(): SpellRulePanel {
    return (this.rulePanel ??= new SpellRulePanel(this.container));
  }

  /** Spells that stand though the list does not have them (on a level of the map not shown). */
  private standingCasts: ReadonlySet<string> = new Set();

  /**
   * Another scene, or another level of it: its spells already cast are not carried out again, and the next list only
   * seeds what stands there (none is announced as newly cast).
   */
  forgetCasts(): void {
    this.seenCasts = null;
    this.announcedCasts = null;
    this.growingSpells.clear();
    this.newCasts = new Set();
  }

  /** Newly cast spells that move or make tokens: carried out (a push after the GM's review). Gone summons: offered for removal. */
  private landSpells(): void {
    const present = new Set(this.castSpells.map((cast) => cast.id));
    if (this.seenCasts === null) { this.seenCasts = present; return; }
    // A cast gone from the list is forgotten: its id may come back as another spell (a new session's, a reopened board's).
    for (const id of [...this.seenCasts]) if (!present.has(id)) this.seenCasts.delete(id);
    for (const cast of this.castSpells) {
      if (this.seenCasts.has(cast.id)) continue;
      this.seenCasts.add(cast.id);
      const rules = cast.rules;
      if (!rules || !(rules.push || rules.teleport || rules.summon)) continue;
      // Claimed by its id and where it stands: the same cast sent again is not carried out twice, a new one of the same id is.
      if (!this.host.claimSpell?.(`${cast.id}|${JSON.stringify(cast.spell)}`)) continue;
      this.landSpell(cast);
    }
    for (const [id, tokens] of [...this.summoned]) {
      if (present.has(id) || this.standingCasts.has(id)) continue;
      this.summoned.delete(id);
      const left = tokens.filter((token) => this.tokens.has(token));
      if (left.length === 0 || !this.host.removeTokens) continue;
      this.spellRules.offer({
        title: 'The summoning spell ended', note: 'Take what it summoned off the map?', apply: 'Remove',
        lines: left.map((token) => ({ id: token, words: this.tokens.get(token)?.token.name ?? 'Token', on: true })),
        run: (ids) => { if (ids.length > 0) this.host.removeTokens?.(ids); },
      });
    }
  }

  /** Map pixels for feet, at the scene's scale. */
  private feetToPx(feet: number): number {
    return (feet / feetPerSquare(this.host.measurement())) * (this.map?.grid.size ?? 50);
  }

  private landSpell(cast: CastSpell): void {
    const rules = cast.rules!;
    const spell = cast.spell;
    const name = rules.name ?? 'The spell';
    const caster = spell.caster ? this.tokens.get(spell.caster) ?? null : null;
    const { middle } = spellFootprint(spell);
    const cell = this.map?.grid.size ?? 50;
    const snap = (entry: { token: { size: number } }) => (point: { x: number; y: number }) => snapPoint(this.snapGrid('tokens'), point.x, point.y, entry.token.size);
    if (rules.teleport && caster) {
      // The caster steps out where the spell was set, if it is within reach.
      const to = { x: spell.at.x, y: spell.at.y };
      const far = Math.hypot(to.x - caster.at.x, to.y - caster.at.y);
      const reach = this.feetToPx(rules.teleport) + cell * 0.75;
      const landing = snapPoint(this.snapGrid('tokens'), to.x, to.y, caster.token.size);
      this.spellRules.offer({
        title: `${name}: teleport`, apply: 'Teleport',
        note: far > reach ? `That is ${Math.round(far / cell * feetPerSquare(this.host.measurement()))} ft away, past its ${rules.teleport} ft.` : undefined,
        lines: [{ id: caster.token.id, words: `${caster.token.name ?? 'Caster'} to the spot`, on: far <= reach }],
        run: (ids) => {
          if (ids.includes(caster.token.id)) this.host.moveTokens?.([{ id: caster.token.id, x: landing.x, y: landing.y }]);
          // Done: the mark goes.
          this.host.playerAction?.({ type: 'spell', change: { remove: cast.id } });
        },
      }, cast.id);
    }
    if (rules.push) {
      const origin = spell.from === 'self' && caster ? { x: caster.at.x, y: caster.at.y } : middle;
      const walls = this.movementWalls();
      const hit = new Set(spellHits(spell, this.spellTargets().filter((target) => !target.id.startsWith('prop:')), this.map?.walls ?? [], this.wallsLook()));
      const moves = [...hit].flatMap((id) => {
        const entry = this.tokens.get(id);
        if (!entry || id === spell.caster) return [];
        const to = pushTo(origin, entry.at, this.feetToPx(rules.push!));
        const end = slide(entry.at, to, walls, cell, snap(entry));
        const moved = Math.round((Math.hypot(end.x - entry.at.x, end.y - entry.at.y) / cell) * feetPerSquare(this.host.measurement()));
        return [{ id, x: end.x, y: end.y, words: `${entry.token.name ?? 'Token'}: ${moved} ft${moved < Math.abs(rules.push!) ? ' (stopped by a wall)' : ''}` }];
      });
      if (moves.length > 0) {
        this.spellRules.offer({
          title: `${name}: ${rules.push > 0 ? 'push' : 'pull'} ${Math.abs(rules.push)} ft`, apply: rules.push > 0 ? 'Push' : 'Pull',
          note: 'Untick those who saved or resisted.',
          lines: moves.map((move) => ({ id: move.id, words: move.words, on: true })),
          run: (ids) => {
            const chosen = moves.filter((move) => ids.includes(move.id)).map(({ id, x, y }) => ({ id, x, y }));
            if (chosen.length > 0) this.host.moveTokens?.(chosen);
          },
        }, cast.id);
      }
    }
    if (rules.summon && this.host.summonTokens) {
      const summon = rules.summon;
      // In squares round the spell's point: the first on it, the rest in rings out.
      const spots = spiralSpots(middle, cell, summon.count);
      this.spellRules.offer({
        title: `${name}: summon`, apply: 'Summon',
        lines: [{ id: 'summon', words: `${summon.count > 1 ? `${summon.count} × ` : ''}${summon.name}`, on: true }],
        run: (ids) => {
          if (!ids.includes('summon')) return;
          const made = this.host.summonTokens?.(spots.map((spot) => ({ name: summon.name, x: spot.x, y: spot.y, ...(summon.statblock ? { statblock: summon.statblock } : {}) }))) ?? [];
          if (made.length > 0) this.summoned.set(cast.id, made);
        },
      }, cast.id);
    }
  }

  /** A gate the token stands in, and the other gate of its name it would come out of; null when none. */
  gateFor(tokenId: string): { name: string; to: { x: number; y: number } } | null {
    const entry = this.tokens.get(tokenId);
    if (!entry) return null;
    const gates = this.castSpells.filter((cast) => cast.rules?.portal);
    const here = [...gates].reverse().find((cast) => spellUnder(cast.spell, entry.at));
    if (!here) return null;
    const other = [...gates].reverse().find((cast) => cast !== here && cast.rules!.portal === here.rules!.portal);
    return other ? { name: here.rules!.portal!, to: spellFootprint(other.spell).middle } : null;
  }

  /** Through the gate the token stands in, out of its twin (the GM's token menu). */
  goThroughGate(tokenId: string): boolean {
    const gate = this.gateFor(tokenId);
    const entry = this.tokens.get(tokenId);
    if (!gate || !entry || !this.host.moveTokens) return false;
    const landing = snapPoint(this.snapGrid('tokens'), gate.to.x, gate.to.y, entry.token.size);
    this.host.moveTokens([{ id: tokenId, x: landing.x, y: landing.y }]);
    return true;
  }

  /**
   * The length of the path through `points` (map pixels) as Atlas labels it: by the collection's diagonal rule, with
   * `rise` cells of height between its ends, in the map's units and under its unit's name. `extra` is a share of the
   * path counted again (a spell's difficult terrain).
   */
  distanceLabel(points: ReadonlyArray<{ x: number; y: number }>, rise = 0, extra = 0): string {
    const map = this.map;
    if (!map) return '';
    const measurement = this.host.measurement();
    const cells = pathLengthInCells(points, map.grid, measurement.diagonalRule, rise);
    return formatDistance(cells + cells * extra, measurement);
  }

  /** How much of a path (a share, 0 to 1) runs through difficult terrain a spell makes. */
  difficultShare(points: ReadonlyArray<{ x: number; y: number }>): number {
    const ruled = this.castSpells.filter((cast) => cast.rules?.difficult);
    if (ruled.length === 0 || points.length < 2) return 0;
    const step = (this.map?.grid.size ?? 50) / 4;
    let total = 0;
    let rough = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      const count = Math.max(1, Math.ceil(length / step));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        total += 1;
        if (inDifficultSpell({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ruled)) rough += 1;
      }
    }
    return total > 0 ? rough / total : 0;
  }

  /** The walls tokens are stopped by now: the map's, and the spells'. */
  movementWalls(): BoardWall[] {
    return [...(this.map?.walls ?? []), ...this.ruleWalls];
  }

  /** The spell walls and lights standing now: for a look in tests. */
  ruleState(): { walls: number; sightOnly: number; lights: Array<{ bright: number; dim: number; darkness: boolean }> } {
    return { walls: this.ruleWalls.length, sightOnly: this.ruleWalls.filter((wall) => wall.blocks === 'sight').length, lights: this.ruleLights.map((light) => ({ bright: light.bright, dim: light.dim, darkness: light.darkness })) };
  }

  /**
   * Each frame: the shape aimed follows the view, and (a few times a second) what the spells hit is found again, the red
   * line put round what is hit and taken off what is not.
   */
  /** Spells with a damage's look move by themselves: on to now, and another frame asked for while any is shown. */
  private animateSpells(): void {
    if (this.impacts.active) { this.impacts.step(); this.wake(); }
    const views = [...[...this.spellViews.values()].map((kept) => kept.view), ...(this.spellPreview ? [this.spellPreview.view] : [])];
    const moving = views.filter((view) => view.animated);
    const areasMove = this.areas.animated;
    if (moving.length === 0 && !areasMove && this.spellAuras.size === 0 && this.fadingSpells.length === 0 && this.growingSpells.size === 0) return;
    const time = this.spellClock();
    const height = this.renderer.domElement.height;
    // Casts grow into place by the clock, however many frames that takes.
    for (const [id, start] of [...this.growingSpells]) {
      const progress = (time - start) * 1000 / GROW_MS;
      this.spellViews.get(id)?.view.grow(Math.min(1, progress));
      if (progress >= 1) { this.growingSpells.delete(id); this.spellHitsAt = 0; }
    }
    for (const view of moving) view.tick(time, height);
    if (areasMove) this.areas.tick(time, height);
    this.fadingSpells = this.fadingSpells.filter((fading) => {
      const left = 1 - (time - fading.start) / INSTANT_FADE_SECONDS;
      if (left <= 0) { fading.view.dispose(); return false; }
      if (fading.view.animated) fading.view.tick(time, height);
      fading.view.fade(left);
      return true;
    });
    const box = new THREE.Box3();
    for (const aura of this.spellAuras.values()) {
      // With the thing as it moves.
      box.setFromObject(aura.root);
      if (!box.isEmpty()) box.getCenter(aura.effect.object3d.position);
      aura.effect.tick(time, height);
    }
    this.wake();
  }

  private spellTick(): void {
    if (this.map !== this.spellMap) {
      // Another map, or the walls changed: the spells' cut by the walls is redone.
      this.spellMap = this.map;
      for (const kept of this.spellViews.values()) kept.view.dispose();
      this.spellViews.clear();
      for (const fading of this.fadingSpells) fading.view.dispose();
      this.fadingSpells = [];
      this.drawSpells();
      // The areas are cut by the same walls, and their height is the map's.
      this.drawMarks();
    }
    this.updateSpellLoops();
    if (this.eye) this.caster?.frame();
    this.animateSpells();
    const adjusting = this.caster?.adjusting;
    if (this.spellGizmo && adjusting) this.spellGizmo.place(adjusting, this.view);
    const spells = [...this.castSpells.map((cast) => cast.spell), ...(this.spellPreview ? [this.spellPreview.spell] : [])];
    if (spells.length === 0 && this.spellOutlines.size === 0 && this.spellAuras.size === 0) return;
    const win = this.container.ownerDocument.defaultView ?? window;
    const now = win.performance.now();
    if (now - this.spellHitsAt < 150) {
      if (this.spellTimer === 0) this.spellTimer = win.setTimeout(() => { this.spellTimer = 0; this.wake(); }, 160);
      return;
    }
    this.spellHitsAt = now;
    const targets = this.spellTargets();
    const walls = this.map?.walls ?? [];
    const hit = new Set<string>();
    for (const spell of spells) for (const id of spellHits(spell, targets, walls, this.wallsLook())) hit.add(id);
    const byId = new Map(targets.map((target) => [target.id, target]));
    let changed = this.syncAuras(targets, walls);
    for (const [id, kept] of this.spellOutlines) {
      const target = byId.get(id);
      if (hit.has(id) && target && target.root === kept.outline.root && meshCount(target.root) === kept.meshes) continue;
      kept.outline.dispose();
      this.spellOutlines.delete(id);
      changed = true;
    }
    const width = (this.map?.grid.size ?? 50) * 0.025;
    for (const id of hit) {
      const target = byId.get(id);
      if (!target || this.spellOutlines.has(id)) continue;
      this.spellOutlines.set(id, { outline: new PieceOutline(target.root, SPELL_HIT_COLOR, width), meshes: meshCount(target.root) });
      changed = true;
    }
    if (changed) this.wake();
  }

  /**
   * Each thing a cast spell with a damage hits gets that damage's look round it (the latest spell's, when more than one
   * hits it); a thing no longer hit loses it. Whether anything changed.
   */
  private syncAuras(targets: ReadonlyArray<SpellTarget & { root: THREE.Object3D }>, walls: readonly BoardWall[]): boolean {
    const wanted = new Map<string, DamageType>();
    for (const cast of this.castSpells) {
      const type = cast.spell.effect;
      // A cast still growing sets nothing alight yet: its flames come once it is whole.
      if (!type || this.growingSpells.has(cast.id)) continue;
      for (const id of spellHits(cast.spell, targets, walls, this.wallsLook())) wanted.set(id, type);
    }
    const byId = new Map(targets.map((target) => [target.id, target]));
    let changed = false;
    for (const [id, aura] of this.spellAuras) {
      const target = byId.get(id);
      if (wanted.get(id) === aura.type && target?.root === aura.root) continue;
      aura.effect.dispose();
      this.spellAuras.delete(id);
      changed = true;
    }
    const cell = this.map?.grid.size ?? 50;
    for (const [id, type] of wanted) {
      const target = byId.get(id);
      if (!target || this.spellAuras.has(id)) continue;
      const box = new THREE.Box3().setFromObject(target.root);
      if (box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3());
      const effect = hitAura(type, Math.max(size.x, size.z) / 2, size.y, cell);
      box.getCenter(effect.object3d.position);
      this.scene.add(effect.object3d);
      this.spellAuras.set(id, { type, root: target.root, effect });
      changed = true;
    }
    return changed;
  }

  /** The damage looks round what the spells hit, by target id: for a look in tests. */
  spellAuraTypes(): Record<string, DamageType> {
    return Object.fromEntries([...this.spellAuras].map(([id, aura]) => [id, aura.type]).sort());
  }

  /** What the spells hit now, by target id (a prop's as `prop:` and its id): for a look in tests. */
  spellHitIds(): string[] {
    return [...this.spellOutlines.keys()].sort();
  }

  /** The token whose eyes the view is through, or null. */
  get seeingFrom(): string | null {
    return this.eye?.tokenId ?? null;
  }

  /** Whether the view through a token's eyes was asked to follow the phone's gyroscope. */
  get seeingGyro(): boolean {
    return this.eye?.gyro ?? false;
  }

  /** Where the eye view stands: the token's place, at its eye height (most of the way up its mini, or of its disc). */
  private eyeAt(): { x: number; y: number; z: number } | null {
    const entry = this.eye ? this.tokens.get(this.eye.tokenId) : undefined;
    if (!entry) return null;
    const cell = this.map?.grid.size ?? 50;
    const box = new THREE.Box3().setFromObject(entry.piece.object3d, true);
    const top = Number.isFinite(box.max.y) ? box.max.y : entry.lift + cell * 0.6;
    return { x: entry.at.x, y: Math.max(entry.lift + cell * 0.3, top * 0.9), z: entry.at.y };
  }

  lookAtPoint(x: number, y: number): void {
    if (!this.allows('camera')) return;
    this.camera.lookAt({ x, y: 0, z: y });
    this.wake();
  }

  /** The tokens of the selection, each with where it stands. */
  private groupMembers(): Map<string, GroupMember> {
    const members = new Map<string, GroupMember>();
    for (const id of this.group) {
      const entry = this.tokens.get(id);
      if (entry) members.set(id, { origin: { x: entry.at.x, y: entry.at.y }, size: entry.token.size });
    }
    return members;
  }

  /** Shift-click: adds a token to the selection, or takes it out. The token with the controls joins it. */
  private toggleGroup(id: string): void {
    if (this.group.size === 0 && this.selectedId !== null && this.selectedId !== id) this.group.add(this.selectedId);
    if (this.group.has(id)) this.group.delete(id);
    else this.group.add(id);
    // A selection of one is no selection: that token is the selected one.
    if (this.group.size === 1) {
      const [only] = this.group;
      this.group.clear();
      this.select(only ?? null);
    } else if (this.group.size >= 2) {
      this.select(null);
    }
    this.drawGroup();
  }

  private clearGroup(): void {
    if (this.group.size === 0) return;
    this.group.clear();
    this.drawGroup();
    this.wake();
  }

  /** Puts the rings under the selection's tokens, where they stand now. */
  private placeGroup(): void {
    this.groupMarks.update(this.group, (id) => {
      const entry = this.tokens.get(id);
      return entry && this.map ? { x: entry.at.x, y: entry.at.y, diameter: ringDiameter(this.map.grid, entry.token.size) } : null;
    });
  }

  /** The board as it is drawn now, as a PNG; null when the canvas cannot give one. */
  snapshot(): Promise<Blob | null> {
    // The canvas keeps no picture between frames: it is drawn again, and read in the same step.
    this.redraw();
    return new Promise((resolve) => this.canvas.toBlob((blob) => resolve(blob), 'image/png'));
  }

  /** Marks the tokens of the combatants holding their turn back (a clock over each); none takes the marks away. */
  setDelayedTokens(ids: readonly string[]): void {
    const wanted = new Set(ids);
    for (const [id, entry] of this.tokens) entry.piece.setDelayed(wanted.has(id));
    this.wake();
  }

  /** Atlas's turn banner, standing above the toolbar: made on first use (the toolbar holds its place). */
  private turnBanners: TurnBannerDisplay | null = null;

  /** Does what the turn announcer says: shows Atlas's banners (a portrait by `portrait`), or lets a turn's banner leave. */
  showTurnBanner(command: TurnBannerCommand, portrait: PortraitSource): void {
    if (!command || this.disposed) return;
    if ('hideTurn' in command) {
      if (this.turnBanners?.showing && !this.turnBanners.showsFightEnd) this.turnBanners.hide();
      return;
    }
    this.turnBanners ??= new TurnBannerDisplay(this.toolbar.turnBannerHost, (path) => this.turnPortrait?.(path) ?? null);
    this.turnPortrait = portrait;
    this.turnBanners.show(...command.show);
  }

  private turnPortrait: PortraitSource | null = null;

  /** Rings the tokens of the combatants whose turn it is; none takes the rings away. */
  setActiveTokens(ids: readonly string[]): void {
    if (ids.length === this.active.length && ids.every((id, index) => id === this.active[index])) return;
    this.active = ids;
    this.placeActive();
    this.wake();
  }

  private placeActive(): void {
    this.activeMarks.update(this.active, (id) => {
      const entry = this.tokens.get(id);
      return entry && this.map ? { x: entry.at.x, y: entry.at.y, diameter: ringDiameter(this.map.grid, entry.token.size) } : null;
    });
  }

  private drawGroup(): void {
    this.placeGroup();
    const key = hpKey(this.host.rules().definitions);
    this.groupBar.show(this.group.size, key !== null && [...this.group].some((id) => this.tokens.get(id)?.token.resources[key] !== undefined));
    this.wake();
  }

  /** Turns every token of the selected group by `delta` degrees, shown at once and saved as the host does. */
  rotateGroup(delta: number): void {
    const turns: Array<{ id: string; rotation: number }> = [];
    for (const id of this.group) {
      const entry = this.tokens.get(id);
      if (!entry) continue;
      const rotation = turned(entry.token.rotation, delta);
      turns.push({ id, rotation });
      this.changeToken(id, { ...entry.token, rotation });
    }
    if (turns.length > 0) this.host.rotateTokens?.(turns);
    this.placeGroup();
    this.wake(true);
  }

  /** Hurts (a negative `delta`) or heals every token of the group that tracks HP, each by the same amount. */
  changeGroupHp(delta: number): void {
    const key = hpKey(this.host.rules().definitions);
    if (key === null) return;
    for (const id of this.group) {
      const entry = this.tokens.get(id);
      const next = entry ? hpChange(entry.token, key, delta) : null;
      if (!entry || !next) continue;
      this.showResource(id, key, next, false);
      this.host.editResource(id, key, (stored) => withCurrent(stored, stored.current + delta), false);
    }
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
    this.changeToken(id, { ...entry.token, ...resourceUpdate(entry.token, key, next, maxEdited) });
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
    const current = this.host.boardMode?.();
    if (material && (current === 'play' || current === 'cinematic')) this.setMode('edit');
    if (material) {
      // One tool at a time: painting puts the water brush, the Shapes tool, and the ruler away.
      if (this.waterTool) { this.waterTool = null; this.showBrush(); }
      this.fogTool?.setOn(false);
      this.shapeEditor?.setActive(false);
      if (this.tools.tool !== 'move') { this.tools.select('move'); this.toolsChanged(); }
    }
    this.painting = material;
    this.canvas.style.cursor = material ? 'copy' : this.laserOn ? 'none' : '';
    if (!material) this.tooltip.hidden = true;
    this.hideHandles();
    this.canvas.focus();
    this.toolbar.refresh();
  }

  private stopPainting(): void {
    if (this.painting !== null) this.paintWith(null);
  }

  /** Play, Edit or Cinematic: the toolbar's tools of that mode; leaving Edit or Play puts its tools away. */
  private setMode(mode: 'play' | 'edit' | 'cinematic'): void {
    this.host.setBoardMode?.(mode);
    if (mode !== 'edit') {
      this.stopPainting();
      this.fogTool?.setOn(false);
      if (this.waterTool) { this.waterTool = null; this.showBrush(); }
      this.hideHandles();
    }
    if (mode !== 'play' && this.tools.tool !== 'move') {
      this.tools.select('move');
      this.toolsChanged();
    }
    this.toolbar.refresh();
    this.toolbar.fit();
  }

  /** The grid as tokens or props snap to it: tokens by the map's Snap to grid, props by their own setting alone. */
  private snapGrid(kind: 'tokens' | 'props'): Parameters<typeof snapPoint>[0] {
    const grid = this.map!.grid;
    if (kind === 'tokens') return grid;
    const on = this.host.snapProps?.() ?? true;
    return grid.snap === on ? grid : { ...grid, snap: on };
  }

  /** Building the board is allowed: Edit mode, or a board without modes (Play and Cinematic do not build). */
  private get editing(): boolean {
    const mode = this.host.boardMode?.() ?? null;
    return mode === null || mode === 'edit';
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

  /** One tool at a time: the Measure tool, if in hand, is put down for Move/Select (the hand) or the laser. */
  private putMeasureAway(): void {
    if (this.tools.tool === 'move') return;
    this.tools.select('move');
    this.toolsChanged();
  }

  /** Turns the laser on (the pointer becomes its dot) or off (its trail fades). */
  setLaser(on: boolean): void {
    if (on) this.putMeasureAway();
    if (on === this.laserOn) return;
    if (on) this.fogTool?.setOn(false);
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
    // The extra board round the map is board too.
    const margin = this.groundSettings().margin * (this.map?.grid.size ?? 0);
    return { x: THREE.MathUtils.clamp(x, -margin, this.size.width + margin), y: THREE.MathUtils.clamp(y, -margin, this.size.height + margin) };
  }

  /** Ctrl/Cmd was let go: the stat block card closed, and pressing it again over the same token opens it again. */
  previewEnded(): void {
    this.previewed = null;
    this.showSpellCard(null, { clientX: 0, clientY: 0 });
  }

  /** Names a condition ring or stat badge under the pointer; with Ctrl/Cmd held, shows a token's stat block. */
  private hover(event: PointerEvent): void {
    if (this.audience === 'player') {
      // Connect shows the token's card (or with Ctrl/Cmd the player's own stat block) around the board.
      const id = this.tokenAt(event.clientX, event.clientY);
      this.host.hoverToken?.(id, { x: event.clientX, y: event.clientY }, event.ctrlKey || event.metaKey);
      return;
    }
    this.pointerAt = { x: event.clientX, y: event.clientY };
    // Over the handle of a kept measurement: it is lifted, and Delete takes its measurement.
    const overMeasure = this.press === null ? this.measureHandleAt(event.clientX, event.clientY) : null;
    this.setMeasureHover(overMeasure);
    if (overMeasure) return;
    this.ctrlHandles(event.altKey ? 'width' : event.ctrlKey || event.metaKey ? 'height' : null);
    if (event.ctrlKey || event.metaKey) {
      const id = this.tokenAt(event.clientX, event.clientY);
      // Over another token with a stat block its card opens; over none the card stays, so the pointer can go to it.
      if (id && id !== this.previewed && this.tokens.get(id)?.token.statblockPath) {
        this.host.statblockPreview(id, event);
        this.previewed = id;
      }
    } else if (this.previewed !== null) {
      // Letting go of Ctrl/Cmd closes the card (Atlas's own rule).
      this.host.statblockPreviewEnd?.();
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
    this.tooltip.hidden = false;
    // Beside the pointer, kept inside the board: past its right or bottom edge it goes to the pointer's other side.
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    let left = clientX - rect.left + 12;
    let top = clientY - rect.top + 12;
    if (left + width > rect.width - 4) left = Math.max(4, clientX - rect.left - 12 - width);
    if (top + height > rect.height - 4) top = Math.max(4, clientY - rect.top - 12 - height);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  // ── Cinematic mode ────────────────────────────────────────────────────────

  /** Whether the board lets the person at it do `input` now (see `lockRules`). */
  private allows(input: LockInput): boolean {
    return inputAllowed(this.role, input);
  }

  /** Whether the lock lets a press in progress go on, by what it does. */
  private pressAllowed(press: Press): boolean {
    return this.allows(press.kind === 'camera' ? 'camera' : press.kind === 'tool' || press.kind === 'laser' ? 'tool' : 'token-drag');
  }

  /** What drives the camera, or null while the person's own camera does. */
  get cinematic(): CinematicDriver | null {
    return this.cinematicDriver;
  }

  /**
   * Hands the camera to `driver` (null gives it back). The orbit camera's drawn pose is set to the driver's on every
   * frame, so everything that follows it (the labels, the sound listener, the players' window) follows the driver too,
   * and it is not eased toward its goal meanwhile. The goal is never touched: it is the person's own camera, and the
   * drawn pose goes back to it when the driver is taken away.
   */
  setCinematic(driver: CinematicDriver | null): void {
    const had = this.cinematicDriver !== null;
    this.cinematicDriver = driver;
    if (driver) this.clearBlackAfterFrame = false;
    if (driver && !had) this.heading = { yaw: this.camera.pose.yaw, pitch: this.camera.pose.pitch };
    if (!driver && had) {
      this.drivenAim = null;
      // The fade stays as it is until a frame has drawn the restored pose (see `frame`), so the last shot never shows unfaded.
      this.clearBlackAfterFrame = true;
      this.camera.snap();
      this.listened = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, distance: NaN };
    }
    this.wake(true);
  }

  get cinematicRole(): CinematicRole {
    return this.role;
  }

  /**
   * Says what the person at this board may do from now on. A press in progress the role does not allow is dropped (a
   * token being carried goes back), held keys are cleared, and a player in a token's eyes leaves them. When augmented
   * reality is allowed again, the latest view it was given is drawn.
   */
  setCinematicRole(role: CinematicRole): void {
    this.role = role;
    this.held.clear();
    if (this.press && !this.pressAllowed(this.press)) this.cancel();
    if (!this.allows('camera')) {
      this.pinch = null;
      this.touches.clear();
    }
    if (this.eye && !this.allows('eyes')) {
      this.eyesLocked = this.eye.tokenId;
      this.leaveEyes();
    }
    // The camera's picture and the AR look stay off while the lock holds (the latest view is kept), and come back with it.
    if (!this.allows('ar') && this.augmented !== null) this.applyAugmented(null);
    else if (this.allows('ar') && this.arLatest !== this.augmented) this.applyAugmented(this.arLatest);
    this.wake(true);
  }

  /** The token whose eyes the person was in when the role took them away, for the board to go back into when it ends. */
  get eyesBeforeLock(): string | null {
    return this.eyesLocked;
  }

  /** The camera as it stands, to be put back exactly by `restoreCamera`. */
  keepCamera(): CameraKeep {
    return this.camera.keep();
  }

  restoreCamera(keep: CameraKeep): void {
    this.camera.restore(keep);
    this.heading = { yaw: keep.pose.yaw, pitch: keep.pose.pitch };
    this.listened = { x: NaN, y: NaN, z: NaN, yaw: NaN, pitch: NaN, distance: NaN };
    this.wake(true);
  }

  /** Takes the driver's pose for this frame into the orbit camera's drawn pose, and its fade into the overlay; whether the camera moved. */
  private stepDriver(): boolean {
    const driver = this.cinematicDriver;
    if (!driver) return false;
    const out = driver.pose(this.now());
    this.cinema.setBlack(out.black);
    const view = drivenView(out.eye, out.target, this.heading);
    if (!view) return false;
    this.heading = { yaw: view.yaw, pitch: view.pitch };
    this.drivenAim = view.aim;
    const pose = this.camera.pose;
    const moved = pose.yaw !== view.yaw || pose.pitch !== view.pitch || pose.distance !== view.distance
      || pose.target.x !== view.target.x || pose.target.y !== view.target.y || pose.target.z !== view.target.z;
    pose.yaw = view.yaw;
    pose.pitch = view.pitch;
    pose.distance = view.distance;
    pose.target.x = view.target.x;
    pose.target.y = view.target.y;
    pose.target.z = view.target.z;
    return moved;
  }

  /** The players' window draws the driver's pose (not where the GM froze theirs) and carries a cinema look of its own. A fade of the window alone going on is dropped. */
  setPlayersCinematic(on: boolean): void {
    this.playersDriven = on;
    this.playersFade = null;
    if (!on) {
      this.playerCinema?.dispose();
      this.playerCinema = null;
    }
    this.wake(true);
  }

  /**
   * Fades the players' window alone to black and back over `fadeMs` each way (a live run, whose GM view never goes
   * black): `atBlack` runs at the black, where the window's bars change to the board's, and `done` once it is clear
   * again. With no players' window, or one not driven, both run at once.
   */
  fadePlayers(fadeMs: number, atBlack: () => void, done: () => void = () => {}): void {
    this.playersFade = null;
    if (!this.player || !this.playersDriven) {
      atBlack();
      done();
      return;
    }
    this.playersFade = { start: this.now(), ms: fadeMs, bars: this.playerCinema?.aspect ?? null, swapped: false, atBlack, done };
    this.wake(true);
  }

  /** A fade of the players' window alone (see `fadePlayers`): when it began, the bars the window keeps until its black, and what is left to do. */
  private playersFade: { start: number; ms: number; bars: number | null; swapped: boolean; atBlack: () => void; done: () => void } | null = null;

  /** The players' window is going: a fade of it alone ends now, with what it had left to do. */
  private finishPlayersFade(): void {
    const fade = this.playersFade;
    if (!fade) return;
    this.playersFade = null;
    if (!fade.swapped) fade.atBlack();
    fade.done();
  }

  /** The players' overlay follows the board's: made when the players' window is driven, the same bars and the same fade (darker during a fade of the window alone). */
  private dressPlayers(player: PlayerScreen): void {
    if (!this.playersDriven) return;
    let bars = this.cinema.aspect;
    let black = this.cinema.black;
    const fade = this.playersFade;
    if (fade) {
      const e = enterLeave(this.now() - fade.start, fade.ms);
      if (e.swapped && !fade.swapped) {
        fade.swapped = true;
        fade.atBlack();
      }
      if (!fade.swapped) bars = fade.bars;
      black = Math.max(black, e.black);
      if (e.done) {
        this.playersFade = null;
        fade.done();
        if (!this.playersDriven) return;
      } else this.wake();
    }
    this.playerCinema ??= new CinemaOverlay(player.container);
    if (this.playerCinema.aspect !== bars) this.playerCinema.setBars(bars);
    if (this.playerCinema.black !== black) this.playerCinema.setBlack(black);
  }

  /**
   * Holds the players' picture: on the next draw of their window it is captured and laid over their stage as an image,
   * and stays there, whatever the board does underneath (a scene switch), until released.
   */
  holdPlayers(hold: boolean): void {
    this.playerHold = hold;
    const stage = this.player?.container;
    if (hold) {
      // A picture already held there (this board took over from one that held it) is the one to keep.
      this.playerHeld ??= (stage?.querySelector('.tabletop-cinema__hold') as HTMLImageElement | null) ?? null;
    } else {
      this.playerHeld = null;
      stage?.querySelectorAll('.tabletop-cinema__hold').forEach((held) => held.remove());
      if (this.player) this.player.shadowsDirty = true;
    }
    this.wake(true);
  }

  private holdFrame(player: PlayerScreen): void {
    const image = player.container.ownerDocument.createElement('img');
    image.className = 'tabletop-cinema__hold';
    image.src = player.canvas.toDataURL();
    player.container.appendChild(image);
    this.playerHeld = image;
  }

  /**
   * Shows players, in their window and on a player's own board, what the GM's view shows, as players draw it: the
   * line-of-sight veil and the fog are not drawn and every token not hidden by the GM is there. Nothing is kept: turning
   * it off draws again from the live sight.
   */
  setReveal(on: boolean): void {
    if (this.reveal === on) return;
    this.reveal = on;
    this.sightKey = '';
    if (this.player) this.player.shadowsDirty = true;
    this.wake(true);
  }

  dispose(): void {
    this.closeMeasurePopover();
    this.measurePopoverView?.destroy();
    this.measureHandles.dispose();
    this.turnBanners?.destroy();
    this.turnBanners = null;
    this.loadingOverlay.dispose();
    this.cinematicDriver = null;
    this.arLatest = null;
    this.cinema.dispose();
    this.lockPointer(false);
    this.caster?.dispose();
    this.spellGizmo?.dispose();
    this.spellPreview?.view.dispose();
    // Every loop of this board stops on the engine it shares with other boards (the host may no longer hand it out).
    for (const key of this.loopsAsked.keys()) this.loopEngine?.loop(this.loopPrefix + key, null, 0);
    this.loopsAsked.clear();
    for (const key of this.spellLoops.keys()) this.soundLoop(key, null, 0);
    this.spellLoops.clear();
    for (const key of this.waterLoops.keys()) this.soundLoop(key, null, 0);
    this.waterLoops.clear();
    for (const kept of this.spellViews.values()) kept.view.dispose();
    this.areas.dispose();
    for (const fading of this.fadingSpells) fading.view.dispose();
    this.fadingSpells = [];
    for (const kept of this.spellOutlines.values()) kept.outline.dispose();
    for (const aura of this.spellAuras.values()) aura.effect.dispose();
    this.spellAuras.clear();
    for (const decal of this.ruleDecals) { decal.removeFromParent(); decal.geometry.dispose(); (decal.material as THREE.Material).dispose(); }
    this.ruleDecals = [];
    this.rulePanel?.dispose();
    this.impacts.dispose();
    if (this.spellTimer !== 0) (this.container.ownerDocument.defaultView ?? window).clearTimeout(this.spellTimer);
    for (const kept of this.floorTextures.values()) void kept.then((texture) => texture?.dispose());
    this.floorTextures.clear();
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
    // A step that throws must not skip freeing the GPU context and removing the canvas.
    try {
    this.rig.dispose();
    for (const view of this.layerViews.values()) view.dispose();
    this.layerViews.clear();
    for (const view of this.parked.values()) view.dispose();
    this.parked.clear();
    this.veilSight.dispose();
    this.veilPov.dispose();
    this.layerRuler?.dispose();
    this.gizmo?.dispose();
    this.groupMarks.dispose();
    this.groupBar.dispose();
    this.activeMarks.dispose();
    for (const material of this.wallMaterials.values()) material.dispose();
    for (const piece of this.props.values()) piece.dispose();
    this.shapeEditor?.dispose();
    this.fogTool?.dispose();
    this.shapesView.dispose();
    this.groundPlane.dispose();
    this.seaPlane.dispose();
    this.painted.dispose();
    for (const surface of this.liquids.values()) surface.dispose();
    this.liquids.clear();
    this.surface?.dispose();
    for (const art of this.arts.values()) void art.then((texture) => texture?.dispose());
    this.tilt?.dispose();
    } finally {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.canvas.remove();
      this.tooltip.remove();
    }
  }
}

/** `count` spots a square apart, the first at `middle`, the rest round it in rings. */
function spiralSpots(middle: { x: number; y: number }, cell: number, count: number): Array<{ x: number; y: number }> {
  const out = [{ ...middle }];
  for (let ring = 1; out.length < count && ring < 10; ring++) {
    for (let dx = -ring; dx <= ring && out.length < count; dx++) {
      for (let dy = -ring; dy <= ring && out.length < count; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        out.push({ x: middle.x + dx * cell, y: middle.y + dy * cell });
      }
    }
  }
  return out;
}
