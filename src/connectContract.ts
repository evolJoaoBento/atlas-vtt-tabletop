/**
 * What Tabletop and Atlas VTT Connect share to put Connect's players on the 3D board. The wire shapes are a copy of
 * Connect's `src/app/online/scene/boardTypes.ts` and must stay the same; the API shapes are what each plugin offers
 * the other through `app.plugins.plugins[…].api`. Heights are in grid squares; null is the board's default.
 */
import type { RolledDie, RollRequest } from './dice/rollRules';

// ── On the wire (Connect's `boardTypes.ts`) ──────────────────────────────────

export interface BoardPoint { x: number; y: number }

export interface BoardDoor {
  open: boolean;
  swing: 'left' | 'right';
  /** The asset id of the GLB standing in the doorway, or null for Tabletop's own leaf. */
  prop: string | null;
  chainId?: string;
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
  /** Atlas's one-way side, a wall that stops only sight (a curtain) or only light (glass), and a limited one. */
  direction?: 'left' | 'right';
  blocks?: 'sight' | 'light';
  limited?: boolean;
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

export interface BoardMaterialRecord { id: string; scale: number; maps: Record<string, string> }

export interface BoardPropRecord { id: string; asset: string; x: number; y: number; scale: number; turn: number }

export interface BoardLighting { enabled: boolean; ambient: number; ambientColor: string | null }

export interface BoardExtras {
  sceneId: string;
  walls: BoardWallRecord[];
  lights: BoardLightRecord[];
  props: BoardPropRecord[];
  materials: BoardMaterialRecord[];
  ambient: number | null;
  lighting: BoardLighting;
  fogHeight: number | null;
  /** How thick walls stand, as a share of a grid square; null is the board's default. */
  wallThickness: number | null;
}

/** A 3D camera in the board's world: x and z are the map's x and y in pixels, y is up. */
export interface BoardCamera {
  sceneId: string;
  eye: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

// ── The GM's side: Tabletop offers ───────────────────────────────────────────

/** What the GM gave a map on the board, read through Tabletop's API. Paths are vault paths, never sent. */
export interface BoardLook {
  wallHeight(id: string): number | null;
  /** A material's id (its vault folder), or null for the plain wall. */
  wallMaterial(id: string): string | null;
  /** The vault path of the GLB standing in for a door's leaf, or null. */
  doorProp(id: string): string | null;
  lightHeight(id: string): number | null;
  readonly fogHeight: number | null;
  readonly wallThickness: number | null;
  readonly ambient: number | null;
  readonly props: ReadonlyArray<{ id: string; path: string; x: number; y: number; scale: number; turn: number }>;
  /** The materials this map's walls use, with their texture maps by role (vault paths). */
  readonly materials: ReadonlyArray<{ id: string; scale: number; maps: Record<string, string> }>;
}

/** What players do on a map, for the GM's board: a ping, or new points of a laser. */
export type BoardMark =
  | { kind: 'ping'; mapPath: string; x: number; y: number; color: string }
  | { kind: 'laser'; mapPath: string; from: string; points: BoardPoint[]; lifted: boolean; color: string };

export interface BoardSessionTemplate { id: string; owner: string; shape: 'line' | 'circle' | 'square' | 'cone'; start: BoardPoint; end: BoardPoint; color: string }

/** Connect's hosted session, handed to `api.attachSession` (Connect's `BoardSessionHub`; the shapes must stay the same). */
export interface BoardSession {
  hosting(): boolean;
  presentedMap(): string | null;
  overlay(mapPath: string): { templates: readonly BoardSessionTemplate[]; coneAngle: number; handout: { path: string; title: string } | null };
  onChange(listener: () => void): () => void;
  onMark(listener: (mark: BoardMark) => void): () => void;
  addTemplate(mapPath: string, add: { shape: BoardSessionTemplate['shape']; start: BoardPoint; end: BoardPoint }): boolean;
  eraseTemplate(mapPath: string, id: string): void;
  clearTemplates(mapPath: string): void;
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
