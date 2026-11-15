// Atlas source: src/app/statblocks/render/shared/DiceText.tsx @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import React, { useMemo } from 'react';
import { diceLinkProps } from '../../../services/statblockDiceLinks';
import { splitDiceSegments } from '../../../services/statblockDiceText';

/**
 * Text as it reads, its dice notation and bare bonuses as roll links: the
 * React twin of `linkDiceIn`, for text no Markdown renderer drew.
 */
export function DiceText({ text }: { text: string }): React.JSX.Element {
  const segments = useMemo(() => splitDiceSegments(text), [text]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.dice ? (
          <span key={index} {...diceLinkProps(segment.text)}>
            {segment.text}
          </span>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}
