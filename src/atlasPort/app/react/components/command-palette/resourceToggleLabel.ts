// Atlas source: src/app/react/components/command-palette/resourceToggleLabel.ts @ 0.19.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { ResourceDefinition } from '../../../resources/resourceTypes';
import { shapeOf } from '../../../resources/visibleResources';
import { t } from '../../../../shims/i18n';

/** The label of a switch that shows or hides one resource: named by its shape, a bar or a wheel. */
export function resourceToggleLabel(definition: ResourceDefinition, slot: number): string {
  const key = shapeOf(slot) === 'bar' ? 'tokens.showResourceBars' : 'tokens.showResourceWheels';
  return t(key, { name: definition.name });
}
