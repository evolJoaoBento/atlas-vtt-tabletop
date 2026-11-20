/**
 * Pure choices and validation for the Measure tool, reusing Atlas's own types and defaults
 * (`src/atlasPort/app/measure/measureTypes.ts` and `measureEffects.ts`).
 */
import { MEASURE_EFFECTS, MEASURE_EFFECT_STARTS, readMeasureEffect, type MeasureEffect } from '../atlasPort/app/measure/measureEffects';
import {
  DEFAULT_MEASURE_TOOL,
  MAX_LINE_WIDTH,
  MEASURE_SHAPES,
  type MeasureMode,
  type MeasureShapeKind,
  type MeasureToolOptions,
} from '../atlasPort/app/measure/measureTypes';
import type { StringKey } from '../i18n';

export {
  DEFAULT_MEASURE_TOOL,
  MAX_LINE_WIDTH,
  MEASURE_EFFECTS,
  MEASURE_EFFECT_STARTS,
  MEASURE_SHAPES,
  readMeasureEffect,
  type MeasureEffect,
  type MeasureMode,
  type MeasureShapeKind,
  type MeasureToolOptions,
};

/** Measure bar modes in Atlas's exact order. */
export const MEASURE_MODES: readonly MeasureMode[] = ['ruler', 'circle', 'cone', 'square', 'line', 'ranges'];

/** Swatch value standing for the theme's accent colour (stored as null on the tool). */
export const ACCENT_SWATCH = 'var(--interactive-accent)';

/** Swatches in Atlas's Look dropdown: accent first, then Atlas's map colours without black. */
export const MEASURE_COLOR_SWATCHES: ReadonlyArray<{ readonly value: string; readonly labelKey: StringKey }> = [
  { value: ACCENT_SWATCH, labelKey: 'color.default' },
  { value: '#ffffff', labelKey: 'color.white' },
  { value: '#e93147', labelKey: 'color.red' },
  { value: '#ec7500', labelKey: 'color.orange' },
  { value: '#e0ac00', labelKey: 'color.yellow' },
  { value: '#08b94e', labelKey: 'color.green' },
  { value: '#086ddd', labelKey: 'color.blue' },
  { value: '#7852ee', labelKey: 'color.purple' },
];

/** Returns the swatch string representing a measurement colour (null -> theme accent). */
export function swatchOfMeasureColor(color: string | null | undefined): string {
  return color ?? ACCENT_SWATCH;
}

/** Converts a chosen swatch back to the stored colour (accent -> null). */
export function measureColorOfSwatch(swatch: string): string | null {
  return swatch === ACCENT_SWATCH ? null : swatch;
}

/**
 * The colour an area takes when given `effect`: the effect's default colour, unless a custom colour was chosen
 * while another effect was active. Mirrors Atlas's `colourWithEffect`.
 */
export function colourWithEffect(
  color: string | null | undefined,
  before: MeasureEffect | null | undefined,
  effect: MeasureEffect,
): string | null {
  return !before || color === MEASURE_EFFECT_STARTS[before].color ? MEASURE_EFFECT_STARTS[effect].color : color ?? null;
}

/** Whether `mode` draws a shape on the board (everything except Ranges). */
export function isMeasureShape(mode: MeasureMode): mode is MeasureShapeKind {
  return mode !== 'ranges';
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Reads persisted Measure tool choices, falling back to `DEFAULT_MEASURE_TOOL` for anything invalid. */
export function readMeasureToolOptions(raw: unknown): MeasureToolOptions {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_MEASURE_TOOL };
  const given = raw as Record<string, unknown>;
  const mode = typeof given.mode === 'string' && (MEASURE_MODES as readonly string[]).includes(given.mode)
    ? (given.mode as MeasureMode)
    : DEFAULT_MEASURE_TOOL.mode;
  const keep = typeof given.keep === 'boolean' ? given.keep : DEFAULT_MEASURE_TOOL.keep;
  const players = typeof given.players === 'boolean' ? given.players : DEFAULT_MEASURE_TOOL.players;
  const color = typeof given.color === 'string' && HEX_COLOR.test(given.color) ? given.color.toLowerCase() : null;
  const lineWidth = typeof given.lineWidth === 'number' && Number.isFinite(given.lineWidth) && given.lineWidth > 0 && given.lineWidth <= MAX_LINE_WIDTH
    ? given.lineWidth
    : DEFAULT_MEASURE_TOOL.lineWidth;
  const effect = given.effect === null ? null : (readMeasureEffect(given.effect) ?? DEFAULT_MEASURE_TOOL.effect);
  return { mode, keep, players, color, lineWidth, effect };
}
