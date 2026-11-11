// Atlas source: src/app/statblocks/render/blocks/RowView.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import type { RowBlock } from '../../model/templateTypes';
import type { BlockViewProps } from '../../../../shims/atlasTypes';

interface RowViewProps extends BlockViewProps<RowBlock> {
  children: React.ReactNode;
}

/** Blocks side by side that wrap where the width runs out; `fill` children share the free width. */
export function RowView({ block, children }: RowViewProps): React.JSX.Element {
  return <div className="atlas-sb-row" data-align={block.align ?? 'start'}>{children}</div>;
}
