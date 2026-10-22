/**
 * The dice settings Tabletop keeps: the dice table's (size, reading, highlight), the pack chosen from the shared packs
 * folder, and the colours the picker offers for a die. Read field by field, so a saved setting that is missing or
 * wrong falls back on its own.
 */
import { DEFAULT_PACK } from './defaultPack';
import type { DiceSettings } from './diceTable';

export interface TabletopDiceSettings extends DiceSettings {
  /** The pack's folder name under the shared packs folder. */
  pack: string;
  /** The colours a die can be thrown in (right-click a die in the picker); the name goes to Atlas's roll log. */
  colors: { name: string; color: string }[];
}

/** The colours Atlas suggests for a collection's dice, named. */
const DEFAULT_COLORS: TabletopDiceSettings['colors'] = [
  { name: 'Red', color: '#d64545' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Green', color: '#22a06b' },
  { name: 'Gold', color: '#e0a526' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Black', color: '#1f2937' },
];

export const DEFAULT_DICE_SETTINGS: TabletopDiceSettings = {
  dieSquares: 0.6,
  tolerance: 0.1,
  motionThreshold: 1,
  shadows: true,
  highlight: true,
  highlightColor: '#ffd54a',
  pack: DEFAULT_PACK,
  colors: DEFAULT_COLORS,
};

/** The bounds each number may take; the settings tab offers them. */
export const DIE_SQUARES = { min: 0.2, max: 2 };
export const TOLERANCE = { min: 0.01, max: 0.5 };
export const MOTION_THRESHOLD = { min: 0.25, max: 4 };

const isColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);

function within(value: unknown, bounds: { min: number; max: number }, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= bounds.min && value <= bounds.max ? value : fallback;
}

/** The colours as saved: each a `#rrggbb` colour and a name (its code when it has none). */
function readColors(value: unknown): TabletopDiceSettings['colors'] {
  if (!Array.isArray(value)) return DEFAULT_COLORS.map((entry) => ({ ...entry }));
  const colors: TabletopDiceSettings['colors'] = [];
  for (const entry of value) {
    const { name, color } = (entry ?? {}) as { name?: unknown; color?: unknown };
    if (!isColor(color)) continue;
    colors.push({ name: typeof name === 'string' && name.trim() !== '' ? name.trim() : color, color });
  }
  return colors;
}

/** Saved dice settings, field by field over the defaults. */
export function readDiceSettings(saved: unknown): TabletopDiceSettings {
  const raw = (typeof saved === 'object' && saved !== null ? saved : {}) as Partial<Record<keyof TabletopDiceSettings, unknown>>;
  const d = DEFAULT_DICE_SETTINGS;
  return {
    dieSquares: within(raw.dieSquares, DIE_SQUARES, d.dieSquares),
    tolerance: within(raw.tolerance, TOLERANCE, d.tolerance),
    motionThreshold: within(raw.motionThreshold, MOTION_THRESHOLD, d.motionThreshold),
    shadows: typeof raw.shadows === 'boolean' ? raw.shadows : d.shadows,
    highlight: typeof raw.highlight === 'boolean' ? raw.highlight : d.highlight,
    highlightColor: isColor(raw.highlightColor) ? raw.highlightColor : d.highlightColor,
    pack: typeof raw.pack === 'string' && raw.pack.trim() !== '' ? raw.pack : d.pack,
    colors: readColors(raw.colors),
  };
}

/** The colours as the settings tab lists them, one `Name #rrggbb` a line; and read back (lines without a colour skipped). */
export function colorsText(colors: TabletopDiceSettings['colors']): string {
  return colors.map((entry) => (entry.name === entry.color ? entry.color : `${entry.name} ${entry.color}`)).join('\n');
}

export function readColorsText(text: string): TabletopDiceSettings['colors'] {
  const colors: TabletopDiceSettings['colors'] = [];
  for (const line of text.split('\n')) {
    const match = /^(.*?)\s*(#[0-9a-fA-F]{6})\s*$/.exec(line.trim());
    if (match) colors.push({ name: match[1]!.trim() || match[2]!, color: match[2]! });
  }
  return colors;
}
