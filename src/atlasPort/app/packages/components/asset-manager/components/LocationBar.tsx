// Atlas source: src/app/packages/components/asset-manager/components/LocationBar.tsx @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import { Breadcrumb, type BreadcrumbProps } from './Breadcrumb';
import { SortControls, type SortControlsProps } from './SortControls';

export interface LocationBarProps extends BreadcrumbProps {
  sort: SortControlsProps;
}

/** The row above the content: where the open folder lies, and how its assets are sorted. */
export function LocationBar({ sort, ...breadcrumb }: LocationBarProps): React.JSX.Element {
  return (
    <div className="atlas-asset-manager-location">
      <Breadcrumb {...breadcrumb} />
      <SortControls {...sort} />
    </div>
  );
}
