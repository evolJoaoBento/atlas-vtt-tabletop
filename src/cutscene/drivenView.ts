/**
 * A cutscene's camera, an eye and a point it looks at, put in the terms the board's orbit camera draws with (a point,
 * a heading, a pitch and a distance). The path of a cutscene can bring the eye onto its target; then the look
 * direction has no meaning, so the last one is kept, and nothing is ever NaN.
 */

import type { Vec3 } from './cutsceneData';
import type { FreeCamera } from './freeCamera';

/**
 * What takes the board's camera over in cinematic mode. `pose` is asked once a frame, with the window's clock in
 * milliseconds, and says where the camera is and how black the picture is (0 clear, 1 black). With `free` set, the
 * board feeds that camera from the mouse and keys instead of the orbit camera (the authoring camera); the driver's
 * `pose` is then expected to read it.
 */
export interface CinematicDriver {
  pose(nowMs: number): { eye: Vec3; target: Vec3; black: number };
  free?: FreeCamera;
}

/** Which way the camera looks: the orbit camera's heading and pitch, in radians. */
export interface Heading {
  yaw: number;
  pitch: number;
}

export interface DrivenView {
  eye: Vec3;
  /** The point looked at: where the eye asked, or a hair ahead of it when the two coincide. */
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  /** A point to aim the drawn camera at, at least a unit ahead of the eye, so a tiny distance never loses the direction. */
  aim: Vec3;
}

/** Closer than this, the eye and target are taken to coincide. */
const COINCIDENT = 1e-6;
/** The distance given to a view whose eye sits on its target. */
const MIN_DISTANCE = 1e-3;

const finite = (v: Vec3): boolean => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** The camera for `eye` looking at `target`; `previous` is the heading to keep when they coincide. Null for numbers that are not finite. */
export function drivenView(eye: Vec3, target: Vec3, previous: Heading): DrivenView | null {
  if (!finite(eye) || !finite(target)) return null;
  const dx = eye.x - target.x;
  const dy = eye.y - target.y;
  const dz = eye.z - target.z;
  const length = Math.hypot(dx, dy, dz);
  let yaw = previous.yaw;
  let pitch = previous.pitch;
  if (length > COINCIDENT) {
    yaw = Math.atan2(dx, dz);
    pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  }
  const distance = Math.max(length, MIN_DISTANCE);
  // The orbit camera sits at +sin/+cos of its heading from its target, so the view runs the other way.
  const flat = Math.cos(pitch);
  const ahead = { x: -Math.sin(yaw) * flat, y: -Math.sin(pitch), z: -Math.cos(yaw) * flat };
  const at = (k: number): Vec3 => ({ x: eye.x + ahead.x * k, y: eye.y + ahead.y * k, z: eye.z + ahead.z * k });
  return {
    eye: { ...eye },
    target: length > COINCIDENT ? { ...target } : at(distance),
    yaw,
    pitch,
    distance,
    aim: at(Math.max(distance, 1)),
  };
}
