/**
 * A Connect player's scene as the board reads a map (`BoardMap`): what Atlas VTT Connect sends its players (only what
 * they may see) and, for Tabletop's board, its extras (walls, doors, lights, props, materials). Images and models are
 * asset ids here, where the GM's board has vault paths; the player's board looks them up through Connect. The rules a
 * player board needs (conditions' names and colours, the bars' colours) come with the scene, so they are made from it.
 * The darkness Connect lays over the fog for a lit scene goes to its own layer: the board draws it as black ground.
 */
import type { BoardExtras, BoardGround, BoardPainted, BoardLayerRecord, BoardMaterialRecord, BoardPropRecord, BoardShapeRecord } from '../connectContract';
import type { ShapePoint, TerrainShape } from './terrainShapes';
import { readGround, type GroundSettings } from './ground';
import type { ElevationLayerData } from './elevationLayer';
import type { CollectionRules, ConditionDefinition } from './conditions';
import type { FogOperation } from './fog';
import { readInitiative, DEFAULT_INITIATIVE_RULES } from './initiative';
import type { BoardGrid, BoardIcon, BoardInk, BoardMap, BoardPin, BoardText, BoardToken, Meter } from './mapModel';
import type { ResourceDefinition } from './resources';
import { NO_MOVEMENT_RULES, tokenHeight } from '../../packages/atlas-shared/src/index';
import { ownSpeed } from './tokenHeight';
import { NO_FLIP, type BoardLight, type BoardWall, type DoorFlip } from './walls';
import { waterFromWire, type WaterSource } from './liquids';

/** Connect's id of the darkness it adds to the fog (`darknessFog.ts`). */
export const DARKNESS_FOG_ID = 'atlas-lighting-darkness';

type Point = { x: number; y: number };

/** The fields of Connect's `PlayerScene` the board reads; loosely typed, as Tabletop does not import Connect. */
export interface PlayerSceneLike {
  sceneId: string;
  map: { asset: string | null; width: number; height: number; cellSize: number; matrix?: readonly [number, number, number, number, number, number] };
  grid: {
    type: 'square' | 'hex-horizontal' | 'hex-vertical'; size: number; offsetX: number; offsetY: number; color: string | null; opacity: number;
    lineType: 'solid' | 'dashed' | 'dotted'; lineWidth: number; hexNumbers: string | null; hexNumberOpacity: number | null;
    cellNumbers?: string | null; cellNumberOpacity?: number | null;
  } | null;
  tokens: Record<string, {
    x: number; y: number; size: number; rotation: number; layer: number; image: string | null; ring: string | null;
    conditions: Array<{ id: string; value: number | null; name?: string; color?: string; icon?: string }>;
    name: string | null; hp: { current: number; max: number } | null; stress: { current: number; max: number } | null;
    /** Connect's bars: `share` alone for Bar only; `bar: false` and the one number players read for Number only. */
    resources?: Array<{ color: string; share: number; spent: boolean; current?: number; max?: number; fixed?: boolean; bar?: false }>;
    downed?: boolean; side?: string; instance?: number; mini?: { asset: string | null; scale: number; turn: number; base?: 'round' | 'square' };
    /** Atlas 0.15: its height in game units, and (for a players' token, where the rules name steps) its speed. */
    elevation?: number; speed?: number;
  }>;
  fog: Record<string, { type: 'brush'; erase: boolean; order: number; radius: number; points: Point[] }
    | { type: 'lasso'; erase: boolean; order: number; points: Point[] }
    | { type: 'rectangle'; erase: boolean; order: number; x: number; y: number; width: number; height: number }>;
  texts: Record<string, {
    x: number; y: number; text: string; fontSize: number; fontFamily: string; color: string; backgroundColor: string | null; padding: number;
    borderRadius: number; opacity: number; align: 'left' | 'center' | 'right'; bold: boolean; italic: boolean; rotation: number; scale: number;
  }>;
  drawings: Record<string, { type: string; order: number; points: Point[]; color: string; width: number; opacity: number; icon: string | null; fill?: 'solid' | 'soft'; holes?: Point[][]; rotation?: number; stack?: number; layer?: 'map' }>;
  initiative: { round: number; active: boolean; entries: Array<{ id: string; tokenId: string; initiative: number; isActive: boolean; sitsOut?: true }>; sides?: { first: string; active?: string } } | null;
  measurement: { snapToGrid: boolean; snapGrid?: { type: 'square' | 'hex-horizontal' | 'hex-vertical'; size: number; offsetX: number; offsetY: number } | null };
  pins?: Array<{ id: string; x: number; y: number; label: string | null; title: string | null; icon?: string; name?: string }>;
}

/** What the GM gave the board, as the player's board reads it: by asset id where the GM's reads vault paths. */
export interface PlayerLook {
  wallHeight(id: string): number | null;
  wallMaterial(id: string): string | null;
  doorProp(id: string): string | null;
  doorFlip(id: string): DoorFlip;
  windowOf(id: string): { bottom: number; top: number } | null;
  wallWidth(id: string): number | null;
  lightHeight(id: string): number | null;
  fogHeight: number | null;
  wallThickness: number | null;
  /** The scene's painted water, or null. */
  water: WaterSource | null;
  materials: readonly BoardMaterialRecord[];
  props: readonly BoardPropRecord[];
  /** The raised shapes of the level shown (materials by asset id: ids of `materials`). */
  shapes: readonly TerrainShape[];
  /** The ground round the map, as the GM set it (its material by asset id). */
  ground: GroundSettings;
  /** The painted background of that ground, as the wire carries it; null for none. */
  painted: BoardPainted | null;
}

/** Corners from the wire's flat x, y, h list. */
function cornersFrom(flat: readonly number[] | undefined): ShapePoint[] {
  const out: ShapePoint[] = [];
  for (let i = 0; flat && i + 2 < flat.length; i += 3) out.push({ x: flat[i]!, y: flat[i + 1]!, h: flat[i + 2]! });
  return out;
}

/** Shapes as the board reads them, from the wire (a shape with fewer than three corners round it is none). */
export function shapesFromWire(records: readonly BoardShapeRecord[] | undefined): TerrainShape[] {
  return (records ?? []).map((record) => ({
    id: record.id, outline: cornersFrom(record.outline), inner: cornersFrom(record.inner),
    ...(record.material ? { material: record.material } : {}), ...(record.sides !== undefined ? { sides: record.sides } : {}),
  })).filter((shape) => shape.outline.length >= 3);
}

/** The ground as the board reads it, from the wire; the map on its table where none came. */
export function groundFromWire(ground: BoardGround | undefined): GroundSettings {
  // A painted ground's background is its terrain picture's asset id: `paintedFromWire` finds the block again by it.
  return readGround(ground ? { ...ground, ...(ground.painted ? { background: ground.painted.terrain } : {}) } : null);
}

/** The painted background the wire's ground carries (pictures by asset id, materials by id), or null for none. */
export function paintedFromWire(ground: BoardGround | undefined): BoardPainted | null {
  return ground?.mode === 'painted' ? ground.painted ?? null : null;
}

/** The scenes stacked with the one shown, as a player's board draws them (files are asset ids; nothing stands on them but their walls, lights and props). */
export function layersFromExtras(extras: BoardExtras | null): ElevationLayerData[] {
  return (extras?.layers ?? []).map((layer: BoardLayerRecord) => {
    const byWall = new Map(layer.walls.map((wall) => [wall.id, wall]));
    const byLight = new Map(layer.lights.map((light) => [light.id, light]));
    const walls: BoardWall[] = layer.walls.map((wall) => ({
      id: wall.id, type: wall.type, p1: { ...wall.p1 }, p2: { ...wall.p2 }, direction: wall.direction ?? null, closed: wall.door ? !wall.door.open : true, locked: false,
      blocks: wall.blocks ?? null, limited: wall.limited === true, chain: wall.door?.chainId ?? null,
    }));
    const lights: BoardLight[] = layer.lights.map((light) => ({
      id: light.id, x: light.x, y: light.y, bright: light.bright, dim: light.dim, color: light.color, intensity: light.intensity,
      animation: light.animation === 'torch' || light.animation === 'candle' || light.animation === 'pulse' || light.animation === 'magic' || light.animation === 'smoulder' ? light.animation : 'none',
      angle: light.angle, rotation: light.rotation, hidden: false, darkness: light.darkness, activeBelowAmbient: light.activeBelowAmbient, tokenId: null,
      ...areaFromWire(light.area),
    }));
    const map: BoardMap = {
      path: layer.id,
      background: layer.image,
      levels: [],
      level: null,
      grid: { enabled: true, visible: false, snap: false, type: 'square', size: layer.grid.size, offsetX: layer.grid.offsetX, offsetY: layer.grid.offsetY, ...(layer.grid.mapStretch ? { mapStretch: { ...layer.grid.mapStretch } } : {}), opacity: 0, lineWidth: 1, color: null, lineType: 'solid', numbers: null, numberOpacity: 0 },
      tokenSettings: { showNameplates: true, showInstanceBadges: true, hiddenResources: [] },
      tokens: [], pins: [], icons: [], texts: [], initiative: readInitiative(null), inks: [], fog: [], walls, lights,
      lighting: { enabled: false, ambient: 1, ambientColor: null },
      rawGrid: null,
      measures: [], measuresElsewhere: [], liquids: [],
    };
    return {
      path: layer.id,
      elevation: layer.elevation,
      map,
      wallHeight: (id) => byWall.get(id)?.height ?? null,
      windowOf: (id) => byWall.get(id)?.window ?? null,
      wallWidth: (id) => byWall.get(id)?.width ?? null,
      wallMaterial: (id) => byWall.get(id)?.material ?? null,
      doorProp: (id) => byWall.get(id)?.door?.prop ?? null,
      doorFlip: (id) => {
        const door = byWall.get(id)?.door;
        return door ? { hinge: door.hinge === true, side: door.side === true } : NO_FLIP;
      },
      lightHeight: (id) => byLight.get(id)?.height ?? 1,
      fogHeight: layer.fogHeight ?? 1,
      wallThickness: layer.wallThickness ?? 0.12,
      props: layer.props.map((prop) => ({ id: prop.id, glb: prop.asset, x: prop.x, y: prop.y, rotation: prop.turn, scale: prop.scale, ...(prop.solid ? { solid: true } : {}), ...(prop.lift ? { lift: prop.lift } : {}) })),
      stands: { ...layer.stands },
      water: waterFromWire(layer.water),
      shapes: shapesFromWire(layer.shapes),
      placement: () => null,
      style: () => 'disc' as const,
    } satisfies ElevationLayerData;
  });
}

export interface SceneBoard {
  map: BoardMap & { darkness: FogOperation[] };
  rules: CollectionRules;
  /** The minis standing on the tokens, by token id: their GLB's asset id. */
  minis: Record<string, { glb: string; scale: number; turn: number; base?: 'round' | 'square' }>;
  look: PlayerLook;
  /** The scenes stacked with this one. */
  layers: ElevationLayerData[];
}

/** The resource that marks a token Connect says is downed (its bars say nothing of it). */
const DOWNED_KEY = '__downed';

export function boardFromScene(scene: PlayerSceneLike, given: BoardExtras | null): SceneBoard {
  // Another scene's board (a player just moved) is not this one's.
  const extras = given && given.sceneId === scene.sceneId ? given : null;
  const definitions = new Map<string, ResourceDefinition>();
  const conditions = new Map<string, ConditionDefinition>();
  const define = (key: string, name: string, color: string, defeating = false): void => {
    if (!definitions.has(key)) definitions.set(key, { key, name, field: key, direction: 'drains', color, visibleToPlayers: true, ...(defeating ? { defeatedWhenSpent: true } : {}) });
  };
  const minis: SceneBoard['minis'] = {};
  const tokens: BoardToken[] = Object.entries(scene.tokens).map(([id, token]) => {
    const resources: Record<string, Meter> = {};
    // An older GM's plain HP bar: coloured as Atlas colours a defeating resource as it runs low.
    if (token.hp) { define('hp', 'HP', '#22c55e', true); resources.hp = { ...token.hp }; }
    const colors: Record<string, string> = {};
    const shows: Record<string, 'bar' | 'numbers'> = {};
    if (token.stress) { define('stress', 'Stress', '#7b5cd6'); resources.stress = { ...token.stress }; }
    (token.resources ?? []).forEach((resource, index) => {
      const key = `r${index}`;
      define(key, key, resource.color);
      colors[key] = resource.color;
      if (resource.bar === false) {
        // Number only: the number players read (the current value, or a static one's), never a bar nor a maximum.
        const number = resource.current ?? resource.max ?? 0;
        resources[key] = { current: number, max: number };
        shows[key] = 'numbers';
      } else if (resource.current !== undefined && resource.max !== undefined) {
        resources[key] = { current: resource.current, max: resource.max };
      } else {
        // Bar only: how full it is, never its numbers (the hundredths are no hit points).
        resources[key] = { current: Math.round(resource.share * 100), max: 100 };
        shows[key] = 'bar';
      }
    });
    if (token.downed) {
      define(DOWNED_KEY, '', '#000000', true);
      resources[DOWNED_KEY] = { current: 0, max: 1 };
    }
    const values: Record<string, number> = {};
    for (const condition of token.conditions) {
      if (condition.value !== null) values[condition.id] = condition.value;
      if (!conditions.has(condition.id) && condition.name) {
        conditions.set(condition.id, { name: condition.name, color: condition.color ?? '#888888', valued: condition.value !== null, ...(condition.icon ? { icon: condition.icon } : {}) });
      }
    }
    if (token.mini?.asset) minis[id] = { glb: token.mini.asset, scale: token.mini.scale, turn: token.mini.turn, ...(token.mini.base === 'round' || token.mini.base === 'square' ? { base: token.mini.base } : {}) };
    return {
      id, x: token.x, y: token.y, size: token.size, rotation: token.rotation, imagePath: token.image,
      kind: 'character', name: token.name, hidden: false,
      showRing: token.ring !== null, ringColor: token.ring ?? '#ffffff', showNameplate: token.name !== null,
      conditions: token.conditions.map((condition) => condition.id), conditionValues: values,
      resources, overriddenMax: [], instanceNumber: token.instance ?? null, statblockPath: null,
      side: token.side ?? null, sees: false, offMap: false, levelId: null, offLevel: false,
      elevation: tokenHeight(token), speed: ownSpeed(token.speed),
      ...(Object.keys(colors).length > 0 ? { resourceColors: colors } : {}),
      ...(Object.keys(shows).length > 0 ? { resourceShows: shows } : {}),
    } satisfies BoardToken;
  });
  const fog: FogOperation[] = [];
  const darkness: FogOperation[] = [];
  for (const [id, op] of Object.entries(scene.fog).sort(([, a], [, b]) => a.order - b.order)) {
    const base = { id, timestamp: op.order, isErasing: op.erase, offsetX: 0, offsetY: 0 };
    const read: FogOperation = op.type === 'brush' ? { ...base, type: 'brush', points: op.points, brushRadius: op.radius }
      : op.type === 'lasso' ? { ...base, type: 'lasso', points: op.points }
      : { ...base, type: 'rectangle', x: op.x, y: op.y, width: op.width, height: op.height };
    (id === DARKNESS_FOG_ID ? darkness : fog).push(read);
  }
  // Atlas 0.16 stacks drawings by its order (`stack`), then by the time drawn; Connect's view lays texts under drawings.
  const drawings = Object.entries(scene.drawings).sort(([, a], [, b]) => (a.stack ?? 0) - (b.stack ?? 0) || a.order - b.order);
  const textCount = Object.keys(scene.texts).length;
  const rankOf = new Map(drawings.map(([id], index) => [id, textCount + index]));
  const inks: BoardInk[] = drawings
    .filter(([, drawing]) => drawing.type !== 'icon' && drawing.type !== 'eraser' && drawing.points.length > 0)
    // What players are sent is never hidden from them (Connect leaves it out); a fill comes only on a closed drawing.
    .map(([id, drawing]) => ({
      id, points: drawing.points.map((point) => ({ ...point })), color: drawing.color, width: drawing.width, opacity: drawing.opacity,
      closed: drawing.fill !== undefined, fill: drawing.fill ?? null, holes: (drawing.holes ?? []).map((ring) => ring.map((point) => ({ ...point }))), hidden: false,
      rank: rankOf.get(id) ?? 0, layer: drawing.layer === 'map' ? 'map' as const : 'above' as const,
    }));
  const icons: BoardIcon[] = drawings
    .filter(([, drawing]) => drawing.type === 'icon' && drawing.icon !== null && drawing.points[0])
    .map(([id, drawing]) => ({ id, icon: drawing.icon!, x: drawing.points[0].x, y: drawing.points[0].y, color: drawing.color, size: drawing.width, opacity: drawing.opacity, rotation: drawing.rotation ?? 0, hidden: false, rank: rankOf.get(id) ?? 0 }));
  const texts: BoardText[] = Object.entries(scene.texts).map(([id, text], rank) => ({
    id, x: text.x, y: text.y, text: text.text, fontSize: text.fontSize, fontFamily: text.fontFamily, color: text.color,
    backgroundColor: text.backgroundColor, padding: text.padding, borderRadius: text.borderRadius, opacity: text.opacity,
    align: text.align, bold: text.bold, italic: text.italic, rotation: text.rotation, scale: text.scale, hidden: false, rank,
  }));
  const pins: BoardPin[] = (scene.pins ?? []).map((pin) => ({ id: pin.id, x: pin.x, y: pin.y, notePath: pin.id, icon: pin.icon ?? 'number', label: pin.label, hex: false, name: pin.name ?? pin.title, ...(pin.name ? { showName: true } : {}) }));
  const initiative = readInitiative(scene.initiative
    ? { entries: scene.initiative.entries.map((entry, order) => ({ ...entry, order })), round: scene.initiative.round, isActive: scene.initiative.active, ...(scene.initiative.sides ? { sides: scene.initiative.sides } : {}) }
    : null);
  const tokenIds = new Set(tokens.map((token) => token.id));
  const walls: BoardWall[] = (extras?.walls ?? []).map((wall) => ({
    id: wall.id, type: wall.type, p1: { ...wall.p1 }, p2: { ...wall.p2 },
    direction: wall.direction ?? null, closed: wall.door ? !wall.door.open : true, locked: false,
    blocks: wall.blocks ?? null, limited: wall.limited === true, chain: wall.door?.chainId ?? null,
  }));
  const lights: BoardLight[] = (extras?.lights ?? []).map((light) => ({
    id: light.id, x: light.x, y: light.y, bright: light.bright, dim: light.dim, color: light.color, intensity: light.intensity,
    animation: light.animation === 'torch' || light.animation === 'candle' || light.animation === 'pulse' || light.animation === 'magic' || light.animation === 'smoulder' ? light.animation : 'none',
    angle: light.angle, rotation: light.rotation, hidden: false, darkness: light.darkness, activeBelowAmbient: light.activeBelowAmbient,
    tokenId: tokenIds.has(light.id) ? light.id : null,
    ...areaFromWire(light.area),
  }));
  const byWall = new Map((extras?.walls ?? []).map((wall) => [wall.id, wall]));
  const byLight = new Map((extras?.lights ?? []).map((light) => [light.id, light]));
  const look: PlayerLook = {
    wallHeight: (id) => byWall.get(id)?.height ?? null,
    windowOf: (id) => byWall.get(id)?.window ?? null,
    wallWidth: (id) => byWall.get(id)?.width ?? null,
    wallMaterial: (id) => byWall.get(id)?.material ?? null,
    doorProp: (id) => byWall.get(id)?.door?.prop ?? null,
    doorFlip: (id) => {
      const door = byWall.get(id)?.door;
      return door ? { hinge: door.hinge === true, side: door.side === true } : NO_FLIP;
    },
    lightHeight: (id) => byLight.get(id)?.height ?? null,
    fogHeight: extras?.fogHeight ?? null,
    wallThickness: extras?.wallThickness ?? null,
    water: waterFromWire(extras?.water),
    materials: extras?.materials ?? [],
    props: extras?.props ?? [],
    shapes: shapesFromWire(extras?.shapes),
    ground: groundFromWire(extras?.ground),
    painted: paintedFromWire(extras?.ground),
  };
  return {
    map: {
      path: scene.sceneId,
      background: scene.map.asset,
      world: { width: scene.map.width, height: scene.map.height, ...(scene.map.matrix ? { matrix: scene.map.matrix } : {}) },
      levels: [],
      level: null,
      grid: gridOf(scene),
      tokenSettings: { showNameplates: true, showInstanceBadges: true, hiddenResources: [] },
      tokens, pins, icons, texts, initiative, inks, fog, darkness, walls, lights,
      lighting: extras ? { ...extras.lighting } : { enabled: false, ambient: 1, ambientColor: null },
      rawGrid: null,
      measures: [], measuresElsewhere: [], liquids: [],
    },
    // The movement steps reach the board through the measurement (`playerBoard.ts`), not the rules.
    rules: { conditions, definitions: [...definitions.values()], gridDefaults: null, initiative: DEFAULT_INITIATIVE_RULES, movement: NO_MOVEMENT_RULES },
    minis,
    look,
    layers: layersFromExtras(extras),
  };
}

/** The grid players see; a hidden one still snaps (`measurement.snapGrid`), as the map's own does. */
function gridOf(scene: PlayerSceneLike): BoardGrid {
  const grid = scene.grid;
  const snap = scene.measurement.snapGrid ?? null;
  const numbers = grid?.cellNumbers ?? grid?.hexNumbers ?? null;
  return {
    enabled: grid !== null || snap !== null,
    visible: grid !== null,
    snap: scene.measurement.snapToGrid,
    type: grid?.type ?? snap?.type ?? 'square',
    size: grid?.size ?? snap?.size ?? scene.map.cellSize,
    offsetX: grid?.offsetX ?? snap?.offsetX ?? 0,
    offsetY: grid?.offsetY ?? snap?.offsetY ?? 0,
    opacity: grid?.opacity ?? 0,
    lineWidth: grid?.lineWidth ?? 1,
    color: grid?.color ?? null,
    lineType: grid?.lineType ?? 'solid',
    numbers: numbers === 'column-row' || numbers === 'sequential' || numbers === 'letter-number' ? numbers : null,
    numberOpacity: grid?.cellNumberOpacity ?? grid?.hexNumberOpacity ?? 0.8,
  };
}

/** A surface light's outline from the wire (a flat list of x, y); nothing for a light without one, or a broken one. */
function areaFromWire(area: readonly number[] | undefined): { area?: Array<{ x: number; y: number }> } {
  if (!Array.isArray(area) || area.length < 6 || area.length % 2 !== 0 || !area.every((n) => typeof n === 'number' && Number.isFinite(n))) return {};
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < area.length; k += 2) out.push({ x: area[k]!, y: area[k + 1]! });
  return { area: out };
}
