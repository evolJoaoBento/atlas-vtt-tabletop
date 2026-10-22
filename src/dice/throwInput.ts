/** A throw as the pointer made it: how far it moved in screen pixels (upward is negative dy) and over how long. */
export interface Flick { dx: number; dy: number; ms: number }

/** The flick's speed in screen pixels per millisecond: a click without movement is a gentle toss, a fling has a limit. */
export const MIN_THROW_SPEED = 0.2;
export const MAX_THROW_SPEED = 3;
/** A press that moves less than this is a click; more, and it is a drag that may throw. */
export const DRAG_PX = 6;
/** The flick is the pointer's last stretch of movement before it lets go. */
export const FLICK_MS = 100;
/** A toss with no movement: the dice go gently up the screen. */
export const GENTLE: Flick = { dx: 0, dy: 0, ms: 1 };
/** A flick shorter than this is timed as this long, so a twitch is not a fling. */
const MIN_MS = 16;

/**
 * Which way a flick throws on the ground, as a unit direction in the board's x and z, and how hard (pixels per
 * millisecond, within its bounds). Up the screen is the camera's forward, right the screen its right, as
 * `OrbitCamera.pan` moves the board; no flick at all tosses straight ahead.
 */
export function throwVector(flick: Flick, yaw: number): { x: number; z: number; speed: number } {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const length = Math.hypot(flick.dx, flick.dy);
  const speed = Math.min(MAX_THROW_SPEED, Math.max(MIN_THROW_SPEED, length / Math.max(flick.ms, MIN_MS)));
  if (!(length > 0)) return { x: -sin, z: -cos, speed: MIN_THROW_SPEED };
  const right = flick.dx / length;
  const forward = -flick.dy / length;
  return { x: right * cos - forward * sin, z: -right * sin - forward * cos, speed };
}
