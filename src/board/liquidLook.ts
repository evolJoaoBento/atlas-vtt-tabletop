/**
 * What each liquid the brush paints asks of Atlas besides its outline: the colours Atlas's 2D view moves it in
 * (`LiquidColors`: surface, deep, glint), and for lava and acid the light it glows with over its whole surface (an
 * Atlas light with an `area`, as Atlas's own generator gives its lava and acid, `toLiquids.ts`): lava brightly, acid
 * faintly. Pure.
 */
import type { LiquidKind } from './water';

type Point = { x: number; y: number };

export interface LiquidColors { surface: string; deep: string; glint: string }

const hex = (value: number): string => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');

/** `color` mixed towards `other` (`#rrggbb` each) by `share`. */
export function mixColor(color: string, other: string, share: number): string {
  const part = (text: string, at: number): number => parseInt(text.slice(at, at + 2), 16);
  return `#${[1, 3, 5].map((at) => hex(part(color, at) + (part(other, at) - part(color, at)) * share)).join('')}`;
}

/** The colours Atlas draws a liquid of `kind` in, from its tint: lava cools dark and glints hot yellow in its seams. */
export function liquidColors(kind: LiquidKind, tint: string): LiquidColors {
  if (kind === 'lava') return { surface: tint, deep: mixColor(tint, '#000000', 0.62), glint: mixColor(tint, '#ffd27a', 0.5) };
  if (kind === 'acid') return { surface: tint, deep: mixColor(tint, '#000000', 0.45), glint: mixColor(tint, '#ffffff', 0.5) };
  return { surface: tint, deep: mixColor(tint, '#000000', 0.45), glint: mixColor(tint, '#ffffff', 0.6) };
}

/** How far each liquid's glow reaches, in squares (bright, then dim), and how strong it is: Atlas's own. */
const GLOWS: Readonly<Partial<Record<LiquidKind, { bright: number; dim: number; intensity: number }>>> = {
  lava: { bright: 1, dim: 4, intensity: 1 },
  acid: { bright: 0, dim: 1.5, intensity: 0.5 },
};

/** A ring's middle (its centre of area; its first corner when it has none). */
function centroid(ring: readonly Point[]): Point {
  let a = 0, x = 0, y = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k]!, q = ring[(k + 1) % ring.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  }
  if (a === 0) return { x: ring[0]!.x, y: ring[0]!.y };
  const round = (value: number): number => Math.round(value * 100) / 100 + 0;
  return { x: round(x / (3 * a)), y: round(y / (3 * a)) };
}

/**
 * The light a patch of `kind` glows with, as Atlas's light input: over its outline `area` (corners Atlas reads), in its
 * glint for lava and a pale tint for acid, smouldering, ranges in `unit` game units a square, on `level`, marked as the
 * brush's (`tabletop.glow`: the level, '' without levels). Null for water, or without an outline Atlas reads.
 */
export function glowOf(kind: LiquidKind, area: Point[] | null, colors: LiquidColors, level: string | null, unit: number): Record<string, unknown> | null {
  const glow = GLOWS[kind];
  if (!glow || !area || area.length < 3) return null;
  const middle = centroid(area);
  const color = kind === 'lava' ? colors.glint : mixColor(colors.surface, '#ffffff', 0.35);
  return {
    x: middle.x,
    y: middle.y,
    emission: { bright: glow.bright * unit, dim: glow.dim * unit, color, intensity: glow.intensity, animation: 'smoulder', kind: 'custom' },
    area: area.map(({ x, y }) => ({ x, y })),
    ...(level && { levels: [level] }),
    tabletop: { v: 1, glow: level ?? '' },
  };
}
