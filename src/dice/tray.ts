/**
 * Where dice are thrown on the board: a tray at the camera's centre, as wide and deep as most of what the camera shows,
 * turned with the camera so its near wall faces the thrower. Pure: the board measures the view, the tray only sizes it.
 * Map pixels on the ground (x and z, as the board's world).
 */

export interface Tray {
  center: { x: number; z: number };
  /** Half its size across the screen (left to right) and into it (near to far), in map pixels. */
  halfWidth: number;
  halfDepth: number;
  /** The camera's yaw when it was laid: its near wall faces that camera. */
  yaw: number;
}

/** Most of the view, so the walls stand inside the picture. */
const VIEW_SHARE = 0.8;
/**
 * Never larger than a room, nor than most of what is shown: zoomed in close, the walls stay inside the picture (the
 * near ones too, which perspective brings in), so no die comes to rest off screen. The view wins over the old floor of
 * three squares; the least the tray keeps is one die's edge each way.
 */
const MAX_SQUARES = 20;

/**
 * The tray at `target`, sized from the view's half extent on the ground; off the map too, the tray is where the camera
 * looks. `dieEdge` is a die's edge in map pixels, the least the tray keeps each way.
 */
export function trayAt(target: { x: number; z: number }, visibleHalfExtent: { x: number; z: number }, gridSize: number, yaw: number, dieEdge: number): Tray {
  const half = (extent: number): number => Math.max(dieEdge, Math.min(MAX_SQUARES * gridSize, extent * VIEW_SHARE));
  return { center: { x: target.x, z: target.z }, halfWidth: half(visibleHalfExtent.x), halfDepth: half(visibleHalfExtent.z), yaw };
}

/** Where a throw starts: this share of the tray's half depth behind its centre, toward the thrower. */
export const START_SHARE = 0.55;

/** A die's edge on the board, in map pixels: a share of a grid square. */
export function dieEdgePx(gridSize: number, squares = 0.6): number {
  return gridSize * squares;
}
