// Atlas source: src/app/statblocks/render/shared/statblockEditContext.ts @ 0.15.0 (AGPL-3.0, copied for Tabletop by npm run sync:atlas; do not edit).
// @ts-nocheck
import { createContext, useContext } from 'react';

/** Where a value is written in the note's frontmatter: a key, then list positions and keys below it. */
export type StatblockEditPath = Array<string | number>;

export interface StatblockEditApi {
  /** Whether values in this statblock can be edited in place. */
  editable: boolean;
  /** Writes a value back to the note. `path` addresses the frontmatter key. */
  commit(path: StatblockEditPath, value: string): void;
}

const noop: StatblockEditApi = { editable: false, commit: () => undefined };

export const StatblockEditContext = createContext<StatblockEditApi>(noop);

export function useStatblockEdit(): StatblockEditApi {
  return useContext(StatblockEditContext);
}
