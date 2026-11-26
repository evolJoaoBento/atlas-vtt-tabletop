// Atlas source: src/app/packages/components/shared/conditionBadgeColour.ts @ 0.20.0 (AGPL-3.0, hand-copied for Tabletop: the board's player window shows Atlas's own initiative list; only the imports differ).
// @ts-nocheck
/** A badge colour (0xRRGGBB) as CSS reads it. */
export function badgeColour(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}
