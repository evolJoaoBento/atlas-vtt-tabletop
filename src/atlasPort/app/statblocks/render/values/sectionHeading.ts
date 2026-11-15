// Atlas source: src/app/statblocks/render/values/sectionHeading.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import type { SectionBlock } from '../../model/templateTypes';
import { valueText } from '../../values/valueText';
import type { SheetState } from '../sheetState';

/** What a Section is headed with: its heading property's value, else its own heading. */
export function sectionHeading(block: SectionBlock, state: SheetState): string {
  return (block.headingField ? valueText(state.reader(block.headingField)) : '') || block.heading || '';
}
