/**
 * Distances on the map, measured by Atlas's own code (`packages/atlas-shared`, stock Atlas files): along a path of
 * cell centres, in cells (hex steps on a hex grid; on a square grid by the collection's diagonal rule, the height
 * between the path's ends counted as a third axis), labelled in the collection's units ("30ft", "8 mi") or, for
 * abstract systems, in squares or named range bands ("Close", "Far"). What is here only reads the settings out of a
 * map file and a collection, and hands Atlas the board's grid. Pure.
 */
import {
  formatDistance as atlasFormatDistance,
  pathLengthInCells as atlasPathLength,
  readUnitName,
  resolveMeasurementSettings,
  type CollectionGridDefaults,
  type DiagonalRule,
  type GridGeometry,
  type GridState,
  type GridUnitType,
  type MeasurementSettings,
} from '../../packages/atlas-shared/src/index';
import type { BoardGrid } from './mapModel';

export type { DiagonalRule };
/** Atlas's measurement settings: the mode, the unit and its name, the distance per cell, the diagonal rule and the range bands. */
export type Measurement = MeasurementSettings;

const UNIT_TYPES: readonly string[] = ['feet', 'yards', 'meters', 'units', 'custom'];
const DIAGONAL_RULES: readonly string[] = ['equidistant', 'alternating', 'euclidean', 'manhattan'];
/** The most a distance per square may be: far past any game, short of anything that overflows a label. */
const MAX_UNIT_DISTANCE = 1_000_000;

/**
 * Feet a rules square spans, for a spell's feet: feet as they are, yards three each, metres as D&D counts them (1.5 m
 * is a 5-foot square); a scale in no such unit (units, custom, abstract bands) counts five. A spell's feet are rules
 * squares, so this reads the collection's distance per square (`ruleDistance`), not a scene's own.
 */
export function feetPerSquare(measurement: Measurement): number {
  const distance = measurement.ruleDistance > 0 ? measurement.ruleDistance : 0;
  if (measurement.mode !== 'metric' || distance === 0) return 5;
  switch (measurement.unitType) {
    case 'feet': return distance;
    case 'yards': return distance * 3;
    case 'meters': return (distance / 1.5) * 5;
    default: return 5;
  }
}

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= MAX_UNIT_DISTANCE;
const unit = (value: unknown): GridUnitType | null => (typeof value === 'string' && UNIT_TYPES.includes(value) ? (value as GridUnitType) : null);

/** A collection's `gridDefaults`, field by field as Atlas reads them; what cannot be read takes Atlas's default. */
function collectionDefaults(collection: Record<string, unknown>): CollectionGridDefaults {
  const unitType = unit(collection.unitType) ?? 'feet';
  const bands = Array.isArray(collection.abstractRangeBands)
    ? collection.abstractRangeBands.filter((band): band is { name: string; maxSquares: number } =>
      isObj(band) && typeof band.name === 'string' && band.name !== '' && Number.isInteger(band.maxSquares) && (band.maxSquares as number) >= 1)
      .map((band) => ({ name: band.name, maxSquares: band.maxSquares }))
    : [];
  const unitName = unitType === 'custom' ? readUnitName(collection.unitName) : undefined;
  return {
    unitType,
    ...(unitName !== undefined ? { unitName } : {}),
    unitDistance: positive(collection.unitDistance) ? collection.unitDistance : 5,
    measurementMode: collection.measurementMode === 'abstract' ? 'abstract' : 'metric',
    abstractRangeBands: bands,
    diagonalRule: typeof collection.diagonalRule === 'string' && DIAGONAL_RULES.includes(collection.diagonalRule) ? (collection.diagonalRule as DiagonalRule) : 'equidistant',
    ...(positive(collection.coneAngle) && collection.coneAngle <= 360 ? { coneAngle: collection.coneAngle } : {}),
  };
}

/** The measuring fields of a map's grid, as the file has them: its own unit, and the scene's own distance and unit name. */
function gridFields(rawGrid: unknown): GridState {
  const grid = isObj(rawGrid) ? rawGrid : {};
  const unitType = unit(grid.unitType);
  const unitName = readUnitName(grid.unitNameOverride);
  return {
    ...(grid.measurementType === 'units' ? { measurementType: 'units' } : {}),
    ...(unitType ? { unitType } : {}),
    ...(positive(grid.unitDistance) ? { unitDistance: grid.unitDistance } : {}),
    ...(positive(grid.unitDistanceOverride) ? { unitDistanceOverride: grid.unitDistanceOverride } : {}),
    ...(unitName !== undefined ? { unitNameOverride: unitName } : {}),
  } as GridState;
}

/**
 * The measuring rules, resolved by Atlas (`resolveMeasurementSettings`): the collection's (`settings.gridDefaults`) when
 * the map is in one, else the map grid's own fields; a scene's own distance per cell and unit name on top of either.
 */
export function readMeasurement(collection: unknown, rawGrid: unknown): Measurement {
  return resolveMeasurementSettings(isObj(collection) ? collectionDefaults(collection) : undefined, gridFields(rawGrid));
}

/**
 * A path's length in cells, by Atlas: hex steps on a hex grid, the diagonal rule over the whole path on a square one.
 * `rise` is the height between the path's ends in cells, counted as a third axis under the same rule.
 */
export function pathLengthInCells(points: ReadonlyArray<{ x: number; y: number }>, grid: BoardGrid, diagonal: DiagonalRule, rise = 0): number {
  if (points.length < 2) return 0;
  const geometry: GridGeometry = { type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY };
  return atlasPathLength(geometry, points, diagonal, rise);
}

/** The distance as Atlas labels it. */
export function formatDistance(cells: number, measurement: Measurement): string {
  return atlasFormatDistance(cells, measurement);
}
