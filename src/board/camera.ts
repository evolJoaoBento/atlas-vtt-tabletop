/**
 * The board's camera, as plain numbers: TacticalEngine's orbit camera (`src/engine/render/camera.ts`), so the board
 * moves the way that game does. It turns around a target on the board, at a pitch that never goes flat enough to lose
 * the board or steep enough to lose the depth, from a distance between close enough to read a token and the whole
 * map. Pan moves the target along the board relative to the current yaw, so "left" is always screen-left. Inputs set
 * a goal and `update` eases the drawn pose toward it, settling exactly so a still camera stops asking for frames.
 * Pure, so it is tested without a renderer.
 */

export interface CameraLimits {
  /** Radians above the board. */
  minPitch: number;
  maxPitch: number;
  /** The flattest the camera may sit when it is all the way out: the far view is looked down on. */
  farPitch: number;
  minDistance: number;
  maxDistance: number;
}

export interface CameraPose {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
}

export interface CameraPosition {
  x: number;
  y: number;
  z: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * The limits for a map `width` × `height` pixels across. TacticalEngine's angles as they are; its distances (6 to 80
 * for a room of about 30 units) keep their ratio, scaled to the map.
 */
export function limitsFor(width: number, height: number): CameraLimits {
  const span = Math.max(width, height, 1);
  return { minPitch: 0.35, maxPitch: 1.45, farPitch: 1.3, minDistance: span * 0.08, maxDistance: span * 2.5 };
}

/**
 * The flattest angle allowed from a given distance. Close up the angle is the GM's to swing; pulled back, the camera is
 * levered towards looking down so the far view reads as a map rather than a horizon. Measured on the logarithm of
 * the distance, because zoom multiplies: a notch of the wheel moves the floor by about as much wherever it is.
 */
export function pitchFloor(distance: number, limits: CameraLimits): number {
  const held = clamp(distance, limits.minDistance, limits.maxDistance);
  const out = Math.log(held / limits.minDistance) / Math.log(limits.maxDistance / limits.minDistance);
  return limits.minPitch + (limits.farPitch - limits.minPitch) * out;
}

/** The eye point a pose describes. */
export function positionOf(pose: CameraPose): CameraPosition {
  const flat = Math.cos(pose.pitch) * pose.distance;
  return {
    x: pose.target.x + Math.sin(pose.yaw) * flat,
    y: pose.target.y + Math.sin(pose.pitch) * pose.distance,
    z: pose.target.z + Math.cos(pose.yaw) * flat,
  };
}

export class OrbitCamera {
  /** Where the camera is heading. Inputs write this. */
  readonly goal: CameraPose;
  /** Where the camera is drawn from this frame. `update()` eases it toward `goal`. */
  readonly pose: CameraPose;
  readonly limits: CameraLimits;
  /** Fraction of the remaining distance closed per second of `update`. */
  damping = 10;
  /** The angle last asked for: pulled back the camera is held above it, and it is handed back on the way in. */
  private wanted: number;

  constructor(pose: Partial<CameraPose> = {}, limits: CameraLimits = limitsFor(1000, 1000)) {
    this.limits = limits;
    this.wanted = clamp(pose.pitch ?? 0.9, limits.minPitch, limits.maxPitch);
    const distance = clamp(pose.distance ?? limits.maxDistance / 4, limits.minDistance, limits.maxDistance);
    this.goal = {
      target: { x: 0, y: 0, z: 0, ...pose.target },
      yaw: pose.yaw ?? 0,
      pitch: clamp(this.wanted, pitchFloor(distance, limits), limits.maxPitch),
      distance,
    };
    this.pose = { ...this.goal, target: { ...this.goal.target } };
  }

  /** Turns around the target, `dx` and `dy` in radians. A flatter angle than this distance allows is kept for later. */
  orbit(dx: number, dy: number): void {
    this.goal.yaw += dx;
    this.wanted = clamp(this.wanted + dy, this.limits.minPitch, this.limits.maxPitch);
    this.seat();
  }

  /** Holds the angle above the floor for however far out the camera is now. */
  private seat(): void {
    this.goal.pitch = clamp(this.wanted, pitchFloor(this.goal.distance, this.limits), this.limits.maxPitch);
  }

  /** Slides the target along the board in screen terms: `right` and `forward` along the camera's own axes. */
  pan(right: number, forward: number): void {
    const sin = Math.sin(this.goal.yaw);
    const cos = Math.cos(this.goal.yaw);
    // The camera sits at +sin/+cos of the yaw from the target, so "forward" on the board is toward -sin/-cos.
    this.goal.target.x += right * cos - forward * sin;
    this.goal.target.z += -right * sin - forward * cos;
  }

  /** Moves in or out; `factor > 1` moves away. */
  zoom(factor: number): void {
    this.goal.distance = clamp(this.goal.distance * factor, this.limits.minDistance, this.limits.maxDistance);
    this.seat();
  }

  /** Looks at a point from the current angle, at a distance that fits `radius`. */
  frame(target: { x: number; y: number; z: number }, radius: number): void {
    this.goal.target = { ...target };
    // 1.8 × the radius reads the whole board at the default pitch without the corners leaving the frame.
    this.goal.distance = clamp(radius * 1.8, this.limits.minDistance, this.limits.maxDistance);
    this.seat();
  }

  /** Looks at a point without changing distance or angle. */
  lookAt(target: { x: number; y: number; z: number }): void {
    this.goal.target = { ...target };
  }

  /** Jumps the drawn pose to the goal, skipping the easing. */
  snap(): void {
    Object.assign(this.pose, this.goal, { target: { ...this.goal.target } });
  }

  /** Eases the drawn pose toward the goal, `dt` in seconds. Returns whether it moved. */
  update(dt: number): boolean {
    const t = 1 - Math.exp(-this.damping * Math.max(0, dt));
    const before = JSON.stringify(this.pose);
    this.pose.yaw += (this.goal.yaw - this.pose.yaw) * t;
    this.pose.pitch += (this.goal.pitch - this.pose.pitch) * t;
    this.pose.distance += (this.goal.distance - this.pose.distance) * t;
    this.pose.target.x += (this.goal.target.x - this.pose.target.x) * t;
    this.pose.target.y += (this.goal.target.y - this.pose.target.y) * t;
    this.pose.target.z += (this.goal.target.z - this.pose.target.z) * t;
    // Settle exactly, scaled to the board, so a still camera stops asking for frames.
    const length = this.limits.minDistance * 1e-4;
    if (Math.abs(this.goal.yaw - this.pose.yaw) < 1e-4) this.pose.yaw = this.goal.yaw;
    if (Math.abs(this.goal.pitch - this.pose.pitch) < 1e-4) this.pose.pitch = this.goal.pitch;
    if (Math.abs(this.goal.distance - this.pose.distance) < length) this.pose.distance = this.goal.distance;
    for (const axis of ['x', 'y', 'z'] as const) {
      if (Math.abs(this.goal.target[axis] - this.pose.target[axis]) < length) this.pose.target[axis] = this.goal.target[axis];
    }
    return JSON.stringify(this.pose) !== before;
  }

  /** Where the camera is, for the drawn pose. */
  position(): CameraPosition {
    return positionOf(this.pose);
  }
}
