/**
 * Atlas's walls, doors and lights (0.8.0's `wallTypes.ts` and `lightingTypes.ts`) as the 3D board reads them from a
 * map file, and the arithmetic of drawing them: where a wall segment stands and how it turns, how a door swings on its
 * hinge, a light's reach in map pixels and how its flame flickers. Atlas keeps walls under `state.objects.walls` and
 * lights under `state.objects.lights` (a token may carry one too, as `light`), keyed by id; the scene's own light is
 * `state.lighting`. Pure, so it is tested without Obsidian.
 */

export type WallType = 'solid' | 'door' | 'secret-door';

export interface Point {
  x: number;
  y: number;
}

export interface BoardWall {
  id: string;
  type: WallType;
  p1: Point;
  p2: Point;
  /**
   * A one-way wall (Atlas's `direction`): light and sight coming from that side (`left` is the side of the normal
   * (−dy, dx) of p1 → p2) are stopped, from the other side they pass; null stops both ways.
   */
  direction: 'left' | 'right' | null;
  /** A door: shut (the default) or open. */
  closed: boolean;
  locked: boolean;
  /** The one thing it stops (a curtain stops sight, glass light); null stops both. */
  blocks: 'sight' | 'light' | null;
  /** A hedge or low wall: drawn half as tall. */
  limited: boolean;
  /** The segments drawn in one stroke share a chain. */
  chain: string | null;
}

export type LightAnimation = 'none' | 'torch' | 'candle' | 'pulse' | 'magic';

export interface BoardLight {
  /** The light's id, or the id of the token carrying it. */
  id: string;
  x: number;
  y: number;
  /** Radii in game units (feet, metres): full light, and where the light ends. */
  bright: number;
  dim: number;
  color: string;
  intensity: number;
  animation: LightAnimation;
  /** A beam this many degrees wide (a bullseye lantern), facing `rotation`; null shines all around. */
  angle: number | null;
  /** Degrees as a token's rotation: 0 faces up on the map, 90 right. */
  rotation: number;
  /** Switched off by the GM. */
  hidden: boolean;
  /** Magical darkness: it gives no light. */
  darkness: boolean;
  /** Shines only while the ambient light is at or below this; null always. */
  activeBelowAmbient: number | null;
  /** The token that carries it; null for a light placed on the map. */
  tokenId: string | null;
}

export interface SceneLighting {
  enabled: boolean;
  /** 0 is pitch black, 1 is daylight. */
  ambient: number;
  ambientColor: string | null;
}

type Raw = Record<string, unknown>;
const isObj = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const items = (value: unknown): Raw[] => (isObj(value) ? Object.values(value).filter(isObj) : []);

function point(raw: unknown): Point | null {
  return isObj(raw) && typeof raw.x === 'number' && typeof raw.y === 'number' && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null;
}

function readWall(raw: Raw): BoardWall | null {
  const id = str(raw.id);
  const p1 = point(raw.p1);
  const p2 = point(raw.p2);
  if (!id || !p1 || !p2 || (p1.x === p2.x && p1.y === p2.y)) return null;
  return {
    id,
    type: raw.type === 'door' || raw.type === 'secret-door' ? raw.type : 'solid',
    p1, p2,
    direction: raw.direction === 'left' || raw.direction === 'right' ? raw.direction : null,
    closed: raw.closed !== false,
    locked: raw.locked === true,
    blocks: raw.blocks === 'sight' || raw.blocks === 'light' ? raw.blocks : null,
    limited: raw.limited === true,
    chain: str(raw.chainId),
  };
}

/** The map's walls and doors (`state.objects.walls`); a segment of no length is left out. */
export function readWalls(raw: unknown): BoardWall[] {
  return items(raw).map(readWall).filter((wall): wall is BoardWall => wall !== null);
}

export const isDoor = (wall: Pick<BoardWall, 'type'>): boolean => wall.type !== 'solid';

function readEmission(raw: unknown, id: string, at: Point, tokenId: string | null, rotation: number, hidden: boolean, activeBelowAmbient: number | null): BoardLight | null {
  if (!isObj(raw)) return null;
  const dim = Math.max(0, num(raw.dim, 0));
  const bright = Math.min(dim, Math.max(0, num(raw.bright, 0)));
  const angle = num(raw.angle, 360);
  const animation = raw.animation;
  return {
    id, x: at.x, y: at.y, bright, dim,
    color: str(raw.color) ?? '#ffffff',
    intensity: Math.max(0, num(raw.intensity, 1)),
    animation: animation === 'torch' || animation === 'candle' || animation === 'pulse' || animation === 'magic' ? animation : 'none',
    angle: angle > 0 && angle < 360 ? angle : null,
    rotation, hidden, darkness: raw.darkness === true, activeBelowAmbient, tokenId,
  };
}

/** The lights placed on the map (`state.objects.lights`) and those its tokens carry (`token.light`). */
export function readLights(lights: unknown, tokens: unknown): BoardLight[] {
  const out: BoardLight[] = [];
  for (const raw of items(lights)) {
    const id = str(raw.id);
    const at = point(raw);
    if (!id || !at) continue;
    const gate = typeof raw.activeBelowAmbient === 'number' && raw.activeBelowAmbient < 1 ? raw.activeBelowAmbient : null;
    const light = readEmission(raw.emission, id, at, null, num(raw.rotation, 0), raw.hidden === true, gate);
    if (light) out.push(light);
  }
  for (const raw of items(tokens)) {
    const id = str(raw.id);
    const at = point(raw);
    // A combatant kept beside the map (Atlas 0.9) lights nothing.
    if (!id || !at || !isObj(raw.light) || raw.offMap === true) continue;
    const light = readEmission(raw.light, id, at, id, num(raw.rotation, 0), false, null);
    if (light) out.push(light);
  }
  return out;
}

/** The scene's own light (`state.lighting`), as Atlas defaults it: off, at 0.1. */
export function readSceneLighting(raw: unknown): SceneLighting {
  const lighting = isObj(raw) ? raw : {};
  return { enabled: lighting.enabled === true, ambient: Math.min(1, Math.max(0, num(lighting.ambient, 0.1))), ambientColor: str(lighting.ambientColor) };
}

// ── Drawing ─────────────────────────────────────────────────────────────────

/** A segment's middle, length and heading on the map: radians from the map's x axis toward its y axis. */
export function segmentFrame(p1: Point, p2: Point): { cx: number; cy: number; length: number; heading: number } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return { cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2, length: Math.hypot(dx, dy), heading: Math.atan2(dy, dx) };
}

/** A door opens a quarter turn. */
export const DOOR_SWING = Math.PI / 2;

/**
 * Which way a door swings on its hinge (at `p1`): +1 turns its far end toward heading − 90° on the map (the left of
 * p1 → p2 as drawn, y down), −1 toward heading + 90°. A one-way door opens the way light passes through it, away
 * from the side it stops.
 */
export function swingSide(wall: Pick<BoardWall, 'direction'>): 1 | -1 {
  return wall.direction === 'left' ? -1 : 1;
}

/** The heading (radians on the map) light passes a one-way wall in: away from the side it stops. */
export function passHeading(wall: Pick<BoardWall, 'p1' | 'p2' | 'direction'>): number | null {
  if (!wall.direction) return null;
  // Atlas's stopping side for `left` is the normal (−dy, dx), heading + 90°; light passes toward it.
  return segmentFrame(wall.p1, wall.p2).heading + (wall.direction === 'left' ? 1 : -1) * (Math.PI / 2);
}

/**
 * The whole wall a segment belongs to: the segments drawn with it in one stroke (its chain), or, for a wall drawn
 * without one, the run of segments joined end to end with it, up to where three or more meet or a door stands.
 */
export function wholeWall(walls: readonly BoardWall[], id: string): string[] {
  const start = walls.find((wall) => wall.id === id);
  if (!start || isDoor(start)) return start ? [start.id] : [];
  if (start.chain) return walls.filter((wall) => wall.chain === start.chain && !isDoor(wall)).map((wall) => wall.id);
  const key = (point: Point): string => `${Math.round(point.x)},${Math.round(point.y)}`;
  const at = new Map<string, BoardWall[]>();
  for (const wall of walls) for (const end of [wall.p1, wall.p2]) at.set(key(end), [...(at.get(key(end)) ?? []), wall]);
  const run = new Set<string>([start.id]);
  const queue: BoardWall[] = [start];
  while (queue.length > 0) {
    const wall = queue.shift()!;
    for (const end of [wall.p1, wall.p2]) {
      const meeting = at.get(key(end)) ?? [];
      // A junction, or a door, ends the run.
      if (meeting.length !== 2 || meeting.some(isDoor)) continue;
      for (const next of meeting) if (!run.has(next.id)) { run.add(next.id); queue.push(next); }
    }
  }
  return walls.filter((wall) => run.has(wall.id)).map((wall) => wall.id);
}

/**
 * The door's leaf heading on the map at `openness` (0 shut, 1 open): its own heading turned toward the swing side.
 * On the map (y down) the left of a heading is a turn of −90°.
 */
export function leafHeading(wall: Pick<BoardWall, 'p1' | 'p2' | 'direction'>, openness: number): number {
  const { heading } = segmentFrame(wall.p1, wall.p2);
  return heading - swingSide(wall) * DOOR_SWING * Math.min(1, Math.max(0, openness));
}

/** Eases a door toward its goal: about half a second from shut to open. */
export function stepOpenness(now: number, goal: number, dt: number): number {
  const step = dt / 0.5;
  return goal > now ? Math.min(goal, now + step) : Math.max(goal, now - step);
}

/** Smooth start and stop of a swing. */
export const easeSwing = (t: number): number => t * t * (3 - 2 * t);

/** Game units to map pixels: `unitDistance` units to a cell of `cellPx`. */
export function unitsToPx(units: number, unitDistance: number, cellPx: number): number {
  return unitDistance > 0 ? (units / unitDistance) * cellPx : 0;
}

/** A cheap smooth noise in [0, 1] for a flame: the sum of three out-of-step waves. */
function waver(t: number, seed: number): number {
  return (Math.sin(t * 7.3 + seed) + Math.sin(t * 13.1 + seed * 2.1) * 0.6 + Math.sin(t * 23.7 + seed * 3.7) * 0.3 + 1.9) / 3.8;
}

/** How strongly an animated light shines at time `t` (seconds), as a share of its intensity; `seed` keeps lights apart. */
export function flicker(animation: LightAnimation, t: number, seed: number): number {
  switch (animation) {
    case 'torch': return 0.78 + 0.32 * waver(t, seed);
    case 'candle': return 0.88 + 0.16 * waver(t * 1.4, seed);
    case 'pulse': return 0.75 + 0.25 * Math.sin((t / 2) * Math.PI * 2 + seed);
    case 'magic': return 0.8 + 0.2 * Math.sin(t * 1.3 + seed) * Math.sin(t * 0.7 + seed * 1.7);
    default: return 1;
  }
}

/** A number from an id, to keep two lights' flames out of step. */
export function seedOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(hash) % 1000) / 100;
}
