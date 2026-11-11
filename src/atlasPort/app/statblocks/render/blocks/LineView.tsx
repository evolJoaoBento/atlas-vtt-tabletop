// Atlas source: src/app/statblocks/render/blocks/LineView.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import type { LineBlock } from '../../model/templateTypes';
import { DisplayText } from '../values/ValueText';
import { ValueSlot } from '../valueSlot';
import type { BlockViewProps } from '../../../../shims/atlasTypes';

/** The muted italic line under a title: "Large plant, unaligned". */
export function LineView({ block, display }: BlockViewProps<LineBlock>): React.JSX.Element {
  return (
    <div className="atlas-sb-line">
      <ValueSlot block={block}><DisplayText display={display} /></ValueSlot>
    </div>
  );
}
