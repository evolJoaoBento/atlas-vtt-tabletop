// Atlas source: src/app/react/components/CoinIcon.tsx @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { WIDGET_ICON_PATHS } from '../../types/widgetIcons';

interface CoinIconProps {
  className?: string;
  /** Square box in pixels, like lucide's `size`; CSS may size it instead. */
  size?: number;
}

/**
 * The gold coin mark of the loot roller and of prices: the widgets' `coins`
 * glyph, cropped and centred in a square box so it lines up with lucide icons.
 */
export function CoinIcon({ className, size = 24 }: CoinIconProps): React.ReactElement {
  return (
    <svg viewBox="14 89 484 334" width={size} height={size} fill="currentColor" className={className} aria-hidden="true">
      <path d={WIDGET_ICON_PATHS.coins} />
    </svg>
  );
}
