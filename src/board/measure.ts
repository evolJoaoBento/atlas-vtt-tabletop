/**
 * Distances on the map, measured as Atlas measures them: along a path of cell centres, in cells (hex steps on a hex
 * grid; on a square grid by the collection's diagonal rule), labelled in the collection's units ("30ft") or, for
 * abstract systems, in squares or named range bands ("Close", "Far"). Pure.
 */
import { hexAxial } from './geometry';
import type { BoardGrid } from './mapModel';

export type DiagonalRule = 'equidistant' | 'alternating' | 'euclidean';
type UnitType = 'feet' | 'yards' | 'meters' | 'units' | 'custom';

export interface Measurement {
  mode: 'metric' | 'abstract';
  unitType: UnitType;
  unitDistance: number;
  diagonalRule: DiagonalRule;
  /** Abstract mode: the first band a distance fits in names it. */
  bands: Array<{ name: string; maxSquares: number }>;
}

const SUFFIX: Record<UnitType, string> = { feet: 'ft', yards: 'yd', meters: 'm', units: 'u', custom: '' };
const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const unit = (value: unknown): UnitType | null => (typeof value === 'string' && value in SUFFIX ? (value as UnitType) : null);
const rule = (value: unknown): DiagonalRule => (value === 'alternating' || value === 'euclidean' ? value : 'equidistant');

/**
 * The measuring rules: the collection's (`settings.gridDefaults`) when the map is in one, else the map grid's own
 * fields (`unitType`, `unitDistance`, `measurementType`).
 */
export function readMeasurement(collection: unknown, rawGrid: unknown): Measurement {
  if (isObj(collection)) {
    const bands = Array.isArray(collection.abstractRangeBands)
      ? collection.abstractRangeBands.filter((band): band is { name: string; maxSquares: number } =>
        isObj(band) && typeof band.name === 'string' && band.name !== '' && Number.isInteger(band.maxSquares) && (band.maxSquares as number) >= 1)
        .map((band) => ({ name: band.name, maxSquares: band.maxSquares }))
      : [];
    return {
      mode: collection.measurementMode === 'abstract' ? 'abstract' : 'metric',
      unitType: unit(collection.unitType) ?? 'feet',
      unitDistance: typeof collection.unitDistance === 'number' && collection.unitDistance > 0 ? collection.unitDistance : 5,
      diagonalRule: rule(collection.diagonalRule),
      bands,
    };
  }
  const grid = isObj(rawGrid) ? rawGrid : {};
  return {
    mode: grid.measurementType === 'units' ? 'metric' : 'abstract',
    unitType: unit(grid.unitType) ?? 'feet',
    unitDistance: typeof grid.unitDistance === 'number' && grid.unitDistance > 0 ? grid.unitDistance : 5,
    diagonalRule: 'equidistant',
    bands: [],
  };
}

/** A path's length in cells: hex steps on a hex grid, the diagonal rule over the whole path on a square one. */
export function pathLengthInCells(points: ReadonlyArray<{ x: number; y: number }>, grid: BoardGrid, diagonal: DiagonalRule): number {
  if (points.length < 2) return 0;
  if (grid.type !== 'square') {
    let steps = 0;
    for (let i = 1; i < points.length; i++) {
      const a = hexAxial(grid, points[i - 1]!.x, points[i - 1]!.y);
      const b = hexAxial(grid, points[i]!.x, points[i]!.y);
      const dq = a.q - b.q;
      const dr = a.r - b.r;
      steps += (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    }
    return steps;
  }
  let straight = 0;
  let diagonals = 0;
  let exact = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i]!.x - points[i - 1]!.x) / grid.size;
    const dy = Math.abs(points[i]!.y - points[i - 1]!.y) / grid.size;
    straight += Math.abs(dx - dy);
    diagonals += Math.min(dx, dy);
    exact += Math.hypot(dx, dy);
  }
  if (diagonal === 'euclidean') return exact;
  if (diagonal === 'alternating') return straight + diagonals + Math.floor(diagonals / 2);
  return straight + diagonals;
}

/** The distance as Atlas labels it. */
export function formatDistance(cells: number, measurement: Measurement): string {
  if (measurement.mode === 'metric') return `${Math.round(cells * measurement.unitDistance)}${SUFFIX[measurement.unitType]}`;
  const squares = Math.round(cells);
  if (measurement.bands.length === 0) return `${squares} sq`;
  return (measurement.bands.find((band) => squares <= band.maxSquares) ?? measurement.bands[measurement.bands.length - 1]!).name;
}
