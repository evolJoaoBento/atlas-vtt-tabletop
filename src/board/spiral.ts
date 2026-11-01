/**
 * Where a token dropped on another scene stands: the middle of the board, and when that place is taken, the next square
 * round it in a spiral outward (right, down, left, up, each leg a step longer), the first with room for it. Pure.
 */

export interface Occupant {
  x: number;
  y: number;
  /** How far the token reaches from its centre, in map pixels. */
  radius: number;
}

/** The offsets of the squares round a middle one, in spiral order, starting with the middle one itself. */
export function* spiralOffsets(): Generator<[number, number]> {
  yield [0, 0];
  const turns: ReadonlyArray<[number, number]> = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let x = 0;
  let y = 0;
  let direction = 0;
  for (let length = 1; ; length++) {
    for (let leg = 0; leg < 2; leg++) {
      const [dx, dy] = turns[direction]!;
      for (let step = 0; step < length; step++) {
        x += dx;
        y += dy;
        yield [x, y];
      }
      direction = (direction + 1) % 4;
    }
  }
}

export interface SpiralOptions {
  /** The board's middle, in map pixels. */
  center: { x: number; y: number };
  /** A grid square's size and where its lines start. */
  cell: number;
  offsetX: number;
  offsetY: number;
  /** The board's size: a spot outside it is no spot. */
  width: number;
  height: number;
  occupied: readonly Occupant[];
  /** How far the arriving token reaches from its centre. */
  radius: number;
}

/** The most squares looked at before giving up and using the middle. */
const LIMIT = 900;
/** Two tokens may touch edge to edge, a little overlap forgiven. */
const OVERLAP = 0.9;

export function spiralSpot(options: SpiralOptions): { x: number; y: number } {
  const { center, cell, offsetX, offsetY, width, height, occupied, radius } = options;
  const size = cell > 0 ? cell : 70;
  // The middle of the square the board's middle falls in.
  const first = {
    x: offsetX + (Math.floor((center.x - offsetX) / size) + 0.5) * size,
    y: offsetY + (Math.floor((center.y - offsetY) / size) + 0.5) * size,
  };
  let looked = 0;
  for (const [dc, dr] of spiralOffsets()) {
    if (looked++ >= LIMIT) break;
    const spot = { x: first.x + dc * size, y: first.y + dr * size };
    if (spot.x < 0 || spot.y < 0 || spot.x > width || spot.y > height) continue;
    if (occupied.every((other) => Math.hypot(other.x - spot.x, other.y - spot.y) >= (other.radius + radius) * OVERLAP)) return spot;
  }
  return first;
}
