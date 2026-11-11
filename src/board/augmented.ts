/**
 * Augmented reality: the board drawn over a phone's camera picture, standing on a printed marker sheet.
 *
 * The page tracks the sheet and gives the camera's pose over it: the turn and the place (in millimetres) that take a
 * point of the sheet to the camera, the camera as computer vision has it (x to the right of the picture, y down it, z
 * ahead). The sheet's own axes are x to its right and y down the page, as it is printed, with z into the table; its
 * middle is the origin.
 *
 * The board lies on the sheet with the map's right along the sheet's right and the map's down along the page's: the
 * board's point (X, Y, Z) (map x, height, map y) is the sheet's (X, Z, -Y), shrunk to the sheet's millimetres.
 */
import * as THREE from 'three';

/** What the page tracked for one frame. */
export interface AugmentedView {
  /** The turn taking sheet directions to the camera's: a 3×3 matrix, row by row. */
  readonly rotation: ArrayLike<number>;
  /** Where the sheet's middle is from the camera, in millimetres. */
  readonly translation: ArrayLike<number>;
  /**
   * What the picture shows, as the tangents of its edges seen from the camera (at a distance of 1 ahead, the edges'
   * places): `left` and `top` negative, as x runs right and y down the picture. The crop of a camera picture filling a
   * screen it does not fit is here: the picture's own middle need not be the screen's.
   */
  readonly frustum: { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number };
  /** How long one square of the map is on the table, in millimetres. */
  readonly squareMm: number;
  /** The token standing on the sheet's middle; null (or a token not on the board) puts the map's middle there. */
  readonly anchor: string | null;
  /**
   * The map point (map units) the sheet's origin lies on, in place of `anchor`: a table the GM placed, whose sheets the
   * page has in millimetres from the map's top left (so this is the map's top left).
   */
  readonly origin?: { readonly x: number; readonly y: number };
  /**
   * The camera's picture this pose was found for (a canvas the page draws it in, cropped to the screen), drawn behind
   * the board: picture and board then never part. Absent: the page shows the picture itself, under the canvas.
   */
  readonly background?: HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
}

/** Room tracking: where the board stands, in the room's metres (WebXR's local space, y up). */
export interface RoomPlace {
  /** The point of the table the board's anchor stands on. */
  readonly position: ArrayLike<number>;
  /** Which way the map's up (its −y) faces, as a turn about the room's up from its −z (radians). */
  readonly yaw: number;
  /** How long one square of the map is on the table, in millimetres. */
  readonly squareMm: number;
  /** The token standing on the point; null puts the map's middle there. */
  readonly anchor: string | null;
}

/** A camera for the board: where it stands and how it is turned, in board units, as three.js has cameras. */
export interface AugmentedCamera {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** Computer vision's camera (y down, z ahead) to three.js's (y up, looking down -z). */
const VISION_TO_THREE = new THREE.Matrix3().set(1, 0, 0, 0, -1, 0, 0, 0, -1);
/** The board's directions (map x, height, map y) to the sheet's (right, down the page, into the table). */
const BOARD_TO_SHEET = new THREE.Matrix3().set(1, 0, 0, 0, 0, 1, 0, -1, 0);

/** Whether `view` is a pose the board can draw from: finite numbers, a turn, a positive square size and frustum. */
export function isAugmentedView(view: unknown): view is AugmentedView {
  const value = view as Partial<AugmentedView> | null;
  if (typeof value !== 'object' || value === null) return false;
  const numbers = (list: unknown, length: number): boolean => {
    const items = list as ArrayLike<unknown> | null;
    if (!items || typeof items !== 'object' || items.length !== length) return false;
    for (let i = 0; i < length; i++) if (typeof items[i] !== 'number' || !Number.isFinite(items[i] as number)) return false;
    return true;
  };
  const frustum = value.frustum;
  return numbers(value.rotation, 9) && numbers(value.translation, 3) && typeof value.squareMm === 'number' && value.squareMm > 0 && Number.isFinite(value.squareMm)
    && typeof frustum === 'object' && frustum !== null && [frustum.left, frustum.right, frustum.top, frustum.bottom].every((n) => typeof n === 'number' && Number.isFinite(n))
    && frustum.right > frustum.left && frustum.bottom > frustum.top
    && (value.anchor === null || value.anchor === undefined || typeof value.anchor === 'string')
    && (value.origin === undefined || (typeof value.origin === 'object' && value.origin !== null && Number.isFinite(value.origin.x) && Number.isFinite(value.origin.y)))
    && (value.background === undefined || (typeof value.background === 'object' && value.background !== null && typeof (value.background as { width?: unknown }).width === 'number'));
}

/**
 * Room tracking: the rig's matrix, taking the room (metres) to the board (its units), for the board standing at
 * `place` with `anchor` (a board point) on it; `unitsPerSquare` board units make a square. Null for a place it cannot use.
 */
export function roomPlacement(place: RoomPlace, unitsPerSquare: number, anchor: { x: number; y?: number; z: number }): THREE.Matrix4 | null {
  const p = place.position;
  if (!p || p.length !== 3 || ![p[0], p[1], p[2], place.yaw, place.squareMm].every((n) => typeof n === 'number' && Number.isFinite(n)) || !(place.squareMm > 0)) return null;
  const unitsPerMetre = unitsPerSquare / (place.squareMm / 1000);
  // Board to room: the anchor to the origin, shrunk to metres, turned to face `yaw`, moved to the point.
  const boardToRoom = new THREE.Matrix4().makeTranslation(p[0]!, p[1]!, p[2]!)
    .multiply(new THREE.Matrix4().makeRotationY(place.yaw))
    .multiply(new THREE.Matrix4().makeScale(1 / unitsPerMetre, 1 / unitsPerMetre, 1 / unitsPerMetre))
    .multiply(new THREE.Matrix4().makeTranslation(-anchor.x, -(anchor.y ?? 0), -anchor.z));
  return boardToRoom.invert();
}

/**
 * The board's camera for a tracked pose: `unitsPerSquare` board units make a square (the grid size), and `anchor` is the
 * board point on the sheet's middle (its height ignored: the sheet is the floor).
 */
export function augmentedCamera(view: AugmentedView, unitsPerSquare: number, anchor: { x: number; y?: number; z: number }): AugmentedCamera {
  const r = view.rotation;
  const sheetToCamera = new THREE.Matrix3().set(r[0]!, r[1]!, r[2]!, r[3]!, r[4]!, r[5]!, r[6]!, r[7]!, r[8]!);
  // Board directions to the camera's, three.js-style.
  const turn = VISION_TO_THREE.clone().multiply(sheetToCamera).multiply(BOARD_TO_SHEET);
  // Board units per millimetre: a camera's picture is the same for the whole world grown about it, so the camera's
  // distance is taken into board units with it.
  const scale = unitsPerSquare / view.squareMm;
  const t = new THREE.Vector3(view.translation[0]!, view.translation[1]!, view.translation[2]!).applyMatrix3(VISION_TO_THREE).multiplyScalar(scale);
  // A board point P is seen at turn·(P − anchor) + t: the camera stands at anchor − turnᵀ·t.
  const back = turn.clone().transpose();
  // The anchor's height: the table is the lowest scene's floor, so a scene stacked higher stands above it.
  const position = t.applyMatrix3(back).negate().add(new THREE.Vector3(anchor.x, anchor.y ?? 0, anchor.z));
  const world = new THREE.Matrix4().setFromMatrix3(back);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(world);
  return { position, quaternion };
}

/** The projection for a tracked frustum, as three.js wants it, from `near` to `far` (board units). */
export function augmentedProjection(frustum: AugmentedView['frustum'], near: number, far: number): THREE.Matrix4 {
  // three.js's top is up the picture: computer vision's y runs down it.
  return new THREE.Matrix4().makePerspective(frustum.left * near, frustum.right * near, -frustum.top * near, -frustum.bottom * near, near, far);
}
