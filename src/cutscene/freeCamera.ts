/**
 * The camera a cutscene is authored with: a first-person eye that looks, flies and dollies with no limits on distance
 * or on where it may go, and never rolls. Pitch alone is held just short of straight up or down, so "up" stays defined.
 * It is plain numbers, so it is tested without a board. The board feeds it from the mouse and keys (`Board.cinematic`).
 */

import type { Vec3 } from './cutsceneData';

/** How far short of straight up or down the pitch is held. */
const PITCH_MARGIN = 0.01;
const MAX_PITCH = Math.PI / 2 - PITCH_MARGIN;

const clampPitch = (pitch: number): number => Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));

export class FreeCamera {
  private eye: Vec3;
  /** Radians about the vertical: 0 looks along -z, and turning towards +x is to the right. */
  private yaw = 0;
  /** Radians above the horizon. */
  private pitch = 0;
  /** The distance from the eye to the target it reports, kept as it was made with. */
  private readonly reach: number;

  constructor(eye: Vec3, target: Vec3) {
    this.eye = { ...eye };
    const dx = target.x - eye.x;
    const dy = target.y - eye.y;
    const dz = target.z - eye.z;
    const length = Math.hypot(dx, dy, dz);
    if (length > 1e-9) {
      this.reach = length;
      this.yaw = Math.atan2(dx, -dz);
      this.pitch = clampPitch(Math.asin(Math.max(-1, Math.min(1, dy / length))));
    } else {
      this.reach = 1;
    }
  }

  /** Turns the view, `dx` to the right and `dy` up, in radians. */
  look(dx: number, dy: number): void {
    // A number that is not finite (a wheel event with no delta) would make the eye and heading NaN for good.
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.yaw += dx;
    this.pitch = clampPitch(this.pitch + dy);
  }

  private forwardAxis(): Vec3 {
    const flat = Math.cos(this.pitch);
    return { x: Math.sin(this.yaw) * flat, y: Math.sin(this.pitch), z: -Math.cos(this.yaw) * flat };
  }

  /** Moves along the view's own axes, in world units: `right` and `forward` as the view faces, `up` along world y. */
  fly(right: number, up: number, forward: number): void {
    if (!Number.isFinite(right + up + forward)) return;
    const ahead = this.forwardAxis();
    this.eye = {
      x: this.eye.x + Math.cos(this.yaw) * right + ahead.x * forward,
      y: this.eye.y + up + ahead.y * forward,
      z: this.eye.z + Math.sin(this.yaw) * right + ahead.z * forward,
    };
  }

  /** Moves along the view by `reach * (factor - 1)`: a factor above 1 goes in, below 1 backs out. */
  dolly(factor: number): void {
    if (!Number.isFinite(factor)) return;
    this.fly(0, 0, this.reach * (factor - 1));
  }

  /** The eye, and the point `reach` ahead of it. */
  pose(): { eye: Vec3; target: Vec3 } {
    const ahead = this.forwardAxis();
    return {
      eye: { ...this.eye },
      target: { x: this.eye.x + ahead.x * this.reach, y: this.eye.y + ahead.y * this.reach, z: this.eye.z + ahead.z * this.reach },
    };
  }
}
