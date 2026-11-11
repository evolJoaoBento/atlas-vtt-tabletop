// Atlas source: src/app/statblocks/render/blocks/TextView.tsx @ 0.12.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React from 'react';
import type { TextBlock } from '../../model/templateTypes';
import { valueText } from '../../values/valueText';
import { useSheet } from '../sheetContext';
import { SheetHeading } from '../values/SheetHeading';
import { StandIn, ValueText } from '../values/ValueText';
import { ValueSlot } from '../valueSlot';
import type { BlockViewProps } from '../../../../shims/atlasTypes';

/** Paragraphs of Markdown with dice links: a field's, or the template's own text. */
export function TextView({ block, display }: BlockViewProps<TextBlock>): React.JSX.Element {
  const { state } = useSheet();
  const text = block.field ? valueText(state.reader(block.field)) : block.text ?? '';
  const named = block.heading?.trim();
  const heading = named || state.provisional?.label;

  return (
    <>
      {heading && <SheetHeading placeholder={!named}>{heading}</SheetHeading>}
      <div className="atlas-sb-prose">
        <ValueSlot block={block}>{display.state === 'value' ? <ValueText shown={{ text, problems: [] }} /> : <StandIn display={display} />}</ValueSlot>
      </div>
    </>
  );
}
