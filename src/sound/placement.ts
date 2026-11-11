/** A point in board space: x is the map's x, z is the map's y, y is up (map pixels). */
export interface Point3 { x: number; y: number; z: number }

/** Where the listener is: the camera eye and the point it looks at. */
export interface Listener { eye: Point3; target: Point3 }

const FULL_NEAR = 0.25;
const FAR = 2;
const FAR_GAIN = 0.15;
const MAX_PAN = 0.6;

/**
 * How loud and how far left or right a sound at `at` is heard. `span` is the size of what the camera sees.
 * Gain is 1 near the eye, falls linearly to 0.15 at twice the span and stays there; pan follows the side of the
 * eye-to-target line the point lies on.
 */
export function placeAt(listener: Listener, at: Point3, span: number): { gain: number; pan: number } {
  const rx = at.x - listener.eye.x;
  const ry = at.y - listener.eye.y;
  const rz = at.z - listener.eye.z;
  const distance = Math.hypot(rx, ry, rz);
  const near = FULL_NEAR * span;
  const far = FAR * span;
  let gain: number;
  if (distance <= near) gain = 1;
  else if (distance >= far) gain = FAR_GAIN;
  else gain = 1 - ((distance - near) / (far - near)) * (1 - FAR_GAIN);

  if (distance === 0) return { gain, pan: 0 };
  // The screen's right-hand direction on the table is forward x up. Looking straight down it is undefined, so take
  // map north as up the screen, which makes right the map's +x.
  const forwardX = listener.target.x - listener.eye.x;
  const forwardZ = listener.target.z - listener.eye.z;
  const length = Math.hypot(forwardX, forwardZ);
  const rightX = length < 1e-6 ? 1 : -forwardZ / length;
  const rightZ = length < 1e-6 ? 0 : forwardX / length;
  const side = (rx * rightX + rz * rightZ) / distance;
  return { gain, pan: Math.max(-MAX_PAN, Math.min(MAX_PAN, side * MAX_PAN)) };
}

/** 1 at distance 0, 0 at `reach` or more, and a smoothstep between. */
export function nearness(distance: number, reach: number): number {
  if (reach <= 0 || distance >= reach) return 0;
  if (distance <= 0) return 1;
  const t = distance / reach;
  return 1 - t * t * (3 - 2 * t);
}
