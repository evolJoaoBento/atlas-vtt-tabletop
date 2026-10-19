/**
 * Saves a token moved on the board. Atlas never re-reads a map file it has open: its next save writes what it holds,
 * which would undo a move written to the file behind its back. So while an Atlas view has the map open, the move goes
 * through Atlas's own `updateToken` (Atlas shows it and saves it); otherwise the file is edited, changing only that
 * token's `x` and `y` and writing it back the way Atlas writes it (`JSON.stringify`, no indentation).
 */
import type { AtlasView } from '../atlas';

/** The map file's text with one token moved. Throws when the token is not on the map. */
export function moveTokenInText(text: string, id: string, x: number, y: number): string {
  const file = JSON.parse(text) as { state?: { objects?: { tokens?: Record<string, { x?: number; y?: number }> } } };
  const token = file.state?.objects?.tokens?.[id];
  if (!token) throw new Error(`no token ${id} on this map`);
  token.x = x;
  token.y = y;
  return JSON.stringify(file);
}

export interface TokenWriterDeps {
  /** The open Atlas map views. */
  views: () => AtlasView[];
  /** Edits a vault file in place (`app.vault.process`). */
  process: (path: string, edit: (text: string) => string) => Promise<unknown>;
}

export class TokenWriter {
  constructor(private readonly deps: TokenWriterDeps) {}

  /** Moves the token; says whether Atlas took the move or the file was written. */
  async move(path: string, id: string, x: number, y: number): Promise<'atlas' | 'file'> {
    for (const view of this.deps.views()) {
      const state = view.atlasStore.getState();
      if (state.mapPath === path && typeof state.updateToken === 'function') {
        state.updateToken(id, { x, y });
        return 'atlas';
      }
    }
    await this.deps.process(path, (text) => moveTokenInText(text, id, x, y));
    return 'file';
  }
}
