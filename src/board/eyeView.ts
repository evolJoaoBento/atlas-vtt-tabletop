/**
 * Seeing through a token's eyes: the camera stands at the token's eye height and looks about. On a phone with a
 * gyroscope the view turns as the phone does (its compass heading taken as where the camera was facing when the view
 * opened, as headings differ from phone to phone); a drag turns it too (with a gyroscope, only around, as the phone
 * gives the tilt). The turn is eased so a shaking hand does not shake the view.
 */
import * as THREE from 'three';

const DEG = Math.PI / 180;
/** How fast the shown turn closes on the wanted one, per second. */
const EASE = 14;
/** How far a drag of one pixel turns the view, in radians. */
const DRAG = 0.005;
const MAX_PITCH = 1.45;

/** A turn about the vertical axis. */
const yawQuaternion = (yaw: number): THREE.Quaternion => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

/**
 * The camera's turn for a phone held as the device orientation says (`alpha`, `beta`, `gamma` in degrees) with the screen
 * turned `screen` degrees: the camera looks out of the back of the phone, as through a window.
 */
export function deviceQuaternion(alpha: number, beta: number, gamma: number, screen: number): THREE.Quaternion {
  const euler = new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  const turn = new THREE.Quaternion().setFromEuler(euler);
  // The phone lying flat looks at the ground; the camera looks forward: a quarter turn back about X.
  turn.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
  // The screen turned to landscape.
  turn.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -screen * DEG));
  return turn;
}

/** How far a phone must lean from lying flat (degrees) for its gravity to tell which way the screen is turned. */
const UPRIGHT_ENOUGH = 30;

/**
 * How far the screen is turned from the phone's portrait (degrees, as `screen.orientation.angle` should say: 90 with the
 * phone's top to the left), for `deviceQuaternion`, whose readings are always in the portrait frame.
 * The browser's own angle is taken where it fits the window's shape. An iPad's Safari gets it a quarter wrong (it calls
 * its landscape 0), which turned the view sideways: there the device's lean says which side is up, read once while it
 * is held upright enough to tell, then kept, so looking about never flips it. It is found again only when the screen
 * turns (the browser's angle or the window's shape changes).
 */
export class ScreenTurn {
  private key = '';
  private turn = 0;
  private sure = false;

  /** The turn for this reading: `reported` the browser's angle (null: it gives none), `beta`, `gamma` the lean in degrees. */
  read(reported: number | null, portraitWindow: boolean, beta: number, gamma: number): number {
    const angle = reported === null ? null : ((reported % 360) + 360) % 360;
    if (angle !== null && (angle === 0 || angle === 180) === portraitWindow) return angle;
    const key = `${angle}|${portraitWindow}`;
    if (key !== this.key) {
      this.key = key;
      this.sure = false;
      this.turn = portraitWindow ? 0 : 90;
    }
    if (this.sure) return this.turn;
    // Upright in portrait the top is up (beta 90), upside down beta is -90; in landscape with the top to the left the
    // right side is up (gamma below 0), with the top to the right it is down. Lying flat it cannot tell: a guess, kept
    // until the device is held up.
    const lean = portraitWindow ? beta : gamma;
    if (Math.abs(lean) >= UPRIGHT_ENOUGH) {
      this.turn = portraitWindow ? (beta < 0 ? 180 : 0) : (gamma < 0 ? 90 : 270);
      this.sure = true;
    }
    return this.turn;
  }
}

/** The heading of a camera turn: where its forward (-Z) points, about the vertical axis. */
export function headingOf(turn: THREE.Quaternion): number {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(turn);
  return Math.atan2(-forward.x, -forward.z);
}

export class EyeView {
  /** The turn a drag sets (or, with a gyroscope, adds round the vertical). */
  private yaw: number;
  private pitch = 0;
  /** The phone's turn, from its last reading; null until one came (or without a gyroscope). */
  private device: THREE.Quaternion | null = null;
  /** What turns the phone's compass heading into the view's: set by the first reading. */
  private offset: number | null = null;
  private readonly shown = new THREE.Quaternion();
  private fresh = true;
  /** Which way the screen is turned (`ScreenTurn`). */
  private readonly screen = new ScreenTurn();
  private readonly stop: () => void;

  constructor(readonly tokenId: string, startYaw: number, readonly gyro: boolean, win: Window, private readonly wake: () => void) {
    this.yaw = startYaw;
    if (!gyro) { this.stop = () => undefined; return; }
    const read = (event: DeviceOrientationEvent): void => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const reported = win.screen?.orientation?.angle ?? (win as unknown as { orientation?: number }).orientation ?? null;
      const screen = this.screen.read(reported, win.innerHeight >= win.innerWidth, event.beta, event.gamma);
      this.device = deviceQuaternion(event.alpha, event.beta, event.gamma, screen);
      if (this.offset === null) this.offset = this.yaw - headingOf(this.device);
      this.wake();
    };
    win.addEventListener('deviceorientation', read);
    this.stop = () => win.removeEventListener('deviceorientation', read);
  }

  /** Whether the phone's gyroscope is turning the view (a reading came). */
  get moving(): boolean {
    return this.device !== null;
  }

  /** A drag of `dx`, `dy` pixels: turns the view (with the gyroscope steering, only around). */
  drag(dx: number, dy: number): void {
    if (this.device && this.offset !== null) {
      this.offset -= dx * DRAG;
    } else {
      this.yaw -= dx * DRAG;
      this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * DRAG));
    }
    this.wake();
  }

  /** The turn to draw with this frame, eased toward the wanted one; `dt` in seconds. Returns whether it is still turning. */
  turn(dt: number): { quaternion: THREE.Quaternion; turning: boolean } {
    const wanted = this.device && this.offset !== null
      ? yawQuaternion(this.offset).multiply(this.device)
      : new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if (this.fresh) { this.shown.copy(wanted); this.fresh = false; return { quaternion: this.shown, turning: false }; }
    const left = this.shown.angleTo(wanted);
    this.shown.slerp(wanted, 1 - Math.exp(-EASE * Math.max(0, dt)));
    return { quaternion: this.shown, turning: left > 1e-3 };
  }

  dispose(): void {
    this.stop();
  }
}
