/**
 * How Atlas lays a map's image on its world (`grid.mapStretch`, written by its grid alignment since 0.7): the image
 * is turned by `rotation` degrees about its centre, the box around it is stretched by `x` and `y`, and `offset` pads
 * the top-left. Tokens, walls and the grid live in that world, so the board's size is the world's, not the image's.
 * Ported from Atlas 0.10.2's `xH` and `oxe`. Pure.
 */

interface Point {
  x: number;
  y: number;
}

export interface MapStretch {
  x: number;
  y: number;
  /** Degrees; Atlas keeps it within ±5. */
  rotation?: number;
  offset?: Point;
}

/** The stretch Atlas accepts: each factor from 1 to 1.5, a turn of at most 5°; anything else reads as none (null). */
export function readMapStretch(raw: unknown): MapStretch | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { x, y, rotation } = raw as { x?: unknown; y?: unknown; rotation?: unknown };
  const factor = (value: unknown): value is number => typeof value === 'number' && value >= 1 && value <= 1.5;
  if (!factor(x) || !factor(y)) return null;
  if (rotation !== undefined && (typeof rotation !== 'number' || !Number.isFinite(rotation) || Math.abs(rotation) > 5)) return null;
  const turn = typeof rotation === 'number' ? rotation : 0;
  if (x === 1 && y === 1 && turn === 0) return null;
  return { x, y, ...(turn !== 0 ? { rotation: turn } : {}) };
}

/**
 * A level's own alignment (Atlas 0.10's `levelAlignments[levelId]`, `{ offset, scale, stretch: { x, y, rotation } }`), as
 * the stretch that lays that level's image (Atlas's `Uf`): the stretch's factors times the scale, the turn, and the
 * offset when it pads either side. Null for an alignment that changes nothing; undefined for none.
 */
export function readLevelAlignment(raw: unknown): MapStretch | null | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { offset, scale, stretch } = raw as { offset?: unknown; scale?: unknown; stretch?: unknown };
  const positive = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);
  const part = (typeof stretch === 'object' && stretch !== null ? stretch : {}) as { x?: unknown; y?: unknown; rotation?: unknown };
  const factor = positive(scale, 1);
  const x = positive(part.x, 1) * factor;
  const y = positive(part.y, 1) * factor;
  const turn = typeof part.rotation === 'number' && Number.isFinite(part.rotation) && Math.abs(part.rotation) <= 5 ? part.rotation : 0;
  const pad = (typeof offset === 'object' && offset !== null ? offset : {}) as { x?: unknown; y?: unknown };
  const padX = typeof pad.x === 'number' && pad.x > 0 ? pad.x : 0;
  const padY = typeof pad.y === 'number' && pad.y > 0 ? pad.y : 0;
  if (x === 1 && y === 1 && turn === 0 && padX === 0 && padY === 0) return null;
  return { x, y, ...(turn !== 0 ? { rotation: turn } : {}), ...(padX > 0 || padY > 0 ? { offset: { x: padX, y: padY } } : {}) };
}

/** The box around an image of `size` turned by `rotation` degrees, and where the image's corner sits inside it. */
function turned(size: { width: number; height: number }, rotation: number): { cos: number; sin: number; box: { width: number; height: number } } {
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { cos, sin, box: { width: size.width * Math.abs(cos) + size.height * Math.abs(sin), height: size.width * Math.abs(sin) + size.height * Math.abs(cos) } };
}

/** The world's size for an image of `image` size laid with `stretch` (Atlas's `oxe`). */
export function worldSize(image: { width: number; height: number }, stretch: MapStretch): { width: number; height: number } {
  const { box } = turned(image, stretch.rotation ?? 0);
  return { width: (stretch.offset?.x ?? 0) + box.width * stretch.x, height: (stretch.offset?.y ?? 0) + box.height * stretch.y };
}

/** Where a point of the image (in its pixels) lies in the world (Atlas's `xH`). */
export function imageToWorld(point: Point, image: { width: number; height: number }, stretch: MapStretch): Point {
  const { cos, sin, box } = turned(image, stretch.rotation ?? 0);
  const corner = { x: (image.width - box.width) / 2, y: (image.height - box.height) / 2 };
  const r = point.x - image.width / 2;
  const a = point.y - image.height / 2;
  return {
    x: (image.width / 2 - corner.x + cos * r + sin * a) * stretch.x + (stretch.offset?.x ?? 0),
    y: (image.height / 2 - corner.y - sin * r + cos * a) * stretch.y + (stretch.offset?.y ?? 0),
  };
}

/**
 * How to place the image's plane so it covers what `imageToWorld` says: turn the plane about its own centre by
 * `rotation` (radians, about the vertical axis), put its centre at `centre`, and scale the group holding it by `scale`
 * (x across, y along the map), which shears the turned plane as Atlas's stretch does.
 */
export function stretchPlacement(image: { width: number; height: number }, stretch: MapStretch): { rotation: number; centre: Point; scale: Point } {
  const { box } = turned(image, stretch.rotation ?? 0);
  return {
    rotation: ((stretch.rotation ?? 0) * Math.PI) / 180,
    centre: { x: box.width / 2 + (stretch.offset?.x ?? 0) / stretch.x, y: box.height / 2 + (stretch.offset?.y ?? 0) / stretch.y },
    scale: { x: stretch.x, y: stretch.y },
  };
}
