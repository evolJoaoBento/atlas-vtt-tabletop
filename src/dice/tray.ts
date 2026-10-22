/**
 * Where dice roll on the board: the map itself, its edges the tray's walls. A roll's dice are laid where the camera
 * looks; a die is carried and thrown anywhere on the map, and only the map's edge stops it. Pure: the board gives the
 * map's size, the tray only places it. Map pixels on the ground (x and z, as the board's world).
 */

export interface Tray {
  center: { x: number; z: number };
  /** Half its size along map x and along map y (the board's z), in map pixels. */
  halfWidth: number;
  halfDepth: number;
  /** How the tray is turned on the board: the map's own edges, so never. */
  yaw: number;
}

/** Without a map to roll on (none loaded, or none measured): a room of this many squares each way round where the camera looks. */
const NO_MAP_SQUARES = 20;

/**
 * The tray: the whole map, from (0, 0) to its width and height. With no map of a size a die fits in, a room round
 * `target` instead. `dieEdge` is a die's edge in map pixels.
 */
export function trayOnMap(map: { width: number; height: number }, target: { x: number; z: number }, gridSize: number, dieEdge: number): Tray {
  if (map.width >= dieEdge * 2 && map.height >= dieEdge * 2) {
    return { center: { x: map.width / 2, z: map.height / 2 }, halfWidth: map.width / 2, halfDepth: map.height / 2, yaw: 0 };
  }
  const half = Math.max(dieEdge, NO_MAP_SQUARES * gridSize);
  return { center: { x: target.x, z: target.z }, halfWidth: half, halfDepth: half, yaw: 0 };
}

/** A die's edge on the board, in map pixels: a share of a grid square. */
export function dieEdgePx(gridSize: number, squares = 0.6): number {
  return gridSize * squares;
}
