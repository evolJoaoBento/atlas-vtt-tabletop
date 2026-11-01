/**
 * Where a scene of a stack stands on the plane beyond its height: a rigid placement (a turn, then a shift) that carries
 * the scene's own pixels into the base scene's. Every scene of a stack has one (the base scene's is none); the scene
 * being played is drawn as it is and the others by their placement relative to it, so moving a scene while playing
 * another is the same as moving it in the base's frame. Turns are degrees, clockwise on the map (the map's y runs down);
 * shifts are map pixels. Pure.
 */

export interface Placement {
  /** Shift in map pixels, after the turn. */
  x: number;
  y: number;
  /** Degrees, clockwise on the map. */
  turn: number;
}

export const NO_PLACEMENT: Placement = Object.freeze({ x: 0, y: 0, turn: 0 });

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A turn kept within a half turn either way. */
export function wrapTurn(degrees: number): number {
  if (degrees > -180 && degrees <= 180) return degrees;
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Turns a point `degrees` clockwise on the map about the origin. */
export function turnPoint(point: { x: number; y: number }, degrees: number): { x: number; y: number } {
  const cos = Math.cos(radians(degrees));
  const sin = Math.sin(radians(degrees));
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/** `a` after `b`: a point goes through `b`, then through `a`. */
export function compose(a: Placement, b: Placement): Placement {
  const moved = turnPoint(b, a.turn);
  return { x: moved.x + a.x, y: moved.y + a.y, turn: wrapTurn(a.turn + b.turn) };
}

/** The placement that undoes `a`. */
export function inverse(a: Placement): Placement {
  const back = turnPoint({ x: -a.x, y: -a.y }, -a.turn);
  return { x: back.x, y: back.y, turn: wrapTurn(-a.turn) };
}

/** A scene's placement as seen from the scene being played: the played scene's own is taken out of it. */
export function relativeTo(played: Placement, scene: Placement): Placement {
  return compose(inverse(played), scene);
}

/** Turns a placed scene `degrees` about the point `about` (of the plane it is drawn on), the way a hand turns a map on a table. */
export function turnAbout(placement: Placement, about: { x: number; y: number }, degrees: number): Placement {
  const moved = turnPoint({ x: placement.x - about.x, y: placement.y - about.y }, degrees);
  return { x: moved.x + about.x, y: moved.y + about.y, turn: wrapTurn(placement.turn + degrees) };
}

/** The degrees a turn snaps to: 90 by default, 45 with Shift, 5 with Ctrl, none with Alt (Alt wins, then Ctrl, then Shift). */
export function turnStep(keys: { shift?: boolean; ctrl?: boolean; alt?: boolean }): number {
  if (keys.alt) return 0;
  if (keys.ctrl) return 5;
  if (keys.shift) return 45;
  return 90;
}

/** A turn snapped to the nearest multiple of `step` degrees (none: as it is), kept within a half turn either way. */
export function snapTurn(degrees: number, step: number): number {
  return wrapTurn(step > 0 ? Math.round(degrees / step) * step : degrees);
}

/**
 * A camera carried into another scene's frame by `placement` (the old frame's points go through it): the point it looks
 * at goes where that point of the world is now, and it keeps its heading relative to the world, so what was straight
 * ahead stays so. `yaw` is the camera's heading about the target in radians, as the board keeps it.
 */
export function carryView(target: { x: number; z: number }, yaw: number, placement: Placement): { x: number; z: number; yaw: number } {
  const moved = turnPoint({ x: target.x, y: target.z }, placement.turn);
  return { x: moved.x + placement.x, z: moved.y + placement.y, yaw: yaw - radians(placement.turn) };
}

export const isNoPlacement = (placement: Placement): boolean => Math.abs(placement.x) < 1e-6 && Math.abs(placement.y) < 1e-6 && Math.abs(placement.turn) < 1e-6;

/** A stored placement; none for anything that is not three finite numbers, or that moves nothing. */
export function readPlacement(raw: unknown): Placement | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, turn } = raw as Record<string, unknown>;
  const number = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const placement = { x: number(x), y: number(y), turn: wrapTurn(number(turn)) };
  return isNoPlacement(placement) ? null : placement;
}
