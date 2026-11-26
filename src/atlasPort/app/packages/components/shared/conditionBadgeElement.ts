// Atlas source: src/app/packages/components/shared/conditionBadgeElement.ts @ 0.20.0 (AGPL-3.0, hand-copied for Tabletop: the board's player window shows Atlas's own initiative list; only the imports differ).
// @ts-nocheck
import type { ActiveCondition } from '../../../utils/activeConditions';
import { isLightBadgeColor } from '../../../utils/conditionGlyph';
import { WIDGET_ICON_PATHS, WIDGET_ICON_VIEW_BOX } from '../../../types/widgetIcons';
import { badgeColour } from './conditionBadgeColour';
// (stylesheet ./condition-badge.scss: in Atlas's styles.css);

/** `ConditionBadge` for panels built with the DOM instead of React: the same elements and classes. */
export function createConditionBadge(parent: HTMLElement, condition: Pick<ActiveCondition, 'color' | 'glyph' | 'value'>, size: number | string): HTMLElement {
  const badge = parent.createSpan({ cls: 'atlas-condition-badge', attr: { 'aria-hidden': 'true' } });
  if (isLightBadgeColor(condition.color)) badge.addClass('atlas-condition-badge--light');
  badge.style.setProperty('--atlas-condition-color', badgeColour(condition.color));
  // A length in CSS: the players' list grows its badges with the list
  badge.style.setProperty('--atlas-condition-size', typeof size === 'number' ? `${size}px` : size);
  const { glyph } = condition;
  if (glyph.kind === 'icon') {
    const svg = badge.createSvg('svg', { attr: { viewBox: WIDGET_ICON_VIEW_BOX, fill: 'currentColor', 'aria-hidden': 'true' } });
    svg.createSvg('path', { attr: { d: WIDGET_ICON_PATHS[glyph.icon] } });
  } else {
    badge.appendText(glyph.text);
  }
  if (condition.value !== undefined) badge.createSpan({ cls: 'atlas-condition-badge__value', text: String(condition.value) });
  return badge;
}
