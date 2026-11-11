// Atlas source: src/app/statblocks/render/blocks/HeadingView.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import type { HeadingBlock } from '../../model/templateTypes';
import { SheetHeading } from '../values/SheetHeading';
import type { BlockViewProps } from '../../../../shims/atlasTypes';

/** Static heading text ("Actions"), a section's or a minor one. */
export function HeadingView({ block }: BlockViewProps<HeadingBlock>): React.JSX.Element {
  return <SheetHeading minor={block.level === 'minor'}>{block.text}</SheetHeading>;
}
